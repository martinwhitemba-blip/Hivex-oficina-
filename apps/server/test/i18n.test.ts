import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { formatMoney, parityIssues, renderEmail, screenCopy, translate } from '../../../packages/i18n/src/index';
import { buildApp } from '../src/app';
import { ensurePlans } from '../src/billing';
import { rowsFromRecords } from '../src/peopleImport';
import { prisma } from '../src/prisma';

let app: FastifyInstance;

beforeAll(async () => {
  await ensurePlans();
  app = (await buildApp()).app;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('catálogo de idiomas', () => {
  it('tiene las mismas claves en es, en, fr y de', () => {
    expect(parityIssues()).toEqual([]);
  });

  it('pluraliza y formatea dinero con Intl', () => {
    expect(translate('es', 'import.created', { n: 1 })).toBe('1 cuenta creada');
    expect(translate('es', 'import.created', { n: 2 })).toBe('2 cuentas creadas');
    expect(translate('fr', 'import.created', { n: 0 })).toContain('compte créé');
    expect(formatMoney('en', 10)).toContain('$');
    expect(formatMoney('de', 10)).toContain('€');
  });

  it('cambia el texto de las pantallas principales', () => {
    const es = screenCopy('es');
    for (const locale of ['en', 'fr', 'de'] as const) {
      const copy = screenCopy(locale);
      for (const key of Object.keys(es) as (keyof typeof es)[]) {
        expect(copy[key]).not.toBe(es[key]);
      }
    }
  });

  it('traduce las plantillas de correo', () => {
    const es = renderEmail('es', 'invite', { company: 'Acme', link: 'https://hivex.test', email: 'a@b.c', name: 'Ana' });
    const en = renderEmail('en', 'invite', { company: 'Acme', link: 'https://hivex.test', email: 'a@b.c', name: 'Ana' });
    expect(en.subject).not.toBe(es.subject);
    expect(en.text).toContain('https://hivex.test');
    expect(en.system).not.toBe(es.system);
  });

  it('acepta cabeceras de CSV en inglés', () => {
    const [row] = rowsFromRecords([{
      name: 'Ada',
      email: 'ada@ejemplo.test',
      role: 'employee',
      job_title: 'SDR',
      department: 'Sales',
      phone: '600',
      start_date: '2026-01-15',
      schedule: 'Mon-Fri',
    }]);
    expect(row).toMatchObject({
      nombre: 'Ada',
      email: 'ada@ejemplo.test',
      rol: 'empleado',
      puesto: 'SDR',
      area: 'Sales',
      telefono: '600',
      fecha: '2026-01-15',
      horario: 'Mon-Fri',
    });
  });
});

describe('errores e invitaciones según el idioma', () => {
  it('traduce una invitación inexistente por Accept-Language', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/invitaciones/NO-EXISTE',
      headers: { 'accept-language': 'en' },
    });
    const body = response.json();
    expect(response.statusCode).toBe(404);
    expect(body.code).toBe('invite.expired');
    expect(body.error).toBe('The invitation is not valid or has expired');
  });

  it('el idioma del perfil manda sobre Accept-Language y el de la empresa sobre la cabecera', async () => {
    const stamp = Date.now();
    const french = await app.inject({
      method: 'POST',
      url: '/api/auth/registro',
      payload: { name: 'Francine', email: `fr-${stamp}@idioma.test`, password: 'clave-segura', companyName: `FR ${stamp}` },
    });
    const german = await app.inject({
      method: 'POST',
      url: '/api/auth/registro',
      payload: { name: 'Greta', email: `de-${stamp}@idioma.test`, password: 'clave-segura', companyName: `DE ${stamp}` },
    });
    expect(french.statusCode).toBe(200);
    const frUser = await prisma.user.findUniqueOrThrow({ where: { email: `fr-${stamp}@idioma.test` }, include: { memberships: true } });
    await prisma.user.update({ where: { id: frUser.id }, data: { locale: 'fr' } });
    const frResponse = await app.inject({
      method: 'GET',
      url: '/api/invitaciones/NO-EXISTE',
      headers: { authorization: `Bearer ${french.json().token}`, 'accept-language': 'en' },
    });
    expect(frResponse.json().error).toBe("L'invitation n'est pas valable ou a expiré");

    const deUser = await prisma.user.findUniqueOrThrow({ where: { email: `de-${stamp}@idioma.test` }, include: { memberships: true } });
    await prisma.user.update({ where: { id: deUser.id }, data: { locale: null } });
    await prisma.company.update({ where: { id: deUser.memberships[0].companyId }, data: { locale: 'de' } });
    const deResponse = await app.inject({
      method: 'GET',
      url: '/api/invitaciones/NO-EXISTE',
      headers: { authorization: `Bearer ${german.json().token}`, 'accept-language': 'en' },
    });
    expect(deResponse.json().error).toBe('Die Einladung ist ungültig oder abgelaufen');
  });

  it('guarda el idioma en la invitación', async () => {
    const stamp = Date.now();
    const created = await app.inject({
      method: 'POST',
      url: '/api/auth/registro',
      payload: { name: 'Ida', email: `inv-${stamp}@idioma.test`, password: 'clave-segura', companyName: `Inv ${stamp}` },
    });
    const token = created.json().token as string;
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `inv-${stamp}@idioma.test` } });
    await prisma.user.update({ where: { id: user.id }, data: { locale: 'en' } });
    const invite = await app.inject({
      method: 'POST',
      url: '/api/invitaciones',
      headers: { authorization: `Bearer ${token}`, 'accept-language': 'de' },
      payload: { email: `guest-${stamp}@idioma.test`, role: 'empleado' },
    });
    expect(invite.statusCode).toBe(200);
    expect(invite.json().locale).toBe('en');
    expect(invite.json().plantilla.subject).not.toBe(renderEmail('es', 'invite', { company: 'x', link: 'y', name: 'z', email: 'z' }).subject);
    const code = invite.json().code as string;
    const loaded = await app.inject({ method: 'GET', url: `/api/invitaciones/${code}` });
    expect(loaded.json().locale).toBe('en');
  });
});
