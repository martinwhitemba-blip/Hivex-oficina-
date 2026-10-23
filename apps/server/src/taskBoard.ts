import type { Prisma } from '@prisma/client';
import { companyScope } from './tenant';
import { HttpError, type Actor } from './http';
import { prisma } from './prisma';
import { audit } from './billing';
import { awardBadge } from './services';
import { broadcastPanel, publishTaskHandoff, publishTaskUpdate, type TaskUpdateEvent } from './socket';
import { resolveMentions } from './mentions';

export const TASK_STATUSES = ['pendiente', 'en_curso', 'hecho'] as const;
export const TASK_PRIORITIES = ['baja', 'media', 'alta'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

const PRIORITY_RANK: Record<string, number> = { alta: 0, media: 1, baja: 2 };

function boardInclude(companyId: string) {
  return {
    assignee: { select: { id: true, name: true } },
    area: { select: { id: true, name: true } },
    children: {
      where: { companyId },
      orderBy: [{ sort: 'asc' as const }, { createdAt: 'asc' as const }],
      include: { assignee: { select: { id: true, name: true } } },
    },
    _count: { select: { comments: true, children: true } },
  };
}

function flatInclude() {
  return {
    assignee: { select: { id: true, name: true } },
    area: { select: { id: true, name: true } },
    _count: { select: { comments: true, children: true } },
  };
}

export function taskWhere(actor: Actor): Prisma.TaskWhereInput {
  const companyId = actor.company.id;
  if (actor.membership.role === 'propietario') return { companyId };
  if (actor.membership.role === 'administrador') {
    return { companyId, areaId: actor.membership.areaId || '__none__' };
  }
  return {
    companyId,
    OR: [{ assigneeId: actor.membership.id }, { areaId: actor.membership.areaId || '__none__' }],
  };
}

export function dueIso(value: Date | null | undefined) {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

export function isOverdue(task: { dueDate: Date | null; status: string }, today = new Date().toISOString().slice(0, 10)) {
  if (!task.dueDate || task.status === 'hecho') return false;
  return dueIso(task.dueDate)! < today;
}

export function parseDue(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, 'La fecha debe ser AAAA-MM-DD');
  return new Date(`${value}T12:00:00.000Z`);
}

function startOfToday() {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export interface TaskQuery {
  vista?: 'tablero' | 'lista';
  areaId?: string;
  assigneeId?: string;
  prioridad?: TaskPriority;
  vence?: string;
  vencidas?: boolean;
  estado?: TaskStatus;
  orden?: 'dueDate' | 'priority' | 'assignee' | 'area' | 'title' | 'updatedAt' | 'sort';
  dir?: 'asc' | 'desc';
}

export async function listTasks(actor: Actor, query: TaskQuery) {
  const vista = query.vista === 'lista' ? 'lista' : 'tablero';
  const where: Prisma.TaskWhereInput = { ...taskWhere(actor) };
  if (vista === 'tablero') where.parentId = null;
  if (query.areaId) where.areaId = query.areaId;
  if (query.assigneeId) where.assigneeId = query.assigneeId;
  if (query.prioridad) where.priority = query.prioridad;
  if (query.estado) where.status = query.estado;
  if (query.vencidas) {
    where.status = { not: 'hecho' };
    where.dueDate = { lt: startOfToday() };
  } else if (query.vence) {
    const due = parseDue(query.vence);
    if (due === undefined || due === null) throw new HttpError(400, 'La fecha debe ser AAAA-MM-DD');
    const day = dueIso(due)!;
    where.dueDate = {
      gte: new Date(`${day}T00:00:00.000Z`),
      lte: new Date(`${day}T23:59:59.999Z`),
    };
  }
  const rows = vista === 'lista'
    ? await prisma.task.findMany({ where, include: flatInclude(), take: 400 })
    : await prisma.task.findMany({ where, include: boardInclude(actor.company.id), take: 400 });
  return sortTasks(rows, query.orden || (vista === 'lista' ? 'dueDate' : 'sort'), query.dir || (vista === 'lista' ? 'asc' : 'asc'))
    .map((task) => taskDto(task, vista === 'tablero'));
}

export async function getTask(actor: Actor, id: string) {
  const task = await prisma.task.findFirst({
    where: { id, ...companyScope(actor.company.id) },
    include: boardInclude(actor.company.id),
  });
  if (!task || !canSee(actor, task)) throw new HttpError(404, 'Tarea no encontrada');
  return taskDto(task, true);
}

export async function createTask(actor: Actor, input: {
  title: string;
  description?: string;
  areaId: string;
  assigneeId?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  sort?: number;
  weeklyGoalId?: string | null;
}) {
  if (actor.membership.role === 'empleado') throw new HttpError(403, 'Pide a tu director que cree la tarea');
  const area = await ownArea(actor, input.areaId);
  if (actor.membership.role === 'administrador' && area.id !== actor.membership.areaId) {
    throw new HttpError(403, 'Solo puedes crear tareas de tu área');
  }
  if (input.assigneeId) await assertAssignee(actor, input.assigneeId, area.id);
  const due = parseDue(input.dueDate);
  const status = input.status || 'pendiente';
  const task = await prisma.task.create({
    data: {
      companyId: actor.company.id,
      areaId: area.id,
      assigneeId: input.assigneeId || null,
      createdById: actor.membership.id,
      title: input.title,
      description: input.description || '',
      status,
      priority: input.priority || 'media',
      dueDate: due === undefined ? null : due,
      sort: input.sort ?? 0,
      weeklyGoalId: input.weeklyGoalId || null,
      doneAt: status === 'hecho' ? new Date() : null,
    },
    include: boardInclude(actor.company.id),
  });
  if (status === 'hecho' && task.assigneeId) await completeTaskPoints(actor.company.id, task.assigneeId);
  if (task.assigneeId && status === 'en_curso') await focusTask(actor.company.id, task.assigneeId, task.id, task.title);
  publishTaskUpdate(actor.company.id, taskEvent(actor.company.id, task));
  if (task.assigneeId) {
    publishTaskHandoff(actor.company.id, { fromMembershipId: null, toMembershipId: task.assigneeId, taskId: task.id });
  }
  await broadcastPanel(actor.company.id);
  return taskDto(task, true);
}

export async function createSubtask(actor: Actor, parentId: string, input: {
  title: string;
  assigneeId?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  sort?: number;
}) {
  if (actor.membership.role === 'empleado') throw new HttpError(403, 'Pide a tu director que cree la tarea');
  const parent = await prisma.task.findFirst({ where: { id: parentId, ...companyScope(actor.company.id) } });
  if (!parent) throw new HttpError(404, 'Tarea no encontrada');
  if (parent.parentId) throw new HttpError(400, 'Una subtarea no puede tener subtareas');
  assertArea(actor, parent.areaId);
  const assigneeId = input.assigneeId === undefined ? parent.assigneeId : input.assigneeId;
  if (assigneeId) await assertAssignee(actor, assigneeId, parent.areaId);
  const due = parseDue(input.dueDate);
  const task = await prisma.task.create({
    data: {
      companyId: actor.company.id,
      areaId: parent.areaId,
      parentId: parent.id,
      assigneeId: assigneeId || null,
      createdById: actor.membership.id,
      title: input.title,
      priority: input.priority || parent.priority,
      dueDate: due === undefined ? null : due,
      sort: input.sort ?? 0,
      status: 'pendiente',
    },
    include: boardInclude(actor.company.id),
  });
  publishTaskUpdate(actor.company.id, taskEvent(actor.company.id, task));
  if (task.assigneeId) {
    publishTaskHandoff(actor.company.id, { fromMembershipId: null, toMembershipId: task.assigneeId, taskId: task.id });
  }
  await broadcastPanel(actor.company.id);
  return taskDto(task, false);
}

export async function updateTask(actor: Actor, id: string, input: {
  title?: string;
  description?: string;
  status?: TaskStatus;
  assigneeId?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  sort?: number;
  weeklyGoalId?: string | null;
}) {
  const task = await prisma.task.findFirst({
    where: { id, ...companyScope(actor.company.id) },
    include: { parent: { select: { assigneeId: true } } },
  });
  if (!task) throw new HttpError(404, 'Tarea no encontrada');
  await assertCanMove(actor, task);
  if (actor.membership.role === 'empleado' && employeeEditsFields(input)) {
    throw new HttpError(403, 'Solo puedes mover tus tareas');
  }
  if (input.assigneeId) await assertAssignee(actor, input.assigneeId, task.areaId);
  const due = parseDue(input.dueDate);
  const wasDone = task.status === 'hecho';
  const updated = await prisma.task.update({
    where: { id },
    data: {
      title: input.title,
      description: input.description,
      status: input.status,
      assigneeId: input.assigneeId,
      priority: input.priority,
      sort: input.sort,
      weeklyGoalId: input.weeklyGoalId,
      dueDate: due,
      doneAt: input.status === 'hecho' ? task.doneAt ?? new Date() : input.status ? null : undefined,
    },
    include: boardInclude(actor.company.id),
  });
  if (!wasDone && updated.status === 'hecho' && updated.assigneeId) {
    await completeTaskPoints(actor.company.id, updated.assigneeId);
    await clearFocus(actor.company.id, updated.assigneeId, updated.id);
  }
  const reassigned = input.assigneeId !== undefined && input.assigneeId !== task.assigneeId;
  if (reassigned) {
    if (task.assigneeId) await clearFocus(actor.company.id, task.assigneeId, task.id);
    if (input.assigneeId) {
      await focusTask(actor.company.id, input.assigneeId, updated.id, updated.title);
      await audit(actor.company.id, actor.membership.id, 'reasignar_tarea', `${actor.membership.name} reasignó «${updated.title}»`, { taskId: id, assigneeId: input.assigneeId });
    }
  } else if (updated.assigneeId && updated.status === 'en_curso' && task.status !== 'en_curso') {
    await focusTask(actor.company.id, updated.assigneeId, updated.id, updated.title);
  }
  publishTaskUpdate(actor.company.id, taskEvent(actor.company.id, updated));
  if (reassigned) {
    publishTaskHandoff(actor.company.id, {
      fromMembershipId: task.assigneeId,
      toMembershipId: input.assigneeId ?? null,
      taskId: updated.id,
    });
  }
  await broadcastPanel(actor.company.id);
  return {
    task: taskDto(updated, true),
    handoff: reassigned
      ? { fromMembershipId: task.assigneeId, toMembershipId: input.assigneeId ?? null, taskId: updated.id }
      : null,
  };
}

export async function deleteTask(actor: Actor, id: string) {
  if (actor.membership.role === 'empleado') throw new HttpError(403, 'No puedes borrar tareas');
  const task = await prisma.task.findFirst({ where: { id, ...companyScope(actor.company.id) } });
  if (!task) throw new HttpError(404, 'Tarea no encontrada');
  assertArea(actor, task.areaId);
  await prisma.membership.updateMany({
    where: { ...companyScope(actor.company.id), currentTaskId: id },
    data: { currentTaskTitle: '', currentTaskId: null, currentTaskSince: null },
  });
  await prisma.task.delete({ where: { id } });
  publishTaskUpdate(actor.company.id, { ...taskEvent(actor.company.id, task), deleted: true, updatedAt: new Date().toISOString() });
  await broadcastPanel(actor.company.id);
  return { ok: true as const };
}

export async function listComments(actor: Actor, taskId: string) {
  const task = await visibleTask(actor, taskId);
  const rows = await prisma.taskComment.findMany({
    where: { ...companyScope(actor.company.id), taskId: task.id },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  const members = await companyMembers(actor.company.id);
  return rows.map((row) => commentDto(row, members));
}

export async function addComment(actor: Actor, taskId: string, body: string, explicit: string[] = []) {
  const task = await visibleTask(actor, taskId);
  const text = body.trim();
  if (text.length < 1) throw new HttpError(400, 'Escribe un comentario');
  if (text.length > 1000) throw new HttpError(400, 'Escribe un mensaje de hasta 1000 caracteres');
  const members = await companyMembers(actor.company.id);
  const mentions = resolveMentions(text, members, explicit);
  const row = await prisma.taskComment.create({
    data: {
      companyId: actor.company.id,
      taskId: task.id,
      authorId: actor.membership.id,
      body: text,
      mentions: JSON.stringify(mentions),
    },
    include: { author: { select: { id: true, name: true } } },
  });
  return { comment: commentDto(row, members), mentions, taskTitle: task.title };
}

export async function deleteComment(actor: Actor, taskId: string, commentId: string) {
  const task = await visibleTask(actor, taskId);
  const row = await prisma.taskComment.findFirst({
    where: { id: commentId, taskId: task.id, ...companyScope(actor.company.id) },
  });
  if (!row) throw new HttpError(404, 'Tarea no encontrada');
  const own = row.authorId === actor.membership.id;
  const lead = actor.membership.role === 'propietario' || (actor.membership.role === 'administrador' && task.areaId === actor.membership.areaId);
  if (!own && !lead) throw new HttpError(403, 'No puedes borrar este comentario');
  await prisma.taskComment.delete({ where: { id: row.id } });
  return { ok: true as const };
}

function employeeEditsFields(input: {
  title?: string;
  description?: string;
  assigneeId?: string | null;
  priority?: string;
  dueDate?: string | null;
  weeklyGoalId?: string | null;
}) {
  return input.title !== undefined
    || input.description !== undefined
    || input.assigneeId !== undefined
    || input.priority !== undefined
    || input.dueDate !== undefined
    || input.weeklyGoalId !== undefined;
}

function canSee(actor: Actor, task: { areaId: string; assigneeId: string | null; companyId: string }) {
  if (task.companyId !== actor.company.id) return false;
  if (actor.membership.role === 'propietario') return true;
  if (actor.membership.role === 'administrador') return task.areaId === actor.membership.areaId;
  return task.assigneeId === actor.membership.id || task.areaId === actor.membership.areaId;
}

async function assertCanMove(actor: Actor, task: { areaId: string; assigneeId: string | null; parent?: { assigneeId: string | null } | null }) {
  if (actor.membership.role === 'propietario') return;
  if (actor.membership.role === 'administrador') {
    if (task.areaId !== actor.membership.areaId) throw new HttpError(403, 'Tarea de otra área');
    return;
  }
  if (task.assigneeId === actor.membership.id) return;
  if (!task.assigneeId && task.parent?.assigneeId === actor.membership.id) return;
  throw new HttpError(403, 'Solo puedes mover tus tareas');
}

function assertArea(actor: Actor, areaId: string) {
  if (actor.membership.role === 'propietario') return;
  if (actor.membership.role === 'administrador' && areaId === actor.membership.areaId) return;
  if (actor.membership.role === 'administrador') throw new HttpError(403, 'Tarea de otra área');
  throw new HttpError(403, 'Solo puedes mover tus tareas');
}

async function visibleTask(actor: Actor, id: string) {
  const task = await prisma.task.findFirst({ where: { id, ...companyScope(actor.company.id) } });
  if (!task || !canSee(actor, task)) throw new HttpError(404, 'Tarea no encontrada');
  return task;
}

async function ownArea(actor: Actor, id: string) {
  const area = await prisma.area.findFirst({ where: { id, ...companyScope(actor.company.id) } });
  if (!area) throw new HttpError(404, 'Área no encontrada');
  return area;
}

async function assertAssignee(actor: Actor, membershipId: string, areaId: string) {
  const person = await prisma.membership.findFirst({
    where: { id: membershipId, ...companyScope(actor.company.id), active: true },
  });
  if (!person) throw new HttpError(404, 'Empleado no encontrado');
  if (person.areaId !== areaId) throw new HttpError(400, 'La persona no está en esa área');
  return person;
}

async function companyMembers(companyId: string) {
  return prisma.membership.findMany({
    where: { ...companyScope(companyId), active: true },
    select: { id: true, name: true },
  });
}

async function completeTaskPoints(companyId: string, membershipId: string) {
  const member = await prisma.membership.findFirst({ where: { id: membershipId, ...companyScope(companyId) } });
  if (!member) return;
  await prisma.membership.update({ where: { id: membershipId }, data: { points: { increment: 8 } } });
  const done = await prisma.task.count({ where: { ...companyScope(companyId), assigneeId: membershipId, status: 'hecho' } });
  if (done >= 1) await awardBadge(membershipId, 'tarea_hecha', 'Manos a la obra');
}

async function focusTask(companyId: string, membershipId: string, taskId: string, title: string) {
  await prisma.membership.updateMany({
    where: { id: membershipId, ...companyScope(companyId) },
    data: { currentTaskTitle: title, currentTaskId: taskId, currentTaskSince: new Date() },
  });
}

async function clearFocus(companyId: string, membershipId: string, taskId: string) {
  await prisma.membership.updateMany({
    where: { id: membershipId, ...companyScope(companyId), currentTaskId: taskId },
    data: { currentTaskTitle: '', currentTaskId: null, currentTaskSince: null },
  });
}

function sortTasks<T extends { sort: number; createdAt: Date; updatedAt: Date; dueDate: Date | null; priority: string; title: string; assignee: { name: string } | null; area: { name: string } | null }>(
  rows: T[],
  orden: TaskQuery['orden'],
  dir: 'asc' | 'desc',
) {
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (orden === 'priority') cmp = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    else if (orden === 'dueDate') {
      const av = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY;
      const bv = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY;
      cmp = av - bv;
    } else if (orden === 'assignee') cmp = (a.assignee?.name || '').localeCompare(b.assignee?.name || '', 'es');
    else if (orden === 'area') cmp = (a.area?.name || '').localeCompare(b.area?.name || '', 'es');
    else if (orden === 'title') cmp = a.title.localeCompare(b.title, 'es');
    else if (orden === 'updatedAt') cmp = a.updatedAt.getTime() - b.updatedAt.getTime();
    else cmp = a.sort - b.sort || a.createdAt.getTime() - b.createdAt.getTime();
    if (cmp === 0) cmp = a.createdAt.getTime() - b.createdAt.getTime();
    return cmp * sign;
  });
}

function taskEvent(companyId: string, task: {
  id: string;
  title: string;
  status: string;
  areaId: string;
  assigneeId: string | null;
  parentId: string | null;
  priority: string;
  dueDate: Date | null;
  sort: number;
  weeklyGoalId: string | null;
  updatedAt: Date;
}): TaskUpdateEvent {
  return {
    taskId: task.id,
    companyId,
    title: task.title,
    status: task.status,
    areaId: task.areaId,
    assigneeId: task.assigneeId,
    parentId: task.parentId,
    priority: task.priority,
    dueDate: dueIso(task.dueDate),
    sort: task.sort,
    weeklyGoalId: task.weeklyGoalId,
    updatedAt: task.updatedAt.toISOString(),
  };
}

function leafDto(task: {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  sort: number;
  assigneeId: string | null;
  parentId?: string | null;
  assignee?: { name: string } | null;
}) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: dueIso(task.dueDate),
    overdue: isOverdue(task),
    sort: task.sort,
    parentId: task.parentId ?? null,
    assigneeId: task.assigneeId,
    assignee: task.assignee?.name ?? null,
  };
}

