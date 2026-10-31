import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { attachPlan, ensurePlans } from '../src/billing';
import { basicAnswer, buildReportPdf, cafeAward, seasonOf, webhookUrlProblem } from '../src/phase3Logic';
import { s3Settings, signS3Request } from '../src/storageS3';
import { prisma } from '../src/prisma';

describe('urls de conexión', () => {
  it('rechaza direcciones privadas', () => {
    expect(webhookUrlProblem('http://127.0.0.1/meta', true)).toBe('privada');
    expect(webhookUrlProblem('https://169.254.169.254/', false)).toBe('privada');
    expect(webhookUrlProblem('http://hooks.example/hivex', false)).toBe('https');
    expect(webhookUrlProblem('https://hooks.example/hivex', false)).toBeNull();
  });
});

describe('asistente básico', () => {
  it('responde con los números de esa empresa', () => {
    const text = basicAnswer({ companyName: 'Acme', openTasks: 3, overdue: 1, missionPct: 40, busiest: { name: 'Ana', minutes: 90 } }, 'qué está atrasado');
    expect(text).toContain('Acme');
    expect(text).toContain('Ana');
    expect(text).toContain('Modo básico');
  });
});

describe('pdf', () => {
  it('abre como PDF', () => {
    const bytes = buildReportPdf('Reportes', ['HIVEX', 'Abiertas  2']);
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(bytes.toString('latin1')).toContain('HIVEX');
  });
});

describe('almacén', () => {
  it('no marca S3 como listo si falta una clave', () => {
    expect(s3Settings({ S3_BUCKET: 'hivex' }).ready).toBe(false);
    const ready = s3Settings({ S3_BUCKET: 'hivex', S3_ACCESS_KEY: 'demo', S3_SECRET_KEY: 'demo', S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com' });
    expect(ready.ready).toBe(true);
    expect(ready.region).toBe('auto');
    const now = new Date('2026-10-23T12:00:00.000Z');
    const first = signS3Request({ method: 'PUT', host: 'example.r2.cloudflarestorage.com', path: '/hivex/a.txt', body: Buffer.from('hola'), now, settings: ready });
    const second = signS3Request({ method: 'PUT', host: 'example.r2.cloudflarestorage.com', path: '/hivex/a.txt', body: Buffer.from('hola'), now, settings: ready });
    expect(first.authorization).toBe(second.authorization);
    expect(first.authorization.startsWith('AWS4-HMAC-SHA256')).toBe(true);
  });
});

describe('café', () => {
  it('dobla los puntos en octubre y en diciembre', () => {
    expect(seasonOf('2026-10-23').multiplier).toBe(2);
    expect(seasonOf('2026-12-01').name).toContain('Cierre');
    expect(cafeAward('taza', { elapsedMs: 400 }, 2)).toBe(10);
    expect(cafeAward('taza', { elapsedMs: 10 }, 2)).toBe(0);
    expect(cafeAward('memoria', { moves: 8 }, 1)).toBe(5);
  });
});

describe('portafolio del grupo', () => {
  let app: FastifyInstance;
  let tokenA = '';
  let tokenB = '';
  let tokenC = '';
  const stamp = Date.now().toString(36);
  const nameA = `GrupoA ${stamp}`;
  const nameB = `GrupoB ${stamp}`;
  const secret = `SECRETO-${stamp}`;

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
      name: 'Ana Grupo', email: `ana-${stamp}@fase3.test`, password: 'clave-segura', companyName: nameA,
    });
    const b = await json('POST', '/api/auth/registro', undefined, {
      name: 'Beto Grupo', email: `beto-${stamp}@fase3.test`, password: 'clave-segura', companyName: nameB,
    });
    const c = await json('POST', '/api/auth/registro', undefined, {
      name: 'Ciro Grupo', email: `ciro-${stamp}@fase3.test`, password: 'clave-segura', companyName: `GrupoC ${stamp}`,
    });
    tokenA = a.body.token;
    tokenB = b.body.token;
    tokenC = c.body.token;
    const userA = await prisma.user.findUnique({ where: { email: `ana-${stamp}@fase3.test` }, include: { memberships: true } });
    await attachPlan(userA!.memberships[0].companyId, 'grupo', 'activa');
    const area = await json('POST', '/api/areas', tokenB, { name: 'Ventas', color: '#F5C518' });
    await json('POST', '/api/tareas', tokenB, { title: secret, areaId: area.body.id });
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: '@fase3.test' } },
      include: { memberships: true },
    });
    const companyIds = [...new Set(users.flatMap((user) => user.memberships.map((member) => member.companyId)))];
    if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@fase3.test' } } });
    await app.close();
  });

  it('el dueño compara sus empresas y un extraño no ve los nombres ni las tareas', async () => {
    const created = await json('POST', '/api/portafolio', tokenA, { name: `Holding ${stamp}` });
    expect(created.status).toBe(200);
    const joined = await json('POST', '/api/portafolio/unirse', tokenB, { code: created.body.inviteCode });
    expect(joined.status).toBe(200);
    const owner = await json('GET', '/api/portafolio', tokenA);
    expect(owner.status).toBe(200);
    const packed = JSON.stringify(owner.body);
    expect(packed).toContain(nameA);
    expect(packed).toContain(nameB);
    expect(packed).not.toContain(secret);
    const guest = await json('GET', '/api/portafolio', tokenB);
    expect(JSON.stringify(guest.body)).not.toContain(nameA);
    expect(JSON.stringify(guest.body)).toContain(nameB);
    const stranger = await json('GET', '/api/portafolio', tokenC);
    expect(stranger.body.holding).toBeNull();
    expect(JSON.stringify(stranger.body)).not.toContain(nameA);
    expect(JSON.stringify(stranger.body)).not.toContain(nameB);
    const wrong = await json('POST', '/api/portafolio/unirse', tokenC, { code: 'NOEXISTE' });
    expect(wrong.status).toBe(404);
  });

  it('una partida del café no suma en otra empresa', async () => {
    const played = await json('POST', '/api/cafe/jugar', tokenA, { game: 'taza', elapsedMs: 400 });
    expect(played.status).toBe(200);
    expect(played.body.awarded).toBe(5 * played.body.season.multiplier);
    const other = await json('GET', '/api/cafe', tokenB);
    expect(other.status).toBe(200);
    expect(other.body.rewarded).toBe(0);
    for (let n = 0; n < 8; n += 1) {
      const again = await json('POST', '/api/cafe/jugar', tokenA, { game: 'taza', elapsedMs: 500 });
      if (again.body.capped) {
        expect(again.body.awarded).toBe(0);
        return;
      }
    }
    throw new Error('el límite diario no cortó los puntos');
  });
});

