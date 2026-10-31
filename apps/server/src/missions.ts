import type { Prisma, WeeklyGoal } from '@prisma/client';
import { addDays, bumpStreak, isoDate, parseIsoDate, weekStartOf } from './domain';
import { HttpError, type Actor } from './http';
import { notifyAchievement } from './notify';
import { prisma } from './prisma';
import { awardBadge } from './services';
import { publishGoalProgress, type GoalProgressEvent } from './socket';
import { companyScope } from './tenant';

export const GOAL_METRICS = ['tareas', 'kpi', 'manual'] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

const goalInclude = {
  area: { select: { id: true, name: true } },
  membership: { select: { id: true, name: true, areaId: true } },
} satisfies Prisma.WeeklyGoalInclude;

type GoalRow = WeeklyGoal & {
  area: { id: string; name: string } | null;
  membership: { id: string; name: string; areaId: string | null } | null;
};

function visibleWhere(actor: Actor): Prisma.WeeklyGoalWhereInput {
  const companyId = actor.company.id;
  if (actor.membership.role === 'propietario') return { companyId };
  if (actor.membership.role === 'administrador') {
    const areaId = actor.membership.areaId || '__none__';
    return {
      companyId,
      OR: [{ areaId, membershipId: null }, { membership: { areaId } }],
    };
  }
  return {
    companyId,
    OR: [
      { membershipId: actor.membership.id },
      { areaId: actor.membership.areaId || '__none__', membershipId: null },
    ],
  };
}

export function missionPct(current: number, target: number) {
  if (!(target > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((current / target) * 100)));
}

function goalEvent(goal: WeeklyGoal): GoalProgressEvent {
  return {
    goalId: goal.id,
    companyId: goal.companyId,
    weekStart: goal.weekStart,
    metric: goal.metric,
    current: goal.current,
    target: goal.target,
    pct: missionPct(goal.current, goal.target),
    areaId: goal.areaId,
    membershipId: goal.membershipId,
    awarded: Boolean(goal.awardedAt),
  };
}

export function goalDto(goal: GoalRow) {
  return {
    id: goal.id,
    title: goal.title,
    weekStart: goal.weekStart,
    weekEnd: addDays(goal.weekStart, 6),
    metric: goal.metric,
    kpiKey: goal.kpiKey,
    target: goal.target,
    current: goal.current,
    pct: missionPct(goal.current, goal.target),
    rewardPoints: goal.rewardPoints,
    awarded: Boolean(goal.awardedAt),
    areaId: goal.areaId,
    areaName: goal.area?.name ?? null,
    membershipId: goal.membershipId,
    memberName: goal.membership?.name ?? null,
  };
}

