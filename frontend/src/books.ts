/**
 * SWEEPER book-event vocabulary — the math/frontend contract (design doc §5).
 *
 * One book per round: { id, payoutMultiplier (hundredths of bet), events[], criteria }.
 * Amounts inside events are hundredths-of-bet (100 = 1.00x). Wire money is micro-units.
 * Tile indices 0–35, row-major, row 0 top, col 0 left, on a 6×6 field.
 */

export type SymbolId =
  | 'H1' // King's Crown
  | 'H2' // Silver Chalice
  | 'H3' // Jewelled Ring
  | 'H4' // Golden Buckle
  | 'H5' // Hammered Penny
  | 'L1' // Horseshoe
  | 'L2' // Rusty Spoon
  | 'L3' // Bottle Cap
  | 'L4' // Ring Pull
  | 'SC' // Hoard Chest (scatter)
  | 'PP'; // The Pipe (stop tile)

export type Stratum = 0 | 1 | 2; // Topsoil | Georgian | King's Hoard

export type ModeId =
  | 'base_standard'
  | 'base_xl'
  | 'base_rally'
  | 'feature_deepscan'
  | 'feature_bigdig'
  | 'feature_nightdig';

export interface TagDrop {
  tile: number;
  value: number; // multiplier value (x2..x100)
  band: 1 | 2 | 3;
}

export interface EvReveal {
  index: number;
  type: 'reveal';
  board: SymbolId[]; // 36 entries, the truth for this stratum state (rendered face-down)
  stratumMap: Stratum[]; // 36 entries
  pipeTile: number | null;
  chestTiles: number[];
  mode: ModeId;
}

export interface EvSweepSegment {
  index: number;
  type: 'sweepSegment';
  tiles: number[]; // 1 = flip, 4-9 = flood
  kind: 'flip' | 'flood';
  beepStep: 1 | 2 | 3 | 4;
  tags: TagDrop[];
  coilPath: number[];
}

export interface EvUpdateSignalMeter {
  index: number;
  type: 'updateSignalMeter';
  value: number; // new meter total
  delta: number;
  source: 'tags' | 'deepScan';
}

export interface EvDeepScan {
  index: number;
  type: 'deepScan';
  meterBefore: number;
  meterAfter: number;
}

export interface WinGroup {
  symbol: SymbolId;
  count: number;
  tiles: number[];
  basePay: number; // hundredths of bet
  meter: number;
  amount: number; // basePay × meter (hundredths of bet)
  equation: string; // "12× Chalice 25.0x × SIGNAL x27 = 675.0x"
}

export interface EvWinInfo {
  index: number;
  type: 'winInfo';
  wins: WinGroup[];
  totalWin: number; // this evaluation's total (hundredths of bet)
}

