import type { Socket } from 'socket.io-client';
import { ZONE_LAYOUT } from '../data/zones';
import { bootLocale, formatClock, formatWhen, getLocale, knownPhrase, LANG_NAMES, langSelect, LOCALES, roleName, statusText, t, type MessageKey } from '../i18n';
import { authMode } from '../routing';
import { clearDirect, directConversationOpen, directUnreadOf, directUnreadTotal, onDirectArrival, seedDirectUnread, watchDirect } from './directUnread';
import { api, clock, esc, getToken, money, num } from './api';
import { renderTasks } from './tasksPage';
import { applyMarca, readableOnInk, type Marca } from './brand';
import logoUrl from '../assets/hivex-logo.png';

export interface Session {
  user: { id: string; email: string };
  membership: {
    id: string; name: string; role: string; roleLabel: string; points: number; photoUrl: string | null;
    area: { id: string; name: string; color: string } | null;
    jobTitle: { id: string; name: string } | null;
    company: { id: string; name: string; officeName: string; isDemo: boolean };
    look: { skin: string; hair: string; hairStyle: number; shirt: string; pants: string; glasses?: boolean; usePhoto?: boolean; photoUrl?: string | null };
  };
  locale?: string | null;
  companyLocale?: string | null;
  debeCambiarContrasena?: boolean;
}

let profileLocale: string | null | undefined;

export function setProfileLocale(value: string | null | undefined) {
  profileLocale = value;
}

const NAV: [string, MessageKey][] = [
  ['oficina', 'nav.office'], ['dueno', 'nav.owner'], ['negocio', 'nav.business'], ['equipo', 'nav.team'],
  ['areas', 'nav.areas'], ['mapa', 'nav.map'], ['tareas', 'nav.tasks'], ['jornada', 'nav.day'],
  ['chat', 'nav.chat'], ['logros', 'nav.badges'], ['plan', 'nav.plan'], ['captacion', 'nav.leads'],
];

export function shell(view: string, title: string, subtitle: string, body: string) {
  const nav = NAV.map(([id, label]) => `<a class="${view === id ? 'on' : ''}" href="#/${id}">${t(label)}</a>`).join('');
  return `<div class="page"><nav class="pn">${nav}</nav><header class="ph"><div><h1>${title}</h1><p>${subtitle}</p><p class="powered">${t('brand.powered')}</p></div>${langSelect()}</header>${body}</div>`;
}

export function renderPasswordGate(root: HTMLElement, onDone: () => void) {
  root.innerHTML = `<div class="auth-shell">
    <section class="auth-hero">
      ${langSelect()}
      <p class="eyebrow">${t('auth.gateEyebrow')}</p>
      <h1>${t('auth.heroLead')} <span>${t('auth.heroEm')}</span>.</h1>
      <p class="pitch">${t('auth.gatePitch')}</p>
    </section>
    <form class="auth-card">
      <img class="logo" src="${logoUrl}" alt="HIVEX">
      <h1>${t('auth.gateTitle')}</h1>
      <p class="lead">${t('auth.gateLead')}</p>
      <div class="err" hidden role="alert"></div>
      <label>${t('auth.tempPassword')}</label><input name="actual" type="password" required autocomplete="current-password">
      <label>${t('auth.newPassword')}</label><input name="nueva" type="password" required minlength="8" autocomplete="new-password">
      <button class="btn primary" type="submit">${t('auth.saveEnter')}</button>
    </form>
  </div>`;
  const form = root.querySelector('form')!;
  const err = root.querySelector('.err') as HTMLElement;
  form.onsubmit = async (event) => {
    event.preventDefault();
    err.hidden = true;
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await api('/api/auth/cambiar-clave', { method: 'POST', body: JSON.stringify(data) });
      onDone();
    } catch (error) {
      err.hidden = false;
      err.textContent = error instanceof Error ? error.message : t('auth.passwordFail');
    }
  };
}

export function paintSessionNotice(root: HTMLElement, name: string, onLogout: () => void, onOffice: () => void) {
  const card = root.querySelector('.auth-card');
  if (!card || root.querySelector('#session-notice')) return;
  const box = document.createElement('div');
  box.className = 'session-notice';
  box.innerHTML = `<p id="session-notice">${t('auth.session', { name: esc(name) })}</p>
    <div class="join-actions">
      <button class="btn" id="logout-continue" type="button">${t('auth.logoutContinue')}</button>
      <button class="btn" id="go-office" type="button">${t('auth.goOffice')}</button>
    </div>`;
  card.prepend(box);
  box.querySelector('#logout-continue')?.addEventListener('click', onLogout);
  box.querySelector('#go-office')?.addEventListener('click', onOffice);
}

export function renderAuth(root: HTMLElement, onDone: () => void) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const mode = authMode(location.hash);
  const title = mode === 'registro' ? t('auth.registerTitle') : mode === 'unirse' ? t('auth.joinTitle') : mode === 'codigo' ? t('auth.codeTitle') : mode === 'activar' ? t('auth.activateTitle') : t('auth.enterTitle');
  const lead = mode === 'activar'
    ? t('auth.leadActivate')
    : mode === 'codigo'
    ? t('auth.leadCode')
    : mode === 'unirse'
      ? t('auth.leadJoin')
      : t('auth.leadDefault');
  const action = (hash: string, label: string, current: string) => `<a class="btn ${mode === current ? 'on' : ''}" href="${hash}">${label}</a>`;
  const adopt = (locale?: string | null) => {
    if (localStorage.getItem('hivex.locale.pin') === '1' || profileLocale) return;
    const before = getLocale();
    bootLocale({ company: locale || null });
    if (getLocale() === before) return;
    renderAuth(root, onDone);
    window.dispatchEvent(new CustomEvent('hivex-auth-rerender'));
  };
  root.innerHTML = `<div class="auth-shell">
    <section class="auth-hero">
      ${langSelect()}
      <p class="eyebrow">${t('auth.eyebrow')}</p>
      <h1>${t('auth.heroLead')} <span>${t('auth.heroEm')}</span>.</h1>
      <p class="pitch">${t('auth.heroPitch')}</p>
      <div class="auth-actions">
        ${action('#/entrar', t('auth.enter'), 'entrar')}
        ${action('#/registro', t('auth.register'), 'registro')}
        ${action('#/codigo', t('auth.codeLink'), 'codigo')}
      </div>
    </section>
    <form class="auth-card">
    <img class="logo" src="${logoUrl}" alt="HIVEX">
    <h1>${title}</h1>
    <p class="lead">${lead}</p>
    <div class="err" hidden role="alert"></div>
    ${mode === 'activar' ? '<p id="activar-who" class="muted"></p>' : ''}
    ${mode === 'codigo' ? '<label>' + t('auth.code') + '</label><input name="code" required value="' + esc(params.get('c') || '') + '" autocomplete="off">' : ''}
    ${mode === 'unirse' ? '<label>' + t('auth.inviteCode') + '</label><input name="code" required value="' + esc(params.get('code') || '') + '">' : ''}
    ${mode === 'entrar' || mode === 'registro' || mode === 'codigo' ? '<label>' + t('auth.email') + '</label><input name="email" type="email" required autocomplete="username">' : ''}
    ${mode !== 'entrar' && mode !== 'activar' ? '<label>' + t('auth.yourName') + '</label><input name="name" required>' : ''}
    ${mode === 'registro' ? '<label>' + t('auth.companyName') + '</label><input name="companyName" required>' : ''}
    <label>${mode === 'activar' ? t('auth.newPassword') : t('auth.password')}</label><input name="password" type="password" required minlength="${mode === 'entrar' ? '1' : '8'}" autocomplete="${mode === 'entrar' ? 'current-password' : 'new-password'}">
    ${mode === 'activar' ? '<label>' + t('auth.repeatPassword') + '</label><input name="password2" type="password" required minlength="8" autocomplete="new-password">' : ''}
    <button class="btn primary" type="submit">${mode === 'entrar' ? t('auth.submitEnter') : mode === 'codigo' ? t('auth.submitOffice') : mode === 'activar' ? t('auth.submitActivate') : t('auth.submitContinue')}</button>
    <div class="auth-links">
      <a href="#/entrar">${t('auth.haveAccount')}</a>
      <a href="#/codigo">${t('auth.codeLink')}</a>
      <a href="#/registro">${t('auth.register')}</a>
    </div>
    <div class="demo-box">${t('auth.demo').replace('martin@hivex.demo', '<b>martin@hivex.demo</b>').replace('hivex-demo', '<b>hivex-demo</b>').replace('HIVEX2026', '<b>HIVEX2026</b>')}</div>
  </form></div>`;
  const form = root.querySelector('form')!;
  const err = root.querySelector('.err') as HTMLElement;
  form.onsubmit = async (event) => {
    event.preventDefault();
    err.hidden = true;
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      if (mode === 'activar') {
        if (String(data.password) !== String(data.password2)) throw new Error(t('auth.passwordMismatch'));
        const result = await api<{ token: string }>('/api/activar', { method: 'POST', body: JSON.stringify({ code: params.get('code') || '', password: data.password }) });
        localStorage.setItem('hivex_token', result.token);
        location.hash = '#/oficina';
        onDone();
        return;
      }
      const path = mode === 'registro' ? '/api/auth/registro' : mode === 'unirse' ? `/api/invitaciones/${data.code}/aceptar` : mode === 'codigo' ? '/api/acceso-codigo' : '/api/auth/entrar';
      const result = await api<{ token: string }>(path, { method: 'POST', body: JSON.stringify(data) });
      localStorage.setItem('hivex_token', result.token);
      const here = location.hash.replace(/^#\//, '').split('?')[0];
      if (here !== 'oficina') location.hash = mode === 'unirse' || mode === 'codigo' ? '#/oficina' : '#/dueno';
      onDone();
    } catch (error) {
      err.hidden = false;
      const message = error instanceof Error ? error.message : '';
      err.textContent = message || (mode === 'unirse' ? t('auth.inviteFallback') : t('auth.actionFailed'));
    }
  };
  if (!(mode === 'codigo' && params.get('c'))) applyMarca(null);
  if (mode === 'codigo' && params.get('c')) {
    void api<Marca>(`/api/marca/codigo/${encodeURIComponent(params.get('c') || '')}`).then((marca) => {
      applyMarca(marca);
      const img = root.querySelector<HTMLImageElement>('.logo');
      if (marca.logoUrl && img) img.src = marca.logoUrl;
      const lead = root.querySelector('.lead');
      if (lead) lead.textContent = t('auth.brandLead', { name: marca.nombre, office: marca.oficina });
      adopt(marca.idioma);
    }).catch(() => applyMarca(null));
  }
  if (mode === 'activar') {
    const code = params.get('code') || '';
    if (!code) {
      err.hidden = false;
      err.textContent = t('auth.activationFallback');
    } else {
      void api<{ email: string; nombre: string; empresa: string; locale?: string }>(`/api/activar/${encodeURIComponent(code)}`).then((info) => {
        const who = root.querySelector('#activar-who');
        if (who) who.textContent = `${info.nombre || info.email} · ${info.empresa} · ${info.email}`;
        adopt(info.locale);
      }).catch((error) => {
        err.hidden = false;
        err.textContent = error instanceof Error && error.message ? error.message : t('auth.activationFallback');
      });
    }
  }
  if (mode === 'unirse' && params.get('code')) {
    void api<{ email: string; empresa: string; locale?: string }>(`/api/invitaciones/${encodeURIComponent(params.get('code') || '')}`).then((info) => {
      adopt(info.locale);
    }).catch((error) => {
      err.hidden = false;
      err.textContent = error instanceof Error && error.message ? error.message : t('auth.inviteFallback');
    });
  }
}