export async function listGoals(actor: Actor, query: { semana?: string; todas?: boolean }) {
  const week = query.todas ? null : weekStartOf(query.semana && parseIsoDate(query.semana) ? query.semana : isoDate());
  const [me, goals] = await Promise.all([
    prisma.membership.findFirst({
      where: { id: actor.membership.id, ...companyScope(actor.company.id) },
      select: { streakDays: true, streakLastDate: true },
    }),
    prisma.weeklyGoal.findMany({
      where: { ...visibleWhere(actor), ...(week ? { weekStart: week } : {}) },
      include: goalInclude,
      orderBy: [{ weekStart: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
  ]);
  return {
    streakDays: me?.streakDays ?? 0,
    streakLastDate: me?.streakLastDate ?? null,
    weekStart: week,
    goals: goals.map(goalDto),
  };
}

export async function getGoal(actor: Actor, id: string) {
  const goal = await prisma.weeklyGoal.findFirst({
    where: { id, ...visibleWhere(actor) },
    include: goalInclude,
  });
  if (!goal) throw new HttpError(404, 'Misión no encontrada');
  return goalDto(goal);
}

function canEdit(actor: Actor, goal: GoalRow) {
  if (actor.membership.role === 'propietario') return true;
  if (actor.membership.role === 'administrador') {
    if (goal.membershipId) return goal.membership?.areaId === actor.membership.areaId;
    return goal.areaId === actor.membership.areaId;
  }
  return goal.membershipId === actor.membership.id;
}

export async function createGoal(actor: Actor, input: {
  title: string;
  metric: string;
  target: number;
  rewardPoints?: number;
  weekStart?: string;
  areaId?: string | null;
  membershipId?: string | null;
  kpiKey?: string | null;
}) {
  if (!GOAL_METRICS.includes(input.metric as GoalMetric)) throw new HttpError(400, 'Datos no válidos');
  const metric = input.metric as GoalMetric;
  const areaId = input.areaId || null;
  const membershipId = input.membershipId || null;
  if ((areaId && membershipId) || (!areaId && !membershipId)) {
    throw new HttpError(400, 'Elige un área o una persona');
  }
  if (!(input.target > 0)) throw new HttpError(400, 'La meta tiene que ser mayor que cero');
  if (metric === 'kpi' && !input.kpiKey) throw new HttpError(400, 'Esa misión necesita un indicador del área');
  const rawWeek = input.weekStart || isoDate();
  if (!parseIsoDate(rawWeek)) throw new HttpError(400, 'La fecha debe ser AAAA-MM-DD');
  const weekStart = weekStartOf(rawWeek);

  if (actor.membership.role === 'empleado' && membershipId !== actor.membership.id) {
    throw new HttpError(403, 'Esa misión no es tuya');
  }

  let kpiAreaId: string | null = areaId;
  if (areaId) {
    const area = await prisma.area.findFirst({ where: { id: areaId, ...companyScope(actor.company.id) } });
    if (!area) throw new HttpError(404, 'Área no encontrada');
    if (actor.membership.role === 'administrador' && area.id !== actor.membership.areaId) {
      throw new HttpError(403, 'Esa misión no es tuya');
    }
  }
  if (membershipId) {
    const person = await prisma.membership.findFirst({
      where: { id: membershipId, ...companyScope(actor.company.id), active: true },
    });
    if (!person) throw new HttpError(404, 'Empleado no encontrado');
    if (actor.membership.role === 'administrador' && person.areaId !== actor.membership.areaId) {
      throw new HttpError(403, 'Esa misión no es tuya');
    }
    kpiAreaId = person.areaId;
  }
  if (metric === 'kpi') {
    if (!kpiAreaId) throw new HttpError(400, 'Esa misión necesita un indicador del área');
    const kpi = await prisma.kpiDefinition.findFirst({ where: { areaId: kpiAreaId, key: input.kpiKey! } });
    if (!kpi) throw new HttpError(400, 'Esa misión necesita un indicador del área');
  }

  const created = await prisma.weeklyGoal.create({
    data: {
      companyId: actor.company.id,
      areaId,
      membershipId,
      weekStart,
      metric,
      kpiKey: metric === 'kpi' ? input.kpiKey! : null,
      title: input.title,
      target: input.target,
      rewardPoints: input.rewardPoints ?? 25,
      current: 0,
    },
    include: goalInclude,
  });
  const saved = metric === 'manual' ? created : await recompute(created);
  return goalDto(saved);
}

export async function updateGoal(actor: Actor, id: string, input: { current?: number; title?: string; target?: number }) {
  const goal = await prisma.weeklyGoal.findFirst({ where: { id, ...visibleWhere(actor) }, include: goalInclude });
  if (!goal) throw new HttpError(404, 'Misión no encontrada');
  if (!canEdit(actor, goal)) throw new HttpError(403, 'Esa misión no es tuya');
  if (input.current !== undefined && goal.metric !== 'manual') {
    throw new HttpError(400, 'El avance de esta misión se calcula solo');
  }
  if (input.target !== undefined && !(input.target > 0)) throw new HttpError(400, 'La meta tiene que ser mayor que cero');
  const patched = await prisma.weeklyGoal.update({
    where: { id: goal.id },
    data: {
      title: input.title,
      target: input.target,
      current: goal.metric === 'manual' ? input.current : undefined,
    },
    include: goalInclude,
  });
  const saved = patched.metric === 'manual' ? await settle(patched, patched.current) : await recompute(patched);
  return goalDto(saved);
}

export async function deleteGoal(actor: Actor, id: string) {
  const goal = await prisma.weeklyGoal.findFirst({ where: { id, ...visibleWhere(actor) }, include: goalInclude });
  if (!goal) throw new HttpError(404, 'Misión no encontrada');
  if (!canEdit(actor, goal)) throw new HttpError(403, 'Esa misión no es tuya');
  await prisma.weeklyGoal.deleteMany({ where: { id: goal.id, ...companyScope(actor.company.id) } });
  return { ok: true };
}

export async function noteActivity(companyId: string, membershipId: string, activityDate: string) {
  if (!parseIsoDate(activityDate)) return;
  const member = await prisma.membership.findFirst({
    where: { id: membershipId, ...companyScope(companyId) },
    select: { streakDays: true, streakLastDate: true },
  });
  if (!member) return;
  const next = bumpStreak(member, activityDate);
  if (next.streakDays === member.streakDays && next.streakLastDate === member.streakLastDate) return;
  await prisma.membership.updateMany({
    where: { id: membershipId, ...companyScope(companyId) },
    data: { streakDays: next.streakDays, streakLastDate: next.streakLastDate },
  });
}

export async function refreshTaskGoals(input: {
  companyId: string;
  areaIds: Array<string | null | undefined>;
  assigneeIds: Array<string | null | undefined>;
  goalIds: Array<string | null | undefined>;
  doneAts: Array<Date | null | undefined>;
}) {
  const weeks = [...new Set(input.doneAts.filter((date): date is Date => date instanceof Date).map((date) => weekStartOf(date.toISOString().slice(0, 10))))];
  if (!weeks.length) return;
  const areaIds = [...new Set(input.areaIds.filter((id): id is string => Boolean(id)))];
  const assigneeIds = [...new Set(input.assigneeIds.filter((id): id is string => Boolean(id)))];
  const goalIds = [...new Set(input.goalIds.filter((id): id is string => Boolean(id)))];
  const or: Prisma.WeeklyGoalWhereInput[] = [];
  if (areaIds.length) or.push({ areaId: { in: areaIds }, membershipId: null });
  if (assigneeIds.length) or.push({ membershipId: { in: assigneeIds } });
  if (goalIds.length) or.push({ id: { in: goalIds } });
  if (!or.length) return;
  const goals = await prisma.weeklyGoal.findMany({
    where: { ...companyScope(input.companyId), metric: 'tareas', weekStart: { in: weeks }, OR: or },
    include: goalInclude,
  });
  for (const goal of goals) await recompute(goal);
}

export async function refreshGoalsForReport(companyId: string, membershipId: string, date: string) {
  if (!parseIsoDate(date)) return;
  const member = await prisma.membership.findFirst({
    where: { id: membershipId, ...companyScope(companyId) },
    select: { areaId: true },
  });
  if (!member) return;
  const week = weekStartOf(date);
  const goals = await prisma.weeklyGoal.findMany({
    where: {
      ...companyScope(companyId),
      metric: 'kpi',
      weekStart: week,
      OR: [
        { membershipId },
        ...(member.areaId ? [{ areaId: member.areaId, membershipId: null }] : []),
      ],
    },
    include: goalInclude,
  });
  for (const goal of goals) await recompute(goal);
  await noteActivity(companyId, membershipId, date);
}

async function recompute(goal: GoalRow) {
  const current = goal.metric === 'kpi' ? await kpiTotal(goal) : await taskTotal(goal);
  return settle(goal, current);
}

async function taskTotal(goal: WeeklyGoal) {
  const start = new Date(`${goal.weekStart}T00:00:00.000Z`);
  const end = new Date(`${addDays(goal.weekStart, 6)}T23:59:59.999Z`);
  return prisma.task.count({
    where: {
      ...companyScope(goal.companyId),
      status: 'hecho',
      parentId: null,
      doneAt: { gte: start, lte: end },
      AND: [
        { OR: [{ weeklyGoalId: null }, { weeklyGoalId: goal.id }] },
        goal.membershipId ? { assigneeId: goal.membershipId } : { areaId: goal.areaId || '__none__' },
      ],
    },
  });
}

async function kpiTotal(goal: WeeklyGoal) {
  if (!goal.kpiKey) return 0;
  const end = addDays(goal.weekStart, 6);
  const reports = await prisma.dailyReport.findMany({
    where: {
      ...companyScope(goal.companyId),
      date: { gte: goal.weekStart, lte: end },
      ...(goal.membershipId
        ? { membershipId: goal.membershipId }
        : { membership: { ...companyScope(goal.companyId), areaId: goal.areaId || '__none__' } }),
    },
    select: { values: { select: { value: true, kpi: { select: { key: true } } } } },
  });
  let sum = 0;
  for (const report of reports) {
    for (const value of report.values) {
      if (value.kpi.key === goal.kpiKey) sum += value.value;
    }
  }
  return sum;
}

async function settle(goal: GoalRow, current: number) {
  const claim = goal.target > 0 && current >= goal.target && !goal.awardedAt;
  if (current === goal.current && !claim) return goal;
  if (claim) {
    for (const id of await recipientIds(goal)) {
      const fresh = await awardBadge(id, `mision_${goal.id}`, goal.title, goal.rewardPoints);
      if (fresh) {
        await notifyAchievement(goal.companyId, id, { code: `mision_${goal.id}`, label: goal.title, points: goal.rewardPoints });
      }
    }
  }
  const saved = await prisma.weeklyGoal.update({
    where: { id: goal.id },
    data: { current, ...(claim ? { awardedAt: new Date() } : {}) },
    include: goalInclude,
  });
  publishGoalProgress(goal.companyId, goalEvent(saved));
  return saved;
}

async function recipientIds(goal: WeeklyGoal) {
  if (goal.membershipId) {
    const member = await prisma.membership.findFirst({
      where: { id: goal.membershipId, ...companyScope(goal.companyId) },
      select: { id: true },
    });
    return member ? [member.id] : [];
  }
  const members = await prisma.membership.findMany({
    where: { ...companyScope(goal.companyId), areaId: goal.areaId || '__none__', active: true },
    select: { id: true },
  });
  return members.map((member) => member.id);
}
