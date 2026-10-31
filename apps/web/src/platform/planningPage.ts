import { t, type MessageKey } from '../i18n';
import { api, esc } from './api';
import { shell, type Session } from './pages';

interface AreaRow { id: string; name: string }
interface CalTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  areaId: string;
  area: string;
  assignee: string;
  startDate: string | null;
  dueDate: string | null;
  estimateMinutes: number;
  blockedBy: { id: string; title: string; done: boolean }[];
}
interface LoadPerson { id: string; name: string; openTasks: number; openMinutes: number; overdue: number }
interface FieldRow { id: string; label: string; kind: string; options: string[] }
interface TemplateRow { id: string; title: string; priority: string; checklist: string[] }
interface RuleRow { id: string; name: string; enabled: boolean; whenKind: string; thenKind: string }
interface FormRow { id: string; slug: string; title: string; intro: string; active: boolean }
interface StatusRow { areaId: string; area: string; health: string; note: string; draft: string }

const VIEWS = ['calendario', 'cronograma', 'carga', 'campos', 'reglas', 'formularios', 'estado'] as const;
const LABELS: Record<View, MessageKey> = {
  calendario: 'planning.calendario',
  cronograma: 'planning.cronograma',
  carga: 'planning.carga',
  campos: 'planning.campos',
  reglas: 'planning.reglas',
  formularios: 'planning.formularios',
  estado: 'planning.estado',
};
type View = typeof VIEWS[number];

function query() {
  const raw = location.hash.split('?')[1] || '';
  return new URLSearchParams(raw);
}