export async function renderView(root: HTMLElement, view: string, session: Session, socket: Socket | null) {
  const [section, id = ''] = view.split('/');
  try {
    if (section === 'menu') root.innerHTML = shell('menu', t('nav.menu'), session.membership.company.name, `<div class="grid cards">${NAV.map(([key, label]) => `<a class="cardx" href="#/${key}"><strong>${t(label)}</strong></a>`).join('')}</div>`);
    else if (section === 'dueno') await renderOwner(root, session, socket);
    else if (section === 'negocio') await renderBusiness(root);
    else if (section === 'equipo' && id) await renderEmployee(root, id, session);
    else if (section === 'equipo') await renderTeam(root, session);
    else if (view === 'areas') await renderAreas(root, session);
    else if (view === 'mapa') await renderMapEditor(root, session);
    else if (view === 'tareas') await renderTasks(root, session);
    else if (view === 'jornada') await renderDay(root, session);
    else if (view === 'chat') await renderChat(root, session, socket);
    else if (view === 'logros') await renderBadges(root);
    else if (view === 'plan') await renderPlan(root, session);
    else if (view === 'captacion') await renderLeads(root, session);
    else root.innerHTML = shell('oficina', t('nav.office'), '', '');
  } catch (error) {
    root.innerHTML = shell(view, t('common.loadFail'), '', `<div class="err">${esc(error instanceof Error ? error.message : t('common.error'))}</div>`);
  }
}

async function renderOwner(root: HTMLElement, session: Session, socket: Socket | null) {
  const canOwn = session.membership.role === 'propietario';
  root.innerHTML = shell('dueno', t('owner.title'), t('owner.subtitle'), `
    <div class="toolbar">
      <input id="q" placeholder="${t('owner.search')}">
      <select id="area"><option value="">${t('owner.allAreas')}</option></select>
      <select id="status"><option value="">${t('owner.allStatuses')}</option><option value="en_linea">${statusText('en_linea')}</option><option value="en_reunion">${statusText('en_reunion')}</option><option value="en_llamada">${statusText('en_llamada')}</option><option value="ausente">${statusText('ausente')}</option><option value="cafe">${statusText('cafe')}</option><option value="desconectado">${statusText('desconectado')}</option></select>
      <button class="btn" id="mode" type="button">${t('owner.hideMap')}</button>
      ${canOwn ? `<button class="btn primary" id="new-area" type="button" style="width:auto">${t('owner.newArea')}</button>` : ''}
    </div>
    <h2>${t('owner.peopleNow')}</h2>
    <div id="live" class="grid cards"></div>
    <div id="floor-wrap" class="cardx"><h2 style="margin:0 0 8px">${t('owner.mapTitle')}</h2><p class="muted">${t('owner.mapHint')}</p><div class="floor" id="floor"></div></div>
    <h2>${t('nav.areas')}</h2>
    <div id="areas" class="grid cards"></div>
    <div id="detail"></div>
    <h2>${t('owner.tasksNow')}</h2>
    <div id="tasks" class="grid cards"></div>
    <h2>${t('owner.audit')}</h2>
    <div id="audit" class="cardx muted">${t('owner.loading')}</div>
  `);
  const live = root.querySelector('#live') as HTMLElement;
  const floorWrap = root.querySelector('#floor-wrap') as HTMLElement;
  const floor = root.querySelector('#floor') as HTMLElement;
  let showFloor = true;
  let snap: OwnerSnap | null = null;
  const draw = () => {
    if (!snap || !root.isConnected) return;
    const qEl = root.querySelector('#q') as HTMLInputElement | null;
    const areaEl = root.querySelector('#area') as HTMLSelectElement | null;
    const statusEl = root.querySelector('#status') as HTMLSelectElement | null;
    if (!qEl || !areaEl || !statusEl) return;
    const q = qEl.value.toLowerCase();
    const area = areaEl.value;
    const status = statusEl.value;
    const areaSel = areaEl;
    if (areaSel.options.length === 1) {
      for (const item of snap.areas) areaSel.insertAdjacentHTML('beforeend', `<option value="${item.id}">${esc(item.name)}</option>`);
    }
    const people = snap.people.filter((person) => {
      const blob = `${person.name} ${person.areaName} ${person.taskTitle}`.toLowerCase();
      if (q && !blob.includes(q)) return false;
      if (area && person.areaId !== area) return false;
      if (status && person.status !== status) return false;
      return true;
    });
    live.innerHTML = people.map((person) => `
      <article class="cardx person-card" data-id="${person.id}" data-drop="${person.id}">
        <div class="person">${avatar(person.photoUrl, person.name)}
          <div><div class="nm">${esc(person.name)} · ${esc(person.areaName)}${person.taskTitle ? ' · ' + esc(person.taskTitle) : ''}</div>
          <div class="muted">${person.puesto ? esc(person.puesto) : t('owner.noRole')}</div></div>
        </div>
        <p style="margin:10px 0 6px"><b>${esc(person.taskTitle || t('owner.noTask'))}</b></p>
        <div class="tag"><span class="dot" style="background:${statusColor(person.status)}"></span>${esc(statusLabel(person.status))}${person.online ? '' : ''}</div>
        <div class="muted" style="margin-top:6px">${person.taskTitle ? t('owner.onTask', { time: clock(person.taskSeconds) }) : t('owner.noTaskTime')}</div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <a class="btn" href="#/equipo/${person.id}">${t('owner.performance')}</a>
          ${canOwn ? `<button class="btn ghost" data-move="${person.id}" type="button">${t('owner.move')}</button>` : ''}
        </div>
      </article>`).join('') || `<p class="muted">${t('owner.noMatch')}</p>`;
    floor.innerHTML = snap.areas.map((areaItem) => {
      const box = ZONE_LAYOUT.find((item) => item.id === areaItem.mapRoomId) || { x: 8, y: 8, w: 20, h: 16 };
      return `<button class="zone" data-area="${areaItem.id}" style="left:${box.x}%;top:${box.y}%;width:${box.w}%;height:${box.h}%;border-color:${esc(areaItem.color)}">
        <strong>${esc(areaItem.name)}</strong>
        <span class="mini">${t('owner.zoneMeta', { online: areaItem.online, people: t('owner.people', { n: areaItem.headcount }) })}</span>
      </button>`;
    }).join('');
    const areasHost = root.querySelector('#areas') as HTMLElement;
    areasHost.innerHTML = snap.areas.map((areaItem) => `
      <button class="cardx" data-area-card="${areaItem.id}" type="button" style="text-align:left;color:inherit">
        <strong style="color:${esc(areaItem.color)}">${esc(areaItem.name)}</strong>
        <div class="muted">${t('owner.roomPeople', { room: esc(areaItem.roomName), people: t('owner.people', { n: areaItem.headcount }), online: areaItem.online })}</div>
        <div class="muted">${areaItem.people.map((person) => esc(person.name)).slice(0, 4).join(' · ') || t('owner.nobody')}</div>
      </button>`).join('');
    areasHost.querySelectorAll<HTMLButtonElement>('[data-area-card]').forEach((button) => {
      button.onclick = () => openArea(button.dataset.areaCard!, snap!);
    });
    const taskHost = root.querySelector('#tasks') as HTMLElement;
    taskHost.innerHTML = snap.tasks.map((task) => `
      <article class="cardx" draggable="true" data-task="${task.id}">
        <b>${esc(task.title)}</b>
        <div class="muted">${esc(task.area)} · ${esc(task.assignee || t('owner.unassigned'))} · ${esc(taskState(task.status))}</div>
        <button class="btn" data-re="${task.id}" type="button">${t('owner.reassign')}</button>
      </article>`).join('') || `<p class="muted">${t('owner.noTasks')}</p>`;
    live.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((button) => button.onclick = () => movePerson(button.dataset.move!, snap!));
    taskHost.querySelectorAll<HTMLButtonElement>('[data-re]').forEach((button) => button.onclick = () => reassign(button.dataset.re!, snap!));
    floor.querySelectorAll<HTMLButtonElement>('[data-area]').forEach((button) => button.onclick = () => openArea(button.dataset.area!, snap!));
    taskHost.querySelectorAll<HTMLElement>('[data-task]').forEach((card) => {
      card.ondragstart = (event) => event.dataTransfer?.setData('text/plain', card.dataset.task || '');
    });
    live.querySelectorAll<HTMLElement>('[data-drop]').forEach((card) => {
      card.ondragover = (event) => event.preventDefault();
      card.ondrop = async (event) => {
        event.preventDefault();
        const taskId = event.dataTransfer?.getData('text/plain');
        if (!taskId) return;
        try {
          await api(`/api/dueno/tareas/${taskId}/reasignar`, { method: 'POST', body: JSON.stringify({ assigneeId: card.dataset.drop }) });
          socket?.emit('panel:sync');
        } catch (error) { noteError(null, error); }
      };
    });
  };
  const load = async () => {
    snap = await api<OwnerSnap>('/api/dueno');
    draw();
    const audit = await api<{ action: string; summary: string; createdAt: string }[]>('/api/dueno/auditoria');
    const auditHost = root.querySelector('#audit');
    if (!auditHost || !root.isConnected) return;
    auditHost.innerHTML = audit.slice(0, 8).map((row) => `<div><b>${esc(row.summary)}</b><div class="muted">${esc(formatWhen(row.createdAt))}</div></div>`).join('') || t('owner.noMoves');
  };
  root.querySelector('#mode')!.addEventListener('click', () => {
    showFloor = !showFloor;
    floorWrap.hidden = !showFloor;
    (root.querySelector('#mode') as HTMLButtonElement).textContent = showFloor ? t('owner.hideMap') : t('owner.showMap');
  });
  root.querySelector('#new-area')?.addEventListener('click', async () => {
    const name = prompt(t('owner.promptArea'));
    if (!name) return;
    try {
      await api('/api/areas', { method: 'POST', body: JSON.stringify({ name, color: '#F5C518', teamName: name }) });
      await load();
    } catch (error) { noteError(null, error); }
  });
  ['#q', '#area', '#status'].forEach((sel) => root.querySelector(sel)!.addEventListener('input', draw));
  socket?.off('panel:state');
  socket?.on('panel:state', (state: OwnerSnap) => {
    if (!root.isConnected || !root.querySelector('#q')) {
      socket?.off('panel:state');
      return;
    }
    snap = state;
    draw();
  });
  socket?.emit('panel:sync');
  await load();
}

