import { t } from '../i18n';
import { api, esc } from './api';
import { shell, type Session } from './pages';

interface HookRow {
  id: string;
  name: string;
  url: string;
  events: string[];
  format: string;
  active: boolean;
}

export async function renderHooks(root: HTMLElement, session: Session) {
  void session;
  const rows = await api<HookRow[]>('/api/conexiones');
  root.innerHTML = shell('conexiones', t('phase3.titleHooks'), t('phase3.subHooks'), `
    <p class="muted">${t('phase3.hookHint')}</p>
    <div id="hk-error" class="err" hidden></div>
    <p class="draft" id="hk-secret" hidden></p>
    <form id="hk-new" class="cardx">
      <input name="name" required minlength="2" placeholder="${t('phase3.hookName')}">
      <input name="url" required type="url" placeholder="${t('phase3.hookUrl')}">
      <label>${t('phase3.format')}
        <select name="format"><option value="generico">${t('phase3.formatGeneric')}</option><option value="slack">${t('phase3.formatSlack')}</option></select>
      </label>
      <label class="checkline"><input type="checkbox" name="tarea_creada" checked> ${t('phase3.eventCreated')}</label>
      <label class="checkline"><input type="checkbox" name="tarea_hecha" checked> ${t('phase3.eventDone')}</label>
      <button class="btn primary" type="submit">${t('phase3.saveHook')}</button>
    </form>
    <div class="cmp-grid">
      ${rows.map((row) => `<article class="cardx">
        <h2>${esc(row.name)}</h2>
        <p class="muted">${esc(row.url)}</p>
        <p>${esc(row.format)} · ${esc(row.events.join(', '))}</p>
        <button class="btn" type="button" data-toggle="${row.id}" data-active="${row.active ? '1' : '0'}">${row.active ? t('phase3.active') : t('phase3.paused')}</button>
        <button class="btn ghost" type="button" data-drop="${row.id}">${t('phase3.removeFile')}</button>
      </article>`).join('') || `<p class="muted">${t('phase3.noHooks')}</p>`}
    </div>
  `);
  const error = root.querySelector<HTMLElement>('#hk-error');
  const fail = (err: unknown) => {
    if (!error) return;
    error.hidden = false;
    error.textContent = err instanceof Error ? err.message : t('common.error');
  };
  root.querySelector('#hk-new')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const events = ['tarea_creada', 'tarea_hecha'].filter((name) => (form.querySelector(`[name=${name}]`) as HTMLInputElement | null)?.checked);
    try {
      const created = await api<HookRow & { secret: string }>('/api/conexiones', {
        method: 'POST',
        body: JSON.stringify({ name: String(data.get('name') || ''), url: String(data.get('url') || ''), format: String(data.get('format') || 'generico'), events }),
      });
      const note = root.querySelector<HTMLElement>('#hk-secret');
      if (note) {
        note.hidden = false;
        note.textContent = `${t('phase3.secretOnce')} ${created.secret}`;
      }
      await renderHooks(root, session);
    } catch (err) { fail(err); }
  });
  root.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((button) => {
    button.onclick = async () => {
      try {
        await api(`/api/conexiones/${button.dataset.toggle}`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active !== '1' }) });
        await renderHooks(root, session);
      } catch (err) { fail(err); }
    };
  });
  root.querySelectorAll<HTMLButtonElement>('[data-drop]').forEach((button) => {
    button.onclick = async () => {
      try {
        await api(`/api/conexiones/${button.dataset.drop}`, { method: 'DELETE' });
        await renderHooks(root, session);
      } catch (err) { fail(err); }
    };
  });
}
