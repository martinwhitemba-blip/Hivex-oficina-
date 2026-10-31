/** Tareas, subtareas y misión de cada área. Puro: se actualiza con los eventos del socket. */

export interface TaskNote {
  taskId: string;
  title?: string;
  status?: string;
  areaId?: string;
  assigneeId?: string | null;
  parentId?: string | null;
  dueDate?: string | null;
  updatedAt?: string;
  /** Inicio del reloj, si la ficha trae `currentTaskSince`. Si no, vale `updatedAt`. */
  startedAt?: string;
  deleted?: boolean;
}

export interface GoalNote {
  goalId: string;
  areaId?: string | null;
  pct?: number;
}

export interface DutyCard {
  avatarId: string;
  taskId: string;
  title: string;
  time: string;
  overdue: boolean;
  done: number;
  total: number;
}

export interface AreaTally {
  pending: number;
  doing: number;
  done: number;
  pct: number | null;
}

interface Row {
  id: string;
  title: string;
  status: string;
  areaId: string;
  assigneeId: string | null;
  parentId: string | null;
  dueDate: string | null;
  updatedAt: number;
}

interface GoalRow { areaId: string; pct: number }

export function clockLabel(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
  }
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export function isLate(dueDate: string | null, status: string, today: string) {
  return Boolean(dueDate && status !== 'hecho' && dueDate < today);
}

export class TaskState {
  private rows = new Map<string, Row>();
  private goals = new Map<string, GoalRow>();
  private since = new Map<string, { taskId: string; at: number }>();

  applyTask(note: TaskNote, now = Date.now()) {
    if (!note?.taskId) return;
    if (note.deleted) {
      this.rows.delete(note.taskId);
      return;
    }
    const prev = this.rows.get(note.taskId);
    const updatedAt = Date.parse(note.updatedAt || '') || prev?.updatedAt || now;
    this.rows.set(note.taskId, {
      id: note.taskId,
      title: note.title ?? prev?.title ?? '',
      status: note.status ?? prev?.status ?? 'pendiente',
      areaId: note.areaId ?? prev?.areaId ?? '',
      assigneeId: note.assigneeId === undefined ? prev?.assigneeId ?? null : note.assigneeId,
      parentId: note.parentId === undefined ? prev?.parentId ?? null : note.parentId,
      dueDate: note.dueDate === undefined ? prev?.dueDate ?? null : note.dueDate,
      updatedAt,
    });
    if (note.startedAt && note.assigneeId) {
      const at = Date.parse(note.startedAt);
      const remembered = this.since.get(note.assigneeId);
      if (Number.isFinite(at) && (!remembered || remembered.taskId !== note.taskId)) {
        this.since.set(note.assigneeId, { taskId: note.taskId, at });
      }
    }
  }

  applyGoal(note: GoalNote) {
    if (!note?.goalId || !note.areaId) return;
    const pct = Math.max(0, Math.min(100, Number(note.pct) || 0));
    this.goals.set(note.goalId, { areaId: note.areaId, pct });
  }

  duty(avatarId: string, now: number, today: string): DutyCard | null {
    const focus = this.focusOf(avatarId);
    if (!focus) {
      this.since.delete(avatarId);
      return null;
    }
    const root = (focus.parentId && this.rows.get(focus.parentId)) || focus;
    const kids = [...this.rows.values()].filter((row) => row.parentId === root.id);
    const remembered = this.since.get(avatarId);
    const at = remembered?.taskId === root.id ? remembered.at : root.updatedAt;
    this.since.set(avatarId, { taskId: root.id, at });
    return {
      avatarId,
      taskId: root.id,
      title: root.title,
      time: clockLabel(now - at),
      overdue: isLate(root.dueDate, root.status, today),
      done: kids.filter((row) => row.status === 'hecho').length,
      total: kids.length,
    };
  }

  tally(areaId: string | null | undefined): AreaTally {
    const rows = [...this.rows.values()].filter((row) => row.areaId === areaId && !row.parentId);
    const goals = [...this.goals.values()].filter((goal) => goal.areaId === areaId);
    const pct = goals.length ? Math.round(goals.reduce((sum, goal) => sum + goal.pct, 0) / goals.length) : null;
    return {
      pending: rows.filter((row) => row.status === 'pendiente').length,
      doing: rows.filter((row) => row.status === 'en_curso').length,
      done: rows.filter((row) => row.status === 'hecho').length,
      pct,
    };
  }

  private focusOf(avatarId: string) {
    const active = [...this.rows.values()].filter((row) => row.assigneeId === avatarId && row.status === 'en_curso');
    return active.find((row) => !row.parentId) || active[0] || null;
  }
}
