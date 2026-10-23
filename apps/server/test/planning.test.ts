import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { ensurePlans } from '../src/billing';
import { dependencyCycle, draftStatus, mondayOf, ruleMatches, workload } from '../src/planningLogic';
import { prisma } from '../src/prisma';

describe('planificación', () => {
  it('rechaza un círculo de dependencias', () => {
    const edges = [{ taskId: 'b', dependsOnId: 'c' }, { taskId: 'c', dependsOnId: 'a' }];
    expect(dependencyCycle(edges, 'a', 'b')).toBe(true);
    expect(dependencyCycle([], 'a', 'a')).toBe(true);
    expect(dependencyCycle(edges, 'a', 'd')).toBe(false);
  });

  it('suma la carga y marca lo atrasado', () => {
    const rows = workload(
      [{ id: 'ana', name: 'Ana' }, { id: 'luis', name: 'Luis' }],
      [
        { assigneeId: 'ana', status: 'pendiente', estimateMinutes: 90, dueDate: '2020-01-01' },
        { assigneeId: 'ana', status: 'hecho', estimateMinutes: 500, dueDate: '2020-01-01' },
        { assigneeId: 'luis', status: 'en_curso', estimateMinutes: 30, dueDate: '2099-01-01' },
      ],
      '2026-10-23',
    );
    expect(rows[0]).toMatchObject({ id: 'ana', openMinutes: 90, openTasks: 1, overdue: 1 });
    expect(rows[1]).toMatchObject({ id: 'luis', overdue: 0 });
  });

  it('redacta el estado de la semana', () => {
    const late = draftStatus({ areaName: 'Ventas', done: 1, open: 4, overdue: 3, missionPct: 20 });
    expect(late.health).toBe('atrasado');
    expect(late.text).toContain('Ventas');
    expect(late.text).toContain('20');
    expect(draftStatus({ areaName: 'Café', done: 2, open: 0, overdue: 0, missionPct: null }).health).toBe('al_dia');
  });

  it('la regla de prioridad alta solo salta al crear o al subirla', () => {
    const rule = { whenKind: 'prioridad_alta', areaId: 'ventas' };
    expect(ruleMatches(rule, { kind: 'tarea_creada', areaId: 'ventas', priority: 'alta' })).toBe(true);
    expect(ruleMatches(rule, { kind: 'tarea_creada', areaId: 'ventas', priority: 'baja' })).toBe(false);
    expect(ruleMatches(rule, { kind: 'tarea_creada', areaId: 'otra', priority: 'alta' })).toBe(false);
    expect(mondayOf('2026-10-23')).toBe('2026-10-19');
  });
});

describe('planificación de la empresa', () => {
  let app: FastifyInstance;
  let tokenA = '';
  let tokenB = '';
  let areaA = '';
  const stamp = Date.now().toString(36);

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

  beforeAll(async () => {
    await ensurePlans();
    app = (await buildApp()).app;
    const a = await json('POST', '/api/auth/registro', undefined, {
      name: 'Ana Plan', email: `ana-${stamp}@plan.test`, password: 'clave-segura', companyName: `Plan A ${stamp}`,
    });
    const b = await json('POST', '/api/auth/registro', undefined, {
      name: 'Beto Plan', email: `beto-${stamp}@plan.test`, password: 'clave-segura', companyName: `Plan B ${stamp}`,
    });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    tokenA = a.body.token;
    tokenB = b.body.token;
    const areas = await json('POST', '/api/areas', tokenA, { name: 'Ventas', color: '#F5C518' });
    expect(areas.status).toBe(200);
    areaA = areas.body.id as string;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: '@plan.test' } },
      include: { memberships: true },
    });
    const companyIds = [...new Set(users.flatMap((user) => user.memberships.map((member) => member.companyId)))];
    if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@plan.test' } } });
    await app.close();
  });

  it('una empresa no ve los campos de otra, y el formulario público crea el contacto en la suya', async () => {
    const field = await json('POST', '/api/plan/campos', tokenA, { areaId: areaA, label: 'Cliente', kind: 'texto', options: '' });
    expect(field.status).toBe(200);
    const foreign = await json('GET', `/api/plan/campos?areaId=${areaA}`, tokenB);
    expect(foreign.status).toBe(404);
    const form = await json('POST', '/api/plan/formularios', tokenA, {
      areaId: areaA, title: 'Hola', intro: 'Pasa', taskTitle: 'Llamar',
    });
    expect(form.status).toBe(200);
    const sent = await json('POST', `/api/publico/formularios/${form.body.slug}`, undefined, { name: 'Nuria', email: 'nuria@cliente.test', phone: '', note: 'Quiero una demo' });
    expect(sent.status).toBe(200);
    const lead = await prisma.lead.findFirst({ where: { id: sent.body.leadId } });
    expect(lead?.companyId).toBeTruthy();
    const companyA = await prisma.area.findFirst({ where: { id: areaA } });
    expect(lead?.companyId).toBe(companyA?.companyId);
    expect(lead?.source).toBe(form.body.slug);
    const task = await prisma.task.findFirst({ where: { companyId: lead!.companyId, title: { contains: 'Nuria' } } });
    expect(task?.areaId).toBe(areaA);
  });

  it('no deja cerrar una tarea si la dependencia sigue abierta', async () => {
    const first = await json('POST', '/api/tareas', tokenA, { title: 'Primero el brief', areaId: areaA, priority: 'media' });
    const second = await json('POST', '/api/tareas', tokenA, { title: 'Luego la propuesta', areaId: areaA, priority: 'media' });
    expect(first.status).toBe(200);
    const link = await json('POST', '/api/plan/dependencias', tokenA, { taskId: second.body.id, dependsOnId: first.body.id });
    expect(link.status).toBe(200);
    const loop = await json('POST', '/api/plan/dependencias', tokenA, { taskId: first.body.id, dependsOnId: second.body.id });
    expect(loop.status).toBe(400);
    const blocked = await json('PATCH', `/api/tareas/${second.body.id}`, tokenA, { status: 'hecho' });
    expect(blocked.status).toBe(400);
  });
});
