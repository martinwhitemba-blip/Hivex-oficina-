import './styles.css';
import './platform/platform.css';
import { io, type Socket } from 'socket.io-client';
import { BRAND_NAME, BRAND_TAGLINE } from './config';
import { applyRooms, cloneOfficeMap } from './data/zones';
import { Game } from './game/game';
import { bootLocale, getLocale, pinLocale, t, type Locale } from './i18n';
import type { AvatarLook, StatusId } from './game/types';
import { LiveKitMediaProvider } from './media/livekitMedia';
import { P2PMediaProvider } from './media/p2pMedia';
import type { ProximityMediaProvider } from './media/proximityMedia';
import { SocketIoTransport } from './net/socketTransport';
import { ApiError, api, clearToken, getToken } from './platform/api';
import { applyMarca, type Marca } from './platform/brand';
import { paintSessionNotice, renderAuth, renderPasswordGate, renderView, setProfileLocale, type Session } from './platform/pages';
import { isAuthScreen, isPublicJoin, viewForSession } from './routing';
import { UI } from './ui/ui';
import markUrl from './assets/hivex-mark.png';
import wordmarkUrl from './assets/hivex-wordmark.png';
import logoUrl from './assets/hivex-logo.png';
import faviconUrl from './assets/hivex-favicon.png';

bootLocale();
document.title = `${BRAND_NAME} · ${BRAND_TAGLINE}`;
(document.getElementById('favicon') as HTMLLinkElement).href = faviconUrl;

if (import.meta.env.MODE !== 'single' && location.protocol.startsWith('http')) {
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = './manifest.webmanifest';
  document.head.append(link);
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
}

interface Hud {
  officeName: string;
  isDemo: boolean;
  stats: { ventasHoy: number; importeHoy: number; citasHoy: number; seguimiento: number; demo: boolean };
  rankings: { ventas: { title: string; subtitle: string; rows: { name: string; value: number; fmt: string }[] }; citas: { title: string; subtitle: string; rows: { name: string; value: number; fmt: string }[] } };
  rooms: { mapRoomId: string; name: string; label: string }[];
  deskId: string | null;
  directory: { id: string; name: string; role: string; photoUrl?: string | null; deskId?: string | null; look?: Session['membership']['look'] }[];
  alertCount: number;
  directUnread?: number;
  media: { mode: 'livekit' | 'p2p'; notice: string };
}

const authEl = document.getElementById('auth')!;
const appEl = document.getElementById('app')!;
const pagesEl = document.getElementById('pages')!;
const bootErrorEl = document.getElementById('boot-error')!;
const bootErrorText = document.getElementById('boot-error-text')!;

function showBootError(message: string) {
  bootErrorText.textContent = message || t('common.bootFail');
  bootErrorEl.hidden = false;
}

document.getElementById('boot-reload')?.addEventListener('click', () => location.reload());
window.addEventListener('error', (event) => {
  showBootError(event.message || t('common.unexpected'));
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  showBootError(reason instanceof Error ? reason.message : t('common.unexpected'));
});

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(t('common.timeout', { label }))), ms);
    work.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
  });
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

let session: Session | null = null;
let officeMedia: ProximityMediaProvider | null = null;
let socket: Socket | null = null;
let game: Game | null = null;
let ui: UI | null = null;
let pingTimer = 0;
let enterRun = 0;
let applyingLock = false;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => reject(new Error('logo')), 2000);
    img.onload = () => { window.clearTimeout(timer); resolve(img); };
    img.onerror = () => { window.clearTimeout(timer); resolve(img); };
    img.src = src;
  });
}

function asLook(look: Session['membership']['look']): AvatarLook {
  const hairStyle = (look.hairStyle === 1 || look.hairStyle === 2 || look.hairStyle === 3 ? look.hairStyle : 0) as 0 | 1 | 2 | 3;
  return { skin: look.skin, hair: look.hair, hairStyle, shirt: look.shirt, pants: look.pants, glasses: look.glasses, usePhoto: look.usePhoto === true, photoUrl: look.photoUrl };
}

function revealAuth() {
  document.body.classList.add('auth-mode');
  authEl.hidden = false;
  appEl.hidden = true;
  pagesEl.classList.add('hidden');
  pagesEl.hidden = true;
}

function revealApp() {
  document.body.classList.remove('auth-mode');
  authEl.hidden = true;
  appEl.hidden = false;
}

function showAuth() {
  revealAuth();
  if (!isAuthScreen(location.hash)) location.hash = '#/entrar';
  if (isPublicJoin(location.hash)) {
    openPublicJoin();
    return;
  }
  renderAuth(authEl, () => { void enter(); });
}

