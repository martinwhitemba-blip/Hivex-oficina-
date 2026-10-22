import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import {
  addDays,
  aggregateKpi,
  buildAlerts,
  canManageCompany,
  canManagePerson,
  canSeeMetrics,
  isoDate,
  parseCsv,
  parseIsoDate,
  randomCode,
  roleLabel,
  scoreOf,
  slugify,
  workdaysBetween,
} from './domain';
import { actorFromRequest, HttpError, parseBody, signToken, type Actor } from './http';
import { MAP_ROOMS, MAP_SEATS, roomIdForSeat } from './mapCatalog';
import { hashPassword, verifyPassword } from './password';
import { prisma } from './prisma';
import { awardBadge, parseLook, photoUrl, savePhoto, upsertReport } from './services';
import { assertCanAddArea, assertCanAddWorker, attachPlan, audit } from './billing';
import { assignFreeZone } from './zones';
import { directDirectory, directThread, sendDirect } from './direct';
import { broadcastPanel, pushDirect } from './socket';
import { registerOwnerRoutes } from './ownerRoutes';
import { assertJoinRate, clientIp } from './rateLimit';
import { activationCsv, importPeople, rowsFromRecords } from './peopleImport';
import { registerBrandRoutes } from './branding';

const emailSchema = z.string().trim().email('El correo no es válido').transform((v) => v.toLowerCase());
const passwordSchema = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres');

async function auth(req: Parameters<typeof actorFromRequest>[0]) {
  return actorFromRequest(req);
}

function visiblePeople<T extends { id: string; role: string; areaId: string | null }>(actor: Actor, people: T[]) {
  return people.filter((person) => canSeeMetrics(
    { id: actor.membership.id, role: actor.membership.role, areaId: actor.membership.areaId },
    person,
  ));
}

function textField(fields: unknown, name: string) {
  if (!fields || typeof fields !== 'object') return '';
  const raw = (fields as Record<string, unknown>)[name];
  const field = Array.isArray(raw) ? raw[0] : raw;
  if (typeof field === 'string') return field.trim();
  if (field && typeof field === 'object' && 'value' in field) return String((field as { value: unknown }).value ?? '').trim();
  return '';
}

