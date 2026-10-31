import { t } from '../i18n';
import { api, esc } from './api';
import { shell, type Session } from './pages';

interface GoalCard {
  id: string;
  title: string;
  weekStart: string;
  metric: string;
  kpiKey: string | null;
  target: number;
  current: number;
  pct: number;
  rewardPoints: number;
  awarded: boolean;
  areaId: string | null;
  areaName: string | null;
  membershipId: string | null;
  memberName: string | null;
}

interface MissionPayload {
  streakDays: number;
  streakLastDate: string | null;
  goals: GoalCard[];
}

interface AreaOption { id: string; name: string }
interface PersonOption { id: string; name: string; areaId?: string | null }

function metricLabel(metric: string) {
  if (metric === 'kpi') return t('missions.metricKpi');
  if (metric === 'manual') return t('missions.metricManual');
  return t('missions.metricTasks');
}

function who(goal: GoalCard) {
  if (goal.memberName) return `${t('missions.person')} · ${esc(goal.memberName)}`;
  if (goal.areaName) return `${t('missions.area')} · ${esc(goal.areaName)}`;
  return t('missions.person');
}

export async function renderMissions(root: HTMLElement, session: Session) {
  const [board, areas, people] = await Promise.all([
    api<MissionPayload>('/api/misiones'),
    api<AreaOption[]>('/api/areas'),
    api<PersonOption[]>('/api/empleados'),
  ]);
  const lead = session.membership.role !== 'empleado';
  const celebrated = board.goals.some((goal) => goal.awarded || goal.pct >= 100);
  const streak = board.streakDays > 0
    ? `<span class="streak-pill">${t('missions.streak', { days: board.streakDays })}</span>`
    : `<span class="chip">${t('missions.streakZero')}</span>`;
  const cards = board.goals.length
    ? board.goals.map((goal) => `
      <article class="mission${goal.awarded || goal.pct >= 100 ? ' mission-pop' : ''}" data-goal="${esc(goal.id)}">
        <header>
          <strong>${esc(goal.title)}</strong>
          <span class="chip">${metricLabel(goal.metric)}</span>
        </header>
        <p class="muted">${who(goal)} · ${t('missions.week', { date: goal.weekStart })}</p>
        <div class="mission-bar" aria-valuenow="${goal.pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.max(0, Math.min(100, goal.pct))}%"></span></div>
        <p>${goal.awarded || goal.pct >= 100 ? `<strong>${t('missions.done')}</strong> ` : ''}${t('missions.progress', { current: goal.current, target: goal.target })} · ${t('missions.reward', { points: goal.rewardPoints })}</p>
        ${goal.metric === 'manual' && (lead || goal.membershipId === session.membership.id) ? `<form class="manual" data-id="${esc(goal.id)}">
          <label>${t('missions.manualSet')}</label>
          <input name="current" type="number" min="0" step="1" value="${goal.current}">
          <button class="btn" type="submit">${t('missions.save')}</button>
        </form>` : ''}
        ${lead || goal.membershipId === session.membership.id ? `<button class="btn ghost drop-goal" type="button" data-id="${esc(goal.id)}">${t('missions.delete')}</button>` : ''}
      </article>`).join('')
    : `<p class="muted">${t('missions.empty')}</p>`;
  const form = `<form class="cardx mission-new" id="mission-form">
    <h2>${t('missions.new')}</h2>
    <div class="err" id="mission-error" hidden></div>
    <label>${t('missions.titlePh')}</label>
    <input name="title" required maxlength="120" placeholder="${t('missions.titlePh')}">
    <label>${t('missions.target')}</label>
    <input name="target" type="number" min="1" step="1" value="5" required>
    <label>${t('missions.points')}</label>
    <input name="rewardPoints" type="number" min="0" max="500" step="1" value="25">
    <label>${metricLabel('tareas')}</label>
    <select name="metric">
      <option value="tareas">${t('missions.metricTasks')}</option>
      <option value="kpi">${t('missions.metricKpi')}</option>
      <option value="manual">${t('missions.metricManual')}</option>
    </select>
    <label class="kpi-key">${t('missions.kpiKey')}</label>
    <input class="kpi-key" name="kpiKey" placeholder="llamadas">
    ${lead ? `<label>${t('missions.area')}</label>
      <select name="areaId"><option value="">${t('missions.person')}</option>${areas.map((area) => `<option value="${esc(area.id)}">${esc(area.name)}</option>`).join('')}</select>
      <label>${t('missions.person')}</label>
      <select name="membershipId"><option value="">${t('missions.area')}</option>${people.map((person) => `<option value="${esc(person.id)}">${esc(person.name)}</option>`).join('')}</select>` : ''}
    <button class="btn primary" type="submit">${t('missions.create')}</button>
  </form>`;
  root.innerHTML = shell('misiones', t('missions.title'), t('missions.subtitle'), `
    <div class="toolbar">${streak}</div>
    ${celebrated ? `<p class="mission-celebrate">${t('missions.celebrate')}</p>` : ''}
    <div class="mission-grid">${cards}</div>
    ${form}
  `);
  const error = root.querySelector('#mission-error') as HTMLElement;
  const metric = root.querySelector('select[name="metric"]') as HTMLSelectElement;
  const toggleKpi = () => {
    const show = metric.value === 'kpi';
    root.querySelectorAll('.kpi-key').forEach((node) => { (node as HTMLElement).hidden = !show; });
  };
  metric.onchange = toggleKpi;
  toggleKpi();
  const formEl = root.querySelector('#mission-form') as HTMLFormElement;
  formEl.onsubmit = async (event) => {
    event.preventDefault();
    error.hidden = true;
    const data = new FormData(formEl);
    const payload: Record<string, unknown> = {
      title: String(data.get('title') || ''),
      metric: String(data.get('metric') || 'tareas'),
      target: Number(data.get('target') || 0),
      rewardPoints: Number(data.get('rewardPoints') || 0),
    };
    if (payload.metric === 'kpi') payload.kpiKey = String(data.get('kpiKey') || '');
    if (lead) {
      const areaId = String(data.get('areaId') || '');
      const membershipId = String(data.get('membershipId') || '');
      if (areaId) payload.areaId = areaId;
      else if (membershipId) payload.membershipId = membershipId;
    } else {
      payload.membershipId = session.membership.id;
    }
    try {
      await api('/api/misiones', { method: 'POST', body: JSON.stringify(payload) });
      await renderMissions(root, session);
    } catch (err) {
      error.hidden = false;
      error.textContent = err instanceof Error ? err.message : t('common.error');
    }
  };
  root.querySelectorAll('form.manual').forEach((node) => {
    const manual = node as HTMLFormElement;
    manual.onsubmit = async (event) => {
      event.preventDefault();
      const current = Number(new FormData(manual).get('current') || 0);
      try {
        await api(`/api/misiones/${manual.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ current }) });
        await renderMissions(root, session);
      } catch (err) {
        error.hidden = false;
        error.textContent = err instanceof Error ? err.message : t('common.error');
      }
    };
  });
  root.querySelectorAll('.drop-goal').forEach((node) => {
    (node as HTMLButtonElement).onclick = async () => {
      const id = (node as HTMLButtonElement).dataset.id;
      try {
        await api(`/api/misiones/${id}`, { method: 'DELETE' });
        await renderMissions(root, session);
      } catch (err) {
        error.hidden = false;
        error.textContent = err instanceof Error ? err.message : t('common.error');
      }
    };
  });
}
