/**
 * Mide FPS y llamadas de dibujo con N avatares, en escritorio y en un móvil emulado.
 * Uso: node scripts/bench-office.mjs http://127.0.0.1:5173/bench.html
 */
import { chromium } from 'playwright-core';

const target = process.argv[2] || 'http://127.0.0.1:5173/bench.html';
const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';

const desktop = { width: 1440, height: 900, deviceScaleFactor: 1.5, isMobile: false, hasTouch: false };
const phone = {
  width: 390,
  height: 844,
  deviceScaleFactor: 2.75,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
};

async function sample(browser, profile, label) {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    userAgent: profile.userAgent,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error(label, error.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.error(label, msg.text()); });
  await page.goto(`${target}${target.includes('?') ? '&' : '?'}n=100`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const bench = window.__hivexBench;
    return bench && bench.pending !== true;
  }, { timeout: 120000 });
  const result = await page.evaluate(() => window.__hivexBench);
  await context.close();
  return { label, ...result };
}

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--disable-dev-shm-usage',
  ],
});

const report = {
  at: new Date().toISOString(),
  desktop: await sample(browser, desktop, 'desktop'),
  phone: await sample(browser, phone, 'phone'),
};
await browser.close();
console.log(JSON.stringify(report, null, 2));
