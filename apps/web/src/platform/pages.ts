import type { Socket } from 'socket.io-client';
import { ZONE_LAYOUT } from '../data/zones';
import { api, clock, esc, getToken, money, num } from './api';
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
}

const NAV = [
  ['oficina', 'Oficina'], ['dueno', 'Dueño'], ['negocio', 'Mi negocio'], ['equipo', 'Equipo'],
  ['areas', 'Áreas'], ['mapa', 'Mapa'], ['tareas', 'Tareas'], ['jornada', 'Jornada'],
  ['chat', 'Chat'], ['logros', 'Logros'], ['plan', 'Plan'], ['captacion', 'Captación'],
] as const;

export function shell(view: string, title: string, subtitle: string, body: string) {
  const nav = NAV.map(([id, label]) => `<a class="${view === id ? 'on' : ''}" href="#/${id}">${label}</a>`).join('');
  return `<div class="page"><nav class="pn">${nav}</nav><header class="ph"><div><h1>${title}</h1><p>${subtitle}</p></div></header>${body}</div>`;
}

export function renderAuth(root: HTMLElement, onDone: () => void) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const mode = location.hash.startsWith('#/registro') ? 'registro' : location.hash.startsWith('#/unirse') ? 'unirse' : location.hash.startsWith('#/codigo') ? 'codigo' : 'entrar';
  const title = mode === 'registro' ? 'Crea tu empresa' : mode === 'unirse' ? 'Únete al equipo' : mode === 'codigo' ? 'Entrar con código' : 'Entra en tu oficina';
  root.innerHTML = `<form class="auth-card">
    <img class="logo" src="${logoUrl}" alt="HIVEX">
    <h1>${title}</h1>
    <p class="lead">${mode === 'codigo' ? 'Escribe el código de la empresa, tu nombre y una contraseña. Entrarás en la oficina como empleado.' : 'HIVEX es el sistema operativo de capital humano: cada empresa configura sus áreas y ves, en el momento, qué está haciendo cada persona.'}</p>
    <div class="err" hidden role="alert"></div>
    ${mode === 'codigo' ? '<label>Código</label><input name="code" required value="' + esc(params.get('c') || '') + '" autocomplete="off">' : ''}
    ${mode === 'unirse' ? '<label>Código de invitación</label><input name="code" required value="' + esc(params.get('code') || '') + '">' : ''}
    ${mode === 'entrar' || mode === 'registro' || mode === 'codigo' ? '<label>Correo</label><input name="email" type="email" required autocomplete="username">' : ''}
    ${mode !== 'entrar' ? '<label>Tu nombre</label><input name="name" required>' : ''}
    ${mode === 'registro' ? '<label>Nombre de la empresa</label><input name="companyName" required>' : ''}
    <label>Contraseña</label><input name="password" type="password" required minlength="${mode === 'entrar' ? '1' : '8'}" autocomplete="${mode === 'entrar' ? 'current-password' : 'new-password'}">
    ${mode === 'entrar' ? '<a class="btn block" href="#/codigo">Entrar con código</a>' : ''}
    <button class="btn primary" type="submit">${mode === 'entrar' ? 'Entrar' : 'Continuar'}</button>
    <div class="auth-links">
      <a href="#/entrar">Ya tengo cuenta</a>
      <a href="#/codigo">Entrar con código</a>
      <a href="#/registro">Crear empresa</a>
    </div>
    <div class="demo-box">Prueba la demo: <b>martin@hivex.demo</b> / <b>hivex-demo</b>. También puedes entrar como Hugo, Martín, Luis, Naomi o Maite con el mismo dominio de correo de la demo y la misma contraseña.${mode === 'entrar' ? '<br>Si te invitaron, entra con el correo de la invitación y la contraseña que elegiste al unirte.' : ''}</div>
  </form>`;
  const form = root.querySelector('form')!;
  const err = root.querySelector('.err') as HTMLElement;
  form.onsubmit = async (event) => {
    event.preventDefault();
    err.hidden = true;
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const path = mode === 'registro' ? '/api/auth/registro' : mode === 'unirse' ? `/api/invitaciones/${data.code}/aceptar` : mode === 'codigo' ? '/api/acceso-codigo' : '/api/auth/entrar';
      const result = await api<{ token: string }>(path, { method: 'POST', body: JSON.stringify(data) });
      localStorage.setItem('hivex_token', result.token);
      location.hash = mode === 'unirse' || mode === 'codigo' ? '#/oficina' : '#/dueno';
      onDone();
    } catch (error) {
      err.hidden = false;
      const message = error instanceof Error ? error.message : '';
      err.textContent = message || (mode === 'unirse' ? 'La invitación no es válida o ha caducado' : 'No se pudo completar la acción');
    }
  };
  if (mode === 'unirse' && params.get('code')) {
    void api<{ email: string; empresa: string }>(`/api/invitaciones/${encodeURIComponent(params.get('code') || '')}`).catch((error) => {
      err.hidden = false;
      err.textContent = error instanceof Error && error.message ? error.message : 'La invitación no es válida o ha caducado';
    });
  }
}

export async function renderView(root: HTMLElement, view: string, session: Session, socket: Socket | null) {
  const [section, id = ''] = view.split('/');
  try {
    if (section === 'menu') root.innerHTML = shell('menu', 'Gestión', session.membership.company.name, `<div class="grid cards">${NAV.map(([key, label]) => `<a class="cardx" href="#/${key}"><strong>${label}</strong></a>`).join('')}</div>`);
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
    else root.innerHTML = shell('oficina', 'Oficina', '', '');
  } catch (error) {
    root.innerHTML = shell(view, 'No se pudo cargar', '', `<div class="err">${esc(error instanceof Error ? error.message : 'Error')}</div>`);
  }
}

