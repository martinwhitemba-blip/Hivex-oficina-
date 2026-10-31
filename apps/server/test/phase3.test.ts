import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { attachPlan, ensurePlans } from '../src/billing';
import { cafeAward, seasonOf } from '../src/phase3Logic';
import { prisma } from '../src/prisma';

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