async function openArea(id: string, snap: OwnerSnap) {
  const area = snap.areas.find((item) => item.id === id);
  if (!area) return;
  const host = document.querySelector('#detail') as HTMLElement;
  host.innerHTML = `<section class="cardx"><h2 style="margin:0 0 8px;color:${esc(area.color)}">${esc(area.name)}</h2>
    <p class="muted">${esc(area.roomName)} · ${t('owner.people', { n: area.headcount })} · ${t('owner.connected', { count: area.online })}</p>
    <div class="bars">${area.kpis.map((kpi) => `<div class="barline"><span>${esc(kpi.label)}</span><div class="track"><i style="width:${Math.min(100, kpi.target ? (kpi.total / kpi.target) * 100 : 40)}%"></i></div><b>${kpi.unit === '€' ? money(kpi.total) : num(kpi.total)}${esc(kpi.unit && kpi.unit !== '€' ? ' ' + kpi.unit : '')}</b></div>`).join('') || `<span class="muted">${t('owner.noKpis')}</span>`}</div>
    <p>${area.people.map((person) => esc(person.name) + (person.taskTitle ? ' · ' + esc(person.taskTitle) : '')).join('<br>')}</p>
    <a class="btn" href="#/negocio">${t('owner.seeArea')}</a></section>`;
  host.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function reassign(taskId: string, snap: OwnerSnap) {
  const options = snap.people.map((person, index) => `${index + 1}. ${person.name}`).join('\n');
  const pick = prompt(`${t('owner.promptWho')}\n${options}`);
  const index = Number(pick) - 1;
  if (!snap.people[index]) return;
  try {
    await api(`/api/dueno/tareas/${taskId}/reasignar`, { method: 'POST', body: JSON.stringify({ assigneeId: snap.people[index].id }) });
  } catch (error) { noteError(null, error); }
}

async function movePerson(id: string, snap: OwnerSnap) {
  const options = snap.areas.map((area, index) => `${index + 1}. ${area.name}`).join('\n');
  const pick = prompt(`${t('owner.promptMove')}\n${options}`);
  const index = Number(pick) - 1;
  if (!snap.areas[index]) return;
  try {
    await api(`/api/dueno/personas/${id}/area`, { method: 'POST', body: JSON.stringify({ areaId: snap.areas[index].id }) });
  } catch (error) { noteError(null, error); }
}

async function renderBusiness(root: HTMLElement) {
  const panel = await api<Panel>('/api/panel');
  root.innerHTML = shell('negocio', t('business.title'), panel.isDemo ? t('business.demo') : t('business.live'), `
    ${panel.alerts.map((alert) => `<div class="alert ${esc(alert.level)}">${esc(alert.text)}</div>`).join('') || `<div class="cardx">${t('business.noAlerts')}</div>`}
    <p><button class="btn" id="export" type="button">${t('business.export')}</button></p>
    <div class="grid cards">${panel.areas.map((area) => `<section class="cardx"><h2 style="margin:0;color:${esc(area.color)}">${esc(area.name)}</h2>
      ${area.kpis.slice(0, 4).map((kpi) => `<div class="barline" style="margin-top:8px"><span>${esc(kpi.label)}</span><div class="track"><i style="width:${Math.min(100, kpi.pct ?? 0)}%"></i></div><b>${kpi.unit === '€' ? money(kpi.total) : num(kpi.total)}</b></div>`).join('')}
      <div style="margin-top:8px">${(area.kpis[0]?.ranking || []).slice(0, 3).map((row, i) => `<div>${i + 1}. ${esc(row.name)} · ${num(row.value)}</div>`).join('')}</div>
    </section>`).join('')}</div>
    <h2>${t('business.who')}</h2>
    <div class="cardx bars">${panel.employees.map((person) => `<div class="barline"><span>${esc(person.name)}</span><div class="track"><i style="width:${person.score}%"></i></div><b>${person.score}</b></div>`).join('')}</div>
    <h2>${t('business.rhythm')}</h2>
    ${spark(panel.areas[0]?.kpis[0])}
  `);
  root.querySelector('#export')?.addEventListener('click', () => void downloadFile('/api/panel/export.csv', 'panel-hivex.csv').catch((error) => noteError(null, error)));
}

async function downloadFile(path: string, filename: string) {
  const token = getToken();
  const headers: Record<string, string> = { 'Accept-Language': getLocale() };
  if (token) headers['X-HIVEX-Token'] = token;
  const response = await fetch(path, { headers });
  if (!response.ok) throw new Error(t('common.downloadFail'));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function spark(kpi?: PanelKpi) {
  if (!kpi) return '';
  const entries = Object.entries(kpi.byDate || {});
  if (!entries.length) return `<p class="muted">${t('business.noSeries')}</p>`;
  const max = Math.max(...entries.map(([, value]) => value), 1);
  const step = 320 / Math.max(1, entries.length - 1);
  const points = entries.map(([, value], index) => `${index * step},${140 - (value / max) * 120}`).join(' ');
  return `<svg class="chart" viewBox="0 0 320 160"><polyline fill="none" stroke="#F5C518" stroke-width="3" points="${points}"/></svg><p class="muted">${esc(kpi.label)}</p>`;
}

interface CreatedAccount {
  fila: number;
  nombre: string;
  email: string;
  rol: string;
  enlace: string;
  contrasena: string;
  area: string;
  puesto: string;
  deskId: string | null;
}
interface ImportResult { creados: CreatedAccount[]; errores: { fila: number; email: string; mensaje: string }[]; csv: string }

function accessUrl(enlace: string) {
  if (!enlace) return '';
  if (enlace.startsWith('http')) return enlace;
  return `${location.origin}${location.pathname}${enlace}`;
}

function paintImportResult(out: HTMLElement, result: ImportResult) {
  const rows = result.creados.map((person) => {
    const link = accessUrl(person.enlace);
    const access = link
      ? `<a href="${esc(link)}">${esc(link)}</a>`
      : esc(person.contrasena || '—');
    return `<tr><td>${esc(person.nombre)}</td><td>${esc(person.email)}</td><td>${esc(person.rol)}</td><td>${esc(person.area || '—')}</td><td>${access}</td></tr>`;
  }).join('');
  const errors = result.errores.map((issue) => `<li>${t('import.row', { n: issue.fila })}${issue.email ? ` (${esc(issue.email)})` : ''}: ${esc(issue.mensaje)}</li>`).join('');
  out.className = 'import-result';
  out.innerHTML = `<p>${t('import.created', { n: result.creados.length })}. ${result.errores.length ? t('import.withErrors', { n: result.errores.length }) : t('import.noErrors')} ${t('import.noEmail')}</p>
    ${rows ? `<div class="table-wrap"><table class="data"><tr><th>${t('import.colName')}</th><th>${t('import.colEmail')}</th><th>${t('import.colRole')}</th><th>${t('import.colArea')}</th><th>${t('import.colAccess')}</th></tr>${rows}</table></div>` : ''}
    ${errors ? `<ul class="err-list">${errors}</ul>` : ''}
    ${result.creados.length ? `<button class="btn" id="download-access" type="button">${t('import.download')}</button>` : ''}`;
  out.querySelector('#download-access')?.addEventListener('click', () => {
    const csv = result.csv.split('#/activar?').join(`${location.origin}${location.pathname}#/activar?`);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'accesos-hivex.csv';
    link.click();
    URL.revokeObjectURL(url);
  });
}

function peopleCards(people: Person[]) {
  return people.map((person) => `<a class="cardx person" href="#/equipo/${person.id}">${avatar(person.photoUrl, person.name)}<div><div class="nm">${esc(person.name)}</div><div class="muted">${esc(person.area?.name || t('team.noArea'))} · ${esc(person.puesto || roleName(person.roleLabel))}</div></div></a>`).join('');
}

async function renderTeam(root: HTMLElement, session: Session) {
  const people = await api<Person[]>('/api/empleados');
  const can = session.membership.role !== 'empleado';
  const owner = session.membership.role === 'propietario';
  root.innerHTML = shell('equipo', t('team.title'), t('team.subtitle'), `
    ${can ? await brandBox() : ''}
    ${can ? `<form id="add-person" class="cardx form"><h2>${t('team.addTitle')}</h2>
      <p class="muted">${t('team.addLead')}</p>
      <label>${t('team.name')}</label><input name="nombre" required minlength="2">
      <label>${t('team.email')}</label><input name="email" type="email" required>
      <label>${t('team.role')}</label><select name="rol"><option value="empleado">${t('role.employee')}</option>${owner ? `<option value="administrador">${t('role.admin')}</option>` : ''}</select>
      <label>${t('team.area')}</label><input name="area" placeholder="${t('team.areaPh')}">
      <label>${t('team.job')}</label><input name="puesto" placeholder="SDR">
      <label>${t('team.phone')}</label><input name="telefono">
      <label>${t('team.start')}</label><input name="fecha_inicio" placeholder="2026-01-15">
      <label>${t('team.schedule')}</label><input name="horario" placeholder="${t('team.schedulePh')}">
      <label>${t('team.access')}</label><select name="modo"><option value="enlace">${t('team.linkMode')}</option><option value="temporal">${t('team.tempMode')}</option></select>
      <label><input name="crearFaltantes" type="checkbox"> ${t('team.createMissing')}</label>
      <button class="btn primary" type="submit">${t('team.addButton')}</button>
      <div id="add-out" class="muted"></div>
    </form>
    <form id="import" class="cardx form"><h2>${t('team.importTitle')}</h2>
      <p class="muted">${t('team.importLead')} <button class="btn" id="plantilla" type="button">${t('team.template')}</button></p>
      <input name="file" type="file" accept=".csv,.xlsx" required>
      <label>${t('team.access')}</label><select name="modo"><option value="enlace">${t('team.linkMode')}</option><option value="temporal">${t('team.tempMode')}</option></select>
      <label><input name="crearFaltantes" type="checkbox"> ${t('team.createMissing')}</label>
      <button class="btn primary" type="submit">${t('team.importButton')}</button>
      <div id="import-out" class="muted"></div>
    </form>` : ''}
    ${can ? await joinCodeBox() : ''}
    <div id="people-grid" class="grid cards">${peopleCards(people)}</div>
    ${can ? await inviteBox() : ''}
  `);
  const refreshPeople = async () => {
    const next = await api<Person[]>('/api/empleados');
    const grid = root.querySelector('#people-grid');
    if (grid) grid.innerHTML = peopleCards(next);
  };
  root.querySelector('#add-person')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const out = root.querySelector('#add-out') as HTMLElement;
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const result = await api<ImportResult>('/api/empleados', {
        method: 'POST',
        body: JSON.stringify({ ...data, crearFaltantes: data.crearFaltantes === 'on' }),
      });
      paintImportResult(out, result);
      form.reset();
      await refreshPeople();
    } catch (error) { noteError(out, error); }
  });
  root.querySelector('#import')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const out = root.querySelector('#import-out') as HTMLElement;
    try {
      const file = (form.querySelector('input[type=file]') as HTMLInputElement).files?.[0];
      if (!file) return;
      const data = new FormData(form);
      const body = new FormData();
      body.append('file', file);
      body.append('modo', String(data.get('modo') || 'enlace'));
      if (data.get('crearFaltantes')) body.append('crearFaltantes', 'si');
      const result = await api<ImportResult>('/api/empleados/importar', { method: 'POST', body });
      paintImportResult(out, result);
      await refreshPeople();
    } catch (error) { noteError(out, error); }
  });
  root.querySelector('#plantilla')?.addEventListener('click', () => void downloadFile('/api/empleados/plantilla.csv', 'plantilla-equipo.csv').catch((error) => noteError(root.querySelector('#import-out'), error)));
  wireBrand(root);
  wireJoinCode(root);
  const invite = root.querySelector('#invite') as HTMLFormElement | null;
  invite?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const out = root.querySelector('#invite-out') as HTMLElement;
    try {
      const data = Object.fromEntries(new FormData(invite).entries());
      const result = await api<{ enlace: string }>('/api/invitaciones', { method: 'POST', body: JSON.stringify({ ...data, areaId: data.areaId || null, jobTitleId: data.jobTitleId || null }) });
      const url = `${location.origin}${location.pathname}${result.enlace}`;
      out.className = 'muted';
      out.innerHTML = `<p>${t('invite.share')}</p>
        <input id="invite-link" readonly value="${esc(url)}">
        <button class="btn" id="copy-invite" type="button">${t('join.copy')}</button>
        <span id="copy-state"></span>`;
      out.querySelector('#copy-invite')?.addEventListener('click', async () => {
        await copyText(url);
        const state = out.querySelector('#copy-state');
        if (state) state.textContent = ` ${t('invite.copied')}`;
      });
    } catch (error) { noteError(out, error); }
  });
}

