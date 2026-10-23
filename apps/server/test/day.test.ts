import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { ensurePlans } from '../src/billing';
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

describe('mi día y torre', () => {
  let tokenA = '';
  let tokenB = '';
  let tokenEva = '';
  let tokenLucia = '';
  let ventasId = '';
  let soporteId = '';
  let evaId = '';
  let pabloId = '';
  let companyA = '';

  beforeAll(async () => {
    const oldUsers = await prisma.user.findMany({
      where: { email: { endsWith: '@dia.test' } },
      include: { memberships: true },
    });
    const companyIds = [...new Set(oldUsers.flatMap((user) => user.memberships.map((member) => member.companyId)))];
    if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@dia.test' } } });
    await ensurePlans();
    app = (await buildApp()).app;
    tokenA = await register('Ana Dueña', `ana-${stamp}@dia.test`, `Día A ${stamp}`);
    tokenB = await register('Beto Dueño', `beto-${stamp}@dia.test`, `Día B ${stamp}`);
    ventasId = (await json('POST', '/api/areas', tokenA, { name: 'Ventas', color: '#F5C518' })).body.id;
    soporteId = (await json('POST', '/api/areas', tokenA, { name: 'Soporte', color: '#5EEAD4' })).body.id;
    tokenEva = await invite(tokenA, `eva-${stamp}@dia.test`, 'empleado', ventasId, 'Eva Soto');
    tokenLucia = await invite(tokenA, `lucia-${stamp}@dia.test`, 'administrador', ventasId, 'Lucía Fernández');
    await invite(tokenA, `pablo-${stamp}@dia.test`, 'empleado', soporteId, 'Pablo Herrera');
    const eva = await json('GET', '/api/auth/yo', tokenEva);
    evaId = eva.body.membership.id;
    companyA = eva.body.membership.company.id;
    const people = await json('GET', '/api/empleados', tokenA);
    pabloId = people.body.find((person: { name: string }) => person.name === 'Pablo Herrera').id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('guarda dónde va la foto y no la deja salir de la empresa', async () => {
    const me = await json('GET', '/api/auth/yo', tokenEva);
    expect(me.body.membership.photoPlacement).toBe('cara');
    const saved = await json('PATCH', `/api/empleados/${evaId}`, tokenEva, { photoPlacement: 'gafete' });
    expect(saved.status).toBe(200);
    expect((await json('GET', '/api/auth/yo', tokenEva)).body.membership.photoPlacement).toBe('gafete');
    expect((await json('GET', `/api/empleados/${evaId}`, tokenEva)).body.photoPlacement).toBe('gafete');
    const hud = await json('GET', '/api/oficina/hud', tokenA);
    const eva = hud.body.directory.find((person: { id: string }) => person.id === evaId);
    expect(eva.photoPlacement).toBe('gafete');
    expect((await json('PATCH', `/api/empleados/${evaId}`, tokenB, { photoPlacement: 'cara' })).status).toBe(404);
    await json('PATCH', `/api/empleados/${evaId}`, tokenEva, { photoPlacement: 'cara' });
  });

  it('abre el día en menos de un segundo y la torre no cruza empresas', async () => {
    const today = shift(0);
    await prisma.task.createMany({
      data: Array.from({ length: 200 }, (_, index) => ({
        companyId: companyA,
        areaId: ventasId,
        assigneeId: evaId,
        title: index === 0 ? 'Carta de hoy' : `Carta ${index}`,
        status: index < 3 ? 'hecho' : 'pendiente',
        doneAt: index < 3 ? new Date() : null,
        dueDate: new Date(`${today}T12:00:00.000Z`),
        priority: 'media',
      })),
    });
    const late = await json('POST', '/api/tareas', tokenA, {
      title: 'Carta dormida', areaId: ventasId, assigneeId: evaId, dueDate: shift(-1), priority: 'alta',
    });
    expect(late.status).toBe(200);
    expect((await json('POST', `/api/tareas/${late.body.id}/comentarios`, tokenA, { body: 'Oye @Eva Soto' })).status).toBe(200);
    const hidden = await json('POST', '/api/tareas', tokenA, {
      title: 'Soporte tarde', areaId: soporteId, assigneeId: pabloId, dueDate: shift(-2),
    });
    expect(hidden.status).toBe(200);

    const started = Date.now();
    const day = await json('GET', '/api/mi-dia', tokenEva);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(day.status).toBe(200);
    expect(day.body.todayTasks.some((task: { title: string }) => task.title === 'Carta de hoy')).toBe(true);
    expect(day.body.todayTasks.length).toBe(200);
    expect(day.body.weekTasks.length).toBeGreaterThanOrEqual(200);
    expect(day.body.overdue.some((task: { title: string }) => task.title === 'Carta dormida')).toBe(true);
    expect(day.body.overdue.some((task: { title: string }) => task.title === 'Soporte tarde')).toBe(false);
    expect(day.body.mentions.some((item: { payload: { title?: string } }) => item.payload.title === 'Carta dormida')).toBe(true);
    expect(day.body.rank.place).toBe(1);
    expect(day.body.rank.doneThisWeek).toBeGreaterThanOrEqual(3);
    expect(day.body.mirror.rankPlace).toBe(day.body.rank.place);
    expect(day.body.mirror.overdueCount).toBe(day.body.overdue.length);
    expect(day.body.mirror.points).toBe(day.body.points);

    expect((await json('GET', '/api/torre', tokenEva)).status).toBe(403);
    const tower = await json('GET', '/api/torre', tokenA);
    expect(tower.status).toBe(200);
    expect(tower.body.overdue.some((task: { title: string }) => task.title === 'Carta dormida')).toBe(true);
    expect(tower.body.overdue.some((task: { title: string }) => task.title === 'Soporte tarde')).toBe(true);
    expect(tower.body.ranking[0].id).toBe(evaId);
    const areaTower = await json('GET', '/api/torre', tokenLucia);
    expect(areaTower.body.overdue.some((task: { title: string }) => task.title === 'Soporte tarde')).toBe(false);
    expect(areaTower.body.overdue.some((task: { title: string }) => task.title === 'Carta dormida')).toBe(true);
    const foreign = await json('GET', '/api/torre', tokenB);
    expect(foreign.body.overdue.some((task: { title: string }) => task.title === 'Carta dormida')).toBe(false);
    const foreignDay = await json('GET', '/api/mi-dia', tokenB);
    expect(foreignDay.body.todayTasks.some((task: { title: string }) => task.title === 'Carta de hoy')).toBe(false);
  });
});
