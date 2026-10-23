import { t } from '../i18n';
import { api, esc } from './api';
import { shell, type Session } from './pages';

interface Step {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  dueDate: string | null;
  overdue: boolean;
  priority: string;
}

interface TaskCard {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  overdue: boolean;
  parentId: string | null;
  areaId: string;
  area: string | null;
  assigneeId: string | null;
  assignee: string | null;
  comments: number;
  steps: number;
  subtasks: Step[];
}

interface CommentRow {
  id: string;
  body: string;
  author: string;
  authorId: string;
  mentionNames: string[];
  createdAt: string;
}

interface Filters {
  vista: 'tablero' | 'lista';
  areaId: string;
  assigneeId: string;
  prioridad: string;
  vencidas: boolean;
  orden: string;
  dir: 'asc' | 'desc';
}

const COLS = ['pendiente', 'en_curso', 'hecho'] as const;
let openTaskId: string | null = null;
let dragging = '';

function readFilters(): Filters {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const orden = params.get('orden') || 'dueDate';
  return {
    vista: params.get('vista') === 'lista' ? 'lista' : 'tablero',
    areaId: params.get('area') || '',
    assigneeId: params.get('persona') || '',
    prioridad: params.get('prioridad') || '',
    vencidas: params.get('vencidas') === '1',
    orden: ['dueDate', 'priority', 'assignee', 'area', 'title'].includes(orden) ? orden : 'dueDate',
    dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
  };
}

function writeFilters(next: Filters) {
  const params = new URLSearchParams();
  if (next.vista === 'lista') params.set('vista', 'lista');
  if (next.areaId) params.set('area', next.areaId);
  if (next.assigneeId) params.set('persona', next.assigneeId);
  if (next.prioridad) params.set('prioridad', next.prioridad);
  if (next.vencidas) params.set('vencidas', '1');
  if (next.vista === 'lista') {
    params.set('orden', next.orden);
    params.set('dir', next.dir);
  }
  const hash = params.toString() ? `#/tareas?${params}` : '#/tareas';
  if (location.hash === hash) return false;
  location.hash = hash;
  return true;
}

function priorityLabel(priority: string) {
  if (priority === 'alta') return t('tasks.high');
  if (priority === 'baja') return t('tasks.low');
  return t('tasks.mid');
}

function statusLabel(status: string) {
  if (status === 'pendiente') return t('tasks.pending');
  if (status === 'en_curso') return t('tasks.doing');
  if (status === 'hecho') return t('tasks.done');
  return status;
}

function dueLine(task: { dueDate: string | null; overdue: boolean }) {
  if (task.overdue) return `<span class="chip late">${t('tasks.overdue')}${task.dueDate ? ' · ' + esc(task.dueDate) : ''}</span>`;
  if (!task.dueDate) return `<span class="chip">${t('tasks.noDue')}</span>`;
  return `<span class="chip due">${t('tasks.due')} ${esc(task.dueDate)}</span>`;
}

function canMove(session: Session, assigneeId: string | null) {
  if (session.membership.role !== 'empleado') return true;
  return assigneeId === session.membership.id;
}

function note(node: Element | null, error: unknown) {
  const message = error instanceof Error ? error.message : t('auth.actionFailed');
  const host = (node as HTMLElement | null) || document.querySelector('#task-error');
  if (!host) {
    window.alert(message);
    return;
  }
  host.hidden = false;
  host.className = 'err';
  host.textContent = message;
}

