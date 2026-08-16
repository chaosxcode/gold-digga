/**
 * rAF animation helpers for the symbol critical path (never GSAP here —
 * GSAP's global clock freezes-then-snaps under synchronous burst load).
 * Each loop self-guards against destroyed display objects and snaps to the
 * exact end value on its final frame.
 */
import { Container } from 'pixi.js';

export interface Timing {
  turbo: boolean;
  reduceMotion: boolean;
}

export const timing: Timing = { turbo: false, reduceMotion: false };

/** Global speed scale (turbo compresses, reduced-motion collapses). */
export function ms(standard: number, turbo?: number): number {
  if (timing.reduceMotion) return Math.min(standard, 120);
  return timing.turbo ? (turbo ?? standard * 0.5) : standard;
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInQuad = (t: number): number => t * t;

/** Generic rAF tween. onUpdate(k) gets eased progress 0..1. */
export function raf(
  duration: number,
  onUpdate: (k: number) => void,
  opts?: { delay?: number; ease?: (t: number) => number; guard?: () => boolean },
): Promise<void> {
  return new Promise((resolve) => {
    const ease = opts?.ease ?? easeOutCubic;
    const delay = opts?.delay ?? 0;
    const t0 = performance.now() + delay;
    const step = (now: number) => {
      if (opts?.guard && !opts.guard()) return resolve();
      if (now < t0) return void requestAnimationFrame(step);
      const k = duration <= 0 ? 1 : Math.min(1, (now - t0) / duration);
      onUpdate(ease(k));
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export const alive = (c: Container) => () => !c.destroyed;

export const wait = (msec: number): Promise<void> => new Promise((r) => setTimeout(r, msec));

/** Damped-sine squash (stretch wide while squashing tall, anti-phase). */
export async function squash(c: Container, amp = 0.14, duration = 260): Promise<void> {
  await raf(
    duration,
    (k) => {
      const s = amp * Math.sin(2.4 * Math.PI * k) * Math.pow(1 - k, 1.5);
      c.scale.set(1 + s, 1 - s);
    },
    { ease: (t) => t, guard: alive(c) },
  );
  if (!c.destroyed) c.scale.set(1, 1);
}