function go(vista: View) {
  const params = query();
  params.set('vista', vista);
  location.hash = `#/planificacion?${params}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function shift(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function viewOf(): View {
  const value = query().get('vista') || 'calendario';
  return (VIEWS as readonly string[]).includes(value) ? value as View : 'calendario';
}

export async function renderPlanning(root: HTMLElement, session: Session) {
  const vista = viewOf();
  const director = session.membership.role !== 'empleado';
  const tabs = VIEWS.map((id) => `<a class="btn ${id === vista ? 'primary' : 'ghost'}" href="#/planificacion?vista=${id}">${t(LABELS[id])}</a>`).join('');
  let body = '';
  if (vista === 'calendario' || vista === 'cronograma') body = await calendarBody(vista, director);
  else if (vista === 'carga') body = await loadBody();
  else if (vista === 'campos') body = await fieldsBody(director);
  else if (vista === 'reglas') body = director ? await rulesBody() : `<p>${esc(t('planning.manageOnly'))}</p>`;
  else if (vista === 'formularios') body = director ? await formsBody() : `<p>${esc(t('planning.manageOnly'))}</p>`;
  else body = await statusBody(director);
  root.innerHTML = shell('planificacion', t('planning.title'), t('planning.subtitle'), `<div class="plan-tabs">${tabs}</div>${body}`);
  wire(root);
}

async function areas() {
  return api<AreaRow[]>('/api/areas');
}

async function calendarBody(vista: View, director: boolean) {
  const params = query();
  const desde = params.get('desde') || today();
  const hasta = params.get('hasta') || shift(desde, 13);
  const areaId = params.get('areaId') || '';
  const list = await areas();
  const tasks = await api<CalTask[]>(`/api/plan/calendario?desde=${desde}&hasta=${hasta}${areaId ? `&areaId=${encodeURIComponent(areaId)}` : ''}`);
  const options = [`<option value="">${esc(t('planning.allAreas'))}</option>`].concat(list.map((area) => `<option value="${esc(area.id)}" ${area.id === areaId ? 'selected' : ''}>${esc(area.name)}</option>`)).join('');
  const filters = `<form class="toolbar plan-filters" data-filters>
    <label>${esc(t('planning.from'))}<input name="desde" type="date" value="${esc(desde)}"></label>
    <label>${esc(t('planning.to'))}<input name="hasta" type="date" value="${esc(hasta)}"></label>
    <label>${esc(t('planning.area'))}<select name="areaId">${options}</select></label>
    <button class="btn" type="submit">${esc(t('planning.save'))}</button>
  </form>`;
  if (!tasks.length) return `${filters}<p>${esc(t('planning.empty'))}</p>`;
  if (vista === 'cronograma') {
    const rows = tasks.map((task) => {
      const bar = barStyle(task, desde, hasta);
      return `<div class="gantt-row"><span>${esc(task.title)}</span><div class="gantt-track"><i class="gantt-bar" style="${bar}"></i></div></div>`;
    }).join('');
    return `${filters}<div class="gantt">${rows}</div>`;
  }
  const cards = tasks.map((task) => {
    const deps = task.blockedBy.map((dep) => esc(dep.title)).join(', ');
    const depForm = director ? `<form class="sub-form" data-dep="${esc(task.id)}">
      <input name="dependsOnId" placeholder="${esc(t('planning.dep'))}" list="plan-tasks">
      <button class="btn" type="submit">${esc(t('planning.addDep'))}</button>
    </form>` : '';
    return `<article class="cardx">
      <h2>${esc(task.title)}</h2>
      <p>${esc(task.area)} · ${esc(task.assignee || '—')} · ${esc(task.startDate || '…')} → ${esc(task.dueDate || '…')} · ${task.estimateMinutes} min</p>
      ${deps ? `<p>${esc(t('planning.blocked'))}: ${deps}</p>` : ''}
      ${depForm}
    </article>`;
  }).join('');
  const names = tasks.map((task) => `<option value="${esc(task.id)}">${esc(task.title)}</option>`).join('');
  return `${filters}<datalist id="plan-tasks">${names}</datalist><div class="grid cards">${cards}</div>`;
}

function barStyle(task: CalTask, desde: string, hasta: string) {
  const start = Date.parse(`${task.startDate || task.dueDate || desde}T12:00:00Z`);
  const end = Date.parse(`${task.dueDate || task.startDate || hasta}T12:00:00Z`);
  const from = Date.parse(`${desde}T12:00:00Z`);
  const to = Date.parse(`${hasta}T12:00:00Z`);
  const span = Math.max(1, to - from);
  const left = Math.min(92, Math.max(0, ((start - from) / span) * 100));
  const width = Math.min(100 - left, Math.max(8, ((Math.max(end, start) - start) / span) * 100));
  return `left:${left}%;width:${width}%`;
}

async function loadBody() {
  const data = await api<{ capacityMinutes: number; people: LoadPerson[] }>('/api/plan/carga');
  const rows = data.people.map((person) => {
    const pct = Math.min(100, Math.round((person.openMinutes / data.capacityMinutes) * 100));
    return `<article class="cardx">
      <h2>${esc(person.name)}</h2>
      <p>${esc(t('planning.loadOpen'))}: ${person.openTasks} · ${esc(t('planning.loadMinutes'))}: ${person.openMinutes} · ${esc(t('planning.loadLate'))}: ${person.overdue}</p>
      <div class="load-meter" title="${pct}%"><span style="width:${pct}%"></span></div>
    </article>`;
  }).join('');
  return `<p>${esc(t('planning.capacity'))}</p><div class="grid cards">${rows || `<p>${esc(t('planning.empty'))}</p>`}</div>`;
}

async function fieldsBody(director: boolean) {
  const list = await areas();
  const areaId = query().get('areaId') || list[0]?.id || '';
  const fields = areaId ? await api<FieldRow[]>(`/api/plan/campos?areaId=${encodeURIComponent(areaId)}`) : [];
  const templates = await api<TemplateRow[]>('/api/plan/plantillas');
  const options = list.map((area) => `<option value="${esc(area.id)}" ${area.id === areaId ? 'selected' : ''}>${esc(area.name)}</option>`).join('');
  const fieldCards = fields.map((field) => `<article class="cardx"><h2>${esc(field.label)}</h2><p>${esc(field.kind)}${field.options.length ? ` · ${esc(field.options.join(', '))}` : ''}</p>${director ? `<button class="btn danger" data-del-field="${esc(field.id)}">${esc(t('planning.delete'))}</button>` : ''}</article>`).join('');
  const templateCards = templates.map((item) => `<article class="cardx"><h2>${esc(item.title)}</h2><p>${item.checklist.map(esc).join(' · ')}</p>${director ? `<button class="btn" data-use="${esc(item.id)}">${esc(t('planning.use'))}</button>` : ''}</article>`).join('');
  const create = director ? `<form class="form cardx" data-field>
      <label>${esc(t('planning.area'))}<select name="areaId">${options}</select></label>
      <label>${esc(t('planning.fieldLabel'))}<input name="label" required></label>
      <label>${esc(t('planning.fieldKind'))}<select name="kind"><option value="texto">${esc(t('planning.kindText'))}</option><option value="numero">${esc(t('planning.kindNumber'))}</option><option value="opcion">${esc(t('planning.kindChoice'))}</option></select></label>
      <label>${esc(t('planning.options'))}<input name="options"></label>
      <button class="btn primary" type="submit">${esc(t('planning.create'))}</button>
    </form>
    <form class="form cardx" data-template>
      <label>${esc(t('planning.area'))}<select name="areaId">${options}</select></label>
      <label>${esc(t('planning.templateTitle'))}<input name="title" required></label>
      <label>${esc(t('planning.checklist'))}<textarea name="checklist" rows="3"></textarea></label>
      <button class="btn primary" type="submit">${esc(t('planning.create'))}</button>
    </form>` : '';
  return `<form class="toolbar" data-area><label>${esc(t('planning.area'))}<select name="areaId">${options}</select></label><button class="btn" type="submit">${esc(t('planning.save'))}</button></form><div class="grid cards">${create}${fieldCards}${templateCards}</div>`;
}

async function rulesBody() {
  const rules = await api<RuleRow[]>('/api/plan/reglas');
  const list = await areas();
  const options = [`<option value="">${esc(t('planning.allAreas'))}</option>`].concat(list.map((area) => `<option value="${esc(area.id)}">${esc(area.name)}</option>`)).join('');
  const cards = rules.map((rule) => `<article class="cardx"><h2>${esc(rule.name)}</h2><p>${esc(whenLabel(rule.whenKind))} → ${esc(thenLabel(rule.thenKind))}</p><button class="btn" data-rule="${esc(rule.id)}" data-enabled="${rule.enabled ? '0' : '1'}">${rule.enabled ? esc(t('planning.enabled')) : esc(t('planning.active'))}</button></article>`).join('');
  return `<form class="form cardx" data-rule-new>
    <label>${esc(t('planning.ruleName'))}<input name="name" required></label>
    <label>${esc(t('planning.area'))}<select name="areaId">${options}</select></label>
    <label>${esc(t('planning.when'))}<select name="whenKind"><option value="tarea_creada">${esc(t('planning.whenCreated'))}</option><option value="tarea_hecha">${esc(t('planning.whenDone'))}</option><option value="tarea_vencida">${esc(t('planning.whenLate'))}</option><option value="prioridad_alta">${esc(t('planning.whenHigh'))}</option></select></label>
    <label>${esc(t('planning.then'))}<select name="thenKind"><option value="avisar">${esc(t('planning.thenNotify'))}</option><option value="crear_tarea">${esc(t('planning.thenTask'))}</option><option value="mover_a_en_curso">${esc(t('planning.thenMove'))}</option><option value="sumar_puntos">${esc(t('planning.thenPoints'))}</option></select></label>
    <button class="btn primary" type="submit">${esc(t('planning.create'))}</button>
  </form><div class="grid cards">${cards}</div>`;
}

async function formsBody() {
  const forms = await api<FormRow[]>('/api/plan/formularios');
  const list = await areas();
  const options = list.map((area) => `<option value="${esc(area.id)}">${esc(area.name)}</option>`).join('');
  const cards = forms.map((form) => {
    const link = `${location.origin}${location.pathname}#/formulario?c=${encodeURIComponent(form.slug)}`;
    return `<article class="cardx"><h2>${esc(form.title)}</h2><p>${esc(form.intro)}</p><p><a href="#/formulario?c=${encodeURIComponent(form.slug)}">${esc(link)}</a></p><button class="btn" data-copy="${esc(link)}">${esc(t('planning.copy'))}</button></article>`;
  }).join('');
  return `<form class="form cardx" data-form>
    <label>${esc(t('planning.area'))}<select name="areaId">${options}</select></label>
    <label>${esc(t('planning.formTitle'))}<input name="title" required></label>
    <label>${esc(t('planning.formIntro'))}<textarea name="intro" rows="2"></textarea></label>
    <label>${esc(t('planning.formTask'))}<input name="taskTitle" value="${esc(t('planning.followDefault'))}"></label>
    <button class="btn primary" type="submit">${esc(t('planning.create'))}</button>
  </form><div class="grid cards">${cards}</div>`;
}

