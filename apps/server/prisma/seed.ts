import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { attachPlan, ensurePlans } from '../src/billing';
import { isoDate, lastWorkdays, streakAsOf, weekStartOf } from '../src/domain';
import { env } from '../src/env';
import { hashPassword } from '../src/password';
import { prisma } from '../src/prisma';

const DEMO_SLUG = 'hivex-demo';
const DEMO_PASSWORD = 'hivex-demo';

interface PersonSpec {
  email: string;
  name: string;
  role: 'propietario' | 'administrador' | 'empleado';
  area?: string;
  title?: string;
  desk?: string;
  status?: string;
  task?: string;
  taskMinutes?: number;
  shirt: string;
  skin: string;
  hair: string;
  hairStyle: 0 | 1 | 2 | 3;
  glasses?: boolean;
}

const PEOPLE: PersonSpec[] = [
  { email: 'martin@hivex.demo', name: 'Martin White', role: 'propietario', title: 'Propietario', desk: 'despacho-0', status: 'en_linea', shirt: '#E0A800', skin: '#EFC3A0', hair: '#3B2A20', hairStyle: 0 },
  { email: 'hugo@hivex.demo', name: 'Hugo Peña', role: 'empleado', area: 'Ventas', title: 'Closer', desk: 'atlas-1', status: 'en_llamada', task: 'Llamando a clientes', taskMinutes: 38, shirt: '#2563EB', skin: '#E0AC85', hair: '#1F1A17', hairStyle: 0 },
  { email: 'lucia@hivex.demo', name: 'Lucía Fernández', role: 'administrador', area: 'Ventas', title: 'Director comercial', desk: 'atlas-2', status: 'en_reunion', task: 'Revisando el pipeline', taskMinutes: 55, shirt: '#1F2937', skin: '#F1C7A5', hair: '#5B3A29', hairStyle: 1, glasses: true },
  { email: 'carmen@hivex.demo', name: 'Carmen Ortiz', role: 'empleado', area: 'Ventas', title: 'SDR', desk: 'atlas-0', status: 'en_linea', task: 'Agendando citas', taskMinutes: 22, shirt: '#DB2777', skin: '#F3D2B8', hair: '#B45309', hairStyle: 1 },
  { email: 'diego@hivex.demo', name: 'Diego Navarro', role: 'empleado', area: 'Ventas', title: 'SDR', desk: 'atlas-3', status: 'en_llamada', shirt: '#059669', skin: '#C68B62', hair: '#2B2118', hairStyle: 3 },
  { email: 'raul@hivex.demo', name: 'Raúl Campos', role: 'empleado', area: 'Ventas', title: 'SDR', desk: 'atlas-4', status: 'ausente', shirt: '#64748B', skin: '#EBC0A0', hair: '#A16207', hairStyle: 0 },
  { email: 'martin.soto@hivex.demo', name: 'Martín Soto', role: 'empleado', area: 'Proveeduría', title: 'Compras', desk: 'vega-0', status: 'en_linea', task: 'Buscando proveedores', taskMinutes: 47, shirt: '#EA580C', skin: '#D9A27E', hair: '#6B4F3A', hairStyle: 0 },
  { email: 'luis@hivex.demo', name: 'Luis Romero', role: 'empleado', area: 'Logística', title: 'Operador', desk: 'abierta-0', status: 'en_linea', task: 'Preparando un envío', taskMinutes: 16, shirt: '#0EA5E9', skin: '#C68642', hair: '#111111', hairStyle: 0 },
  { email: 'naomi@hivex.demo', name: 'Naomi Cruz', role: 'administrador', area: 'Recursos Humanos', title: 'People partner', status: 'en_reunion', task: 'Entrevistando a un candidato', taskMinutes: 31, shirt: '#7C3AED', skin: '#F5D0B5', hair: '#111111', hairStyle: 2, glasses: true },
  { email: 'maite@hivex.demo', name: 'Maite León', role: 'empleado', area: 'Facturación', title: 'Analista', status: 'en_linea', task: 'Conciliando facturas', taskMinutes: 64, shirt: '#16A34A', skin: '#F0C9A8', hair: '#7F1D1D', hairStyle: 1 },
  { email: 'sofia@hivex.demo', name: 'Sofía Morales', role: 'empleado', area: 'Marketing', title: 'Analista', desk: 'vega-3', status: 'en_linea', shirt: '#7C3AED', skin: '#F5D0B5', hair: '#111111', hairStyle: 2, glasses: true },
  { email: 'valeria@hivex.demo', name: 'Valeria Castro', role: 'empleado', area: 'Soporte', title: 'Customer Success', desk: 'abierta-2', status: 'en_linea', shirt: '#0EA5E9', skin: '#8D5A3B', hair: '#0F0F0F', hairStyle: 1 },
  { email: 'pablo@hivex.demo', name: 'Pablo Herrera', role: 'empleado', area: 'Soporte', title: 'Especialista', desk: 'abierta-4', status: 'ausente', shirt: '#64748B', skin: '#EBC0A0', hair: '#A16207', hairStyle: 0 },
  { email: 'nuria@hivex.demo', name: 'Nuria Sanz', role: 'empleado', area: 'Finanzas', title: 'Analista', status: 'en_linea', shirt: '#059669', skin: '#E8C3A8', hair: '#3F2E22', hairStyle: 1 },
];

