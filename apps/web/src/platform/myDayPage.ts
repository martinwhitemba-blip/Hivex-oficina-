import { t } from '../i18n';
import { api, esc } from './api';
import { shell } from './pages';

interface DayTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  overdue: boolean;
}

interface DayPayload {
  today: string;
  weekStart: string;
  streakDays: number;
  points: number;
  currentTask: string;
  overdue: DayTask[];
  todayTasks: DayTask[];
  weekTasks: DayTask[];
  missions: { id: string; title: string; current: number; target: number; pct: number; awarded: boolean; rewardPoints: number }[];
  mentions: { id: string; payload: { title?: string; fromName?: string; excerpt?: string } }[];
  rank: { place: number; of: number; doneThisWeek: number };
  mirror: { taskTitle: string; overdueCount: number; missionPct: number | null; rankPlace: number; points: number };
}

function line(task: DayTask) {
  const due = task.dueDate ? ` · ${esc(task.dueDate)}` : '';
  return `<li class="${task.overdue ? 'late' : ''}">${esc(task.title)}${due}</li>`;
}

export async function renderMyDay(root: HTMLElement) {
  const day = await api<DayPayload>('/api/mi-dia');
  const streak = day.streakDays > 0
    ? `<span class="streak-pill">${t('missions.streak', { days: day.streakDays })}</span>`
    : `<span class="chip">${t('missions.streakZero')}</span>`;
  root.innerHTML = shell('mi-dia', t('myday.title'), t('myday.subtitle'), `
    <div class="toolbar">${streak}<span class="chip">${t('myday.rank', { place: day.rank.place, of: day.rank.of })}</span><span class="chip">${t('tower.doneWeek', { n: day.rank.doneThisWeek })}</span><span class="chip">${t('person.points', { n: day.points })}</span></div>
    <p class="mission-celebrate">${t('myday.mirror')}</p>
    <div class="day-grid">
      <article class="cardx">
        <h2>${t('myday.now')}</h2>
        <p>${day.currentTask ? t('myday.current', { title: day.currentTask }) : t('myday.free')}</p>
        <p class="muted">${t('myday.overdueCount', { n: day.mirror.overdueCount })} · ${t('myday.missionPct', { pct: day.mirror.missionPct ?? 0 })}</p>
      </article>
      <article class="cardx">
        <h2>${t('myday.mission')}</h2>
        ${day.missions.length ? day.missions.map((item) => `<div class="mission${item.awarded || item.pct >= 100 ? ' mission-pop' : ''}"><strong>${esc(item.title)}</strong>
          <div class="mission-bar"><span style="width:${Math.max(0, Math.min(100, item.pct))}%"></span></div>
          <p>${item.awarded || item.pct >= 100 ? `<b>${t('missions.done')}</b> ` : ''}${t('missions.progress', { current: item.current, target: item.target })}</p></div>`).join('') : `<p class="muted">${t('missions.empty')}</p>`}
      </article>
    </div>
    <h2>${t('myday.today')}</h2>
    <ul class="day-list">${day.todayTasks.map(line).join('') || `<li class="muted">${t('myday.noneToday')}</li>`}</ul>
    <h2>${t('myday.week')}</h2>
    <ul class="day-list">${day.weekTasks.map(line).join('') || `<li class="muted">${t('myday.noneWeek')}</li>`}</ul>
    <h2>${t('myday.behind')}</h2>
    <ul class="day-list">${day.overdue.map(line).join('') || `<li class="muted">${t('tower.noneLate')}</li>`}</ul>
    <h2>${t('myday.mentions')}</h2>
    <div class="note-list">${day.mentions.map((item) => `<article class="cardx"><div><b>${esc(item.payload.fromName || '')}</b> ${esc(item.payload.title || '')}<div class="muted">${esc(item.payload.excerpt || '')}</div></div></article>`).join('') || `<p class="muted">${t('myday.noMentions')}</p>`}</div>
  `);
}
