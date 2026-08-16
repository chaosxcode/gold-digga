// Full QA sweep — screenshots of every state + automated checks:
// social-mode leak scan, geometry overlap probes, console/network cleanliness.
// Usage: node tools/qa-full.mjs [url] [outdir]
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

const URL = process.argv[2] || 'http://localhost:5174/';
const OUT = process.argv[3] || './qa/full';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });
const report = { consoleErrors: [], badRequests: [], socialLeaks: [], overlaps: [], notes: [] };

async function newPage(w, h, url) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => report.consoleErrors.push(String(e).slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400) report.badRequests.push(`${r.status()} ${r.url().slice(-80)}`); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  return { ctx, page };
}

const shot = (page, tag) => page.screenshot({ path: `${OUT}/${tag}.png` });
const start = async (page) => {
  await page.waitForSelector('#loader-start', { state: 'visible', timeout: 25000 }).catch(() => {});
  await page.locator('#loader-start').click({ timeout: 5000 }).catch(() => {});
  await page.waitForSelector('#loader', { state: 'hidden', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
};

// ---------- 1. portrait main flows ----------
try {
  const { ctx, page } = await newPage(430, 932, URL);
  await start(page);
  await shot(page, 'p-01-idle');

  // geometry: nothing may overlap the board; spin button in thumb zone
  const geo = await page.evaluate(() => {
    const r = (id) => document.getElementById(id)?.getBoundingClientRect();
    return { top: r('topbar'), controls: r('controls'), footer: r('footer'), slot: r('board-slot') };
  });
  if (geo.controls && geo.slot && geo.controls.top < geo.slot.bottom - 2) {
    report.overlaps.push(`portrait: controls (${geo.controls.top}) overlap board slot bottom (${geo.slot.bottom})`);
  }

  await page.evaluate(() => window.__hs.spin('big'));
  await page.waitForTimeout(5200);
  await shot(page, 'p-02-big-mid');
  await page.waitForTimeout(6000);
  await shot(page, 'p-03-big-settled');

  await page.evaluate(() => window.__hs.spin('mega'));
  await page.waitForTimeout(9000);
  await shot(page, 'p-04-mega');
  await page.waitForTimeout(7000);

  // bonus: trigger card, sweeps, summary card
  await page.evaluate(() => window.__hs.spin('trigger'));
  await page.waitForTimeout(6500);
  await shot(page, 'p-05-trigger-card');
  await page.locator('#fc-btn').click().catch(() => {});
  await page.waitForTimeout(6000);
  await shot(page, 'p-06-bonus-sweep');
  // wait for summary card (long)
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    if (await page.locator('#feature-card.open').isVisible().catch(() => false)) break;
  }
  await shot(page, 'p-07-summary-card');
  await page.locator('#fc-btn').click().catch(() => {});
  await page.waitForTimeout(2500);
  await shot(page, 'p-08-after-bonus');

  // modals
  await page.locator('#menu-btn').click();
  await page.waitForTimeout(400);
  await shot(page, 'p-09-menu');
  await page.locator('#open-buy').click();
  await page.waitForTimeout(400);
  await shot(page, 'p-10-buy');
  await page.locator('.buy-card[data-buy="feature_bigdig"]').click();
  await page.locator('#buy-accept').click();
  await page.waitForTimeout(500);
  await shot(page, 'p-11-buy-confirm');
  await page.locator('#confirm-cancel').click();
  await page.waitForTimeout(300);
  await page.locator('#menu-btn').click();
  await page.waitForTimeout(300);
  await page.locator('#open-info').click();
  await page.waitForTimeout(400);
  await shot(page, 'p-12-info-how');
  await page.locator('.info-tab[data-page="pays"]').click();
  await shot(page, 'p-13-info-pays');
  await page.locator('.info-tab[data-page="rtp"]').click();
  await shot(page, 'p-14-info-rtp');
  await page.locator('.info-tab[data-page="legal"]').click();
  await shot(page, 'p-15-info-legal');
  await page.locator('#m-info [data-close]').first().click();

  // autoplay modal
  await page.locator('#auto-btn').click();
  await page.waitForTimeout(300);
  await shot(page, 'p-16-autoplay');
  await page.locator('#auto-counts [data-n="10"]').click();
  await page.locator('#auto-start').click();
  await page.waitForTimeout(1500);
  await shot(page, 'p-17-autoplay-running');
  await page.locator('#spin-btn').click(); // stop autoplay
  await page.waitForTimeout(400);
  await ctx.close();
} catch (e) { report.notes.push('section failed: ' + String(e).slice(0, 160)); }

// ---------- 2. night dig ----------
try {
  const { ctx, page } = await newPage(430, 932, URL);
  await start(page);
  await page.evaluate(() => window.__hs.spin('nice', 'feature_nightdig'));
  await page.waitForTimeout(6500);
  await shot(page, 'p-20-night-card');
  await page.locator('#fc-btn').click().catch(() => {});
  await page.waitForTimeout(7000);
  await shot(page, 'p-21-night-sweep');
  await ctx.close();
} catch (e) { report.notes.push('section failed: ' + String(e).slice(0, 160)); }

// ---------- 3. social mode + leak scan ----------
try {
  const { ctx, page } = await newPage(430, 932, URL + '?social=true');
  await start(page);
  await shot(page, 's-01-idle');
  const scan = async (tag) => {
    const leaks = await page.evaluate(() => {
      const words = /\b(bet|bets|betting|buy|buys|bought|purchase|cash|money|wager|gamble|stake|deposit|withdraw|credit|credits|fund|funds|currency|rebet|payer|costing|total bet|bonus buy|buy bonus|pay|pays|paid)\b/gi;
      const out = [];
      // walk visible text nodes, honouring data-no-swap (mandated-verbatim
      // copy like the legal disclaimer) exactly like the game's own sweep
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const el = n.parentElement;
          if (!el || el.closest('[data-no-swap],script,style')) return NodeFilter.FILTER_REJECT;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent || '';
        const m = t.match(words);
        if (m) out.push(`${t.trim().slice(0, 70)} -> ${[...new Set(m)].join(',')}`);
      }
      document.querySelectorAll('[aria-label],[title]').forEach((el) => {
        if (el.closest('[data-no-swap]')) return;
        for (const a of ['aria-label', 'title']) {
          const v = el.getAttribute(a);
          if (v && v.match(words)) out.push(`[${a}] ${v}`);
        }
      });
      // any $ in visible text?
      if (document.body.innerText.includes('$')) out.push('LITERAL $ FOUND');
      return out;
    });
    for (const l of leaks) report.socialLeaks.push(`${tag}: ${l}`);
  };
  await scan('idle');
  await page.locator('#menu-btn').click();
  await page.waitForTimeout(300);
  await scan('menu');
  await shot(page, 's-02-menu');
  await page.locator('#open-buy').click();
  await page.waitForTimeout(300);
  await scan('buy');
  await shot(page, 's-03-buy');
  await page.locator('#m-buy [data-close]').first().click();
  await page.locator('#menu-btn').click();
  await page.locator('#open-info').click();
  await page.waitForTimeout(300);
  for (const pg of ['how', 'pays', 'signals', 'bigdig', 'modes', 'rtp', 'ui', 'legal']) {
    await page.locator(`.info-tab[data-page="${pg}"]`).click().catch(() => {});
    await page.waitForTimeout(120);
    await scan(`info-${pg}`);
  }
  await shot(page, 's-04-info');
  await page.locator('#m-info [data-close]').first().click();
  await page.evaluate(() => window.__hs.spin('nice'));
  await page.waitForTimeout(6000);
  await scan('after-win');
  await shot(page, 's-05-win');
  await ctx.close();
} catch (e) { report.notes.push('section failed: ' + String(e).slice(0, 160)); }