export async function renderTasks(root: HTMLElement, session: Session) {
  const wanted = new URLSearchParams(location.hash.split('?')[1] || '').get('tarea');
  if (wanted) openTaskId = wanted;
  const filters = readFilters();
  const query = new URLSearchParams();
  query.set('vista', filters.vista);
  if (filters.areaId) query.set('areaId', filters.areaId);
  if (filters.assigneeId) query.set('assigneeId', filters.assigneeId);
  if (filters.prioridad) query.set('prioridad', filters.prioridad);
  if (filters.vencidas) query.set('vencidas', '1');
  if (filters.vista === 'lista') {
    query.set('orden', filters.orden);
    query.set('dir', filters.dir);
  }
  const [tasks, areas, people, comments] = await Promise.all([
    api<TaskCard[]>(`/api/tareas?${query}`),
    api<{ id: string; name: string }[]>('/api/areas'),
    api<{ id: string; name: string }[]>('/api/empleados'),
    openTaskId ? api<CommentRow[]>(`/api/tareas/${openTaskId}/comentarios`).catch(() => [] as CommentRow[]) : Promise.resolve([] as CommentRow[]),
  ]);
  const lead = session.membership.role !== 'empleado';
  const open = tasks.find((task) => task.id === openTaskId) || null;
  if (openTaskId && !open) openTaskId = null;
  root.innerHTML = shell('tareas', t('tasks.title'), t('tasks.subtitle'), `
    <div id="task-error" class="err" hidden></div>
    <div class="task-switch">
      <button class="btn ${filters.vista === 'tablero' ? 'primary' : ''}" id="view-board" type="button">${t('tasks.board')}</button>
      <button class="btn ${filters.vista === 'lista' ? 'primary' : ''}" id="view-list" type="button">${t('tasks.list')}</button>
    </div>
    <div class="toolbar task-filters">
      <select id="f-area"><option value="">${t('tasks.allAreas')}</option>${areas.map((area) => `<option value="${area.id}" ${area.id === filters.areaId ? 'selected' : ''}>${esc(area.name)}</option>`).join('')}</select>
      <select id="f-person"><option value="">${t('tasks.allPeople')}</option>${people.map((person) => `<option value="${person.id}" ${person.id === filters.assigneeId ? 'selected' : ''}>${esc(person.name)}</option>`).join('')}</select>
      <select id="f-prio"><option value="">${t('tasks.allPriorities')}</option>
        <option value="alta" ${filters.prioridad === 'alta' ? 'selected' : ''}>${t('tasks.high')}</option>
        <option value="media" ${filters.prioridad === 'media' ? 'selected' : ''}>${t('tasks.mid')}</option>
        <option value="baja" ${filters.prioridad === 'baja' ? 'selected' : ''}>${t('tasks.low')}</option>
      </select>
      <label class="checkline"><input id="f-late" type="checkbox" ${filters.vencidas ? 'checked' : ''}> ${t('tasks.onlyOverdue')}</label>
    </div>
    ${lead ? `<form id="task" class="toolbar task-new">
      <input name="title" placeholder="${t('tasks.newPh')}" required minlength="2">
      <select name="areaId">${areas.map((area) => `<option value="${area.id}">${esc(area.name)}</option>`).join('')}</select>
      <select name="assigneeId"><option value="">${t('owner.unassigned')}</option>${people.map((person) => `<option value="${person.id}">${esc(person.name)}</option>`).join('')}</select>
      <select name="priority"><option value="baja">${t('tasks.low')}</option><option value="media" selected>${t('tasks.mid')}</option><option value="alta">${t('tasks.high')}</option></select>
      <input name="dueDate" type="date" aria-label="${t('tasks.due')}">
      <button class="btn primary" type="submit">${t('tasks.create')}</button>
    </form>` : ''}
    ${filters.vista === 'lista' ? listView(tasks, filters) : boardView(tasks, session, lead)}
    ${open ? quest(open, comments, session) : ''}
  `);
  bind(root, session, filters, tasks);
}

function boardView(tasks: TaskCard[], session: Session, lead: boolean) {
  const titles: Record<string, string> = { pendiente: t('tasks.pending'), en_curso: t('tasks.doing'), hecho: t('tasks.done') };
  return `<div class="kanban" id="task-board">${COLS.map((col) => {
    const cards = tasks.filter((task) => task.status === col);
    return `<div class="kcol" data-col="${col}"><b>${titles[col]} <span class="cnt">${cards.length}</span></b>
      ${cards.map((task) => cardHtml(task, session, lead)).join('') || `<p class="muted drop-hint">${t('tasks.drop')}</p>`}
    </div>`;
  }).join('')}</div>`;
}

