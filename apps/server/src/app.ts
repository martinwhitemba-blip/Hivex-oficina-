import fs from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { ACCESS_REALM, installAccessGate, requestAllowed } from './accessGate';
import { allowedOrigins, env } from './env';
import { replyError } from './http';
import { localeForRequest } from './locale';
import { resolveLocale, translate } from '../../../packages/i18n/src/index';
import { registerRoutes } from './routes';
import { attachSocket } from './socket';

async function attachRedis(io: Server) {
  const url = process.env.REDIS_URL;
  if (!url) return;
  const { createClient } = await import('redis');
  const { createAdapter } = await import('@socket.io/redis-adapter');
  const pub = createClient({ url });
  const sub = pub.duplicate();
  await pub.connect();
  await sub.connect();
  io.adapter(createAdapter(pub, sub));
}

export async function buildApp() {
  const app = Fastify({ logger: env.nodeEnv !== 'test', bodyLimit: 8 * 1024 * 1024 });
  const origins = () => allowedOrigins();
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, origins().has(origin.replace(/\/$/, '')));
    },
  });
  app.addHook('onRequest', async (req, reply) => {
    if (requestAllowed(req.raw)) return;
    return reply
      .code(401)
      .header('WWW-Authenticate', `Basic realm="${ACCESS_REALM}", charset="UTF-8"`)
      .send({
        error: translate(resolveLocale({ acceptLanguage: typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'] : null }), 'errors.access.denied'),
        code: 'access.denied',
      });
  });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  fs.mkdirSync(env.uploadDir, { recursive: true });
  await app.register(fastifyStatic, { root: env.uploadDir, prefix: '/uploads/', decorateReply: false });
  registerRoutes(app);

  if (env.serveStatic && fs.existsSync(env.webDist)) {
    await app.register(fastifyStatic, { root: env.webDist, prefix: '/', decorateReply: false, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      const pathName = req.url.split('?')[0];
      if (pathName.startsWith('/api') || pathName.startsWith('/socket.io') || pathName.startsWith('/uploads')) {
        const locale = resolveLocale({ acceptLanguage: typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'] : null });
        return reply.code(404).send({ error: translate(locale, 'errors.notFound'), code: 'notFound' });
      }
      // Una ruta de la aplicación (#/unirse, /codigo, …) no es un archivo.
      // Responder 200 con el index evita el HTML "Not Found" de Fastify.
      return reply.code(200).type('text/html').send(fs.readFileSync(path.join(env.webDist, 'index.html')));
    });
  }

  app.setErrorHandler(async (error, req, reply) => {
    const locale = await localeForRequest(req).catch(() => 'es' as const);
    if (typeof error === 'object' && error && 'statusCode' in error && Number((error as { statusCode?: number }).statusCode) >= 500) app.log.error(error);
    return replyError(error, reply, locale);
  });

  const io = new Server(app.server, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        cb(null, origins().has(origin.replace(/\/$/, '')));
      },
    },
  });
  await attachRedis(io);
  attachSocket(io);
  installAccessGate(app.server);
  return { app, io };
}