const AREAS: { name: string; color: string; teamName: string; room: string; roomLabel: string; kpis: { key: string; label: string; unit?: string; targetDaily?: number | null; higherIsBetter?: boolean }[] }[] = [
  { name: 'Ventas', color: '#F5C518', teamName: 'Equipo comercial', room: 'atlas', roomLabel: 'VENTAS', kpis: [
    { key: 'llamadas', label: 'Llamadas', targetDaily: 40 },
    { key: 'minutos', label: 'Minutos', unit: 'min', targetDaily: 90 },
    { key: 'citas', label: 'Citas', targetDaily: 5 },
    { key: 'citas_no_presentadas', label: 'Citas sin presentación', targetDaily: null },
    { key: 'ventas', label: 'Ventas', targetDaily: 0.4 },
    { key: 'importe', label: 'Importe', unit: '€', targetDaily: 400 },
  ] },
  { name: 'Proveeduría', color: '#FB923C', teamName: 'Compras', room: 'vega', roomLabel: 'PROVEEDURÍA', kpis: [
    { key: 'pedidos', label: 'Pedidos', targetDaily: 3 },
    { key: 'proveedores', label: 'Proveedores contactados', targetDaily: 5 },
  ] },
  { name: 'Logística', color: '#38BDF8', teamName: 'Envíos', room: 'abierta', roomLabel: 'LOGÍSTICA', kpis: [
    { key: 'envios', label: 'Envíos', targetDaily: 4 },
    { key: 'incidencias', label: 'Incidencias', targetDaily: 1, higherIsBetter: false },
  ] },
  { name: 'Recursos Humanos', color: '#C4B5FD', teamName: 'Personas', room: 'banda-oeste', roomLabel: 'RR. HH.', kpis: [
    { key: 'entrevistas', label: 'Entrevistas', targetDaily: 2 },
    { key: 'altas', label: 'Altas', targetDaily: 1 },
  ] },
  { name: 'Facturación', color: '#86EFAC', teamName: 'Cobros', room: 'banda-este', roomLabel: 'FACTURACIÓN', kpis: [
    { key: 'facturas', label: 'Facturas', targetDaily: 3 },
    { key: 'cobros', label: 'Cobros', unit: '€', targetDaily: 800 },
  ] },
  { name: 'Marketing', color: '#F0ABFC', teamName: 'Marca', room: 'lounge', roomLabel: 'MARKETING', kpis: [
    { key: 'campanas', label: 'Campañas', targetDaily: 1 },
    { key: 'leads', label: 'Leads', targetDaily: 8 },
  ] },
  { name: 'Soporte', color: '#5EEAD4', teamName: 'Atención', room: 'banda-norte', roomLabel: 'SOPORTE', kpis: [
    { key: 'tickets_resueltos', label: 'Tickets resueltos', targetDaily: 6 },
    { key: 'tiempo_respuesta', label: 'Tiempo de respuesta', unit: 'min', targetDaily: 30, higherIsBetter: false },
  ] },
  { name: 'Finanzas', color: '#FDE68A', teamName: 'Control', room: 'banda-sur', roomLabel: 'FINANZAS', kpis: [
    { key: 'asientos', label: 'Asientos', targetDaily: 4 },
    { key: 'cobros', label: 'Cobros', unit: '€', targetDaily: 500 },
  ] },
  { name: 'Operaciones', color: '#93C5FD', teamName: 'Oficina', room: 'reunion', roomLabel: 'OPERACIONES', kpis: [
    { key: 'tareas_internas', label: 'Tareas internas', targetDaily: 4 },
  ] },
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

async function avatar(companyId: string, membershipId: string, name: string, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${color}"/><text x="512" y="640" text-anchor="middle" font-family="Arial, sans-serif" font-size="420" font-weight="700" fill="#0B0B0C">${initials(name)}</text></svg>`;
  const relative = `${companyId}/${membershipId}.png`;
  const absolute = path.join(env.uploadDir, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(absolute);
  return relative;
}

/** Reescribe fotos diminutas de la demo. No borra personas, mensajes ni el código. */
async function refreshSmallPhotos(companyId: string) {
  const people = await prisma.membership.findMany({ where: { companyId }, include: { area: true } });
  let updated = 0;
  for (const person of people) {
    if (!person.photoPath) continue;
    const absolute = path.join(env.uploadDir, person.photoPath);
    let small = !fs.existsSync(absolute);
    if (!small) {
      try {
        const meta = await sharp(absolute).metadata();
        small = (meta.width ?? 0) < 512;
      } catch {
        small = true;
      }
    }
    if (!small) continue;
    await avatar(companyId, person.id, person.name, person.area?.color || '#F5C518');
    updated += 1;
  }
  if (updated) console.log(`Fotos de la demo actualizadas a 1024 px: ${updated}.`);
}

async function main() {
  await ensurePlans();
  const existing = await prisma.company.findUnique({ where: { slug: DEMO_SLUG } });
  if (existing) {
    if (!existing.joinCode) {
      await prisma.company.update({
        where: { id: existing.id },
        data: { joinCode: 'HIVEX2026', joinCodeEnabled: true },
      });
      console.log('Código de acceso de la demo: HIVEX2026.');
    }
    await refreshSmallPhotos(existing.id);
    await ensureBoardExtras(existing.id);
    await ensurePlanningDemo(existing.id);
    await ensureDemoNotices(existing.id);
    await ensureDemoMission(existing.id);
    await ensureDemoStreaks(existing.id);
    console.log('La empresa de demostración ya existe. No se toca: invitaciones, personas y mensajes siguen ahí.');
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const company = await prisma.company.create({
    data: {
      name: 'HIVEX Demo',
      slug: DEMO_SLUG,
      officeName: 'Oficina principal',
      apiKey: 'hx_demo_clave_publica',
      isDemo: true,
      joinCode: 'HIVEX2026',
      joinCodeEnabled: true,
    },
  });
  await attachPlan(company.id, 'empresa', 'activa');

  const areaIds = new Map<string, string>();
  const kpiIds = new Map<string, string>();
  for (const area of AREAS) {
    const created = await prisma.area.create({
      data: { companyId: company.id, name: area.name, color: area.color, teamName: area.teamName, template: 'general' },
    });
    areaIds.set(area.name, created.id);
    await prisma.officeRoom.create({
      data: { companyId: company.id, mapRoomId: area.room, name: area.name, label: area.roomLabel, areaId: created.id },
    });
    for (let index = 0; index < area.kpis.length; index += 1) {
      const kpi = area.kpis[index];
      const row = await prisma.kpiDefinition.create({
        data: {
          areaId: created.id,
          key: kpi.key,
          label: kpi.label,
          unit: kpi.unit || '',
          targetDaily: kpi.targetDaily ?? null,
          higherIsBetter: kpi.higherIsBetter !== false,
          sort: index,
        },
      });
      kpiIds.set(`${area.name}:${kpi.key}`, row.id);
    }
  }

  const titles = new Map<string, string>();
  for (const name of [...new Set(PEOPLE.map((person) => person.title).filter(Boolean))] as string[]) {
    const title = await prisma.jobTitle.create({ data: { companyId: company.id, name } });
    titles.set(name, title.id);
  }

  const memberIds = new Map<string, string>();
  for (const person of PEOPLE) {
    const user = await prisma.user.create({ data: { email: person.email, passwordHash } });
    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        companyId: company.id,
        role: person.role,
        name: person.name,
        areaId: person.area ? areaIds.get(person.area) : null,
        jobTitleId: person.title ? titles.get(person.title) : null,
        status: person.status || 'en_linea',
        startDate: '2025-03-01',
        schedule: 'L–V 09:00–18:00',
        phone: '600 000 000',
        currentTaskTitle: person.task || '',
        currentTaskSince: person.task ? new Date(Date.now() - (person.taskMinutes || 20) * 60 * 1000) : null,
        lookJson: JSON.stringify({
          skin: person.skin, hair: person.hair, hairStyle: person.hairStyle, shirt: person.shirt, pants: '#1F2937',
          glasses: Boolean(person.glasses),
          usePhoto: ['martin@hivex.demo', 'hugo@hivex.demo', 'martin.soto@hivex.demo', 'luis@hivex.demo', 'naomi@hivex.demo', 'maite@hivex.demo'].includes(person.email),
        }),
      },
    });
    const photoPath = await avatar(company.id, membership.id, person.name, person.area ? AREAS.find((area) => area.name === person.area)!.color : '#F5C518');
    await prisma.membership.update({ where: { id: membership.id }, data: { photoPath } });
    memberIds.set(person.email, membership.id);
    if (person.desk) {
      await prisma.deskAssignment.create({ data: { companyId: company.id, seatId: person.desk, membershipId: membership.id } });
    }
  }

  const today = isoDate();
  const days = lastWorkdays(30, addDaysSafe(today, 1)).reverse();
  const skipRaul = new Set(lastWorkdays(4, today));
  const rnd = mulberry32(20261020);
  for (const person of PEOPLE) {
    if (!person.area || person.role === 'propietario') continue;
    const area = AREAS.find((item) => item.name === person.area)!;
    const membershipId = memberIds.get(person.email)!;
    for (const date of days) {
      if (person.email === 'raul@hivex.demo' && skipRaul.has(date)) continue;
      const values: { kpiId: string; value: number }[] = [];
      for (const kpi of area.kpis) {
        const kpiId = kpiIds.get(`${area.name}:${kpi.key}`);
        if (!kpiId) continue;
        let value = kpi.targetDaily == null ? 0 : (kpi.targetDaily || 1) * (0.7 + rnd() * 0.7);
        if (person.email === 'carmen@hivex.demo' && kpi.key === 'citas') value = 8;
        if (person.email === 'carmen@hivex.demo' && kpi.key === 'citas_no_presentadas') value = 6;
        if (person.email === 'pablo@hivex.demo' && kpi.key === 'tickets_resueltos') value = 1;
        if (person.email === 'pablo@hivex.demo' && kpi.key === 'tiempo_respuesta') value = 80;
        if (person.email === 'hugo@hivex.demo' && kpi.key === 'importe') value = 500 + rnd() * 400;
        values.push({ kpiId, value: Math.round(value * 10) / 10 });
      }
      const report = await prisma.dailyReport.create({
        data: {
          companyId: company.id,
          membershipId,
          date,
          note: 'Jornada de demostración. Estas cifras no son reales.',
          source: 'demo',
          isDemo: true,
          pointsAwarded: 10,
          values: { create: values },
        },
      });
      void report;
    }
    const reportCount = days.length - (person.email === 'raul@hivex.demo' ? skipRaul.size : 0);
    await prisma.membership.update({ where: { id: membershipId }, data: { points: reportCount * 10 + (person.task ? 25 : 0) } });
    await prisma.badge.create({ data: { membershipId, code: 'primera_jornada', label: 'Primera jornada' } });
    if (person.email !== 'raul@hivex.demo') {
      await prisma.badge.create({ data: { membershipId, code: 'racha_5', label: 'Racha de 5 jornadas' } });
    }
  }

  const taskSeed = [
    { area: 'Ventas', title: 'Llamando a clientes', assignee: 'hugo@hivex.demo', status: 'en_curso' },
    { area: 'Ventas', title: 'Revisando el pipeline', assignee: 'lucia@hivex.demo', status: 'en_curso' },
    { area: 'Ventas', title: 'Agendando citas', assignee: 'carmen@hivex.demo', status: 'en_curso' },
    { area: 'Proveeduría', title: 'Buscando proveedores', assignee: 'martin.soto@hivex.demo', status: 'en_curso' },
    { area: 'Logística', title: 'Preparando un envío', assignee: 'luis@hivex.demo', status: 'en_curso' },
    { area: 'Recursos Humanos', title: 'Entrevistando a un candidato', assignee: 'naomi@hivex.demo', status: 'en_curso' },
    { area: 'Facturación', title: 'Conciliando facturas', assignee: 'maite@hivex.demo', status: 'en_curso' },
    { area: 'Soporte', title: 'Revisar tickets sin respuesta', assignee: 'pablo@hivex.demo', status: 'pendiente' },
    { area: 'Marketing', title: 'Campaña de octubre', assignee: 'sofia@hivex.demo', status: 'en_curso' },
    { area: 'Finanzas', title: 'Cerrar el mes', assignee: 'nuria@hivex.demo', status: 'pendiente' },
    { area: 'Operaciones', title: 'Ordenar la sala de reuniones', assignee: '', status: 'pendiente' },
  ];
  for (const task of taskSeed) {
    const created = await prisma.task.create({
      data: {
        companyId: company.id,
        areaId: areaIds.get(task.area)!,
        assigneeId: task.assignee ? memberIds.get(task.assignee) : null,
        title: task.title,
        status: task.status,
        description: 'Tarea de la empresa de demostración.',
      },
    });
    if (task.assignee) {
      await prisma.membership.update({
        where: { id: memberIds.get(task.assignee)! },
        data: { currentTaskId: created.id },
      });
    }
  }

  await prisma.chatMessage.createMany({
    data: [
      { companyId: company.id, membershipId: memberIds.get('martin@hivex.demo')!, body: 'Buenos días. El panel del dueño ya muestra en qué está cada persona.' },
      { companyId: company.id, areaId: areaIds.get('Ventas')!, membershipId: memberIds.get('lucia@hivex.demo')!, body: 'Hugo sigue en llamada. Carmen, ojo con las citas que no se presentan.' },
      { companyId: company.id, areaId: areaIds.get('Proveeduría')!, membershipId: memberIds.get('martin.soto@hivex.demo')!, body: 'Estoy buscando proveedores nuevos para el pedido de la semana.' },
    ],
  });

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      actorId: memberIds.get('martin@hivex.demo'),
      action: 'sembrar_demo',
      summary: 'Se cargó la empresa de demostración con áreas, personas y 30 días de métricas ficticias.',
    },
  });

  await ensureBoardExtras(company.id);
  await ensurePlanningDemo(company.id);
  await ensureDemoNotices(company.id);
  await ensureDemoMission(company.id);
  await ensureDemoStreaks(company.id);

  console.log('Empresa demo lista.');
  console.log('Entra con martin@hivex.demo / hivex-demo');
  console.log('También: hugo@, lucia@, carmen@, martin.soto@, luis@, naomi@, maite@ hivex.demo (misma contraseña).');
}