async function renderOwner(root: HTMLElement, session: Session, socket: Socket | null) {
  const canOwn = session.membership.role === 'propietario';
  root.innerHTML = shell('dueno', 'Panel del dueño', 'Qué está haciendo cada persona, en este momento.', `
    <div class="toolbar">
      <input id="q" placeholder="Buscar persona o tarea">
      <select id="area"><option value="">Todas las áreas</option></select>
      <select id="status"><option value="">Todos los estados</option><option value="en_linea">En línea</option><option value="en_reunion">En reunión</option><option value="en_llamada">En llamada</option><option value="ausente">Ausente</option><option value="cafe">Café</option><option value="desconectado">Desconectado</option></select>
      <button class="btn" id="mode" type="button">Ocultar plano</button>
      ${canOwn ? '<button class="btn primary" id="new-area" type="button" style="width:auto">Nueva área</button>' : ''}
    </div>
    <h2>Personas ahora</h2>
    <div id="live" class="grid cards"></div>
    <div id="floor-wrap" class="cardx"><h2 style="margin:0 0 8px">Mapa de áreas</h2><p class="muted">Cada zona es un área activa. Pulsa una para ver quién está y los indicadores de hoy.</p><div class="floor" id="floor"></div></div>
    <h2>Áreas</h2>
    <div id="areas" class="grid cards"></div>
    <div id="detail"></div>
    <h2>Tareas en marcha</h2>
    <div id="tasks" class="grid cards"></div>
    <h2>Auditoría</h2>
    <div id="audit" class="cardx muted">Cargando…</div>
  `);
  const live = root.querySelector('#live') as HTMLElement;
  const floorWrap = root.querySelector('#floor-wrap') as HTMLElement;
  const floor = root.querySelector('#floor') as HTMLElement;
  let showFloor = true;
  let snap: OwnerSnap | null = null;
  const draw = () => {
    if (!snap) return;
    const q = (root.querySelector('#q') as HTMLInputElement).value.toLowerCase();
    const area = (root.querySelector('#area') as HTMLSelectElement).value;
    const status = (root.querySelector('#status') as HTMLSelectElement).value;
    const areaSel = root.querySelector('#area') as HTMLSelectElement;
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
          <div class="muted">${person.puesto ? esc(person.puesto) : 'Sin puesto'}</div></div>
        </div>
        <p style="margin:10px 0 6px"><b>${esc(person.taskTitle || 'Sin tarea activa')}</b></p>
        <div class="tag"><span class="dot" style="background:${statusColor(person.status)}"></span>${esc(statusLabel(person.status))}${person.online ? '' : ''}</div>
        <div class="muted" style="margin-top:6px">${person.taskTitle ? 'Lleva ' + clock(person.taskSeconds) + ' en esta tarea' : 'Sin tiempo de tarea'}</div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <a class="btn" href="#/equipo/${person.id}">Rendimiento</a>
          ${canOwn ? `<button class="btn ghost" data-move="${person.id}" type="button">Mover</button>` : ''}
        </div>
      </article>`).join('') || '<p class="muted">Nadie coincide con el filtro.</p>';
    floor.innerHTML = snap.areas.map((areaItem) => {
      const box = ZONE_LAYOUT.find((item) => item.id === areaItem.mapRoomId) || { x: 8, y: 8, w: 20, h: 16 };
      return `<button class="zone" data-area="${areaItem.id}" style="left:${box.x}%;top:${box.y}%;width:${box.w}%;height:${box.h}%;border-color:${esc(areaItem.color)}">
        <strong>${esc(areaItem.name)}</strong>
        <span class="mini">${areaItem.online} en línea · ${areaItem.headcount} personas</span>
      </button>`;
    }).join('');
    const areasHost = root.querySelector('#areas') as HTMLElement;
    areasHost.innerHTML = snap.areas.map((areaItem) => `
      <button class="cardx" data-area-card="${areaItem.id}" type="button" style="text-align:left;color:inherit">
        <strong style="color:${esc(areaItem.color)}">${esc(areaItem.name)}</strong>
        <div class="muted">${areaItem.headcount} personas · ${areaItem.online} en línea · ${esc(areaItem.roomName)}</div>
        <div class="muted">${areaItem.people.map((person) => esc(person.name)).slice(0, 4).join(' · ') || 'Nadie asignado'}</div>
      </button>`).join('');
    areasHost.querySelectorAll<HTMLButtonElement>('[data-area-card]').forEach((button) => {
      button.onclick = () => openArea(button.dataset.areaCard!, snap!);
    });
    const taskHost = root.querySelector('#tasks') as HTMLElement;
    taskHost.innerHTML = snap.tasks.map((task) => `
      <article class="cardx" draggable="true" data-task="${task.id}">
        <b>${esc(task.title)}</b>
        <div class="muted">${esc(task.area)} · ${esc(task.assignee || 'Sin asignar')} · ${esc(task.status)}</div>
        <button class="btn" data-re="${task.id}" type="button">Reasignar</button>
      </article>`).join('') || '<p class="muted">No hay tareas abiertas.</p>';
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
    (root.querySelector('#audit') as HTMLElement).innerHTML = audit.slice(0, 8).map((row) => `<div><b>${esc(row.summary)}</b><div class="muted">${esc(new Date(row.createdAt).toLocaleString('es'))}</div></div>`).join('') || 'Todavía no hay movimientos.';
  };
  root.querySelector('#mode')!.addEventListener('click', () => {
    showFloor = !showFloor;
    floorWrap.hidden = !showFloor;
    (root.querySelector('#mode') as HTMLButtonElement).textContent = showFloor ? 'Ocultar plano' : 'Ver plano';
  });
  root.querySelector('#new-area')?.addEventListener('click', async () => {
    const name = prompt('Nombre de la nueva área');
    if (!name) return;
    try {
      await api('/api/areas', { method: 'POST', body: JSON.stringify({ name, color: '#F5C518', teamName: name }) });
      await load();
    } catch (error) { noteError(null, error); }
  });
  ['#q', '#area', '#status'].forEach((sel) => root.querySelector(sel)!.addEventListener('input', draw));
  socket?.off('panel:state');
  socket?.on('panel:state', (state: OwnerSnap) => { snap = state; draw(); });
  socket?.emit('panel:sync');
  await load();
}

async function openArea(id: string, snap: OwnerSnap) {
  const area = snap.areas.find((item) => item.id === id);
  if (!area) return;
  const host = document.querySelector('#detail') as HTMLElement;
  host.innerHTML = `<section class="cardx"><h2 style="margin:0 0 8px;color:${esc(area.color)}">${esc(area.name)}</h2>
    <p class="muted">${esc(area.roomName)} · ${area.headcount} personas · ${area.online} conectadas ahora</p>
    <div class="bars">${area.kpis.map((kpi) => `<div class="barline"><span>${esc(kpi.label)}</span><div class="track"><i style="width:${Math.min(100, kpi.target ? (kpi.total / kpi.target) * 100 : 40)}%"></i></div><b>${num(kpi.total)}${esc(kpi.unit ? ' ' + kpi.unit : '')}</b></div>`).join('') || '<span class="muted">Sin indicadores hoy</span>'}</div>
    <p>${area.people.map((person) => esc(person.name) + (person.taskTitle ? ' · ' + esc(person.taskTitle) : '')).join('<br>')}</p>
    <a class="btn" href="#/negocio">Ver rendimiento del área</a></section>`;
  host.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function reassign(taskId: string, snap: OwnerSnap) {
  const options = snap.people.map((person, index) => `${index + 1}. ${person.name}`).join('\n');
  const pick = prompt(`¿A quién se la asigno?\n${options}`);
  const index = Number(pick) - 1;
  if (!snap.people[index]) return;
  try {
    await api(`/api/dueno/tareas/${taskId}/reasignar`, { method: 'POST', body: JSON.stringify({ assigneeId: snap.people[index].id }) });
  } catch (error) { noteError(null, error); }
}

async function movePerson(id: string, snap: OwnerSnap) {
  const options = snap.areas.map((area, index) => `${index + 1}. ${area.name}`).join('\n');
  const pick = prompt(`¿A qué área muevo a esta persona?\n${options}`);
  const index = Number(pick) - 1;
  if (!snap.areas[index]) return;
  try {
    await api(`/api/dueno/personas/${id}/area`, { method: 'POST', body: JSON.stringify({ areaId: snap.areas[index].id }) });
  } catch (error) { noteError(null, error); }
}

async function renderBusiness(root: HTMLElement) {
  const panel = await api<Panel>('/api/panel');
  root.innerHTML = shell('negocio', 'Panel de mi negocio', panel.isDemo ? 'Los números de esta empresa son de demostración.' : 'Rendimiento por área y por persona.', `
    ${panel.alerts.map((alert) => `<div class="alert ${esc(alert.level)}">${esc(alert.text)}</div>`).join('') || '<div class="cardx">Sin alertas en este periodo.</div>'}
    <p><button class="btn" id="export" type="button">Exportar CSV</button></p>
    <div class="grid cards">${panel.areas.map((area) => `<section class="cardx"><h2 style="margin:0;color:${esc(area.color)}">${esc(area.name)}</h2>
      ${area.kpis.slice(0, 4).map((kpi) => `<div class="barline" style="margin-top:8px"><span>${esc(kpi.label)}</span><div class="track"><i style="width:${Math.min(100, kpi.pct ?? 0)}%"></i></div><b>${kpi.unit === '€' ? money(kpi.total) : num(kpi.total)}</b></div>`).join('')}
      <div style="margin-top:8px">${(area.kpis[0]?.ranking || []).slice(0, 3).map((row, i) => `<div>${i + 1}. ${esc(row.name)} · ${num(row.value)}</div>`).join('')}</div>
    </section>`).join('')}</div>
    <h2>Quién hace qué</h2>
    <div class="cardx bars">${panel.employees.map((person) => `<div class="barline"><span>${esc(person.name)}</span><div class="track"><i style="width:${person.score}%"></i></div><b>${person.score}</b></div>`).join('')}</div>
    <h2>El ritmo, día a día</h2>
    ${spark(panel.areas[0]?.kpis[0])}
  `);
  root.querySelector('#export')?.addEventListener('click', () => void downloadFile('/api/panel/export.csv', 'panel-hivex.csv').catch((error) => noteError(null, error)));
}

async function downloadFile(path: string, filename: string) {
  const token = getToken();
  const response = await fetch(path, { headers: token ? { 'X-HIVEX-Token': token } : {} });
  if (!response.ok) throw new Error('No se pudo descargar el archivo');
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
  if (!entries.length) return '<p class="muted">Todavía no hay serie diaria.</p>';
  const max = Math.max(...entries.map(([, value]) => value), 1);
  const step = 320 / Math.max(1, entries.length - 1);
  const points = entries.map(([, value], index) => `${index * step},${140 - (value / max) * 120}`).join(' ');
  return `<svg class="chart" viewBox="0 0 320 160"><polyline fill="none" stroke="#F5C518" stroke-width="3" points="${points}"/></svg><p class="muted">${esc(kpi.label)}</p>`;
}

async function renderTeam(root: HTMLElement, session: Session) {
  const people = await api<Person[]>('/api/empleados');
  const can = session.membership.role !== 'empleado';
  root.innerHTML = shell('equipo', 'Equipo', 'Fotos, puestos y áreas. En la oficina el personaje de juego sale por defecto.', `
    ${can ? `<form id="import" class="cardx"><b>Importar CSV o Excel</b><p class="muted">Columnas: nombre, email, puesto, area, telefono, fecha_inicio, horario. <button class="btn" id="plantilla" type="button">Descargar plantilla</button></p><input name="file" type="file" accept=".csv,.xlsx" required><button class="btn primary" type="submit">Importar</button><div id="import-out" class="muted"></div></form>` : ''}
    ${can ? await joinCodeBox() : ''}
    <div class="grid cards">${people.map((person) => `<a class="cardx person" href="#/equipo/${person.id}">${avatar(person.photoUrl, person.name)}<div><div class="nm">${esc(person.name)}</div><div class="muted">${esc(person.area?.name || 'Sin área')} · ${esc(person.puesto || person.roleLabel)}</div></div></a>`).join('')}</div>
    ${can ? await inviteBox() : ''}
  `);
  root.querySelector('#import')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const out = root.querySelector('#import-out') as HTMLElement;
    try {
      const file = (root.querySelector('input[type=file]') as HTMLInputElement).files?.[0];
      if (!file) return;
      const body = new FormData();
      body.append('file', file);
      const result = await api<{ creados: { email: string; password: string }[]; errores: string[] }>('/api/empleados/importar', { method: 'POST', body });
      out.className = 'muted';
      out.textContent = `Creados: ${result.creados.map((row) => `${row.email} (${row.password})`).join(', ') || 'ninguno'}. ${result.errores.join(' ')}`;
    } catch (error) { noteError(out, error); }
  });
  root.querySelector('#plantilla')?.addEventListener('click', () => void downloadFile('/api/empleados/plantilla.csv', 'plantilla-equipo.csv').catch((error) => noteError(root.querySelector('#import-out'), error)));
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
      out.innerHTML = `<p>No se ha enviado ningún correo. Comparte este enlace:</p>
        <input id="invite-link" readonly value="${esc(url)}">
        <button class="btn" id="copy-invite" type="button">Copiar enlace</button>
        <span id="copy-state"></span>`;
      out.querySelector('#copy-invite')?.addEventListener('click', async () => {
        await copyText(url);
        const state = out.querySelector('#copy-state');
        if (state) state.textContent = ' Enlace copiado.';
      });
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
    if (codeInput) codeInput.value = access.code || 'Sin código';
    if (linkInput) linkInput.value = url;
    if (enabled) enabled.checked = access.enabled;
  };
  root.querySelector('#copy-join')?.addEventListener('click', async () => {
    const url = linkInput?.value || '';
    if (!url) return;
    await copyText(url);
    if (out) { out.className = 'muted'; out.textContent = 'Enlace copiado.'; }
  });
  root.querySelector('#regen-join')?.addEventListener('click', async () => {
    try {
      const access = await api<{ code: string | null; enabled: boolean; enlace: string }>('/api/empresa/codigo-acceso/regenerar', { method: 'POST' });
      paint(access);
      if (out) { out.className = 'muted'; out.textContent = 'Código nuevo. El anterior deja de servir.'; }
    } catch (error) { noteError(out, error); }
  });
  enabled?.addEventListener('change', async () => {
    try {
      const access = await api<{ code: string | null; enabled: boolean; enlace: string }>('/api/empresa/codigo-acceso', { method: 'PATCH', body: JSON.stringify({ enabled: enabled.checked }) });
      paint(access);
      if (out) { out.className = 'muted'; out.textContent = access.enabled ? 'Código activo.' : 'Código desactivado.'; }
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
    <h2>Código de acceso</h2>
    <p class="muted">Quien tenga el código entra en la oficina como empleado, sin área ni puesto. No se envía ningún correo. Comparte el enlace o el código.</p>
    <label>Código</label>
    <input id="join-code-value" readonly value="${esc(access.code || 'Sin código')}">
    <label>Enlace para compartir</label>
    <input id="join-link" readonly value="${esc(url)}">
    <div class="join-actions">
      <button class="btn" id="copy-join" type="button">Copiar enlace</button>
      <button class="btn" id="regen-join" type="button">Regenerar código</button>
    </div>
    <label><input id="join-enabled" type="checkbox" ${access.enabled ? 'checked' : ''}> Código activo</label>
    <p id="join-out" class="muted"></p>
  </form>`;
}

async function inviteBox() {
  const [areas, titles] = await Promise.all([api<{ id: string; name: string }[]>('/api/areas'), api<{ id: string; name: string }[]>('/api/puestos')]);
  return `<form id="invite" class="cardx form"><h2>Invitar</h2>
    <p class="muted">No se envía ningún correo. Al crear la invitación te damos un enlace para copiar y compartir a mano.</p>
    <label>Correo</label><input name="email" type="email" required>
    <label>Rol</label><select name="role"><option value="empleado">Empleado</option><option value="administrador">Administrador / director de área</option></select>
    <label>Área</label><select name="areaId"><option value="">Sin área</option>${areas.map((area) => `<option value="${area.id}">${esc(area.name)}</option>`).join('')}</select>
    <label>Puesto</label><select name="jobTitleId"><option value="">Sin puesto</option>${titles.map((title) => `<option value="${title.id}">${esc(title.name)}</option>`).join('')}</select>
    <button class="btn primary" type="submit">Crear invitación</button><p id="invite-out" class="muted"></p></form>`;
}

async function renderEmployee(root: HTMLElement, id: string, session: Session) {
  const person = await api<EmployeeDetail>(`/api/empleados/${id}`);
  const mine = person.id === session.membership.id || session.membership.role === 'propietario';
  root.innerHTML = shell('equipo', person.name, `${person.area?.name || 'Sin área'} · ${person.puesto || person.roleLabel}`, `
    <div class="cardx detail-hero">${person.photoUrl ? `<img src="${esc(person.photoUrl)}" alt="">` : avatar(null, person.name)}
      <div><div class="tag">${esc(statusLabel(person.status))}</div><p>Puntuación <b>${person.score ?? '—'}</b> · ${person.points ?? 0} puntos</p>
      <p class="muted">${esc(person.schedule || '')} ${person.phone ? '· ' + esc(person.phone) : ''}</p></div></div>
    ${mine ? `<form id="photo" class="cardx"><label>Foto de perfil</label><input type="file" accept="image/*" name="file" required><button class="btn" type="submit">Subir foto</button><p id="photo-out" class="muted"></p></form>
      <label class="cardx"><input id="use-photo" type="checkbox" ${person.look?.usePhoto ? 'checked' : ''}> Usar mi foto como avatar</label>
      <p class="muted">Apagado: en la oficina se ve el personaje de juego, con tus colores. Encendido: la foto ocupa la cara. Hace falta haber subido una foto.</p>
      <form id="look" class="cardx form"><h2>Personaje</h2>
        <p class="muted">Colores, pelo y ropa del avatar. Es el que se ve en la oficina salvo que actives la foto.</p>
        <div class="look-grid">
          <div><label>Piel</label><input name="skin" type="color" value="${hex(person.look?.skin, '#EFC3A0')}"></div>
          <div><label>Pelo</label><input name="hair" type="color" value="${hex(person.look?.hair, '#3B2A20')}"></div>
          <div><label>Peinado</label><select name="hairStyle">
            ${[['0', 'Corto'], ['1', 'Largo'], ['2', 'Moño'], ['3', 'Rapado']].map(([value, label]) => `<option value="${value}" ${String(person.look?.hairStyle || 0) === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select></div>
          <div><label>Camiseta</label><input name="shirt" type="color" value="${hex(person.look?.shirt, '#E0A800')}"></div>
          <div><label>Pantalón</label><input name="pants" type="color" value="${hex(person.look?.pants, '#1F2937')}"></div>
          <label><input name="glasses" type="checkbox" ${person.look?.glasses ? 'checked' : ''}> Gafas</label>
        </div>
        <button class="btn" type="submit">Guardar personaje</button><p id="look-out" class="muted"></p>
      </form>` : ''}
    <h2>Historial</h2>
    <div class="table-wrap"><table class="data"><tr><th>Fecha</th><th>Nota</th><th>Métricas</th></tr>
      ${(person.history || []).slice().reverse().map((row) => `<tr><td>${esc(row.date)}${row.isDemo ? ' · demo' : ''}</td><td>${esc(row.note)}</td><td>${Object.entries(row.values).map(([key, value]) => `${esc(key)}: ${num(value)}`).join(', ')}</td></tr>`).join('') || '<tr><td colspan="3">Sin informes visibles</td></tr>'}
    </table></div>
    <p class="muted">Insignias: ${(person.badges || []).map((badge) => esc(badge.label)).join(', ') || 'ninguna'}. Horas conectado (30 días): ${person.activeHours ?? 0}.</p>
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
      out.textContent = 'Personaje guardado. Vuelve a la oficina para verlo.';
    } catch (error) { noteError(root.querySelector('#look-out'), error); }
  });
}

