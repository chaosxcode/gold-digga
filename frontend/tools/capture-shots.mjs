// Reusable slot screenshot harness — drives a running PixiJS slot in the SYSTEM
// Chrome (no browser download) and captures key states + a frame burst of a live
// spin, for vision-based QA. Portrait is primary; landscape is secondary.
//
// Usage:  node capture-shots.mjs
// Env:    GAME_URL (default http://localhost:5173/), OUT_DIR (default ./qa/shots),
//         SPINS (default 6), PORTRAIT (e.g. 430x932), LANDSCAPE (e.g. 1280x720)
// Requires: npm i -D playwright   (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1) + system Chrome.
import { chromium } from 'playwright'
import { mkdirSync, rmSync } from 'fs'

const URL = process.env.GAME_URL || 'http://localhost:5173/'
const OUT = process.env.OUT_DIR || './qa/shots'
const SPINS = Number(process.env.SPINS || 6)
const [pw, ph] = (process.env.PORTRAIT || '430x932').split('x').map(Number)
const [lw, lh] = (process.env.LANDSCAPE || '1280x720').split('x').map(Number)

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio']
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS })

async function session(name, width, height, frameBurst) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('canvas', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(6500) // let the loading screen finish + first board settle
  const shot = (tag) => page.screenshot({ path: `${OUT}/${name}-${tag}.png` })
  await shot('00-initial')

  if (frameBurst) {
    await page.keyboard.press('Space')
    for (let i = 0; i < 16; i++) { await shot(`spin-frame-${String(i).padStart(2, '0')}`); await page.waitForTimeout(160) }
    await page.waitForTimeout(1500)
    await shot('01-settled')
  }
  for (let s = 2; s <= SPINS; s++) {
    await page.keyboard.press('Space')
    await page.waitForTimeout(2600)
    await shot(`spin-${s}-settled`)
  }
  await ctx.close()
  return errs
}

const a = await session('portrait', pw, ph, true)
const b = await session('landscape', lw, lh, false)
await browser.close()
const uniq = [...new Set([...a, ...b])]
console.log('CAPTURE DONE ->', OUT, '| console errors:', uniq.length)
uniq.slice(0, 20).forEach((e) => console.log('  ERR:', e.slice(0, 200)))