describe('archivos de tarea', () => {
  let app: FastifyInstance;
  let tokenA = '';
  let tokenB = '';
  let taskA = '';
  const stamp = Date.now().toString(36);

  async function json(method: string, url: string, token?: string, payload?: unknown, headers?: Record<string, string>) {
    const response = await app.inject({
      method: method as 'GET',
      url,
      payload: payload as object | undefined,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    });
    const body = response.headers['content-type']?.includes('application/json') ? response.json() : response.body;
    return { status: response.statusCode, body };
  }

  beforeAll(async () => {
    app = (await buildApp()).app;
    const a = await json('POST', '/api/auth/registro', undefined, {
      name: 'Ana Archivo', email: `ana-${stamp}@files.test`, password: 'clave-segura', companyName: `Archivos A ${stamp}`,
    });
    const b = await json('POST', '/api/auth/registro', undefined, {
      name: 'Beto Archivo', email: `beto-${stamp}@files.test`, password: 'clave-segura', companyName: `Archivos B ${stamp}`,
    });
    tokenA = a.body.token;
    tokenB = b.body.token;
    const area = await json('POST', '/api/areas', tokenA, { name: 'Ventas', color: '#F5C518' });
    const task = await json('POST', '/api/tareas', tokenA, { title: 'Con archivo', areaId: area.body.id });
    taskA = task.body.id;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: '@files.test' } }, include: { memberships: true } });
    const companyIds = [...new Set(users.flatMap((user) => user.memberships.map((member) => member.companyId)))];
    if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@files.test' } } });
    await app.close();
  });

  it('otra empresa no lee ni lista el archivo', async () => {
    const boundary = '----hivexform';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="nota.txt"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from('solo-empresa-a'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const saved = await json('POST', `/api/tareas/${taskA}/archivos`, tokenA, payload, { 'content-type': `multipart/form-data; boundary=${boundary}` });
    expect(saved.status).toBe(200);
    const foreign = await json('GET', `/api/tareas/${taskA}/archivos`, tokenB);
    expect(foreign.status).toBe(404);
    const download = await json('GET', `/api/tareas/${taskA}/archivos/${saved.body.id}`, tokenB);
    expect(download.status).toBe(404);
    const own = await json('GET', `/api/tareas/${taskA}/archivos/${saved.body.id}`, tokenA);
    expect(own.status).toBe(200);
    expect(String(own.body)).toContain('solo-empresa-a');
  });
});

