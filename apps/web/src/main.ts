import './styles.css';
import './platform/platform.css';
import { io, type Socket } from 'socket.io-client';
import { BRAND_NAME, BRAND_TAGLINE } from './config';
import { applyRooms, cloneOfficeMap } from './data/zones';
import { Game } from './game/game';
import type { AvatarLook, StatusId } from './game/types';
import { LiveKitMediaProvider } from './media/livekitMedia';
import { P2PMediaProvider } from './media/p2pMedia';
import type { ProximityMediaProvider } from './media/proximityMedia';
import { SocketIoTransport } from './net/socketTransport';
import { api, clearToken, getToken } from './platform/api';
import { renderAuth, renderPasswordGate, renderView, type Session } from './platform/pages';
import { UI } from './ui/ui';
import markUrl from './assets/hivex-mark.png';
import wordmarkUrl from './assets/hivex-wordmark.png';
import logoUrl from './assets/hivex-logo.png';
import faviconUrl from './assets/hivex-favicon.png';

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
  media: { mode: 'livekit' | 'p2p'; notice: string };
}

const authEl = document.getElementById('auth')!;
const appEl = document.getElementById('app')!;
const pagesEl = document.getElementById('pages')!;

let session: Session | null = null;
let socket: Socket | null = null;
let game: Game | null = null;
let ui: UI | null = null;
let pingTimer = 0;
let booting = false;
let applyingLock = false;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
    img.src = src;
  });
}

function asLook(look: Session['membership']['look']): AvatarLook {
  const hairStyle = (look.hairStyle === 1 || look.hairStyle === 2 || look.hairStyle === 3 ? look.hairStyle : 0) as 0 | 1 | 2 | 3;
  return { skin: look.skin, hair: look.hair, hairStyle, shirt: look.shirt, pants: look.pants, glasses: look.glasses, usePhoto: look.usePhoto === true, photoUrl: look.photoUrl };
}

function showAuth() {
  document.body.classList.add('auth-mode');
  authEl.hidden = false;
  appEl.hidden = true;
  pagesEl.classList.add('hidden');
  const hash = location.hash;
  const keep = ['#/registro', '#/unirse', '#/entrar', '#/codigo', '#/oficina', '#/activar'];
  if (!keep.some((prefix) => hash.startsWith(prefix))) location.hash = '#/entrar';
  renderAuth(authEl, () => { void enter(); });
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

async function enter() {
  if (booting) return;
  booting = true;
  try {
    session = await api<Session>('/api/auth/yo');
    if (session.debeCambiarContrasena) {
      showPasswordGate();
      return;
    }
    const hud = await api<Hud>('/api/oficina/hud');
    await startOffice(session, hud);
    route();
  } catch (error) {
    clearToken();
    session = null;
    showAuth();
    const err = authEl.querySelector('.err') as HTMLElement | null;
    if (err) {
      err.hidden = false;
      err.textContent = error instanceof Error ? error.message : 'No se pudo entrar';
    }
  } finally {
    booting = false;
  }
}

async function startOffice(current: Session, hud: Hud) {
  teardownOffice();
  document.body.classList.remove('auth-mode');
  authEl.hidden = true;
  const emblem = await loadImage(markUrl);
  const canvas = document.createElement('canvas');
  canvas.id = 'game';
  document.body.append(canvas);

  socket = io({ auth: { token: getToken() }, transports: ['websocket', 'polling'], withCredentials: true });
  const media: ProximityMediaProvider = hud.media.mode === 'livekit'
    ? new LiveKitMediaProvider()
    : new P2PMediaProvider(socket, current.membership.id);
  const map = cloneOfficeMap();
  applyRooms(map, hud.rooms);
  game = new Game(canvas, map, {
    transport: new SocketIoTransport(socket),
    media,
    emblem,
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

function logout() {
  clearToken();
  teardownOffice();
  session = null;
  location.hash = '#/entrar';
  showAuth();
}

function currentView() {
  const raw = location.hash.replace(/^#\//, '').split('?')[0];
  if (raw === 'oficina') return 'oficina';
  if (!raw || raw === 'entrar' || raw === 'registro' || raw === 'unirse' || raw === 'codigo') {
    return session?.membership.role === 'empleado' ? 'oficina' : 'dueno';
  }
  return raw;
}

function route() {
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

window.addEventListener('hashchange', () => {
  if (!getToken()) showAuth();
  else route();
});

if (getToken()) void enter();
else showAuth();