/** Una misión de área para la semana en curso, si todavía no está. */
async function ensureDemoMission(companyId: string) {
  const title = 'Misión de la semana: cerrar cartas';
  const exists = await prisma.weeklyGoal.findFirst({ where: { companyId, title } });
  if (exists) return;
  const area = await prisma.area.findFirst({ where: { companyId, name: 'Ventas' } });
  if (!area) return;
  await prisma.weeklyGoal.create({
    data: {
      companyId,
      areaId: area.id,
      weekStart: weekStartOf(isoDate()),
      metric: 'tareas',
      title,
      target: 5,
      current: 0,
      rewardPoints: 25,
    },
  });
}

/** Rellena la racha solo si esa persona nunca la tuvo. No pisa una racha ya guardada. */
async function ensureDemoStreaks(companyId: string) {
  const people = await prisma.membership.findMany({
    where: { companyId, active: true, streakDays: 0, streakLastDate: null },
    select: { id: true },
  });
  const today = isoDate();
  for (const person of people) {
    const [reports, tasks] = await Promise.all([
      prisma.dailyReport.findMany({ where: { companyId, membershipId: person.id }, select: { date: true } }),
      prisma.task.findMany({
        where: { companyId, assigneeId: person.id, status: 'hecho', doneAt: { not: null } },
        select: { doneAt: true },
      }),
    ]);
    const dates = [
      ...reports.map((report) => report.date),
      ...tasks.map((task) => task.doneAt!.toISOString().slice(0, 10)),
    ];
    if (!dates.length) continue;
    const streak = streakAsOf(dates, today);
    const last = streak.streakLastDate || [...dates].sort().at(-1) || null;
    await prisma.membership.update({
      where: { id: person.id },
      data: { streakDays: streak.streakDays, streakLastDate: last },
    });
  }
}

