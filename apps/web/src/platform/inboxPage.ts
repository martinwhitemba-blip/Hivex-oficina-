import { formatWhen, t, type MessageKey } from '../i18n';
import { api, esc } from './api';
import { applyNotifyRead } from './notifyUnread';
import { shell } from './pages';

interface Notice {
  id: string;
  kind: string;
  payload: { title?: string; fromName?: string; dueDate?: string; name?: string };
  readAt: string | null;
  createdAt: string;
}

const KIND_KEY: Record<string, MessageKey> = {
  assignment: 'inbox.assignment',
  handoff: 'inbox.handoff',
  mention: 'inbox.mention',
  achievement: 'inbox.achievement',
  due_soon: 'inbox.dueSoon',
  overdue: 'inbox.overdue',
};

function line(item: Notice) {
  const key = KIND_KEY[item.kind];
  const title = String(item.payload.title || '');
  const name = String(item.payload.fromName || item.payload.name || '');
  const date = String(item.payload.dueDate || '');
  if (!key) return esc(title || item.kind);
  return esc(t(key, { title, name, date }));
}

export async function renderInbox(root: HTMLElement) {
  const data = await api<{ unread: number; items: Notice[] }>('/api/notificaciones');
  applyNotifyRead({ unread: data.unread });
  root.innerHTML = shell('avisos', t('inbox.title'), t('inbox.subtitle'), `
    <div class="toolbar">
      <span class="chip">${t('inbox.bell')} ${data.unread}</span>
      <button class="btn" id="mark-all" type="button" ${data.unread ? '' : 'disabled'}>${t('inbox.markAll')}</button>
    </div>
    <div class="note-list" id="inbox">${data.items.map((item) => `
      <article class="cardx ${item.readAt ? '' : 'unread'}" data-id="${item.id}">
        <div><b>${line(item)}</b><div class="muted">${esc(formatWhen(item.createdAt))}</div></div>
        ${item.readAt ? '' : `<button class="btn" data-read="${item.id}" type="button">${t('inbox.mark')}</button>`}
      </article>`).join('') || `<p class="cardx muted">${t('inbox.empty')}</p>`}
    </div>
  `);
  const refresh = () => renderInbox(root);
  root.querySelector('#mark-all')?.addEventListener('click', async () => {
    const saved = await api<{ unread: number }>('/api/notificaciones/leidas', { method: 'POST', body: JSON.stringify({}) });
    applyNotifyRead(saved);
    await refresh();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-read]').forEach((button) => {
    button.onclick = async () => {
      const saved = await api<{ unread: number }>('/api/notificaciones/leidas', {
        method: 'POST',
        body: JSON.stringify({ ids: [button.dataset.read] }),
      });
      applyNotifyRead(saved);
      await refresh();
    };
  });
}