export interface EvSetWin {
  index: number;
  type: 'setWin';
  amount: number;
  winLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export interface EvUpdateGrid {
  index: number;
  type: 'updateGrid';
  clearedTiles: number[];
  slides: Array<{ from: number; to: number }>;
  incoming: Array<{ tile: number; symbol: SymbolId; stratum: Stratum }>;
  newStratumMap: Stratum[];
  depthReached: Stratum;
}

export interface EvPipeStrike {
  index: number;
  type: 'pipeStrike';
  tile: number;
  gag: 'micro' | 'geyser';
  variant: 1 | 2 | 3;
  depthAtStrike: Stratum;
}

export interface EvSweepEnd {
  index: number;
  type: 'sweepEnd';
  reason: 'pipe' | 'quiet';
}

export interface EvFreeSpinTrigger {
  index: number;
  type: 'freeSpinTrigger';
  chestTiles: number[];
  totalSweeps: number;
  scatterPay: number; // hundredths of bet
  bonusMode: 'bigdig' | 'nightdig';
}

export interface EvSetTotalWin {
  index: number;
  type: 'setTotalWin';
  amount: number; // round-cumulative, monotonically increasing
}

export interface EvFinalWin {
  index: number;
  type: 'finalWin';
  amount: number; // must equal payoutMultiplier
}

export interface EvSweepStart {
  index: number;
  type: 'sweepStart';
  sweep: number;
  totalSweeps: number;
  stratumMap: Stratum[];
  meter: number;
  pipeTile: number | null;
  refills: Array<{ tile: number; symbol: SymbolId; stratum: Stratum }>;
  board?: SymbolId[]; // full field truth at sweep start (for resume fast-forward)
}

export interface EvRetrigger {
  index: number;
  type: 'retrigger';
  chestTiles: number[];
  addedSweeps: number;
  totalSweeps: number;
}

export interface EvBonusSummary {
  index: number;
  type: 'bonusSummary';
  totalWin: number;
  sweepsPlayed: number;
  deepestStratum: Stratum;
  peakMeter: number;
  topFind: { symbol: SymbolId; amount: number };
}

export type BookEvent =
  | EvReveal
  | EvSweepSegment
  | EvUpdateSignalMeter
  | EvDeepScan
  | EvWinInfo
  | EvSetWin
  | EvUpdateGrid
  | EvPipeStrike
  | EvSweepEnd
  | EvFreeSpinTrigger
  | EvSetTotalWin
  | EvFinalWin
  | EvSweepStart
  | EvRetrigger
  | EvBonusSummary;

export type BookCriteria =
  | 'dead'
  | 'nearmiss'
  | 'small'
  | 'nice'
  | 'big'
  | 'mega'
  | 'epic'
  | 'trigger'
  | 'maxwin';

export interface Book {
  id: number;
  payoutMultiplier: number; // hundredths of bet (finalWin must equal this)
  events: BookEvent[];
  criteria: BookCriteria;
}

// --- Static tables shared by generator, presenter, and info tab ---

export const COLS = 6;
export const ROWS = 6;
export const TILES = COLS * ROWS;
export const MIN_MATCH = 8;
export const MAX_WIN_X = 15000; // x-bet; deepscan mode caps at 500

/** Pays in hundredths-of-bet by count band: [8-9, 10-11, 12+] */
export const PAYTABLE: Record<Exclude<SymbolId, 'SC' | 'PP'>, [number, number, number]> = {
  H1: [1000, 2500, 5000],
  H2: [400, 1000, 2500],
  H3: [250, 600, 1500],
  H4: [150, 400, 1000],
  H5: [100, 250, 750],
  L1: [80, 180, 500],
  L2: [60, 150, 400],
  L3: [50, 120, 300],
  L4: [40, 100, 250],
};

/** Scatter chest pays by count: 3 → 200, 4 → 500, 5+ → 1000 (hundredths of bet). */
export function scatterPay(count: number): number {
  if (count >= 5) return 1000;
  if (count === 4) return 500;
  if (count === 3) return 200;
  return 0;
}

export const SYMBOL_NAMES: Record<SymbolId, string> = {
  H1: 'Money Bag',
  H2: 'Gold Skull',
  H3: 'Diamond',
  H4: 'Gold Chain',
  H5: 'Coin Stack',
  L1: 'Ray Gun',
  L2: 'Voodoo Doll',
  L3: 'Smokes',
  L4: 'Garbage',
  SC: 'Loot Chest',
  PP: 'Toxic Ooze',
};

export const TAG_BANDS: Record<1 | 2 | 3, number[]> = {
  1: [2, 3, 4, 5],
  2: [6, 8, 10, 15, 20],
  3: [25, 50, 100],
};

export interface ModeMeta {
  id: ModeId;
  label: string;
  cost: number; // x bet
  maxWinX: number;
  rtp: string; // displayed to the last decimal
  bonus: boolean;
}

export const MODES: Record<ModeId, ModeMeta> = {
  base_standard: { id: 'base_standard', label: 'Standard Coil', cost: 1, maxWinX: 15000, rtp: '96.65', bonus: false },
  base_xl: { id: 'base_xl', label: 'XL Deep Coil', cost: 1, maxWinX: 15000, rtp: '96.65', bonus: false },
  base_rally: { id: 'base_rally', label: 'Rally', cost: 1.25, maxWinX: 15000, rtp: '96.65', bonus: false },
  feature_deepscan: { id: 'feature_deepscan', label: 'Deep Scan Sweep', cost: 5, maxWinX: 500, rtp: '96.65', bonus: false },
  feature_bigdig: { id: 'feature_bigdig', label: 'The Big Dig', cost: 80, maxWinX: 15000, rtp: '96.65', bonus: true },
  feature_nightdig: { id: 'feature_nightdig', label: 'Night Dig', cost: 400, maxWinX: 15000, rtp: '96.65', bonus: true },
};

/** Row/col helpers. */
export const rowOf = (t: number): number => Math.floor(t / COLS);
export const colOf = (t: number): number => t % COLS;
export const tileAt = (row: number, col: number): number => row * COLS + col;

export function neighbors(t: number): number[] {
  const r = rowOf(t);
  const c = colOf(t);
  const out: number[] = [];
  if (r > 0) out.push(tileAt(r - 1, c));
  if (r < ROWS - 1) out.push(tileAt(r + 1, c));
  if (c > 0) out.push(tileAt(r, c - 1));
  if (c < COLS - 1) out.push(tileAt(r, c + 1));
  return out;
}

/** Equation line: "12× Chalice 25.0x × SIGNAL x27 = 675.0x" (base word swapped at display). */
export function equationLine(count: number, symbol: SymbolId, basePay: number, meter: number, amount: number): string {
  const short = SYMBOL_NAMES[symbol].replace(/^The /, '').split(' ').pop();
  const fmt = (h: number) => (h / 100).toFixed(h % 100 === 0 ? 0 : 1);
  return `${count}× ${short} ${fmt(basePay)}x × SIGNAL x${meter} = ${fmt(amount)}x`;
}