async function statusBody(director: boolean) {
  const semana = query().get('semana') || today();
  const data = await api<{ weekStart: string; areas: StatusRow[] }>(`/api/plan/estado?semana=${semana}`);
  const cards = data.areas.map((area) => `<article class="cardx" data-status="${esc(area.areaId)}">
    <h2>${esc(area.area)}</h2>
    ${director ? `<label>${esc(t('planning.health'))}<select name="health">
      <option value="al_dia" ${area.health === 'al_dia' ? 'selected' : ''}>${esc(t('planning.healthOk'))}</option>
      <option value="en_riesgo" ${area.health === 'en_riesgo' ? 'selected' : ''}>${esc(t('planning.healthRisk'))}</option>
      <option value="atrasado" ${area.health === 'atrasado' ? 'selected' : ''}>${esc(t('planning.healthLate'))}</option>
    </select></label>
    <label>${esc(t('planning.note'))}<textarea name="note" rows="2">${esc(area.note)}</textarea></label>
    <p class="draft">${esc(area.draft)}</p>
    <button class="btn" data-draft="${esc(area.areaId)}">${esc(t('planning.draftBtn'))}</button>
    <button class="btn primary" data-save-status="${esc(area.areaId)}">${esc(t('planning.saveStatus'))}</button>` : `<p>${esc(healthLabel(area.health))}</p><p>${esc(area.note || area.draft)}</p>`}
  </article>`).join('');
  return `<form class="toolbar" data-week><label>${esc(t('planning.week'))}<input type="date" name="semana" value="${esc(semana)}"></label><button class="btn" type="submit">${esc(t('planning.save'))}</button></form><p>${esc(t('planning.draftHint'))}</p><div class="grid cards">${cards}</div>`;
}

