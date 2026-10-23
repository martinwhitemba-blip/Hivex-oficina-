import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { ensurePlans } from '../src/billing';
import { addDays, bumpStreak, streakAsOf, weekStartOf } from '../src/domain';
import { prisma } from '../src/prisma';

let app: FastifyInstance;
const stamp = Date.now().toString(36);

function shift(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function json(method: string, url: string, token?: string, payload?: unknown) {
  const response = await app.inject({
    method: method as 'GET',
    url,
    payload: payload as object | undefined,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const body = response.headers['content-type']?.includes('application/json') ? response.json() : response.body;
  return { status: response.statusCode, body };
}

async function register(name: string, email: string, companyName: string) {
  const created = await json('POST', '/api/auth/registro', undefined, {
    name, email, password: 'clave-segura', companyName,
  });
  expect(created.status).toBe(200);
  return created.body.token as string;
}

async function invite(token: string, email: string, role: string, areaId: string, personName: string) {
  const created = await json('POST', '/api/invitaciones', token, { email, role, areaId });
  expect(created.status).toBe(200);
  const accepted = await json('POST', `/api/invitaciones/${created.body.code}/aceptar`, undefined, {
    name: personName, password: 'clave-segura',
  });
  expect(accepted.status).toBe(200);
  return accepted.body.token as string;
}

describe('semana y racha', () => {
  it('el lunes abre la semana y la racha cuenta días seguidos', () => {
    expect(weekStartOf('2026-10-23')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19');
    expect(bumpStreak({ streakDays: 0, streakLastDate: null }, '2026-10-23')).toEqual({ streakDays: 1, streakLastDate: '2026-10-23' });
    expect(bumpStreak({ streakDays: 3, streakLastDate: '2026-10-22' }, '2026-10-23')).toEqual({ streakDays: 4, streakLastDate: '2026-10-23' });
    expect(bumpStreak({ streakDays: 4, streakLastDate: '2026-10-23' }, '2026-10-23').streakDays).toBe(4);
    expect(bumpStreak({ streakDays: 4, streakLastDate: '2026-10-23' }, '2026-10-21').streakDays).toBe(4);
    expect(bumpStreak({ streakDays: 4, streakLastDate: '2026-10-20' }, '2026-10-23')).toEqual({ streakDays: 1, streakLastDate: '2026-10-23' });
    expect(streakAsOf(['2026-10-21', '2026-10-22', '2026-10-23'], '2026-10-23').streakDays).toBe(3);
    expect(streakAsOf(['2026-10-22'], '2026-10-23')).toEqual({ streakDays: 1, streakLastDate: '2026-10-22' });
    expect(streakAsOf(['2026-10-20'], '2026-10-23').streakDays).toBe(0);
    expect(addDays('2026-10-19', 6)).toBe('2026-10-25');
  });
});

describe('misiones semanales', () => {
  let tokenA = '';
  let tokenB = '';
  let tokenEva = '';
  let tokenNico = '';
  let tokenLucia = '';
  let ventasId = '';
  let soporteId = '';
  let evaId = '';
  let nicoId = '';

  beforeAll(async () => {
    const oldUsers = await prisma.user.findMany({
      where: { email: { endsWith: '@misiones.test' } },
      include: { memberships: true },
    });
    const companyIds = [...new Set(oldUsers.flatMap((user) => user.memberships.map((member) => member.companyId)))];
    if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@misiones.test' } } });
    await ensurePlans();
    app = (await buildApp()).app;
    tokenA = await register('Ana Dueña', `ana-${stamp}@misiones.test`, `Misiones A ${stamp}`);
    tokenB = await register('Beto Dueño', `beto-${stamp}@misiones.test`, `Misiones B ${stamp}`);
    const ventas = await json('POST', '/api/areas', tokenA, { name: 'Ventas', color: '#F5C518' });
    const soporte = await json('POST', '/api/areas', tokenA, { name: 'Soporte', color: '#5EEAD4' });
    ventasId = ventas.body.id;
    soporteId = soporte.body.id;
    tokenEva = await invite(tokenA, `eva-${stamp}@misiones.test`, 'empleado', ventasId, 'Eva Soto');
    tokenNico = await invite(tokenA, `nico-${stamp}@misiones.test`, 'empleado', ventasId, 'Nico Ruiz');
    tokenLucia = await invite(tokenA, `lucia-${stamp}@misiones.test`, 'administrador', ventasId, 'Lucía Fernández');
    evaId = (await json('GET', '/api/auth/yo', tokenEva)).body.membership.id;
    nicoId = (await json('GET', '/api/auth/yo', tokenNico)).body.membership.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('aísla la misión, premia una sola vez y sube la racha', async () => {
    const denied = await json('POST', '/api/misiones', tokenEva, {
      title: 'Misión del área', metric: 'tareas', target: 3, areaId: ventasId,
    });
    expect(denied.status).toBe(403);

    const before = await prisma.membership.findUniqueOrThrow({ where: { id: evaId } });
    const goal = await json('POST', '/api/misiones', tokenA, {
      title: 'Cerrar una carta', metric: 'tareas', target: 1, rewardPoints: 15, membershipId: evaId,
    });
    expect(goal.status).toBe(200);
    expect(goal.body.pct).toBe(0);
    expect((await json('GET', `/api/misiones/${goal.body.id}`, tokenB)).status).toBe(404);

    const hidden = await json('POST', '/api/misiones', tokenA, {
      title: 'Secreto de Nico', metric: 'manual', target: 2, membershipId: nicoId,
    });
    const evaList = await json('GET', '/api/misiones', tokenEva);
    expect(evaList.body.goals.some((item: { id: string }) => item.id === hidden.body.id)).toBe(false);
    expect(evaList.body.goals.some((item: { id: string }) => item.id === goal.body.id)).toBe(true);

    const otherArea = await json('POST', '/api/misiones', tokenLucia, {
      title: 'Fuera de ventas', metric: 'tareas', target: 1, areaId: soporteId,
    });
    expect(otherArea.status).toBe(403);

    const done = await json('POST', '/api/tareas', tokenA, {
      title: 'Carta de la misión', areaId: ventasId, assigneeId: evaId, status: 'hecho',
    });
    expect(done.status).toBe(200);
    const after = await prisma.membership.findUniqueOrThrow({ where: { id: evaId } });
    expect(after.points - before.points).toBe(23);
    expect(after.streakDays).toBe(1);
    const badges = await prisma.badge.count({ where: { membershipId: evaId, code: `mision_${goal.body.id}` } });
    expect(badges).toBe(1);
    const progressed = await json('GET', `/api/misiones/${goal.body.id}`, tokenEva);
    expect(progressed.body.current).toBe(1);
    expect(progressed.body.awarded).toBe(true);
    expect(progressed.body.pct).toBe(100);

    await prisma.membership.update({ where: { id: evaId }, data: { streakDays: 3, streakLastDate: shift(-1) } });
    const again = await json('POST', '/api/tareas', tokenA, {
      title: 'Otra carta', areaId: ventasId, assigneeId: evaId, status: 'hecho',
    });
    expect(again.status).toBe(200);
    const later = await prisma.membership.findUniqueOrThrow({ where: { id: evaId } });
    expect(later.points - after.points).toBe(8);
    expect(later.streakDays).toBe(4);
    expect(await prisma.badge.count({ where: { membershipId: evaId, code: `mision_${goal.body.id}` } })).toBe(1);

    const notices = await json('GET', '/api/notificaciones', tokenEva);
    const missionPings = notices.body.items.filter((item: { kind: string; payload: { code?: string } }) => item.kind === 'achievement' && item.payload.code === `mision_${goal.body.id}`);
    expect(missionPings).toHaveLength(1);
  });

  it('suma el indicador y deja la misión manual en manos de quien la juega', async () => {
    await json('PUT', `/api/areas/${ventasId}/kpis`, tokenA, {
      kpis: [{ key: 'llamadas', label: 'Llamadas', unit: '', targetDaily: 4, higherIsBetter: true }],
    });
    const kpi = await json('POST', '/api/misiones', tokenEva, {
      title: 'Ráfaga de llamadas', metric: 'kpi', target: 4, rewardPoints: 9, membershipId: evaId, kpiKey: 'llamadas',
    });
    expect(kpi.status).toBe(200);
    const report = await json('PUT', '/api/informes/mio', tokenEva, { date: shift(0), note: 'Hoy', metrics: { llamadas: 4 } });
    expect(report.status).toBe(200);
    const hit = await json('GET', `/api/misiones/${kpi.body.id}`, tokenEva);
    expect(hit.body.current).toBe(4);
    expect(hit.body.awarded).toBe(true);
    await json('PUT', '/api/informes/mio', tokenEva, { date: shift(0), note: 'Hoy otra vez', metrics: { llamadas: 6 } });
    const still = await json('GET', `/api/misiones/${kpi.body.id}`, tokenEva);
    expect(still.body.current).toBe(6);
    expect(await prisma.badge.count({ where: { membershipId: evaId, code: `mision_${kpi.body.id}` } })).toBe(1);

    const manual = await json('POST', '/api/misiones', tokenEva, {
      title: 'A pulso', metric: 'manual', target: 2, rewardPoints: 5, membershipId: evaId,
    });
    expect(manual.status).toBe(200);
    const marked = await json('PATCH', `/api/misiones/${manual.body.id}`, tokenEva, { current: 2 });
    expect(marked.body.awarded).toBe(true);
    expect(marked.body.pct).toBe(100);
    await json('PATCH', `/api/misiones/${manual.body.id}`, tokenEva, { current: 3 });
    expect(await prisma.badge.count({ where: { membershipId: evaId, code: `mision_${manual.body.id}` } })).toBe(1);
    expect((await json('PATCH', `/api/misiones/${kpi.body.id}`, tokenEva, { current: 9 })).status).toBe(400);

    const indexes = await prisma.$queryRaw<Array<{ sql: string | null }>>`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'WeeklyGoal'`;
    const blob = indexes.map((index) => index.sql || '').join('\n');
    expect(blob).toMatch(/companyId/);
    expect(blob).toMatch(/weekStart/);
    expect(blob).toMatch(/areaId/);
    expect(blob).toMatch(/membershipId/);
  });
});
