import { addDays, isoDate, weekStartOf } from './domain';
import { HttpError, type Actor } from './http';
import { missionPct } from './missions';
import { prisma } from './prisma';
import { dueIso, isOverdue } from './taskBoard';
import { companyScope } from './tenant';

const taskSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  parentId: true,
  doneAt: true,
  assigneeId: true,
} as const;

function card(task: { id: string; title: string; status: string; priority: string; dueDate: Date | null; parentId: string | null }) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: dueIso(task.dueDate),
    overdue: isOverdue(task),
    parentId: task.parentId,
  };
}

function bounds(today = isoDate()) {
  const weekStart = weekStartOf(today);
  const weekEnd = addDays(weekStart, 6);
  return {
    today,
    weekStart,
    weekEnd,
    start: new Date(`${weekStart}T00:00:00.000Z`),
    end: new Date(`${weekEnd}T23:59:59.999Z`),
    todayStart: new Date(`${today}T00:00:00.000Z`),
  };
}

async function rankWeek(companyId: string, areaId: string | null) {
  const { weekStart, start, end } = bounds();
  const people = await prisma.membership.findMany({
    where: { ...companyScope(companyId), active: true, ...(areaId ? { areaId } : {}) },
    select: {
      id: true,
      name: true,
      points: true,
      areaId: true,
      currentTaskTitle: true,
      area: { select: { id: true, name: true } },
    },
  });
  const ids = people.map((person) => person.id);
  const counts = ids.length
    ? await prisma.task.groupBy({
      by: ['assigneeId'],
      where: {
        ...companyScope(companyId),
        parentId: null,
        status: 'hecho',
        doneAt: { gte: start, lte: end },
        assigneeId: { in: ids },
      },
      _count: { _all: true },
    })
    : [];
  const doneBy = new Map(counts.map((row) => [row.assigneeId, row._count._all]));
  const ranked = people
    .map((person) => ({
      id: person.id,
      name: person.name,
      points: person.points,
      areaId: person.areaId,
      areaName: person.area?.name ?? '',
      taskTitle: person.currentTaskTitle || '',
      doneThisWeek: doneBy.get(person.id) || 0,
    }))
    .sort((a, b) => b.doneThisWeek - a.doneThisWeek || b.points - a.points || a.name.localeCompare(b.name, 'es'));
  return { weekStart, ranked };
}

export async function myDay(actor: Actor) {
  const companyId = actor.company.id;
  const me = actor.membership.id;
  const { today, weekStart, start, end, todayStart } = bounds();
  const [weekTasks, lateTasks, goals, member, mentions, board] = await Promise.all([
    prisma.task.findMany({
      where: {
        ...companyScope(companyId),
        assigneeId: me,
        OR: [
          { dueDate: { gte: start, lte: end } },
          { doneAt: { gte: start, lte: end } },
        ],
      },
      select: taskSelect,
      orderBy: [{ dueDate: 'asc' }, { sort: 'asc' }],
      take: 250,
    }),
    prisma.task.findMany({
      where: {
        ...companyScope(companyId),
        assigneeId: me,
        status: { not: 'hecho' },
        dueDate: { lt: todayStart },
      },
      select: taskSelect,
      orderBy: { dueDate: 'asc' },
      take: 50,
    }),
    prisma.weeklyGoal.findMany({
      where: {
        ...companyScope(companyId),
        weekStart,
        OR: [
          { membershipId: me },
          { areaId: actor.membership.areaId || '__none__', membershipId: null },
        ],
      },
      take: 12,
    }),
    prisma.membership.findFirst({
      where: { id: me, ...companyScope(companyId) },
      select: { streakDays: true, streakLastDate: true, points: true, currentTaskTitle: true },
    }),
    prisma.notification.findMany({
      where: { ...companyScope(companyId), recipientId: me, kind: 'mention' },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    rankWeek(companyId, null),
  ]);
  const place = board.ranked.findIndex((person) => person.id === me) + 1;
  const mine = board.ranked.find((person) => person.id === me);
  const missions = goals.map((goal) => ({
    id: goal.id,
    title: goal.title,
    metric: goal.metric,
    current: goal.current,
    target: goal.target,
    pct: missionPct(goal.current, goal.target),
    awarded: Boolean(goal.awardedAt),
    rewardPoints: goal.rewardPoints,
    areaId: goal.areaId,
    membershipId: goal.membershipId,
  }));
  const best = missions.find((goal) => goal.membershipId === me) || missions[0] || null;
  const todayTasks = weekTasks.filter((task) => dueIso(task.dueDate) === today).map(card);
  return {
    today,
    weekStart,
    streakDays: member?.streakDays ?? 0,
    streakLastDate: member?.streakLastDate ?? null,
    points: member?.points ?? 0,
    currentTask: member?.currentTaskTitle || '',
    overdue: lateTasks.map(card),
    todayTasks,
    weekTasks: weekTasks.map(card),
    missions,
    mentions: mentions.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      read: Boolean(row.readAt),
      payload: parsePayload(row.payload),
    })),
    rank: { place: place || board.ranked.length, of: board.ranked.length, doneThisWeek: mine?.doneThisWeek ?? 0 },
    mirror: {
      taskTitle: member?.currentTaskTitle || '',
      overdueCount: lateTasks.length,
      missionPct: best ? best.pct : null,
      rankPlace: place || board.ranked.length,
      points: member?.points ?? 0,
    },
  };
}

