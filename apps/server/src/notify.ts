import { addDays, isoDate } from './domain';
import type { Actor } from './http';
import { prisma } from './prisma';
import { emitToMember } from './socket';
import { companyScope } from './tenant';

export const NOTIFY_KINDS = ['assignment', 'due_soon', 'overdue', 'mention', 'achievement', 'handoff'] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

const QUIET_FOR_SELF = new Set<NotifyKind>(['assignment', 'handoff', 'mention']);

export async function unreadCount(companyId: string, recipientId: string) {
  return prisma.notification.count({
    where: { ...companyScope(companyId), recipientId, readAt: null },
  });
}

export async function notifyMember(input: {
  companyId: string;
  recipientId: string;
  kind: NotifyKind;
  payload: Record<string, unknown>;
  actorId?: string | null;
}) {
  if (!input.recipientId) return null;
  if (input.actorId && input.actorId === input.recipientId && QUIET_FOR_SELF.has(input.kind)) return null;
  const member = await prisma.membership.findFirst({
    where: { id: input.recipientId, ...companyScope(input.companyId), active: true },
  });
  if (!member) return null;
  const row = await prisma.notification.create({
    data: {
      companyId: input.companyId,
      recipientId: input.recipientId,
      kind: input.kind,
      payload: JSON.stringify(input.payload),
    },
  });
  const unread = await unreadCount(input.companyId, input.recipientId);
  const payload = parsePayload(row.payload);
  emitToMember(input.companyId, input.recipientId, 'notify:new', {
    id: row.id,
    kind: row.kind,
    payload,
    createdAt: row.createdAt.toISOString(),
    unread,
  });
  return row;
}

export async function notifyAchievement(companyId: string, recipientId: string, badge: { code: string; label: string; points?: number }) {
  return notifyMember({
    companyId,
    recipientId,
    kind: 'achievement',
    payload: { code: badge.code, title: badge.label, points: badge.points || 0 },
  });
}

export async function listNotifications(actor: Actor, take = 40) {
  await remindDue(actor);
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { ...companyScope(actor.company.id), recipientId: actor.membership.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(80, Math.max(1, take)),
    }),
    unreadCount(actor.company.id, actor.membership.id),
  ]);
  return {
    unread,
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      payload: parsePayload(row.payload),
      readAt: row.readAt,
      createdAt: row.createdAt,
    })),
  };
}

export async function markNotificationsRead(actor: Actor, ids?: string[]) {
  const where = {
    ...companyScope(actor.company.id),
    recipientId: actor.membership.id,
    readAt: null as null,
    ...(ids && ids.length ? { id: { in: ids.slice(0, 80) } } : {}),
  };
  const rows = await prisma.notification.findMany({ where, select: { id: true } });
  if (rows.length) {
    await prisma.notification.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, ...companyScope(actor.company.id), recipientId: actor.membership.id },
      data: { readAt: new Date() },
    });
  }
  const unread = await unreadCount(actor.company.id, actor.membership.id);
  emitToMember(actor.company.id, actor.membership.id, 'notify:read', {
    ids: rows.map((row) => row.id),
    unread,
  });
  return { ok: true as const, unread, ids: rows.map((row) => row.id) };
}

export async function remindDue(actor: Actor) {
  const today = isoDate();
  const horizon = new Date(`${addDays(today, 1)}T23:59:59.999Z`);
  const tasks = await prisma.task.findMany({
    where: {
      ...companyScope(actor.company.id),
      assigneeId: actor.membership.id,
      parentId: null,
      status: { not: 'hecho' },
      dueDate: { lte: horizon },
    },
    take: 40,
    select: { id: true, title: true, dueDate: true },
  });
  if (!tasks.length) return;
  const start = new Date(`${today}T00:00:00.000Z`);
  const existing = await prisma.notification.findMany({
    where: {
      ...companyScope(actor.company.id),
      recipientId: actor.membership.id,
      kind: { in: ['due_soon', 'overdue'] },
      createdAt: { gte: start },
    },
    select: { kind: true, payload: true },
  });
  const seen = new Set(existing.map((row) => `${row.kind}:${row.payload}`));
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const day = task.dueDate.toISOString().slice(0, 10);
    const kind: NotifyKind = day < today ? 'overdue' : 'due_soon';
    const payload = { taskId: task.id, title: task.title, dueDate: day };
    const marker = `${kind}:${JSON.stringify(payload)}`;
    if (seen.has(marker)) continue;
    seen.add(marker);
    await notifyMember({
      companyId: actor.company.id,
      recipientId: actor.membership.id,
      kind,
      payload,
    });
  }
}

function parsePayload(raw: string) {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* el texto guardado no era JSON */ }
  return {};
}