describe('reportes', () => {
  let app: FastifyInstance;
  let tokenA = '';
  let tokenB = '';
  const stamp = Date.now().toString(36);
  const nameA = `Reportes A ${stamp}`;

  async function json(method: string, url: string, token?: string, payload?: unknown) {
    const response = await app.inject({
      method: method as 'GET',
      url,
      payload: payload as object | undefined,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const type = response.headers['content-type'] || '';
    const body = type.includes('application/json') ? response.json() : response.body;
    return { status: response.statusCode, body, type };
  }

  beforeAll(async () => {
    app = (await buildApp()).app;
    tokenA = (await json('POST', '/api/auth/registro', undefined, {
      name: 'Ana Reporte', email: `ana-${stamp}@rep.test`, password: 'clave-segura', companyName: nameA,
    })).body.token;
    tokenB = (await json('POST', '/api/auth/registro', undefined, {
      name: 'Beto Reporte', email: `beto-${stamp}@rep.test`, password: 'clave-segura', companyName: `Reportes B ${stamp}`,
    })).body.token;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: '@rep.test' } }, include: { memberships: true } });
    const companyIds = [...new Set(users.flatMap((user) => user.memberships.map((member) => member.companyId)))];
    if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@rep.test' } } });
    await app.close();
  });

  it('un panel no se lee desde otra empresa y un empleado no entra', async () => {
    const created = await json('POST', '/api/reportes', tokenA, { name: 'Semana', widgets: ['abiertas', 'vencidas'], rangeDays: 7 });
    expect(created.status).toBe(200);
    const foreign = await json('GET', `/api/reportes/${created.body.id}`, tokenB);
    expect(foreign.status).toBe(404);
    const listB = await json('GET', '/api/reportes', tokenB);
    expect(JSON.stringify(listB.body)).not.toContain('Semana');
    const pdf = await json('GET', `/api/reportes/${created.body.id}/pdf`, tokenA);
    expect(pdf.status).toBe(200);
    expect(String(pdf.body).startsWith('%PDF')).toBe(true);
    expect(String(pdf.body)).toContain('Reportes');
    const user = await prisma.user.findUnique({ where: { email: `ana-${stamp}@rep.test` }, include: { memberships: true } });
    await prisma.membership.update({ where: { id: user!.memberships[0].id }, data: { role: 'empleado' } });
    const blocked = await json('GET', '/api/reportes', tokenA);
    expect(blocked.status).toBe(403);
  });
});

