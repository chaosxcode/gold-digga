/**
 * FX layer — pooled particles (soil confetti, gold sparks), amount floats,
 * board shake, and the big-win overlay. Particle motion is rAF; the big-win
 * DOM overlay handles tiers 5-7.
 */
import { Application, Container, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import { ms, raf, timing } from './anim';
import { moneyWin, moneyAbbrev } from './currency';
import { superTextFor } from './winlevels';
import { sw } from './social';
import { audio } from './audio';

let glowTex: Texture | null = null;
function getGlowTex(): Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,190,1)');
  grad.addColorStop(0.5, 'rgba(255,214,110,0.55)');
  grad.addColorStop(1, 'rgba(255,200,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = Texture.from(c);
  return glowTex;
}

export class Fx {
  readonly layer = new Container();
  private pool: Sprite[] = [];
  private live = 0;
  private maxLive = 140;

  constructor(private app: Application) {
    this.layer.eventMode = 'none';
  }

  private getP(): Sprite | null {
    if (this.live >= this.maxLive) return null;
    let s = this.pool.pop();
    if (!s) {
      s = new Sprite(getGlowTex());
      s.anchor.set(0.5);
      s.blendMode = 'add';
    }
    s.alpha = 1;
    s.scale.set(1);
    this.live++;
    this.layer.addChild(s);
    return s;
  }

  private release(s: Sprite): void {
    this.layer.removeChild(s);
    this.pool.push(s);
    this.live--;
  }

  /** Gold spark burst at a point (win pops, tag surfaces). */
  burst(x: number, y: number, count = 10, spread = 60, tint = 0xffd684): void {
    if (timing.reduceMotion) return;
    for (let i = 0; i < count; i++) {
      const s = this.getP();
      if (!s) return;
      s.tint = tint;
      s.position.set(x, y);
      const a = Math.random() * Math.PI * 2;
      const v = spread * (0.4 + Math.random() * 0.8);
      const dx = Math.cos(a) * v;
      const dy = Math.sin(a) * v - spread * 0.4;
      const sc = 0.25 + Math.random() * 0.5;
      void raf(
        ms(500 + Math.random() * 260, 320),
        (k) => {
          s.x = x + dx * k;
          s.y = y + dy * k + spread * 0.7 * k * k;
          s.alpha = 1 - k;
          s.scale.set(sc * (1 - k * 0.5));
        },
        { ease: (t) => t },
      ).then(() => this.release(s));
    }
  }

  /** Spark stream arcing from a board point to a HUD target (tag → meter). */
  flyTo(x0: number, y0: number, x1: number, y1: number, count = 5): void {
    if (timing.reduceMotion) return;
    for (let i = 0; i < count; i++) {
      const s = this.getP();
      if (!s) return;
      s.tint = 0xffd684;
      const cx = (x0 + x1) / 2 + (Math.random() - 0.5) * 80;
      const cy = Math.min(y0, y1) - 60 - Math.random() * 60;
      const sc = 0.3 + Math.random() * 0.35;
      void raf(
        ms(420 + Math.random() * 160, 260),
        (k) => {
          const u = 1 - k;
          s.x = u * u * x0 + 2 * u * k * cx + k * k * x1;
          s.y = u * u * y0 + 2 * u * k * cy + k * k * y1;
          s.alpha = k < 0.85 ? 1 : 1 - (k - 0.85) / 0.15;
          s.scale.set(sc * (1 - k * 0.35));
        },
        { ease: (t) => t, delay: i * 40 },
      ).then(() => this.release(s));
    }
  }

  /** Screen-wide gold storm for L6-7. */
  goldStorm(durationMs = 2200): void {
    if (timing.reduceMotion) return;
    const w = this.app.screen.width;
    const n = Math.min(70, Math.floor(w / 12));
    for (let i = 0; i < n; i++) {
      const s = this.getP();
      if (!s) return;
      s.tint = [0xffd684, 0xffedb0, 0xf0a848][i % 3];
      const x0 = Math.random() * w;
      const drift = (Math.random() - 0.5) * 140;
      const sc = 0.3 + Math.random() * 0.6;
      const dur = durationMs * (0.6 + Math.random() * 0.6);
      const H = this.app.screen.height;
      void raf(
        dur,
        (k) => {
          s.x = x0 + drift * k + Math.sin(k * 8 + i) * 18;
          s.y = -30 + (H + 60) * k;
          s.alpha = Math.min(1, (1 - k) * 2);
          s.scale.set(sc);
        },
        { ease: (t) => t, delay: Math.random() * durationMs * 0.5 },
      ).then(() => this.release(s));
    }
  }

