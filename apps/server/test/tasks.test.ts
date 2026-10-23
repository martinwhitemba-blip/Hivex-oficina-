import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { ensurePlans } from '../src/billing';
import { resolveMentions } from '../src/mentions';
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

describe('menciones', () => {
  it('se queda con la persona de la empresa y el nombre más largo', () => {
    const members = [
      { id: 'ana', name: 'Ana' },
      { id: 'ana-maria', name: 'Ana María' },
      { id: 'eva', name: 'Eva Soto' },
    ];
    expect(resolveMentions('@Ana María y @Eva Soto', members)).toEqual(['ana-maria', 'eva']);
    expect(resolveMentions('hola @ana', members)).toEqual(['ana']);
    expect(resolveMentions('sin arroba', members, ['eva', 'ajena'])).toEqual(['eva']);
  });
});

describe('tareas de la empresa', () => {
  let tokenA = '';
  let tokenB = '';
  let tokenEva = '';
  let tokenNico = '';
  let tokenLucia = '';
  let ventasId = '';
  let soporteId = '';
  let evaId = '';
  let nicoId = '';
  let betoId = '';

  beforeAll(async () => {
    const oldUsers = await prisma.user.findMany({
      where: { email: { endsWith: '@tareas.test' } },
      include: { memberships: true },
    });
    const companyIds = [...new Set(oldUsers.flatMap((user) => user.memberships.map((member) => member.companyId)))];
    if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@tareas.test' } } });
    await ensurePlans();
    app = (await buildApp()).app;

    tokenA = await register('Ana Dueña', `ana-${stamp}@tareas.test`, `Tareas A ${stamp}`);
    tokenB = await register('Beto Dueño', `beto-${stamp}@tareas.test`, `Tareas B ${stamp}`);
    const ventas = await json('POST', '/api/areas', tokenA, { name: 'Ventas', color: '#F5C518' });
    const soporte = await json('POST', '/api/areas', tokenA, { name: 'Soporte', color: '#5EEAD4' });
    expect(ventas.status).toBe(200);
    ventasId = ventas.body.id;
    soporteId = soporte.body.id;
    tokenEva = await invite(tokenA, `eva-${stamp}@tareas.test`, 'empleado', ventasId, 'Eva Soto');
    tokenNico = await invite(tokenA, `nico-${stamp}@tareas.test`, 'empleado', ventasId, 'Nico Ruiz');
    tokenLucia = await invite(tokenA, `lucia-${stamp}@tareas.test`, 'administrador', ventasId, 'Lucía Fernández');
    await invite(tokenA, `pablo-${stamp}@tareas.test`, 'empleado', soporteId, 'Pablo Herrera');
    const eva = await json('GET', '/api/auth/yo', tokenEva);
    const nico = await json('GET', '/api/auth/yo', tokenNico);
    const beto = await json('GET', '/api/auth/yo', tokenB);
    evaId = eva.body.membership.id;
    nicoId = nico.body.membership.id;
    betoId = beto.body.membership.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('aísla empresas, respeta quién mueve cada carta y guarda pasos y menciones', async () => {
    const yesterday = shift(-1);
    const tomorrow = shift(1);
    const created = await json('POST', '/api/tareas', tokenA, {
      title: 'Llamar al cliente oro',
      areaId: ventasId,
      assigneeId: evaId,
      priority: 'alta',
      dueDate: yesterday,
    });
    expect(created.status).toBe(200);
    expect(created.body.priority).toBe('alta');
    expect(created.body.dueDate).toBe(yesterday);
    expect(created.body.overdue).toBe(true);
    expect(created.body.createdById).toBeTruthy();
    const taskId = created.body.id as string;
    const stored = await prisma.task.findUnique({ where: { id: taskId } });
    expect(stored?.companyId).toBeTruthy();
    expect(stored?.priority).toBe('alta');
    const companyA = stored!.companyId;

    const other = await json('POST', '/api/tareas', tokenA, {
      title: 'Revisar tickets',
      areaId: soporteId,
      priority: 'baja',
      dueDate: tomorrow,
    });
    expect(other.status).toBe(200);
    const mate = await json('POST', '/api/tareas', tokenLucia, {
      title: 'Preparar la demo',
      areaId: ventasId,
      assigneeId: nicoId,
      priority: 'media',
      dueDate: tomorrow,
    });
    expect(mate.status).toBe(200);

    const outsider = await json('GET', '/api/tareas', tokenB);
    expect(outsider.status).toBe(200);
    expect(outsider.body.some((task: { title: string }) => task.title === 'Llamar al cliente oro')).toBe(false);
    expect((await json('GET', `/api/tareas/${taskId}`, tokenB)).status).toBe(404);
    expect((await json('PATCH', `/api/tareas/${taskId}`, tokenB, { status: 'hecho' })).status).toBe(404);
    expect((await json('POST', `/api/tareas/${taskId}/comentarios`, tokenB, { body: 'desde fuera' })).status).toBe(404);
    expect((await json('DELETE', `/api/tareas/${taskId}`, tokenB)).status).toBe(404);

    const evaList = await json('GET', '/api/tareas', tokenEva);
    expect(evaList.body.some((task: { title: string }) => task.title === 'Llamar al cliente oro')).toBe(true);
    expect(evaList.body.some((task: { title: string }) => task.title === 'Revisar tickets')).toBe(false);
    expect((await json('PATCH', `/api/tareas/${mate.body.id}`, tokenEva, { status: 'hecho' })).status).toBe(403);
    expect((await json('PATCH', `/api/tareas/${taskId}`, tokenEva, { title: 'Cambiada' })).status).toBe(403);
    expect((await json('POST', '/api/tareas', tokenEva, { title: 'No puedo', areaId: ventasId })).status).toBe(403);
    const moved = await json('PATCH', `/api/tareas/${taskId}`, tokenEva, { status: 'en_curso' });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('en_curso');

    expect((await json('PATCH', `/api/tareas/${other.body.id}`, tokenLucia, { status: 'en_curso' })).status).toBe(403);
    expect((await json('POST', '/api/tareas', tokenLucia, { title: 'Fuera', areaId: soporteId })).status).toBe(403);

    const step = await json('POST', `/api/tareas/${taskId}/subtareas`, tokenLucia, { title: 'Abrir el expediente' });
    expect(step.status).toBe(200);
    expect(step.body.parentId).toBe(taskId);
    expect(step.body.assigneeId).toBe(evaId);
    expect((await json('POST', `/api/tareas/${step.body.id}/subtareas`, tokenLucia, { title: 'Demasiado hondo' })).status).toBe(400);
    const checked = await json('PATCH', `/api/tareas/${step.body.id}`, tokenEva, { status: 'hecho' });
    expect(checked.status).toBe(200);

    const comment = await json('POST', `/api/tareas/${taskId}/comentarios`, tokenLucia, {
      body: '@Eva Soto esto cuenta como misión',
      mentions: [evaId, betoId, 'no-es-de-aqui'],
    });
    expect(comment.status).toBe(200);
    expect(comment.body.mentions).toEqual([evaId]);
    expect(comment.body.mentionNames).toEqual(['Eva Soto']);
    const storedComment = await prisma.taskComment.findUnique({ where: { id: comment.body.id } });
    expect(storedComment?.companyId).toBe(companyA);
    expect((await json('DELETE', `/api/tareas/${taskId}/comentarios/${comment.body.id}`, tokenNico)).status).toBe(403);
    expect((await json('DELETE', `/api/tareas/${taskId}/comentarios/${comment.body.id}`, tokenLucia)).status).toBe(200);

    const late = await json('GET', `/api/tareas?vista=lista&vencidas=1&areaId=${ventasId}`, tokenA);
    expect(late.body.map((task: { title: string }) => task.title)).toContain('Llamar al cliente oro');
    expect(late.body.some((task: { title: string }) => task.title === 'Preparar la demo')).toBe(false);
    const byPriority = await json('GET', '/api/tareas?vista=lista&orden=priority&dir=asc', tokenA);
    const titles = byPriority.body.map((task: { title: string; parentId: string | null }) => task.title);
    expect(titles.indexOf('Llamar al cliente oro')).toBeLessThan(titles.indexOf('Revisar tickets'));
    const flat = await json('GET', '/api/tareas?vista=lista', tokenA);
    expect(flat.body.some((task: { title: string }) => task.title === 'Abrir el expediente')).toBe(true);

    const indexes = await prisma.$queryRaw<Array<{ sql: string | null }>>`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Task'`;
    const blob = indexes.map((index) => index.sql || '').join('\n');
    expect(blob).toMatch(/companyId.*areaId.*status/);
    expect(blob).toMatch(/companyId.*assigneeId.*status/);
    expect(blob).toMatch(/companyId.*dueDate/);

    const inbox = await json('GET', '/api/notificaciones', tokenEva);
    expect(inbox.status).toBe(200);
    const kinds = inbox.body.items.map((item: { kind: string }) => item.kind);
    expect(kinds).toContain('assignment');
    expect(kinds).toContain('mention');
    expect(kinds).toContain('overdue');
    expect(inbox.body.unread).toBeGreaterThan(0);
    expect(inbox.body.items.every((item: { payload: { title?: string } }) => item.payload && typeof item.payload === 'object')).toBe(true);
    const foreign = await json('GET', '/api/notificaciones', tokenB);
    expect(foreign.body.items.some((item: { payload: { title?: string } }) => item.payload.title === 'Llamar al cliente oro')).toBe(false);
    const stolen = await json('POST', '/api/notificaciones/leidas', tokenB, { ids: inbox.body.items.map((item: { id: string }) => item.id) });
    expect(stolen.body.ids).toEqual([]);
    expect((await json('GET', '/api/notificaciones/contador', tokenEva)).body.unread).toBe(inbox.body.unread);
    const read = await json('POST', '/api/notificaciones/leidas', tokenEva, {});
    expect(read.body.unread).toBe(0);
    expect((await json('GET', '/api/notificaciones', tokenEva)).body.unread).toBe(0);
    const noticeIndexes = await prisma.$queryRaw<Array<{ sql: string | null }>>`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Notification'`;
    const noticeBlob = noticeIndexes.map((index) => index.sql || '').join('\n');
    expect(noticeBlob).toMatch(/companyId/);
    expect(noticeBlob).toMatch(/recipientId/);

    expect((await json('DELETE', `/api/tareas/${taskId}`, tokenEva)).status).toBe(403);
    expect((await json('DELETE', `/api/tareas/${taskId}`, tokenA)).status).toBe(200);
    expect((await json('GET', `/api/tareas/${step.body.id}`, tokenA)).status).toBe(404);
  });
});
