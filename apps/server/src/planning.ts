import type { Prisma } from '@prisma/client';
import { HttpError, type Actor } from './http';
import { notifyMember } from './notify';
import { prisma } from './prisma';
import { companyScope } from './tenant';
import {
  addDays,
  dependencyCycle,
  draftStatus,
  formSlug,
  mondayOf,
  ruleMatches,
  workload,
} from './planningLogic';

const WHEN = ['tarea_creada', 'tarea_hecha', 'tarea_vencida', 'prioridad_alta'] as const;
const THEN = ['avisar', 'crear_tarea', 'mover_a_en_curso', 'sumar_puntos'] as const;
const FIELD = ['texto', 'numero', 'opcion'] as const;

export function visibleTasks(actor: Actor): Prisma.TaskWhereInput {
  const companyId = actor.company.id;
  if (actor.membership.role === 'propietario') return { companyId };
  if (actor.membership.role === 'administrador') return { companyId, areaId: actor.membership.areaId || '__none__' };
  return { companyId, OR: [{ assigneeId: actor.membership.id }, { areaId: actor.membership.areaId || '__none__' }] };
}

function assertDirector(actor: Actor) {
  if (actor.membership.role === 'empleado') throw new HttpError(403, 'Solo dirección puede cambiar esto');
}

