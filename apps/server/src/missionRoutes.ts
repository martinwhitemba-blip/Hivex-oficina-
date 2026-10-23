import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFromRequest, parseBody } from './http';
import { createGoal, deleteGoal, getGoal, listGoals, updateGoal } from './missions';

export function registerMissionRoutes(app: FastifyInstance) {
  app.get('/api/misiones', async (req) => {
    const actor = await actorFromRequest(req);
    const query = req.query as { semana?: string; todas?: string };
    return listGoals(actor, { semana: query.semana, todas: query.todas === '1' });
  });

  app.get('/api/misiones/:id', async (req) => {
    const actor = await actorFromRequest(req);
    return getGoal(actor, (req.params as { id: string }).id);
  });

  app.post('/api/misiones', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({
      title: z.string().trim().min(2, 'Escribe el nombre de la misión'),
      metric: z.string(),
      target: z.number(),
      rewardPoints: z.number().int().min(0).max(500).optional(),
      weekStart: z.string().optional(),
      areaId: z.string().nullable().optional(),
      membershipId: z.string().nullable().optional(),
      kpiKey: z.string().nullable().optional(),
    }), req.body);
    return createGoal(actor, body);
  });

  app.patch('/api/misiones/:id', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({
      current: z.number().min(0).optional(),
      title: z.string().trim().min(2, 'Escribe el nombre de la misión').optional(),
      target: z.number().optional(),
    }), req.body);
    return updateGoal(actor, (req.params as { id: string }).id, body);
  });

  app.delete('/api/misiones/:id', async (req) => {
    const actor = await actorFromRequest(req);
    return deleteGoal(actor, (req.params as { id: string }).id);
  });
}
