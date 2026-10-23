/**
 * Game: orquesta mundo, entidades, cámara, render dinámico, proximidad y red.
 * La UI (HTML) se comunica con el juego solo mediante métodos públicos y eventos.
 */
import { PROXIMITY_RADIUS, TILE, BRAND } from '../config';
import { SAMPLE_MEMBERS, SAMPLE_PLAYER } from '../data/sampleData';
import { honk } from '../audio/horn';
import type { ProximityMediaProvider, PeerAudio } from '../media/proximityMedia';
import type { PresenceTransport } from '../net/transport';
import { drawAvatar, drawBubble, drawCar, drawNameTag } from './avatarRenderer';
import { Camera } from './camera';
import { circle, fillRR, text, type Ctx } from './draw';
import { Avatar } from './entities';
import { Input, isTextField } from './input';
import { t } from '../i18n';
import { MapRenderer } from './mapRenderer';
import { Npc, SeatPool } from './npc';
import type { AvatarLook, AvatarState, MapDefinition, RoomDef, StatusId } from './types';
import { SAMPLE_RANKINGS } from '../data/sampleData';
import { emoteMs, highFivePartner, isHighFive } from './crowd/emotes';
import { withSpot } from './crowd/look';
import { TaskState, type GoalNote, type TaskNote } from './crowd/taskState';
import { localCrowd } from './crowd/load';
import { Stage3D } from './stage3d';
import { World, type Seat } from './world';

export interface GameEvents {
  proximity: { peers: PeerAudio[] };
  room: { room: RoomDef | null };
  car: { on: boolean };
  lock: { locked: boolean };
  follow: { id: string | null; name?: string };
  toast: { text: string };
  dm: { id: string; name: string };
  emote: { emote: string };
  bubble: { text: string };
  openBoard: { taskId?: string; areaId?: string | null };
}
type Listener<K extends keyof GameEvents> = (e: GameEvents[K]) => void;

export interface PlayerSeed { id: string; name: string; role: string; look: AvatarLook }

export interface GameOptions {
  transport: PresenceTransport;
  media: ProximityMediaProvider;
  emblem?: HTMLImageElement;
  player?: PlayerSeed;
  demoNpcs?: boolean;
  rankings?: typeof SAMPLE_RANKINGS;
  deskId?: string | null;
}

export class Game {
  readonly world: World;
  readonly camera: Camera;
  readonly player: Avatar;
  readonly npcs: Npc[] = [];
  readonly remotes = new Map<string, { avatar: Avatar; target: AvatarState; fromX: number; fromY: number; toX: number; toY: number; t0: number; dur: number }>();
  private readonly colleagues = new Map<string, Avatar>();
  private crowd: Avatar[] = [];
  private roster: { id: string; name: string; role: string; deskId?: string | null; look: AvatarLook }[] = [];
  readonly mapRenderer: MapRenderer;
  private ctx: Ctx;
  private input = new Input();
  private listeners: { [K in keyof GameEvents]?: Listener<K>[] } = {};
  private last = performance.now();
  private t = 0;
  private dpr = 1;
  private followId: string | null = null;
  private clickMarker: { x: number; y: number; until: number } | null = null;
  private honkUntil = 0;
  private currentRoomId: string | null | undefined = undefined;
  private peersKey = '';
  private sendAcc = 0;
  private relayAt = { emote: 0, bubble: 0 };
  private tasks = new TaskState();
  private flights: { from: string; to: string; t0: number }[] = [];
  private areaLinks: { roomId: string; areaId: string | null }[] = [];
  private running = true;
  private faces = new Map<string, HTMLImageElement>();
  private stage: Stage3D | null = null;
  peers: PeerAudio[] = [];
  demoOn = false;

  constructor(private canvas: HTMLCanvasElement, map: MapDefinition, private opts: GameOptions) {
    this.ctx = canvas.getContext('2d')!;
    this.world = new World(map);
    this.camera = new Camera(map.width * TILE, map.height * TILE);
    const player = opts.player ?? { id: SAMPLE_PLAYER.id, name: SAMPLE_PLAYER.name, role: SAMPLE_PLAYER.role, look: SAMPLE_PLAYER.look };
    const spawn = this.spawnFor(map, player.id, opts.deskId);
    this.player = new Avatar(player.id, player.name, player.role, player.look, spawn.x, spawn.y);
    this.player.dir = 'up';
    if (opts.deskId && this.world.seats.get(opts.deskId)) this.player.sitAt(this.world.seats.get(opts.deskId)!);
    this.mapRenderer = new MapRenderer(this.world);
    if (opts.emblem) this.mapRenderer.setEmblem(opts.emblem);
    if (opts.rankings) this.mapRenderer.setRankings(opts.rankings);
    this.mapRenderer.render();
    if (opts.demoNpcs) this.setDemoMode(true);

    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    this.camera.follow(this.player.x, this.player.y, 0, true);

    // Red + media (hoy: local / simulado)
    void opts.transport.connect(this.player.toState());
    opts.transport.onRemoteState((s) => this.onRemoteState(s));
    opts.transport.onRemoteLeave((id) => { this.remotes.delete(id); this.syncColleagues(); });
    void opts.media.connect(this.player.id);
  }