/** Un aviso de bienvenida si el dueño todavía no tiene ninguno. */
async function ensureDemoNotices(companyId: string) {
  const owner = await prisma.membership.findFirst({ where: { companyId, role: 'propietario', active: true } });
  if (!owner) return;
  const count = await prisma.notification.count({ where: { companyId, recipientId: owner.id } });
  if (count > 0) return;
  const task = await prisma.task.findFirst({ where: { companyId, title: 'Cerrar el tablero de la semana' } });
  await prisma.notification.create({
    data: {
      companyId,
      recipientId: owner.id,
      kind: 'assignment',
      payload: JSON.stringify({ taskId: task?.id || '', title: task?.title || 'La oficina abre el juego' }),
    },
  });
}

/** Añade misiones de ejemplo si todavía no están. No reescribe tareas ya creadas. */
async function ensureBoardExtras(companyId: string) {
  const marker = 'Cerrar el tablero de la semana';
  const exists = await prisma.task.findFirst({ where: { companyId, title: marker } });
  if (exists) return;
  const area = await prisma.area.findFirst({ where: { companyId, name: 'Operaciones' } })
    || await prisma.area.findFirst({ where: { companyId }, orderBy: { name: 'asc' } });
  if (!area) return;
  const owner = await prisma.membership.findFirst({ where: { companyId, role: 'propietario', active: true } });
  const someone = await prisma.membership.findFirst({ where: { companyId, areaId: area.id, active: true } })
    || await prisma.membership.findFirst({ where: { companyId, active: true, role: 'empleado' } });
  const today = new Date();
  const late = new Date(today);
  late.setUTCDate(late.getUTCDate() - 2);
  const soon = new Date(today);
  soon.setUTCDate(soon.getUTCDate() + 1);
  const noon = (date: Date) => new Date(`${date.toISOString().slice(0, 10)}T12:00:00.000Z`);
  const parent = await prisma.task.create({
    data: {
      companyId,
      areaId: area.id,
      assigneeId: someone?.id ?? null,
      createdById: owner?.id ?? null,
      title: marker,
      description: 'Misión de demostración con fecha, prioridad y lista de pasos.',
      status: 'en_curso',
      priority: 'alta',
      dueDate: noon(soon),
      sort: 1,
    },
  });
  await prisma.task.create({
    data: {
      companyId,
      areaId: area.id,
      parentId: parent.id,
      assigneeId: someone?.id ?? null,
      createdById: owner?.id ?? null,
      title: 'Revisar lo que se quedó atrás',
      status: 'pendiente',
      priority: 'media',
      sort: 0,
    },
  });
  await prisma.task.create({
    data: {
      companyId,
      areaId: area.id,
      assigneeId: someone?.id ?? null,
      createdById: owner?.id ?? null,
      title: 'Pedido que ya venció',
      description: 'Para ver el filtro de atrasadas.',
      status: 'pendiente',
      priority: 'alta',
      dueDate: noon(late),
    },
  });
  if (owner && someone && owner.id !== someone.id) {
    await prisma.taskComment.create({
      data: {
        companyId,
        taskId: parent.id,
        authorId: owner.id,
        body: `@${someone.name} esto es una misión, no un trámite.`,
        mentions: JSON.stringify([someone.id]),
      },
    });
  }
}

