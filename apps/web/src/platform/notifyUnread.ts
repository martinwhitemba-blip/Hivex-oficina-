/**
 * Campana de avisos de la sesión.
 * La oficina puede montar el contador con mountNotifyBadge o escuchar `hivex-notify`.
 * El mismo número vive en todas las pestañas: notify:new y notify:read traen el total.
 */
import { t } from '../i18n';
import { api } from './api';

let unread = 0;
const listeners = new Set<(total: number) => void>();

function commit(next: number) {
  unread = Math.max(0, Math.floor(next) || 0);
  for (const listener of listeners) listener(unread);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hivex-notify', { detail: unread }));
  }
}

export function notifyUnreadTotal() {
  return unread;
}

export function onNotifyUnread(listener: (total: number) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetNotifyUnread() {
  commit(0);
}

export function setNotifyUnread(total: number) {
  commit(total);
}

export function applyNotifyNew(payload: { unread?: number } | null | undefined) {
  if (payload && typeof payload.unread === 'number') commit(payload.unread);
  else commit(unread + 1);
}

export function applyNotifyRead(payload: { unread?: number } | null | undefined) {
  if (payload && typeof payload.unread === 'number') commit(payload.unread);
}

export async function refreshNotifyUnread() {
  const data = await api<{ unread: number }>('/api/notificaciones/contador');
  commit(data.unread || 0);
  return unread;
}

export function paintNotifyNav(root: ParentNode = document) {
  const total = notifyUnreadTotal();
  root.querySelectorAll<HTMLElement>('[data-hivex-notify-count]').forEach((node) => {
    node.textContent = total > 0 ? String(total) : '';
    node.hidden = total <= 0;
  });
}

/** Pinta un botón con la campana. Devuelve la función para soltarlo. */
export function mountNotifyBadge(host: HTMLElement, label = t('inbox.bell')) {
  const paint = () => {
    const total = notifyUnreadTotal();
    host.innerHTML = `<span class="lbl">${label}</span>${total > 0 ? `<span class="cnt">${total}</span>` : ''}`;
    host.dataset.hivexNotify = String(total);
  };
  host.dataset.hivexNotify = '0';
  if (!host.getAttribute('role')) host.setAttribute('role', 'button');
  host.onclick = () => { location.hash = '#/avisos'; };
  paint();
  const stop = onNotifyUnread(paint);
  return () => {
    stop();
    host.onclick = null;
  };
}

export function installNotifyHook() {
  if (typeof window === 'undefined') return;
  const hook = {
    total: notifyUnreadTotal,
    refresh: refreshNotifyUnread,
    mount: mountNotifyBadge,
  };
  (window as unknown as { __hivexNotify?: typeof hook }).__hivexNotify = hook;
}

installNotifyHook();
onNotifyUnread(() => paintNotifyNav());