export async function controlTower(actor: Actor) {
  if (actor.membership.role === 'empleado') throw new HttpError(403, 'El panel del dueño es para propietario y directores');
  const companyId = actor.company.id;
  const areaId = actor.membership.role === 'administrador' ? (actor.membership.areaId || '__none__') : null;
  const { todayStart, weekStart } = bounds();
  const [board, late, lateCounts, goals] = await Promise.all([
    rankWeek(companyId, areaId),
    prisma.task.findMany({
      where: {
        ...companyScope(companyId),
        status: { not: 'hecho' },
        dueDate: { lt: todayStart },
        parentId: null,
        ...(areaId ? { areaId } : {}),
      },
      orderBy: { dueDate: 'asc' },
      take: 40,
      include: { assignee: { select: { id: true, name: true } }, area: { select: { name: true } } },
    }),
    prisma.task.groupBy({
      by: ['assigneeId'],
      where: {
        ...companyScope(companyId),
        status: { not: 'hecho' },
        dueDate: { lt: todayStart },
        parentId: null,
        assigneeId: { not: null },
        ...(areaId ? { areaId } : {}),
      },
      _count: { _all: true },
    }),
    prisma.weeklyGoal.findMany({
      where: {
        ...companyScope(companyId),
        weekStart,
        membershipId: null,
        ...(areaId ? { areaId } : {}),
      },
      include: { area: { select: { name: true } } },
      take: 40,
    }),
  ]);
  const lateBy = new Map(lateCounts.map((row) => [row.assigneeId, row._count._all]));
  const personal = await prisma.weeklyGoal.findMany({
    where: {
      ...companyScope(companyId),
      weekStart,
      membershipId: { in: board.ranked.map((person) => person.id) },
    },
    select: { membershipId: true, current: true, target: true },
    take: 200,
  });
  const personalPct = new Map(personal.map((goal) => [goal.membershipId, missionPct(goal.current, goal.target)]));
  const areaPct = new Map(goals.map((goal) => [goal.areaId, missionPct(goal.current, goal.target)]));
  return {
    weekStart,
    people: board.ranked.map((person, index) => ({
      id: person.id,
      name: person.name,
      areaName: person.areaName,
      taskTitle: person.taskTitle,
      overdue: lateBy.get(person.id) || 0,
      missionPct: personalPct.get(person.id) ?? areaPct.get(person.areaId) ?? null,
      rankPlace: index + 1,
      points: person.points,
      doneThisWeek: person.doneThisWeek,
    })),
    overdue: late.map((task) => ({
      id: task.id,
      title: task.title,
      assignee: task.assignee?.name ?? null,
      assigneeId: task.assigneeId,
      area: task.area.name,
      dueDate: dueIso(task.dueDate),
      priority: task.priority,
    })),
    missions: goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      areaName: goal.area?.name ?? null,
      current: goal.current,
      target: goal.target,
      pct: missionPct(goal.current, goal.target),
      awarded: Boolean(goal.awardedAt),
    })),
    ranking: board.ranked.map((person, index) => ({
      place: index + 1,
      id: person.id,
      name: person.name,
      areaName: person.areaName,
      doneThisWeek: person.doneThisWeek,
      points: person.points,
    })),
  };
}

function parsePayload(raw: string) {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
