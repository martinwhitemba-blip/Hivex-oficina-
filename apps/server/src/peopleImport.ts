import { companyUsage } from './billing';
import { pickField, randomCode } from './domain';
import type { Actor } from './http';
import { HttpError } from './http';
import { MAP_SEATS, roomIdForSeat } from './mapCatalog';
import { hashPassword } from './password';
import { prisma } from './prisma';
import { assignFreeZone } from './zones';

const BATCH = 40;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ImportSourceRow {
  fila: number;
  nombre: string;
  email: string;
  rol: string;
  area: string;
  puesto: string;
  telefono: string;
  fecha: string;
  horario: string;
}

export interface CreatedPerson {
  fila: number;
  nombre: string;
  email: string;
  rol: string;
  enlace: string;
  contrasena: string;
  area: string;
  puesto: string;
  deskId: string | null;
}

export interface ImportIssue {
  fila: number;
  email: string;
  mensaje: string;
}

export function rowsFromRecords(records: Record<string, string>[], start = 2): ImportSourceRow[] {
  return records.map((row, index) => ({
    fila: start + index,
    nombre: pickField(row, ['nombre', 'name']),
    email: pickField(row, ['email', 'correo']).toLowerCase(),
    rol: pickField(row, ['rol', 'role']).toLowerCase(),
    area: pickField(row, ['area', 'área']),
    puesto: pickField(row, ['puesto', 'cargo']),
    telefono: pickField(row, ['telefono', 'teléfono', 'phone']),
    fecha: pickField(row, ['fecha_inicio', 'inicio']),
    horario: pickField(row, ['horario', 'schedule']),
  }));
}