async function brandBox() {
  const marca = await api<Marca>('/api/marca');
  const idioma = marca.idioma || 'es';
  return `<form id="brand" class="cardx form" data-logo="${esc(marca.logoUrl || '')}">
    <h2>${t('brand.title')}</h2>
    <p class="muted">${t('brand.lead')}</p>
    <div id="brand-preview" class="brand-preview">
      <img alt="" src="${esc(marca.logoUrl || logoUrl)}">
      <div><strong id="brand-name">${esc(marca.nombre)}</strong><div class="muted" id="brand-office">${esc(marca.oficina)}</div><div class="swatches"><i id="swatch-p" style="background:${esc(marca.primario)}"></i><i id="swatch-a" style="background:${esc(marca.acento)}"></i></div><div class="powered">${t('brand.powered')}</div></div>
    </div>
    <label>${t('brand.company')}</label><input name="nombre" required minlength="2" value="${esc(marca.nombre)}">
    <label>${t('brand.space')}</label><input name="oficina" required minlength="2" value="${esc(marca.oficina)}" placeholder="${t('brand.spacePh')}">
    <label>${t('brand.primary')}</label><input name="primario" type="color" value="${esc(marca.primario)}">
    <label>${t('brand.accent')}</label><input name="acento" type="color" value="${esc(marca.acento)}">
    <label>${t('brand.language')}</label><select name="idioma">${LOCALES.map((code) => `<option value="${code}" ${idioma === code ? 'selected' : ''}>${LANG_NAMES[code]}</option>`).join('')}</select>
    <p class="muted">${t('brand.languageHint')}</p>
    <label>${t('brand.logo')}</label><input name="logo" type="file" accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg">
    <button class="btn primary" type="submit">${t('brand.save')}</button>
    <p id="brand-out" class="muted"></p>
  </form>`;
}

