import { translate } from '../../../packages/i18n/src/index';
import { HttpError, type Actor } from './http';
import { mondayOf } from './planningLogic';
import { buildReportPdf, cleanWidgets, type ReportWidget } from './phase3Logic';
import { prisma } from './prisma';
import { companyScope } from './tenant';

const WIDGET_KEY = {
  abiertas: 'phase3.widgetOpen',
  hechas: 'phase3.widgetDone',
  vencidas: 'phase3.widgetLate',
  personas: 'phase3.widgetPeople',
  misiones: 'phase3.widgetMissions',
  areas: 'phase3.widgetAreas',
} as const;

function assertLead(actor: Actor) {
  if (actor.membership.role === 'empleado') throw new HttpError(403, 'Solo dirección puede ver los reportes', 'errors.phase3.director');
}

function areaFilter(actor: Actor) {
  return actor.membership.role === 'administrador' ? actor.membership.areaId || '__none__' : null;
}

export async function listReports(actor: Actor) {
  assertLead(actor);
  const rows = await prisma.reportPanel.findMany({ where: companyScope(actor.company.id), orderBy: { name: 'asc' }, take: 40 });
  return rows.map(present);
}

export async function createReport(actor: Actor, input: { name: string; widgets: string[]; rangeDays: number }) {
  assertLead(actor);
  const widgets = cleanWidgets(input.widgets);
  if (!widgets.length) throw new HttpError(400, 'Elige al menos un número');
  const row = await prisma.reportPanel.create({
    data: {
      companyId: actor.company.id,
      name: input.name.slice(0, 80),
      widgets: JSON.stringify(widgets),
      rangeDays: input.rangeDays === 30 ? 30 : 7,
    },
  });
  return present(row);
}

export async function deleteReport(actor: Actor, id: string) {
  assertLead(actor);
  const row = await prisma.reportPanel.findFirst({ where: { id, ...companyScope(actor.company.id) } });
  if (!row) throw new HttpError(404, 'Ese panel no existe');
  await prisma.reportPanel.delete({ where: { id: row.id } });
  return { ok: true as const };
}

async function numbers(actor: Actor, rangeDays: number) {
  const areaId = areaFilter(actor);
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - rangeDays * 86400000);
  const taskWhere = { ...companyScope(actor.company.id), parentId: null, ...(areaId ? { areaId } : {}) };
  const [openTasks, done, overdue, people, areas, goals] = await Promise.all([
    prisma.task.count({ where: { ...taskWhere, status: { not: 'hecho' } } }),
    prisma.task.count({ where: { ...taskWhere, status: 'hecho', doneAt: { gte: since } } }),
    prisma.task.count({ where: { ...taskWhere, status: { not: 'hecho' }, dueDate: { lt: new Date(`${today}T00:00:00.000Z`) } } }),
    prisma.membership.count({ where: { ...companyScope(actor.company.id), active: true, ...(areaId ? { areaId } : {}) } }),
    areaId ? Promise.resolve(areaId === '__none__' ? 0 : 1) : prisma.area.count({ where: companyScope(actor.company.id) }),
    prisma.weeklyGoal.findMany({
      where: { ...companyScope(actor.company.id), weekStart: mondayOf(today), ...(areaId ? { areaId } : {}) },
      select: { target: true, current: true },
      take: 80,
    }),
  ]);
  const missionPct = goals.length
    ? Math.round(goals.reduce((sum, goal) => sum + Math.min(100, goal.target > 0 ? (goal.current / goal.target) * 100 : 0), 0) / goals.length)
    : 0;
  return { abiertas: openTasks, hechas: done, vencidas: overdue, personas: people, misiones: missionPct, areas } satisfies Record<ReportWidget, number>;
}

export async function reportData(actor: Actor, id: string) {
  assertLead(actor);
  const row = await prisma.reportPanel.findFirst({ where: { id, ...companyScope(actor.company.id) } });
  if (!row) throw new HttpError(404, 'Ese panel no existe');
  const widgets = cleanWidgets(JSON.parse(row.widgets) as string[]);
  const values = await numbers(actor, row.rangeDays);
  return { ...present(row), items: widgets.map((widget) => ({ id: widget, value: values[widget] })) };
}

export async function reportPdf(actor: Actor, id: string) {
  const data = await reportData(actor, id);
  const lines = [
    actor.company.name,
    `${translate(actor.locale, 'phase3.days')}: ${data.rangeDays}`,
    ...data.items.map((item) => `${translate(actor.locale, WIDGET_KEY[item.id])}  ${item.value}`),
  ];
  return { name: `${data.name}.pdf`, bytes: buildReportPdf(translate(actor.locale, 'phase3.titleReports'), lines) };
}

function present(row: { id: string; name: string; widgets: string; rangeDays: number }) {
  return { id: row.id, name: row.name, widgets: cleanWidgets(JSON.parse(row.widgets) as string[]), rangeDays: row.rangeDays };
}