function openPublicJoin() {
  // Cancela un enter() que ya iba hacia la oficina: si no, al terminar tapa el formulario.
  enterRun += 1;
  teardownOffice();
  revealAuth();
  renderAuth(authEl, () => { void enter(); });
  if (session) {
    paintSessionNotice(authEl, session.membership.name, () => logout({ keepHash: true }), () => { location.hash = '#/oficina'; });
    return;
  }
  if (!getToken()) return;
  void withTimeout(api<Session>('/api/auth/yo'), 12000, 'sesión').then((next) => {
    session = next;
    setProfileLocale(next.locale ?? null);
    const before = getLocale();
    bootLocale({ user: next.locale, company: next.companyLocale });
    if (!isPublicJoin(location.hash)) return;
    if (getLocale() !== before) renderAuth(authEl, () => { void enter(); });
    paintSessionNotice(authEl, next.membership.name, () => logout({ keepHash: true }), () => { location.hash = '#/oficina'; });
  }).catch((error) => {
    if (error instanceof ApiError && error.status === 401) {
      clearToken();
      session = null;
      setProfileLocale(null);
      return;
    }
    showBootError(error instanceof Error ? error.message : t('common.sessionFail'));
  });
}

function teardownOffice() {
  window.clearInterval(pingTimer);
  applyingLock = false;
  game?.stop();
  socket?.disconnect();
  game = null;
  ui = null;
  socket = null;
  document.getElementById('game')?.remove();
  appEl.innerHTML = '';
}

function enterStale(run: number) {
  return run !== enterRun || isPublicJoin(location.hash) || !getToken();
}

async function enter() {
  const run = ++enterRun;
  try {
    if (isPublicJoin(location.hash)) {
      openPublicJoin();
      return;
    }
    session = await withTimeout(api<Session>('/api/auth/yo'), 12000, 'sesión');
    if (enterStale(run)) return;
    setProfileLocale(session.locale ?? null);
    bootLocale({ user: session.locale, company: session.companyLocale });
    if (session.debeCambiarContrasena) {
      showPasswordGate();
      return;
    }
    // La sesión ya se conoce: la interfaz sale antes de marca, fuentes o 3D.
    revealApp();
    await nextFrame();
    if (enterStale(run)) return;
    const [hud, marca] = await withTimeout(Promise.all([
      api<Hud>('/api/oficina/hud'),
      api<Marca>('/api/marca'),
    ]), 12000, 'oficina');
    if (enterStale(run)) return;
    try { applyMarca(marca); } catch (error) { console.error(error); }
    await startOffice(session, hud, marca, run);
  } catch (error) {
    if (enterStale(run)) return;
    const message = error instanceof Error ? error.message : t('common.enterFail');
    if (error instanceof ApiError && error.status === 401) {
      clearToken();
      session = null;
      showAuth();
      const err = authEl.querySelector('.err') as HTMLElement | null;
      if (err) {
        err.hidden = false;
        err.textContent = message;
      }
      return;
    }
    showBootError(message);
    if (isPublicJoin(location.hash)) openPublicJoin();
    else if (session) revealApp();
    else showAuth();
  }
}

async function startOffice(current: Session, hud: Hud, marca: Marca | null, run = enterRun) {
  if (enterStale(run)) return;
  teardownOffice();
  if (enterStale(run)) return;
  revealApp();
  const emblem = await loadImage(marca?.logoUrl || markUrl).catch(() => null);
  if (enterStale(run)) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'game';
  document.body.append(canvas);

  socket = io({ auth: { token: getToken() }, transports: ['websocket', 'polling'], withCredentials: true });
  const media: ProximityMediaProvider = hud.media.mode === 'livekit'
    ? new LiveKitMediaProvider()
    : new P2PMediaProvider(socket, current.membership.id);
  officeMedia = media;
  (media as { notice: string }).notice = hud.media.notice;
  const map = cloneOfficeMap();
  applyRooms(map, hud.rooms);
  game = new Game(canvas, map, {
    transport: new SocketIoTransport(socket),
    media,
    emblem: emblem ?? undefined,
    player: {
      id: current.membership.id,
      name: current.membership.name,
      role: current.membership.jobTitle?.name || current.membership.roleLabel,
      look: asLook(current.membership.look),
    },
    rankings: hud.rankings,
    deskId: hud.deskId,
    demoNpcs: false,
  });
  ui = new UI(appEl, game, media, { mark: markUrl, wordmark: wordmarkUrl, logo: logoUrl }, {
    officeName: hud.officeName,
    role: current.membership.role,
    stats: hud.stats,
    directory: hud.directory,
    alertCount: hud.alertCount,
    onNavigate: (view) => { location.hash = `#/${view}`; },
    onLogout: logout,
    onStatus: (status: StatusId) => { game?.setPlayerStatus(status); },
    onToggleDemo: (on) => game?.setDemoMode(on),
    onMessage: (id) => { location.hash = `#/chat?con=${encodeURIComponent(id)}`; },
  });
  game.on('dm', ({ id }) => { location.hash = `#/chat?con=${encodeURIComponent(id)}`; });
  game.on('lock', ({ locked }) => {
    if (applyingLock) return;
    socket?.emit('office:lock', { locked });
  });
  socket.on('office:lock', (payload: { locked?: boolean }) => {
    if (!game) return;
    applyingLock = true;
    game.setPrivateLocked(Boolean(payload?.locked), false);
    applyingLock = false;
  });
  game.setColleagues(hud.directory.flatMap((person) => {
    if (!person.look || !person.deskId) return [];
    return [{ id: person.id, name: person.name, role: person.role, deskId: person.deskId, look: asLook(person.look) }];
  }));
  game.start();
  ui.setDirectUnread(hud.directUnread ?? 0);
  ui.applyMarca({ nombre: marca?.nombre || current.membership.company.name, oficina: marca?.oficina || hud.officeName, logoUrl: marca?.logoUrl || null });
  socket.on('dm:message', (message: { recipientId?: string }) => {
    if (message.recipientId !== current.membership.id) return;
    if (location.hash.startsWith('#/chat')) return;
    ui?.bumpDirectUnread(1);
  });
  if (enterStale(run)) {
    teardownOffice();
    return;
  }
  route();
  await nextFrame();
  if (enterStale(run)) return;
  try {
    await withTimeout(game.mount3d(), 4000, 'webgl');
  } catch (error) {
    console.error(error);
  }
  if (enterStale(run)) return;
  if (marca?.logoUrl && emblem?.naturalWidth) game?.setPlazaLogo(emblem);
  pingTimer = window.setInterval(() => socket?.emit('presence:ping'), 20000);
  socket.emit('presence:ping');
  (window as unknown as { __game?: Game }).__game = game;
}