async function renderAreas(root: HTMLElement, session: Session) {
  const [areas, titles] = await Promise.all([api<AreaFull[]>('/api/areas'), api<{ id: string; name: string }[]>('/api/puestos')]);
  const own = session.membership.role === 'propietario';
  root.innerHTML = shell('areas', 'Áreas y puestos', 'Nada está fijo: crea, renombra o borra. Cada área nueva abre una zona en el plano.', `
    ${own ? `<form id="area" class="cardx form"><h2>Nueva área</h2><label>Nombre</label><input name="name" required><label>Color</label><input name="color" type="color" value="#F5C518"><label>Nombre del equipo</label><input name="teamName"><button class="btn primary" type="submit">Crear área y zona</button></form>` : ''}
    <div class="grid cards">${areas.map((area) => `<section class="cardx"><h2 style="color:${esc(area.color)}">${esc(area.name)}</h2><p class="muted">${esc(area.teamName)} · ${area.members} personas · ${esc(area.rooms.map((room) => room.name).join(', ') || 'sin zona')}</p>
      <ul>${area.kpis.map((kpi) => `<li>${esc(kpi.label)} (${esc(kpi.key)}) objetivo ${kpi.targetDaily ?? '—'}</li>`).join('') || '<li>Sin indicadores</li>'}</ul>
      ${own || session.membership.area?.id === area.id ? `<button class="btn" data-kpi="${area.id}" type="button">Editar indicadores</button>` : ''}
    </section>`).join('')}</div>
    <h2>Puestos</h2>
    <p>${titles.map((title) => esc(title.name)).join(' · ') || 'Todavía no hay puestos.'}</p>
    ${own ? '<form id="puesto" class="toolbar"><input name="name" placeholder="Nuevo puesto" required><button class="btn" type="submit">Añadir</button></form>' : ''}
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
    const raw = prompt('Indicadores separados por punto y coma. Ejemplo: llamadas|Llamadas|40; citas|Citas|5');
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
  root.innerHTML = shell('mapa', 'Editor de la oficina', 'Cambia el nombre de cada sala, el área a la que pertenece y quién se sienta en cada puesto.', `
    ${office.rooms.map((room) => `<form class="cardx room-form" data-room="${esc(room.mapRoomId)}">
      <b>${esc(room.mapRoomId)}</b>
      <div class="toolbar"><input name="name" value="${esc(room.name)}"><input name="label" value="${esc(room.label)}" placeholder="Rótulo">
      <select name="areaId"><option value="">Sin área</option>${office.areas.map((area) => `<option value="${area.id}" ${area.id === room.areaId ? 'selected' : ''}>${esc(area.name)}</option>`).join('')}</select>
      ${office.canEdit ? '<button class="btn" type="submit">Guardar sala</button>' : ''}</div></form>`).join('')}
    <h2>Puestos</h2>
    ${office.desks.map((desk) => `<form class="toolbar desk-form" data-seat="${esc(desk.seatId)}"><span style="min-width:110px">${esc(desk.seatId)}</span>
      <select name="membershipId"><option value="">Libre</option>${office.people.map((person) => `<option value="${person.id}" ${person.id === desk.membershipId ? 'selected' : ''}>${esc(person.name)}</option>`).join('')}</select>
      ${office.canEdit ? '<button class="btn" type="submit">Asignar</button>' : ''}</form>`).join('')}
    ${session.membership.role === 'propietario' ? '' : '<p class="muted">Solo el propietario guarda cambios del plano.</p>'}
  `);
  root.querySelectorAll<HTMLFormElement>('.room-form').forEach((form) => form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      await api(`/api/oficina/salas/${form.dataset.room}`, { method: 'PUT', body: JSON.stringify({ name: data.name, label: data.label, areaId: data.areaId || null }) });
      form.insertAdjacentHTML('beforeend', '<span class="muted"> Guardado</span>');
    } catch (error) { noteError(null, error); }
  });
  root.querySelectorAll<HTMLFormElement>('.desk-form').forEach((form) => form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      await api(`/api/oficina/puestos/${form.dataset.seat}`, { method: 'PUT', body: JSON.stringify({ membershipId: data.membershipId || null }) });
      form.insertAdjacentHTML('beforeend', '<span class="muted"> Asignado</span>');
    } catch (error) { noteError(null, error); }
  });
}

async function renderTasks(root: HTMLElement, session: Session) {
  const [tasks, areas, people] = await Promise.all([
    api<TaskItem[]>('/api/tareas'),
    api<{ id: string; name: string }[]>('/api/areas'),
    api<Person[]>('/api/empleados'),
  ]);
  const cols = ['pendiente', 'en_curso', 'hecho'];
  const titles: Record<string, string> = { pendiente: 'Pendiente', en_curso: 'En curso', hecho: 'Hecho' };
  root.innerHTML = shell('tareas', 'Tareas', 'Un tablero sencillo por área. Cuenta para la puntuación.', `
    ${session.membership.role === 'empleado' ? '' : `<form id="task" class="toolbar"><input name="title" placeholder="Nueva tarea" required><select name="areaId">${areas.map((area) => `<option value="${area.id}">${esc(area.name)}</option>`).join('')}</select><select name="assigneeId"><option value="">Sin asignar</option>${people.map((person) => `<option value="${person.id}">${esc(person.name)}</option>`).join('')}</select><button class="btn primary" type="submit">Crear</button></form>`}
    <div class="kanban">${cols.map((col) => `<div class="kcol"><b>${titles[col]}</b>${tasks.filter((task) => task.status === col).map((task) => `<article class="kcard"><b>${esc(task.title)}</b><div class="muted">${esc(task.area || '')} · ${esc(task.assignee || 'Sin asignar')}</div>
      ${cols.filter((next) => next !== col).map((next) => `<button class="btn" data-move="${task.id}" data-status="${next}" type="button">${titles[next]}</button>`).join(' ')}</article>`).join('')}</div>`).join('')}</div>
  `);
  root.querySelector('#task')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.target as HTMLFormElement).entries());
      await api('/api/tareas', { method: 'POST', body: JSON.stringify({ ...data, assigneeId: data.assigneeId || null }) });
      location.reload();
    } catch (error) { noteError(null, error); }
  });
  root.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((button) => button.onclick = async () => {
    try {
      await api(`/api/tareas/${button.dataset.move}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status }) });
      location.reload();
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
  root.innerHTML = shell('jornada', 'Informe de jornada', session.membership.area?.name || 'Asigna un área para registrar indicadores.', `
    <div class="cardx"><b>${fichaje.abierto ? 'Estás dentro desde ' + new Date(fichaje.clockIn || '').toLocaleTimeString('es') : 'No has fichado hoy'}</b>
      <div class="toolbar"><button class="btn primary" id="in" type="button">Fichar entrada</button><button class="btn" id="out" type="button">Fichar salida</button></div></div>
    <form id="report" class="cardx form"><p class="muted">${report.isDemo ? 'El informe de hoy es de demostración. Si lo guardas, pasa a ser tuyo.' : 'Los números se pueden cargar a mano o por la API de integración.'}</p>
      ${kpis.map((kpi) => `<label>${esc(kpi.label)}${kpi.unit ? ' (' + esc(kpi.unit) + ')' : ''}${kpi.targetDaily != null ? ' · objetivo ' + kpi.targetDaily : ''}</label><input name="${esc(kpi.key)}" type="number" step="0.1" value="${report.values[kpi.key] ?? ''}">`).join('') || '<p>Tu perfil no tiene indicadores todavía.</p>'}
      <label>Nota libre</label><textarea name="note">${esc(report.note || '')}</textarea>
      <button class="btn primary" type="submit">Guardar jornada</button></form>
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
      alert(saved.pointsAwarded ? `Jornada guardada. +${saved.pointsAwarded} puntos` : 'Jornada actualizada');
    } catch (error) { noteError(null, error); }
  });
}

async function renderChat(root: HTMLElement, session: Session, socket: Socket | null) {
  const initial = new URLSearchParams((location.hash.split('?')[1] || '')).get('con') || '';
  const [areas, directory] = await Promise.all([
    api<{ id: string; name: string }[]>('/api/areas'),
    api<{ personas: DirectPerson[] }>('/api/directos'),
  ]);
  const channels = [{ id: '', name: 'General' }, ...areas.filter((area) => session.membership.role === 'propietario' || area.id === session.membership.area?.id)];
  root.innerHTML = shell('chat', 'Chat del equipo', 'Canales de la empresa y mensajes directos. Un directo solo llega a un compañero de tu empresa.', `
    <div class="toolbar">
      <button class="btn" id="tab-canales" type="button">Canales</button>
      <button class="btn primary" id="tab-directos" type="button">Directos <span id="dm-badge" class="count-badge" hidden></span></button>
    </div>
    <div class="chat-layout">
      <aside class="cardx" id="chat-side">
        <div id="channel-box"><label>Canal</label><select id="channel">${channels.map((channel) => `<option value="${channel.id}">${esc(channel.name)}</option>`).join('')}</select></div>
        <div id="peer-box"></div>
      </aside>
      <section>
        <h2 id="chat-title" style="margin-top:0">General</h2>
        <div id="log" class="chat-log cardx"></div>
        <form id="send" class="toolbar"><input name="body" placeholder="Escribe un mensaje" required maxlength="1000"><button class="btn primary" type="submit">Enviar</button></form>
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
    log.innerHTML = rows.map((row) => `<div class="bubble"><b>${esc(row.author)}</b> <span class="muted">${esc(new Date(row.createdAt).toLocaleTimeString('es'))}</span><div>${esc(row.body)}</div></div>`).join('') || '<p class="muted">Todavía no hay mensajes en este canal.</p>';
    log.scrollTop = log.scrollHeight;
  };
  const paintThread = (rows: DirectLine[]) => {
    for (const row of rows) seen.add(row.id);
    log.innerHTML = rows.map((row) => `<div class="bubble ${row.senderId === session.membership.id ? 'mine' : ''}"><b>${esc(row.senderName)}</b> <span class="muted">${esc(new Date(row.createdAt).toLocaleTimeString('es'))}</span><div>${esc(row.body)}</div></div>`).join('') || '<p class="muted">Aún no os habéis escrito. El mensaje se queda guardado.</p>';
    log.scrollTop = log.scrollHeight;
  };
  const paintPeers = () => {
    const total = personas.reduce((sum, person) => sum + person.unread, 0);
    badge.hidden = total === 0;
    badge.textContent = String(total);
    peerBox.innerHTML = personas.map((person) => `<button class="peer-row ${person.id === selected && mode === 'directos' ? 'on' : ''}" data-peer="${esc(person.id)}" type="button">
      <span><b>${esc(person.name)}</b><span class="muted">${esc(person.puesto || 'Compañero')}${person.ultimo ? ' · ' + esc(person.ultimo.body) : ''}</span></span>
      ${person.unread ? `<span class="count-badge">${person.unread}</span>` : ''}
    </button>`).join('') || '<p class="muted">No hay más personas en la empresa.</p>';
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
    channelBox.hidden = mode !== 'canales';
    peerBox.hidden = mode !== 'directos';
    (root.querySelector('#tab-canales') as HTMLButtonElement).className = mode === 'canales' ? 'btn primary' : 'btn';
    (root.querySelector('#tab-directos') as HTMLButtonElement).className = mode === 'directos' ? 'btn primary' : 'btn';
    paintPeers();
    out.className = 'muted';
    out.textContent = '';
    if (mode === 'canales') {
      title.textContent = channel.selectedOptions[0]?.textContent || 'General';
      try {
        paintChannel(await api(`/api/chat?areaId=${encodeURIComponent(channel.value)}`));
      } catch (error) { noteError(out, error); }
      return;
    }
    const person = personas.find((item) => item.id === selected);
    title.textContent = person ? `Directo con ${person.name}` : 'Directos';
    if (!selected) {
      log.innerHTML = '<p class="muted">Elige a un compañero. También puedes pulsar su avatar en la oficina.</p>';
      return;
    }
    try {
      const thread = await api<{ con: { name: string }; mensajes: DirectLine[] }>(`/api/directos/${encodeURIComponent(selected)}`);
      title.textContent = `Directo con ${thread.con.name}`;
      if (person) person.unread = 0;
      paintPeers();
      paintThread(thread.mensajes);
    } catch (error) {
      log.innerHTML = '';
      noteError(out, error);
    }
  };
  root.querySelector('#tab-canales')!.addEventListener('click', () => { mode = 'canales'; history.replaceState(null, '', '#/chat'); void show(); });
  root.querySelector('#tab-directos')!.addEventListener('click', () => { mode = 'directos'; void show(); });
  channel.onchange = () => void show();
  socket?.off('chat:message');
  socket?.off('dm:message');
  socket?.off('dm:error');
  socket?.on('chat:message', () => { if (root.isConnected && mode === 'canales') void show(); });
  socket?.on('dm:message', (message: DirectLine) => {
    if (!root.isConnected) return;
    const mine = message.senderId === session.membership.id;
    const peerId = mine ? message.recipientId : message.senderId;
    const person = personas.find((item) => item.id === peerId);
    if (person) {
      person.ultimo = { body: message.body, createdAt: message.createdAt, mio: mine };
      if (!mine && !(mode === 'directos' && selected === peerId)) person.unread += 1;
      if (!mine && mode === 'directos' && selected === peerId) person.unread = 0;
    }
    if (mode === 'directos' && selected === peerId && !seen.has(message.id)) {
      seen.add(message.id);
      log.insertAdjacentHTML('beforeend', `<div class="bubble ${mine ? 'mine' : ''}"><b>${esc(message.senderName)}</b> <span class="muted">${esc(new Date(message.createdAt).toLocaleTimeString('es'))}</span><div>${esc(message.body)}</div></div>`);
      log.scrollTop = log.scrollHeight;
      if (!mine) void api(`/api/directos/${encodeURIComponent(peerId)}`).catch(() => {});
    }
    paintPeers();
  });
  socket?.on('dm:error', (payload: { error?: string }) => { if (root.isConnected) noteError(out, new Error(payload?.error || 'No se pudo enviar')); });
  root.querySelector('#send')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const body = String(new FormData(form).get('body') || '');
    try {
      if (mode === 'canales') {
        if (!socket?.connected) throw new Error('El chat en vivo no está conectado. Recarga la página.');
        socket.emit('chat:send', { body, areaId: channel.value || null });
        form.reset();
        setTimeout(() => { if (mode === 'canales') void show(); }, 250);
        return;
      }
      if (!selected) throw new Error('Elige a un compañero de la lista Directos');
      const sent = await api<DirectLine>(`/api/directos/${encodeURIComponent(selected)}`, { method: 'POST', body: JSON.stringify({ body }) });
      form.reset();
      const person = personas.find((item) => item.id === selected);
      if (person) person.ultimo = { body: sent.body, createdAt: sent.createdAt, mio: true };
      if (!seen.has(sent.id)) {
        seen.add(sent.id);
        if (!log.querySelector('.bubble')) log.innerHTML = '';
        log.insertAdjacentHTML('beforeend', `<div class="bubble mine"><b>${esc(sent.senderName)}</b> <span class="muted">${esc(new Date(sent.createdAt).toLocaleTimeString('es'))}</span><div>${esc(sent.body)}</div></div>`);
        log.scrollTop = log.scrollHeight;
      }
      paintPeers();
    } catch (error) { noteError(out, error); }
  });
  await show();
}

