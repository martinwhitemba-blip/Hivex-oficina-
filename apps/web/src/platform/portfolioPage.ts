import { t } from '../i18n';
import { api, esc } from './api';
import { shell, type Session } from './pages';

interface CompanyCard {
  id: string;
  name: string;
  officeName: string;
  plan: string;
  workers: number;
  areas: number;
  openTasks: number;
  overdue: number;
  doneWeek: number;
}

interface Portfolio {
  plan: string;
  canCreate: boolean;
  holding: { id: string; name: string; owner: boolean; inviteCode?: string; companies: CompanyCard[] } | null;
  mine: { id: string; name: string }[];
}

export async function renderPortfolio(root: HTMLElement, session: Session) {
  const data = await api<Portfolio>('/api/portafolio');
  const holding = data.holding;
  const linked = new Set(holding?.companies.map((company) => company.id) || []);
  const extra = holding?.owner ? data.mine.filter((company) => !linked.has(company.id)) : [];
  root.innerHTML = shell('portafolio', t('phase3.titlePortfolio'), t('phase3.subPortfolio'), `
    <div id="pf-error" class="err" hidden></div>
    ${holding ? '' : `<p class="draft">${esc(t('phase3.needGrupo'))}</p>`}
    ${data.canCreate ? `<form id="pf-new" class="toolbar">
      <input name="name" required minlength="2" placeholder="${t('phase3.holdingName')}" value="${esc(session.membership.company.name)}">
      <button class="btn primary" type="submit">${t('phase3.createHolding')}</button>
    </form>` : ''}
    ${holding && !holding.owner ? `<p class="draft">${esc(t('phase3.ownerOnly'))} ${esc(holding.name)}</p>` : ''}
    ${holding?.owner ? `<p>${esc(t('phase3.invite'))}: <b id="pf-code">${esc(holding.inviteCode || '')}</b></p>` : ''}
    ${holding ? '' : `<form id="pf-join" class="toolbar">
      <input name="code" required minlength="4" placeholder="${t('phase3.joinPh')}">
      <button class="btn" type="submit">${t('phase3.join')}</button>
    </form>`}
    <div class="cmp-grid">
      ${(holding?.companies || []).map((company) => card(company, Boolean(holding?.owner) && holding!.companies.length > 1)).join('')}
    </div>
    ${extra.length ? `<div class="toolbar">${extra.map((company) => `<button class="btn" type="button" data-add="${company.id}">${t('phase3.addMine')}: ${esc(company.name)}</button>`).join('')}</div>` : ''}
  `);
  const error = root.querySelector<HTMLElement>('#pf-error');
  const fail = (err: unknown) => {
    if (!error) return;
    error.hidden = false;
    error.textContent = err instanceof Error ? err.message : t('common.error');
  };
  root.querySelector('#pf-new')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = String(new FormData(event.target as HTMLFormElement).get('name') || '');
    try {
      await api('/api/portafolio', { method: 'POST', body: JSON.stringify({ name }) });
      await renderPortfolio(root, session);
    } catch (err) { fail(err); }
  });
  root.querySelector('#pf-join')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = String(new FormData(event.target as HTMLFormElement).get('code') || '');
    try {
      await api('/api/portafolio/unirse', { method: 'POST', body: JSON.stringify({ code }) });
      await renderPortfolio(root, session);
    } catch (err) { fail(err); }
  });
  root.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((button) => {
    button.onclick = async () => {
      try {
        await api('/api/portafolio/empresas', { method: 'POST', body: JSON.stringify({ companyId: button.dataset.add }) });
        await renderPortfolio(root, session);
      } catch (err) { fail(err); }
    };
  });
  root.querySelectorAll<HTMLButtonElement>('[data-drop]').forEach((button) => {
    button.onclick = async () => {
      try {
        await api(`/api/portafolio/empresas/${button.dataset.drop}`, { method: 'DELETE' });
        await renderPortfolio(root, session);
      } catch (err) { fail(err); }
    };
  });
}

function card(company: CompanyCard, canDrop: boolean) {
  return `<article class="cardx">
    <h2>${esc(company.name)}</h2>
    <p class="muted">${esc(company.officeName)} · ${esc(t('phase3.planLabel'))} ${esc(company.plan)}</p>
    <p>${t('phase3.workers')}: ${company.workers} · ${t('phase3.areas')}: ${company.areas}</p>
    <p>${t('phase3.openTasks')}: ${company.openTasks} · ${t('phase3.overdue')}: ${company.overdue} · ${t('phase3.doneWeek')}: ${company.doneWeek}</p>
    ${canDrop ? `<button class="btn ghost" type="button" data-drop="${company.id}">${t('phase3.remove')}</button>` : ''}
  </article>`;
}
