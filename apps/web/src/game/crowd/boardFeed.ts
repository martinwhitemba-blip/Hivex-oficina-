import type { GoalNote, TaskNote } from './taskState';

/**
 * Traduce las respuestas de `/api/tareas` y `/api/misiones` a las notas
 * que ya entiende la oficina. Si el JSON viene a medias, se queda con lo que hay.
 */
export function notesFromTasks(rows: unknown): TaskNote[] {
  if (!Array.isArray(rows)) return [];
  const notes: TaskNote[] = [];
  for (const row of rows) notes.push(...oneTask(row, null));
  return notes;
}

export function notesFromGoals(payload: unknown): GoalNote[] {
  const goals = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { goals?: unknown }).goals)
      ? (payload as { goals: unknown[] }).goals
      : [];
  const notes: GoalNote[] = [];
  for (const row of goals) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const goalId = text(item.id) || text(item.goalId);
    const areaId = text(item.areaId);
    if (!goalId || !areaId) continue;
    notes.push({ goalId, areaId, pct: Number(item.pct) || 0 });
  }
  return notes;
}

function oneTask(row: unknown, parentId: string | null): TaskNote[] {
  if (!row || typeof row !== 'object') return [];
  const item = row as Record<string, unknown>;
  const taskId = text(item.id) || text(item.taskId);
  if (!taskId) return [];
  const note: TaskNote = {
    taskId,
    title: text(item.title),
    status: text(item.status) || 'pendiente',
    areaId: text(item.areaId),
    assigneeId: text(item.assigneeId) || null,
    parentId: text(item.parentId) || parentId,
    dueDate: text(item.dueDate) || null,
    updatedAt: text(item.updatedAt) || undefined,
    startedAt: text(item.startedAt) || text(item.currentTaskSince) || undefined,
  };
  const children = Array.isArray(item.subtasks) ? item.subtasks.flatMap((child) => oneTask(child, taskId)) : [];
  return [note, ...children];
}

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}
