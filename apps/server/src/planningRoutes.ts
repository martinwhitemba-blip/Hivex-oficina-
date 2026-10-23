import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFromRequest, HttpError, parseBody } from './http';
import {
  addDependency,
  allowPublicPost,
  calendar,
  createField,
  createForm,
  createRule,
  createTemplate,
  deleteField,
  deleteRule,
  listFields,
  listForms,
  listRules,
  listTemplates,
  loadView,
  publicForm,
  removeDependency,
  saveFieldValues,
  saveStatus,
  setFormActive,
  setRuleEnabled,
  submitPublicForm,
  useTemplate,
  weekStatus,
  writeDraft,
} from './planning';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe ser AAAA-MM-DD');

export function registerPlanningRoutes(app: FastifyInstance) {
  app.get('/api/plan/calendario', async (req) => {
    const actor = await actorFromRequest(req);
    const query = parseBody(z.object({
      desde: day,
      hasta: day,
      areaId: z.string().optional(),
    }), clean(req.query));
    return calendar(actor, query);
  });

  app.get('/api/plan/carga', async (req) => loadView(await actorFromRequest(req)));

  app.post('/api/plan/dependencias', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({ taskId: z.string(), dependsOnId: z.string() }), req.body);
    return addDependency(actor, body.taskId, body.dependsOnId);
  });

  app.delete('/api/plan/dependencias', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({ taskId: z.string(), dependsOnId: z.string() }), req.body);
    return removeDependency(actor, body.taskId, body.dependsOnId);
  });

  app.get('/api/plan/campos', async (req) => {
    const actor = await actorFromRequest(req);
    const query = parseBody(z.object({ areaId: z.string() }), clean(req.query));
    return listFields(actor, query.areaId);
  });

  app.post('/api/plan/campos', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({
      areaId: z.string(),
      label: z.string().trim().min(2, 'Escribe el nombre del campo'),
      kind: z.enum(['texto', 'numero', 'opcion']),
      options: z.string().default(''),
    }), req.body);
    return createField(actor, body);
  });

  app.delete('/api/plan/campos/:id', async (req) => deleteField(await actorFromRequest(req), (req.params as { id: string }).id));

  app.put('/api/plan/tareas/:id/campos', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({ values: z.record(z.string(), z.string()) }), req.body);
    return saveFieldValues(actor, (req.params as { id: string }).id, body.values);
  });

  app.get('/api/plan/plantillas', async (req) => listTemplates(await actorFromRequest(req)));

  app.post('/api/plan/plantillas', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({
      areaId: z.string(),
      title: z.string().trim().min(2, 'Escribe el título'),
      description: z.string().default(''),
      priority: z.enum(['baja', 'media', 'alta']).default('media'),
      checklist: z.string().default(''),
    }), req.body);
    return createTemplate(actor, body);
  });

  app.post('/api/plan/plantillas/:id/usar', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({ assigneeId: z.string().nullable().optional() }), req.body ?? {});
    return useTemplate(actor, (req.params as { id: string }).id, body.assigneeId);
  });

  app.get('/api/plan/reglas', async (req) => listRules(await actorFromRequest(req)));

  app.post('/api/plan/reglas', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({
      areaId: z.string().nullable().optional(),
      name: z.string().trim().min(2, 'Ponle un nombre a la regla'),
      whenKind: z.string(),
      thenKind: z.string(),
    }), req.body);
    return createRule(actor, body);
  });

  app.patch('/api/plan/reglas/:id', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({ enabled: z.boolean() }), req.body);
    return setRuleEnabled(actor, (req.params as { id: string }).id, body.enabled);
  });

  app.delete('/api/plan/reglas/:id', async (req) => deleteRule(await actorFromRequest(req), (req.params as { id: string }).id));

  app.get('/api/plan/formularios', async (req) => listForms(await actorFromRequest(req)));

  app.post('/api/plan/formularios', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({
      areaId: z.string(),
      title: z.string().trim().min(2, 'Escribe el título'),
      intro: z.string().default(''),
      taskTitle: z.string().default('Seguimiento del contacto'),
    }), req.body);
    return createForm(actor, body);
  });

  app.patch('/api/plan/formularios/:id', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({ active: z.boolean() }), req.body);
    return setFormActive(actor, (req.params as { id: string }).id, body.active);
  });

  app.get('/api/plan/estado', async (req) => {
    const actor = await actorFromRequest(req);
    const query = parseBody(z.object({ semana: day }), clean(req.query));
    return weekStatus(actor, query.semana);
  });

  app.post('/api/plan/estado/borrador', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({ areaId: z.string(), semana: day }), req.body);
    return writeDraft(actor, body.areaId, body.semana);
  });

  app.put('/api/plan/estado', async (req) => {
    const actor = await actorFromRequest(req);
    const body = parseBody(z.object({
      areaId: z.string(),
      semana: day,
      health: z.enum(['al_dia', 'en_riesgo', 'atrasado']),
      note: z.string().default(''),
    }), req.body);
    return saveStatus(actor, body);
  });

  app.get('/api/publico/formularios/:slug', async (req) => publicForm((req.params as { slug: string }).slug));

  app.post('/api/publico/formularios/:slug', async (req) => {
    const ip = req.ip || 'local';
    if (!allowPublicPost(ip)) throw new HttpError(429, 'Demasiados envíos. Espera un minuto');
    const body = parseBody(z.object({
      name: z.string().trim().min(2, 'Escribe tu nombre'),
      email: z.string().trim().default(''),
      phone: z.string().trim().default(''),
      note: z.string().trim().default(''),
    }), req.body);
    return submitPublicForm((req.params as { slug: string }).slug, body);
  });
}

function clean(query: unknown) {
  const src = query && typeof query === 'object' ? query as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(src)) {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string' && raw.trim()) out[key] = raw.trim();
  }
  return out;
}