function showPasswordGate() {
  teardownOffice();
  document.body.classList.add('auth-mode');
  authEl.hidden = false;
  appEl.hidden = true;
  pagesEl.classList.add('hidden');
  pagesEl.hidden = true;
  renderPasswordGate(authEl, () => { void enter(); });
}

window.addEventListener('hivex-marca', (event) => {
  const next = (event as CustomEvent<Marca>).detail;
  if (!next) return;
  applyMarca(next);
  ui?.applyMarca(next);
  if (!next.logoUrl) {
    game?.setPlazaLogo(null);
    return;
  }
  void loadImage(next.logoUrl).then((image) => {
    if (image.naturalWidth) game?.setPlazaLogo(image);
  });
});

function logout(opts?: { keepHash?: boolean }) {
  clearToken();
  teardownOffice();
  session = null;
  setProfileLocale(null);
  officeMedia = null;
  if (!opts?.keepHash) location.hash = '#/entrar';
  if (isPublicJoin(location.hash)) openPublicJoin();
  else showAuth();
}

function currentView() {
  return viewForSession(location.hash, session?.membership.role);
}

function route() {
  if (isPublicJoin(location.hash)) {
    openPublicJoin();
    return;
  }
  if (!getToken()) {
    showAuth();
    return;
  }
  if (!session || !game || !ui) {
    void enter();
    return;
  }
  const view = currentView();
  if (view === 'oficina') {
    pagesEl.classList.add('hidden');
    pagesEl.hidden = true;
    appEl.hidden = false;
    ui.setActive('oficina');
    window.dispatchEvent(new Event('resize'));
    game.focusKeyboard();
    return;
  }
  pagesEl.hidden = false;
  appEl.hidden = true;
  pagesEl.classList.remove('hidden');
  ui.setActive(view.split('/')[0]);
  void renderView(pagesEl, view, session, socket);
}

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || !target.classList.contains('lang-switch')) return;
  const locale = target.value as Locale;
  if (!['es', 'en', 'fr', 'de'].includes(locale)) return;
  pinLocale(locale);
  if (getToken()) void api('/api/cuenta/idioma', { method: 'PATCH', body: JSON.stringify({ locale }) }).catch(() => {});
  void refreshAfterLocale();
});

window.addEventListener('hivex-auth-rerender', () => {
  if (!session || !isPublicJoin(location.hash)) return;
  paintSessionNotice(authEl, session.membership.name, () => logout({ keepHash: true }), () => { location.hash = '#/oficina'; });
});

async function refreshAfterLocale() {
  if (session?.debeCambiarContrasena && !isPublicJoin(location.hash)) {
    showPasswordGate();
    return;
  }
  if (isPublicJoin(location.hash) || !getToken()) {
    if (isPublicJoin(location.hash)) openPublicJoin();
    else showAuth();
    return;
  }
  ui?.relabel();
  if (game) {
    try {
      const hud = await api<Hud>('/api/oficina/hud');
      game.mapRenderer.setRankings(hud.rankings);
      if (officeMedia) (officeMedia as { notice: string }).notice = hud.media.notice;
    } catch { /* la oficina sigue en el idioma anterior para los datos del servidor */ }
    game.mapRenderer.render();
  }
  route();
}

window.addEventListener('hivex-unread', (event) => {
  const count = Number((event as CustomEvent<number>).detail);
  if (Number.isFinite(count)) ui?.setDirectUnread(count);
});

window.addEventListener('hashchange', () => {
  if (isPublicJoin(location.hash)) {
    openPublicJoin();
    return;
  }
  if (!getToken()) showAuth();
  else route();
});

if (isPublicJoin(location.hash)) openPublicJoin();
else if (getToken()) void enter();
else showAuth();
