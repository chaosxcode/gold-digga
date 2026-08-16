/**
 * Win-tier ladder — aligned with the official SDK's 7 winLevels.
 * Thresholds are in x-bet. Presentation duration scales with the tier;
 * tiers 1-5 are lightweight (no board-covering card), 6-7 earn the full
 * celebration (banner + count-up + particles + audio escalation).
 */

export interface WinLevel {
  level: number;
  alias: string;
  text: string | null;
  minX: number; // inclusive lower bound in x-bet
  presentMs: number; // settle/hold time for the win beat
  countUpMs: number; // count-up duration for the meter/banner
}

export const WIN_LEVELS: WinLevel[] = [
  { level: 1, alias: 'zero', text: null, minX: 0, presentMs: 0, countUpMs: 0 },
  { level: 2, alias: 'standard', text: null, minX: 0.000001, presentMs: 600, countUpMs: 400 },
  { level: 3, alias: 'small', text: null, minX: 1, presentMs: 1000, countUpMs: 600 },
  { level: 4, alias: 'nice', text: null, minX: 5, presentMs: 1500, countUpMs: 900 },
  { level: 5, alias: 'substantial', text: null, minX: 10, presentMs: 2000, countUpMs: 1200 },
  { level: 6, alias: 'big', text: 'BIG WIN', minX: 25, presentMs: 5200, countUpMs: 2400 },
  { level: 7, alias: 'super', text: 'SUPER WIN', minX: 60, presentMs: 6500, countUpMs: 3200 },
];

/** Extra celebratory ceilings inside level 7 presentation (MEGA/EPIC naming). */
export const SUPER_TIERS = [
  { minX: 60, text: 'SUPER WIN' },
  { minX: 150, text: 'MEGA WIN' },
  { minX: 500, text: 'EPIC WIN' },
  { minX: 2500, text: 'MAX WIN' },
];

export function winLevelFor(winX: number): WinLevel {
  let out = WIN_LEVELS[0];
  for (const l of WIN_LEVELS) if (winX >= l.minX) out = l;
  return out;
}

export function superTextFor(winX: number): string {
  let t = SUPER_TIERS[0].text;
  for (const s of SUPER_TIERS) if (winX >= s.minX) t = s.text;
  return t;
}