/** Calendario, regla y formulario de ejemplo. No pisa lo que la empresa ya creó. */
async function ensurePlanningDemo(companyId: string) {
  const marker = 'Preparar la sala de reuniones';
  const area = await prisma.area.findFirst({ where: { companyId, name: 'Ventas' } })
    || await prisma.area.findFirst({ where: { companyId }, orderBy: { name: 'asc' } });
  if (!area) return;
  const hasTask = await prisma.task.findFirst({ where: { companyId, title: marker } });
  if (!hasTask) {
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 3);
    const start = new Date();
    await prisma.task.create({
      data: {
        companyId,
        areaId: area.id,
        title: marker,
        description: 'Ejemplo de cronograma: empieza hoy y vence en tres días.',
        status: 'pendiente',
        priority: 'media',
        startDate: new Date(`${start.toISOString().slice(0, 10)}T12:00:00.000Z`),
        dueDate: new Date(`${soon.toISOString().slice(0, 10)}T12:00:00.000Z`),
        estimateMinutes: 180,
      },
    });
  }
  const ruleName = 'Avisar si la prioridad es alta';
  const hasRule = await prisma.automationRule.findFirst({ where: { companyId, name: ruleName } });
  if (!hasRule) {
    await prisma.automationRule.create({
      data: { companyId, areaId: area.id, name: ruleName, whenKind: 'prioridad_alta', thenKind: 'avisar' },
    });
  }
  const hasForm = await prisma.intakeForm.findFirst({ where: { companyId, title: 'Contacto de Ventas' } });
  if (!hasForm) {
    await prisma.intakeForm.create({
      data: {
        companyId,
        areaId: area.id,
        slug: 'contacto-ventas-demo',
        title: 'Contacto de Ventas',
        intro: 'Déjanos tu nombre y te preparamos el seguimiento.',
        taskTitle: 'Llamar al contacto',
        active: true,
      },
    });
  }
  const hasField = await prisma.customField.findFirst({ where: { companyId, areaId: area.id, label: 'Cliente' } });
  if (!hasField) {
    await prisma.customField.create({
      data: { companyId, areaId: area.id, label: 'Cliente', kind: 'texto' },
    });
  }
}

function addDaysSafe(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
