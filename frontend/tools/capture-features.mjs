// Feature capture — uses the demo dev hook to force outcome buckets and
// photograph the full presentation: tags/meter, wins, trigger, bonus, night.
// Usage: node tools/capture-features.mjs [url] [outdir]
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'fs';

const URL = process.argv[2] || 'http://localhost:5174/';
const OUT = process.argv[3] || './qa/features';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.locator('#loader-start').click();
await page.waitForTimeout(700);

const shot = (tag) => page.screenshot({ path: `${OUT}/${tag}.png` });

async function force(criteria, mode, frames, gapMs, tag) {
  await page.evaluate(([c, m]) => window.__hs.spin(c, m), [criteria, mode]);
  for (let i = 0; i < frames; i++) {
    await page.waitForTimeout(gapMs);
    await shot(`${tag}-f${String(i).padStart(2, '0')}`);
  }
  // let it settle fully
  await page.waitForTimeout(6000);
  await shot(`${tag}-settled`);
}

await force('nice', null, 8, 700, '01-nice');
await force('big', null, 10, 800, '02-big');
await force('mega', null, 12, 900, '03-mega');
await force('trigger', null, 20, 1400, '04-trigger-bigdig');
await page.waitForTimeout(12000); // bonus tail
await shot('04-trigger-done');
await force('epic', 'feature_nightdig', 24, 1600, '05-nightdig');
await page.waitForTimeout(20000);
await shot('05-nightdig-done');

await ctx.close();
await browser.close();
console.log(`FEATURES DONE -> ${OUT} | console errors: ${errs.length}`);
errs.slice(0, 10).forEach((e) => console.log('  ERR:', e.slice(0, 200)));
