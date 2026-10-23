import type { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { localizeError, resolveLocale, translate, type Locale } from '../../../packages/i18n/src/index';
import { isoDate, roleLabel } from './domain';
import { HttpError } from './http';
import { env } from './env';
import { ownerSnapshot, type LivePresence } from './ownerSnapshot';
import { prisma } from './prisma';
import { sendDirect, type DirectDto } from './direct';
import { photoUrl, parseLook } from './services';

let ioRef: Server | null = null;

export function companyRoom(companyId: string) {
  return `empresa:${companyId}`;
}

/** Emite solo a los sockets de esa empresa. */
export function emitCompany(companyId: string, event: string, payload: unknown) {
  ioRef?.to(companyRoom(companyId)).emit(event, payload);
}

export interface TaskUpdateEvent {
  taskId: string;
  companyId: string;
  title: string;
  status: string;
  areaId: string;
  assigneeId: string | null;
  parentId: string | null;
  priority: string;
  dueDate: string | null;
  sort: number;
  weeklyGoalId: string | null;
  updatedAt: string;
  deleted?: boolean;
}

export interface TaskHandoffEvent {
  fromMembershipId: string | null;
  toMembershipId: string | null;
  taskId: string;
}

export interface GoalProgressEvent {
  goalId: string;
  companyId: string;
  weekStart: string;
  metric: string;
  current: number;
  target: number;
  pct: number;
  areaId: string | null;
  membershipId: string | null;
  awarded: boolean;
}

export function publishTaskUpdate(companyId: string, payload: TaskUpdateEvent) {
  emitCompany(companyId, 'task:update', payload);
}

export function publishTaskHandoff(companyId: string, payload: TaskHandoffEvent) {
  emitCompany(companyId, 'task:handoff', payload);
}

export function publishGoalProgress(companyId: string, payload: GoalProgressEvent) {
  emitCompany(companyId, 'goal:progress', payload);
}

const relayAt = new Map<string, number>();

/** Un emote y una burbuja por segundo y persona. No se guardan. */
export function allowRelay(membershipId: string, kind: 'emote' | 'bubble', now = Date.now()) {
  const key = `${kind}:${membershipId}`;
  const previous = relayAt.get(key) || 0;
  if (now - previous < 1000) return false;
  relayAt.set(key, now);
  return true;
}

export function collectOnline(companyId: string): Map<string, LivePresence> {
  const map = new Map<string, LivePresence>();
  if (!ioRef) return map;
  for (const peer of ioRef.sockets.sockets.values()) {
    if (peer.data.companyId !== companyId) continue;
    map.set(String(peer.data.membershipId), {
      status: String(peer.data.liveStatus || 'en_linea'),
      x: Number(peer.data.x || 0),
      y: Number(peer.data.y || 0),
    });
  }
  return map;
}

export function pushDirect(companyId: string, message: DirectDto) {
  if (!ioRef) return;
  for (const peer of ioRef.sockets.sockets.values()) {
    if (peer.data.companyId !== companyId) continue;
    const id = String(peer.data.membershipId);
    if (id !== message.senderId && id !== message.recipientId) continue;
    peer.emit('dm:message', message);
  }
}

export async function broadcastPanel(companyId: string) {
  if (!ioRef) return;
  const state = await ownerSnapshot(companyId, collectOnline(companyId));
  for (const peer of ioRef.sockets.sockets.values()) {
    if (peer.data.companyId !== companyId || peer.data.appRole === 'empleado') continue;
    const payload = peer.data.appRole === 'administrador' ? filterOwner(state, peer.data.areaId ?? null) : state;
    peer.emit('panel:state', payload);
  }
}

export function filterOwner<T extends { people: { areaId: string | null }[]; areas: { id: string }[]; tasks: { areaId: string }[] }>(state: T, areaId: string | null): T {
  return {
    ...state,
    people: state.people.filter((person) => person.areaId === areaId),
    areas: state.areas.filter((area) => area.id === areaId),
    tasks: state.tasks.filter((task) => task.areaId === areaId),
  };
}

interface PresenceState {
  id: string;
  name: string;
  role: string;
  x: number;
  y: number;
  dir: string;
  moving: boolean;
  status: string;
  mode: 'walk' | 'car';
  look: ReturnType<typeof parseLook> & { photoUrl?: string | null };
  sitting: boolean;
}

const lastStates = new Map<string, Map<string, PresenceState>>();
const lastBroadcast = new Map<string, number>();
const pendingPresence = new Map<string, { timer: ReturnType<typeof setTimeout>; state: PresenceState }>();
const INTEREST_UNDER = 40;
const INTEREST_RADIUS = 720;

function roomCrowd(io: Server, room: string) {
  return io.sockets.adapter.rooms.get(room)?.size ?? 1;
}

function closeEnough(viewer: Socket, other: { areaId?: string | null; x: number; y: number }) {
  if (viewer.data.areaId && other.areaId && viewer.data.areaId === other.areaId) return true;
  const dx = Number(viewer.data.x || 0) - other.x;
  const dy = Number(viewer.data.y || 0) - other.y;
  return Math.hypot(dx, dy) < INTEREST_RADIUS;
}

function emitPresence(io: Server, socket: Socket, room: string, companyId: string, state: PresenceState, immediate: boolean) {
  const now = Date.now();
  const previous = lastBroadcast.get(socket.id) || 0;
  if (!immediate && now - previous < 80) {
    const queued = pendingPresence.get(socket.id);
    if (queued) queued.state = state;
    else {
      const timer = setTimeout(() => {
        const item = pendingPresence.get(socket.id);
        pendingPresence.delete(socket.id);
        if (item) emitPresence(io, socket, room, companyId, item.state, true);
      }, 80);
      pendingPresence.set(socket.id, { timer, state });
    }
    return;
  }
  lastBroadcast.set(socket.id, now);
  if (roomCrowd(io, room) <= INTEREST_UNDER) {
    socket.to(room).emit('office:state', state);
    return;
  }
  for (const peer of io.sockets.sockets.values()) {
    if (peer.data.companyId !== companyId || peer.id === socket.id) continue;
    if (closeEnough(peer, { areaId: socket.data.areaId ?? null, x: state.x, y: state.y })) peer.emit('office:state', state);
  }
}

export function attachSocket(io: Server) {
  ioRef = io;
  io.use(async (socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token || '');
      const payload = jwt.verify(token, env.jwtSecret) as { sub?: string };
      const user = await prisma.user.findUnique({
        where: { id: payload.sub || '' },
        include: { memberships: { where: { active: true }, include: { jobTitle: true, company: true }, take: 1 } },
      });
      const membership = user?.memberships[0];
      if (!user || !membership) return next(new Error('No autorizado'));
      socket.data.userId = user.id;
      socket.data.membershipId = membership.id;
      socket.data.companyId = membership.companyId;
      socket.data.name = membership.name;
      socket.data.role = membership.jobTitle?.name || roleLabel(membership.role);
      socket.data.areaId = membership.areaId;
      socket.data.appRole = membership.role;
      socket.data.locale = resolveLocale({
        user: user.locale,
        company: membership.company.locale,
        acceptLanguage: typeof socket.handshake.headers['accept-language'] === 'string' ? socket.handshake.headers['accept-language'] : null,
      });
      socket.data.look = { ...parseLook(membership.lookJson), photoUrl: photoUrl(membership.photoPath) };
      socket.data.lastPing = Date.now();
      next();
    } catch {
      next(new Error('No autorizado'));
    }
  });

  io.on('connection', (socket) => {
    const companyId = String(socket.data.companyId);
    const membershipId = String(socket.data.membershipId);
    const room = companyRoom(companyId);
    socket.join(room);

    socket.on('office:join', (incoming: Partial<PresenceState>) => {
      const state = sanitize(incoming, socket);
      const bucket = lastStates.get(companyId) ?? new Map<string, PresenceState>();
      lastStates.set(companyId, bucket);
      const crowded = roomCrowd(io, room) > INTEREST_UNDER;
      for (const previous of bucket.values()) {
        if (previous.id === membershipId) continue;
        if (crowded && Math.hypot(previous.x - state.x, previous.y - state.y) >= INTEREST_RADIUS) continue;
        socket.emit('office:state', previous);
      }
      bucket.set(membershipId, state);
      socket.data.liveStatus = state.status;
      socket.data.x = state.x;
      socket.data.y = state.y;
      emitPresence(io, socket, room, companyId, state, true);
      void broadcastPanel(companyId);
    });

    socket.on('office:state', (incoming: Partial<PresenceState>) => {
      const state = sanitize(incoming, socket);
      const bucket = lastStates.get(companyId) ?? new Map<string, PresenceState>();
      lastStates.set(companyId, bucket);
      bucket.set(membershipId, state);
      socket.data.liveStatus = state.status;
      socket.data.x = state.x;
      socket.data.y = state.y;
      emitPresence(io, socket, room, companyId, state, false);
    });

    socket.on('panel:sync', () => { void broadcastPanel(companyId); });

    socket.on('office:lock', (payload: { locked?: boolean }) => {
      io.to(room).emit('office:lock', { locked: Boolean(payload?.locked) });
    });

    socket.on('chat:send', async (payload: { body?: string; areaId?: string | null }) => {
      const text = String(payload?.body || '').trim();
      const areaId = payload?.areaId || null;
      if (!text || text.length > 1000) return;
      if (areaId && socket.data.appRole !== 'propietario' && socket.data.areaId !== areaId) return;
      const message = await prisma.chatMessage.create({
        data: { companyId, areaId, membershipId, body: text },
        include: { author: true },
      });
      const dto = {
        id: message.id,
        body: message.body,
        areaId: message.areaId,
        createdAt: message.createdAt,
        authorId: message.author.id,
        author: message.author.name,
        photoUrl: photoUrl(message.author.photoPath),
      };
      for (const peer of io.sockets.sockets.values()) {
        if (peer.data.companyId !== companyId) continue;
        if (areaId && peer.data.appRole !== 'propietario' && peer.data.areaId !== areaId) continue;
        peer.emit('chat:message', dto);
      }
    });

    socket.on('dm:send', async (payload: { to?: string; body?: string }) => {
      try {
        const message = await sendDirect(companyId, membershipId, String(payload?.to || ''), String(payload?.body || ''));
        pushDirect(companyId, message);
      } catch (error) {
        const locale = (socket.data.locale || 'es') as Locale;
        if (error instanceof HttpError) {
          socket.emit('dm:error', localizeError(locale, error.message, error.code, error.params));
        } else {
          socket.emit('dm:error', { error: translate(locale, 'errors.chat.send'), code: 'chat.send' });
        }
      }
    });

    socket.on('webrtc:signal', (payload: { to?: string; data?: unknown }) => {
      const to = String(payload?.to || '');
      if (!to || to === membershipId) return;
      for (const peer of io.sockets.sockets.values()) {
        if (peer.data.membershipId === to && peer.data.companyId === companyId) {
          peer.emit('webrtc:signal', { from: membershipId, data: payload.data });
        }
      }
    });

    socket.on('office:emote', (payload: { emote?: string }) => {
      if (!allowRelay(membershipId, 'emote')) return;
      const emote = String(payload?.emote || '').trim().slice(0, 16);
      if (!emote) return;
      io.to(room).emit('office:emote', { membershipId, emote, at: new Date().toISOString() });
    });

    socket.on('office:bubble', (payload: { text?: string }) => {
      if (!allowRelay(membershipId, 'bubble')) return;
      const text = String(payload?.text || '').trim().slice(0, 140);
      if (!text) return;
      io.to(room).emit('office:bubble', { membershipId, text, at: new Date().toISOString() });
    });

    socket.on('presence:ping', async () => {
      const now = Date.now();
      const previous = Number(socket.data.lastPing || now);
      socket.data.lastPing = now;
      const delta = Math.max(0, Math.min(60, Math.round((now - previous) / 1000)));
      if (!delta) return;
      const date = isoDate();
      await prisma.presenceDay.upsert({
        where: { membershipId_date: { membershipId, date } },
        create: { membershipId, date, activeSeconds: delta },
        update: { activeSeconds: { increment: delta } },
      });
    });

    socket.on('disconnect', () => {
      const pending = pendingPresence.get(socket.id);
      if (pending) clearTimeout(pending.timer);
      pendingPresence.delete(socket.id);
      lastBroadcast.delete(socket.id);
      lastStates.get(companyId)?.delete(membershipId);
      socket.to(room).emit('office:leave', membershipId);
      void broadcastPanel(companyId);
    });
  });
}

function sanitize(incoming: Partial<PresenceState>, socket: Socket): PresenceState {
  const dir = incoming?.dir === 'up' || incoming?.dir === 'left' || incoming?.dir === 'right' ? incoming.dir : 'down';
  const statuses = ['en_linea', 'ausente', 'en_reunion', 'cafe', 'en_llamada'];
  const status = statuses.includes(String(incoming?.status)) ? String(incoming.status) : 'en_linea';
  return {
    id: String(socket.data.membershipId),
    name: String(socket.data.name),
    role: String(socket.data.role),
    x: Number.isFinite(Number(incoming?.x)) ? Number(incoming?.x) : 0,
    y: Number.isFinite(Number(incoming?.y)) ? Number(incoming?.y) : 0,
    dir,
    moving: Boolean(incoming?.moving),
    status,
    mode: incoming?.mode === 'car' ? 'car' : 'walk',
    look: socket.data.look,
    sitting: Boolean(incoming?.sitting),
  };
}