function taskDto(task: {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  sort: number;
  parentId: string | null;
  weeklyGoalId: string | null;
  createdById: string | null;
  areaId: string;
  assigneeId: string | null;
  createdAt: Date;
  updatedAt: Date;
  doneAt: Date | null;
  area?: { name: string } | null;
  assignee?: { name: string } | null;
  children?: { id: string; title: string; status: string; priority: string; dueDate: Date | null; sort: number; assigneeId: string | null; parentId: string | null; assignee: { name: string } | null }[];
  _count?: { comments: number; children: number };
}, withChildren: boolean) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: dueIso(task.dueDate),
    overdue: isOverdue(task),
    sort: task.sort,
    parentId: task.parentId,
    weeklyGoalId: task.weeklyGoalId,
    createdById: task.createdById,
    areaId: task.areaId,
    area: task.area?.name ?? null,
    assigneeId: task.assigneeId,
    assignee: task.assignee?.name ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    doneAt: task.doneAt,
    comments: task._count?.comments ?? 0,
    steps: task._count?.children ?? task.children?.length ?? 0,
    subtasks: withChildren ? (task.children || []).map((child) => leafDto(child)) : [],
  };
}

function commentDto(
  row: { id: string; taskId: string; body: string; mentions: string; createdAt: Date; author: { id: string; name: string } },
  members: { id: string; name: string }[],
) {
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(row.mentions) as unknown;
    if (Array.isArray(parsed)) ids = parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    ids = [];
  }
  const names = new Map(members.map((member) => [member.id, member.name]));
  return {
    id: row.id,
    taskId: row.taskId,
    body: row.body,
    mentions: ids,
    mentionNames: ids.map((id) => names.get(id) || '').filter(Boolean),
    authorId: row.author.id,
    author: row.author.name,
    createdAt: row.createdAt,
  };
}