function day(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

async function areaOf(actor: Actor, areaId: string) {
  const area = await prisma.area.findFirst({ where: { id: areaId, ...companyScope(actor.company.id) } });
  if (!area) throw new HttpError(404, 'Área no encontrada');
  if (actor.membership.role === 'administrador' && actor.membership.areaId !== area.id) {
    throw new HttpError(403, 'Esa área no es tuya');
  }
  if (actor.membership.role === 'empleado' && actor.membership.areaId !== area.id) {
    throw new HttpError(403, 'Esa área no es tuya');
  }
  return area;
}

export async function calendar(actor: Actor, query: { desde: string; hasta: string; areaId?: string }) {
  await sweepOverdue(actor.company.id);
  if (query.areaId) await areaOf(actor, query.areaId);
  const from = new Date(`${query.desde}T00:00:00.000Z`);
  const to = new Date(`${query.hasta}T23:59:59.000Z`);
  const where: Prisma.TaskWhereInput = {
    AND: [
      visibleTasks(actor),
      { parentId: null },
      query.areaId ? { areaId: query.areaId } : {},
      {
        OR: [
          { dueDate: { gte: from, lte: to } },
          { startDate: { gte: from, lte: to } },
          { AND: [{ startDate: { lte: from } }, { dueDate: { gte: from } }] },
        ],
      },
    ],
  };
  const rows = await prisma.task.findMany({
    where,
    orderBy: [{ dueDate: 'asc' }, { title: 'asc' }],
    take: 200,
    include: {
      assignee: { select: { id: true, name: true } },
      area: { select: { id: true, name: true } },
      blockedBy: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    areaId: row.areaId,
    area: row.area.name,
    assigneeId: row.assigneeId,
    assignee: row.assignee?.name || '',
    startDate: day(row.startDate),
    dueDate: day(row.dueDate),
    estimateMinutes: row.estimateMinutes,
    blockedBy: row.blockedBy.map((edge) => ({
      id: edge.dependsOn.id,
      title: edge.dependsOn.title,
      done: edge.dependsOn.status === 'hecho',
    })),
  }));
}

export async function addDependency(actor: Actor, taskId: string, dependsOnId: string) {
  assertDirector(actor);
  if (taskId === dependsOnId) throw new HttpError(400, 'Una tarea no puede depender de sí misma');
  const tasks = await prisma.task.findMany({
    where: { id: { in: [taskId, dependsOnId] }, ...companyScope(actor.company.id) },
  });
  if (tasks.length !== 2) throw new HttpError(404, 'Tarea no encontrada');
  const edges = await prisma.taskDependency.findMany({
    where: companyScope(actor.company.id),
    select: { taskId: true, dependsOnId: true },
  });
  if (dependencyCycle(edges, taskId, dependsOnId)) throw new HttpError(400, 'Eso cerraría un círculo de dependencias');
  await prisma.taskDependency.create({
    data: { companyId: actor.company.id, taskId, dependsOnId },
  });
  return { ok: true };
}

export async function removeDependency(actor: Actor, taskId: string, dependsOnId: string) {
  assertDirector(actor);
  await prisma.taskDependency.deleteMany({
    where: { ...companyScope(actor.company.id), taskId, dependsOnId },
  });
  return { ok: true };
}

export async function assertCanFinish(companyId: string, taskId: string) {
  const edges = await prisma.taskDependency.findMany({
    where: { ...companyScope(companyId), taskId },
    include: { dependsOn: { select: { title: true, status: true } } },
  });
  const open = edges.filter((edge) => edge.dependsOn.status !== 'hecho').map((edge) => edge.dependsOn.title);
  if (open.length) throw new HttpError(400, `Primero hay que terminar: ${open.join(', ')}`);
}

export async function runRules(companyId: string, event: {
  kind: 'tarea_creada' | 'tarea_hecha' | 'tarea_vencida' | 'prioridad_alta';
  taskId: string;
  areaId: string;
  title: string;
  assigneeId: string | null;
  priority: string;
  actorId?: string | null;
}) {
  const rules = await prisma.automationRule.findMany({
    where: { ...companyScope(companyId), enabled: true },
  });
  for (const rule of rules) {
    if (!ruleMatches(rule, event)) continue;
    if (rule.thenKind === 'avisar' && event.assigneeId) {
      await notifyMember({
        companyId,
        recipientId: event.assigneeId,
        kind: event.kind === 'tarea_vencida' ? 'overdue' : 'assignment',
        actorId: event.actorId,
        payload: { taskId: event.taskId, title: event.title, rule: rule.name },
      });
    } else if (rule.thenKind === 'crear_tarea') {
      const spec = readJson(rule.thenJson);
      const title = typeof spec.title === 'string' && spec.title.trim() ? spec.title.trim() : `Seguimiento: ${event.title}`;
      await prisma.task.create({
        data: {
          companyId,
          areaId: event.areaId,
          title: title.slice(0, 140),
          description: `Creada por la regla «${rule.name}».`,
          priority: 'media',
          status: 'pendiente',
        },
      });
    } else if (rule.thenKind === 'mover_a_en_curso' && event.kind === 'tarea_creada') {
      await prisma.task.updateMany({
        where: { id: event.taskId, ...companyScope(companyId), status: 'pendiente' },
        data: { status: 'en_curso' },
      });
    } else if (rule.thenKind === 'sumar_puntos' && event.assigneeId && event.kind === 'tarea_hecha') {
      await prisma.membership.updateMany({
        where: { id: event.assigneeId, ...companyScope(companyId) },
        data: { points: { increment: 5 } },
      });
    }
  }
}

async function sweepOverdue(companyId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const late = await prisma.task.findMany({
    where: {
      ...companyScope(companyId),
      parentId: null,
      status: { not: 'hecho' },
      dueDate: { lt: new Date(`${today}T00:00:00.000Z`) },
      assigneeId: { not: null },
    },
    take: 40,
  });
  for (const task of late) {
    if (!task.assigneeId) continue;
    const already = await prisma.notification.findFirst({
      where: {
        ...companyScope(companyId),
        recipientId: task.assigneeId,
        kind: 'overdue',
        payload: { contains: task.id },
      },
    });
    if (already) continue;
    await runRules(companyId, {
      kind: 'tarea_vencida',
      taskId: task.id,
      areaId: task.areaId,
      title: task.title,
      assigneeId: task.assigneeId,
      priority: task.priority,
    });
  }
}

export async function loadView(actor: Actor) {
  const today = new Date().toISOString().slice(0, 10);
  const memberWhere: Prisma.MembershipWhereInput = { ...companyScope(actor.company.id), active: true };
  if (actor.membership.role === 'administrador') memberWhere.areaId = actor.membership.areaId || '__none__';
  if (actor.membership.role === 'empleado') memberWhere.id = actor.membership.id;
  const people = await prisma.membership.findMany({
    where: memberWhere,
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 200,
  });
  const tasks = await prisma.task.findMany({
    where: {
      ...companyScope(actor.company.id),
      parentId: null,
      status: { not: 'hecho' },
      assigneeId: { in: people.map((person) => person.id) },
    },
    select: { assigneeId: true, status: true, estimateMinutes: true, dueDate: true },
  });
  return {
    today,
    capacityMinutes: 2400,
    people: workload(people, tasks.map((task) => ({
      assigneeId: task.assigneeId,
      status: task.status,
      estimateMinutes: task.estimateMinutes,
      dueDate: day(task.dueDate),
    })), today),
  };
}

export async function listFields(actor: Actor, areaId: string) {
  await areaOf(actor, areaId);
  const rows = await prisma.customField.findMany({
    where: { ...companyScope(actor.company.id), areaId },
    orderBy: [{ sort: 'asc' }, { label: 'asc' }],
  });
  return rows.map(fieldDto);
}

export async function createField(actor: Actor, input: { areaId: string; label: string; kind: string; options?: string }) {
  assertDirector(actor);
  await areaOf(actor, input.areaId);
  if (!FIELD.includes(input.kind as typeof FIELD[number])) throw new HttpError(400, 'Tipo de campo no válido');
  const row = await prisma.customField.create({
    data: {
      companyId: actor.company.id,
      areaId: input.areaId,
      label: input.label,
      kind: input.kind,
      options: JSON.stringify(splitOptions(input.options || '')),
    },
  });
  return fieldDto(row);
}

export async function deleteField(actor: Actor, id: string) {
  assertDirector(actor);
  const row = await prisma.customField.findFirst({ where: { id, ...companyScope(actor.company.id) } });
  if (!row) throw new HttpError(404, 'Campo no encontrado');
  await areaOf(actor, row.areaId);
  await prisma.customField.delete({ where: { id } });
  return { ok: true };
}

export async function saveFieldValues(actor: Actor, taskId: string, values: Record<string, string>) {
  assertDirector(actor);
  const task = await prisma.task.findFirst({ where: { id: taskId, ...companyScope(actor.company.id) } });
  if (!task) throw new HttpError(404, 'Tarea no encontrada');
  await areaOf(actor, task.areaId);
  const fields = await prisma.customField.findMany({
    where: { ...companyScope(actor.company.id), areaId: task.areaId },
  });
  const allowed = new Set(fields.map((field) => field.id));
  for (const [fieldId, value] of Object.entries(values)) {
    if (!allowed.has(fieldId)) continue;
    await prisma.taskFieldValue.upsert({
      where: { taskId_fieldId: { taskId, fieldId } },
      create: { companyId: actor.company.id, taskId, fieldId, value: value.slice(0, 240) },
      update: { value: value.slice(0, 240) },
    });
  }
  return { ok: true };
}

export async function listTemplates(actor: Actor) {
  const where: Prisma.TaskTemplateWhereInput = companyScope(actor.company.id);
  if (actor.membership.role !== 'propietario') where.areaId = actor.membership.areaId || '__none__';
  const rows = await prisma.taskTemplate.findMany({ where, orderBy: { title: 'asc' }, take: 100 });
  return rows.map(templateDto);
}

export async function createTemplate(actor: Actor, input: {
  areaId: string;
  title: string;
  description?: string;
  priority?: string;
  checklist?: string;
}) {
  assertDirector(actor);
  await areaOf(actor, input.areaId);
  const row = await prisma.taskTemplate.create({
    data: {
      companyId: actor.company.id,
      areaId: input.areaId,
      title: input.title,
      description: input.description || '',
      priority: input.priority || 'media',
      checklist: JSON.stringify(lines(input.checklist || '')),
    },
  });
  return templateDto(row);
}

export async function useTemplate(actor: Actor, id: string, assigneeId?: string | null) {
  assertDirector(actor);
  const template = await prisma.taskTemplate.findFirst({ where: { id, ...companyScope(actor.company.id) } });
  if (!template || !template.areaId) throw new HttpError(404, 'Plantilla no encontrada');
  await areaOf(actor, template.areaId);
  const parent = await prisma.task.create({
    data: {
      companyId: actor.company.id,
      areaId: template.areaId,
      assigneeId: assigneeId || null,
      createdById: actor.membership.id,
      title: template.title,
      description: template.description,
      priority: template.priority,
      status: 'pendiente',
    },
  });
  const steps = readList(template.checklist);
  for (const [index, title] of steps.entries()) {
    await prisma.task.create({
      data: {
        companyId: actor.company.id,
        areaId: template.areaId,
        parentId: parent.id,
        assigneeId: assigneeId || null,
        createdById: actor.membership.id,
        title,
        priority: template.priority,
        sort: index,
      },
    });
  }
  await runRules(actor.company.id, {
    kind: 'tarea_creada',
    taskId: parent.id,
    areaId: parent.areaId,
    title: parent.title,
    assigneeId: parent.assigneeId,
    priority: parent.priority,
    actorId: actor.membership.id,
  });
  return { id: parent.id, title: parent.title, steps: steps.length };
}

export async function listRules(actor: Actor) {
  assertDirector(actor);
  const where: Prisma.AutomationRuleWhereInput = companyScope(actor.company.id);
  if (actor.membership.role === 'administrador') where.OR = [{ areaId: actor.membership.areaId }, { areaId: null }];
  const rows = await prisma.automationRule.findMany({ where, orderBy: { name: 'asc' }, take: 100 });
  return rows.map(ruleDto);
}

export async function createRule(actor: Actor, input: { areaId?: string | null; name: string; whenKind: string; thenKind: string }) {
  assertDirector(actor);
  if (!WHEN.includes(input.whenKind as typeof WHEN[number])) throw new HttpError(400, 'Ese disparador no existe');
  if (!THEN.includes(input.thenKind as typeof THEN[number])) throw new HttpError(400, 'Esa acción no existe');
  if (input.areaId) await areaOf(actor, input.areaId);
  const row = await prisma.automationRule.create({
    data: {
      companyId: actor.company.id,
      areaId: input.areaId || null,
      name: input.name,
      whenKind: input.whenKind,
      thenKind: input.thenKind,
      thenJson: '{}',
    },
  });
  return ruleDto(row);
}

export async function setRuleEnabled(actor: Actor, id: string, enabled: boolean) {
  assertDirector(actor);
  const row = await prisma.automationRule.findFirst({ where: { id, ...companyScope(actor.company.id) } });
  if (!row) throw new HttpError(404, 'Regla no encontrada');
  if (actor.membership.role === 'administrador' && row.areaId && row.areaId !== actor.membership.areaId) {
    throw new HttpError(403, 'Esa área no es tuya');
  }
  const saved = await prisma.automationRule.update({ where: { id }, data: { enabled } });
  return ruleDto(saved);
}

export async function deleteRule(actor: Actor, id: string) {
  assertDirector(actor);
  const row = await prisma.automationRule.findFirst({ where: { id, ...companyScope(actor.company.id) } });
  if (!row) throw new HttpError(404, 'Regla no encontrada');
  await prisma.automationRule.delete({ where: { id } });
  return { ok: true };
}

export async function listForms(actor: Actor) {
  assertDirector(actor);
  const where: Prisma.IntakeFormWhereInput = companyScope(actor.company.id);
  if (actor.membership.role === 'administrador') where.areaId = actor.membership.areaId || '__none__';
  const rows = await prisma.intakeForm.findMany({ where, orderBy: { title: 'asc' }, take: 50 });
  return rows.map(formDto);
}

export async function createForm(actor: Actor, input: { areaId: string; title: string; intro?: string; taskTitle?: string }) {
  assertDirector(actor);
  await areaOf(actor, input.areaId);
  const suffix = Math.random().toString(36).slice(2, 6);
  const row = await prisma.intakeForm.create({
    data: {
      companyId: actor.company.id,
      areaId: input.areaId,
      slug: formSlug(input.title, suffix),
      title: input.title,
      intro: input.intro || '',
      taskTitle: input.taskTitle || 'Seguimiento del contacto',
    },
  });
  return formDto(row);
}

export async function setFormActive(actor: Actor, id: string, active: boolean) {
  assertDirector(actor);
  const row = await prisma.intakeForm.findFirst({ where: { id, ...companyScope(actor.company.id) } });
  if (!row) throw new HttpError(404, 'Formulario no encontrado');
  const saved = await prisma.intakeForm.update({ where: { id }, data: { active } });
  return formDto(saved);
}

const publicHits = new Map<string, number[]>();

export function allowPublicPost(ip: string) {
  const now = Date.now();
  const recent = (publicHits.get(ip) || []).filter((stamp) => now - stamp < 60_000);
  if (recent.length >= 8) return false;
  recent.push(now);
  publicHits.set(ip, recent);
  return true;
}

export async function publicForm(slug: string) {
  const form = await prisma.intakeForm.findFirst({
    where: { slug, active: true },
    include: { company: { select: { name: true, officeName: true } } },
  });
  if (!form) throw new HttpError(404, 'Ese formulario no está publicado');
  return { title: form.title, intro: form.intro, company: form.company.name, office: form.company.officeName };
}

export async function submitPublicForm(slug: string, input: { name: string; email?: string; phone?: string; note?: string }) {
  const form = await prisma.intakeForm.findFirst({ where: { slug, active: true } });
  if (!form) throw new HttpError(404, 'Ese formulario no está publicado');
  const lead = await prisma.lead.create({
    data: {
      companyId: form.companyId,
      name: input.name,
      email: input.email || '',
      phone: input.phone || '',
      source: form.slug,
      status: 'nuevo',
    },
  });
  const due = new Date(`${addDays(new Date().toISOString().slice(0, 10), 1)}T12:00:00.000Z`);
  const task = await prisma.task.create({
    data: {
      companyId: form.companyId,
      areaId: form.areaId,
      title: `${form.taskTitle}: ${input.name}`.slice(0, 140),
      description: [input.note, input.email, input.phone].filter(Boolean).join('\n'),
      priority: 'alta',
      status: 'pendiente',
      dueDate: due,
    },
  });
  await runRules(form.companyId, {
    kind: 'tarea_creada',
    taskId: task.id,
    areaId: task.areaId,
    title: task.title,
    assigneeId: null,
    priority: task.priority,
  });
  return { ok: true, leadId: lead.id };
}

export async function weekStatus(actor: Actor, semana: string) {
  const weekStart = mondayOf(semana);
  const areaWhere: Prisma.AreaWhereInput = companyScope(actor.company.id);
  if (actor.membership.role !== 'propietario') areaWhere.id = actor.membership.areaId || '__none__';
  const areas = await prisma.area.findMany({ where: areaWhere, orderBy: { name: 'asc' }, take: 80 });
  const saved = await prisma.areaWeekStatus.findMany({
    where: { ...companyScope(actor.company.id), weekStart, areaId: { in: areas.map((area) => area.id) } },
  });
  const byArea = new Map(saved.map((row) => [row.areaId, row]));
  return {
    weekStart,
    areas: areas.map((area) => {
      const row = byArea.get(area.id);
      return {
        areaId: area.id,
        area: area.name,
        health: row?.health || 'al_dia',
        note: row?.note || '',
        draft: row?.draft || '',
      };
    }),
  };
}

export async function writeDraft(actor: Actor, areaId: string, semana: string) {
  assertDirector(actor);
  const area = await areaOf(actor, areaId);
  const weekStart = mondayOf(semana);
  const tasks = await prisma.task.findMany({
    where: { ...companyScope(actor.company.id), areaId, parentId: null },
    select: { status: true, dueDate: true },
  });
  const today = new Date().toISOString().slice(0, 10);
  const done = tasks.filter((task) => task.status === 'hecho').length;
  const open = tasks.filter((task) => task.status !== 'hecho').length;
  const overdue = tasks.filter((task) => task.status !== 'hecho' && task.dueDate && day(task.dueDate)! < today).length;
  const goals = await prisma.weeklyGoal.findMany({
    where: { ...companyScope(actor.company.id), areaId, weekStart },
  });
  const missionPct = goals.length
    ? Math.round(goals.reduce((sum, goal) => sum + (goal.target > 0 ? Math.min(100, (goal.current / goal.target) * 100) : 0), 0) / goals.length)
    : null;
  const draft = draftStatus({ areaName: area.name, done, open, overdue, missionPct });
  const row = await prisma.areaWeekStatus.upsert({
    where: { companyId_areaId_weekStart: { companyId: actor.company.id, areaId, weekStart } },
    create: { companyId: actor.company.id, areaId, weekStart, health: draft.health, draft: draft.text },
    update: { health: draft.health, draft: draft.text },
  });
  return { areaId, health: row.health, draft: row.draft, note: row.note };
}

export async function saveStatus(actor: Actor, input: { areaId: string; semana: string; health: string; note?: string }) {
  assertDirector(actor);
  await areaOf(actor, input.areaId);
  if (!['al_dia', 'en_riesgo', 'atrasado'].includes(input.health)) throw new HttpError(400, 'Estado no válido');
  const weekStart = mondayOf(input.semana);
  const row = await prisma.areaWeekStatus.upsert({
    where: { companyId_areaId_weekStart: { companyId: actor.company.id, areaId: input.areaId, weekStart } },
    create: {
      companyId: actor.company.id,
      areaId: input.areaId,
      weekStart,
      health: input.health,
      note: input.note || '',
    },
    update: { health: input.health, note: input.note || '' },
  });
  return { areaId: row.areaId, health: row.health, note: row.note, draft: row.draft };
}

function fieldDto(row: { id: string; areaId: string; label: string; kind: string; options: string }) {
  return { id: row.id, areaId: row.areaId, label: row.label, kind: row.kind, options: readList(row.options) };
}

function templateDto(row: { id: string; areaId: string | null; title: string; description: string; priority: string; checklist: string }) {
  return { ...row, checklist: readList(row.checklist) };
}

function ruleDto(row: { id: string; areaId: string | null; name: string; enabled: boolean; whenKind: string; thenKind: string }) {
  return row;
}

function formDto(row: { id: string; areaId: string; slug: string; title: string; intro: string; taskTitle: string; active: boolean }) {
  return row;
}

function readList(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()) : [];
  } catch {
    return [];
  }
}

function readJson(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function splitOptions(raw: string) {
  return raw.split(',').map((part) => part.trim()).filter(Boolean).slice(0, 12);
}

function lines(raw: string) {
  return raw.split('\n').map((part) => part.trim()).filter(Boolean).slice(0, 12);
}