function wireBrand(root: HTMLElement) {
  const form = root.querySelector('#brand') as HTMLFormElement | null;
  if (!form) return;
  const out = root.querySelector('#brand-out') as HTMLElement;
  const paint = () => {
    const data = Object.fromEntries(new FormData(form).entries());
    const nombre = String(data.nombre || '');
    const oficina = String(data.oficina || '');
    const primario = String(data.primario || '#F5C518');
    const acento = String(data.acento || '#E0A800');
    const name = root.querySelector('#brand-name');
    const office = root.querySelector('#brand-office');
    const swatchP = root.querySelector('#swatch-p') as HTMLElement | null;
    const swatchA = root.querySelector('#swatch-a') as HTMLElement | null;
    if (name) name.textContent = nombre;
    if (office) office.textContent = oficina;
    if (swatchP) swatchP.style.background = primario;
    if (swatchA) swatchA.style.background = acento;
    if (!readableOnInk(primario) || !readableOnInk(acento)) {
      out.className = 'err';
      out.textContent = t('brand.contrast');
      return;
    }
    out.className = 'muted';
    out.textContent = '';
    const marca: Marca = { nombre, oficina, primario, acento, logoUrl: form.dataset.logo || null, poweredBy: 'HIVEX', idioma: String(data.idioma || 'es') };
    applyMarca(marca);
    window.dispatchEvent(new CustomEvent('hivex-marca', { detail: marca }));
  };
  form.addEventListener('input', paint);
  form.querySelector('input[name=logo]')?.addEventListener('change', () => {
    const file = (form.querySelector('input[name=logo]') as HTMLInputElement).files?.[0];
    const img = root.querySelector('#brand-preview img') as HTMLImageElement | null;
    if (!file || !img) return;
    const url = URL.createObjectURL(file);
    img.src = url;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      if (!readableOnInk(String(data.primario)) || !readableOnInk(String(data.acento))) {
        throw new Error(t('brand.contrast'));
      }
      let marca = await api<Marca>('/api/marca', {
        method: 'PATCH',
        body: JSON.stringify({ nombre: data.nombre, oficina: data.oficina, primario: data.primario, acento: data.acento, idioma: data.idioma }),
      });
      const file = (form.querySelector('input[name=logo]') as HTMLInputElement).files?.[0];
      if (file) {
        const body = new FormData();
        body.append('file', file);
        marca = await api<Marca>('/api/marca/logo', { method: 'POST', body });
      }
      form.dataset.logo = marca.logoUrl || '';
      applyMarca(marca);
      window.dispatchEvent(new CustomEvent('hivex-marca', { detail: marca }));
      out.className = 'muted';
      out.textContent = t('brand.saved');
    } catch (error) { noteError(out, error); }
  });
}

function wireJoinCode(root: HTMLElement) {
  const out = root.querySelector('#join-out') as HTMLElement | null;
  const codeInput = root.querySelector('#join-code-value') as HTMLInputElement | null;
  const linkInput = root.querySelector('#join-link') as HTMLInputElement | null;
  const enabled = root.querySelector('#join-enabled') as HTMLInputElement | null;
  const paint = (access: { code: string | null; enabled: boolean; enlace: string }) => {
    const url = access.enlace ? `${location.origin}${location.pathname}${access.enlace}` : '';
    if (codeInput) codeInput.value = access.code || t('join.noCode');
    if (linkInput) linkInput.value = url;
    if (enabled) enabled.checked = access.enabled;
  };
  root.querySelector('#copy-join')?.addEventListener('click', async () => {
    const url = linkInput?.value || '';
    if (!url) return;
    await copyText(url);
    if (out) { out.className = 'muted'; out.textContent = t('join.copied'); }
  });
  root.querySelector('#regen-join')?.addEventListener('click', async () => {
    try {
      const access = await api<{ code: string | null; enabled: boolean; enlace: string }>('/api/empresa/codigo-acceso/regenerar', { method: 'POST' });
      paint(access);
      if (out) { out.className = 'muted'; out.textContent = t('join.newCode'); }
    } catch (error) { noteError(out, error); }
  });
  enabled?.addEventListener('change', async () => {
    try {
      const access = await api<{ code: string | null; enabled: boolean; enlace: string }>('/api/empresa/codigo-acceso', { method: 'PATCH', body: JSON.stringify({ enabled: enabled.checked }) });
      paint(access);
      if (out) { out.className = 'muted'; out.textContent = access.enabled ? t('join.on') : t('join.off'); }
    } catch (error) {
      enabled.checked = !enabled.checked;
      noteError(out, error);
    }
  });
}

async function joinCodeBox() {
  const access = await api<{ code: string | null; enabled: boolean; enlace: string }>('/api/empresa/codigo-acceso');
  const url = access.enlace ? `${location.origin}${location.pathname}${access.enlace}` : '';
  return `<form id="join-code" class="cardx form" data-join-code>
    <h2>${t('join.title')}</h2>
    <p class="muted">${t('join.lead')}</p>
    <label>${t('join.code')}</label>
    <input id="join-code-value" readonly value="${esc(access.code || t('join.noCode'))}">
    <label>${t('join.link')}</label>
    <input id="join-link" readonly value="${esc(url)}">
    <div class="join-actions">
      <button class="btn" id="copy-join" type="button">${t('join.copy')}</button>
      <button class="btn" id="regen-join" type="button">${t('join.regen')}</button>
    </div>
    <label><input id="join-enabled" type="checkbox" ${access.enabled ? 'checked' : ''}> ${t('join.active')}</label>
    <p id="join-out" class="muted"></p>
  </form>`;
}

async function inviteBox() {
  const [areas, titles] = await Promise.all([api<{ id: string; name: string }[]>('/api/areas'), api<{ id: string; name: string }[]>('/api/puestos')]);
  return `<form id="invite" class="cardx form"><h2>${t('invite.title')}</h2>
    <p class="muted">${t('invite.lead')}</p>
    <label>${t('team.email')}</label><input name="email" type="email" required>
    <label>${t('team.role')}</label><select name="role"><option value="empleado">${t('role.employee')}</option><option value="administrador">${t('invite.admin')}</option></select>
    <label>${t('team.area')}</label><select name="areaId"><option value="">${t('team.noArea')}</option>${areas.map((area) => `<option value="${area.id}">${esc(area.name)}</option>`).join('')}</select>
    <label>${t('team.job')}</label><select name="jobTitleId"><option value="">${t('owner.noRole')}</option>${titles.map((title) => `<option value="${title.id}">${esc(title.name)}</option>`).join('')}</select>
    <button class="btn primary" type="submit">${t('invite.create')}</button><p id="invite-out" class="muted"></p></form>`;
}

async function renderEmployee(root: HTMLElement, id: string, session: Session) {
  const person = await api<EmployeeDetail>(`/api/empleados/${id}`);
  const mine = person.id === session.membership.id || session.membership.role === 'propietario';
  root.innerHTML = shell('equipo', person.name, `${person.area?.name || t('team.noArea')} · ${person.puesto || roleName(person.roleLabel)}`, `
    <div class="cardx detail-hero">${person.photoUrl ? `<img src="${esc(person.photoUrl)}" alt="">` : avatar(null, person.name)}
      <div><div class="tag">${esc(statusLabel(person.status))}</div><p>${t('person.score')} <b>${person.score ?? '—'}</b> · ${t('person.points', { n: person.points ?? 0 })}</p>
      <p class="muted">${esc(person.schedule || '')} ${person.phone ? '· ' + esc(person.phone) : ''}</p></div></div>
    ${mine ? `<form id="photo" class="cardx"><label>${t('person.photo')}</label><input type="file" accept="image/*" name="file" required><button class="btn" type="submit">${t('person.upload')}</button><p id="photo-out" class="muted"></p></form>
      <label class="cardx"><input id="use-photo" type="checkbox" ${person.look?.usePhoto ? 'checked' : ''}> ${t('person.usePhoto')}</label>
      <p class="muted">${t('person.photoHint')}</p>
      <form id="look" class="cardx form"><h2>${t('person.character')}</h2>
        <p class="muted">${t('person.characterHint')}</p>
        <div class="look-grid">
          <div><label>${t('person.skin')}</label><input name="skin" type="color" value="${hex(person.look?.skin, '#EFC3A0')}"></div>
          <div><label>${t('person.hair')}</label><input name="hair" type="color" value="${hex(person.look?.hair, '#3B2A20')}"></div>
          <div><label>${t('person.style')}</label><select name="hairStyle">
            ${[['0', 'person.short'], ['1', 'person.long'], ['2', 'person.bun'], ['3', 'person.buzz']].map(([value, label]) => `<option value="${value}" ${String(person.look?.hairStyle || 0) === value ? 'selected' : ''}>${t(label as MessageKey)}</option>`).join('')}
          </select></div>
          <div><label>${t('person.shirt')}</label><input name="shirt" type="color" value="${hex(person.look?.shirt, '#E0A800')}"></div>
          <div><label>${t('person.pants')}</label><input name="pants" type="color" value="${hex(person.look?.pants, '#1F2937')}"></div>
          <label><input name="glasses" type="checkbox" ${person.look?.glasses ? 'checked' : ''}> ${t('person.glasses')}</label>
        </div>
        <button class="btn" type="submit">${t('person.save')}</button><p id="look-out" class="muted"></p>
      </form>` : ''}
    <h2>${t('person.history')}</h2>
    <div class="table-wrap"><table class="data"><tr><th>${t('person.date')}</th><th>${t('person.note')}</th><th>${t('person.metrics')}</th></tr>
      ${(person.history || []).slice().reverse().map((row) => `<tr><td>${esc(row.date)}${row.isDemo ? ' · ' + t('office.demoData') : ''}</td><td>${esc(row.note)}</td><td>${Object.entries(row.values).map(([key, value]) => `${esc(key)}: ${num(value)}`).join(', ')}</td></tr>`).join('') || `<tr><td colspan="3">${t('person.noReports')}</td></tr>`}
    </table></div>
    <p class="muted">${t('person.badges', { list: (person.badges || []).map((badge) => esc(badge.label)).join(', ') || t('person.none'), hours: person.activeHours ?? 0 })}</p>
  `);
  root.querySelector('#photo')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const out = root.querySelector('#photo-out') as HTMLElement;
    try {
      const file = (root.querySelector('#photo input[type=file]') as HTMLInputElement).files?.[0];
      if (!file) return;
      const body = new FormData();
      body.append('file', file);
      await api(`/api/empleados/${id}/foto`, { method: 'POST', body });
      location.reload();
    } catch (error) { noteError(out, error); }
  });
  root.querySelector('#use-photo')?.addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement;
    try {
      await api(`/api/empleados/${id}`, { method: 'PATCH', body: JSON.stringify({ usePhoto: input.checked }) });
      applyLocalLook(session, id, { usePhoto: input.checked });
    } catch (error) {
      input.checked = !input.checked;
      noteError(root.querySelector('#photo-out'), error);
    }
  });
  root.querySelector('#look')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const look = {
      skin: String(data.get('skin') || ''),
      hair: String(data.get('hair') || ''),
      hairStyle: Number(data.get('hairStyle') || 0),
      shirt: String(data.get('shirt') || ''),
      pants: String(data.get('pants') || ''),
      glasses: Boolean(form.querySelector<HTMLInputElement>('[name=glasses]')?.checked),
    };
    try {
      await api(`/api/empleados/${id}`, { method: 'PATCH', body: JSON.stringify({ look }) });
      applyLocalLook(session, id, look);
      const out = root.querySelector('#look-out') as HTMLElement;
      out.className = 'muted';
      out.textContent = t('person.saved');
    } catch (error) { noteError(root.querySelector('#look-out'), error); }
  });
}