export function registerRoutes(app: FastifyInstance) {
  app.get('/api/salud', async () => ({ ok: true, servicio: 'hivex-beta' }));
  registerBrandRoutes(app);

  app.post('/api/auth/registro', async (req) => {
    const body = parseBody(z.object({
      name: z.string().trim().min(2, 'Escribe tu nombre'),
      email: emailSchema,
      password: passwordSchema,
      companyName: z.string().trim().min(2, 'Escribe el nombre de la empresa'),
      officeName: z.string().trim().optional(),
    }), req.body);
    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) throw new HttpError(409, 'Ese correo ya tiene cuenta. Entra o pide una invitación.');
    const user = await prisma.user.create({
      data: { email: body.email, passwordHash: await hashPassword(body.password) },
    });
    const company = await prisma.company.create({
      data: {
        name: body.companyName,
        slug: slugify(body.companyName),
        officeName: body.officeName || 'Oficina principal',
        apiKey: `hx_${randomCode(24)}`,
      },
    });
    await prisma.membership.create({
      data: {
        userId: user.id,
        companyId: company.id,
        role: 'propietario',
        name: body.name,
        lookJson: JSON.stringify({ skin: '#EFC3A0', hair: '#3B2A20', hairStyle: 0, shirt: '#E0A800', pants: '#1F2937' }),
      },
    });
    await attachPlan(company.id, 'starter', 'trial');
    return { token: signToken(user.id) };
  });

  app.post('/api/auth/entrar', async (req) => {
    const body = parseBody(z.object({ email: emailSchema, password: z.string().min(1, 'Escribe la contraseña') }), req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new HttpError(401, 'Correo o contraseña incorrectos');
    }
    return { token: signToken(user.id), debeCambiarContrasena: user.mustChangePassword };
  });

  app.post('/api/auth/cambiar-clave', async (req) => {
    const actor = await auth(req);
    const body = parseBody(z.object({
      actual: z.string().min(1, 'Escribe la contraseña actual'),
      nueva: passwordSchema,
    }), req.body);
    const user = await prisma.user.findUnique({ where: { id: actor.userId } });
    if (!user || !(await verifyPassword(body.actual, user.passwordHash))) {
      throw new HttpError(401, 'La contraseña actual no coincide');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.nueva), mustChangePassword: false },
    });
    return { ok: true };
  });

  app.get('/api/activar/:code', async (req) => {
    const code = (req.params as { code: string }).code;
    const row = await prisma.activation.findUnique({ where: { code }, include: { company: true, user: true } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new HttpError(404, 'El enlace de activación no es válido o ha caducado');
    const membership = await prisma.membership.findFirst({ where: { id: row.membershipId, companyId: row.companyId } });
    return { email: row.user.email, nombre: membership?.name ?? '', empresa: row.company.name };
  });

  app.post('/api/activar', async (req) => {
    const body = parseBody(z.object({
      code: z.string().trim().min(1, 'Falta el código'),
      password: passwordSchema,
    }), req.body);
    const row = await prisma.activation.findUnique({ where: { code: body.code } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new HttpError(404, 'El enlace de activación no es válido o ha caducado');
    await prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash: await hashPassword(body.password), mustChangePassword: false },
    });
    await prisma.activation.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return { token: signToken(row.userId) };
  });

  app.post('/api/acceso-codigo', async (req) => {
    assertJoinRate(clientIp(req));
    const body = parseBody(z.object({
      code: z.string().trim().min(1, 'Escribe el código'),
      name: z.string().trim().min(2, 'Escribe tu nombre'),
      email: emailSchema,
      password: passwordSchema,
    }), req.body);
    const code = body.code.toUpperCase();
    const company = await prisma.company.findUnique({ where: { joinCode: code } });
    if (!company || !company.joinCodeEnabled) {
      throw new HttpError(404, 'Ese código de acceso no es válido o está desactivado');
    }
    const user = await prisma.user.findUnique({ where: { email: body.email }, include: { memberships: true } });
    const here = user?.memberships.find((membership) => membership.companyId === company.id);
    if (here) {
      if (!(await verifyPassword(body.password, user!.passwordHash))) {
        throw new HttpError(401, 'La contraseña no coincide con la de esa cuenta');
      }
      if (!here.active) throw new HttpError(403, 'Tu acceso a esta empresa está desactivado');
      return { token: signToken(user!.id) };
    }
    if (user?.memberships.some((membership) => membership.companyId !== company.id)) {
      throw new HttpError(409, 'Ese correo ya pertenece a otra empresa');
    }
    await assertCanAddWorker(company.id);
    let userId = user?.id;
    if (!user) {
      const created = await prisma.user.create({
        data: { email: body.email, passwordHash: await hashPassword(body.password) },
      });
      userId = created.id;
    } else if (!(await verifyPassword(body.password, user.passwordHash))) {
      throw new HttpError(401, 'Ese correo ya existe. Usa la misma contraseña para unirte.');
    }
    await prisma.membership.create({
      data: {
        userId: userId!,
        companyId: company.id,
        role: 'empleado',
        name: body.name,
        lookJson: JSON.stringify({ skin: '#F3D2B8', hair: '#5B3A29', hairStyle: 1, shirt: '#2563EB', pants: '#1F2937' }),
      },
    });
    return { token: signToken(userId!) };
  });

  app.get('/api/auth/yo', async (req) => {
    const actor = await auth(req);
    return publicSession(actor);
  });

  app.get('/api/invitaciones/:code', async (req) => {
    const code = (req.params as { code: string }).code;
    const invite = await prisma.invite.findUnique({ where: { code }, include: { company: true, area: true, jobTitle: true } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw new HttpError(404, 'La invitación no es válida o ha caducado');
    return {
      email: invite.email,
      role: invite.role,
      empresa: invite.company.name,
      area: invite.area?.name ?? null,
      puesto: invite.jobTitle?.name ?? null,
    };
  });

  app.post('/api/invitaciones/:code/aceptar', async (req) => {
    const code = (req.params as { code: string }).code;
    const body = parseBody(z.object({
      name: z.string().trim().min(2, 'Escribe tu nombre'),
      password: passwordSchema,
    }), req.body);
    const invite = await prisma.invite.findUnique({ where: { code } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw new HttpError(404, 'La invitación no es válida o ha caducado');
    await assertCanAddWorker(invite.companyId);
    let user = await prisma.user.findUnique({ where: { email: invite.email }, include: { memberships: true } });
    if (user?.memberships.length) throw new HttpError(409, 'Ese correo ya pertenece a una empresa');
    if (!user) {
      const created = await prisma.user.create({
        data: { email: invite.email, passwordHash: await hashPassword(body.password) },
      });
      user = { ...created, memberships: [] };
    } else if (!(await verifyPassword(body.password, user.passwordHash))) {
      throw new HttpError(401, 'Ese correo ya existe. Usa la misma contraseña para unirte.');
    }
    await prisma.membership.create({
      data: {
        userId: user.id,
        companyId: invite.companyId,
        role: invite.role,
        areaId: invite.areaId,
        jobTitleId: invite.jobTitleId,
        name: body.name,
        lookJson: JSON.stringify({ skin: '#F3D2B8', hair: '#5B3A29', hairStyle: 1, shirt: '#2563EB', pants: '#1F2937' }),
      },
    });
    await prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    return { token: signToken(user.id) };
  });

  app.post('/api/invitaciones', async (req) => {
    const actor = await auth(req);
    const body = parseBody(z.object({
      email: emailSchema,
      role: z.enum(['administrador', 'empleado']).default('empleado'),
      areaId: z.string().nullable().optional(),
      jobTitleId: z.string().nullable().optional(),
    }), req.body);
    if (actor.membership.role === 'empleado') throw new HttpError(403, 'Solo dirección puede invitar');
    if (actor.membership.role === 'administrador') {
      if (body.role !== 'empleado') throw new HttpError(403, 'Un director solo puede invitar empleados de su área');
      if (body.areaId && body.areaId !== actor.membership.areaId) throw new HttpError(403, 'Solo puedes invitar a tu área');
      body.areaId = actor.membership.areaId;
    }
    if (body.areaId) {
      const area = await prisma.area.findFirst({ where: { id: body.areaId, companyId: actor.company.id } });
      if (!area) throw new HttpError(404, 'Área no encontrada. Recarga la página: esa área ya no existe.');
    }
    if (body.jobTitleId) {
      const title = await prisma.jobTitle.findFirst({ where: { id: body.jobTitleId, companyId: actor.company.id } });
      if (!title) throw new HttpError(404, 'Puesto no encontrado. Recarga la página: ese puesto ya no existe.');
    }
    const code = randomCode(8);
    const invite = await prisma.invite.create({
      data: {
        companyId: actor.company.id,
        email: body.email,
        role: body.role,
        areaId: body.areaId || null,
        jobTitleId: body.jobTitleId || null,
        code,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      },
    });
    return { code: invite.code, enlace: `#/unirse?code=${invite.code}`, caduca: invite.expiresAt };
  });

  app.get('/api/invitaciones', async (req) => {
    const actor = await auth(req);
    if (actor.membership.role === 'empleado') throw new HttpError(403, 'No puedes ver las invitaciones');
    const where = actor.membership.role === 'propietario'
      ? { companyId: actor.company.id, acceptedAt: null }
      : { companyId: actor.company.id, acceptedAt: null, areaId: actor.membership.areaId };
    const rows = await prisma.invite.findMany({ where, orderBy: { expiresAt: 'desc' } });
    return rows.map((row) => ({ id: row.id, email: row.email, role: row.role, code: row.code, enlace: `#/unirse?code=${row.code}`, caduca: row.expiresAt }));
  });

  app.patch('/api/empresa', async (req) => {
    const actor = await auth(req);
    if (!canManageCompany(actor.membership.role)) throw new HttpError(403, 'Solo el propietario puede editar la empresa');
    const body = parseBody(z.object({
      name: z.string().trim().min(2).optional(),
      officeName: z.string().trim().min(2).optional(),
    }), req.body);
    const company = await prisma.company.update({ where: { id: actor.company.id }, data: body });
    return { id: company.id, name: company.name, officeName: company.officeName };
  });

  function canManageJoin(role: string) {
    return role === 'propietario' || role === 'administrador';
  }

  function joinPayload(company: { joinCode: string | null; joinCodeEnabled: boolean }) {
    return {
      code: company.joinCode,
      enabled: company.joinCodeEnabled,
      enlace: company.joinCode ? `#/codigo?c=${encodeURIComponent(company.joinCode)}` : '',
    };
  }

  app.get('/api/empresa/codigo-acceso', async (req) => {
    const actor = await auth(req);
    if (!canManageJoin(actor.membership.role)) throw new HttpError(403, 'Solo dirección puede ver el código de acceso');
    const company = await prisma.company.findUnique({ where: { id: actor.company.id } });
    if (!company) throw new HttpError(404, 'Empresa no encontrada');
    return joinPayload(company);
  });

  app.patch('/api/empresa/codigo-acceso', async (req) => {
    const actor = await auth(req);
    if (!canManageJoin(actor.membership.role)) throw new HttpError(403, 'Solo dirección puede cambiar el código de acceso');
    const body = parseBody(z.object({ enabled: z.boolean() }), req.body);
    const company = await prisma.company.update({
      where: { id: actor.company.id },
      data: { joinCodeEnabled: body.enabled },
    });
    return joinPayload(company);
  });

  app.post('/api/empresa/codigo-acceso/regenerar', async (req) => {
    const actor = await auth(req);
    if (!canManageJoin(actor.membership.role)) throw new HttpError(403, 'Solo dirección puede regenerar el código');
    const current = await prisma.company.findUnique({ where: { id: actor.company.id } });
    if (!current) throw new HttpError(404, 'Empresa no encontrada');
    let code = randomCode(8);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const clash = await prisma.company.findUnique({ where: { joinCode: code } });
      if (!clash) break;
      code = randomCode(8);
    }
    const company = await prisma.company.update({
      where: { id: actor.company.id },
      data: { joinCode: code, joinCodeEnabled: current.joinCode ? current.joinCodeEnabled : true },
    });
    return joinPayload(company);
  });

  app.get('/api/areas', async (req) => {
    const actor = await auth(req);
    const areas = await prisma.area.findMany({
      where: { companyId: actor.company.id },
      include: { kpis: { orderBy: { sort: 'asc' } }, rooms: true, _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    });
    return areas.map((area) => ({
      id: area.id,
      name: area.name,
      color: area.color,
      teamName: area.teamName,
      members: area._count.members,
      rooms: area.rooms.map((room) => ({ mapRoomId: room.mapRoomId, name: room.name })),
      kpis: area.kpis.map(kpiDto),
    }));
  });

  app.post('/api/areas', async (req) => {
    const actor = await auth(req);
    if (!canManageCompany(actor.membership.role)) throw new HttpError(403, 'Solo el propietario puede crear áreas');
    const body = parseBody(z.object({
      name: z.string().trim().min(2, 'Escribe el nombre del área'),
      color: z.string().trim().default('#F5C518'),
      teamName: z.string().trim().default(''),
      template: z.enum(['general', 'llamadas']).default('general'),
    }), req.body);
    await assertCanAddArea(actor.company.id);
    try {
      const area = await prisma.area.create({
        data: { companyId: actor.company.id, name: body.name, color: body.color, teamName: body.teamName || body.name, template: body.template },
      });
      const zone = await assignFreeZone(actor.company.id, area.id, body.name);
      await audit(actor.company.id, actor.membership.id, 'crear_area', `${actor.membership.name} creó el área ${body.name} y la zona «${zone.name}» en el plano`, { areaId: area.id, mapRoomId: zone.mapRoomId });
      await broadcastPanel(actor.company.id);
      return { ...area, mapRoomId: zone.mapRoomId };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, 'Ya existe un área con ese nombre');
    }
  });

  app.patch('/api/areas/:id', async (req) => {
    const actor = await auth(req);
    const id = (req.params as { id: string }).id;
    const area = await ownArea(actor, id);
    if (actor.membership.role === 'empleado') throw new HttpError(403, 'No puedes editar áreas');
    if (actor.membership.role === 'administrador' && actor.membership.areaId !== area.id) throw new HttpError(403, 'Solo puedes editar tu área');
    const body = parseBody(z.object({
      name: z.string().trim().min(2).optional(),
      color: z.string().trim().optional(),
      teamName: z.string().trim().optional(),
    }), req.body);
    if (actor.membership.role !== 'propietario' && body.name && body.name !== area.name) {
      throw new HttpError(403, 'Solo el propietario puede renombrar áreas');
    }
    return prisma.area.update({ where: { id }, data: body });
  });

  app.delete('/api/areas/:id', async (req) => {
    const actor = await auth(req);
    if (!canManageCompany(actor.membership.role)) throw new HttpError(403, 'Solo el propietario puede borrar áreas');
    const id = (req.params as { id: string }).id;
    await ownArea(actor, id);
    await prisma.area.delete({ where: { id } });
    await audit(actor.company.id, actor.membership.id, 'borrar_area', `${actor.membership.name} eliminó un área`, { areaId: id });
    await broadcastPanel(actor.company.id);
    return { ok: true };
  });

  app.put('/api/areas/:id/kpis', async (req) => {
    const actor = await auth(req);
    const id = (req.params as { id: string }).id;
    const area = await ownArea(actor, id);
    if (actor.membership.role === 'empleado') throw new HttpError(403, 'No puedes definir indicadores');
    if (actor.membership.role === 'administrador' && actor.membership.areaId !== area.id) throw new HttpError(403, 'Solo puedes definir indicadores de tu área');
    const body = parseBody(z.object({
      kpis: z.array(z.object({
        key: z.string().trim().regex(/^[a-z0-9_]+$/, 'La clave solo puede tener minúsculas, números y _'),
        label: z.string().trim().min(2, 'Falta la etiqueta'),
        unit: z.string().trim().default(''),
        targetDaily: z.number().nullable().optional(),
        higherIsBetter: z.boolean().default(true),
      })).max(20),
    }), req.body);
    const keys = new Set<string>();
    for (const kpi of body.kpis) {
      if (keys.has(kpi.key)) throw new HttpError(400, `La clave «${kpi.key}» está repetida`);
      keys.add(kpi.key);
    }
    await prisma.$transaction(async (tx) => {
      const current = await tx.kpiDefinition.findMany({ where: { areaId: id } });
      const keep = new Set(body.kpis.map((kpi) => kpi.key));
      const remove = current.filter((kpi) => !keep.has(kpi.key)).map((kpi) => kpi.id);
      if (remove.length) await tx.kpiDefinition.deleteMany({ where: { id: { in: remove } } });
      for (let index = 0; index < body.kpis.length; index += 1) {
        const kpi = body.kpis[index];
        await tx.kpiDefinition.upsert({
          where: { areaId_key: { areaId: id, key: kpi.key } },
          create: { areaId: id, key: kpi.key, label: kpi.label, unit: kpi.unit, targetDaily: kpi.targetDaily ?? null, higherIsBetter: kpi.higherIsBetter, sort: index },
          update: { label: kpi.label, unit: kpi.unit, targetDaily: kpi.targetDaily ?? null, higherIsBetter: kpi.higherIsBetter, sort: index },
        });
      }
    });
    const kpis = await prisma.kpiDefinition.findMany({ where: { areaId: id }, orderBy: { sort: 'asc' } });
    return kpis.map(kpiDto);
  });

  app.get('/api/puestos', async (req) => {
    const actor = await auth(req);
    return prisma.jobTitle.findMany({ where: { companyId: actor.company.id }, orderBy: { name: 'asc' } });
  });

  app.post('/api/puestos', async (req) => {
    const actor = await auth(req);
    if (!canManageCompany(actor.membership.role)) throw new HttpError(403, 'Solo el propietario puede crear puestos');
    const body = parseBody(z.object({ name: z.string().trim().min(2, 'Escribe el puesto') }), req.body);
    try {
      return await prisma.jobTitle.create({ data: { companyId: actor.company.id, name: body.name } });
    } catch {
      throw new HttpError(409, 'Ese puesto ya existe');
    }
  });

  app.patch('/api/puestos/:id', async (req) => {
    const actor = await auth(req);
    if (!canManageCompany(actor.membership.role)) throw new HttpError(403, 'Solo el propietario puede renombrar puestos');
    const id = (req.params as { id: string }).id;
    const body = parseBody(z.object({ name: z.string().trim().min(2) }), req.body);
    const title = await prisma.jobTitle.findFirst({ where: { id, companyId: actor.company.id } });
    if (!title) throw new HttpError(404, 'Puesto no encontrado');
    return prisma.jobTitle.update({ where: { id }, data: { name: body.name } });
  });

  app.delete('/api/puestos/:id', async (req) => {
    const actor = await auth(req);
    if (!canManageCompany(actor.membership.role)) throw new HttpError(403, 'Solo el propietario puede borrar puestos');
    const id = (req.params as { id: string }).id;
    const title = await prisma.jobTitle.findFirst({ where: { id, companyId: actor.company.id } });
    if (!title) throw new HttpError(404, 'Puesto no encontrado');
    await prisma.jobTitle.delete({ where: { id } });
    return { ok: true };
  });

  app.get('/api/empleados', async (req) => {
    const actor = await auth(req);
    const people = await loadPeople(actor.company.id);
    return people.map((person) => memberDto(actor, person));
  });

  app.get('/api/empleados/plantilla.csv', async (req, reply) => {
    await auth(req);
    const csv = 'nombre,email,rol,puesto,area,telefono,fecha_inicio,horario\nAna Pérez,ana@ejemplo.com,empleado,SDR,Ventas,600000000,2026-01-15,L–V 09:00–18:00\n';
    return reply.header('content-type', 'text/csv; charset=utf-8').send(`\uFEFF${csv}`);
  });

  app.get('/api/empleados/:id', async (req) => {
    const actor = await auth(req);
    const id = (req.params as { id: string }).id;
    const person = await loadPerson(actor.company.id, id);
    const dto = memberDto(actor, person);
    const allowed = canSeeMetrics(ref(actor), { id: person.id, role: person.role, areaId: person.areaId });
    if (!allowed) return dto;
    const today = isoDate();
    const from = addDays(today, -30);
    const reports = await prisma.dailyReport.findMany({
      where: { membershipId: id, date: { gte: from, lte: today } },
      include: { values: { include: { kpi: true } } },
      orderBy: { date: 'asc' },
    });
    const tasks = await prisma.task.findMany({ where: { assigneeId: id } });
    const clocks = await prisma.clockEntry.findMany({ where: { membershipId: id }, orderBy: { clockIn: 'desc' }, take: 15 });
    const presence = await prisma.presenceDay.findMany({ where: { membershipId: id, date: { gte: from } } });
    const badges = await prisma.badge.findMany({ where: { membershipId: id }, orderBy: { earnedAt: 'desc' } });
    const days = workdaysBetween(from, addDays(today, -1));
    const reportDays = new Set(reports.map((r) => r.date).filter((d) => days.includes(d))).size;
    const kpis = person.area?.kpis ?? [];
    const targetPct = averageTarget(kpis, reports.map((r) => ({
      membershipId: id,
      date: r.date,
      values: r.values.map((v) => ({ key: v.kpi.key, value: v.value })),
    })));
    const tasksDone = tasks.filter((t) => t.status === 'hecho').length;
    return {
      ...dto,
      bio: person.bio,
      phone: person.phone,
      schedule: person.schedule,
      startDate: person.startDate,
      points: person.points,
      badges: badges.map((b) => ({ code: b.code, label: b.label, earnedAt: b.earnedAt })),
      score: scoreOf({ workdays: days.length, reportDays, targetPct, tasksDone, tasksTotal: tasks.length }),
      activeHours: Math.round((presence.reduce((sum, row) => sum + row.activeSeconds, 0) / 3600) * 10) / 10,
      tasksDone,
      tasksOpen: tasks.length - tasksDone,
      history: reports.map((r) => ({
        date: r.date,
        note: r.note,
        source: r.source,
        isDemo: r.isDemo,
        values: Object.fromEntries(r.values.map((v) => [v.kpi.key, v.value])),
      })),
      clocks: clocks.map((c) => ({ clockIn: c.clockIn, clockOut: c.clockOut })),
      kpis: kpis.map(kpiDto),
    };
  });

  app.patch('/api/empleados/:id', async (req) => {
    const actor = await auth(req);
    const id = (req.params as { id: string }).id;
    const person = await loadPerson(actor.company.id, id);
    if (!canManagePerson(ref(actor), { id: person.id, role: person.role, areaId: person.areaId })) {
      throw new HttpError(403, 'No puedes editar este perfil');
    }
    const body = parseBody(z.object({
      name: z.string().trim().min(2).optional(),
      phone: z.string().trim().optional(),
      schedule: z.string().trim().optional(),
      bio: z.string().trim().optional(),
      startDate: z.string().nullable().optional(),
      status: z.enum(['en_linea', 'ausente', 'en_reunion', 'cafe', 'en_llamada']).optional(),
      usePhoto: z.boolean().optional(),
      look: z.object({
        skin: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'El color tiene que ser hexadecimal').optional(),
        hair: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'El color tiene que ser hexadecimal').optional(),
        hairStyle: z.number().int().min(0).max(3).optional(),
        shirt: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'El color tiene que ser hexadecimal').optional(),
        pants: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'El color tiene que ser hexadecimal').optional(),
        glasses: z.boolean().optional(),
      }).optional(),
      role: z.enum(['administrador', 'empleado']).optional(),
      areaId: z.string().nullable().optional(),
      jobTitleId: z.string().nullable().optional(),
    }), req.body);
    const self = actor.membership.id === id;
    const data: Record<string, unknown> = {};
    if (body.name) data.name = body.name;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.schedule !== undefined) data.schedule = body.schedule;
    if (body.bio !== undefined) data.bio = body.bio;
    if (body.status) data.status = body.status;
    if (body.usePhoto !== undefined || body.look) {
      const current = parseLook(person.lookJson);
      data.lookJson = JSON.stringify({
        ...current,
        ...(body.look || {}),
        usePhoto: body.usePhoto !== undefined ? body.usePhoto : current.usePhoto,
      });
    }
    if (!self || actor.membership.role === 'propietario') {
      if (body.startDate !== undefined) {
        if (body.startDate && !parseIsoDate(body.startDate)) throw new HttpError(400, 'La fecha de inicio debe ser AAAA-MM-DD');
        data.startDate = body.startDate;
      }
    }
    if (actor.membership.role === 'propietario') {
      if (body.role && person.role !== 'propietario') data.role = body.role;
      if (body.areaId !== undefined) {
        if (body.areaId) {
          const destination = await ownArea(actor, body.areaId);
          if (person.areaId !== body.areaId) {
            await audit(actor.company.id, actor.membership.id, 'mover_persona', `${actor.membership.name} movió a ${person.name} al área ${destination.name}`, { membershipId: id, areaId: body.areaId });
          }
        }
        data.areaId = body.areaId;
      }
      if (body.jobTitleId !== undefined) {
        if (body.jobTitleId) {
          const title = await prisma.jobTitle.findFirst({ where: { id: body.jobTitleId, companyId: actor.company.id } });
          if (!title) throw new HttpError(404, 'Puesto no encontrado');
        }
        data.jobTitleId = body.jobTitleId;
      }
    } else if (actor.membership.role === 'administrador' && !self) {
      if (body.jobTitleId !== undefined) {
        if (body.jobTitleId) {
          const title = await prisma.jobTitle.findFirst({ where: { id: body.jobTitleId, companyId: actor.company.id } });
          if (!title) throw new HttpError(404, 'Puesto no encontrado. Recarga la página: ese puesto ya no existe.');
        }
        data.jobTitleId = body.jobTitleId;
      }
    }
    await prisma.membership.update({ where: { id }, data });
    await broadcastPanel(actor.company.id);
    return memberDto(actor, await loadPerson(actor.company.id, id));
  });

  app.post('/api/empleados/:id/foto', async (req) => {
    const actor = await auth(req);
    const id = (req.params as { id: string }).id;
    const person = await loadPerson(actor.company.id, id);
    if (!canManagePerson(ref(actor), { id: person.id, role: person.role, areaId: person.areaId })) {
      throw new HttpError(403, 'No puedes cambiar esta foto');
    }
    const file = await req.file();
    if (!file) throw new HttpError(400, 'Adjunta una imagen');
    const url = await savePhoto(actor.company.id, id, await file.toBuffer());
    return { photoUrl: url };
  });

  app.post('/api/empleados', async (req) => {
    const actor = await auth(req);
    const body = parseBody(z.object({
      nombre: z.string().trim().min(2, 'Escribe el nombre'),
      email: emailSchema,
      rol: z.enum(['empleado', 'administrador']).default('empleado'),
      area: z.string().trim().default(''),
      puesto: z.string().trim().default(''),
      telefono: z.string().trim().default(''),
      fecha_inicio: z.string().trim().default(''),
      horario: z.string().trim().default(''),
      modo: z.enum(['enlace', 'temporal']).default('enlace'),
      crearFaltantes: z.boolean().default(false),
    }), req.body);
    const result = await importPeople(actor, [{
      fila: 1,
      nombre: body.nombre,
      email: body.email,
      rol: body.rol || 'empleado',
      area: body.area || '',
      puesto: body.puesto || '',
      telefono: body.telefono || '',
      fecha: body.fecha_inicio || '',
      horario: body.horario || '',
    }], { modo: body.modo === 'temporal' ? 'temporal' : 'enlace', crearFaltantes: Boolean(body.crearFaltantes) });
    if (!result.creados.length) throw new HttpError(400, result.errores[0]?.mensaje || 'No se pudo crear la persona');
    await broadcastPanel(actor.company.id);
    return { ...result, csv: activationCsv(result.creados) };
  });

  app.post('/api/empleados/importar', async (req) => {
    const actor = await auth(req);
    const file = await req.file();
    if (!file) throw new HttpError(400, 'Adjunta un CSV o Excel');
    const modoRaw = textField(file.fields, 'modo');
    const crearRaw = textField(file.fields, 'crearFaltantes');
    const modo = modoRaw === 'temporal' ? 'temporal' : 'enlace';
    const crearFaltantes = crearRaw === 'si' || crearRaw === 'true' || crearRaw === '1';
    const bytes = await file.toBuffer();
    const records = file.filename.toLowerCase().endsWith('.csv') || file.mimetype.includes('csv')
      ? parseCsv(bytes.toString('utf8'))
      : await rowsFromExcel(bytes);
    const result = await importPeople(actor, rowsFromRecords(records), { modo, crearFaltantes });
    if (result.creados.length) await broadcastPanel(actor.company.id);
    return result;
  });

  app.put('/api/informes/mio', async (req) => {
    const actor = await auth(req);
    const body = parseBody(z.object({
      date: z.string(),
      note: z.string().default(''),
      metrics: z.record(z.number()),
    }), req.body);
    const date = parseIsoDate(body.date);
    if (!date) throw new HttpError(400, 'La fecha debe ser AAAA-MM-DD');
    return upsertReport({
      companyId: actor.company.id,
      membershipId: actor.membership.id,
      date,
      note: body.note || '',
      metrics: body.metrics,
      source: 'manual',
    });
  });

  app.get('/api/informes/mio', async (req) => {
    const actor = await auth(req);
    const date = parseIsoDate(String((req.query as { date?: string }).date || isoDate()));
    if (!date) throw new HttpError(400, 'Fecha no válida');
    const report = await prisma.dailyReport.findUnique({
      where: { membershipId_date: { membershipId: actor.membership.id, date } },
      include: { values: { include: { kpi: true } } },
    });
    return {
      date,
      note: report?.note ?? '',
      source: report?.source ?? null,
      isDemo: report?.isDemo ?? false,
      values: Object.fromEntries((report?.values ?? []).map((v) => [v.kpi.key, v.value])),
    };
  });

  app.get('/api/informes', async (req) => {
    const actor = await auth(req);
    const query = req.query as { membershipId?: string; from?: string; to?: string };
    const membershipId = query.membershipId || actor.membership.id;
    const person = await loadPerson(actor.company.id, membershipId);
    if (!canSeeMetrics(ref(actor), { id: person.id, role: person.role, areaId: person.areaId })) {
      throw new HttpError(403, 'No puedes ver los informes de esta persona');
    }
    const from = query.from && parseIsoDate(query.from) ? query.from : addDays(isoDate(), -30);
    const to = query.to && parseIsoDate(query.to) ? query.to : isoDate();
    const reports = await prisma.dailyReport.findMany({
      where: { membershipId, date: { gte: from, lte: to } },
      include: { values: { include: { kpi: true } } },
      orderBy: { date: 'asc' },
    });
    return reports.map((r) => ({
      date: r.date,
      note: r.note,
      source: r.source,
      isDemo: r.isDemo,
      values: Object.fromEntries(r.values.map((v) => [v.kpi.key, v.value])),
    }));
  });

  app.post('/api/fichaje/entrada', async (req) => {
    const actor = await auth(req);
    const open = await prisma.clockEntry.findFirst({ where: { membershipId: actor.membership.id, clockOut: null } });
    if (open) return { id: open.id, clockIn: open.clockIn, yaEstabas: true };
    const entry = await prisma.clockEntry.create({ data: { membershipId: actor.membership.id, clockIn: new Date() } });
    await awardBadge(actor.membership.id, 'fichaje', 'Puntual', 2);
    return { id: entry.id, clockIn: entry.clockIn, yaEstabas: false };
  });

  app.post('/api/fichaje/salida', async (req) => {
    const actor = await auth(req);
    const open = await prisma.clockEntry.findFirst({ where: { membershipId: actor.membership.id, clockOut: null }, orderBy: { clockIn: 'desc' } });
    if (!open) throw new HttpError(400, 'No tienes una entrada abierta');
    const entry = await prisma.clockEntry.update({ where: { id: open.id }, data: { clockOut: new Date() } });
    return { id: entry.id, clockIn: entry.clockIn, clockOut: entry.clockOut };
  });

  app.get('/api/fichaje/hoy', async (req) => {
    const actor = await auth(req);
    const open = await prisma.clockEntry.findFirst({ where: { membershipId: actor.membership.id, clockOut: null } });
    return { abierto: Boolean(open), clockIn: open?.clockIn ?? null };
  });

  app.get('/api/panel', async (req) => buildPanel(await auth(req), req.query as { from?: string; to?: string }));

  app.get('/api/panel/export.csv', async (req, reply) => {
    const actor = await auth(req);
    const panel = await buildPanel(actor, req.query as { from?: string; to?: string });
    const lines = ['nombre,email,area,puesto,fecha,metrica,valor,nota,origen,demo'];
    for (const row of panel.exportRows) {
      lines.push([row.nombre, row.email, row.area, row.puesto, row.fecha, row.metrica, row.valor, csvEscape(row.nota), row.origen, row.demo ? 'si' : 'no'].join(','));
    }
    return reply.header('content-type', 'text/csv; charset=utf-8').send(`\uFEFF${lines.join('\n')}\n`);
  });

  app.get('/api/tareas', async (req) => {
    const actor = await auth(req);
    const tasks = await prisma.task.findMany({
      where: taskWhere(actor),
      include: { assignee: true, area: true },
      orderBy: { createdAt: 'desc' },
    });
    return tasks.map(taskDto);
  });

  app.post('/api/tareas', async (req) => {
    const actor = await auth(req);
    if (actor.membership.role === 'empleado') throw new HttpError(403, 'Pide a tu director que cree la tarea');
    const body = parseBody(z.object({
      title: z.string().trim().min(2, 'Escribe el título'),
      description: z.string().default(''),
      areaId: z.string(),
      assigneeId: z.string().nullable().optional(),
      status: z.enum(['pendiente', 'en_curso', 'hecho']).default('pendiente'),
    }), req.body);
    const area = await ownArea(actor, body.areaId);
    if (actor.membership.role === 'administrador' && area.id !== actor.membership.areaId) throw new HttpError(403, 'Solo puedes crear tareas de tu área');
    if (body.assigneeId) await assertAssignee(actor, body.assigneeId, area.id);
    const task = await prisma.task.create({
      data: {
        companyId: actor.company.id,
        areaId: area.id,
        assigneeId: body.assigneeId || null,
        title: body.title,
        description: body.description,
        status: body.status,
        doneAt: body.status === 'hecho' ? new Date() : null,
      },
      include: { assignee: true, area: true },
    });
    if (body.status === 'hecho' && body.assigneeId) await completeTaskPoints(body.assigneeId);
    return taskDto(task);
  });

  app.patch('/api/tareas/:id', async (req) => {
    const actor = await auth(req);
    const id = (req.params as { id: string }).id;
    const task = await prisma.task.findFirst({ where: { id, companyId: actor.company.id } });
    if (!task) throw new HttpError(404, 'Tarea no encontrada');
    const body = parseBody(z.object({
      title: z.string().trim().min(2).optional(),
      description: z.string().optional(),
      status: z.enum(['pendiente', 'en_curso', 'hecho']).optional(),
      assigneeId: z.string().nullable().optional(),
    }), req.body);
    const isAssignee = task.assigneeId === actor.membership.id;
    if (actor.membership.role === 'empleado' && !isAssignee) throw new HttpError(403, 'Solo puedes mover tus tareas');
    if (actor.membership.role === 'administrador' && task.areaId !== actor.membership.areaId) throw new HttpError(403, 'Tarea de otra área');
    if (body.assigneeId) await assertAssignee(actor, body.assigneeId, task.areaId);
    const wasDone = task.status === 'hecho';
    const updated = await prisma.task.update({
      where: { id },
      data: {
        title: body.title,
        description: body.description,
        status: body.status,
        assigneeId: body.assigneeId,
        doneAt: body.status === 'hecho' ? task.doneAt ?? new Date() : body.status ? null : undefined,
      },
      include: { assignee: true, area: true },
    });
    if (!wasDone && updated.status === 'hecho' && updated.assigneeId) await completeTaskPoints(updated.assigneeId);
    if (body.assigneeId && body.assigneeId !== task.assigneeId) {
      await prisma.membership.update({
        where: { id: body.assigneeId },
        data: { currentTaskTitle: updated.title, currentTaskId: updated.id, currentTaskSince: new Date() },
      });
      await audit(actor.company.id, actor.membership.id, 'reasignar_tarea', `${actor.membership.name} reasignó «${updated.title}»`, { taskId: id, assigneeId: body.assigneeId });
    }
    await broadcastPanel(actor.company.id);
    return taskDto(updated);
  });

  app.delete('/api/tareas/:id', async (req) => {
    const actor = await auth(req);
    if (actor.membership.role === 'empleado') throw new HttpError(403, 'No puedes borrar tareas');
    const id = (req.params as { id: string }).id;
    const task = await prisma.task.findFirst({ where: { id, companyId: actor.company.id } });
    if (!task) throw new HttpError(404, 'Tarea no encontrada');
    if (actor.membership.role === 'administrador' && task.areaId !== actor.membership.areaId) throw new HttpError(403, 'Tarea de otra área');
    await prisma.task.delete({ where: { id } });
    return { ok: true };
  });

  app.get('/api/oficina', async (req) => {
    const actor = await auth(req);
    const [rooms, desks, areas, people] = await Promise.all([
      prisma.officeRoom.findMany({ where: { companyId: actor.company.id } }),
      prisma.deskAssignment.findMany({ where: { companyId: actor.company.id } }),
      prisma.area.findMany({ where: { companyId: actor.company.id }, orderBy: { name: 'asc' } }),
      loadPeople(actor.company.id),
    ]);
    const roomById = new Map(rooms.map((room) => [room.mapRoomId, room]));
    const deskById = new Map(desks.map((desk) => [desk.seatId, desk]));
    return {
      rooms: MAP_ROOMS.map((room) => {
        const saved = roomById.get(room.mapRoomId);
        return { mapRoomId: room.mapRoomId, name: saved?.name || room.name, label: saved?.label || room.label, areaId: saved?.areaId || null };
      }),
      desks: MAP_SEATS.map((seatId) => ({ seatId, roomId: roomIdForSeat(seatId), membershipId: deskById.get(seatId)?.membershipId || null })),
      areas: areas.map((area) => ({ id: area.id, name: area.name, color: area.color })),
      people: people.map((person) => ({ id: person.id, name: person.name, photoUrl: photoUrl(person.photoPath), areaId: person.areaId })),
      canEdit: actor.membership.role === 'propietario',
    };
  });

  app.put('/api/oficina/salas/:mapRoomId', async (req) => {
    const actor = await auth(req);
    if (!canManageCompany(actor.membership.role)) throw new HttpError(403, 'Solo el propietario puede editar el mapa');
    const mapRoomId = (req.params as { mapRoomId: string }).mapRoomId;
    if (!MAP_ROOMS.some((room) => room.mapRoomId === mapRoomId)) throw new HttpError(404, 'Sala desconocida');
    const body = parseBody(z.object({
      name: z.string().trim().min(2, 'Escribe el nombre de la sala'),
      label: z.string().trim().default(''),
      areaId: z.string().nullable().optional(),
    }), req.body);
    if (body.areaId) await ownArea(actor, body.areaId);
    const room = await prisma.officeRoom.upsert({
      where: { companyId_mapRoomId: { companyId: actor.company.id, mapRoomId } },
      create: { companyId: actor.company.id, mapRoomId, name: body.name, label: body.label || body.name.toUpperCase(), areaId: body.areaId || null },
      update: { name: body.name, label: body.label || body.name.toUpperCase(), areaId: body.areaId || null },
    });
    return room;
  });

  app.put('/api/oficina/puestos/:seatId', async (req) => {
    const actor = await auth(req);
    if (!canManageCompany(actor.membership.role)) throw new HttpError(403, 'Solo el propietario puede asignar puestos');
    const seatId = (req.params as { seatId: string }).seatId;
    if (!MAP_SEATS.includes(seatId)) throw new HttpError(404, 'Ese asiento no está en el mapa');
    const body = parseBody(z.object({ membershipId: z.string().nullable() }), req.body);
    if (body.membershipId) await loadPerson(actor.company.id, body.membershipId);
    if (body.membershipId) {
      await prisma.deskAssignment.deleteMany({ where: { companyId: actor.company.id, membershipId: body.membershipId, NOT: { seatId } } });
    }
    const desk = await prisma.deskAssignment.upsert({
      where: { companyId_seatId: { companyId: actor.company.id, seatId } },
      create: { companyId: actor.company.id, seatId, membershipId: body.membershipId },
      update: { membershipId: body.membershipId },
    });
    return { seatId: desk.seatId, membershipId: desk.membershipId };
  });

  app.get('/api/oficina/hud', async (req) => {
    const actor = await auth(req);
    const today = isoDate();
    const people = await loadPeople(actor.company.id);
    const reports = await prisma.dailyReport.findMany({
      where: { companyId: actor.company.id, date: today },
      include: { values: { include: { kpi: true } } },
    });
    const rows = reports.map(toRow);
    const sum = (key: string) => aggregateKpi(rows, key).total;
    const tasksOpen = await prisma.task.count({ where: { ...taskWhere(actor), status: { in: ['pendiente', 'en_curso'] } } });
    const pending = await prisma.task.count({ where: { ...taskWhere(actor), status: 'pendiente' } });
    const rank = (key: string, fmt: string) => [...aggregateKpi(rows, key).byMember.entries()]
      .map(([id, value]) => ({ name: shortName(people.find((p) => p.id === id)?.name || ''), value, fmt }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 4);
    const rooms = await prisma.officeRoom.findMany({ where: { companyId: actor.company.id } });
    const desk = await prisma.deskAssignment.findFirst({ where: { companyId: actor.company.id, membershipId: actor.membership.id } });
    const rangeReports = await prisma.dailyReport.findMany({
      where: { companyId: actor.company.id, date: { gte: addDays(today, -21), lte: today } },
      include: { values: { include: { kpi: true } }, membership: true },
    });
    const kpis = await prisma.kpiDefinition.findMany({ where: { area: { companyId: actor.company.id } } });
    const alerts = buildAlerts({
      today,
      people: people.map((p) => ({ id: p.id, name: p.name, areaId: p.areaId })),
      kpis: kpis.map((k) => ({ areaId: k.areaId, key: k.key, label: k.label, targetDaily: k.targetDaily, higherIsBetter: k.higherIsBetter })),
      reports: rangeReports.map(toRow),
    }).filter((alert) => {
      if (actor.membership.role === 'propietario') return true;
      return alert.text.includes(actor.membership.name) || (actor.area ? alert.text.length > 0 && actor.membership.role === 'administrador' : false);
    });
    const filteredAlerts = actor.membership.role === 'administrador'
      ? buildAlerts({
        today,
        people: people.filter((p) => p.areaId === actor.membership.areaId).map((p) => ({ id: p.id, name: p.name, areaId: p.areaId })),
        kpis: kpis.filter((k) => k.areaId === actor.membership.areaId).map((k) => ({ areaId: k.areaId, key: k.key, label: k.label, targetDaily: k.targetDaily, higherIsBetter: k.higherIsBetter })),
        reports: rangeReports.filter((r) => r.membership.areaId === actor.membership.areaId).map(toRow),
      })
      : actor.membership.role === 'empleado'
        ? alerts.filter((alert) => alert.text.includes(actor.membership.name))
        : alerts;
    return {
      officeName: actor.company.officeName,
      companyName: actor.company.name,
      isDemo: actor.company.isDemo,
      stats: {
        ventasHoy: sum('ventas'),
        importeHoy: sum('importe'),
        citasHoy: sum('citas'),
        seguimiento: pending,
        tareasAbiertas: tasksOpen,
        demo: actor.company.isDemo,
      },
      rankings: {
        ventas: { title: 'RANKING HOY', subtitle: 'Importe', rows: rank('importe', '€') },
        citas: { title: 'RANKING CITAS', subtitle: 'Citas', rows: rank('citas', '') },
      },
      rooms: rooms.map((room) => ({ mapRoomId: room.mapRoomId, name: room.name, label: room.label, areaId: room.areaId })),
      deskId: desk?.seatId ?? null,
      directory: people.filter((p) => p.id !== actor.membership.id).map((p) => ({
        id: p.id,
        name: p.name,
        role: p.jobTitle?.name || roleLabel(p.role),
        photoUrl: photoUrl(p.photoPath),
        status: p.status === 'desconectado' ? 'desconectado' : p.status,
        deskId: p.desks[0]?.seatId ?? null,
        look: { ...parseLook(p.lookJson), photoUrl: photoUrl(p.photoPath) },
      })),
      alertCount: filteredAlerts.length,
      media: mediaInfo(),
    };
  });

  app.get('/api/directos', async (req) => {
    const actor = await auth(req);
    return { personas: await directDirectory(actor.company.id, actor.membership.id) };
  });

  app.get('/api/directos/:id', async (req) => {
    const actor = await auth(req);
    const id = (req.params as { id: string }).id;
    return directThread(actor.company.id, actor.membership.id, id);
  });

  app.post('/api/directos/:id', async (req) => {
    const actor = await auth(req);
    const id = (req.params as { id: string }).id;
    const body = parseBody(z.object({
      body: z.string().trim().min(1, 'Escribe un mensaje').max(1000),
    }), req.body);
    const message = await sendDirect(actor.company.id, actor.membership.id, id, body.body);
    pushDirect(actor.company.id, message);
    return message;
  });

  app.get('/api/chat', async (req) => {
    const actor = await auth(req);
    const areaId = (req.query as { areaId?: string }).areaId || '';
    assertChatArea(actor, areaId);
    const messages = await prisma.chatMessage.findMany({
      where: { companyId: actor.company.id, areaId: areaId || null },
      include: { author: true },
      orderBy: { createdAt: 'desc' },
      take: 80,
    });
    return messages.reverse().map(chatDto);
  });

  app.post('/api/chat', async (req) => {
    const actor = await auth(req);
    const body = parseBody(z.object({
      body: z.string().trim().min(1, 'Escribe un mensaje').max(1000),
      areaId: z.string().nullable().optional(),
    }), req.body);
    const areaId = body.areaId || '';
    assertChatArea(actor, areaId);
    const message = await prisma.chatMessage.create({
      data: { companyId: actor.company.id, areaId: areaId || null, membershipId: actor.membership.id, body: body.body },
      include: { author: true },
    });
    return chatDto(message);
  });

  app.get('/api/gamificacion', async (req) => {
    const actor = await auth(req);
    const people = visiblePeople(actor, await loadPeople(actor.company.id));
    const badges = await prisma.badge.findMany({ where: { membershipId: { in: people.map((p) => p.id) } }, include: { membership: true } });
    return {
      me: { points: actor.membership.points, id: actor.membership.id },
      ranking: [...people].sort((a, b) => b.points - a.points).map((p) => ({
        id: p.id, name: p.name, points: p.points, photoUrl: photoUrl(p.photoPath), puesto: p.jobTitle?.name || roleLabel(p.role),
      })),
      badges: badges.map((b) => ({ code: b.code, label: b.label, name: b.membership.name, earnedAt: b.earnedAt })),
    };
  });

  app.get('/api/medios', async (req) => {
    await auth(req);
    return mediaInfo();
  });

  app.post('/api/medios/token', async (req) => {
    const actor = await auth(req);
    const info = mediaInfo();
    if (info.mode !== 'livekit') throw new HttpError(400, info.notice);
    const { AccessToken } = await import('livekit-server-sdk');
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: actor.membership.id,
      name: actor.membership.name,
      ttl: '6h',
    });
    token.addGrant({ roomJoin: true, room: actor.company.id, canPublish: true, canSubscribe: true });
    return { token: await token.toJwt(), url: process.env.LIVEKIT_URL, room: actor.company.id };
  });

  app.get('/api/integraciones', async (req) => {
    const actor = await auth(req);
    if (!canManageCompany(actor.membership.role)) throw new HttpError(403, 'Solo el propietario ve la clave de integración');
    return {
      apiKey: actor.company.apiKey,
      ejemplo: {
        metodo: 'POST',
        ruta: '/api/integraciones/metricas',
        cabecera: 'X-API-Key',
        cuerpo: { email: 'persona@empresa.com', date: isoDate(), metrics: { llamadas: 12 }, note: 'Desde el CRM' },
      },
    };
  });

  app.post('/api/integraciones/rotar', async (req) => {
    const actor = await auth(req);
    if (!canManageCompany(actor.membership.role)) throw new HttpError(403, 'Solo el propietario puede rotar la clave');
    const apiKey = `hx_${randomCode(24)}`;
    await prisma.company.update({ where: { id: actor.company.id }, data: { apiKey } });
    return { apiKey };
  });

  registerOwnerRoutes(app);

  app.post('/api/integraciones/metricas', async (req) => {
    const apiKey = String(req.headers['x-api-key'] || '');
    if (!apiKey) throw new HttpError(401, 'Falta la cabecera X-API-Key');
    const company = await prisma.company.findUnique({ where: { apiKey } });
    if (!company) throw new HttpError(401, 'Clave de integración incorrecta');
    const body = parseBody(z.object({
      email: emailSchema.optional(),
      membershipId: z.string().optional(),
      date: z.string(),
      metrics: z.record(z.number()),
      note: z.string().default(''),
    }), req.body);
    const date = parseIsoDate(body.date);
    if (!date) throw new HttpError(400, 'La fecha debe ser AAAA-MM-DD');
    const member = body.membershipId
      ? await prisma.membership.findFirst({ where: { id: body.membershipId, companyId: company.id } })
      : await prisma.membership.findFirst({ where: { companyId: company.id, user: { email: body.email } } });
    if (!member) throw new HttpError(404, 'No encontramos a esa persona en la empresa');
    const saved = await upsertReport({
      companyId: company.id,
      membershipId: member.id,
      date,
      note: body.note || '',
      metrics: body.metrics,
      source: 'api',
    });
    return { ok: true, ...saved };
  });
}

