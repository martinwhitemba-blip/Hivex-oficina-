/**
 * Interfaz HTML superpuesta al canvas: barra superior, panel lateral (drawer en
 * móvil), barra inferior, minimapa, panel de proximidad, joystick táctil, ayuda.
 */
import { BRAND_NAME, BRAND_TAGLINE, OFFICE_NAME } from '../config';
import { fmtEuro } from '../data/sampleData';
import { STATUSES, STATUS_ORDER } from '../data/statuses';
import { portraitDataUrl } from '../game/avatarRenderer';
import type { Avatar } from '../game/entities';
import type { Game } from '../game/game';
import type { ProximityMediaProvider } from '../media/proximityMedia';
import type { StatusId } from '../game/types';

export interface OfficeHooks {
  officeName: string;
  role: string;
  stats: { ventasHoy: number; importeHoy: number; citasHoy: number; seguimiento: number; demo: boolean };
  directory: { id: string; name: string; role: string; photoUrl?: string | null }[];
  alertCount: number;
  onNavigate: (view: string) => void;
  onLogout: () => void;
  onStatus?: (status: StatusId) => void;
  onToggleDemo?: (on: boolean) => void;
  onMessage?: (id: string) => void;
}
import { ICONS } from './icons';
import { Minimap } from './minimap';
import { Joystick } from './joystick';

export interface BrandAssets { mark: string; wordmark: string; logo: string }

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
};

