import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { actorFromRequest, HttpError, parseBody } from './http';
import { cafeHome, playCafe } from './cafe';
import { addTaskFile, listTaskFiles, loadTaskFile, removeTaskFile } from './taskFiles';
import { addOwnedCompany, createHolding, joinHolding, portfolioView, removeFromHolding } from './portfolio';

export function registerPhase3Routes(app: FastifyInstance) {
  app.get('/api/portafolio', async (req) => portfolioView(await actorFromRequest(req)));

  app.post('/api/portafolio', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({ name: z.string().trim().min(2).max(80) }), req.body);
    return createHolding(actor, body.name);
  });

  app.post('/api/portafolio/empresas', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({ companyId: z.string().min(1) }), req.body);
    return addOwnedCompany(actor, body.companyId);
  });

  app.delete('/api/portafolio/empresas/:companyId', async (req) => {
    const actor = await actorFromRequest(req);
    return removeFromHolding(actor, (req.params as { companyId: string }).companyId);
  });

  app.post('/api/portafolio/unirse', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({ code: z.string().trim().min(4).max(16) }), req.body);
    return joinHolding(actor, body.code);
  });

  app.get('/api/cafe', async (req) => cafeHome(await actorFromRequest(req)));

  app.post('/api/cafe/jugar', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({
      game: z.enum(['taza', 'memoria']),
      elapsedMs: z.number().int().min(0).max(60_000).optional(),
      moves: z.number().int().min(0).max(80).optional(),
    }), req.body);
    return playCafe(actor, body);
  });

  app.get('/api/tareas/:id/archivos', async (req) => listTaskFiles(await actorFromRequest(req), (req.params as { id: string }).id));

  app.post('/api/tareas/:id/archivos', async (req) => {
    const actor = await actorFromRequest(req);
    const file = await req.file();
    if (!file) throw new HttpError(400, 'Ese archivo no se puede adjuntar. Usa PNG, JPG, WebP, PDF, TXT o CSV, hasta 4 MB.', 'errors.phase3.file');
    const bytes = await file.toBuffer();
    return addTaskFile(actor, (req.params as { id: string }).id, { name: file.filename, mime: file.mimetype, bytes });
  });

  app.get('/api/tareas/:id/archivos/:fileId', async (req, reply) => {
    const actor = await actorFromRequest(req);
    const params = req.params as { id: string; fileId: string };
    const loaded = await loadTaskFile(actor, params.id, params.fileId);
    return sendBytes(reply, loaded.row.mime, loaded.row.name, loaded.bytes);
  });

  app.delete('/api/tareas/:id/archivos/:fileId', async (req) => {
    const actor = await actorFromRequest(req);
    const params = req.params as { id: string; fileId: string };
    return removeTaskFile(actor, params.id, params.fileId);
  });
}

function sendBytes(reply: FastifyReply, mime: string, name: string, bytes: Buffer) {
  const ascii = name.replace(/[^\w.\- ]+/g, '') || 'archivo';
  return reply
    .header('content-type', mime)
    .header('content-disposition', `attachment; filename="${ascii}"`)
    .header('cache-control', 'private, no-store')
    .send(bytes);
}