async function renderBadges(root: HTMLElement) {
  const data = await api<{ ranking: { name: string; points: number; puesto: string; photoUrl: string | null }[]; badges: { label: string; name: string }[] }>('/api/gamificacion');
  root.innerHTML = shell('logros', 'Puntos e insignias', 'Se ganan al informar la jornada, cumplir objetivos y cerrar tareas.', `
    <div class="grid cards">${data.ranking.map((person, index) => `<article class="cardx person">${avatar(person.photoUrl, person.name)}<div><b>${index + 1}. ${esc(person.name)}</b><div class="muted">${esc(person.puesto)} · ${person.points} pts</div></div></article>`).join('')}</div>
    <h2>Insignias</h2>
    <p>${data.badges.map((badge) => `${esc(badge.name)}: ${esc(badge.label)}`).join(' · ') || 'Aún no hay insignias.'}</p>
  `);
}

async function renderPlan(root: HTMLElement, session: Session) {
  const plan = await api<PlanView>('/api/plan');
  const pct = (used: number, max: number) => Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  root.innerHTML = shell('plan', 'Plan y uso', plan.pago.mensaje, `
    <div class="cardx"><h2 style="margin-top:0">${esc(plan.actual.name)} · ${esc(plan.actual.status)}</h2>
      <p>${esc(plan.actual.description)}</p>
      <p>Personas ${plan.uso.personas} / ${plan.uso.maxPersonas}</p><div class="usage"><span style="width:${pct(plan.uso.personas, plan.uso.maxPersonas)}%"></span></div>
      <p>Áreas ${plan.uso.areas} / ${plan.uso.maxAreas}</p><div class="usage"><span style="width:${pct(plan.uso.areas, plan.uso.maxAreas)}%"></span></div>
    </div>
    <div class="grid cards">${plan.planes.map((item) => `<article class="cardx"><h2>${esc(item.name)}</h2><p class="muted">Hasta ${item.maxWorkers} personas y ${item.maxAreas} áreas</p><p>${esc(item.description)}</p>
      ${session.membership.role === 'propietario' ? `<button class="btn" data-plan="${item.code}" type="button">${item.code === plan.actual.code ? 'Plan actual' : 'Usar este plan'}</button>` : ''}</article>`).join('')}</div>
  `);
  root.querySelectorAll<HTMLButtonElement>('[data-plan]').forEach((button) => button.onclick = async () => {
    if (button.dataset.plan === plan.actual.code) return;
    try {
      await api('/api/plan', { method: 'POST', body: JSON.stringify({ code: button.dataset.plan }) });
      location.reload();
    } catch (error) { noteError(null, error); }
  });
}

