import './styles.css';
import { BRAND_NAME, BRAND_TAGLINE } from './config';
import { officeMap } from './data/officeMap';
import { Game } from './game/game';
import { SimulatedMediaProvider } from './media/proximityMedia';
import { LocalTransport } from './net/transport';
import { UI } from './ui/ui';
import markUrl from './assets/hivex-mark.png';
import wordmarkUrl from './assets/hivex-wordmark.png';
import logoUrl from './assets/hivex-logo.png';
import faviconUrl from './assets/hivex-favicon.png';

document.title = `${BRAND_NAME} · ${BRAND_TAGLINE}`;
(document.getElementById('favicon') as HTMLLinkElement).href = faviconUrl;

// PWA: manifest + service worker solo cuando se sirve por http(s) (no en el HTML único abierto con doble clic).
if (import.meta.env.MODE !== 'single' && location.protocol.startsWith('http')) {
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = './manifest.webmanifest';
  document.head.append(link);
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
    img.src = src;
  });
}

async function boot() {
  const emblem = await loadImage(markUrl);
  const canvas = document.createElement('canvas');
  canvas.id = 'game';
  document.body.append(canvas);

  const media = new SimulatedMediaProvider();
  const game = new Game(canvas, officeMap, { transport: new LocalTransport(), media, emblem });
  new UI(document.getElementById('app')!, game, media, { mark: markUrl, wordmark: wordmarkUrl, logo: logoUrl });
  game.start();

  // Acceso para depuración / capturas automáticas.
  (window as unknown as { __game: Game }).__game = game;
}

void boot();