describe('asistente', () => {
  let app: FastifyInstance;
  let tokenA = '';
  let tokenB = '';
  const stamp = Date.now().toString(36);
  const secret = `SECRETO-AI-${stamp}`;

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
    delete process.env.HIVEX_AI_BASE_URL;
    delete process.env.HIVEX_AI_API_KEY;
    app = (await buildApp()).app;
    tokenA = (await json('POST', '/api/auth/registro', undefined, {
      name: 'Ana IA', email: `ana-${stamp}@ai.test`, password: 'clave-segura', companyName: `IA A ${stamp}`,
    })).body.token;
    tokenB = (await json('POST', '/api/auth/registro', undefined, {
      name: 'Beto IA', email: `beto-${stamp}@ai.test`, password: 'clave-segura', companyName: `IA B ${stamp}`,
    })).body.token;
    const area = await json('POST', '/api/areas', tokenB, { name: 'Ventas', color: '#F5C518' });
    await json('POST', '/api/tareas', tokenB, { title: secret, areaId: area.body.id });
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: '@ai.test' } }, include: { memberships: true } });
    const companyIds = [...new Set(users.flatMap((user) => user.memberships.map((member) => member.companyId)))];
    if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@ai.test' } } });
    await app.close();
  });

  it('el modo básico no menciona la tarea de otra empresa y corta el ritmo', async () => {
    const answer = await json('POST', '/api/asistente', tokenA, { question: 'qué está atrasado' });
    expect(answer.status).toBe(200);
    expect(answer.body.mode).toBe('basico');
    expect(answer.body.answer).not.toContain(secret);
    const user = await prisma.user.findUnique({ where: { email: `beto-${stamp}@ai.test` }, include: { memberships: true } });
    await prisma.membership.update({ where: { id: user!.memberships[0].id }, data: { role: 'empleado' } });
    expect((await json('POST', '/api/asistente', tokenB, { question: 'hola equipo' })).status).toBe(403);
    let limited = 0;
    for (let n = 0; n < 10; n += 1) {
      const again = await json('POST', '/api/asistente', tokenA, { question: 'cómo vamos' });
      if (again.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });
});

describe('conexiones', () => {
  let app: FastifyInstance;
  let tokenA = '';
  let tokenB = '';
  const stamp = Date.now().toString(36);
  const calls: { url: string; body: string; sig: string }[] = [];

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
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), body: String(init?.body || ''), sig: headers.get('x-hivex-signature') || '' });
      return new Response('ok', { status: 200 });
    });
    app = (await buildApp()).app;
    tokenA = (await json('POST', '/api/auth/registro', undefined, {
      name: 'Ana Hook', email: `ana-${stamp}@hook.test`, password: 'clave-segura', companyName: `Hook A ${stamp}`,
    })).body.token;
    tokenB = (await json('POST', '/api/auth/registro', undefined, {
      name: 'Beto Hook', email: `beto-${stamp}@hook.test`, password: 'clave-segura', companyName: `Hook B ${stamp}`,
    })).body.token;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    const users = await prisma.user.findMany({ where: { email: { endsWith: '@hook.test' } }, include: { memberships: true } });
    const companyIds = [...new Set(users.flatMap((user) => user.memberships.map((member) => member.companyId)))];
    if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@hook.test' } } });
    await app.close();
  });

  it('firma el aviso de una empresa y no llama a la otra', async () => {
    expect((await json('POST', '/api/conexiones', tokenA, { name: 'Mala', url: 'http://127.0.0.1/latest', events: ['tarea_creada'] })).status).toBe(400);
    const hookA = await json('POST', '/api/conexiones', tokenA, {
      name: 'Sala', url: 'https://hooks.example/a', events: ['tarea_creada'], format: 'slack',
    });
    const hookB = await json('POST', '/api/conexiones', tokenB, {
      name: 'Otra', url: 'https://hooks.example/b', events: ['tarea_creada'], format: 'generico',
    });
    expect(hookA.status).toBe(200);
    expect(hookB.status).toBe(200);
    const listed = await json('GET', '/api/conexiones', tokenA);
    expect(JSON.stringify(listed.body)).not.toContain(hookA.body.secret);
    expect(JSON.stringify(listed.body)).not.toContain('hooks.example/b');
    const area = await json('POST', '/api/areas', tokenA, { name: 'Ventas', color: '#F5C518' });
    calls.length = 0;
    const task = await json('POST', '/api/tareas', tokenA, { title: `Aviso ${stamp}`, areaId: area.body.id });
    expect(task.status).toBe(200);
    expect(calls.map((call) => call.url)).toEqual(['https://hooks.example/a']);
    const expected = crypto.createHmac('sha256', hookA.body.secret).update(calls[0].body).digest('hex');
    expect(calls[0].sig).toBe(expected);
    expect(calls[0].body).toContain('"text"');
    expect((await json('DELETE', `/api/conexiones/${hookA.body.id}`, tokenB)).status).toBe(404);
  });
});