function cardHtml(task: TaskCard, session: Session, lead: boolean) {
  const move = canMove(session, task.assigneeId);
  const titles: Record<string, string> = { pendiente: t('tasks.pending'), en_curso: t('tasks.doing'), hecho: t('tasks.done') };
  return `<article class="kcard ${task.overdue ? 'late' : ''}" draggable="${move ? 'true' : 'false'}" data-id="${task.id}" data-status="${task.status}">
    <div class="kcard-top"><b>${esc(task.title)}</b><span class="prio prio-${esc(task.priority)}">${priorityLabel(task.priority)}</span></div>
    <div class="muted">${esc(task.area || '')} · ${esc(task.assignee || t('owner.unassigned'))}</div>
    <div class="kmeta">${dueLine(task)} ${task.comments ? `<span class="chip">${t('tasks.comments')} ${task.comments}</span>` : ''}</div>
    ${task.subtasks.length ? `<ul class="steps">${task.subtasks.map((step) => `<li><label class="step"><input type="checkbox" data-step="${step.id}" ${step.status === 'hecho' ? 'checked' : ''} ${canMove(session, step.assigneeId || task.assigneeId) ? '' : 'disabled'}> ${esc(step.title)}</label></li>`).join('')}</ul>` : ''}
    ${lead ? `<form class="sub-form" data-parent="${task.id}"><input name="title" placeholder="${t('tasks.subPh')}" minlength="2"><button class="btn" type="submit">${t('tasks.addSub')}</button></form>` : ''}
    <div class="kactions">${COLS.filter((next) => next !== task.status).map((next) => `<button class="btn" data-move="${task.id}" data-status="${next}" type="button" ${move ? '' : 'disabled'}>${titles[next]}</button>`).join(' ')}
      <button class="btn ghost" data-open="${task.id}" type="button">${t('tasks.comments')}</button></div>
  </article>`;
}

