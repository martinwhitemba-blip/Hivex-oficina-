import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { ensurePlans } from '../src/billing';
import { prisma } from '../src/prisma';

let app: FastifyInstance;

async function json(method: string, url: string, token?: string, payload?: unknown) {
  const response = await app.inject({
    method: method as 'GET',
    url,
    payload: payload as string | undefined,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const body = response.headers['content-type']?.includes('application/json') ? response.json() : response.body;
  return { status: response.statusCode, body };
}

beforeAll(async () => {
  await prisma.company.deleteMany();
  await prisma.user.deleteMany();
  await ensurePlans();
  app = (await buildApp()).app;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('API de empresa', () => {
  it('aísla los datos entre empresas y exige el plan al sumar personas', async () => {
    const a = await json('POST', '/api/auth/registro', undefined, {
      name: 'Ana Dueña', email: 'ana@empresa-a.test', password: 'clave-segura', companyName: 'Empresa A',
    });
    const b = await json('POST', '/api/auth/registro', undefined, {
      name: 'Beto Dueño', email: 'beto@empresa-b.test', password: 'clave-segura', companyName: 'Empresa B',
    });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const tokenA = a.body.token as string;
    const tokenB = b.body.token as string;

    const area = await json('POST', '/api/areas', tokenA, { name: 'Ventas', color: '#F5C518', teamName: 'Comercial' });
    expect(area.status).toBe(200);
    const areasB = await json('GET', '/api/areas', tokenB);
    expect(areasB.body).toEqual([]);

    const kpis = await json('PUT', `/api/areas/${area.body.id}/kpis`, tokenA, {
      kpis: [{ key: 'llamadas', label: 'Llamadas', unit: '', targetDaily: 10, higherIsBetter: true }],
    });
    expect(kpis.status).toBe(200);

    const invite = await json('POST', '/api/invitaciones', tokenA, { email: 'eva@empresa-a.test', role: 'empleado', areaId: area.body.id });
    expect(invite.status).toBe(200);
    const accepted = await json('POST', `/api/invitaciones/${invite.body.code}/aceptar`, undefined, { name: 'Eva Soto', password: 'clave-segura' });
    expect(accepted.status).toBe(200);
    const tokenEva = accepted.body.token as string;

    const forbidden = await json('POST', '/api/areas', tokenEva, { name: 'Secretos', color: '#fff' });
    expect(forbidden.status).toBe(403);

    const yo = await json('GET', '/api/auth/yo', tokenEva);
    await json('PUT', '/api/informes/mio', tokenEva, { date: '2026-10-19', note: 'Lunes', metrics: { llamadas: 10 } });
    await json('PUT', '/api/informes/mio', tokenEva, { date: '2026-10-16', note: 'Viernes', metrics: { llamadas: 15 } });
    const panel = await json('GET', '/api/panel?from=2026-10-01&to=2026-10-20', tokenA);
    const ventas = panel.body.areas.find((item: { name: string }) => item.name === 'Ventas');
    expect(ventas.kpis[0].total).toBe(25);
    expect(panel.body.employees.every((person: { id: string; name: string }) => person.id === yo.body.membership.id || person.name === 'Ana Dueña' || person.name === 'Eva Soto')).toBe(true);

    const otherReports = await json('GET', `/api/informes?membershipId=${yo.body.membership.id}`, tokenB);
    expect(otherReports.status).toBe(404);

    const company = await prisma.company.findFirst({ where: { name: 'Empresa A' }, include: { subscription: { include: { plan: true } } } });
    await prisma.plan.update({ where: { id: company!.subscription!.planId }, data: { maxWorkers: 2 } });
    const overflow = await json('POST', '/api/invitaciones', tokenA, { email: 'extra@empresa-a.test', role: 'empleado' });
    const acceptedOverflow = await json('POST', `/api/invitaciones/${overflow.body.code}/aceptar`, undefined, { name: 'Extra', password: 'clave-segura' });
    expect(acceptedOverflow.status).toBe(409);
    expect(String(acceptedOverflow.body.error)).toContain('plan');
    await prisma.plan.update({ where: { id: company!.subscription!.planId }, data: { maxWorkers: 8 } });
  });

  it('recibe métricas por la clave de integración y deja constancia en auditoría al mover a alguien', async () => {
    const owner = await json('POST', '/api/auth/entrar', undefined, { email: 'ana@empresa-a.test', password: 'clave-segura' });
    const token = owner.body.token as string;
    const key = await json('GET', '/api/integraciones', token);
    const pushed = await json('POST', '/api/integraciones/metricas', undefined, {
      email: 'eva@empresa-a.test',
      date: '2026-10-20',
      metrics: { llamadas: 7 },
      note: 'Desde el CRM',
    });
    // inject no manda headers extra en json(). Rehacemos con cabecera.
    void pushed;
    const direct = await app.inject({
      method: 'POST',
      url: '/api/integraciones/metricas',
      payload: { email: 'eva@empresa-a.test', date: '2026-10-20', metrics: { llamadas: 7 }, note: 'Desde el CRM' },
      headers: { 'x-api-key': key.body.apiKey },
    });
    expect(direct.statusCode).toBe(200);

    const people = await json('GET', '/api/empleados', token);
    const eva = people.body.find((person: { name: string }) => person.name === 'Eva Soto');
    const area2 = await json('POST', '/api/areas', token, { name: 'Soporte', color: '#5EEAD4' });
    const moved = await json('POST', `/api/dueno/personas/${eva.id}/area`, token, { areaId: area2.body.id });
    expect(moved.status).toBe(200);
    const audit = await json('GET', '/api/dueno/auditoria', token);
    expect(audit.body.some((row: { action: string }) => row.action === 'mover_persona')).toBe(true);

    const employee = await json('POST', '/api/auth/entrar', undefined, { email: 'eva@empresa-a.test', password: 'clave-segura' });
    const panelDueno = await json('GET', '/api/dueno', employee.body.token);
    expect(panelDueno.status).toBe(403);
  });

  it('guarda mensajes directos dentro de la empresa y rechaza un puesto inexistente', async () => {
    const owner = await json('POST', '/api/auth/entrar', undefined, { email: 'ana@empresa-a.test', password: 'clave-segura' });
    const evaLogin = await json('POST', '/api/auth/entrar', undefined, { email: 'eva@empresa-a.test', password: 'clave-segura' });
    const beto = await json('POST', '/api/auth/entrar', undefined, { email: 'beto@empresa-b.test', password: 'clave-segura' });
    const tokenA = owner.body.token as string;
    const tokenEva = evaLogin.body.token as string;
    const tokenB = beto.body.token as string;
    const yo = await json('GET', '/api/auth/yo', tokenA);
    const anaId = yo.body.membership.id as string;
    const people = await json('GET', '/api/empleados', tokenA);
    const eva = people.body.find((person: { name: string; id: string }) => person.name === 'Eva Soto');

    const missing = await json('POST', '/api/invitaciones', tokenA, {
      email: 'nadie@empresa-a.test', role: 'empleado', jobTitleId: 'puesto-inexistente',
    });
    expect(missing.status).toBe(404);
    expect(String(missing.body.error)).toMatch(/Puesto/);

    const sent = await json('POST', `/api/directos/${eva.id}`, tokenA, { body: '¿Sigues en Ventas?' });
    expect(sent.status).toBe(200);
    expect(sent.body.body).toBe('¿Sigues en Ventas?');
    expect(sent.body.recipientId).toBe(eva.id);

    const inbox = await json('GET', '/api/directos', tokenEva);
    const row = inbox.body.personas.find((person: { id: string; unread: number }) => person.id === anaId);
    expect(row.unread).toBe(1);

    const crossSend = await json('POST', `/api/directos/${eva.id}`, tokenB, { body: 'hola desde fuera' });
    expect(crossSend.status).toBe(404);
    const crossRead = await json('GET', `/api/directos/${eva.id}`, tokenB);
    expect(crossRead.status).toBe(404);
    const outsiders = await json('GET', '/api/directos', tokenB);
    expect(outsiders.body.personas.some((person: { id: string }) => person.id === eva.id)).toBe(false);

    const thread = await json('GET', `/api/directos/${anaId}`, tokenEva);
    expect(thread.status).toBe(200);
    expect(thread.body.mensajes.map((message: { body: string }) => message.body)).toEqual(['¿Sigues en Ventas?']);
    const after = await json('GET', '/api/directos', tokenEva);
    expect(after.body.personas.find((person: { id: string; unread: number }) => person.id === anaId).unread).toBe(0);

    const self = await json('POST', `/api/directos/${anaId}`, tokenA, { body: 'yo' });
    expect(self.status).toBe(400);
  });
});
