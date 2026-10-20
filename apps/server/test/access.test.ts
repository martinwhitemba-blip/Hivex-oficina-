import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requestAllowed } from '../src/accessGate';
import { buildApp } from '../src/app';

const USER = 'hivex';
const PASSWORD = 'secreto-beta';

function basic(user: string, password: string) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

describe('puerta de acceso', () => {
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let port = 0;

  beforeAll(async () => {
    process.env.ACCESS_USER = USER;
    process.env.ACCESS_PASSWORD = PASSWORD;
    const built = await buildApp();
    app = built.app;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    port = typeof address === 'object' && address ? address.port : 0;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.ACCESS_USER;
    delete process.env.ACCESS_PASSWORD;
  });

  it('deja pasar la salud sin contraseña y cierra el resto', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/salud' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['www-authenticate']).toBeUndefined();

    const closed = await app.inject({ method: 'GET', url: '/api/auth/yo' });
    expect(closed.statusCode).toBe(401);
    expect(String(closed.headers['www-authenticate'])).toContain('HIVEX beta');

    const wrong = await app.inject({
      method: 'GET',
      url: '/api/auth/yo',
      headers: { authorization: basic(USER, 'no-es') },
    });
    expect(wrong.statusCode).toBe(401);
    expect(String(wrong.headers['www-authenticate'])).toContain('HIVEX beta');

    const open = await app.inject({
      method: 'GET',
      url: '/api/auth/yo',
      headers: { authorization: basic(USER, PASSWORD) },
    });
    expect(open.headers['www-authenticate']).toBeUndefined();
    expect(open.json().error).not.toBe('Acceso restringido');
  });

  it('pide la contraseña también al abrir el WebSocket', async () => {
    const denied = await upgrade(port);
    expect(denied.status).toBe(401);
    expect(denied.authenticate).toContain('HIVEX beta');

    const allowed = await upgrade(port, basic(USER, PASSWORD));
    expect(allowed.status).not.toBe(401);
  });

  it('no pide contraseña si faltan las variables', () => {
    delete process.env.ACCESS_USER;
    delete process.env.ACCESS_PASSWORD;
    expect(requestAllowed({ url: '/api/areas', headers: {} })).toBe(true);
    process.env.ACCESS_USER = USER;
    process.env.ACCESS_PASSWORD = PASSWORD;
    expect(requestAllowed({ url: '/api/areas', headers: {} })).toBe(false);
  });
});

function upgrade(port: number, authorization?: string) {
  return new Promise<{ status: number; authenticate: string }>((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/socket.io/?EIO=4&transport=websocket',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...(authorization ? { authorization } : {}),
      },
    });
    req.on('upgrade', (res) => {
      resolve({ status: res.statusCode || 101, authenticate: String(res.headers['www-authenticate'] || '') });
      req.destroy();
    });
    req.on('response', (res) => {
      resolve({ status: res.statusCode || 0, authenticate: String(res.headers['www-authenticate'] || '') });
      res.resume();
    });
    req.on('error', reject);
    req.end();
  });
}