  /** Floating amount at a tile: plated, bold, clamped to the safe area. */
  amountFloat(x: number, y: number, text: string, big = false): Promise<void> {
    const wrap = new Container();
    const t = new Text({
      text,
      style: new TextStyle({
        fontFamily: 'GDTitle, Baloo2',
        fontWeight: '800',
        fontSize: big ? 36 : 27,
        // teal to match the spin button + the celebration headlines (user) —
        // was cream-gold on a brown 0x6b4522 stroke, which read brown
        fill: 0xc9fff8,
        stroke: { color: 0x06231f, width: 6 },
        dropShadow: { distance: 3, blur: 6, alpha: 0.6, color: 0x04201c },
      }),
    });
    t.anchor.set(0.5);
    const plate = new Sprite(getGlowTex());
    plate.anchor.set(0.5);
    plate.tint = 0x2d2416;
    plate.blendMode = 'normal';
    plate.alpha = 0.55;
    plate.width = t.width + 44;
    plate.height = t.height + 22;
    wrap.addChild(plate, t);
    // clamp to the visible safe area so edge tiles never clip their amount
    const W = this.app.screen.width;
    const cx = Math.min(Math.max(x, t.width / 2 + 14), W - t.width / 2 - 14);
    wrap.position.set(cx, y);
    wrap.scale.set(0.4);
    this.layer.addChild(wrap);
    const hold = ms(big ? 1050 : 820, 460);
    return raf(hold, (k) => {
      if (wrap.destroyed) return;
      wrap.y = y - 38 * k;
      wrap.scale.set(0.4 + 0.65 * Math.min(1, k * 3));
      wrap.alpha = k > 0.74 ? 1 - (k - 0.74) / 0.26 : 1;
    }).then(() => wrap.destroy({ children: true }));
  }

  /** Tier-scaled shake on a target container (board only, never HUD). */
  shake(target: Container, amp = 6, durationMs = 380): void {
    if (timing.reduceMotion || target.destroyed) return;
    const ox = target.x;
    const oy = target.y;
    void raf(
      ms(durationMs, durationMs * 0.6),
      (k) => {
        const d = amp * (1 - k);
        target.x = ox + (Math.random() - 0.5) * d * 2;
        target.y = oy + (Math.random() - 0.5) * d * 2;
      },
      { ease: (t) => t },
    ).then(() => {
      target.x = ox;
      target.y = oy;
    });
  }
}

/** DOM big-win card (winLevel 5-7). Resolves on natural end or tap. */
export function bigWinCard(opts: {
  winX: number;
  amount: number;
  bet: number;
  level: number;
  isMaxWin: boolean;
  /** the active MODE's cap — capped buys (Deep Scan 500x) must never show 15,000x */
  maxWinX?: number;
  holdMs: number;
}): Promise<void> {
  const root = document.getElementById('bigwin')!;
  const tier = document.getElementById('bigwin-tier')!;
  const amountEl = document.getElementById('bigwin-amount')!;
  const tap = document.getElementById('bigwin-tap')!;
  const capX = opts.maxWinX ?? 15000;
  const label = opts.isMaxWin
    ? capX >= 15000
      ? "15,000x — THE KING'S RANSOM, DUG UP AT LAST"
      : `${capX.toLocaleString('en-US')}x MAX WIN — DUG TO THE LIMIT`
    : opts.level >= 7
      ? superTextFor(opts.winX)
      : opts.level === 6
        ? 'EPIC DIG'
        : 'MEGA HOARD';
  tier.textContent = sw(label);
  tap.textContent = sw('Tap to continue');
  // front-page newspaper banner on the biggest tiers (EPIC/MEGA+ and max win)
  root.classList.toggle('news', opts.isMaxWin || opts.level >= 6);
  // bold zoom-in tier banner: BIG (<100x) / MEGA (<500x) / EPIC (<max) / MAX
  const bt = opts.isMaxWin ? 'max' : opts.winX >= 500 ? 'epic' : opts.winX >= 100 ? 'mega' : 'big';
  (document.getElementById('bigwin-plaque-art') as HTMLImageElement).src = `assets/ui/win_${bt}_plaque.webp`;
  (document.getElementById('bigwin-letters') as HTMLImageElement).src = `assets/ui/win_${bt}_letters.webp`;
  root.classList.add('banner');
  root.classList.add('open');
  audio.duck(0.15);
  audio.play(opts.level >= 7 ? 'win_7' : opts.level === 6 ? 'win_6' : 'win_5');
  audio.play('coin_loop', { overlap: true });

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      root.classList.remove('open');
      root.classList.remove('banner');
      root.removeEventListener('pointerdown', finish);
      audio.duck(1);
      resolve();
    };
    root.style.pointerEvents = 'auto';
    root.addEventListener('pointerdown', finish);

    // count-up from 0 for drama
    const dur = ms(Math.min(3200, 900 + opts.winX * 18), 1400);
    const t0 = performance.now();
    const step = (now: number) => {
      if (done) return;
      const k = Math.min(1, (now - t0) / dur);
      const v = opts.amount * k;
      amountEl.textContent = v >= 1e6 ? moneyAbbrev(v) : moneyWin(v, opts.bet);
      if (k < 1) requestAnimationFrame(step);
      else setTimeout(finish, opts.holdMs);
    };
    requestAnimationFrame(step);
  }).then(() => {
    (document.getElementById('bigwin') as HTMLElement).style.pointerEvents = 'none';
  });
}
