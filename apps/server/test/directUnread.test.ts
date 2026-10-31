import { describe, expect, it } from 'vitest';
import {
  clearUnread,
  emptyUnread,
  hintUnread,
  receiveUnread,
  seedUnread,
  unreadOf,
  unreadTotal,
  watchUnread,
} from '../../web/src/platform/directUnread';

const self = 'me';
const ana = 'ana';
const luis = 'luis';

describe('contador de directos no leídos', () => {
  it('suma por persona y se pone a cero al abrir esa conversación', () => {
    let state = seedUnread(emptyUnread(), [
      { id: ana, unread: 2 },
      { id: luis, unread: 1 },
    ]);
    expect(unreadTotal(state)).toBe(3);
    expect(unreadOf(state, ana)).toBe(2);

    state = receiveUnread(state, { id: 'm3', senderId: ana, recipientId: self }, self);
    expect(unreadOf(state, ana)).toBe(3);
    expect(unreadTotal(state)).toBe(4);

    state = clearUnread(state, ana);
    expect(unreadOf(state, ana)).toBe(0);
    expect(unreadOf(state, luis)).toBe(1);
    expect(unreadTotal(state)).toBe(1);
  });

  it('no cuenta el hilo que está abierto y vuelve a contar al salir', () => {
    let state = watchUnread(seedUnread(emptyUnread(), [{ id: ana, unread: 1 }]), ana);
    state = receiveUnread(state, { id: 'm4', senderId: ana, recipientId: self }, self);
    expect(unreadOf(state, ana)).toBe(1);

    state = clearUnread(state, ana);
    expect(unreadTotal(state)).toBe(0);

    state = watchUnread(state, null);
    state = receiveUnread(state, { id: 'm5', senderId: ana, recipientId: self }, self);
    expect(unreadOf(state, ana)).toBe(1);
    expect(unreadTotal(state)).toBe(1);
  });

  it('ignora un duplicado y un mensaje que no es para esta persona', () => {
    let state = hintUnread(emptyUnread(), 0);
    state = receiveUnread(state, { id: 'm1', senderId: ana, recipientId: self }, self);
    state = receiveUnread(state, { id: 'm1', senderId: ana, recipientId: self }, self);
    state = receiveUnread(state, { id: 'm2', senderId: self, recipientId: ana }, self);
    expect(unreadTotal(state)).toBe(1);
  });

  it('el listado del servidor sustituye al aviso inicial', () => {
    const hinted = receiveUnread(hintUnread(emptyUnread(), 1), { id: 'm9', senderId: luis, recipientId: self }, self);
    expect(unreadTotal(hinted)).toBe(2);
    const seeded = seedUnread(hinted, [{ id: ana, unread: 4 }]);
    expect(unreadTotal(seeded)).toBe(4);
    expect(unreadOf(seeded, luis)).toBe(0);
  });
});