async function renderAreas(root: HTMLElement, session: Session) {
  const [areas, titles] = await Promise.all([api<AreaFull[]>('/api/areas'), api<{ id: string; name: string }[]>('/api/puestos')]);
  const own = session.membership.role === 'propietario';
  root.innerHTML = shell('areas', t('areas.title'), t('areas.subtitle'), `
    ${own ? `<form id="area" class="cardx form"><h2>${t('areas.new')}</h2><label>${t('areas.name')}</label><input name="name" required><label>${t('areas.color')}</label><input name="color" type="color" value="#F5C518"><label>${t('areas.teamName')}</label><input name="teamName"><button class="btn primary" type="submit">${t('areas.create')}</button></form>` : ''}
    <div class="grid cards">${areas.map((area) => `<section class="cardx"><h2 style="color:${esc(area.color)}">${esc(area.name)}</h2><p class="muted">${t('areas.meta', { team: esc(area.teamName), people: t('owner.people', { n: area.members }), rooms: esc(area.rooms.map((room) => knownPhrase(room.name)).join(', ') || t('areas.noZone')) })}</p>
      <ul>${area.kpis.map((kpi) => `<li>${t('areas.kpiLine', { label: esc(kpi.label), key: esc(kpi.key), target: kpi.targetDaily ?? '—' })}</li>`).join('') || `<li>${t('areas.noKpis')}</li>`}</ul>
      ${own || session.membership.area?.id === area.id ? `<button class="btn" data-kpi="${area.id}" type="button">${t('areas.editKpis')}</button>` : ''}
    </section>`).join('')}</div>
    <h2>${t('areas.jobs')}</h2>
    <p>${titles.map((title) => esc(title.name)).join(' · ') || t('areas.noJobs')}</p>
    ${own ? `<form id="puesto" class="toolbar"><input name="name" placeholder="${t('areas.jobPh')}" required><button class="btn" type="submit">${t('areas.add')}</button></form>` : ''}
  `);
  root.querySelector('#area')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.target as HTMLFormElement).entries());
      await api('/api/areas', { method: 'POST', body: JSON.stringify(data) });
      location.reload();
    } catch (error) { noteError(null, error); }
  });
  root.querySelector('#puesto')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.target as HTMLFormElement).entries());
      await api('/api/puestos', { method: 'POST', body: JSON.stringify(data) });
      location.reload();
    } catch (error) { noteError(null, error); }
  });
  root.querySelectorAll<HTMLButtonElement>('[data-kpi]').forEach((button) => button.onclick = async () => {
    const raw = prompt(t('areas.kpiPrompt'));
    if (!raw) return;
    const kpis = raw.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const [key, label, target] = part.split('|');
      return { key: key.trim(), label: (label || key).trim(), unit: '', targetDaily: target ? Number(target) : null, higherIsBetter: true };
    });
    try {
      await api(`/api/areas/${button.dataset.kpi}/kpis`, { method: 'PUT', body: JSON.stringify({ kpis }) });
      location.reload();
    } catch (error) { noteError(null, error); }
  });
}

async function renderMapEditor(root: HTMLElement, session: Session) {
  const office = await api<OfficeLayout>('/api/oficina');
  root.innerHTML = shell('mapa', t('mapEdit.title'), t('mapEdit.subtitle'), `
    ${office.rooms.map((room) => `<form class="cardx room-form" data-room="${esc(room.mapRoomId)}">
      <b>${esc(knownPhrase(room.name))}</b>
      <div class="toolbar"><input name="name" value="${esc(room.name)}"><input name="label" value="${esc(room.label)}" placeholder="${t('mapEdit.labelPh')}">
      <select name="areaId"><option value="">${t('team.noArea')}</option>${office.areas.map((area) => `<option value="${area.id}" ${area.id === room.areaId ? 'selected' : ''}>${esc(area.name)}</option>`).join('')}</select>
      ${office.canEdit ? `<button class="btn" type="submit">${t('mapEdit.saveRoom')}</button>` : ''}</div></form>`).join('')}
    <h2>${t('mapEdit.desks')}</h2>
    ${office.desks.map((desk) => `<form class="toolbar desk-form" data-seat="${esc(desk.seatId)}"><span style="min-width:110px">${esc(desk.seatId)}</span>
      <select name="membershipId"><option value="">${t('mapEdit.free')}</option>${office.people.map((person) => `<option value="${person.id}" ${person.id === desk.membershipId ? 'selected' : ''}>${esc(person.name)}</option>`).join('')}</select>
      ${office.canEdit ? `<button class="btn" type="submit">${t('mapEdit.assign')}</button>` : ''}</form>`).join('')}
    ${session.membership.role === 'propietario' ? '' : `<p class="muted">${t('mapEdit.ownerOnly')}</p>`}
  `);
  root.querySelectorAll<HTMLFormElement>('.room-form').forEach((form) => form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      await api(`/api/oficina/salas/${form.dataset.room}`, { method: 'PUT', body: JSON.stringify({ name: data.name, label: data.label, areaId: data.areaId || null }) });
      form.insertAdjacentHTML('beforeend', `<span class="muted"> ${t('mapEdit.saved')}</span>`);
    } catch (error) { noteError(null, error); }
  });
  root.querySelectorAll<HTMLFormElement>('.desk-form').forEach((form) => form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      await api(`/api/oficina/puestos/${form.dataset.seat}`, { method: 'PUT', body: JSON.stringify({ membershipId: data.membershipId || null }) });
      form.insertAdjacentHTML('beforeend', `<span class="muted"> ${t('mapEdit.assigned')}</span>`);
    } catch (error) { noteError(null, error); }
  });
}

async function renderDay(root: HTMLElement, session: Session) {
  const today = new Date().toISOString().slice(0, 10);
  const [report, fichaje, areas] = await Promise.all([
    api<{ note: string; values: Record<string, number>; isDemo: boolean }>(`/api/informes/mio?date=${today}`),
    api<{ abierto: boolean; clockIn: string | null }>('/api/fichaje/hoy'),
    api<AreaFull[]>('/api/areas'),
  ]);
  const kpis = areas.find((area) => area.id === session.membership.area?.id)?.kpis || [];
  root.innerHTML = shell('jornada', t('day.title'), session.membership.area?.name || t('day.needArea'), `
    <div class="cardx"><b>${fichaje.abierto ? t('day.clocked', { time: formatClock(fichaje.clockIn || '') }) : t('day.notClocked')}</b>
      <div class="toolbar"><button class="btn primary" id="in" type="button">${t('day.in')}</button><button class="btn" id="out" type="button">${t('day.out')}</button></div></div>
    <form id="report" class="cardx form"><p class="muted">${report.isDemo ? t('day.demo') : t('day.manual')}</p>
      ${kpis.map((kpi) => `<label>${esc(kpi.label)}${kpi.unit ? ' (' + esc(kpi.unit) + ')' : ''}${kpi.targetDaily != null ? ' · ' + t('day.target', { n: kpi.targetDaily }) : ''}</label><input name="${esc(kpi.key)}" type="number" step="0.1" value="${report.values[kpi.key] ?? ''}">`).join('') || `<p>${t('day.noKpis')}</p>`}
      <label>${t('day.note')}</label><textarea name="note">${esc(report.note || '')}</textarea>
      <button class="btn primary" type="submit">${t('day.save')}</button></form>
  `);
  root.querySelector('#in')!.addEventListener('click', async () => {
    try { await api('/api/fichaje/entrada', { method: 'POST' }); location.reload(); } catch (error) { noteError(null, error); }
  });
  root.querySelector('#out')!.addEventListener('click', async () => {
    try { await api('/api/fichaje/salida', { method: 'POST' }); location.reload(); } catch (error) { noteError(null, error); }
  });
  root.querySelector('#report')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.target as HTMLFormElement).entries());
      const metrics: Record<string, number> = {};
      for (const kpi of kpis) if (data[kpi.key] !== '') metrics[kpi.key] = Number(data[kpi.key]);
      const saved = await api<{ pointsAwarded: number }>('/api/informes/mio', { method: 'PUT', body: JSON.stringify({ date: today, note: data.note || '', metrics }) });
      alert(saved.pointsAwarded ? t('day.points', { n: saved.pointsAwarded }) : t('day.updated'));
    } catch (error) { noteError(null, error); }
  });
}