function whenLabel(kind: string) {
  if (kind === 'tarea_hecha') return t('planning.whenDone');
  if (kind === 'tarea_vencida') return t('planning.whenLate');
  if (kind === 'prioridad_alta') return t('planning.whenHigh');
  return t('planning.whenCreated');
}

function thenLabel(kind: string) {
  if (kind === 'crear_tarea') return t('planning.thenTask');
  if (kind === 'mover_a_en_curso') return t('planning.thenMove');
  if (kind === 'sumar_puntos') return t('planning.thenPoints');
  return t('planning.thenNotify');
}

function healthLabel(kind: string) {
  if (kind === 'en_riesgo') return t('planning.healthRisk');
  if (kind === 'atrasado') return t('planning.healthLate');
  return t('planning.healthOk');
}

function wire(root: HTMLElement) {
  root.querySelector<HTMLFormElement>('[data-filters]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const params = query();
    params.set('vista', viewOf());
    params.set('desde', String(data.get('desde') || ''));
    params.set('hasta', String(data.get('hasta') || ''));
    const areaId = String(data.get('areaId') || '');
    if (areaId) params.set('areaId', areaId); else params.delete('areaId');
    location.hash = `#/planificacion?${params}`;
  });
  root.querySelector<HTMLFormElement>('[data-area]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const params = query();
    params.set('vista', 'campos');
    params.set('areaId', String(data.get('areaId') || ''));
    location.hash = `#/planificacion?${params}`;
  });
  root.querySelector<HTMLFormElement>('[data-week]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    location.hash = `#/planificacion?vista=estado&semana=${data.get('semana') || today()}`;
  });
  root.querySelectorAll<HTMLFormElement>('[data-dep]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const dependsOnId = String(new FormData(form).get('dependsOnId') || '');
      if (!dependsOnId) return;
      await api('/api/plan/dependencias', { method: 'POST', body: JSON.stringify({ taskId: form.dataset.dep, dependsOnId }) });
      go('calendario');
    });
  });
  root.querySelector<HTMLFormElement>('[data-field]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    await api('/api/plan/campos', { method: 'POST', body: JSON.stringify({ areaId: data.get('areaId'), label: data.get('label'), kind: data.get('kind'), options: data.get('options') }) });
    go('campos');
  });
  root.querySelector<HTMLFormElement>('[data-template]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    await api('/api/plan/plantillas', { method: 'POST', body: JSON.stringify({ areaId: data.get('areaId'), title: data.get('title'), checklist: data.get('checklist'), description: '', priority: 'media' }) });
    go('campos');
  });
  root.querySelector<HTMLFormElement>('[data-rule-new]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    await api('/api/plan/reglas', { method: 'POST', body: JSON.stringify({ name: data.get('name'), areaId: data.get('areaId') || null, whenKind: data.get('whenKind'), thenKind: data.get('thenKind') }) });
    go('reglas');
  });
  root.querySelector<HTMLFormElement>('[data-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    await api('/api/plan/formularios', { method: 'POST', body: JSON.stringify({ areaId: data.get('areaId'), title: data.get('title'), intro: data.get('intro'), taskTitle: data.get('taskTitle') }) });
    go('formularios');
  });
  root.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const fieldId = target.dataset.delField;
    const useId = target.dataset.use;
    const ruleId = target.dataset.rule;
    const copy = target.dataset.copy;
    const draftId = target.dataset.draft;
    const saveId = target.dataset.saveStatus;
    if (fieldId) {
      await api(`/api/plan/campos/${fieldId}`, { method: 'DELETE' });
      go('campos');
    } else if (useId) {
      await api(`/api/plan/plantillas/${useId}/usar`, { method: 'POST', body: '{}' });
      location.hash = '#/tareas';
    } else if (ruleId) {
      await api(`/api/plan/reglas/${ruleId}`, { method: 'PATCH', body: JSON.stringify({ enabled: target.dataset.enabled === '1' }) });
      go('reglas');
    } else if (copy) {
      await navigator.clipboard.writeText(copy);
      target.textContent = t('planning.copied');
    } else if (draftId) {
      await api('/api/plan/estado/borrador', { method: 'POST', body: JSON.stringify({ areaId: draftId, semana: query().get('semana') || today() }) });
      go('estado');
    } else if (saveId) {
      const card = target.closest('article');
      const health = card?.querySelector<HTMLSelectElement>('[name=health]')?.value || 'al_dia';
      const note = card?.querySelector<HTMLTextAreaElement>('[name=note]')?.value || '';
      await api('/api/plan/estado', { method: 'PUT', body: JSON.stringify({ areaId: saveId, semana: query().get('semana') || today(), health, note }) });
      go('estado');
    }
  });
}

