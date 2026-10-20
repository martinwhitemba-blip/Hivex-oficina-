import fs from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { ACCESS_REALM, installAccessGate, requestAllowed } from './accessGate';
import { allowedOrigins, env } from './env';
import { HttpError } from './http';
import { registerRoutes } from './routes';
import { attachSocket } from './socket';

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
      .send({ error: 'Acceso restringido' });
  });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  fs.mkdirSync(env.uploadDir, { recursive: true });
  await app.register(fastifyStatic, { root: env.uploadDir, prefix: '/uploads/', decorateReply: false });
  registerRoutes(app);

  if (env.serveStatic && fs.existsSync(env.webDist)) {
    await app.register(fastifyStatic, { root: env.webDist, prefix: '/', decorateReply: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/socket.io') || req.url.startsWith('/uploads')) {
        return reply.code(404).send({ error: 'No encontrado' });
      }
      return reply.type('text/html').send(fs.readFileSync(path.join(env.webDist, 'index.html')));
    });
  }

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message });
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode || 500;
    if (status >= 500) app.log.error(error);
    const message = status >= 500 ? 'Error interno del servidor' : (err.message || 'Error');
    return reply.code(status).send({ error: message });
  });

  const io = new Server(app.server, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        cb(null, origins().has(origin.replace(/\/$/, '')));
      },
    },
  });
  attachSocket(io);
  installAccessGate(app.server);
  return { app, io };
}
