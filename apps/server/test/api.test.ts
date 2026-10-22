import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { ensurePlans } from '../src/billing';
import { prisma } from '../src/prisma';
import { resetJoinRate } from '../src/rateLimit';

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

  it('abre la oficina con un código, respeta el plan y no duplica a quien ya está', async () => {
    resetJoinRate();
    const owner = await json('POST', '/api/auth/registro', undefined, {
      name: 'Clara Dueña', email: 'clara@codigo.test', password: 'clave-segura', companyName: 'Codigo SA',
    });
    expect(owner.status).toBe(200);
    const token = owner.body.token as string;
    const before = await json('GET', '/api/empresa/codigo-acceso', token);
    expect(before.status).toBe(200);
    expect(before.body.code).toBeNull();

    const created = await json('POST', '/api/empresa/codigo-acceso/regenerar', token);
    expect(created.status).toBe(200);
    const code = created.body.code as string;
    expect(created.body.enabled).toBe(true);
    expect(created.body.enlace).toContain(`#/codigo?c=${code}`);

    const joined = await json('POST', '/api/acceso-codigo', undefined, {
      code, name: 'Nuria Código', email: 'nuria@codigo.test', password: 'clave-segura',
    });
    expect(joined.status).toBe(200);
    const again = await json('POST', '/api/acceso-codigo', undefined, {
      code: code.toLowerCase(), name: 'Nuria Código', email: 'nuria@codigo.test', password: 'clave-segura',
    });
    expect(again.status).toBe(200);
    const memberships = await prisma.membership.findMany({ where: { user: { email: 'nuria@codigo.test' } } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('empleado');
    expect(memberships[0].areaId).toBeNull();
    expect(memberships[0].jobTitleId).toBeNull();

    const badPass = await json('POST', '/api/acceso-codigo', undefined, {
      code, name: 'Nuria Código', email: 'nuria@codigo.test', password: 'otra-clave-1',
    });
    expect(badPass.status).toBe(401);

    const employee = await json('GET', '/api/empresa/codigo-acceso', joined.body.token);
    expect(employee.status).toBe(403);

    const adminInvite = await json('POST', '/api/invitaciones', token, { email: 'admin@codigo.test', role: 'administrador' });
    expect(adminInvite.status).toBe(200);
    const adminAccept = await json('POST', `/api/invitaciones/${adminInvite.body.code}/aceptar`, undefined, { name: 'Admin Código', password: 'clave-segura' });
    expect(adminAccept.status).toBe(200);
    const adminSee = await json('GET', '/api/empresa/codigo-acceso', adminAccept.body.token);
    expect(adminSee.status).toBe(200);

    const off = await json('PATCH', '/api/empresa/codigo-acceso', token, { enabled: false });
    expect(off.body.enabled).toBe(false);
    const closed = await json('POST', '/api/acceso-codigo', undefined, {
      code, name: 'Otro', email: 'otro@codigo.test', password: 'clave-segura',
    });
    expect(closed.status).toBe(404);
    expect(String(closed.body.error)).toContain('desactivado');

    const kept = await json('POST', '/api/empresa/codigo-acceso/regenerar', token);
    expect(kept.body.enabled).toBe(false);
    expect(kept.body.code).not.toBe(code);
    await json('PATCH', '/api/empresa/codigo-acceso', token, { enabled: true });

    const foreign = await json('POST', '/api/acceso-codigo', undefined, {
      code: kept.body.code, name: 'Ana', email: 'ana@empresa-a.test', password: 'clave-segura',
    });
    expect(foreign.status).toBe(409);

    const company = await prisma.company.findFirst({ where: { name: 'Codigo SA' }, include: { subscription: true } });
    await prisma.plan.update({ where: { id: company!.subscription!.planId }, data: { maxWorkers: 3 } });
    const overflow = await json('POST', '/api/acceso-codigo', undefined, {
      code: kept.body.code, name: 'Extra Código', email: 'extra.codigo@codigo.test', password: 'clave-segura',
    });
    expect(overflow.status).toBe(409);
    expect(String(overflow.body.error)).toContain('plan');

    await prisma.plan.update({ where: { id: company!.subscription!.planId }, data: { maxWorkers: 1 } });
    await prisma.company.create({
      data: {
        name: 'Demo Código',
        slug: 'demo-codigo',
        apiKey: 'hx_demo_codigo_test',
        isDemo: true,
        joinCode: 'HIVEXTEST',
        joinCodeEnabled: true,
      },
    });
    const demoJoin = await json('POST', '/api/acceso-codigo', undefined, {
      code: 'hivextest', name: 'Visitante Demo', email: 'visita@demo-codigo.test', password: 'clave-segura',
    });
    expect(demoJoin.status).toBe(200);
    await prisma.plan.update({ where: { id: company!.subscription!.planId }, data: { maxWorkers: 8 } });

    resetJoinRate();
    let limited = 0;
    for (let i = 0; i < 22; i += 1) {
      const hit = await app.inject({
        method: 'POST',
        url: '/api/acceso-codigo',
        payload: { code: 'NOEXISTE', name: 'Alguien', email: `x${i}@rate.test`, password: 'clave-segura' },
        headers: { 'x-forwarded-for': '203.0.113.9' },
      });
      if (hit.statusCode === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    resetJoinRate();
  });

  it('crea cuentas una a una o por archivo, con enlace o clave temporal', async () => {
    const owner = await json('POST', '/api/auth/registro', undefined, {
      name: 'Olga Dueña', email: 'olga@import.test', password: 'clave-segura', companyName: 'Import SA',
    });
    expect(owner.status).toBe(200);
    const token = owner.body.token as string;
    const area = await json('POST', '/api/areas', token, { name: 'Ventas', color: '#F5C518' });
    expect(area.status).toBe(200);

    const missing = await json('POST', '/api/empleados', token, {
      nombre: 'Sin Zona', email: 'sinzona@import.test', rol: 'empleado', area: 'Inventada', modo: 'enlace', crearFaltantes: false,
    });
    expect(missing.status).toBe(400);
    expect(String(missing.body.error)).toContain('no existe');

    const one = await json('POST', '/api/empleados', token, {
      nombre: 'Nora López', email: 'nora@import.test', rol: 'empleado', area: 'Ventas', puesto: 'SDR',
      telefono: '600111222', fecha_inicio: '2026-02-01', horario: 'L–V 09:00–18:00', modo: 'enlace', crearFaltantes: true,
    });
    expect(one.status).toBe(200);
    expect(one.body.creados).toHaveLength(1);
    expect(one.body.creados[0].enlace).toContain('#/activar?code=');
    expect(one.body.creados[0].contrasena).toBe('');
    expect(one.body.creados[0].deskId).toBe('atlas-0');
    expect(one.body.csv).toContain('nora@import.test');

    const duplicate = await json('POST', '/api/empleados', token, {
      nombre: 'Nora Otra', email: 'nora@import.test', rol: 'empleado', area: 'Ventas', modo: 'enlace',
    });
    expect(duplicate.status).toBe(400);
    expect(String(duplicate.body.error)).toContain('ya está en tu empresa');

    const other = await json('POST', '/api/auth/registro', undefined, {
      name: 'Paco Dueño', email: 'paco@import.test', password: 'clave-segura', companyName: 'Import B',
    });
    const stolen = await json('POST', '/api/empleados', other.body.token, {
      nombre: 'Nora Ajena', email: 'nora@import.test', rol: 'empleado', modo: 'enlace',
    });
    expect(stolen.status).toBe(400);
    expect(String(stolen.body.error)).toContain('otra empresa');
    const hidden = await json('GET', '/api/empleados', other.body.token);
    expect(hidden.body.some((person: { name: string }) => person.name === 'Nora López')).toBe(false);

    const code = String(one.body.creados[0].enlace).split('code=')[1];
    const preview = await json('GET', `/api/activar/${code}`);
    expect(preview.status).toBe(200);
    expect(preview.body.email).toBe('nora@import.test');
    expect(preview.body.empresa).toBe('Import SA');
    const activated = await json('POST', '/api/activar', undefined, { code, password: 'clave-nueva' });
    expect(activated.status).toBe(200);
    const again = await json('POST', '/api/activar', undefined, { code, password: 'clave-nueva' });
    expect(again.status).toBe(404);
    const nora = await json('GET', '/api/auth/yo', activated.body.token);
    expect(nora.body.membership.name).toBe('Nora López');
    expect(nora.body.debeCambiarContrasena).toBe(false);
    const peek = await json('GET', `/api/empleados/${nora.body.membership.id}`, other.body.token);
    expect(peek.status).toBe(404);
    const denied = await json('POST', '/api/empleados', activated.body.token, {
      nombre: 'Intrusa', email: 'intrusa@import.test', rol: 'empleado', modo: 'enlace',
    });
    expect(denied.status).toBe(403);

    const csv = [
      'nombre,email,rol,puesto,area',
      'Mal,no-es-correo,empleado,SDR,Ventas',
      'Nora López,nora@import.test,empleado,SDR,Ventas',
      'Iria Costa,iria@import.test,empleado,SDR,Inventada',
      'Hugo Admin,hugo.admin@import.test,administrador,Director,Ventas',
    ].join('\n');
    const imported = await app.inject({
      method: 'POST',
      url: '/api/empleados/importar',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=----hx' },
      payload: [
        '------hx',
        'Content-Disposition: form-data; name="modo"',
        '',
        'temporal',
        '------hx',
        'Content-Disposition: form-data; name="crearFaltantes"',
        '',
        'si',
        '------hx',
        'Content-Disposition: form-data; name="file"; filename="equipo.csv"',
        'Content-Type: text/csv',
        '',
        csv,
        '------hx--',
        '',
      ].join('\r\n'),
    });
    const importedBody = imported.json() as { creados: { email: string; contrasena: string; enlace: string; deskId: string | null }[]; errores: { email: string; mensaje: string }[] };
    expect(imported.statusCode).toBe(200);
    const emails = importedBody.creados.map((row) => row.email).sort();
    expect(emails).toEqual(['hugo.admin@import.test', 'iria@import.test']);
    expect(importedBody.creados.every((row) => row.contrasena.startsWith('Hivex-') && row.enlace === '')).toBe(true);
    expect(importedBody.errores.some((issue) => issue.email === 'no-es-correo')).toBe(true);
    expect(importedBody.errores.some((issue) => issue.mensaje.includes('repetido') || issue.email === 'nora@import.test')).toBe(true);
    const iria = importedBody.creados.find((row) => row.email === 'iria@import.test');
    expect(iria?.deskId).toBeTruthy();

    const hugo = importedBody.creados.find((row) => row.email === 'hugo.admin@import.test')!;
    const tempLogin = await json('POST', '/api/auth/entrar', undefined, { email: 'hugo.admin@import.test', password: hugo.contrasena });
    expect(tempLogin.status).toBe(200);
    expect(tempLogin.body.debeCambiarContrasena).toBe(true);
    const blocked = await json('GET', '/api/oficina/hud', tempLogin.body.token);
    expect(blocked.status).toBe(403);
    expect(String(blocked.body.error)).toContain('temporal');
    const changed = await json('POST', '/api/auth/cambiar-clave', tempLogin.body.token, { actual: hugo.contrasena, nueva: 'clave-nueva' });
    expect(changed.status).toBe(200);
    const open = await json('GET', '/api/oficina/hud', tempLogin.body.token);
    expect(open.status).toBe(200);
    const directory = open.body.directory as { name: string; deskId: string | null; status: string }[];
    expect(directory.some((person) => person.name === 'Iria Costa' && person.deskId && person.status === 'desconectado')).toBe(true);

    const plan = await prisma.plan.findUnique({ where: { code: 'starter' } });
    await prisma.plan.update({ where: { id: plan!.id }, data: { maxWorkers: 200 } });
    try {
      const lines = ['nombre,email,rol,area'];
      for (let i = 0; i < 41; i += 1) lines.push(`Lote ${i},lote${i}@import.test,empleado,Ventas`);
      const bulk = await app.inject({
        method: 'POST',
        url: '/api/empleados/importar',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=----hx' },
        payload: [
          '------hx',
          'Content-Disposition: form-data; name="modo"',
          '',
          'enlace',
          '------hx',
          'Content-Disposition: form-data; name="file"; filename="lote.csv"',
          'Content-Type: text/csv',
          '',
          lines.join('\n'),
          '------hx--',
          '',
        ].join('\r\n'),
      });
      const bulkBody = bulk.json() as { creados: unknown[]; errores: unknown[] };
      expect(bulk.statusCode).toBe(200);
      expect(bulkBody.creados).toHaveLength(41);
      expect(bulkBody.errores).toHaveLength(0);
    } finally {
      await prisma.plan.update({ where: { id: plan!.id }, data: { maxWorkers: 8 } });
    }

    await prisma.plan.update({ where: { id: plan!.id }, data: { maxWorkers: 1 } });
    try {
      const capped = await json('POST', '/api/empleados', token, {
        nombre: 'Extra Límite', email: 'extra.limite@import.test', rol: 'empleado', modo: 'enlace',
      });
      expect(capped.status).toBe(400);
      expect(String(capped.body.error)).toContain('plan');
    } finally {
      await prisma.plan.update({ where: { id: plan!.id }, data: { maxWorkers: 8 } });
    }
  }, 60000);

  it('aísla la marca de cada empresa y rechaza colores que no se leen', async () => {
    const a = await json('POST', '/api/auth/registro', undefined, {
      name: 'Marta Marca', email: 'marta@marca.test', password: 'clave-segura', companyName: 'Marca A',
    });
    const b = await json('POST', '/api/auth/registro', undefined, {
      name: 'Boris Marca', email: 'boris@marca.test', password: 'clave-segura', companyName: 'Marca B',
    });
    const tokenA = a.body.token as string;
    const tokenB = b.body.token as string;
    const dark = await json('PATCH', '/api/marca', tokenA, { nombre: 'Acme', oficina: 'Oficina Acme', primario: '#111111', acento: '#22C55E' });
    expect(dark.status).toBe(400);
    expect(String(dark.body.error)).toContain('no se lee');
    const saved = await json('PATCH', '/api/marca', tokenA, { nombre: 'Acme', oficina: 'Oficina Acme', primario: '#22C55E', acento: '#38BDF8' });
    expect(saved.status).toBe(200);
    expect(saved.body.nombre).toBe('Acme');
    expect(saved.body.oficina).toBe('Oficina Acme');
    expect(saved.body.poweredBy).toBe('HIVEX');
    const other = await json('GET', '/api/marca', tokenB);
    expect(other.body.nombre).toBe('Marca B');
    expect(other.body.oficina).not.toBe('Oficina Acme');
    expect(other.body.primario).toBe('#F5C518');

    const code = await json('POST', '/api/empresa/codigo-acceso/regenerar', tokenA);
    const pub = await json('GET', `/api/marca/codigo/${code.body.code}`);
    expect(pub.status).toBe(200);
    expect(pub.body.nombre).toBe('Acme');
    expect(pub.body.oficina).toBe('Oficina Acme');
    const missing = await json('GET', '/api/marca/codigo/NOEXISTE');
    expect(missing.status).toBe(404);

    const invite = await json('POST', '/api/invitaciones', tokenA, { email: 'empleado@marca.test', role: 'empleado' });
    const accepted = await json('POST', `/api/invitaciones/${invite.body.code}/aceptar`, undefined, { name: 'Emple Marca', password: 'clave-segura' });
    const forbidden = await json('PATCH', '/api/marca', accepted.body.token, { nombre: 'Hack', oficina: 'Hack', primario: '#22C55E', acento: '#38BDF8' });
    expect(forbidden.status).toBe(403);
    const still = await json('GET', '/api/marca', tokenB);
    expect(still.body.nombre).toBe('Marca B');

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const logo = await app.inject({
      method: 'POST',
      url: '/api/marca/logo',
      headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'multipart/form-data; boundary=----hx' },
      payload: Buffer.concat([
        Buffer.from('------hx\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n'),
        png,
        Buffer.from('\r\n------hx--\r\n'),
      ]),
    });
    const logoBody = logo.json() as { logoUrl: string | null; nombre: string };
    expect(logo.statusCode).toBe(200);
    expect(logoBody.logoUrl).toContain('/uploads/');
    expect(logoBody.nombre).toBe('Acme');
    const leaked = await json('GET', '/api/marca', tokenB);
    expect(leaked.body.logoUrl).toBeNull();
  });

  it('pagina el equipo y no deja escribir en otra empresa', async () => {
    const owner = await json('POST', '/api/auth/entrar', undefined, { email: 'ana@empresa-a.test', password: 'clave-segura' });
    const other = await json('POST', '/api/auth/entrar', undefined, { email: 'beto@empresa-b.test', password: 'clave-segura' });
    const full = await json('GET', '/api/empleados', owner.body.token);
    expect(Array.isArray(full.body)).toBe(true);
    expect(full.body.length).toBeGreaterThan(1);
    const page = await json('GET', '/api/empleados?take=1', owner.body.token);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.next).toBeTruthy();
    const next = await json('GET', `/api/empleados?take=1&cursor=${page.body.next}`, owner.body.token);
    expect(next.body.items).toHaveLength(1);
    expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
    const hack = await json('PATCH', `/api/empleados/${full.body[0].id}`, other.body.token, { name: 'Robado' });
    expect(hack.status).toBe(404);
    const chat = await json('GET', '/api/chat?take=5', owner.body.token);
    expect(Array.isArray(chat.body.items)).toBe(true);
    const legacy = await json('GET', '/api/chat', owner.body.token);
    expect(Array.isArray(legacy.body)).toBe(true);
  });
});