let chatDmHandler: ((message: DirectLine) => void) | null = null;

function chatPanelVisible(root: HTMLElement) {
  return root.isConnected && !root.hidden && !root.classList.contains('hidden') && location.hash.startsWith('#/chat');
}

async function renderChat(root: HTMLElement, session: Session, socket: Socket | null) {
  const initial = new URLSearchParams((location.hash.split('?')[1] || '')).get('con') || '';
  if (chatDmHandler) socket?.off('dm:message', chatDmHandler);
  chatDmHandler = null;
  watchDirect(null);
  let missed = false;
  const stopArrival = onDirectArrival(() => { missed = true; });
  const [areas, directory] = await Promise.all([
    api<{ id: string; name: string }[]>('/api/areas'),
    api<{ personas: DirectPerson[] }>('/api/directos'),
  ]);
  seedDirectUnread(directory.personas);
  if (missed) {
    const again = await api<{ personas: DirectPerson[] }>('/api/directos');
    directory.personas = again.personas;
    seedDirectUnread(again.personas);
  }
  stopArrival();
  if (!root.isConnected) return;
  const channels = [{ id: '', name: t('chat.general') }, ...areas.filter((area) => session.membership.role === 'propietario' || area.id === session.membership.area?.id)];
  root.innerHTML = shell('chat', t('chat.title'), t('chat.subtitle'), `
    <div class="toolbar">
      <button class="btn" id="tab-canales" type="button">${t('chat.channels')}</button>
      <button class="btn primary" id="tab-directos" type="button">${t('chat.directs')} <span id="dm-badge" class="count-badge" hidden></span></button>
    </div>
    <div class="chat-layout">
      <aside class="cardx" id="chat-side">
        <div id="channel-box"><label>${t('chat.channel')}</label><select id="channel">${channels.map((channel) => `<option value="${channel.id}">${esc(channel.name)}</option>`).join('')}</select></div>
        <div id="peer-box"></div>
      </aside>
      <section>
        <h2 id="chat-title" style="margin-top:0">${t('chat.general')}</h2>
        <div id="log" class="chat-log cardx"></div>
        <form id="send" class="toolbar"><input name="body" placeholder="${t('chat.placeholder')}" required maxlength="1000"><button class="btn primary" type="submit">${t('chat.send')}</button></form>
        <p id="chat-out" class="muted"></p>
      </section>
    </div>
  `);
  const log = root.querySelector('#log') as HTMLElement;
  const channel = root.querySelector('#channel') as HTMLSelectElement;
  const channelBox = root.querySelector('#channel-box') as HTMLElement;
  const peerBox = root.querySelector('#peer-box') as HTMLElement;
  const title = root.querySelector('#chat-title') as HTMLElement;
  const badge = root.querySelector('#dm-badge') as HTMLElement;
  const out = root.querySelector('#chat-out') as HTMLElement;
  const seen = new Set<string>();
  let mode: 'canales' | 'directos' = initial ? 'directos' : 'canales';
  let selected = initial;
  const personas = directory.personas;

  const paintChannel = (rows: { id?: string; author: string; body: string; createdAt: string }[]) => {
    log.innerHTML = rows.map((row) => `<div class="bubble"><b>${esc(row.author)}</b> <span class="muted">${esc(formatClock(row.createdAt))}</span><div>${esc(row.body)}</div></div>`).join('') || `<p class="muted">${t('chat.emptyChannel')}</p>`;
    log.scrollTop = log.scrollHeight;
  };
  const paintThread = (rows: DirectLine[]) => {
    for (const row of rows) seen.add(row.id);
    log.innerHTML = rows.map((row) => `<div class="bubble ${row.senderId === session.membership.id ? 'mine' : ''}"><b>${esc(row.senderName)}</b> <span class="muted">${esc(formatClock(row.createdAt))}</span><div>${esc(row.body)}</div></div>`).join('') || `<p class="muted">${t('chat.emptyThread')}</p>`;
    log.scrollTop = log.scrollHeight;
  };
  const paintPeers = () => {
    const total = directUnreadTotal();
    badge.hidden = total === 0;
    badge.textContent = total ? String(total) : '';
    peerBox.innerHTML = personas.map((person) => {
      const unread = directUnreadOf(person.id);
      return `<button class="peer-row ${person.id === selected && mode === 'directos' ? 'on' : ''}" data-peer="${esc(person.id)}" type="button">
      <span><b>${esc(person.name)}</b><span class="muted">${esc(person.puesto || t('chat.coworker'))}${person.ultimo ? ' · ' + esc(person.ultimo.body) : ''}</span></span>
      ${unread ? `<span class="count-badge">${unread}</span>` : ''}
    </button>`;
    }).join('') || `<p class="muted">${t('chat.noPeople')}</p>`;
    peerBox.querySelectorAll<HTMLButtonElement>('[data-peer]').forEach((button) => {
      button.onclick = () => {
        selected = button.dataset.peer || '';
        mode = 'directos';
        history.replaceState(null, '', `#/chat?con=${encodeURIComponent(selected)}`);
        void show();
      };
    });
  };
  const show = async () => {
    const opened = selected;
    const viewingPeer = mode === 'directos' && !!opened && chatPanelVisible(root);
    if (viewingPeer) {
      watchDirect(opened);
      clearDirect(opened);
    } else {
      watchDirect(null);
    }
    channelBox.hidden = mode !== 'canales';
    peerBox.hidden = mode !== 'directos';
    (root.querySelector('#tab-canales') as HTMLButtonElement).className = mode === 'canales' ? 'btn primary' : 'btn';
    (root.querySelector('#tab-directos') as HTMLButtonElement).className = mode === 'directos' ? 'btn primary' : 'btn';
    paintPeers();
    out.className = 'muted';
    out.textContent = '';
    if (mode === 'canales') {
      title.textContent = channel.selectedOptions[0]?.textContent || t('chat.general');
      try {
        const channelPage = await api<{ id?: string; author: string; body: string; createdAt: string }[] | { items: { id?: string; author: string; body: string; createdAt: string }[] }>(`/api/chat?areaId=${encodeURIComponent(channel.value)}&take=80`);
        paintChannel(Array.isArray(channelPage) ? channelPage : channelPage.items);
      } catch (error) { noteError(out, error); }
      return;
    }
    const person = personas.find((item) => item.id === opened);
    title.textContent = person ? t('chat.with', { name: person.name }) : t('chat.directs');
    if (!opened) {
      log.innerHTML = `<p class="muted">${t('chat.pick')}</p>`;
      return;
    }
    try {
      const thread = await api<{ con: { name: string }; mensajes: DirectLine[] }>(`/api/directos/${encodeURIComponent(opened)}`);
      if (!chatPanelVisible(root) || mode !== 'directos' || selected !== opened) {
        watchDirect(null);
        return;
      }
      title.textContent = t('chat.with', { name: thread.con.name });
      clearDirect(opened);
      paintPeers();
      paintThread(thread.mensajes);
    } catch (error) {
      watchDirect(null);
      log.innerHTML = '';
      noteError(out, error);
      try {
        const again = await api<{ personas: DirectPerson[] }>('/api/directos');
        seedDirectUnread(again.personas);
        paintPeers();
      } catch { /* el aviso de arriba ya explica el fallo */ }
    }
  };
  root.querySelector('#tab-canales')!.addEventListener('click', () => { mode = 'canales'; history.replaceState(null, '', '#/chat'); void show(); });
  root.querySelector('#tab-directos')!.addEventListener('click', () => { mode = 'directos'; void show(); });
  channel.onchange = () => void show();
  socket?.off('chat:message');
  socket?.off('dm:error');
  socket?.on('chat:message', () => { if (chatPanelVisible(root) && mode === 'canales') void show(); });
  chatDmHandler = (message: DirectLine) => {
    if (!chatPanelVisible(root)) return;
    const mine = message.senderId === session.membership.id;
    const peerId = mine ? message.recipientId : message.senderId;
    const person = personas.find((item) => item.id === peerId);
    if (person) person.ultimo = { body: message.body, createdAt: message.createdAt, mio: mine };
    const open = mode === 'directos' && selected === peerId && directConversationOpen(peerId);
    if (open && !seen.has(message.id)) {
      seen.add(message.id);
      if (!log.querySelector('.bubble')) log.innerHTML = '';
      log.insertAdjacentHTML('beforeend', `<div class="bubble ${mine ? 'mine' : ''}"><b>${esc(message.senderName)}</b> <span class="muted">${esc(formatClock(message.createdAt))}</span><div>${esc(message.body)}</div></div>`);
      log.scrollTop = log.scrollHeight;
      if (!mine) void api(`/api/directos/${encodeURIComponent(peerId)}`).catch(() => {});
    }
    paintPeers();
  };
  socket?.on('dm:message', chatDmHandler);
  socket?.on('dm:error', (payload: { error?: string }) => { if (root.isConnected) noteError(out, new Error(payload?.error || t('chat.sendFail'))); });
  root.querySelector('#send')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const body = String(new FormData(form).get('body') || '');
    try {
      if (mode === 'canales') {
        if (!socket?.connected) throw new Error(t('chat.offline'));
        socket.emit('chat:send', { body, areaId: channel.value || null });
        form.reset();
        setTimeout(() => { if (mode === 'canales') void show(); }, 250);
        return;
      }
      if (!selected) throw new Error(t('chat.pickPeer'));
      const sent = await api<DirectLine>(`/api/directos/${encodeURIComponent(selected)}`, { method: 'POST', body: JSON.stringify({ body }) });
      form.reset();
      const person = personas.find((item) => item.id === selected);
      if (person) person.ultimo = { body: sent.body, createdAt: sent.createdAt, mio: true };
      if (!seen.has(sent.id)) {
        seen.add(sent.id);
        if (!log.querySelector('.bubble')) log.innerHTML = '';
        log.insertAdjacentHTML('beforeend', `<div class="bubble mine"><b>${esc(sent.senderName)}</b> <span class="muted">${esc(formatClock(sent.createdAt))}</span><div>${esc(sent.body)}</div></div>`);
        log.scrollTop = log.scrollHeight;
      }
      paintPeers();
    } catch (error) { noteError(out, error); }
  });
  await show();
}