// ---------- 4. replay mode (local demo synth) ----------
try {
  const { ctx, page } = await newPage(430, 932, URL + '?replay=true&event=7&amount=1000000&mode=BASE');
  await page.waitForTimeout(2500);
  await shot(page, 'r-01-gate');
  await page.locator('#replay-play').click().catch(() => {});
  await page.waitForTimeout(5000);
  await shot(page, 'r-02-playing');
  await ctx.close();
} catch (e) { report.notes.push('section failed: ' + String(e).slice(0, 160)); }

// ---------- 5. small viewports ----------
try {
for (const [name, w, h] of [['popout-s', 400, 225], ['mobile-s', 320, 568], ['landscape', 1280, 720]]) {
  const { ctx, page } = await newPage(w, h, URL);
  await start(page);
  await shot(page, `v-${name}-idle`);
  const overlap = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const c = r('controls'), t = r('topbar'), s = r('board-slot');
    // 2D test: side-column layouts legitimately share vertical range
    const hits = (a, b) => a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2;
    // horizontal overflow: every control must sit fully inside the viewport
    const off = [];
    for (const el of document.querySelectorAll('#controls button, #bet-box, .money-block')) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && (b.right > innerWidth + 1 || b.left < -1)) off.push(el.id || el.className);
    }
    return { slotUnderTopbar: hits(s, t), controlsOverSlot: hits(s, c), off };
  });
  if (overlap.slotUnderTopbar) report.overlaps.push(`${name}: board slot under topbar`);
  if (overlap.controlsOverSlot) report.overlaps.push(`${name}: controls over board slot`);
  for (const o of overlap.off) report.overlaps.push(`${name}: off-screen control ${o}`);
  await page.evaluate(() => window.__hs.spin('nice'));
  await page.waitForTimeout(5500);
  await shot(page, `v-${name}-win`);
  await ctx.close();
}
} catch (e) { report.notes.push('section failed: ' + String(e).slice(0, 160)); }

await browser.close();
report.consoleErrors = [...new Set(report.consoleErrors)];
report.badRequests = [...new Set(report.badRequests)];
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log('QA FULL DONE');
console.log('console errors:', report.consoleErrors.length, '| bad requests:', report.badRequests.length,
  '| social leaks:', report.socialLeaks.length, '| overlaps:', report.overlaps.length);
report.socialLeaks.slice(0, 10).forEach((l) => console.log('  LEAK:', l));
report.consoleErrors.slice(0, 5).forEach((l) => console.log('  ERR:', l));
report.overlaps.forEach((l) => console.log('  OVERLAP:', l));