export function activationCsv(people: CreatedPerson[]) {
  const lines = ['nombre,email,rol,area,puesto,enlace,contrasena_temporal'];
  for (const person of people) {
    lines.push([
      cell(person.nombre),
      cell(person.email),
      cell(person.rol),
      cell(person.area),
      cell(person.puesto),
      cell(person.enlace),
      cell(person.contrasena),
    ].join(','));
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

export async function importPeople(
  actor: Actor,
  rows: ImportSourceRow[],
  options: { modo: 'enlace' | 'temporal'; crearFaltantes: boolean },
) {
  if (actor.membership.role === 'empleado') throw new HttpError(403, 'No puedes dar de alta personas');
  const issues: ImportIssue[] = [];
  const pending: ImportSourceRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const problem = validateRow(row, actor);
    if (problem) {
      issues.push({ fila: row.fila, email: row.email, mensaje: problem });
      continue;
    }
    if (seen.has(row.email)) {
      issues.push({ fila: row.fila, email: row.email, mensaje: 'Ese correo está repetido en el archivo' });
      continue;
    }
    seen.add(row.email);
    pending.push(row);
  }

  const emails = pending.map((row) => row.email);
  const users = emails.length
    ? await prisma.user.findMany({ where: { email: { in: emails } }, include: { memberships: true } })
    : [];
  const byEmail = new Map(users.map((user) => [user.email, user]));
  const ready: ImportSourceRow[] = [];
  for (const row of pending) {
    const user = byEmail.get(row.email);
    if (user?.memberships.some((membership) => membership.companyId === actor.company.id)) {
      issues.push({ fila: row.fila, email: row.email, mensaje: 'Ese correo ya está en tu empresa' });
      continue;
    }
    if (user?.memberships.some((membership) => membership.companyId !== actor.company.id)) {
      issues.push({ fila: row.fila, email: row.email, mensaje: 'Ese correo ya pertenece a otra empresa' });
      continue;
    }
    ready.push(row);
  }

  const company = await prisma.company.findUnique({ where: { id: actor.company.id }, select: { isDemo: true } });
  const usage = await companyUsage(actor.company.id);
  const workerRoom = company?.isDemo ? Number.POSITIVE_INFINITY : Math.max(0, usage.maxWorkers - usage.workers);
  const areaRoom = company?.isDemo ? Number.POSITIVE_INFINITY : Math.max(0, usage.maxAreas - usage.areas);
  const planMessage = `Tu plan ${usage.plan.name} permite hasta ${usage.maxWorkers} personas y ya estás en el límite. Entra en Plan y uso para verlo. El cobro en línea todavía no está conectado.`;
  const areaMessage = `Tu plan ${usage.plan.name} permite hasta ${usage.maxAreas} áreas y ya estás en el límite. Entra en Plan y uso para verlo. El cobro en línea todavía no está conectado.`;

  const areas = await prisma.area.findMany({ where: { companyId: actor.company.id } });
  const titles = await prisma.jobTitle.findMany({ where: { companyId: actor.company.id } });
  const areaByName = new Map(areas.map((area) => [norm(area.name), area]));
  const titleByName = new Map(titles.map((title) => [norm(title.name), title]));

  const accepted: ImportSourceRow[] = [];
  let slots = workerRoom;
  let newAreas = 0;
  const areaNamesToCreate = new Set<string>();
  for (const row of ready) {
    if (slots <= 0) {
      issues.push({ fila: row.fila, email: row.email, mensaje: planMessage });
      continue;
    }
    if (row.area && !areaByName.has(norm(row.area)) && !areaNamesToCreate.has(norm(row.area))) {
      if (!options.crearFaltantes) {
        issues.push({ fila: row.fila, email: row.email, mensaje: `El área «${row.area}» no existe. Marca la opción para crearla.` });
        continue;
      }
      if (actor.membership.role !== 'propietario') {
        issues.push({ fila: row.fila, email: row.email, mensaje: 'Solo el propietario puede crear áreas al importar' });
        continue;
      }
      if (newAreas >= areaRoom) {
        issues.push({ fila: row.fila, email: row.email, mensaje: areaMessage });
        continue;
      }
      areaNamesToCreate.add(norm(row.area));
      newAreas += 1;
    }
    if (row.puesto && !titleByName.has(norm(row.puesto)) && !options.crearFaltantes) {
      issues.push({ fila: row.fila, email: row.email, mensaje: `El puesto «${row.puesto}» no existe. Marca la opción para crearlo.` });
      continue;
    }
    accepted.push(row);
    slots -= 1;
  }

  for (const name of areaNamesToCreate) {
    const label = accepted.find((row) => norm(row.area) === name)?.area || name;
    const area = await prisma.area.create({
      data: { companyId: actor.company.id, name: label, teamName: label, color: '#F5C518' },
    });
    await assignFreeZone(actor.company.id, area.id, label);
    areaByName.set(name, area);
  }
  const titleNames = new Set<string>();
  for (const row of accepted) {
    if (row.puesto && !titleByName.has(norm(row.puesto))) titleNames.add(norm(row.puesto));
  }
  for (const name of titleNames) {
    const label = accepted.find((row) => norm(row.puesto) === name)?.puesto || name;
    const title = await prisma.jobTitle.create({ data: { companyId: actor.company.id, name: label } });
    titleByName.set(name, title);
  }

  const taken = new Set((await prisma.deskAssignment.findMany({
    where: { companyId: actor.company.id },
    select: { seatId: true },
  })).map((row) => row.seatId));
  const rooms = await prisma.officeRoom.findMany({ where: { companyId: actor.company.id } });
  const seatsByArea = new Map<string, string[]>();
  for (const room of rooms) {
    if (!room.areaId) continue;
    const seats = MAP_SEATS.filter((seat) => roomIdForSeat(seat) === room.mapRoomId);
    seatsByArea.set(room.areaId, [...(seatsByArea.get(room.areaId) || []), ...seats]);
  }

  const created: CreatedPerson[] = [];
  for (let offset = 0; offset < accepted.length; offset += BATCH) {
    const slice = accepted.slice(offset, offset + BATCH);
    const secrets = await Promise.all(slice.map(async (row) => ({
      row,
      password: options.modo === 'temporal' ? `Hivex-${randomCode(6)}` : randomCode(18),
      hash: '',
      code: options.modo === 'enlace' ? randomCode(10) : '',
    })));
    await Promise.all(secrets.map(async (item) => { item.hash = await hashPassword(item.password); }));
    const batch: CreatedPerson[] = [];
    await prisma.$transaction(async (tx) => {
      for (const item of secrets) {
        const row = item.row;
        let user = byEmail.get(row.email);
        if (!user) {
          const made = await tx.user.create({
            data: {
              email: row.email,
              passwordHash: item.hash,
              mustChangePassword: options.modo === 'temporal',
            },
          });
          user = { ...made, memberships: [] };
          byEmail.set(row.email, user);
        } else {
          await tx.user.update({
            where: { id: user.id },
            data: { passwordHash: item.hash, mustChangePassword: options.modo === 'temporal' },
          });
        }
        const areaId = row.area
          ? areaByName.get(norm(row.area))?.id ?? null
          : actor.membership.role === 'administrador' ? actor.membership.areaId : null;
        const titleId = row.puesto ? titleByName.get(norm(row.puesto))?.id ?? null : null;
        const membership = await tx.membership.create({
          data: {
            userId: user.id,
            companyId: actor.company.id,
            role: row.rol === 'administrador' ? 'administrador' : 'empleado',
            name: row.nombre,
            areaId,
            jobTitleId: titleId,
            phone: row.telefono,
            startDate: row.fecha || null,
            schedule: row.horario || 'L–V 09:00–18:00',
            status: 'desconectado',
            lookJson: JSON.stringify({ skin: '#F3D2B8', hair: '#5B3A29', hairStyle: 1, shirt: '#2563EB', pants: '#1F2937' }),
          },
        });
        let deskId: string | null = null;
        if (areaId) {
          const pool = seatsByArea.get(areaId) || [];
          const seat = pool.find((id) => !taken.has(id));
          if (seat) {
            taken.add(seat);
            await tx.deskAssignment.create({ data: { companyId: actor.company.id, seatId: seat, membershipId: membership.id } });
            deskId = seat;
          }
        }
        let enlace = '';
        if (options.modo === 'enlace') {
          await tx.activation.create({
            data: {
              code: item.code,
              companyId: actor.company.id,
              userId: user.id,
              membershipId: membership.id,
              expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
            },
          });
          enlace = `#/activar?code=${item.code}`;
        }
        batch.push({
          fila: row.fila,
          nombre: row.nombre,
          email: row.email,
          rol: membership.role,
          enlace,
          contrasena: options.modo === 'temporal' ? item.password : '',
          area: row.area,
          puesto: row.puesto,
          deskId,
        });
      }
    });
    created.push(...batch);
  }

  return { creados: created, errores: issues, csv: activationCsv(created) };
}

function validateRow(row: ImportSourceRow, actor: Actor) {
  if (!row.nombre || row.nombre.trim().length < 2) return 'Escribe el nombre';
  if (!EMAIL.test(row.email)) return 'El correo no es válido';
  const rol = row.rol || 'empleado';
  if (rol !== 'empleado' && rol !== 'administrador') return 'El rol tiene que ser empleado o administrador';
  row.rol = rol;
  if (rol === 'administrador' && actor.membership.role !== 'propietario') return 'Un director solo puede dar de alta empleados';
  if (row.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(row.fecha)) return 'La fecha de inicio debe ser AAAA-MM-DD';
  if (actor.membership.role === 'administrador') {
    if (row.area && norm(row.area) !== norm(actor.area?.name || '')) return 'Solo puedes dar de alta personas de tu área';
  }
  return '';
}

function norm(value: string) {
  return value.trim().toLocaleLowerCase('es');
}

function cell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
