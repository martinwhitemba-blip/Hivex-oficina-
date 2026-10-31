import type { Socket } from 'socket.io-client';
import type { AvatarState } from '../game/types';
import type { PresenceTransport } from './transport';

export class SocketIoTransport implements PresenceTransport {
  readonly kind = 'socket.io';
  private stateCb: ((state: AvatarState) => void) | null = null;
  private leaveCb: ((id: string) => void) | null = null;

  constructor(private socket: Socket) {}

  async connect(self: AvatarState) {
    this.socket.emit('office:join', self);
  }

  sendState(state: AvatarState) {
    this.socket.volatile.emit('office:state', state);
  }

  onRemoteState(cb: (state: AvatarState) => void) {
    this.stateCb = cb;
    this.socket.on('office:state', cb);
  }

  onRemoteLeave(cb: (id: string) => void) {
    this.leaveCb = cb;
    this.socket.on('office:leave', cb);
  }

  disconnect() {
    if (this.stateCb) this.socket.off('office:state', this.stateCb);
    if (this.leaveCb) this.socket.off('office:leave', this.leaveCb);
    this.socket.emit('office:leave');
  }
}
