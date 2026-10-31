import { t, type MessageKey } from '../i18n';
import { api, esc, getToken } from './api';
import { shell, type Session } from './pages';

const WIDGETS = ['abiertas', 'hechas', 'vencidas', 'personas', 'misiones', 'areas'] as const;
const LABEL: Record<(typeof WIDGETS)[number], MessageKey> = {
  abiertas: 'phase3.widgetOpen',
  hechas: 'phase3.widgetDone',
  vencidas: 'phase3.widgetLate',
  personas: 'phase3.widgetPeople',
  misiones: 'phase3.widgetMissions',
  areas: 'phase3.widgetAreas',
};

interface Panel {
  id: string;
  name: string;
  widgets: string[];
  rangeDays: number;
  items?: { id: (typeof WIDGETS)[number]; value: number }[];
}

export async function renderReports(root: HTMLElement, _session: Session) {
  const panels = await api<Panel[]>('/api/reportes');
  const detailed = await Promise.all(panels.map((panel) => api<Panel>(`/api/reportes/${panel.id}`)));
  root.innerHTML = shell('reportes', t('phase3.titleReports'), t('phase3.subReports'), `
    <div id="rp-error" class="err" hidden></div>
    <form id="rp-new" class="cardx">
      <input name="name" required minlength="2" placeholder="${t('phase3.panelName')}">
      <label>${t('phase3.days')}
        <select name="rangeDays"><option value="7">7</option><option value="30">30</option></select>
      </label>
      <div class="plan-tabs">${WIDGETS.map((id) => `<label class="checkline"><input type="checkbox" name="widget" value="${id}" checked> ${t(LABEL[id])}</label>`).join('')}</div>
      <button class="btn primary" type="submit">${t('phase3.savePanel')}</button>
    </form>
    <div class="cmp-grid">
      ${detailed.map((panel) => `<article class="cardx">
        <h2>${esc(panel.name)}</h2>
        <p class="muted">${t('phase3.days')}: ${panel.rangeDays}</p>
        ${(panel.items || []).map((item) => `<p>${t(LABEL[item.id])}: <b>${item.value}</b></p>`).join('')}
        <button class="btn" type="button" data-pdf="${panel.id}" data-name="${esc(panel.name)}">${t('phase3.downloadPdf')}</button>
        <button class="btn ghost" type="button" data-drop="${panel.id}">${t('phase3.removeFile')}</button>
      </article>`).join('') || `<p class="muted">${t('phase3.noPanels')}</p>`}
    </div>
  `);
  const error = root.querySelector<HTMLElement>('#rp-error');
  const fail = (err: unknown) => {
    if (!error) return;
    error.hidden = false;
    error.textContent = err instanceof Error ? err.message : t('common.error');
  };
  root.querySelector('#rp-new')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const widgets = form.querySelectorAll<HTMLInputElement>('input[name=widget]:checked');
    try {
      await api('/api/reportes', {
        method: 'POST',
        body: JSON.stringify({
          name: String(data.get('name') || ''),
          rangeDays: Number(data.get('rangeDays') || 7),
          widgets: [...widgets].map((box) => box.value),
        }),
      });
      await renderReports(root, _session);
    } catch (err) { fail(err); }
  });
  root.querySelectorAll<HTMLButtonElement>('[data-pdf]').forEach((button) => {
    button.onclick = async () => {
      const headers = new Headers();
      const token = getToken();
      if (token) headers.set('X-HIVEX-Token', token);
      const response = await fetch(`/api/reportes/${button.dataset.pdf}/pdf`, { headers });
      if (!response.ok) { fail(new Error(t('common.downloadFail'))); return; }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${button.dataset.name || 'reporte'}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    };
  });
  root.querySelectorAll<HTMLButtonElement>('[data-drop]').forEach((button) => {
    button.onclick = async () => {
      try {
        await api(`/api/reportes/${button.dataset.drop}`, { method: 'DELETE' });
        await renderReports(root, _session);
      } catch (err) { fail(err); }
    };
  });
}