const roleClass = (role: string) => role.split(' ')[0];
const isTouch = () => window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export class UI {
  private portraits = new Map<string, string>();
  private listEl!: HTMLElement;
  private proxEl!: HTMLElement;
  private roomEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private followEl!: HTMLElement;
  private carPill!: HTMLElement;
  private lockSwitch!: HTMLElement;
  private sidebar!: HTMLElement;
  private scrim!: HTMLElement;
  private minimap!: Minimap;
  private toastTimer = 0;
  private filter = '';

  constructor(private root: HTMLElement, private game: Game, private media: ProximityMediaProvider, private brand: BrandAssets, private hooks: OfficeHooks) {
    this.build();
    game.on('proximity', () => { this.renderProximity(); this.renderList(); });
    game.on('room', ({ room }) => this.renderRoom(room?.name ?? null, room?.kind ?? null));
    game.on('car', ({ on }) => this.carPill.classList.toggle('on', on));
    game.on('lock', ({ locked }) => this.lockSwitch.classList.toggle('on', !locked));
    game.on('follow', ({ id, name }) => {
      this.followEl.classList.toggle('show', !!id);
      if (id) this.followEl.querySelector('span')!.textContent = `Siguiendo a ${name}`;
    });
    game.on('toast', ({ text }) => this.toast(text));
    setInterval(() => this.renderList(), 1000);
    const tick = () => { this.minimap.draw(); this.renderProximityBars(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    this.renderList();
    this.renderRoom(null, null);
  }

  private portrait(a: Avatar) {
    let p = this.portraits.get(a.id);
    if (!p) { p = portraitDataUrl(a.look); this.portraits.set(a.id, p); }
    return p;
  }

  // ───────────────────────────── Construcción ─────────────────────────────
  private build() {
    const r = this.root;
    // Rail
    const rail = h('nav', 'rail');
    rail.innerHTML = `<div class="mark" title="${BRAND_NAME}"><img src="${this.brand.mark}" alt="${BRAND_NAME}"></div>`;
    const railBtns: [keyof typeof ICONS, string, string, number?][] = [
      ['map', 'Oficina', 'oficina'],
      ['gauge', 'Panel del dueño', 'dueno', this.hooks.alertCount || undefined],
      ['chart', 'Mi negocio', 'negocio'],
      ['users', 'Equipo', 'equipo'],
      ['building', 'Áreas', 'areas'],
      ['calendar', 'Jornada', 'jornada'],
      ['chat', 'Chat', 'chat'],
      ['trophy', 'Logros', 'logros'],
    ];
    railBtns.forEach(([ic, title, view, badge]) => {
      if (view === 'dueno' && this.hooks.role === 'empleado') return;
      const b = h('button', view === 'oficina' ? 'active' : '', ICONS[ic] + (badge ? `<span class="badge">${badge}</span>` : ''));
      b.title = title;
      b.dataset.view = view;
      b.onclick = () => this.hooks.onNavigate(view);
      rail.append(b);
    });
    rail.append(h('div', 'spacer'));
    const set = h('button', '', ICONS.settings); set.title = 'Plan y uso'; set.dataset.view = 'plan'; set.onclick = () => this.hooks.onNavigate('plan');
    rail.append(set);

    // Sidebar
    const sb = h('aside', 'sidebar');
    this.sidebar = sb;
    sb.innerHTML = `
      <div class="sb-head">
        <div class="brand"><img class="wordmark" src="${this.brand.wordmark}" alt="${BRAND_NAME}"><span class="tag">${BRAND_TAGLINE}</span></div>
        <button class="icon-btn" data-act="collapse" title="Ocultar panel">${ICONS.sidebar}</button>
      </div>
      <label class="search">${ICONS.search}<input placeholder="Buscar personas" /><kbd>⌘K</kbd></label>
      <div class="tabs"><button class="active">Salas ocupadas</button><button>Llamadas y anuncios</button></div>
      <div class="card citas">
        <div class="ic">${ICONS.calendar}</div>
        <div><div class="t1">Citas de hoy: ${this.hooks.stats.citasHoy}</div><div class="t2">Seguimiento pendiente: ${this.hooks.stats.seguimiento}</div></div>
        <button class="ver">Ver</button>
      </div>
      <div class="card me">
        <img class="me-pic" width="34" height="34" style="border-radius:50%" src="${this.portrait(this.game.player)}">
        <div class="info">
          <div class="name">${this.game.player.name} <span style="color:var(--muted);font-weight:500">(tú)</span></div>
          <div class="member" style="padding:0;border:0;cursor:default"><div class="meta" style="margin-top:3px"><span class="role Propietario">${this.game.player.role}</span></div></div>
          <select class="status-select" aria-label="Tu estado">
            ${STATUS_ORDER.map((s) => `<option value="${s}">● ${STATUSES[s].label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="sb-scroll"></div>`;
    this.listEl = sb.querySelector('.sb-scroll')!;
    const sel = sb.querySelector('select')!;
    const paintSel = () => { sel.style.color = STATUSES[sel.value as StatusId].color; };
    sel.onchange = () => { this.game.setPlayerStatus(sel.value as StatusId); paintSel(); this.hooks.onStatus?.(sel.value as StatusId); this.toast(`Tu estado: ${STATUSES[sel.value as StatusId].label}`); };
    paintSel();
    sb.querySelector('input')!.oninput = (e) => { this.filter = (e.target as HTMLInputElement).value.toLowerCase(); this.renderList(); };
    sb.querySelector<HTMLButtonElement>('[data-act=collapse]')!.onclick = () => this.toggleSidebar(false);
    sb.querySelector<HTMLButtonElement>('.ver')!.onclick = () => this.hooks.onNavigate('negocio');
    sb.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b, i, all) => b.onclick = () => { all.forEach((x) => x.classList.remove('active')); b.classList.add('active'); if (i === 1) this.toast('Llamadas y anuncios: próximamente'); });

    // Escenario
    const stage = h('main', 'stage');
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    stage.append(canvas);
    this.scrim = h('div', 'scrim');
    this.scrim.onclick = () => this.toggleSidebar(false);

    // Barra superior
    const top = h('div', 'overlay topbar');
    const menuBtn = h('button', 'pill btn menu-btn', `<img class="mk" src="${this.brand.mark}" alt="${BRAND_NAME}">` + ICONS.users + '<span class="lbl">Personas</span>');
    menuBtn.title = 'Personas y salas';
    menuBtn.onclick = () => this.toggleSidebar();
    top.append(menuBtn);
    top.insertAdjacentHTML('beforeend', `
      <span class="pill btn nav-open show-sm">${ICONS.list}<span class="lbl">Gestión</span></span>
      <span class="pill btn"><span class="dotg"></span>${this.hooks.officeName || OFFICE_NAME} ${ICONS.chevron}</span>
      <span class="pill hide-sm">${ICONS.calendar}${this.hooks.stats.seguimiento} seguimientos</span>
      <span class="pill">${ICONS.trend}Hoy: ${this.hooks.stats.ventasHoy} ventas · ${fmtEuro(this.hooks.stats.importeHoy)}</span>`);
    this.carPill = h('span', 'pill btn car', ICONS.car + 'Coche');
    this.carPill.title = 'Modo coche (C) · pitar con H';
    this.carPill.onclick = () => this.game.toggleCar();
    top.append(this.carPill);
    top.insertAdjacentHTML('beforeend', `
      <span class="pill hide-sm">${ICONS.users}${this.hooks.stats.citasHoy} citas hoy</span>
      ${this.hooks.stats.demo ? '<span class="pill sample hide-sm">datos de demostración</span>' : ''}`);

    // Proximidad
    this.proxEl = h('div', 'overlay prox hidden');
    // Sala actual
    this.roomEl = h('div', 'overlay room-badge');
    // Seguimiento de cámara
    this.followEl = h('div', 'overlay follow', '<span></span>');
    const back = h('button', '', 'Volver'); back.onclick = () => this.game.stopFollow();
    this.followEl.append(back);
    // Seguimiento pendiente
    const seg = h('div', 'overlay seguimiento');
    seg.innerHTML = `<span class="pill btn">${ICONS.list}<span class="lbl">Seguimiento pendiente</span><span class="cnt">${this.hooks.stats.seguimiento}</span></span>`;
    seg.querySelector<HTMLElement>('.pill')!.onclick = () => this.hooks.onNavigate('tareas');

    // Barra inferior
    const bar = h('div', 'overlay bottombar');
    const mk = (cls: string, html: string, title: string, fn: (b: HTMLButtonElement) => void) => {
      const b = h('button', 'bb ' + cls, html) as HTMLButtonElement; b.title = title; b.onclick = () => fn(b); bar.append(b); return b;
    };
    mk('hide-sm', `<img class="me-pic" src="${this.portrait(this.game.player)}">`, 'Tu avatar', () => this.game.focusMember(this.game.player.id));
    mk('on', ICONS.mic, 'Micrófono', (b) => {
      this.media.setMicEnabled(!this.media.mic);
      b.className = 'bb ' + (this.media.mic ? 'on' : 'off'); b.innerHTML = this.media.mic ? ICONS.mic : ICONS.micOff;
      this.toast(this.media.mic ? 'Micrófono activado' : 'Micrófono silenciado');
    });
    mk('off', ICONS.camOff, 'Cámara', (b) => {
      this.media.setCameraEnabled(!this.media.cam);
      b.className = 'bb ' + (this.media.cam ? 'on' : 'off'); b.innerHTML = this.media.cam ? ICONS.cam : ICONS.camOff;
      this.toast(this.media.cam ? 'Cámara activada' : 'Cámara desactivada');
    });
    const emojiPop = h('div', 'emoji-pop');
    ['👋', '👍', '😂', '🎉', '❤️', '🔥', '☕'].forEach((e) => {
      const b = h('button', '', e); b.onclick = () => { this.game.react(e); emojiPop.classList.remove('show'); }; emojiPop.append(b);
    });
    bar.append(emojiPop);
    mk('', ICONS.smile, 'Reacciones', () => emojiPop.classList.toggle('show'));
    mk('hide-sm', ICONS.screen, 'Compartir pantalla', () => this.toast('Compartir pantalla llegará cuando configures LiveKit'));
    bar.append(h('span', 'sep hide-sm'));
    mk('primary', ICONS.phone + '<span class="lbl long">Llamada con cliente</span><span class="lbl short">Llamar</span>', 'Llamada con cliente', () => this.hooks.onNavigate('captacion'));
    bar.append(h('span', 'sep hide-sm'));
    mk('hide-sm', ICONS.hand, 'Levantar la mano', () => this.game.react('✋'));
    mk('hide-sm', ICONS.headphones, 'Audio', () => this.toast('Ajustes de audio: próximamente'));
    mk('hide-sm danger', ICONS.logout, 'Salir', () => this.hooks.onLogout());
    mk('help', ICONS.help + '<span class="lbl">Ayuda</span>', 'Ayuda', () => this.showHelp(true));

    // Minimapa + zoom
    const mm = h('div', 'overlay minimap');
    const zoom = h('div', 'zoom');
    const zb = (ic: string, title: string, fn: () => void) => { const b = h('button', '', ic); b.title = title; b.onclick = fn; zoom.append(b); };
    zb(ICONS.plus, 'Acercar', () => this.game.zoomBy(1.15));
    zb(ICONS.minus, 'Alejar', () => this.game.zoomBy(1 / 1.15));
    zb(ICONS.target, 'Centrar en mí', () => this.game.stopFollow());
    this.minimap = new Minimap(this.game);
    const frame = h('div', 'frame');
    frame.append(this.minimap.canvas);
    const mmToggle = h('span', 'pill btn mm-toggle', ICONS.map + '<span class="lbl">Ocultar minimapa</span>');
    mmToggle.onclick = () => {
      const hidden = frame.classList.toggle('hidden');
      mmToggle.querySelector('.lbl')!.textContent = hidden ? 'Mostrar minimapa' : 'Ocultar minimapa';
    };
    if (window.innerWidth < 760) { frame.classList.add('hidden'); mmToggle.querySelector('.lbl')!.textContent = 'Mostrar minimapa'; }
    mm.append(zoom, mmToggle, frame);

    this.toastEl = h('div', 'toast');

    // Joystick táctil
    const joy = new Joystick((x, y) => this.game.setVirtualAxis(x, y));
    joy.el.classList.add('overlay');
    if (!isTouch()) joy.el.classList.add('hidden');
    const honkBtn = h('button', 'overlay honk-btn', '📯');
    honkBtn.title = 'Pitar (H)';
    honkBtn.onclick = () => this.game.honk();
    this.game.on('car', ({ on }) => honkBtn.classList.toggle('show', on && isTouch()));

    top.querySelector<HTMLButtonElement>('.nav-open')!.onclick = () => this.hooks.onNavigate('menu');
    stage.append(top, this.proxEl, this.roomEl, this.followEl, seg, bar, mm, this.toastEl, joy.el, honkBtn);
    r.append(rail, sb, this.scrim, stage, this.buildHelp());

    // Atajo ⌘K / Ctrl+K → buscar
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.toggleSidebar(true); sb.querySelector('input')!.focus(); }
      if (e.key === '?') this.showHelp(true);
    });
    document.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('.bottombar')) emojiPop.classList.remove('show'); });
    // En pantallas estrechas el panel empieza cerrado (drawer).
    if (window.innerWidth < 900) this.toggleSidebar(false);
  }

  toggleSidebar(open?: boolean) {
    const collapsed = this.sidebar.classList.contains('collapsed');
    const willOpen = open ?? collapsed;
    this.sidebar.classList.toggle('collapsed', !willOpen);
    this.scrim.classList.toggle('show', willOpen && window.innerWidth < 900);
    document.body.classList.toggle('sb-closed', !willOpen);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 230);
  }

  private helpEl!: HTMLElement;
  private buildHelp() {
    const bg = h('div', 'modal-bg');
    bg.innerHTML = `
      <div class="modal">
        <img class="logo" src="${this.brand.logo}" alt="${BRAND_NAME}">
        <h2>Cómo moverte por la oficina</h2>
        <table>
          <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / flechas</td><td>Caminar</td></tr>
          <tr><td>Clic / toque en el mapa</td><td>Ir hasta ahí (busca el camino)</td></tr>
          <tr><td>Joystick (móvil)</td><td>Caminar con el pulgar</td></tr>
          <tr><td>Clic en un compañero</td><td>Ir hasta él · en la lista: centrar cámara</td></tr>
          <tr><td><kbd>C</kbd> o botón «Coche»</td><td>Modo coche (más rápido)</td></tr>
          <tr><td><kbd>H</kbd> / 📯</td><td>Pitar (en modo coche)</td></tr>
          <tr><td><kbd>E</kbd> junto a la puerta</td><td>Abrir/cerrar el despacho privado</td></tr>
          <tr><td>Rueda / pellizco / <kbd>+</kbd><kbd>−</kbd></td><td>Zoom</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Volver a seguirte a ti</td></tr>
        </table>
        <p class="note">Beta HIVEX · la oficina es multijugador · las métricas de la demo están marcadas como demostración.</p>
        <button class="bb primary close">Entendido</button>
      </div>`;
    bg.onclick = (e) => { if (e.target === bg) this.showHelp(false); };
    bg.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.showHelp(false);
    this.helpEl = bg;
    return bg;
  }
  showHelp(v: boolean) { this.helpEl.classList.toggle('show', v); }

  setActive(view: string) {
    this.root.querySelectorAll<HTMLButtonElement>('.rail button[data-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });
  }

  // ───────────────────────────── Render dinámico ─────────────────────────────
  private canMessage(id: string) {
    return this.game.remotes.has(id) || this.hooks.directory.some((person) => person.id === id);
  }

  private openMessage(id: string) {
    if (!this.canMessage(id)) {
      this.toast('Ese personaje de demostración no recibe mensajes');
      return;
    }
    this.hooks.onMessage?.(id);
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }

  private renderRoom(name: string | null, kind: string | null) {
    this.roomEl.className = 'overlay room-badge' + (kind === 'meeting' || kind === 'private' ? ' meeting' : '');
    this.roomEl.innerHTML = `<span class="dot"></span>${name ? `Estás en ${name}` : 'Zona común'}`;
  }

  private renderProximity() {
    const peers = this.game.peers;
    this.proxEl.classList.toggle('hidden', peers.length === 0);
    if (!peers.length) return;
    const byId = new Map(this.game.allAvatars().map((a) => [a.id, a]));
    this.proxEl.innerHTML = `
      <div class="ttl">${ICONS.volume}Conversación cercana</div>
      <div class="names">${peers.map((p) => p.name.split(' ')[0]).join(', ')}</div>
      ${peers.map((p) => `<div class="peer" data-id="${p.id}"><img src="${this.portrait(byId.get(p.id)!)}"><span style="width:62px">${p.name.split(' ')[0]}</span><span class="bar"><i style="width:${Math.round(p.volume * 100)}%"></i></span></div>`).join('')}
      <div class="hint">${this.game.peers.some((p) => !this.game.remotes.has(p.id)) && !this.game.peers.some((p) => this.game.remotes.has(p.id)) ? 'Compañeros de demostración, sin audio real' : this.media.notice}</div>`;
  }

  private renderProximityBars() {
    for (const p of this.game.peers) {
      const i = this.proxEl.querySelector<HTMLElement>(`.peer[data-id="${p.id}"] i`);
      if (i) i.style.width = Math.round(p.volume * 100) + '%';
    }
  }

  private renderList() {
    const g = this.game;
    const near = new Set(g.peers.map((p) => p.id));
    const npcs = g.allAvatars().filter((a) => a !== g.player && (!this.filter || a.name.toLowerCase().includes(this.filter)));
    const inMeeting = npcs.filter((a) => a.status === 'en_reunion');
    const nearList = npcs.filter((a) => near.has(a.id));
    const online = npcs.filter((a) => a.status !== 'en_reunion' && !near.has(a.id));
    const present = new Set(g.allAvatars().map((a) => a.id));
    const offline = this.hooks.directory.filter((o) => !present.has(o.id) && (!this.filter || o.name.toLowerCase().includes(this.filter)));

    const row = (a: Avatar) => `
      <div class="member" data-id="${a.id}" title="Clic: centrar cámara · Ir: caminar hasta ${a.name.split(' ')[0]}">
        <div class="pic"><img src="${this.portrait(a)}"><span class="dot" style="background:${STATUSES[a.status].color}"></span></div>
        <div class="body">
          <div class="nm">${a.name}${a.isNew ? '<span class="new">Nuevo</span>' : ''}</div>
          <div class="meta"><span class="role ${roleClass(a.role)}">${a.role}</span><span>${STATUSES[a.status].emoji} ${STATUSES[a.status].label}</span></div>
        </div>
        <button class="go" data-msg="${a.id}">Mensaje</button>
        <button class="go" data-go="${a.id}">Ir</button>
      </div>`;
    const section = (title: string, items: string[]) => items.length ? `<div class="section-title">${title} <span class="count">(${items.length})</span></div>${items.join('')}` : '';

    let html = '';
    if (nearList.length) {
      html += `<div class="section-title">Conversación cercana</div><div class="conv"><div class="who">${nearList.map((a) => a.name.split(' ')[0]).join(', ')}</div><div class="sub">Audio por proximidad (simulado)</div></div>`;
      html += section('Cerca de ti', nearList.map(row));
    }
    html += section('En reunión', inMeeting.filter((a) => !near.has(a.id)).map(row));
    html += section('En la oficina', online.map(row));
    html += `<div class="section-title">Salas</div>
      <div class="room-row">${g.world.isPrivateLocked() ? ICONS.lock : ICONS.unlock}<span class="rn">Despacho privado</span><button class="switch ${g.world.isPrivateLocked() ? '' : 'on'}" data-act="lock" title="Abrir / cerrar"></button></div>`;
    html += `<div class="room-row"><span class="rn">Compañeros de demostración</span><button class="switch ${g.demoOn ? 'on' : ''}" data-act="demo" title="Mostrar u ocultar NPC"></button></div>`;
    html += section('Desconectados', offline.map((o) => `
      <div class="member offline" data-id="${o.id}"><div class="pic">${o.photoUrl ? `<img src="${o.photoUrl}" alt="">` : `<div class="ph">${o.name.split(' ').map((w) => w[0]).join('')}</div>`}<span class="dot" style="background:#555"></span></div>
      <div class="body"><div class="nm">${o.name}</div><div class="meta"><span class="role ${roleClass(o.role)}">${o.role}</span><span>Desconectado</span></div></div>
      <button class="go" data-msg="${o.id}">Mensaje</button></div>`));

    // Evita re-render si no cambió (mantiene hover/scroll)
    if (this.listEl.dataset.html === html) return;
    this.listEl.dataset.html = html;
    const scroll = this.listEl.scrollTop;
    this.listEl.innerHTML = html;
    this.listEl.scrollTop = scroll;
    this.listEl.querySelectorAll<HTMLElement>('.member[data-id]').forEach((el) => el.onclick = (e) => {
      const msg = (e.target as HTMLElement).closest<HTMLElement>('[data-msg]');
      const pic = (e.target as HTMLElement).closest('.pic');
      if (msg || pic) {
        this.openMessage(el.dataset.id!);
        if (window.innerWidth < 900) this.toggleSidebar(false);
        return;
      }
      const go = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
      if (go) g.walkTo(go.dataset.go!); else g.focusMember(el.dataset.id!);
      if (window.innerWidth < 900) this.toggleSidebar(false);
    });
    this.lockSwitch = this.listEl.querySelector('[data-act=lock]')!;
    this.lockSwitch.onclick = () => { g.setPrivateLocked(!g.world.isPrivateLocked()); this.listEl.dataset.html = ''; this.renderList(); };
    const demoBtn = this.listEl.querySelector<HTMLButtonElement>('[data-act=demo]');
    if (demoBtn) demoBtn.onclick = () => { this.hooks.onToggleDemo?.(!g.demoOn); this.listEl.dataset.html = ''; this.renderList(); };
  }
}
