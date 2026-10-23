// Capturas automáticas con Chromium headless (playwright-core).
// Uso: npm run build && npm run screenshots   (CHROME_PATH=/ruta/a/chrome opcional)
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const file = resolve('dist-single/oficina-virtual.html');
if (!existsSync(file)) { console.error('Primero ejecuta: npm run build'); process.exit(1); }
const url = pathToFileURL(file).href;
mkdirSync('screenshots', { recursive: true });
const executablePath = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function open(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__game);
  await wait(800);
  return { ctx, page };
}

// ───────── Escritorio 1280x800 ─────────
{
  const { ctx, page } = await open({ viewport: { width: 1280, height: 800 } });
  await page.screenshot({ path: 'screenshots/01-vista-inicial.png' });

  // Acercarse a Javier y Carmen (charlando en la plaza) con el teclado
  await page.evaluate(() => window.__game.teleport(36, 25));
  await page.keyboard.down('a'); await wait(380); await page.keyboard.up('a');
  await page.keyboard.down('w'); await wait(600); await page.keyboard.up('w');
  await wait(500);
  await page.screenshot({ path: 'screenshots/02-proximidad.png' });

  // Modo coche por la plaza / pasillo
  await page.evaluate(() => { window.__game.teleport(44, 22); });
  await page.keyboard.press('c');
  await page.keyboard.down('d'); await wait(350); await page.keyboard.up('d');
  await page.keyboard.press('h');
  await wait(150);
  await page.screenshot({ path: 'screenshots/03-modo-coche.png' });

  // Sala de reuniones
  await page.keyboard.press('c');
  await page.evaluate(() => { window.__game.teleport(36, 12); });
  await wait(900);
  await page.screenshot({ path: 'screenshots/04-sala-reuniones.png' });

  // Click-to-move hacia el café
  await page.evaluate(() => { window.__game.teleport(24, 22); window.__game.moveTo(14 * 32, 31 * 32); });
  await wait(900);
  await page.screenshot({ path: 'screenshots/05-click-para-mover.png' });
  await ctx.close();
}

// ───────── Móvil 390x844 (táctil) ─────────
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
{
  const { ctx, page } = await open(mobile);
  await page.screenshot({ path: 'screenshots/m01-movil-inicial.png' });

  // Tap-to-move: tocar cerca de los compañeros de la plaza
  await page.evaluate(() => window.__game.teleport(36, 26));
  await wait(300);
  const pt = await page.evaluate(() => {
    const g = window.__game, c = g.camera, r = document.getElementById('game').getBoundingClientRect();
    const wx = 34.5 * 32, wy = 22.2 * 32;
    return { x: r.left + (wx - c.left) * c.zoom, y: r.top + (wy - c.top) * c.zoom };
  });
  await page.touchscreen.tap(pt.x, pt.y);
  await wait(1600);
  await page.screenshot({ path: 'screenshots/m02-movil-tap-proximidad.png' });

  // Drawer de personas abierto
  await page.locator('.menu-btn').tap();
  await wait(400);
  await page.screenshot({ path: 'screenshots/m03-movil-panel.png' });
  await page.locator('.scrim').tap({ position: { x: 360, y: 400 } });
  await wait(300);

  // Modo coche + joystick
  await page.locator('.pill.car').tap();
  await page.evaluate(() => window.__game.teleport(44, 22));
  const joy = await page.locator('.joystick').boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const jx = joy.x + joy.width / 2, jy = joy.y + joy.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jx, y: jy }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: jx + 40, y: jy - 6 }] });
  await wait(450);
  await page.screenshot({ path: 'screenshots/m04-movil-coche-joystick.png' });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await ctx.close();
}
// Horizontal
{
  const { ctx, page } = await open({ ...mobile, viewport: { width: 844, height: 390 } });
  await page.screenshot({ path: 'screenshots/m05-movil-horizontal.png' });
  await ctx.close();
}

await browser.close();
if (errors.length) { console.error('Errores en consola:\n' + errors.join('\n')); process.exitCode = 1; }
else console.log('✔ Capturas guardadas en screenshots/');