export async function renderPublicForm(root: HTMLElement) {
  const slug = new URLSearchParams(location.hash.split('?')[1] || '').get('c') || '';
  root.innerHTML = `<div class="auth-shell"><section class="auth-card" id="public-form"><p>${esc(t('common.loadFail'))}</p></section></div>`;
  const card = root.querySelector('#public-form')!;
  try {
    const form = await api<{ title: string; intro: string; company: string }>(`/api/publico/formularios/${encodeURIComponent(slug)}`);
    card.innerHTML = `<p class="eyebrow">${esc(form.company)}</p><h1>${esc(form.title)}</h1><p class="lead">${esc(form.intro || t('planning.publicTitle'))}</p>
      <form class="form" data-public>
        <label>${esc(t('planning.publicName'))}<input name="name" required></label>
        <label>${esc(t('planning.publicEmail'))}<input name="email" type="email"></label>
        <label>${esc(t('planning.publicPhone'))}<input name="phone"></label>
        <label>${esc(t('planning.publicNote'))}<textarea name="note" rows="3"></textarea></label>
        <button class="btn primary" type="submit">${esc(t('planning.publicSend'))}</button>
      </form>`;
    card.querySelector('form')!.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget as HTMLFormElement);
      await api(`/api/publico/formularios/${encodeURIComponent(slug)}`, {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name'), email: data.get('email'), phone: data.get('phone'), note: data.get('note') }),
      });
      card.innerHTML = `<h1>${esc(t('planning.publicThanks'))}</h1>`;
    });
  } catch (error) {
    card.innerHTML = `<h1>${esc(t('planning.publicMissing'))}</h1><p>${esc(error instanceof Error ? error.message : '')}</p>`;
  }
}
