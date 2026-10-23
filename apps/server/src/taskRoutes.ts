import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFromRequest, parseBody } from './http';
import {
  addComment,
  createSubtask,
  createTask,
  deleteComment,
  deleteTask,
  getTask,
  listComments,
  listTasks,
  updateTask,
  type TaskPriority,
  type TaskStatus,
} from './taskBoard';

const priority = z.enum(['baja', 'media', 'alta']);
const status = z.enum(['pendiente', 'en_curso', 'hecho']);

function cleanQuery(query: unknown) {
  const src = query && typeof query === 'object' ? query as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(src)) {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string' && raw.trim()) out[key] = raw.trim();
  }
  return out;
}

export function registerTaskRoutes(app: FastifyInstance) {
  app.get('/api/tareas', async (req) => {
    const actor = await actorFromRequest(req);
    const query = parseBody(z.object({
      vista: z.enum(['tablero', 'lista']).optional(),
      areaId: z.string().optional(),
      assigneeId: z.string().optional(),
      prioridad: priority.optional(),
      vence: z.string().optional(),
      vencidas: z.enum(['0', '1']).optional(),
      estado: status.optional(),
      orden: z.enum(['dueDate', 'priority', 'assignee', 'area', 'title', 'updatedAt', 'sort']).optional(),
      dir: z.enum(['asc', 'desc']).optional(),
    }), cleanQuery(req.query));
    return listTasks(actor, {
      vista: query.vista,
      areaId: query.areaId,
      assigneeId: query.assigneeId,
      prioridad: query.prioridad as TaskPriority | undefined,
      vence: query.vence,
      vencidas: query.vencidas === '1',
      estado: query.estado as TaskStatus | undefined,
      orden: query.orden,
      dir: query.dir,
    });
  });

  app.post('/api/tareas', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({
      title: z.string().trim().min(2, 'Escribe el título'),
      description: z.string().default(''),
      areaId: z.string(),
      assigneeId: z.string().nullable().optional(),
      status: status.default('pendiente'),
      priority: priority.default('media'),
      dueDate: z.string().nullable().optional(),
      sort: z.number().int().min(0).max(9999).optional(),
      weeklyGoalId: z.string().nullable().optional(),
    }), req.body);
    return createTask(actor, body);
  });

  app.get('/api/tareas/:id', async (req) => {
    const actor = await actorFromRequest(req);
    return getTask(actor, (req.params as { id: string }).id);
  });

  app.patch('/api/tareas/:id', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({
      title: z.string().trim().min(2, 'Escribe el título').optional(),
      description: z.string().optional(),
      status: status.optional(),
      assigneeId: z.string().nullable().optional(),
      priority: priority.optional(),
      dueDate: z.string().nullable().optional(),
      sort: z.number().int().min(0).max(9999).optional(),
      weeklyGoalId: z.string().nullable().optional(),
    }), req.body);
    const result = await updateTask(actor, (req.params as { id: string }).id, body);
    return result.task;
  });

  app.delete('/api/tareas/:id', async (req) => {
    const actor = await actorFromRequest(req);
    return deleteTask(actor, (req.params as { id: string }).id);
  });

  app.post('/api/tareas/:id/subtareas', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({
      title: z.string().trim().min(2, 'Escribe el título'),
      assigneeId: z.string().nullable().optional(),
      priority: priority.optional(),
      dueDate: z.string().nullable().optional(),
      sort: z.number().int().min(0).max(9999).optional(),
    }), req.body);
    return createSubtask(actor, (req.params as { id: string }).id, body);
  });

  app.get('/api/tareas/:id/comentarios', async (req) => {
    const actor = await actorFromRequest(req);
    return listComments(actor, (req.params as { id: string }).id);
  });

  app.post('/api/tareas/:id/comentarios', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({
      body: z.string().trim().min(1, 'Escribe un comentario'),
      mentions: z.array(z.string()).max(20).optional(),
    }), req.body);
    const saved = await addComment(actor, (req.params as { id: string }).id, body.body, body.mentions || []);
    return saved.comment;
  });

  app.delete('/api/tareas/:id/comentarios/:commentId', async (req) => {
    const actor = await actorFromRequest(req);
    const params = req.params as { id: string; commentId: string };
    return deleteComment(actor, params.id, params.commentId);
  });
}