async function renderLeads(root: HTMLElement, session: Session) {
  const data = await api<LeadView>('/api/captacion');
  root.innerHTML = shell('captacion', 'Captación de leads', 'Próximamente', `
    <div class="cardx"><h2 style="margin-top:0">Próximamente</h2>
      <p>${esc(data.mensaje)}</p>
      <p class="muted">Leads ${data.contadores.leads} · Campañas ${data.contadores.campaigns} · Llamadas ${data.contadores.calls}</p>
      <ul>${data.extensiones.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      ${data.area ? `<p>Área preparada: <b>${esc(data.area.name)}</b></p>` : ''}
      ${session.membership.role === 'propietario' && !data.activo ? '<button class="btn primary" id="enable" type="button">Activar plantilla de área Llamadas</button>' : ''}
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

function noteError(node: Element | null, error: unknown) {
  const message = error instanceof Error ? error.message : 'No se pudo completar la acción';
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
  return ({ en_linea: 'En línea', ausente: 'Ausente', en_reunion: 'En reunión', cafe: 'Café virtual', en_llamada: 'En llamada', desconectado: 'Desconectado' } as Record<string, string>)[status] || status;
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
interface TaskItem { id: string; title: string; status: string; area: string | null; assignee: string | null }
interface PlanView { uso: { personas: number; areas: number; maxPersonas: number; maxAreas: number }; actual: { code: string; name: string; status: string; description: string }; planes: { code: string; name: string; maxWorkers: number; maxAreas: number; description: string }[]; pago: { mensaje: string } }
interface LeadView { mensaje: string; activo: boolean; area: { name: string } | null; contadores: { leads: number; campaigns: number; calls: number }; extensiones: string[] }