function mediaInfo() {
  if (process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
    return { mode: 'livekit' as const, notice: 'Audio y vídeo de proximidad con LiveKit.' };
  }
  return {
    mode: 'p2p' as const,
    notice: 'Audio de proximidad en modo directo entre navegadores. Para varias personas a la vez, configura LIVEKIT_URL, LIVEKIT_API_KEY y LIVEKIT_API_SECRET en el servidor.',
  };
}

function kpiDto(kpi: { id: string; key: string; label: string; unit: string; targetDaily: number | null; higherIsBetter: boolean; sort: number }) {
  return { id: kpi.id, key: kpi.key, label: kpi.label, unit: kpi.unit, targetDaily: kpi.targetDaily, higherIsBetter: kpi.higherIsBetter, sort: kpi.sort };
}

function ref(actor: Actor) {
  return { id: actor.membership.id, role: actor.membership.role, areaId: actor.membership.areaId };
}

async function ownArea(actor: Actor, id: string) {
  const area = await prisma.area.findFirst({ where: { id, companyId: actor.company.id } });
  if (!area) throw new HttpError(404, 'Área no encontrada');
  return area;
}

async function loadPeople(companyId: string) {
  return prisma.membership.findMany({
    where: { companyId, active: true },
    include: { area: true, jobTitle: true, user: true, desks: true },
    orderBy: { name: 'asc' },
  });
}

