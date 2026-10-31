import { t } from '../i18n';
import { api } from './api';
import { shell, type Session } from './pages';

export async function renderAssistant(root: HTMLElement, session: Session) {
  void session;
  root.innerHTML = shell('asistente', t('phase3.titleAssistant'), t('phase3.subAssistant'), `
    <p class="muted">${t('phase3.modeHint')}</p>
    <div id="ai-error" class="err" hidden></div>
    <form id="ai-ask" class="cardx">
      <input name="question" required minlength="2" placeholder="${t('phase3.askPh')}">
      <button class="btn primary" type="submit">${t('phase3.send')}</button>
    </form>
    <article class="cardx" id="ai-box" hidden>
      <p class="draft" id="ai-mode"></p>
      <p id="ai-answer"></p>
    </article>
  `);
  const error = root.querySelector<HTMLElement>('#ai-error');
  const box = root.querySelector<HTMLElement>('#ai-box');
  root.querySelector('#ai-ask')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = String(new FormData(event.target as HTMLFormElement).get('question') || '');
    try {
      const answer = await api<{ mode: 'basico' | 'externo'; answer: string }>('/api/asistente', {
        method: 'POST',
        body: JSON.stringify({ question }),
      });
      if (box) box.hidden = false;
      const mode = root.querySelector('#ai-mode');
      const text = root.querySelector('#ai-answer');
      if (mode) mode.textContent = answer.mode === 'externo' ? t('phase3.modeExternal') : t('phase3.modeBasic');
      if (text) text.textContent = answer.answer;
    } catch (err) {
      if (!error) return;
      error.hidden = false;
      error.textContent = err instanceof Error ? err.message : t('common.error');
    }
  });
}