  // ───────────── eventos ─────────────
  on<K extends keyof GameEvents>(ev: K, fn: Listener<K>) {
    ((this.listeners[ev] ??= []) as Listener<K>[]).push(fn);
  }
  private emit<K extends keyof GameEvents>(ev: K, e: GameEvents[K]) {
    (this.listeners[ev] as Listener<K>[] | undefined)?.forEach((f) => f(e));
  }

  // ───────────── API pública para la UI ─────────────
  refreshLabels() {
    this.canvas.setAttribute('aria-label', t('office.aria'));
  }

  watchParent() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    new ResizeObserver(() => this.resize()).observe(parent);
    this.resize();
  }

  start() {
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', t('office.aria'));
    if (this.canvas.parentElement) new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);
    this.resize();
    // Zoom inicial según tamaño de pantalla (móvil más alejado para ver más oficina).
    this.camera.setZoom(Math.min(window.innerWidth, window.innerHeight) < 560 ? 0.72 : 0.85);
    this.camera.follow(this.player.x, this.player.y - 10, 0, true);
    this.focusKeyboard();
    requestAnimationFrame(this.loop);
  }

  /** 3D después de pintar la interfaz. Si WebGL no responde, se queda el plano 2D. */
  async mount3d() {
    this.stage = await Stage3D.mount(this.canvas, this.world);
    this.stage?.setAreas(this.areaLinks);
  }

  setAreas(links: { roomId: string; areaId: string | null }[]) {
    this.areaLinks = links;
    this.stage?.setAreas(links);
  }

  applyTask(note: TaskNote) { this.tasks.applyTask(note); }

  applyGoal(note: GoalNote) { this.tasks.applyGoal(note); }

  applyHandoff(payload: { fromMembershipId?: string | null; toMembershipId?: string | null }) {
    const from = payload?.fromMembershipId || '';
    const to = payload?.toMembershipId || '';
    if (!from || !to || from === to) return;
    this.flights.push({ from, to, t0: performance.now() });
    if (this.flights.length > 6) this.flights.shift();
  }

  /** El lienzo recibe WASD aunque antes hubiera un input del panel. */
  setPlazaLogo(image: HTMLImageElement | null) {
    this.stage?.setPlazaLogo(image);
  }

  focusKeyboard() {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== this.canvas && (isTextField(active) || active.closest('#pages'))) active.blur();
    this.canvas.focus({ preventScroll: true });
  }

  /** Para comprobar en capturas que se está usando la escena 3D y no el plano 2D. */
  debugView() {
    const stats = this.stage?.stats();
    return {
      mode: this.stage?.ok ? '3d' as const : '2d' as const,
      characterPx: this.stage?.characterPx ?? 0,
      zoom: this.camera.zoom,
      calls: stats?.calls ?? 0,
      triangles: stats?.triangles ?? 0,
      full: stats?.full ?? 0,
      mid: stats?.mid ?? 0,
      ghosts: stats?.ghosts ?? 0,
      billboards: stats?.billboards ?? 0,
      shadows: Boolean(stats?.shadows),
    };
  }

  allAvatars(): Avatar[] {
    return [this.player, ...this.npcs.map((n) => n.avatar), ...[...this.remotes.values()].map((r) => r.avatar), ...this.colleagues.values(), ...this.crowd];
  }

  /** Modo carga: N compañeros falsos en la plaza, solo en este navegador. */
  spawnCrowd(count: number) {
    const safe = Math.max(1, Math.min(400, Math.floor(count)));
    const columns = Math.ceil(Math.sqrt(safe));
    const gap = 40;
    const originX = this.world.def.plaza.cx * TILE - ((columns - 1) * gap) / 2;
    const originY = this.world.def.plaza.cy * TILE - ((columns - 1) * gap) / 2;
    this.crowd = localCrowd(safe, originX, originY);
    if (!this.areaLinks.length) this.setAreas(this.world.def.rooms.map((room) => ({ roomId: room.id, areaId: room.id })));
    const areaId = this.areaLinks.find((link) => link.areaId)?.areaId || '';
    const started = new Date(Date.now() - 75000).toISOString();
    if (areaId) {
      this.applyTask({ taskId: 'carga-carta', title: 'Cerrar la ronda de oro', status: 'en_curso', areaId, assigneeId: this.player.id, parentId: null, dueDate: '2020-01-01', updatedAt: started });
      this.applyTask({ taskId: 'carga-paso-1', title: 'Llamar', status: 'hecho', areaId, assigneeId: this.player.id, parentId: 'carga-carta', dueDate: null, updatedAt: started });
      this.applyTask({ taskId: 'carga-paso-2', title: 'Apuntar', status: 'pendiente', areaId, assigneeId: this.player.id, parentId: 'carga-carta', dueDate: null, updatedAt: started });
      this.applyTask({ taskId: 'carga-cola', title: 'Preparar el café', status: 'pendiente', areaId, assigneeId: null, parentId: null, dueDate: null, updatedAt: started });
      this.applyTask({ taskId: 'carga-hecha', title: 'Archivar', status: 'hecho', areaId, assigneeId: null, parentId: null, dueDate: null, updatedAt: started });
      this.applyGoal({ goalId: 'carga-mision', areaId, pct: 60 });
    }
    this.emit('toast', { text: t('office.loadCrowd', { n: this.crowd.length }) });
  }

  clearCrowd() {
    this.crowd = [];
  }

  /** Personas de la empresa que aún no han entrado: sentadas en su puesto, atenuadas. */
  setColleagues(list: { id: string; name: string; role: string; deskId?: string | null; look: AvatarLook }[]) {
    this.roster = list;
    this.syncColleagues();
  }

  private syncColleagues() {
    const keep = new Set<string>();
    for (const person of this.roster) {
      if (!person.id || person.id === this.player.id || this.remotes.has(person.id)) continue;
      const seat = person.deskId ? this.world.seats.get(person.deskId) : undefined;
      if (!seat) continue;
      keep.add(person.id);
      let avatar = this.colleagues.get(person.id);
      if (!avatar) {
        avatar = new Avatar(person.id, person.name, person.role, person.look, seat.x, seat.y);
        avatar.ghost = true;
        avatar.sitAt(seat);
        this.colleagues.set(person.id, avatar);
      } else {
        avatar.name = person.name;
        avatar.role = person.role;
        avatar.look = person.look;
        avatar.ghost = true;
        if (!avatar.sitting) avatar.sitAt(seat);
      }
    }
    for (const id of this.colleagues.keys()) {
      if (!keep.has(id)) this.colleagues.delete(id);
    }
  }

  setPlayerStatus(s: StatusId) { this.player.status = s; }

  toggleCar(on = this.player.mode !== 'car') {
    this.player.mode = on ? 'car' : 'walk';
    if (on && !this.world.canStand(this.player.x, this.player.y, 12)) { /* sigue igual: se ajusta al moverse */ }
    this.emit('car', { on });
    this.emit('toast', { text: on ? t('office.carOn', { hint: matchMedia('(pointer: coarse)').matches ? t('office.carHintTouch') : t('office.carHintKey') }) : t('office.carOff') });
  }

  honk() {
    if (this.player.mode !== 'car') { this.emit('toast', { text: t('office.honkNeedCar') }); return; }
    honk();
    this.honkUntil = performance.now() + 600;
    this.player.say('¡Piii piii! 📯', 1200);
    // Los compañeros cercanos reaccionan
    for (const n of this.npcs) if (dist(n.avatar, this.player) < PROXIMITY_RADIUS * 1.6) n.avatar.say(['😂', '😮', '¡Cuidado!', '🙉'][Math.floor(Math.random() * 4)], 1500);
  }

  setPrivateLocked(locked: boolean, announce = true) {
    this.world.setPrivateLocked(locked);
    this.emit('lock', { locked });
    if (announce) this.emit('toast', { text: locked ? t('office.doorClosed') : t('office.doorOpen') });
  }

  focusMember(id: string) {
    if (id === this.player.id) { this.followId = null; this.emit('follow', { id: null }); return; }
    const a = this.allAvatars().find((x) => x.id === id);
    if (!a) return;
    this.followId = id;
    this.emit('follow', { id, name: a.name });
  }

  stopFollow() { if (this.followId) { this.followId = null; this.emit('follow', { id: null }); } }

  /** Ir andando hasta un compañero. */
  walkTo(id: string) {
    const a = this.allAvatars().find((x) => x.id === id);
    if (!a) return;
    this.stopFollow();
    this.moveTo(a.x, a.y + TILE);
  }

  moveTo(wx: number, wy: number) {
    if (this.player.goTo(this.world, wx, wy)) this.clickMarker = { x: wx, y: wy, until: performance.now() + 900 };
    else this.emit('toast', { text: t('office.cantReach') });
  }

  react(emoji: string) { this.gesture(emoji); }

  /** Gesto local y, si el servidor acepta el ritmo, relé a la sala. */
  gesture(emote: string) {
    if (isHighFive(emote)) {
      this.highFive();
      return;
    }
    this.spark(this.player, emote);
    this.sendRelay('emote', emote);
  }

  highFive() {
    const partner = highFivePartner(this.player, this.allAvatars());
    if (!partner) {
      this.emit('toast', { text: t('office.highFiveNone') });
      return;
    }
    this.spark(this.player, '🙌');
    this.spark(partner, '🙌');
    this.sendRelay('emote', '🙌');
  }

  /** Un compañero (u otra pestaña) lanzó el gesto. El eco propio se ignora. */
  receiveEmote(membershipId: string, emote: string) {
    if (!membershipId || membershipId === this.player.id || !emote) return;
    const actor = this.allAvatars().find((avatar) => avatar.id === membershipId);
    if (!actor) return;
    this.spark(actor, emote);
    if (!isHighFive(emote)) return;
    const partner = highFivePartner(actor, this.allAvatars());
    if (partner) this.spark(partner, emote);
  }

  /** Bocadillo de charla de área o de `office:bubble`, unos 4 segundos. */
  receiveBubble(membershipId: string, text: string) {
    const actor = this.allAvatars().find((avatar) => avatar.id === membershipId);
    if (!actor) return;
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!clean) return;
    actor.say(clean, 4000);
  }

  sayLine(text: string) {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!clean) return;
    this.player.say(clean, 4000);
    this.sendRelay('bubble', clean);
  }

  zoomBy(f: number) { this.camera.setZoom(this.camera.zoom * f); }

  /** Utilidad para depurar / capturas: teletransporta al jugador (en tiles). */
  teleport(tx: number, ty: number) {
    this.player.x = (tx + 0.5) * TILE; this.player.y = (ty + 0.5) * TILE + 6; this.player.path = [];
    this.camera.follow(this.player.x, this.player.y, 0, true);
  }

  // ───────────── entrada ─────────────
  private bindInput() {
    this.input.on('h', () => this.honk());
    this.input.on('c', () => this.toggleCar());
    this.input.on('e', () => this.tryToggleDoor());
    this.input.on('f', () => this.sitTogether());
    this.input.on('escape', () => this.stopFollow());
    this.input.on('+', () => this.zoomBy(1.15));
    this.input.on('-', () => this.zoomBy(1 / 1.15));
    this.bindPointer();
  }

  /** Ratón y táctil: toque/clic = ir hasta ahí; dos dedos = pellizco para zoom. */
  private bindPointer() {
    const c = this.canvas;
    const pts = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
    let pinch: { d: number; z: number } | null = null;
    let moved = false;
    c.addEventListener('pointerdown', (e) => {
      this.focusKeyboard();
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      moved = false;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.camera.zoom };
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 10) moved = true;
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        this.camera.setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.d)));
      }
    });
    const up = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2 && pinch) { pinch = null; moved = true; return; }
      if (!p || moved || pinch || performance.now() - p.t > 600 || e.type === 'pointercancel') return;
      this.tapAt(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
  }

  private tapAt(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    const picked = this.stage?.ok ? this.stage.pick(clientX, clientY, r) : null;
    if (picked?.taskId) {
      this.emit('openBoard', { taskId: picked.taskId });
      return;
    }
    if (picked?.board) {
      this.emit('openBoard', { areaId: picked.areaId });
      return;
    }
    const p = picked ?? this.camera.screenToWorld(clientX - r.left, clientY - r.top);
    if (!this.stage?.ok) {
      const today = new Date().toISOString().slice(0, 10);
      const duty = this.allAvatars().find((avatar) => {
        if (!this.tasks.duty(avatar.id, performance.now(), today)) return false;
        return Math.abs(avatar.x - p.x) < 36 && p.y < avatar.y - 28 && p.y > avatar.y - 78;
      });
      const card = duty ? this.tasks.duty(duty.id, performance.now(), today) : null;
      if (card) {
        this.emit('openBoard', { taskId: card.taskId });
        return;
      }
    }
    const hit = picked?.avatarId
      ? this.allAvatars().find((a) => a.id === picked.avatarId && a !== this.player)
      : this.stage?.ok
        ? undefined
        : this.allAvatars().find((a) => a !== this.player && Math.abs(a.x - p.x) < 18 && p.y < a.y + 8 && p.y > a.y - 52);
    if (hit) {
      if (this.remotes.has(hit.id)) this.emit('dm', { id: hit.id, name: hit.name });
      else this.emit('toast', { text: t('office.demoNoMessage') });
      return;
    }
    this.stopFollow();
    this.moveTo(p.x, p.y);
  }

  setVirtualAxis(x: number, y: number) { this.input.virtual = { x, y }; }

  private tryToggleDoor() {
    for (const { door } of this.world.lockedDoors) {
      const dx = (door.x + 0.5) * TILE - this.player.x, dy = (door.y + (door.h ?? 1) / 2) * TILE - this.player.y;
      if (Math.hypot(dx, dy) < TILE * 2.5) { this.setPrivateLocked(!this.world.isPrivateLocked()); return; }
    }
    this.emit('toast', { text: t('office.doorHint') });
  }

  private resize() {
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.camera.resize(rect.width, rect.height);
    this.camera.clamp();
  }

  // ───────────── bucle ─────────────
  stop() {
    this.running = false;
    this.stage?.dispose();
    this.stage = null;
    this.opts.transport.disconnect();
    this.opts.media.disconnect();
  }

  setDemoMode(on: boolean) {
    this.demoOn = on;
    this.npcs.length = 0;
    if (on) {
      const pool = new SeatPool(this.world);
      const now = performance.now();
      for (const seed of SAMPLE_MEMBERS) this.npcs.push(new Npc(this.world, pool, seed, now));
    }
  }

  private spawnFor(map: MapDefinition, id: string, deskId?: string | null) {
    if (deskId && this.world.seats.get(deskId)) {
      const seat = this.world.seats.get(deskId)!;
      return { x: seat.x, y: seat.y };
    }
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const offset = ((hash % 7) - 3) * 18;
    return { x: (map.spawn.x + 0.5) * TILE + offset, y: (map.spawn.y + 0.5) * TILE + 6 };
  }

  private faceOf(look: AvatarLook) {
    if (!look.usePhoto) return undefined;
    const url = look.photoUrl;
    if (!url) return undefined;
    let image = this.faces.get(url);
    if (!image) {
      image = new Image();
      image.src = url;
      this.faces.set(url, image);
    }
    return image.complete && image.naturalWidth ? image : undefined;
  }

  private loop = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.update(dt, now);
    this.render(now);
    requestAnimationFrame(this.loop);
  };

  private update(dt: number, now: number) {
    this.updatePlayer(dt);
    for (const n of this.npcs) n.update(dt, now);
    for (const r of this.remotes.values()) {
      const a = r.avatar;
      const s = r.target;
      const u = r.dur <= 0 ? 1 : Math.min(1, (now - r.t0) / r.dur);
      const ease = u * u * (3 - 2 * u);
      a.x = r.fromX + (r.toX - r.fromX) * ease;
      a.y = r.fromY + (r.toY - r.fromY) * ease;
      a.dir = s.dir;
      a.moving = s.moving || u < 0.98;
      a.status = s.status;
      a.mode = s.mode;
      a.sitting = !!s.sitting;
      a.name = s.name;
      a.role = s.role;
      a.look = withSpot(s.look, (s as { photoPlacement?: unknown }).photoPlacement);
      a.glide(dt, a.moving);
    }
    const target = this.followId ? this.allAvatars().find((a) => a.id === this.followId) ?? this.player : this.player;
    const ahead = target.moving ? 26 : 0;
    const lookX = target.dir === 'left' ? -ahead : target.dir === 'right' ? ahead : 0;
    const lookY = target.dir === 'up' ? -ahead : target.dir === 'down' ? ahead * 0.4 : 0;
    this.camera.follow(target.x + lookX, target.y - 12 + lookY, dt);
    this.expireCues(now);
    this.updateProximity();
    this.updateRoom();
    // red: ~10 Hz
    this.sendAcc += dt;
    if (this.sendAcc > 0.1) { this.sendAcc = 0; this.opts.transport.sendState(this.player.toState()); }
  }

  private dutySpots(now: number) {
    const today = new Date().toISOString().slice(0, 10);
    const cards = [];
    for (const avatar of this.allAvatars()) {
      const duty = this.tasks.duty(avatar.id, now, today);
      if (!duty) continue;
      cards.push({ ...duty, x: avatar.x, y: avatar.sitting || avatar.ghost ? 96 : 112, z: avatar.y });
    }
    return cards;
  }

  private packageSpots(now: number) {
    this.flights = this.flights.filter((flight) => now - flight.t0 < 980);
    const spots = [];
    for (const flight of this.flights) {
      const from = this.allAvatars().find((avatar) => avatar.id === flight.from);
      const to = this.allAvatars().find((avatar) => avatar.id === flight.to);
      if (!from || !to) continue;
      const u = Math.min(1, (now - flight.t0) / 900);
      spots.push({
        x: from.x + (to.x - from.x) * u,
        y: 46 + Math.sin(u * Math.PI) * 40,
        z: from.y + (to.y - from.y) * u,
      });
    }
    return spots.slice(0, 3);
  }

  private areaViews() {
    const seen = new Set<string>();
    const areas = [];
    for (const link of this.areaLinks) {
      if (!link.areaId || seen.has(link.areaId)) continue;
      seen.add(link.areaId);
      areas.push({ areaId: link.areaId, tally: this.tasks.tally(link.areaId) });
    }
    return areas;
  }

  private expireCues(now: number) {
    for (const avatar of this.allAvatars()) {
      if (avatar.bubble && now > avatar.bubble.until) avatar.bubble = null;
      if (avatar.emote && now > avatar.emote.until) avatar.emote = null;
    }
  }

  private spark(avatar: Avatar, emote: string) {
    const ms = emoteMs(emote);
    avatar.emote = { id: emote, until: performance.now() + ms };
    if (!this.stage?.ok) avatar.say(emote, ms);
  }

  private sendRelay(kind: 'emote' | 'bubble', value: string) {
    const now = performance.now();
    if (now - this.relayAt[kind] < 1000) return;
    this.relayAt[kind] = now;
    if (kind === 'emote') this.emit('emote', { emote: value });
    else this.emit('bubble', { text: value });
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    const ax = this.input.axis();
    const rad = p.mode === 'car' ? 12 : 9;
    if (ax.x || ax.y) {
      p.path = [];
      p.sitting = false;
      this.stopFollow();
      p.glide(dt, true);
      const len = Math.hypot(ax.x, ax.y);
      const mag = Math.min(1, len);
      const pace = Math.max(0.2, p.pace);
      const vx = (ax.x / len) * p.speed * mag * pace * dt;
      const vy = (ax.y / len) * p.speed * mag * pace * dt;
      p.faceTowards(ax.x, ax.y);
      const stuck = !this.world.canStand(p.x, p.y, rad);
      if (stuck || this.world.canStand(p.x + vx, p.y, rad)) p.x += vx;
      if (stuck || this.world.canStand(p.x, p.y + vy, rad)) p.y += vy;
      p.moving = true;
    } else if (p.path.length) {
      p.glide(dt, true);
      p.followPath(dt);
    } else {
      p.glide(dt, false);
      p.moving = false;
    }
  }

  /** Siéntate en una silla libre de la sala de reuniones. El audio ya se queda dentro. */
  private sitTogether() {
    const room = this.world.roomAt(this.player.x, this.player.y);
    if (!room || room.kind !== 'meeting') {
      this.emit('toast', { text: t('planning.sitNeedRoom') });
      return;
    }
    if (this.player.sitting) {
      this.player.sitting = false;
      this.player.status = 'en_linea';
      this.emit('toast', { text: t('planning.stoodUp') });
      return;
    }
    let best: Seat | null = null;
    let bestD = Infinity;
    for (const seat of this.world.seats.values()) {
      if (this.world.roomAt(seat.x, seat.y)?.id !== room.id) continue;
      const taken = this.allAvatars().some((avatar) => avatar !== this.player && avatar.sitting && Math.hypot(avatar.x - seat.x, avatar.y - seat.y) < 28);
      if (taken) continue;
      const distance = Math.hypot(seat.x - this.player.x, seat.y - this.player.y);
      if (distance < bestD) { bestD = distance; best = seat; }
    }
    if (!best) {
      this.emit('toast', { text: t('planning.sitFull') });
      return;
    }
    this.player.sitAt(best);
    this.player.status = 'en_reunion';
    this.emit('toast', { text: t('planning.satDown') });
  }

  private updateProximity() {
    const me = this.player;
    const myRoom = this.world.roomAt(me.x, me.y);
    const enclosed = myRoom && myRoom.walls && (myRoom.kind === 'meeting' || myRoom.kind === 'private');
    const peers: PeerAudio[] = [];
    for (const a of this.allAvatars()) {
      if (a === me || a.status === 'ausente' || a.ghost || a.crowd) continue;
      const d = dist(a, me);
      const room = this.world.roomAt(a.x, a.y);
      if (enclosed) {
        // En salas cerradas todos los presentes están en la misma conversación.
        if (room?.id === myRoom!.id) peers.push({ id: a.id, name: a.name, volume: 1 });
      } else if (d < PROXIMITY_RADIUS && (room?.walls ?? false) === (myRoom?.walls ?? false) && (!room?.walls || room.id === myRoom?.id)) {
        peers.push({ id: a.id, name: a.name, volume: +(1 - d / PROXIMITY_RADIUS).toFixed(2) });
      }
    }
    this.peers = peers;
    this.opts.media.updatePeers(peers.filter((peer) => this.remotes.has(peer.id)));
    const key = peers.map((p) => p.id).join(',');
    if (key !== this.peersKey) { this.peersKey = key; this.emit('proximity', { peers }); }
  }

  private updateRoom() {
    const r = this.world.roomAt(this.player.x, this.player.y);
    const id = r?.id ?? null;
    if (id !== this.currentRoomId) { this.currentRoomId = id; this.emit('room', { room: r }); }
  }

  private onRemoteState(s: AvatarState) {
    this.colleagues.delete(s.id);
    const now = performance.now();
    const r = this.remotes.get(s.id);
    if (r) {
      const gap = Math.hypot(s.x - r.avatar.x, s.y - r.avatar.y);
      r.fromX = r.avatar.x;
      r.fromY = r.avatar.y;
      r.toX = s.x;
      r.toY = s.y;
      r.t0 = now;
      r.dur = gap > 240 ? 0 : 150;
      r.target = s;
    } else {
      const avatar = Object.assign(new Avatar(s.id, s.name, s.role, withSpot(s.look, (s as { photoPlacement?: unknown }).photoPlacement), s.x, s.y), { status: s.status, sitting: !!s.sitting });
      this.remotes.set(s.id, { avatar, target: s, fromX: s.x, fromY: s.y, toX: s.x, toY: s.y, t0: now, dur: 0 });
    }
  }

  // ───────────── render ─────────────
  private loggedRender = false;

  private render(now: number) {
    const app = this.canvas.closest('#app') as HTMLElement | null;
    if (app?.hasAttribute('hidden')) return;
    if (this.camera.viewW < 2 || this.camera.viewH < 2) return;
    try {
      if (this.stage?.ok) {
        this.stage.render(this.allAvatars(), this.camera, this.dpr, this.t, (look) => this.faceOf(look), {
          selfId: this.player.id,
          selfLabel: t('office.you'),
          path: this.player.path,
          marker: this.clickMarker && now < this.clickMarker.until ? { x: this.clickMarker.x, y: this.clickMarker.y } : null,
          proximity: this.peers.length > 0,
          duties: this.dutySpots(now),
          packages: this.packageSpots(now),
          areas: this.areaViews(),
          boardWords: {
            pending: t('office.boardPending'),
            doing: t('office.boardDoing'),
            done: t('office.boardDone'),
            mission: t('office.boardMission'),
          },
        });
        return;
      }
      this.draw2d(now);
    } catch (error) {
      if (!this.loggedRender) {
        console.error(error);
        this.loggedRender = true;
      }
    }
  }

  private draw2d(now: number) {
    const ctx = this.ctx, cam = this.camera, z = cam.zoom * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#74C254';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(z, 0, 0, z, -cam.left * z, -cam.top * z);
    ctx.imageSmoothingEnabled = true;

    // Capa estática (solo la porción visible)
    const s = this.mapRenderer.scale;
    const vw = cam.viewW / cam.zoom, vh = cam.viewH / cam.zoom;
    const sx = Math.max(0, cam.left), sy = Math.max(0, cam.top);
    const sw = Math.min(vw, this.world.w * TILE - sx), sh = Math.min(vh, this.world.h * TILE - sy);
    ctx.drawImage(this.mapRenderer.canvas, sx * s, sy * s, sw * s, sh * s, sx, sy, sw, sh);

    this.drawDynamicMap(ctx, now);
    this.drawProximity(ctx);

    if (this.clickMarker && now < this.clickMarker.until) {
      const k = (this.clickMarker.until - now) / 900;
      ctx.save();
      ctx.globalAlpha = k;
      circle(ctx, this.clickMarker.x, this.clickMarker.y, 10 * (1.4 - k * 0.4), 'rgba(245,197,24,0.15)', BRAND.goldDeep, 2);
      ctx.restore();
    }
    // Ruta del jugador
    if (this.player.path.length) {
      ctx.fillStyle = 'rgba(224,168,0,0.8)';
      this.player.path.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y - 4, 2.6, 0, Math.PI * 2); ctx.fill(); });
      const end = this.player.path[this.player.path.length - 1];
      const pulse = 1 + Math.sin(now / 150) * 0.12;
      circle(ctx, end.x, end.y - 4, 9 * pulse, 'rgba(245,197,24,0.2)', BRAND.goldDeep, 2);
    }

    // Avatares ordenados por Y
    const avatars = this.allAvatars().sort((a, b) => a.y - b.y);
    const stageOn = Boolean(this.stage?.ok);
    for (const a of avatars) {
      if (a.mode === 'car') drawCar(ctx, a.x, a.y, a.carAngle, this.t, a === this.player && now < this.honkUntil);
      else if (!stageOn) drawAvatar(ctx, a.x, a.y, { look: a.look, dir: a.dir, moving: a.moving, sitting: a.sitting, t: this.t + a.x * 0.01, dim: a.status === 'ausente' || a.ghost, face: this.faceOf(a.look) });
    }
    const labels = avatars.map((a) => {
      const name = a === this.player ? `${a.name.split(' ')[0]} ${t('office.you')}` : a.name.split(' ')[0];
      return { a, name, x: a.x, y: a.y + (a.mode === 'car' ? 12 : 4), w: name.length * 6.4 + 22 };
    });
    labels.sort((a, b) => a.y - b.y || a.x - b.x);
    const placed: { x: number; y: number; w: number }[] = [];
    for (const label of labels) {
      let y = label.y;
      for (let n = 0; n < 6; n++) {
        const hit = placed.find((p) => Math.abs(p.x - label.x) < (p.w + label.w) / 2 && Math.abs(p.y - y) < 16);
        if (!hit) break;
        y = hit.y + 16;
      }
      placed.push({ x: label.x, y, w: label.w });
      drawNameTag(ctx, label.x, y, label.name, label.a.status, label.a === this.player, label.a.ghost ? '#6B7280' : undefined);
      const a = label.a;
      if (a.status === 'en_llamada' && a !== this.player) drawStatusIcon(ctx, a.x + 14, a.y - 52, '📞');
      if (a.bubble) {
        if (now > a.bubble.until) a.bubble = null;
        else drawBubble(ctx, a.x, a.y - (a.mode === 'car' ? 34 : 56), a.bubble.text, Math.min(1, (a.bubble.until - now) / 300));
      }
      const duty = this.tasks.duty(a.id, now, new Date().toISOString().slice(0, 10));
      if (duty) {
        fillRR(ctx, a.x - 28, a.y - 74, 56, 16, 5, duty.overdue ? '#3A1420' : '#141418', duty.overdue ? '#FF4D6A' : '#F5C518', 1.5);
        text(ctx, `${duty.title.slice(0, 12)} ${duty.time}`, a.x, a.y - 66, 7, duty.overdue ? '#FFD0D8' : '#FFF8E8', 700);
      }
    }
    for (const spot of this.packageSpots(now)) {
      fillRR(ctx, spot.x - 7, spot.z - 6, 14, 10, 2, '#F5C518', '#C4920A', 1);
    }
  }

  private drawDynamicMap(ctx: Ctx, now: number) {
    // Pulso de la plaza
    const p = this.world.def.plaza;
    const pr = ((now / 1000) % 3) / 3;
    ctx.save();
    ctx.globalAlpha = 0.35 * (1 - pr);
    circle(ctx, p.cx * TILE, p.cy * TILE, p.r * TILE * (0.4 + pr * 0.6), 'rgba(0,0,0,0)', '#2BB3A3', 2);
    ctx.restore();
    // Puerta del despacho (cerrada / abierta) + candado
    const locked = this.world.isPrivateLocked();
    for (const { door } of this.world.lockedDoors) {
      const x = door.x * TILE, y = door.y * TILE, w = (door.w ?? 1) * TILE, h = (door.h ?? 1) * TILE;
      if (locked) {
        fillRR(ctx, x + 10, y + 1, w - 20, h - 2, 3, '#1A1A1D', BRAND.goldDeep, 1.5);
      } else {
        ctx.fillStyle = 'rgba(34,197,94,0.18)';
        ctx.fillRect(x, y, w, h);
      }
      drawLock(ctx, x - 14, y + h / 2, locked);
    }
  }

  private drawProximity(ctx: Ctx) {
    const me = this.player;
    const active = this.peers.length > 0;
    ctx.save();
    ctx.beginPath();
    ctx.arc(me.x, me.y - 8, PROXIMITY_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = active ? 'rgba(245,197,24,0.12)' : 'rgba(43,179,163,0.06)';
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = active ? 'rgba(224,168,0,0.85)' : 'rgba(43,179,163,0.45)';
    ctx.stroke();
    ctx.setLineDash([]);
    if (active) {
      ctx.strokeStyle = 'rgba(224,168,0,0.6)';
      ctx.lineWidth = 1.5;
      for (const peer of this.peers) {
        const a = this.allAvatars().find((x) => x.id === peer.id);
        if (!a || dist(a, me) > PROXIMITY_RADIUS * 1.2) continue;
        ctx.beginPath(); ctx.moveTo(me.x, me.y - 14); ctx.lineTo(a.x, a.y - 14); ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) { return Math.hypot(a.x - b.x, a.y - b.y); }

function drawStatusIcon(ctx: Ctx, x: number, y: number, emoji: string) {
  circle(ctx, x, y, 7, '#FFFFFF', 'rgba(139,92,246,0.8)', 1.5);
  text(ctx, emoji, x, y + 0.5, 8, '#000', 400);
}

function drawLock(ctx: Ctx, x: number, y: number, locked: boolean) {
  circle(ctx, x, y, 10, locked ? '#111113' : '#16A34A', BRAND.gold, 1.5);
  ctx.strokeStyle = BRAND.gold;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  if (locked) ctx.arc(x, y - 2, 3.5, Math.PI, 0);
  else ctx.arc(x + 3, y - 3, 3.5, Math.PI, -0.2);
  ctx.stroke();
  fillRR(ctx, x - 5, y - 1.5, 10, 7, 1.5, BRAND.gold);
  circle(ctx, x, y + 2, 1.2, '#111');
}