async function loadPerson(companyId: string, id: string) {
  const person = await prisma.membership.findFirst({
    where: { id, companyId, active: true },
    include: { area: { include: { kpis: { orderBy: { sort: 'asc' } } } }, jobTitle: true, user: true, desks: true },
  });
  if (!person) throw new HttpError(404, 'Empleado no encontrado');
  return person;
}

type PersonRow = Awaited<ReturnType<typeof loadPeople>>[number];

function memberDto(actor: Actor, person: PersonRow) {
  const manage = canManagePerson(ref(actor), { id: person.id, role: person.role, areaId: person.areaId });
  const metrics = canSeeMetrics(ref(actor), { id: person.id, role: person.role, areaId: person.areaId });
  return {
    id: person.id,
    name: person.name,
    email: metrics ? person.user.email : undefined,
    role: person.role,
    roleLabel: roleLabel(person.role),
    puesto: person.jobTitle?.name ?? null,
    jobTitleId: person.jobTitleId,
    areaId: person.areaId,
    area: person.area ? { id: person.area.id, name: person.area.name, color: person.area.color } : null,
    phone: manage ? person.phone : undefined,
    schedule: manage ? person.schedule : undefined,
    startDate: manage ? person.startDate : undefined,
    status: person.status,
    points: metrics ? person.points : undefined,
    photoUrl: photoUrl(person.photoPath),
    look: { ...parseLook(person.lookJson), photoUrl: photoUrl(person.photoPath) },
    deskId: person.desks[0]?.seatId ?? null,
  };
}