function listView(tasks: TaskCard[], filters: Filters) {
  const head = (key: string, label: string) => {
    const mark = filters.orden === key ? (filters.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th><button type="button" data-sort="${key}">${label}${mark}</button></th>`;
  };
  const rows = tasks.map((task) => `<tr class="${task.overdue ? 'late' : ''}" data-id="${task.id}">
    <td>${task.parentId ? '↳ ' : ''}<b>${esc(task.title)}</b></td>
    <td>${esc(task.area || '')}</td>
    <td>${esc(task.assignee || t('owner.unassigned'))}</td>
    <td><span class="prio prio-${esc(task.priority)}">${priorityLabel(task.priority)}</span></td>
    <td>${task.dueDate ? esc(task.dueDate) : t('tasks.noDue')}</td>
    <td>${task.overdue ? `<span class="chip late">${t('tasks.overdue')}</span>` : statusLabel(task.status)}</td>
    <td><button class="btn ghost" data-open="${task.id}" type="button">${t('tasks.comments')}</button></td>
  </tr>`).join('');
  return `<div class="table-wrap" id="task-list"><table class="data tasks-table">
    <thead><tr>${head('title', t('tasks.sortTitle'))}${head('area', t('tasks.sortArea'))}${head('assignee', t('tasks.sortAssignee'))}${head('priority', t('tasks.sortPriority'))}${head('dueDate', t('tasks.sortDue'))}<th>${t('tasks.pending')}</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7">${t('tasks.empty')}</td></tr>`}</tbody>
  </table></div>`;
}

function quest(task: TaskCard, comments: CommentRow[], session: Session) {
  return `<section class="cardx quest" id="quest">
    <h2>${esc(task.title)}</h2>
    <p class="muted">${t('tasks.mentionHint')}</p>
    <div class="quest-log">${comments.map((comment) => `<article><b>${esc(comment.author)}</b> <span class="muted">${esc(comment.body)}</span>
      ${comment.authorId === session.membership.id || session.membership.role !== 'empleado' ? `<button class="btn ghost" data-del="${comment.id}" type="button">×</button>` : ''}
    </article>`).join('') || `<p class="muted">${t('tasks.noComments')}</p>`}</div>
    <form id="comment"><textarea name="body" required placeholder="${t('tasks.commentPh')}"></textarea><button class="btn primary" type="submit">${t('tasks.send')}</button></form>
  </section>`;
}

function bind(root: HTMLElement, session: Session, filters: Filters, tasks: TaskCard[]) {
  const error = root.querySelector('#task-error');
  root.querySelector('#view-board')?.addEventListener('click', () => writeFilters({ ...filters, vista: 'tablero' }));
  root.querySelector('#view-list')?.addEventListener('click', () => writeFilters({ ...filters, vista: 'lista' }));
  const pull = (id: string) => (root.querySelector(id) as HTMLInputElement | HTMLSelectElement | null)?.value || '';
  const applyFilters = () => {
    writeFilters({
      ...filters,
      areaId: pull('#f-area'),
      assigneeId: pull('#f-person'),
      prioridad: pull('#f-prio'),
      vencidas: Boolean((root.querySelector('#f-late') as HTMLInputElement | null)?.checked),
    });
  };
  root.querySelector('#f-area')?.addEventListener('change', applyFilters);
  root.querySelector('#f-person')?.addEventListener('change', applyFilters);
  root.querySelector('#f-prio')?.addEventListener('change', applyFilters);
  root.querySelector('#f-late')?.addEventListener('change', applyFilters);
  root.querySelector('#task')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await api('/api/tareas', {
        method: 'POST',
        body: JSON.stringify({
          title: data.title,
          areaId: data.areaId,
          assigneeId: data.assigneeId || null,
          priority: data.priority || 'media',
          dueDate: data.dueDate || null,
        }),
      });
      await renderTasks(root, session);
    } catch (err) { note(error, err); }
  });
  root.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((button) => {
    button.onclick = async () => {
      try {
        await api(`/api/tareas/${button.dataset.move}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status }) });
        await renderTasks(root, session);
      } catch (err) { note(error, err); }
    };
  });
  root.querySelectorAll<HTMLInputElement>('[data-step]').forEach((box) => {
    box.onchange = async () => {
      try {
        await api(`/api/tareas/${box.dataset.step}`, { method: 'PATCH', body: JSON.stringify({ status: box.checked ? 'hecho' : 'pendiente' }) });
        await renderTasks(root, session);
      } catch (err) {
        box.checked = !box.checked;
        note(error, err);
      }
    };
  });
  root.querySelectorAll<HTMLFormElement>('.sub-form').forEach((form) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const title = String(new FormData(form).get('title') || '').trim();
      if (title.length < 2) return;
      try {
        await api(`/api/tareas/${form.dataset.parent}/subtareas`, { method: 'POST', body: JSON.stringify({ title }) });
        await renderTasks(root, session);
      } catch (err) { note(error, err); }
    };
  });
  root.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((button) => {
    button.onclick = () => {
      openTaskId = openTaskId === button.dataset.open ? null : button.dataset.open || null;
      void renderTasks(root, session);
    };
  });
  root.querySelector('#comment')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!openTaskId) return;
    const body = String(new FormData(event.target as HTMLFormElement).get('body') || '');
    try {
      await api(`/api/tareas/${openTaskId}/comentarios`, { method: 'POST', body: JSON.stringify({ body }) });
      await renderTasks(root, session);
    } catch (err) { note(error, err); }
  });
  root.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((button) => {
    button.onclick = async () => {
      if (!openTaskId) return;
      try {
        await api(`/api/tareas/${openTaskId}/comentarios/${button.dataset.del}`, { method: 'DELETE' });
        await renderTasks(root, session);
      } catch (err) { note(error, err); }
    };
  });
  root.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((button) => {
    button.onclick = () => {
      const orden = button.dataset.sort || 'dueDate';
      const dir = filters.orden === orden && filters.dir === 'asc' ? 'desc' : 'asc';
      writeFilters({ ...filters, vista: 'lista', orden, dir });
    };
  });
  root.querySelectorAll<HTMLElement>('.kcard').forEach((card) => {
    card.ondragstart = (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('button, input, textarea, a, select, form')) {
        event.preventDefault();
        return;
      }
      dragging = card.dataset.id || '';
      event.dataTransfer?.setData('text/plain', dragging);
      event.dataTransfer?.setData('application/x-hivex-task', dragging);
    };
  });
  root.querySelectorAll<HTMLElement>('.kcol').forEach((col) => {
    col.ondragover = (event) => {
      event.preventDefault();
      col.classList.add('over');
    };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = async (event) => {
      event.preventDefault();
      col.classList.remove('over');
      const id = event.dataTransfer?.getData('text/plain') || dragging;
      const status = col.dataset.col || '';
      dragging = '';
      const current = tasks.find((task) => task.id === id);
      if (!id || !status || current?.status === status) return;
      try {
        await api(`/api/tareas/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
        await renderTasks(root, session);
      } catch (err) { note(error, err); }
    };
  });
}
