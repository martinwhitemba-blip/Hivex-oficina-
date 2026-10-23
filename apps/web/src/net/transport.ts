/**
 * Capa de red (presencia multijugador).
 *
 * Hoy se usa `LocalTransport` (no hace nada: modo un jugador + NPC simulados).
 * Para multijugador real basta con implementar esta interfaz con WebSocket,
 * Socket.IO o Colyseus y pasarla a `new Game(..., { transport })`.
 * El juego ya:
 *   - envía el estado del jugador local ~10 veces/seg (sendState)
 *   - crea / interpola / elimina avatares remotos con onRemoteState / onRemoteLeave
 */
import type { AvatarState } from '../game/types';

export interface PresenceTransport {
  readonly kind: string;
  connect(self: AvatarState): Promise<void>;
  sendState(state: AvatarState): void;
  onRemoteState(cb: (state: AvatarState) => void): void;
  onRemoteLeave(cb: (id: string) => void): void;
  disconnect(): void;
}

/** Transporte local: sin servidor. */
export class LocalTransport implements PresenceTransport {
  readonly kind = 'local';
  async connect() { /* sin servidor */ }
  sendState() { /* nada que enviar */ }
  onRemoteState() { /* nunca llegan remotos */ }
  onRemoteLeave() { /* idem */ }
  disconnect() { /* idem */ }
}

/*
 * Ejemplo (pseudo-código) con Socket.IO:
 *
 * export class SocketIoTransport implements PresenceTransport {
 *   readonly kind = 'socket.io';
 *   private socket = io('https://tu-servidor', { auth: { token } });
 *   async connect(self) { this.socket.emit('join', { room: 'oficina-principal', state: self }); }
 *   sendState(s) { this.socket.volatile.emit('state', s); }
 *   onRemoteState(cb) { this.socket.on('state', cb); }
 *   onRemoteLeave(cb) { this.socket.on('leave', cb); }
 *   disconnect() { this.socket.disconnect(); }
 * }
 */