function publicSession(actor: Actor) {
  return {
    user: { id: actor.userId, email: actor.email },
    membership: {
      id: actor.membership.id,
      name: actor.membership.name,
      role: actor.membership.role,
      roleLabel: roleLabel(actor.membership.role),
      phone: actor.membership.phone,
      schedule: actor.membership.schedule,
      bio: actor.membership.bio,
      startDate: actor.membership.startDate,
      status: actor.membership.status,
      points: actor.membership.points,
      photoUrl: photoUrl(actor.membership.photoPath),
      look: { ...parseLook(actor.membership.lookJson), photoUrl: photoUrl(actor.membership.photoPath) },
      area: actor.area,
      jobTitle: actor.jobTitle,
      company: {
        id: actor.company.id,
        name: actor.company.name,
        officeName: actor.company.officeName,
        slug: actor.company.slug,
        isDemo: actor.company.isDemo,
      },
    },
    debeCambiarContrasena: actor.mustChangePassword,
  };
}

function toRow(report: { membershipId: string; date: string; values: { value: number; kpi: { key: string } }[] }) {
  return {
    membershipId: report.membershipId,
    date: report.date,
    values: report.values.map((v) => ({ key: v.kpi.key, value: v.value })),
  };
}

function averageTarget(kpis: { key: string; targetDaily: number | null; higherIsBetter: boolean }[], reports: { membershipId: string; date: string; values: { key: string; value: number }[] }[]) {
  const targeted = kpis.filter((k) => k.targetDaily != null && k.key !== 'citas_no_presentadas');
  if (!targeted.length || !reports.length) return 0;
  let acc = 0;
  for (const kpi of targeted) {
    const total = aggregateKpi(reports, kpi.key).total;
    const target = (kpi.targetDaily as number) * reports.length;
    if (!kpi.higherIsBetter) acc += target > 0 && total <= target ? 1 : target > 0 ? Math.max(0, 1 - (total - target) / target) : 0;
    else acc += target > 0 ? Math.min(1, total / target) : 0;
  }
  return acc / targeted.length;
}

