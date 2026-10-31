/**
 * Contador de mensajes directos no leídos de la sesión actual.
 * Una sola fuente: el icono del chat y la lista de personas leen lo mismo.
 * El hilo abierto (y solo mientras se ve) no suma; al cerrarlo, los nuevos vuelven a contar.
 */

export interface UnreadState {
  counts: Record<string, number>;
  seeded: boolean;
  loose: number;
  active: string | null;
  seen: string[];
}

export interface DirectNotice {
  id: string;
  senderId: string;
  recipientId: string;
}

export function emptyUnread(): UnreadState {
  return { counts: {}, seeded: false, loose: 0, active: null, seen: [] };
}

export function unreadTotal(state: UnreadState) {
  if (!state.seeded) return state.loose;
  return Object.values(state.counts).reduce((sum, count) => sum + count, 0);
}

export function unreadOf(state: UnreadState, id: string) {
  return state.seeded ? state.counts[id] || 0 : 0;
}

export function hintUnread(state: UnreadState, total: number): UnreadState {
  if (state.seeded) return state;
  return { ...state, loose: Math.max(0, Math.floor(total) || 0) };
}

export function seedUnread(state: UnreadState, people: { id: string; unread: number }[]): UnreadState {
  const counts: Record<string, number> = {};
  for (const person of people) counts[person.id] = Math.max(0, Math.floor(Number(person.unread)) || 0);
  return { ...state, counts, seeded: true };
}

export function watchUnread(state: UnreadState, peerId: string | null): UnreadState {
  return { ...state, active: peerId };
}

export function clearUnread(state: UnreadState, peerId: string): UnreadState {
  if (!state.seeded) return { ...state, active: peerId };
  return { ...state, active: peerId, counts: { ...state.counts, [peerId]: 0 } };
}

export function receiveUnread(state: UnreadState, message: DirectNotice, selfId: string): UnreadState {
  if (!message.id || state.seen.includes(message.id)) return state;
  const seen = [...state.seen, message.id].slice(-400);
  if (message.recipientId !== selfId) return { ...state, seen };
  if (state.active === message.senderId) return { ...state, seen };
  if (!state.seeded) return { ...state, seen, loose: state.loose + 1 };
  const prev = state.counts[message.senderId] || 0;
  return { ...state, seen, counts: { ...state.counts, [message.senderId]: prev + 1 } };
}

let state = emptyUnread();
const listeners = new Set<(total: number) => void>();
const arrivals = new Set<() => void>();

function commit(next: UnreadState) {
  state = next;
  const total = unreadTotal(state);
  for (const listener of listeners) listener(total);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hivex-unread', { detail: total }));
  }
}

export function directUnreadTotal() {
  return unreadTotal(state);
}

export function directUnreadOf(id: string) {
  return unreadOf(state, id);
}

export function directConversationOpen(peerId: string) {
  return state.active === peerId;
}

export function onDirectUnread(listener: (total: number) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Avisa cuando llega un directo que sí cambia la cuenta, para refrescar un listado en vuelo. */
export function onDirectArrival(listener: () => void) {
  arrivals.add(listener);
  return () => arrivals.delete(listener);
}

export function resetDirectUnread() {
  commit(emptyUnread());
}

export function hintDirectUnread(total: number) {
  commit(hintUnread(state, total));
}

export function seedDirectUnread(people: { id: string; unread: number }[]) {
  commit(seedUnread(state, people));
}

export function watchDirect(peerId: string | null) {
  commit(watchUnread(state, peerId));
}

export function clearDirect(peerId: string) {
  commit(clearUnread(state, peerId));
}

export function receiveDirect(message: DirectNotice, selfId: string) {
  const before = unreadTotal(state);
  const next = receiveUnread(state, message, selfId);
  if (next === state) return;
  commit(next);
  if (unreadTotal(next) > before) {
    for (const listener of arrivals) listener();
  }
}
