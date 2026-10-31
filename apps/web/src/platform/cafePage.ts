import { t } from '../i18n';
import { api, esc } from './api';
import { shell, type Session } from './pages';

interface CafeHome {
  season: { code: string; name: string; multiplier: number };
  rewarded: number;
  limit: number;
  best: number;
}

const PATTERNS = ['gold', 'ring', 'stripe', 'dot'];

export async function renderCafe(root: HTMLElement, session: Session) {
  void session;
  const home = await api<CafeHome>('/api/cafe');
  root.innerHTML = shell('cafe', t('phase3.titleCafe'), t('phase3.subCafe'), `
    <p class="draft">${esc(t('phase3.season'))}: ${esc(home.season.name)}${home.season.multiplier > 1 ? ` ×${home.season.multiplier}` : ''}</p>
    <p class="muted" id="cafe-count">${esc(t('phase3.plays'))}: ${home.rewarded}/${home.limit}</p>
    <div id="cafe-error" class="err" hidden></div>
    <div class="cmp-grid">
      <article class="cardx">
        <h2>${t('phase3.gameTaza')}</h2>
        <button class="cup" id="cup" type="button" aria-label="${t('phase3.gameTaza')}"></button>
        <p id="cup-label" class="muted">${t('phase3.tazaWait')}</p>
        <button class="btn primary" id="cup-start" type="button">${t('phase3.tazaGo')}</button>
      </article>
      <article class="cardx">
        <h2>${t('phase3.gameMemo')}</h2>
        <div class="memo-grid" id="memo"></div>
        <button class="btn primary" id="memo-start" type="button">${t('phase3.memoStart')}</button>
      </article>
    </div>
    <p id="cafe-result" class="draft"></p>
  `);
  const error = root.querySelector<HTMLElement>('#cafe-error');
  const result = root.querySelector<HTMLElement>('#cafe-result');
  const count = root.querySelector<HTMLElement>('#cafe-count');
  const show = async (path: string, body: unknown) => {
    try {
      const played = await api<{ awarded: number; capped: boolean }>(path, { method: 'POST', body: JSON.stringify(body) });
      if (result) result.textContent = `${t('phase3.result')}: ${played.awarded}${played.capped ? `. ${t('phase3.capped')}` : ''}`;
      const next = await api<CafeHome>('/api/cafe');
      if (count) count.textContent = `${t('phase3.plays')}: ${next.rewarded}/${next.limit}`;
    } catch (err) {
      if (!error) return;
      error.hidden = false;
      error.textContent = err instanceof Error ? err.message : t('common.error');
    }
  };

  const cup = root.querySelector<HTMLButtonElement>('#cup');
  const label = root.querySelector<HTMLElement>('#cup-label');
  let armed = 0;
  let readyAt = 0;
  root.querySelector('#cup-start')?.addEventListener('click', () => {
    if (!cup || !label) return;
    cup.classList.remove('now');
    label.textContent = t('phase3.tazaWait');
    window.clearTimeout(armed);
    const wait = 700 + Math.floor(Math.random() * 1400);
    const started = performance.now();
    armed = window.setTimeout(() => {
      cup.classList.add('now');
      label.textContent = t('phase3.tazaNow');
      readyAt = performance.now();
    }, wait);
    cup.onclick = () => {
      if (!cup.classList.contains('now')) {
        window.clearTimeout(armed);
        void show('/api/cafe/jugar', { game: 'taza', elapsedMs: 10 });
        return;
      }
      const elapsed = Math.round(performance.now() - (readyAt || started));
      cup.classList.remove('now');
      void show('/api/cafe/jugar', { game: 'taza', elapsedMs: elapsed });
    };
  });

  const board = root.querySelector<HTMLElement>('#memo');
  root.querySelector('#memo-start')?.addEventListener('click', () => {
    if (!board) return;
    const deck = [...PATTERNS, ...PATTERNS].sort(() => Math.random() - 0.5);
    let open: HTMLButtonElement[] = [];
    let matched = 0;
    let moves = 0;
    board.innerHTML = deck.map((pat, index) => `<button class="memo-card" type="button" data-i="${index}" data-pat="${pat}"></button>`).join('');
    board.querySelectorAll<HTMLButtonElement>('.memo-card').forEach((card) => {
      card.onclick = () => {
        if (card.classList.contains('open') || open.length === 2) return;
        card.classList.add('open', `pat-${card.dataset.pat}`);
        open.push(card);
        if (open.length < 2) return;
        moves += 1;
        const [a, b] = open;
        if (a.dataset.pat === b.dataset.pat) {
          matched += 1;
          open = [];
          if (matched === PATTERNS.length) void show('/api/cafe/jugar', { game: 'memoria', moves });
        } else {
          window.setTimeout(() => {
            a.classList.remove('open', `pat-${a.dataset.pat}`);
            b.classList.remove('open', `pat-${b.dataset.pat}`);
            open = [];
          }, 450);
        }
      };
    });
  });
}
