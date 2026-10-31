import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFromRequest, parseBody } from './http';
import { listNotifications, markNotificationsRead, remindDue, unreadCount } from './notify';

export function registerNotifyRoutes(app: FastifyInstance) {
  app.get('/api/notificaciones/contador', async (req) => {
    const actor = await actorFromRequest(req);
    await remindDue(actor);
    return { unread: await unreadCount(actor.company.id, actor.membership.id) };
  });

  app.get('/api/notificaciones', async (req) => {
    const actor = await actorFromRequest(req);
    const take = Number((req.query as { take?: string }).take || 40);
    return listNotifications(actor, take);
  });

  app.post('/api/notificaciones/leidas', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({
      ids: z.array(z.string()).max(80).optional(),
    }), req.body ?? {});
    return markNotificationsRead(actor, body.ids);
  });
}
