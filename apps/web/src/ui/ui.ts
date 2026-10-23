/**
 * Interfaz HTML superpuesta al canvas: barra superior, panel lateral (drawer en
 * móvil), barra inferior, minimapa, panel de proximidad, joystick táctil, ayuda.
 */
import { BRAND_NAME, BRAND_TAGLINE, OFFICE_NAME } from '../config';
import { STATUSES, STATUS_ORDER } from '../data/statuses';
import { knownPhrase, langSelect, moneyOf, roleName, statusText, t } from '../i18n';
import { mountNotifyBadge } from '../platform/notifyUnread';
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
  private directUnread = 0;
  private unmountNotify: (() => void) | null = null;
  private listenersBound = false;
  private honkBtn!: HTMLElement;
  private marca: { nombre: string; oficina: string; logoUrl: string | null } | null = null;
  private lastRoom: string | null = null;
  private lastKind: string | null = null;

  constructor(private root: HTMLElement, private game: Game, private media: ProximityMediaProvider, private brand: BrandAssets, private hooks: OfficeHooks) {
    this.build();
    game.on('proximity', () => { this.renderProximity(); this.renderList(); });
    game.on('room', ({ room }) => this.renderRoom(room?.name ?? null, room?.kind ?? null));
    game.on('car', ({ on }) => {
      this.carPill?.classList.toggle('on', on);
      this.honkBtn?.classList.toggle('show', on && isTouch());
    });
    game.on('lock', ({ locked }) => this.lockSwitch.classList.toggle('on', !locked));
    game.on('follow', ({ id, name }) => {
      this.followEl.classList.toggle('show', !!id);
      if (id) this.followEl.querySelector('span')!.textContent = t('office.follow', { name: name ?? '' });
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
    this.unmountNotify?.();
    this.unmountNotify = null;
    const r = this.root;
    // Rail
    const rail = h('nav', 'rail');
    rail.innerHTML = `<div class="mark" title="${BRAND_NAME}"><img src="${this.brand.mark}" alt="${BRAND_NAME}"></div>`;
    const railBtns: [keyof typeof ICONS, string, string, number?][] = [
      ['map', t('nav.office'), 'oficina'],
      ['gauge', t('office.railOwner'), 'dueno', this.hooks.alertCount || undefined],
      ['chart', t('office.railBusiness'), 'negocio'],
      ['users', t('nav.team'), 'equipo'],
      ['building', t('nav.areas'), 'areas'],
      ['calendar', t('nav.day'), 'jornada'],
      ['chat', t('nav.chat'), 'chat'],
      ['trophy', t('nav.badges'), 'logros'],
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
    const set = h('button', '', ICONS.settings); set.title = t('office.railPlan'); set.dataset.view = 'plan'; set.onclick = () => this.hooks.onNavigate('plan');
    rail.append(set);

    // Sidebar
    const sb = h('aside', 'sidebar');
    this.sidebar = sb;
    sb.innerHTML = `
      <div class="sb-head">
        <div class="brand"><div class="brand-block"><img class="wordmark" src="${this.brand.wordmark}" alt="${BRAND_NAME}"><span class="tag">${this.hooks.officeName || BRAND_TAGLINE}</span><span class="powered">${t('brand.powered')}</span></div></div>
        <button class="icon-btn" data-act="collapse" title="${t('office.hidePanel')}">${ICONS.sidebar}</button>
      </div>
      <label class="search">${ICONS.search}<input placeholder="${t('office.search')}" /><kbd>⌘K</kbd></label>
      <div class="tabs"><button class="active">${t('office.roomsTab')}</button><button>${t('office.callsTab')}</button></div>
      <div class="card citas">
        <div class="ic">${ICONS.calendar}</div>
        <div><div class="t1">${t('office.meetingsToday', { n: this.hooks.stats.citasHoy })}</div><div class="t2">${t('office.followups', { n: this.hooks.stats.seguimiento })}</div></div>
        <button class="ver">${t('office.see')}</button>
      </div>
      <div class="card me">
        <img class="me-pic" width="34" height="34" style="border-radius:50%" src="${this.portrait(this.game.player)}">
        <div class="info">
          <div class="name">${this.game.player.name} <span style="color:var(--muted);font-weight:500">${t('office.you')}</span></div>
          <div class="member" style="padding:0;border:0;cursor:default"><div class="meta" style="margin-top:3px"><span class="role Propietario">${roleName(this.game.player.role)}</span></div></div>
          <select class="status-select" aria-label="${t('office.yourStatus')}">
            ${STATUS_ORDER.map((s) => `<option value="${s}">● ${statusText(s)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="sb-scroll"></div>`;
    this.listEl = sb.querySelector('.sb-scroll')!;
    const sel = sb.querySelector('select')!;
    const paintSel = () => { sel.style.color = STATUSES[sel.value as StatusId].color; };
    sel.onchange = () => { this.game.setPlayerStatus(sel.value as StatusId); paintSel(); this.hooks.onStatus?.(sel.value as StatusId); this.toast(t('office.statusToast', { label: statusText(sel.value) })); };
    paintSel();
    sb.querySelector('input')!.oninput = (e) => { this.filter = (e.target as HTMLInputElement).value.toLowerCase(); this.renderList(); };
    sb.querySelector<HTMLButtonElement>('[data-act=collapse]')!.onclick = () => this.toggleSidebar(false);
    sb.querySelector<HTMLButtonElement>('.ver')!.onclick = () => this.hooks.onNavigate('negocio');
    sb.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b, i, all) => b.onclick = () => { all.forEach((x) => x.classList.remove('active')); b.classList.add('active'); if (i === 1) this.toast(t('office.callsSoon')); });

    // Escenario
    const stage = h('main', 'stage');
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    stage.append(canvas);
    this.scrim = h('div', 'scrim');
    this.scrim.onclick = () => this.toggleSidebar(false);

    // Barra superior
    const top = h('div', 'overlay topbar');
    const menuBtn = h('button', 'pill btn menu-btn', `<img class="mk" src="${this.brand.mark}" alt="${BRAND_NAME}">` + ICONS.users + `<span class="lbl">${t('office.people')}</span>`);
    menuBtn.title = t('office.peopleRooms');
    menuBtn.onclick = () => this.toggleSidebar();
    top.append(menuBtn);
    const notify = h('span', 'pill btn', '');
    notify.id = 'hivex-notify-mount';
    notify.dataset.hivexNotify = '0';
    notify.title = t('inbox.bell');
    top.append(notify);
    this.unmountNotify = mountNotifyBadge(notify);
    top.insertAdjacentHTML('beforeend', `
      <span class="pill btn nav-open show-sm">${ICONS.list}<span class="lbl">${t('office.manage')}</span></span>
      <span class="pill btn office-pill"><span class="dotg"></span><span class="office-label">${this.hooks.officeName || OFFICE_NAME}</span> ${ICONS.chevron}</span>
      <span class="pill hide-sm">${ICONS.calendar}${t('office.followupsShort', { n: this.hooks.stats.seguimiento })}</span>
      <span class="pill">${ICONS.trend}${t('office.todaySales', { sales: this.hooks.stats.ventasHoy, money: moneyOf(this.hooks.stats.importeHoy) })}</span>`);
    this.carPill = h('span', 'pill btn car', ICONS.car + t('office.car'));
    this.carPill.title = t('office.carTitle');
    this.carPill.onclick = () => this.game.toggleCar();
    top.append(this.carPill);
    top.insertAdjacentHTML('beforeend', `
      <span class="pill hide-sm">${ICONS.users}${t('office.meetingsPill', { n: this.hooks.stats.citasHoy })}</span>
      ${this.hooks.stats.demo ? `<span class="pill sample hide-sm">${t('office.demoData')}</span>` : ''}${langSelect()}`);

    // Proximidad
    this.proxEl = h('div', 'overlay prox hidden');
    // Sala actual
    this.roomEl = h('div', 'overlay room-badge');
    // Seguimiento de cámara
    this.followEl = h('div', 'overlay follow', '<span></span>');
    const back = h('button', '', t('office.back')); back.onclick = () => this.game.stopFollow();
    this.followEl.append(back);
    // Seguimiento pendiente
    const seg = h('div', 'overlay seguimiento');
    seg.innerHTML = `<span class="pill btn">${ICONS.list}<span class="lbl">${t('office.pending')}</span><span class="cnt">${this.hooks.stats.seguimiento}</span></span>`;
    seg.querySelector<HTMLElement>('.pill')!.onclick = () => this.hooks.onNavigate('tareas');

    // Barra inferior
    const bar = h('div', 'overlay bottombar');
    const mk = (cls: string, html: string, title: string, fn: (b: HTMLButtonElement) => void) => {
      const b = h('button', 'bb ' + cls, html) as HTMLButtonElement; b.title = title; b.onclick = () => fn(b); bar.append(b); return b;
    };
    mk('hide-sm', `<img class="me-pic" src="${this.portrait(this.game.player)}">`, t('office.avatar'), () => this.game.focusMember(this.game.player.id));
    mk('off', ICONS.micOff, t('office.mic'), (b) => {
      void Promise.resolve(this.media.setMicEnabled(!this.media.mic)).then(() => {
        b.className = 'bb ' + (this.media.mic ? 'on' : 'off');
        b.innerHTML = this.media.mic ? ICONS.mic : ICONS.micOff;
        this.toast(this.media.mic ? t('office.micOn') : t('office.micOff'));
      });
    });
    mk('off', ICONS.camOff, t('office.cam'), (b) => {
      this.media.setCameraEnabled(!this.media.cam);
      b.className = 'bb ' + (this.media.cam ? 'on' : 'off'); b.innerHTML = this.media.cam ? ICONS.cam : ICONS.camOff;
      this.toast(this.media.cam ? t('office.camOn') : t('office.camOff'));
    });
    const emojiPop = h('div', 'emoji-pop');
    ['👋', '👍', '😂', '🎉', '❤️', '🔥', '☕'].forEach((e) => {
      const b = h('button', '', e); b.onclick = () => { this.game.react(e); emojiPop.classList.remove('show'); }; emojiPop.append(b);
    });
    bar.append(emojiPop);
    mk('', ICONS.smile, t('office.react'), () => emojiPop.classList.toggle('show'));
    mk('hide-sm', ICONS.screen, t('office.screen'), () => this.toast(t('office.screenSoon')));
    bar.append(h('span', 'sep hide-sm'));
    mk('primary', ICONS.phone + `<span class="lbl long">${t('office.callClient')}</span><span class="lbl short">${t('office.callShort')}</span>`, t('office.callClient'), () => this.hooks.onNavigate('captacion'));
    bar.append(h('span', 'sep hide-sm'));
    mk('hide-sm', ICONS.hand, t('office.hand'), () => this.game.react('✋'));
    mk('hide-sm', ICONS.headphones, t('office.audio'), () => this.toast(t('office.audioSoon')));
    mk('hide-sm danger', ICONS.logout, t('office.leave'), () => this.hooks.onLogout());
    mk('help', ICONS.help + `<span class="lbl">${t('office.help')}</span>`, t('office.help'), () => this.showHelp(true));

    // Minimapa + zoom
    const mm = h('div', 'overlay minimap');
    mm.insertAdjacentHTML('afterbegin', `<div class="mm-caption">${this.hooks.officeName || OFFICE_NAME}</div>`);
    const zoom = h('div', 'zoom');
    const zb = (ic: string, title: string, fn: () => void) => { const b = h('button', '', ic); b.title = title; b.onclick = fn; zoom.append(b); };
    zb(ICONS.plus, t('office.zoomIn'), () => this.game.zoomBy(1.15));
    zb(ICONS.minus, t('office.zoomOut'), () => this.game.zoomBy(1 / 1.15));
    zb(ICONS.target, t('office.center'), () => this.game.stopFollow());
    this.minimap = new Minimap(this.game);
    const frame = h('div', 'frame');
    frame.append(this.minimap.canvas);
    const mmToggle = h('span', 'pill btn mm-toggle', ICONS.map + `<span class="lbl">${t('office.hideMap')}</span>`);
    mmToggle.onclick = () => {
      const hidden = frame.classList.toggle('hidden');
      mmToggle.querySelector('.lbl')!.textContent = hidden ? t('office.showMap') : t('office.hideMap');
    };
    if (window.innerWidth < 760) { frame.classList.add('hidden'); mmToggle.querySelector('.lbl')!.textContent = t('office.showMap'); }
    mm.append(zoom, mmToggle, frame);

    this.toastEl = h('div', 'toast');

    // Joystick táctil
    const joy = new Joystick((x, y) => this.game.setVirtualAxis(x, y));
    joy.el.classList.add('overlay');
    if (!isTouch()) joy.el.classList.add('hidden');
    const honkBtn = h('button', 'overlay honk-btn', '📯');
    honkBtn.title = t('office.honk');
    honkBtn.onclick = () => this.game.honk();
    this.honkBtn = honkBtn;

    top.querySelector<HTMLButtonElement>('.nav-open')!.onclick = () => this.hooks.onNavigate('menu');
    stage.append(top, this.proxEl, this.roomEl, this.followEl, seg, bar, mm, this.toastEl, joy.el, honkBtn);
    r.append(rail, sb, this.scrim, stage, this.buildHelp());

    if (!this.listenersBound) {
      this.listenersBound = true;
      window.addEventListener('keydown', (e) => {
        const typing = e.target instanceof HTMLElement && !!e.target.closest('input, textarea, select, [contenteditable="true"]');
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.toggleSidebar(true); this.sidebar.querySelector('input')?.focus(); }
        if (e.key === '?' && !typing) this.showHelp(true);
      });
      document.addEventListener('pointerdown', (event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target || this.root.hidden) return;
        if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (!document.getElementById('pages')?.classList.contains('hidden')) return;
        this.game.focusKeyboard();
      });
      document.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('.bottombar')) this.root.querySelector('.emoji-pop')?.classList.remove('show'); });
    }
    // En pantallas estrechas el panel empieza cerrado (drawer).
    if (window.innerWidth < 900) this.toggleSidebar(false);
  }

  relabel() {
    const canvas = document.getElementById('game');
    if (canvas) document.body.append(canvas);
    if (this.listEl) this.listEl.dataset.html = '';
    this.root.replaceChildren();
    this.build();
    this.setDirectUnread(this.directUnread);
    if (this.marca) this.applyMarca(this.marca);
    this.renderList();
    this.renderRoom(this.lastRoom, this.lastKind);
    this.game.watchParent();
    this.game.refreshLabels();
  }

  applyMarca(marca: { nombre: string; oficina: string; logoUrl: string | null }) {
    this.marca = marca;
    const word = this.sidebar.querySelector<HTMLImageElement>('.wordmark');
    const tag = this.sidebar.querySelector('.tag');
    const caption = this.root.querySelector('.mm-caption');
    const mark = this.root.querySelector<HTMLImageElement>('.rail .mark img');
    const menu = this.root.querySelector<HTMLImageElement>('.menu-btn .mk');
    if (tag) tag.textContent = marca.oficina;
    if (caption) caption.textContent = marca.oficina;
    if (marca.logoUrl) {
      if (word) { word.src = marca.logoUrl; word.alt = marca.nombre; word.style.height = '32px'; word.style.width = 'auto'; }
      if (mark) { mark.src = marca.logoUrl; mark.alt = marca.nombre; }
      if (menu) { menu.src = marca.logoUrl; menu.alt = marca.nombre; }
    }
    const label = this.root.querySelector('.office-label');
    if (label) label.textContent = marca.oficina;
    this.hooks.officeName = marca.oficina;
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
        <h2>${t('office.helpTitle')}</h2>
        <table>
          <tr><td>${t('office.keys')}</td><td>${t('office.walk')}</td></tr>
          <tr><td>${t('office.clickGo')}</td><td>${t('office.clickGoHelp')}</td></tr>
          <tr><td>${t('office.joy')}</td><td>${t('office.joyHelp')}</td></tr>
          <tr><td>${t('office.clickMate')}</td><td>${t('office.clickMateHelp')}</td></tr>
          <tr><td><kbd>C</kbd></td><td>${t('office.carHelp')}</td></tr>
          <tr><td><kbd>H</kbd> / 📯</td><td>${t('office.honkHelp')}</td></tr>
          <tr><td><kbd>E</kbd></td><td>${t('office.door')}</td></tr>
          <tr><td>${t('office.wheel')}</td><td>${t('office.zoomHelp')}</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>${t('office.escHelp')}</td></tr>
        </table>
        <p class="note">${t('office.helpNote')}</p>
        <button class="bb primary close">${t('office.gotIt')}</button>
      </div>`;
    bg.onclick = (e) => { if (e.target === bg) this.showHelp(false); };
    bg.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.showHelp(false);
    this.helpEl = bg;
    return bg;
  }
  showHelp(v: boolean) { this.helpEl.classList.toggle('show', v); }

  setDirectUnread(count: number) {
    this.directUnread = Math.max(0, Math.floor(count) || 0);
    const button = this.root.querySelector<HTMLButtonElement>('[data-view=chat]');
    if (!button) return;
    let badge = button.querySelector<HTMLElement>('.badge');
    if (this.directUnread <= 0) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge';
      button.append(badge);
    }
    badge.textContent = String(this.directUnread);
  }

  bumpDirectUnread(by = 1) {
    this.setDirectUnread(this.directUnread + by);
  }

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
      this.toast(t('office.demoNoMessage'));
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
    this.lastRoom = name;
    this.lastKind = kind;
    this.roomEl.className = 'overlay room-badge' + (kind === 'meeting' || kind === 'private' ? ' meeting' : '');
    const label = name ? t('office.inRoom', { name: knownPhrase(name) }) : t('office.common');
    this.roomEl.innerHTML = `<span class="dot"></span>${label}`;
  }

  private renderProximity() {
    const peers = this.game.peers;
    this.proxEl.classList.toggle('hidden', peers.length === 0);
    if (!peers.length) return;
    const byId = new Map(this.game.allAvatars().map((a) => [a.id, a]));
    this.proxEl.innerHTML = `
      <div class="ttl">${ICONS.volume}${t('office.nearTalk')}</div>
      <div class="names">${peers.map((p) => p.name.split(' ')[0]).join(', ')}</div>
      ${peers.map((p) => `<div class="peer" data-id="${p.id}"><img src="${this.portrait(byId.get(p.id)!)}"><span style="width:62px">${p.name.split(' ')[0]}</span><span class="bar"><i style="width:${Math.round(p.volume * 100)}%"></i></span></div>`).join('')}
      <div class="hint">${this.game.peers.some((p) => !this.game.remotes.has(p.id)) && !this.game.peers.some((p) => this.game.remotes.has(p.id)) ? t('office.demoAudio') : knownPhrase(this.media.notice)}</div>`;
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
    const npcs = g.allAvatars().filter((a) => a !== g.player && !a.ghost && (!this.filter || a.name.toLowerCase().includes(this.filter)));
    const ghosts = g.allAvatars().filter((a) => a.ghost && (!this.filter || a.name.toLowerCase().includes(this.filter)));
    const inMeeting = npcs.filter((a) => a.status === 'en_reunion');
    const nearList = npcs.filter((a) => near.has(a.id));
    const online = npcs.filter((a) => a.status !== 'en_reunion' && !near.has(a.id));
    const present = new Set(g.allAvatars().map((a) => a.id));
    const offline = this.hooks.directory.filter((o) => !present.has(o.id) && (!this.filter || o.name.toLowerCase().includes(this.filter)));

    const row = (a: Avatar) => {
      const away = a.ghost;
      const label = away ? statusText('desconectado') : `${STATUSES[a.status].emoji} ${statusText(a.status)}`;
      const color = away ? '#6B7280' : STATUSES[a.status].color;
      return `
      <div class="member${away ? ' offline' : ''}" data-id="${a.id}" title="${t('office.focusHint', { name: a.name.split(' ')[0] })}">
        <div class="pic"><img src="${this.portrait(a)}"><span class="dot" style="background:${color}"></span></div>
        <div class="body">
          <div class="nm">${a.name}${a.isNew ? `<span class="new">${t('office.new')}</span>` : ''}</div>
          <div class="meta"><span class="role ${roleClass(a.role)}">${roleName(a.role)}</span><span>${label}</span></div>
        </div>
        <button class="go" data-msg="${a.id}">${t('office.message')}</button>
        <button class="go" data-go="${a.id}">${t('office.go')}</button>
      </div>`;
    };
    const offlineCard = (o: { id: string; name: string; role: string; photoUrl?: string | null }) => `
      <div class="member offline" data-id="${o.id}"><div class="pic">${o.photoUrl ? `<img src="${o.photoUrl}" alt="">` : `<div class="ph">${o.name.split(' ').map((w) => w[0]).join('')}</div>`}<span class="dot" style="background:#555"></span></div>
      <div class="body"><div class="nm">${o.name}</div><div class="meta"><span class="role ${roleClass(o.role)}">${roleName(o.role)}</span><span>${statusText('desconectado')}</span></div></div>
      <button class="go" data-msg="${o.id}">${t('office.message')}</button></div>`;
    const section = (title: string, items: string[]) => items.length ? `<div class="section-title">${title} <span class="count">(${items.length})</span></div>${items.join('')}` : '';

    let html = '';
    if (nearList.length) {
      html += `<div class="section-title">${t('office.nearTalk')}</div><div class="conv"><div class="who">${nearList.map((a) => a.name.split(' ')[0]).join(', ')}</div><div class="sub">${t('office.nearSub')}</div></div>`;
      html += section(t('office.nearYou'), nearList.map(row));
    }
    html += section(t('office.inMeeting'), inMeeting.filter((a) => !near.has(a.id)).map(row));
    html += section(t('office.inOffice'), online.map(row));
    html += `<div class="section-title">${t('office.rooms')}</div>
      <div class="room-row">${g.world.isPrivateLocked() ? ICONS.lock : ICONS.unlock}<span class="rn">${t('office.private')}</span><button class="switch ${g.world.isPrivateLocked() ? '' : 'on'}" data-act="lock" title="${t('office.lockTitle')}"></button></div>`;
    html += `<div class="room-row"><span class="rn">${t('office.demoMates')}</span><button class="switch ${g.demoOn ? 'on' : ''}" data-act="demo" title="${t('office.demoTitle')}"></button></div>`;
    html += section(t('office.offline'), [...ghosts.map(row), ...offline.map(offlineCard)]);

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