async function renderBadges(root: HTMLElement) {
  const data = await api<{ ranking: { name: string; points: number; puesto: string; photoUrl: string | null }[]; badges: { label: string; name: string }[] }>('/api/gamificacion');
  root.innerHTML = shell('logros', t('badges.title'), t('badges.subtitle'), `
    <div class="grid cards">${data.ranking.map((person, index) => `<article class="cardx person">${avatar(person.photoUrl, person.name)}<div><b>${index + 1}. ${esc(person.name)}</b><div class="muted">${esc(person.puesto)} · ${t('badges.pts', { n: person.points })}</div></div></article>`).join('')}</div>
    <h2>${t('badges.heading')}</h2>
    <p>${data.badges.map((badge) => `${esc(badge.name)}: ${esc(badge.label)}`).join(' · ') || t('badges.none')}</p>
  `);
}

async function renderPlan(root: HTMLElement, session: Session) {
  const plan = await api<PlanView>('/api/plan');
  const pct = (used: number, max: number) => Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  root.innerHTML = shell('plan', t('plan.title'), plan.pago.mensaje, `
    <div class="cardx"><h2 style="margin-top:0">${esc(plan.actual.name)} · ${esc(plan.actual.status)}</h2>
      <p>${esc(plan.actual.description)}</p>
      <p>${t('plan.people', { used: plan.uso.personas, max: plan.uso.maxPersonas })}${plan.actual.limite ? ` · ${t('plan.limit', { n: plan.actual.limite })}` : ''}</p><div class="usage"><span style="width:${pct(plan.uso.personas, plan.uso.maxPersonas)}%"></span></div>
      <p>${t('plan.areas', { used: plan.uso.areas, max: plan.uso.maxAreas })}</p><div class="usage"><span style="width:${pct(plan.uso.areas, plan.uso.maxAreas)}%"></span></div>
    </div>
    <div class="grid cards">${plan.planes.map((item) => `<article class="cardx"><h2>${esc(item.name)}</h2><p class="muted">${t('plan.upTo', { people: item.maxWorkers, areas: item.maxAreas })}</p><p>${esc(item.description)}</p>
      ${item.code === 'grupo' && session.membership.role === 'propietario' ? `<label>${t('plan.companyLimit')}</label><input id="limite-grupo" type="number" min="101" max="5000" placeholder="1000" value="${plan.actual.limite || ''}">` : ''}
      ${session.membership.role === 'propietario' ? `<button class="btn" data-plan="${item.code}" type="button">${item.code === plan.actual.code ? t('plan.current') : t('plan.use')}</button>` : ''}</article>`).join('')}</div>
  `);
  root.querySelectorAll<HTMLButtonElement>('[data-plan]').forEach((button) => button.onclick = async () => {
    if (button.dataset.plan === plan.actual.code && button.dataset.plan !== 'grupo') return;
    try {
      const limiteRaw = (root.querySelector('#limite-grupo') as HTMLInputElement | null)?.value || '';
      const limite = button.dataset.plan === 'grupo' && limiteRaw ? Number(limiteRaw) : undefined;
      await api('/api/plan', { method: 'POST', body: JSON.stringify({ code: button.dataset.plan, ...(limite ? { limite } : {}) }) });
      location.reload();
    } catch (error) { noteError(null, error); }
  });
}

async function renderLeads(root: HTMLElement, session: Session) {
  const data = await api<LeadView>('/api/captacion');
  root.innerHTML = shell('captacion', t('leads.title'), t('leads.soon'), `
    <div class="cardx"><h2 style="margin-top:0">${t('leads.soon')}</h2>
      <p>${esc(data.mensaje)}</p>
      <p class="muted">${t('leads.counts', data.contadores)}</p>
      <ul>${data.extensiones.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      ${data.area ? `<p>${t('leads.prepared', { name: esc(data.area.name) })}</p>` : ''}
      ${session.membership.role === 'propietario' && !data.activo ? `<button class="btn primary" id="enable" type="button">${t('leads.enable')}</button>` : ''}
    </div>
  `);
  root.querySelector('#enable')?.addEventListener('click', async () => {
    try {
      await api('/api/captacion/activar', { method: 'POST' });
      location.reload();
    } catch (error) { noteError(null, error); }
  });
}

function hex(value: string | undefined, fallback: string) {
  return value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : fallback;
}

function applyLocalLook(session: Session, id: string, patch: Partial<Session['membership']['look']>) {
  if (session.membership.id === id) Object.assign(session.membership.look, patch);
  const live = (window as unknown as { __game?: { player: { id: string; look: Record<string, unknown> } } }).__game;
  if (live?.player.id === id) Object.assign(live.player.look, patch);
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function taskState(status: string) {
  if (status === 'pendiente') return t('tasks.pending');
  if (status === 'en_curso') return t('tasks.doing');
  if (status === 'hecho') return t('tasks.done');
  return status;
}

function noteError(node: Element | null, error: unknown) {
  const message = error instanceof Error ? error.message : t('auth.actionFailed');
  if (!node) { window.alert(message); return; }
  const host = node as HTMLElement;
  host.hidden = false;
  host.className = 'err';
  host.textContent = message;
}

function avatar(photo: string | null | undefined, name: string) {
  if (photo) return `<img src="${esc(photo)}" alt="">`;
  const letters = name.split(' ').slice(0, 2).map((part) => part[0]).join('');
  return `<div class="avatar-ph">${esc(letters)}</div>`;
}

function statusLabel(status: string) {
  return statusText(status);
}
function statusColor(status: string) {
  return ({ en_linea: '#22C55E', ausente: '#EAB308', en_reunion: '#A78BFA', cafe: '#F59E0B', en_llamada: '#60A5FA', desconectado: '#6B7280' } as Record<string, string>)[status] || '#F5C518';
}

interface OwnerPerson { id: string; name: string; photoUrl: string | null; puesto: string; areaId: string | null; areaName: string; status: string; online: boolean; taskTitle: string; taskSeconds: number }
interface OwnerSnap { people: OwnerPerson[]; areas: { id: string; name: string; color: string; mapRoomId: string | null; roomName: string; headcount: number; online: number; people: { id: string; name: string; taskTitle: string }[]; kpis: { label: string; unit: string; total: number; target: number | null }[] }[]; tasks: { id: string; title: string; status: string; area: string; assignee: string | null }[] }
interface PanelKpi { label: string; unit: string; total: number; pct: number | null; byDate?: Record<string, number>; ranking?: { name: string; value: number }[] }
interface Panel { isDemo: boolean; alerts: { level: string; text: string }[]; areas: { name: string; color: string; kpis: PanelKpi[] }[]; employees: { name: string; score: number }[] }
interface Person { id: string; name: string; photoUrl: string | null; puesto: string | null; roleLabel: string; area: { name: string } | null }
interface EmployeeDetail extends Person { status: string; score?: number; points?: number; schedule?: string; phone?: string; activeHours?: number; look?: { usePhoto?: boolean; skin?: string; hair?: string; hairStyle?: number; shirt?: string; pants?: string; glasses?: boolean }; history?: { date: string; note: string; isDemo: boolean; values: Record<string, number> }[]; badges?: { label: string }[] }
interface DirectPerson { id: string; name: string; puesto: string; unread: number; ultimo: { body: string; createdAt: string; mio: boolean } | null }
interface DirectLine { id: string; body: string; createdAt: string; senderId: string; recipientId: string; senderName: string }
interface AreaFull { id: string; name: string; color: string; teamName: string; members: number; rooms: { name: string }[]; kpis: { key: string; label: string; unit?: string; targetDaily: number | null }[] }
interface OfficeLayout { canEdit: boolean; rooms: { mapRoomId: string; name: string; label: string; areaId: string | null }[]; desks: { seatId: string; membershipId: string | null }[]; areas: { id: string; name: string }[]; people: { id: string; name: string }[] }
interface PlanView { uso: { personas: number; areas: number; maxPersonas: number; maxAreas: number }; actual: { code: string; name: string; status: string; description: string; limite?: number | null }; planes: { code: string; name: string; maxWorkers: number; maxAreas: number; description: string }[]; pago: { mensaje: string } }
interface LeadView { mensaje: string; activo: boolean; area: { name: string } | null; contadores: { leads: number; campaigns: number; calls: number }; extensiones: string[] }