async function buildPanel(actor: Actor, query: { from?: string; to?: string }) {
  const today = isoDate();
  const from = query.from && parseIsoDate(query.from) ? query.from : addDays(today, -29);
  const to = query.to && parseIsoDate(query.to) ? query.to : today;
  const people = await loadPeople(actor.company.id);
  const visible = visiblePeople(actor, people);
  const visibleIds = new Set(visible.map((p) => p.id));
  const reports = await prisma.dailyReport.findMany({
    where: { companyId: actor.company.id, date: { gte: from, lte: to }, membershipId: { in: [...visibleIds] } },
    include: { values: { include: { kpi: true } }, membership: { include: { user: true, area: true, jobTitle: true } } },
  });
  const areas = await prisma.area.findMany({
    where: {
      companyId: actor.company.id,
      ...(actor.membership.role === 'propietario' ? {} : { id: actor.membership.areaId || '__none__' }),
    },
    include: { kpis: { orderBy: { sort: 'asc' } } },
    orderBy: { name: 'asc' },
  });
  const rows = reports.map(toRow);
  const days = workdaysBetween(from, to === today ? addDays(today, -1) : to);
  const areaBlocks = areas.map((area) => {
    const members = visible.filter((p) => p.areaId === area.id);
    const memberIds = new Set(members.map((p) => p.id));
    const areaReports = rows.filter((r) => memberIds.has(r.membershipId));
    return {
      id: area.id,
      name: area.name,
      color: area.color,
      kpis: area.kpis.map((kpi) => {
        const agg = aggregateKpi(areaReports, kpi.key);
        const target = kpi.targetDaily == null ? null : kpi.targetDaily * Math.max(1, days.length);
        const pct = target == null ? null : kpi.higherIsBetter ? Math.round((agg.total / target) * 100) : target > 0 ? Math.round((target / Math.max(agg.total, 0.0001)) * 100) : null;
        const ranking = [...agg.byMember.entries()]
          .map(([id, value]) => ({ id, name: members.find((m) => m.id === id)?.name || '', photoUrl: photoUrl(members.find((m) => m.id === id)?.photoPath), value }))
          .sort((a, b) => kpi.higherIsBetter ? b.value - a.value : a.value - b.value);
        return { ...kpiDto(kpi), total: Math.round(agg.total * 10) / 10, target, pct, ranking, byDate: Object.fromEntries(agg.byDate) };
      }),
    };
  });
  const kpis = areas.flatMap((a) => a.kpis);
  const alerts = buildAlerts({
    today,
    people: visible.map((p) => ({ id: p.id, name: p.name, areaId: p.areaId })),
    kpis: kpis.map((k) => ({ areaId: k.areaId, key: k.key, label: k.label, targetDaily: k.targetDaily, higherIsBetter: k.higherIsBetter })),
    reports: rows,
  });
  const tasks = await prisma.task.findMany({ where: { companyId: actor.company.id, assigneeId: { in: [...visibleIds] } } });
  const employees = visible.map((person) => {
    const ownReports = rows.filter((r) => r.membershipId === person.id);
    const ownTasks = tasks.filter((t) => t.assigneeId === person.id);
    const reportDays = new Set(ownReports.map((r) => r.date).filter((d) => days.includes(d))).size;
    const targetPct = averageTarget(person.areaId ? kpis.filter((k) => k.areaId === person.areaId) : [], ownReports);
    return {
      id: person.id,
      name: person.name,
      photoUrl: photoUrl(person.photoPath),
      area: person.area?.name ?? null,
      puesto: person.jobTitle?.name ?? roleLabel(person.role),
      points: person.points,
      score: scoreOf({ workdays: days.length, reportDays, targetPct, tasksDone: ownTasks.filter((t) => t.status === 'hecho').length, tasksTotal: ownTasks.length }),
    };
  }).sort((a, b) => b.score - a.score);
  const exportRows = reports.flatMap((report) => report.values.map((value) => ({
    nombre: report.membership.name,
    email: report.membership.user.email,
    area: report.membership.area?.name || '',
    puesto: report.membership.jobTitle?.name || '',
    fecha: report.date,
    metrica: value.kpi.label,
    valor: String(value.value),
    nota: report.note,
    origen: report.source,
    demo: report.isDemo,
  })));
  return { from, to, isDemo: actor.company.isDemo, alerts, areas: areaBlocks, employees, exportRows };
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function taskWhere(actor: Actor) {
  if (actor.membership.role === 'propietario') return { companyId: actor.company.id };
  if (actor.membership.role === 'administrador') return { companyId: actor.company.id, areaId: actor.membership.areaId || '__none__' };
  return { companyId: actor.company.id, OR: [{ assigneeId: actor.membership.id }, { areaId: actor.membership.areaId || '__none__' }] };
}

function taskDto(task: { id: string; title: string; description: string; status: string; areaId: string; assigneeId: string | null; createdAt: Date; area?: { name: string }; assignee?: { name: string } | null }) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    areaId: task.areaId,
    area: task.area?.name ?? null,
    assigneeId: task.assigneeId,
    assignee: task.assignee?.name ?? null,
    createdAt: task.createdAt,
  };
}

