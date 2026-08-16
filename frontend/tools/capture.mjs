// SWEEPER capture harness — taps through the loader gate, spins, and
// captures settled boards + a frame burst, portrait (primary) + landscape.
// Usage: node tools/capture.mjs [url] [outdir]
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'fs';

const URL = process.argv[2] || process.env.GAME_URL || 'http://localhost:5174/';
const OUT = process.argv[3] || process.env.OUT_DIR || './qa/shots';
const SPINS = Number(process.env.SPINS || 5);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });

async function session(name, width, height, frameBurst) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const shot = (tag) => page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
  await shot('00-loader');
  // through the gate
  const start = page.locator('#loader-start');
  if (await start.isVisible().catch(() => false)) await start.click();
  await page.waitForTimeout(800);
  await shot('01-idle');

  if (frameBurst) {
    await page.keyboard.press('Space');
    for (let i = 0; i < 14; i++) { await shot(`spin-frame-${String(i).padStart(2, '0')}`); await page.waitForTimeout(180); }
    await page.waitForTimeout(2000);
    await shot('02-settled');
  }
  for (let s = 1; s <= SPINS; s++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(3400);
    await shot(`spin-${s}-settled`);
  }
  // menu + info for chrome QA
  await page.click('#menu-btn').catch(() => {});
  await page.waitForTimeout(500);
  await shot('menu');
  await page.click('#open-info').catch(() => {});
  await page.waitForTimeout(600);
  await shot('info');
  await ctx.close();
  return errs;
}

const e1 = await session('portrait', 430, 932, true);
const e2 = await session('landscape', 1280, 720, false);
const e3 = await session('popout-s', 400, 225, false);
await browser.close();
const errs = [...new Set([...e1, ...e2, ...e3])];
console.log(`CAPTURE DONE -> ${OUT} | console errors: ${errs.length}`);
errs.slice(0, 12).forEach((e) => console.log('  ERR:', e.slice(0, 200)));
