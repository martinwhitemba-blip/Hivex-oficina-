import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFromRequest, parseBody } from './http';
import { cafeHome, playCafe } from './cafe';
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
}
