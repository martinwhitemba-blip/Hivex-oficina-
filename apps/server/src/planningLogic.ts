/** Cálculos de la Fase 2. Sin base de datos, para poder probarlos solos. */

export interface DepEdge {
  taskId: string;
  dependsOnId: string;
}

export function dependencyCycle(edges: DepEdge[], taskId: string, dependsOnId: string) {
  if (taskId === dependsOnId) return true;
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const list = next.get(edge.taskId) || [];
    list.push(edge.dependsOnId);
    next.set(edge.taskId, list);
  }
  const added = next.get(taskId) || [];
  added.push(dependsOnId);
  next.set(taskId, added);
  const seen = new Set<string>();
  const stack = [dependsOnId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const hop of next.get(current) || []) stack.push(hop);
  }
  return false;
}

export function mondayOf(iso: string) {
  const date = new Date(`${iso}T12:00:00.000Z`);
  const day = date.getUTCDay();
  const shift = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + shift);
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface LoadTask {
  assigneeId: string | null;
  status: string;
  estimateMinutes: number;
  dueDate: string | null;
}

export interface LoadPerson {
  id: string;
  name: string;
}

export function workload(people: LoadPerson[], tasks: LoadTask[], today: string) {
  return people.map((person) => {
    const mine = tasks.filter((task) => task.assigneeId === person.id && task.status !== 'hecho');
    const overdue = mine.filter((task) => task.dueDate && task.dueDate < today).length;
    const openMinutes = mine.reduce((sum, task) => sum + Math.max(0, task.estimateMinutes || 0), 0);
    return { id: person.id, name: person.name, openTasks: mine.length, openMinutes, overdue };
  }).sort((a, b) => b.openMinutes - a.openMinutes || a.name.localeCompare(b.name, 'es'));
}

export type AreaHealth = 'al_dia' | 'en_riesgo' | 'atrasado';

export function draftStatus(input: {
  areaName: string;
  done: number;
  open: number;
  overdue: number;
  missionPct: number | null;
}) {
  let health: AreaHealth = 'al_dia';
  if (input.overdue >= 3 || (input.missionPct != null && input.missionPct < 40)) health = 'atrasado';
  else if (input.overdue > 0 || (input.missionPct != null && input.missionPct < 80)) health = 'en_riesgo';
  const mission = input.missionPct == null
    ? 'Esta semana no hay misión.'
    : `La misión va al ${input.missionPct} %.`;
  const text = `${input.areaName}: ${input.done} hechas, ${input.open} abiertas y ${input.overdue} atrasadas. ${mission}`;
  return { health, text };
}

export function ruleMatches(
  rule: { whenKind: string; areaId: string | null },
  event: { kind: string; areaId: string; priority: string },
) {
  if (rule.areaId && rule.areaId !== event.areaId) return false;
  if (rule.whenKind === 'prioridad_alta') {
    return event.priority === 'alta' && (event.kind === 'tarea_creada' || event.kind === 'prioridad_alta');
  }
  return rule.whenKind === event.kind;
}

export function formSlug(title: string, suffix: string) {
  const base = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${base || 'formulario'}-${suffix}`;
}