async function assertAssignee(actor: Actor, membershipId: string, areaId: string) {
  const person = await loadPerson(actor.company.id, membershipId);
  if (person.areaId !== areaId) throw new HttpError(400, 'La persona no está en esa área');
}

async function completeTaskPoints(membershipId: string) {
  await prisma.membership.update({ where: { id: membershipId }, data: { points: { increment: 8 } } });
  const done = await prisma.task.count({ where: { assigneeId: membershipId, status: 'hecho' } });
  if (done >= 1) await awardBadge(membershipId, 'tarea_hecha', 'Manos a la obra');
}

function assertChatArea(actor: Actor, areaId: string) {
  if (!areaId) return;
  if (actor.membership.role === 'propietario') return;
  if (actor.membership.areaId !== areaId) throw new HttpError(403, 'No puedes entrar al chat de otra área');
}

function shortName(name: string) {
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[1][0]}.`;
}

function chatDto(message: { id: string; body: string; areaId: string | null; createdAt: Date; author: { id: string; name: string; photoPath: string | null } }) {
  return {
    id: message.id,
    body: message.body,
    areaId: message.areaId,
    createdAt: message.createdAt,
    authorId: message.author.id,
    author: message.author.name,
    photoUrl: photoUrl(message.author.photoPath),
  };
}

async function rowsFromExcel(bytes: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, col) => { headers[col] = String(cell.text || '').trim().toLowerCase(); });
  const records: Record<string, string>[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const record: Record<string, string> = {};
    let any = false;
    row.eachCell((cell, col) => {
      const key = headers[col];
      if (!key) return;
      record[key] = String(cell.text || '').trim();
      if (record[key]) any = true;
    });
    if (any) records.push(record);
  });
  return records;
}
