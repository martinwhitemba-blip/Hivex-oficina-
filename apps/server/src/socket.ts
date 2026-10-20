import type { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { isoDate, roleLabel } from './domain';
import { env } from './env';
import { ownerSnapshot, type LivePresence } from './ownerSnapshot';
import { prisma } from './prisma';
import { photoUrl, parseLook } from './services';

let ioRef: Server | null = null;

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
    const room = `empresa:${companyId}`;
    socket.join(room);

    socket.on('office:join', (incoming: Partial<PresenceState>) => {
      const state = sanitize(incoming, socket);
      const bucket = lastStates.get(companyId) ?? new Map<string, PresenceState>();
      lastStates.set(companyId, bucket);
      for (const previous of bucket.values()) {
        if (previous.id !== membershipId) socket.emit('office:state', previous);
      }
      bucket.set(membershipId, state);
      socket.data.liveStatus = state.status;
      socket.data.x = state.x;
      socket.data.y = state.y;
      socket.to(room).emit('office:state', state);
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
      socket.to(room).emit('office:state', state);
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

    socket.on('webrtc:signal', (payload: { to?: string; data?: unknown }) => {
      const to = String(payload?.to || '');
      if (!to || to === membershipId) return;
      for (const peer of io.sockets.sockets.values()) {
        if (peer.data.membershipId === to && peer.data.companyId === companyId) {
          peer.emit('webrtc:signal', { from: membershipId, data: payload.data });
        }
      }
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
