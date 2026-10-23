import { translate, type MessageKey } from '../../../packages/i18n/src/index';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCanAddArea, attachPlan, audit, companyUsage, PLAN_DEFS } from './billing';
import { canManageCompany } from './domain';
import { actorFromRequest, HttpError, parseBody } from './http';
import { collectOnline, broadcastPanel, filterOwner } from './socket';
import { ownerSnapshot } from './ownerSnapshot';
import { payments } from './payments';
import { prisma } from './prisma';
import { assignFreeZone } from './zones';

function planText(locale: Parameters<typeof translate>[0], code: string, field: 'name' | 'description') {
  const key = `plans.${code}.${field}` as MessageKey;
  return translate(locale, key);
}

export function registerOwnerRoutes(app: FastifyInstance) {
  app.get('/api/dueno', async (req) => {
    const actor = await actorFromRequest(req);
    if (actor.membership.role === 'empleado') throw new HttpError(403, 'El panel del dueño es para propietario y directores');
    const snap = await ownerSnapshot(actor.company.id, collectOnline(actor.company.id));
    return actor.membership.role === 'administrador' ? filterOwner(snap, actor.membership.areaId) : snap;
  });

  app.get('/api/dueno/auditoria', async (req) => {
    const actor = await actorFromRequest(req);
    if (actor.membership.role === 'empleado') throw new HttpError(403, 'No puedes ver la auditoría');
    const rows = await prisma.auditLog.findMany({
      where: { companyId: actor.company.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    return rows;
  });

  app.post('/api/dueno/tareas/:id/reasignar', async (req) => {
    const actor = await actorFromRequest(req);
    if (actor.membership.role === 'empleado') throw new HttpError(403, 'No puedes reasignar tareas');
    const id = (req.params as { id: string }).id;
    const body = parseBody(z.object({ assigneeId: z.string() }), req.body);
    const task = await prisma.task.findFirst({ where: { id, companyId: actor.company.id }, include: { area: true, assignee: true } });
    if (!task) throw new HttpError(404, 'Tarea no encontrada');
    if (actor.membership.role === 'administrador' && task.areaId !== actor.membership.areaId) {
      throw new HttpError(403, 'Esa tarea es de otra área');
    }
    const next = await prisma.membership.findFirst({ where: { id: body.assigneeId, companyId: actor.company.id, active: true } });
    if (!next) throw new HttpError(404, 'Persona no encontrada');
    if (actor.membership.role === 'administrador' && next.areaId !== actor.membership.areaId) {
      throw new HttpError(403, 'Solo puedes asignar dentro de tu área');
    }
    await prisma.task.update({ where: { id }, data: { assigneeId: next.id, status: task.status === 'pendiente' ? 'en_curso' : task.status } });
    if (task.assigneeId && task.assigneeId !== next.id) {
      await prisma.membership.updateMany({
        where: { id: task.assigneeId, currentTaskId: task.id },
        data: { currentTaskTitle: '', currentTaskId: null, currentTaskSince: null },
      });
    }
    await prisma.membership.update({
      where: { id: next.id },
      data: { currentTaskTitle: task.title, currentTaskId: task.id, currentTaskSince: new Date(), status: 'en_linea' },
    });
    const summary = `${actor.membership.name} reasignó «${task.title}» a ${next.name}`;
    await audit(actor.company.id, actor.membership.id, 'reasignar_tarea', summary, { taskId: task.id, assigneeId: next.id });
    await broadcastPanel(actor.company.id);
    return { ok: true, summary };
  });

  app.post('/api/dueno/personas/:id/area', async (req) => {
    const actor = await actorFromRequest(req);
    if (!canManageCompany(actor.membership.role)) throw new HttpError(403, 'Solo el propietario mueve personas de área');
    const id = (req.params as { id: string }).id;
    const body = parseBody(z.object({ areaId: z.string() }), req.body);
    const person = await prisma.membership.findFirst({ where: { id, companyId: actor.company.id }, include: { area: true } });
    if (!person) throw new HttpError(404, 'Persona no encontrada');
    if (person.role === 'propietario') throw new HttpError(400, 'El propietario no se mueve de área desde aquí');
    const area = await prisma.area.findFirst({ where: { id: body.areaId, companyId: actor.company.id } });
    if (!area) throw new HttpError(404, 'Área no encontrada');
    await prisma.membership.update({ where: { id }, data: { areaId: area.id } });
    const summary = `${actor.membership.name} movió a ${person.name} de ${person.area?.name ?? 'sin área'} a ${area.name}`;
    await audit(actor.company.id, actor.membership.id, 'mover_persona', summary, { membershipId: id, areaId: area.id });
    await broadcastPanel(actor.company.id);
    return { ok: true, summary };
  });

  app.get('/api/plan', async (req) => {
    const actor = await actorFromRequest(req);
    const usage = await companyUsage(actor.company.id);
    return {
      uso: { personas: usage.workers, areas: usage.areas, maxPersonas: usage.maxWorkers, maxAreas: usage.maxAreas },
      actual: { code: usage.plan.code, name: planText(actor.locale, usage.plan.code, 'name'), status: usage.status, trialEndsAt: usage.trialEndsAt, description: planText(actor.locale, usage.plan.code, 'description'), limite: usage.customMaxWorkers },
      planes: PLAN_DEFS.map((plan) => ({ ...plan, name: planText(actor.locale, plan.code, 'name'), description: planText(actor.locale, plan.code, 'description') })),
      pago: { proveedor: payments.kind, mensaje: translate(actor.locale, 'plan.billing') },
    };
  });

  app.post('/api/plan', async (req) => {
    const actor = await actorFromRequest(req);
    if (!canManageCompany(actor.membership.role)) throw new HttpError(403, 'Solo el propietario cambia el plan');
    const body = parseBody(z.object({
      code: z.enum(['starter', 'pro', 'empresa', 'grupo']),
      limite: z.number().int().min(101, 'El límite propio empieza por encima de 100').max(5000).optional(),
    }), req.body);
    const plan = await attachPlan(actor.company.id, body.code, 'activa', body.limite);
    const summary = `${actor.membership.name} dejó el plan en ${plan.name} sin cobro (la pasarela llegará después)`;
    await audit(actor.company.id, actor.membership.id, 'cambiar_plan', summary, { code: body.code });
    return { ok: true, summary };
  });

  app.get('/api/captacion', async (req) => {
    const actor = await actorFromRequest(req);
    const [leads, campaigns, calls, area] = await Promise.all([
      prisma.lead.count({ where: { companyId: actor.company.id } }),
      prisma.campaign.count({ where: { companyId: actor.company.id } }),
      prisma.call.count({ where: { companyId: actor.company.id } }),
      prisma.area.findFirst({ where: { companyId: actor.company.id, template: 'llamadas' } }),
    ]);
    return {
      proximamente: true,
      activo: actor.company.moduloLlamadas,
      area: area ? { id: area.id, name: area.name } : null,
      contadores: { leads, campaigns, calls },
      mensaje: translate(actor.locale, 'leads.message'),
      extensiones: [
        translate(actor.locale, 'leads.ext.provider'),
        translate(actor.locale, 'leads.ext.routing'),
        translate(actor.locale, 'leads.ext.models'),
      ],
    };
  });

  app.post('/api/captacion/activar', async (req) => {
    const actor = await actorFromRequest(req);
    if (!canManageCompany(actor.membership.role)) throw new HttpError(403, 'Solo el propietario activa el módulo');
    const existing = await prisma.area.findFirst({ where: { companyId: actor.company.id, template: 'llamadas' } });
    let area = existing;
    if (!area) {
      await assertCanAddArea(actor.company.id);
      area = await prisma.area.create({
        data: { companyId: actor.company.id, name: 'Llamadas', color: '#93C5FD', teamName: 'Captación', template: 'llamadas' },
      });
      await assignFreeZone(actor.company.id, area.id, 'Llamadas');
      await prisma.kpiDefinition.createMany({
        data: [
          { areaId: area.id, key: 'llamadas', label: 'Llamadas', targetDaily: 40, sort: 0 },
          { areaId: area.id, key: 'leads', label: 'Leads', targetDaily: 8, sort: 1 },
        ],
      });
    }
    await prisma.company.update({ where: { id: actor.company.id }, data: { moduloLlamadas: true } });
    await audit(actor.company.id, actor.membership.id, 'activar_llamadas', `${actor.membership.name} activó el área Llamadas (el marcador sigue en preparación)`, { areaId: area.id });
    await broadcastPanel(actor.company.id);
    return { ok: true, areaId: area.id, proximamente: true };
  });
}
