/**
 * Mock book generator — fabricates valid SWEEPER books (design doc §14).
 *
 * Frontend-only stand-in for the math package: every book it emits obeys the
 * event-vocabulary invariants (§5) and content rules (§4.3 beep grammar,
 * ≥6 reveals before any pipe, geyser only at depth ≥1, finalWin ==
 * payoutMultiplier, setTotalWin monotonic). Buckets bias generation
 * parameters; rejection sampling lands the payout in the bucket's band.
 */
import {
  Book,
  BookCriteria,
  BookEvent,
  COLS,
  EvSweepSegment,
  MIN_MATCH,
  MODES,
  ModeId,
  PAYTABLE,
  ROWS,
  Stratum,
  SymbolId,
  TAG_BANDS,
  TILES,
  TagDrop,
  WinGroup,
  equationLine,
  neighbors,
  scatterPay,
} from '../books';
import { Rng } from './rng';

// --- symbol weights per stratum (deeper = richer) ---
const WEIGHTS: Record<Stratum, Array<[SymbolId, number]>> = {
  0: [
    ['L4', 22], ['L3', 20], ['L2', 18], ['L1', 15],
    ['H5', 9], ['H4', 7], ['H3', 5], ['H2', 3], ['H1', 1],
  ],
  1: [
    ['L4', 14], ['L3', 14], ['L2', 13], ['L1', 12],
    ['H5', 13], ['H4', 11], ['H3', 9], ['H2', 6], ['H1', 3],
  ],
  2: [
    ['L4', 6], ['L3', 6], ['L2', 7], ['L1', 8],
    ['H5', 14], ['H4', 14], ['H3', 15], ['H2', 12], ['H1', 8],
  ],
};

const TAG_DENSITY: Record<Stratum, number> = { 0: 0.055, 1: 0.1, 2: 0.17 };

interface GenParams {
  mode: ModeId;
  /** richness multiplier applied to high-symbol weights */
  rich: number;
  /** tag density multiplier */
  tagMul: number;
  /** band shift: probability mass toward higher tag bands (0..1) */
  tagHot: number;
  /** target number of dig-deeper steps to *allow* (evaluations produce them) */
  digBias: number;
  /** chests to seed on the initial board */
  chests: number;
  /** place a pipe, and reveal-length window [min,max] before it strikes */
  pipeAfter: [number, number] | null;
  /** force a deepScan event */
  deepScan: boolean;
  /** bonus sweeps (0 = base spin) */
  sweeps: number;
  /** night dig rules */
  night: boolean;
  /** start stratum */
  startStratum: Stratum;
  /** chance a sweep ends quiet before revealing everything */
  quietEarly: number;
  /** retrigger inside bonus */
  retrigger: boolean;
}

interface FieldState {
  board: SymbolId[];
  strata: Stratum[];
  revealed: boolean[];
  tags: Map<number, TagDrop>;
  pipeTile: number | null;
  depth: Stratum;
  meterTags: number[]; // surfaced tag values (sum = meter when non-empty)
}

function meterOf(f: FieldState): number {
  return f.meterTags.length ? f.meterTags.reduce((a, b) => a + b, 0) : 1;
}

function drawSymbol(rng: Rng, stratum: Stratum, rich: number): SymbolId {
  const pairs = WEIGHTS[stratum].map(([s, w]) => {
    const isHigh = s.startsWith('H');
    return [s, isHigh ? w * rich : w] as [SymbolId, number];
  });
  return rng.weighted(pairs);
}

function drawTag(rng: Rng, stratum: Stratum, hot: number, night: boolean): Omit<TagDrop, 'tile'> {
  const bandW: Array<[1 | 2 | 3, number]> =
    stratum === 2
      ? [[1, 3 - hot * 2], [2, 3], [3, 1.2 + hot * 3]]
      : stratum === 1
        ? [[1, 5 - hot * 2], [2, 2.5 + hot], [3, 0.35 + hot]]
        : [[1, 7], [2, 1 + hot], [3, 0.08 + hot * 0.3]];
  const band = rng.weighted(bandW);
  let value = rng.pick(TAG_BANDS[band]);
  if (night) value *= 2;
  return { value, band };
}

/**
 * Build a contiguous flood group of n unrevealed tiles seeded at `seed`.
 * The pipe tile is excluded from candidates so filtering can never break
 * contiguity; expansion order guarantees each tile touches an earlier one.
 */
function floodGroup(rng: Rng, f: FieldState, seed: number, n: number): number[] {
  const ok = (t: number) => !f.revealed[t] && t !== f.pipeTile;
  const group = [seed];
  const frontier = new Set(neighbors(seed).filter((t) => ok(t) && !group.includes(t)));
  while (group.length < n && frontier.size) {
    const arr = [...frontier];
    const t = arr[rng.int(arr.length)];
    frontier.delete(t);
    group.push(t);
    for (const nb of neighbors(t)) {
      if (ok(nb) && !group.includes(nb) && !frontier.has(nb)) frontier.add(nb);
    }
  }
  return group;
}

interface BuildCtx {
  rng: Rng;
  p: GenParams;
  events: BookEvent[];
  idx: number;
  totalCents: number; // cumulative win (hundredths of bet), raw
  capCents: number; // mode win cap; displayed totals clamp here
  f: FieldState;
  reveals: number; // reveals this spin/sweep
  triggered: boolean;
  chestsSeen: number;
  deepestStratum: Stratum;
  peakMeter: number;
  topFind: { symbol: SymbolId; amount: number };
  sweepsPlayed: number;
}

type NoIndex<T> = T extends BookEvent ? Omit<T, 'index'> : never;

function push(ctx: BuildCtx, ev: NoIndex<BookEvent>): void {
  ctx.events.push({ ...(ev as unknown as BookEvent), index: ctx.idx++ });
}

function newField(rng: Rng, p: GenParams, stratum: Stratum, seedChests: number): FieldState {
  const board: SymbolId[] = [];
  const strata: Stratum[] = [];
  for (let t = 0; t < TILES; t++) {
    board.push(drawSymbol(rng, stratum, p.rich));
    strata.push(stratum);
  }
  // seed chests at random distinct tiles
  const spots = rng.shuffle([...Array(TILES).keys()]).slice(0, seedChests);
  for (const t of spots) board[t] = 'SC';
  // pipe
  let pipeTile: number | null = null;
  if (p.pipeAfter) {
    pipeTile = rng.int(TILES);
    while (board[pipeTile] === 'SC') pipeTile = rng.int(TILES);
    board[pipeTile] = 'PP';
  }
  return {
    board,
    strata,
    revealed: new Array(TILES).fill(false),
    tags: new Map(),
    pipeTile,
    depth: stratum,
    meterTags: [],
  };
}

/** Reveal one segment; returns whether the pipe was struck. */
function playSegment(ctx: BuildCtx, tiles: number[], kind: 'flip' | 'flood', beepStep: 1 | 2 | 3 | 4): boolean {
  const { f, rng, p } = ctx;
  const tags: TagDrop[] = [];
  let pipeHit = false;
  const safe: number[] = [];
  for (const t of tiles) {
    if (f.revealed[t]) continue;
    f.revealed[t] = true;
    ctx.reveals++;
    if (f.board[t] === 'PP') {
      pipeHit = true;
      break; // pipe ends the segment immediately; tiles after it stay buried
    }
    safe.push(t);
    if (f.board[t] === 'SC') ctx.chestsSeen++;
    const density = TAG_DENSITY[f.strata[t]] * p.tagMul;
    if (f.board[t] !== 'SC' && rng.chance(density)) {
      const tag = { tile: t, ...drawTag(rng, f.strata[t], p.tagHot, p.night) };
      tags.push(tag);
      f.tags.set(t, tag);
      f.meterTags.push(tag.value);
    }
  }
  const revealedTiles = pipeHit ? [...safe, tiles.find((t) => f.board[t] === 'PP')!] : tiles;
  push(ctx, {
    type: 'sweepSegment',
    tiles: revealedTiles,
    kind,
    beepStep,
    tags,
    coilPath: revealedTiles,
  } as Omit<EvSweepSegment, 'index'>);
  if (tags.length) {
    push(ctx, {
      type: 'updateSignalMeter',
      value: meterOf(f),
      delta: tags.reduce((a, b) => a + b.value, 0),
      source: 'tags',
    });
    ctx.peakMeter = Math.max(ctx.peakMeter, meterOf(f));
  }
  return pipeHit;
}

/** Evaluate revealed symbols; returns cents won this evaluation. */
function evaluate(ctx: BuildCtx): number {
  const { f } = ctx;
  const counts = new Map<SymbolId, number[]>();
  for (let t = 0; t < TILES; t++) {
    if (!f.revealed[t]) continue;
    const s = f.board[t];
    if (s === 'SC' || s === 'PP') continue;
    if (!counts.has(s)) counts.set(s, []);
    counts.get(s)!.push(t);
  }
  const meter = meterOf(f);
  const wins: WinGroup[] = [];
  for (const [sym, tiles] of counts) {
    if (tiles.length < MIN_MATCH) continue;
    const band = tiles.length >= 12 ? 2 : tiles.length >= 10 ? 1 : 0;
    const basePay = PAYTABLE[sym as keyof typeof PAYTABLE][band];
    const amount = basePay * meter;
    wins.push({
      symbol: sym,
      count: tiles.length,
      tiles,
      basePay,
      meter,
      amount,
      equation: equationLine(tiles.length, sym, basePay, meter, amount),
    });
  }
  if (!wins.length) return 0;
  const totalWin = wins.reduce((a, w) => a + w.amount, 0);
  push(ctx, { type: 'winInfo', wins, totalWin });
  for (const w of wins) {
    if (w.amount > ctx.topFind.amount) ctx.topFind = { symbol: w.symbol, amount: w.amount };
  }
  push(ctx, { type: 'setWin', amount: totalWin, winLevel: winLevelForCents(totalWin) });
  ctx.totalCents += totalWin;
  push(ctx, { type: 'setTotalWin', amount: Math.min(ctx.capCents, ctx.totalCents) });

  // Dig Deeper — clear winning tiles, per-column gravity, refill face-down one stratum deeper
  const cleared = new Set<number>(wins.flatMap((w) => w.tiles));
  const nextStratum = Math.min(2, f.depth + 1) as Stratum;
  f.depth = nextStratum;
  ctx.deepestStratum = Math.max(ctx.deepestStratum, nextStratum) as Stratum;
  const slides: Array<{ from: number; to: number }> = [];
  const incoming: Array<{ tile: number; symbol: SymbolId; stratum: Stratum }> = [];
  for (let c = 0; c < COLS; c++) {
    const colTiles: number[] = [];
    for (let r = ROWS - 1; r >= 0; r--) colTiles.push(r * COLS + c);
    // survivors bottom-up
    const survivors = colTiles.filter((t) => !cleared.has(t));
    let write = 0;
    const newCol: Array<{ sym: SymbolId; str: Stratum; rev: boolean; tag?: TagDrop }> = [];
    for (const t of survivors) {
      newCol.push({ sym: f.board[t], str: f.strata[t], rev: f.revealed[t], tag: f.tags.get(t) });
    }
    for (let i = 0; i < colTiles.length; i++) {
      const dest = colTiles[i];
      if (i < newCol.length) {
        const src = survivors[i];
        if (src !== dest) slides.push({ from: src, to: dest });
        f.board[dest] = newCol[i].sym;
        f.strata[dest] = newCol[i].str;
        f.revealed[dest] = newCol[i].rev;
        if (newCol[i].tag) f.tags.set(dest, { ...newCol[i].tag!, tile: dest });
        else f.tags.delete(dest);
      } else {
        const sym = drawSymbol(ctx.rng, nextStratum, ctx.p.rich);
        f.board[dest] = sym;
        f.strata[dest] = nextStratum;
        // cascade refills arrive face-up (real math floods the field, so a
        // refill can form the next cascade win in the same sweep)
        f.revealed[dest] = true;
        f.tags.delete(dest);
        incoming.push({ tile: dest, symbol: sym, stratum: nextStratum });
      }
      write++;
    }
  }
  // pipe may have slid — recompute its position
  f.pipeTile = f.board.indexOf('PP') >= 0 ? f.board.indexOf('PP') : null;
  push(ctx, {
    type: 'updateGrid',
    clearedTiles: [...cleared],
    slides,
    incoming,
    newStratumMap: f.strata.slice(),
    depthReached: nextStratum,
  });
  return totalWin;
}

// Design doc §6: 1 Nice(<1x) 2 Good(<3x) 3 Great(<10x) 4 BIG(<30x) 5 MEGA(<100x) 6 EPIC(<1000x) 7 KING'S
function winLevelForCents(cents: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const x = cents / 100;
  if (x < 1) return 1;
  if (x < 3) return 2;
  if (x < 10) return 3;
  if (x < 30) return 4;
  if (x < 100) return 5;
  if (x < 1000) return 6;
  return 7;
}

/** Play one sweep (base spin body or one bonus sweep). Returns 'pipe' | 'quiet'. */
function playSweep(ctx: BuildCtx, sweepBudget: { reveals: [number, number]; evals: number }): 'pipe' | 'quiet' {
  const { rng, f, p } = ctx;
  ctx.reveals = 0;
  const targetReveals = rng.range(sweepBudget.reveals[0], sweepBudget.reveals[1]);
  let evalsDone = 0;
  let pipeStruck = false;

  while (ctx.reveals < targetReveals && !pipeStruck) {
    const unrevealed = [];
    for (let t = 0; t < TILES; t++) if (!f.revealed[t]) unrevealed.push(t);
    if (!unrevealed.length) break;

    const wantFlood = rng.chance(0.42) && unrevealed.length >= 4;
    // pipe pacing: never before 6 reveals this spin
    const pipeAllowed = f.pipeTile != null && !f.revealed[f.pipeTile] && ctx.reveals >= 6 && p.pipeAfter != null;
    const strikeNow = pipeAllowed && ctx.reveals >= p.pipeAfter![0] && rng.chance(0.35);

    if (strikeNow) {
      // walk into the pipe with a single flip
      playSegment(ctx, [f.pipeTile!], 'flip', 1);
      pipeStruck = true;
      break;
    }

    const safeTiles = unrevealed.filter((t) => t !== f.pipeTile);
    if (!safeTiles.length) break;
    if (wantFlood) {
      const seed = rng.pick(safeTiles);
      const size = rng.range(4, Math.min(9, Math.max(4, safeTiles.length)));
      const group = floodGroup(rng, f, seed, size).filter((t) => t !== f.pipeTile);
      if (group.length >= 4) {
        // honest anticipation: pre-roll beep 2 or 3 by flood size
        const beep: 2 | 3 = group.length >= 7 ? 3 : 2;
        playSegment(ctx, group, 'flood', ctx.deepestStratum === 2 ? 4 : beep);
        // evaluation only at flood boundaries
        if (evalsDone < sweepBudget.evals) {
          const won = evaluate(ctx);
          if (won > 0) evalsDone++;
        }
        continue;
      }
    }
    playSegment(ctx, [rng.pick(safeTiles)], 'flip', 1);
  }

  // final boundary evaluation for straggler counts
  if (!pipeStruck && evalsDone < sweepBudget.evals) evaluate(ctx);

  if (pipeStruck) {
    const depth = f.depth;
    const gag: 'micro' | 'geyser' = depth >= 1 && rng.chance(0.8) ? 'geyser' : 'micro';
    push(ctx, {
      type: 'pipeStrike',
      tile: f.pipeTile!,
      gag,
      variant: (rng.int(3) + 1) as 1 | 2 | 3,
      depthAtStrike: depth,
    });
    push(ctx, { type: 'sweepEnd', reason: 'pipe' });
    return 'pipe';
  }
  push(ctx, { type: 'sweepEnd', reason: 'quiet' });
  return 'quiet';
}

/**
 * Real-math sweep model: flood the WHOLE field open at once, then cascade
 * evaluations until quiet. Base spins emit the flood as a single sweepSegment;
 * bonus sweeps emit none (the frontend flood-reveals the shipped field). No
 * progressive digging, no pipe-strike drama — matches run_spin / run_freespin.
 */
function floodCascade(ctx: BuildCtx, isBase: boolean): void {
  const { f, rng, p } = ctx;
  const all = [...Array(TILES).keys()];
  const tags: TagDrop[] = [];
  for (let t = 0; t < TILES; t++) {
    if (f.revealed[t]) continue;
    f.revealed[t] = true;
    const sym = f.board[t];
    if (sym === 'SC') {
      ctx.chestsSeen++;
      continue;
    }
    if (sym === 'PP') continue; // pipe is a dead symbol in the flood
    const density = TAG_DENSITY[f.strata[t]] * p.tagMul;
    if (rng.chance(density)) {
      const tag = { tile: t, ...drawTag(rng, f.strata[t], p.tagHot, p.night) };
      tags.push(tag);
      f.tags.set(t, tag);
      f.meterTags.push(tag.value);
    }
  }
  if (isBase) {
    push(ctx, { type: 'sweepSegment', tiles: all, kind: 'flood', beepStep: 3, tags, coilPath: all } as Omit<
      EvSweepSegment,
      'index'
    >);
  }
  if (tags.length) {
    push(ctx, { type: 'updateSignalMeter', value: meterOf(f), delta: tags.reduce((a, b) => a + b.value, 0), source: 'tags' });
    ctx.peakMeter = Math.max(ctx.peakMeter, meterOf(f));
  }
  // Deep Scan (feature_deepscan): double the meter once before evaluating
  if (p.deepScan) {
    if (!f.meterTags.length) {
      const t0 = f.board.findIndex((s) => s !== 'SC' && s !== 'PP');
      const tag = { tile: t0, ...drawTag(rng, f.strata[t0], p.tagHot, p.night) };
      f.tags.set(t0, tag);
      f.meterTags.push(tag.value);
      push(ctx, { type: 'updateSignalMeter', value: meterOf(f), delta: tag.value, source: 'tags' });
    }
    const before = meterOf(f);
    f.meterTags.push(before); // doubling = meter joins itself
    push(ctx, { type: 'deepScan', meterBefore: before, meterAfter: meterOf(f) });
    push(ctx, { type: 'updateSignalMeter', value: meterOf(f), delta: before, source: 'deepScan' });
    ctx.peakMeter = Math.max(ctx.peakMeter, meterOf(f));
  }
  // cascade until no more wins (or cap reached)
  let guard = 0;
  while (guard++ < 10) {
    const won = evaluate(ctx);
    if (won <= 0 || ctx.totalCents >= ctx.capCents) break;
  }
  if (isBase) push(ctx, { type: 'sweepEnd', reason: 'quiet' });
}

/** Generate one book for the given mode + params. */
function generate(rng: Rng, p: GenParams, id: number, criteria: BookCriteria): Book {
  const ctx: BuildCtx = {
    rng,
    p,
    events: [],
    idx: 0,
    totalCents: 0,
    capCents: MODES[p.mode].maxWinX * 100,
    f: newField(rng, p, p.startStratum, p.chests),
    reveals: 0,
    triggered: false,
    chestsSeen: 0,
    deepestStratum: p.startStratum,
    peakMeter: 1,
    topFind: { symbol: 'L4', amount: 0 },
    sweepsPlayed: 0,
  };
  const f = ctx.f;

  push(ctx, {
    type: 'reveal',
    board: f.board.slice(),
    stratumMap: f.strata.slice(),
    pipeTile: f.pipeTile,
    chestTiles: f.board.map((s, t) => (s === 'SC' ? t : -1)).filter((t) => t >= 0),
    mode: p.mode,
  });

  if (p.sweeps === 0) {
    // ---- base spin: one flood + cascade (matches run_spin) ----
    floodCascade(ctx, true);
    // natural trigger?
    if (ctx.chestsSeen >= 3) {
      const chestTiles = f.board.map((s, t) => (s === 'SC' && f.revealed[t] ? t : -1)).filter((t) => t >= 0);
      const sp = scatterPay(ctx.chestsSeen);
      ctx.totalCents += sp;
      push(ctx, { type: 'freeSpinTrigger', chestTiles, totalSweeps: 10, scatterPay: sp, bonusMode: 'bigdig' });
      push(ctx, { type: 'setTotalWin', amount: Math.min(ctx.capCents, ctx.totalCents) });
      runBonus(ctx, 10, false);
    }
  } else {
    // ---- bought bonus ----
    runBonus(ctx, p.sweeps, true);
  }

  // cap (displayed totals were already clamped during accumulation)
  const finalCents = Math.min(ctx.capCents, ctx.totalCents);
  push(ctx, { type: 'finalWin', amount: finalCents });

  return { id, payoutMultiplier: finalCents, events: ctx.events, criteria };
}

function playSweepWithOptionalScan(ctx: BuildCtx): 'pipe' | 'quiet' {
  const { p, rng, f } = ctx;
  // deep scan is injected as an event before an evaluation; emulate by
  // wrapping evaluate — simplest: fire it once mid-sweep when requested.
  if (p.deepScan) {
    // reveal a first chunk, then scan, then continue via normal sweep
    const safeTiles = [...Array(TILES).keys()].filter((t) => t !== f.pipeTile);
    const seed = rng.pick(safeTiles);
    const group = floodGroup(rng, f, seed, rng.range(5, 8)).filter((t) => t !== f.pipeTile);
    playSegment(ctx, group, 'flood', 2);
    const before = meterOf(f);
    // ensure at least one tag exists so the double is visible
    if (!f.meterTags.length) {
      const t = group[0];
      const tag = { tile: t, ...drawTag(rng, f.strata[t], p.tagHot, p.night) };
      f.tags.set(t, tag);
      f.meterTags.push(tag.value);
      push(ctx, { type: 'updateSignalMeter', value: meterOf(f), delta: tag.value, source: 'tags' });
    }
    const b = meterOf(f);
    f.meterTags.push(b); // doubling = meter joins itself
    push(ctx, { type: 'deepScan', meterBefore: b, meterAfter: meterOf(f) });
    push(ctx, { type: 'updateSignalMeter', value: meterOf(f), delta: b, source: 'deepScan' });
    ctx.peakMeter = Math.max(ctx.peakMeter, meterOf(f));
    void before;
  }
  return playSweep(ctx, {
    reveals: p.quietEarly > 0.5 ? [6, 12] : [8, 22],
    evals: 1 + Math.round(p.digBias),
  });
}

function runBonus(ctx: BuildCtx, totalSweeps: number, bought: boolean): void {
  const { rng, p } = ctx;
  let f = ctx.f;
  let sweeps = totalSweeps;
  let retriggered = false;
  for (let s = 1; s <= sweeps; s++) {
    // FRESH field each sweep — matches run_freespin (every sweep is a new dig,
    // a brand-new 36-tile field re-buried in). Depth deepens ~every 3 sweeps;
    // the Signal Meter carries across all sweeps.
    const stratum = Math.min(p.startStratum + Math.floor((s - 1) / 3), 2) as Stratum;
    const carriedTags = f.meterTags.slice();
    // seed a couple of chests on some sweeps so retriggers stay possible
    const seedChests = !retriggered && p.retrigger && rng.chance(0.3) ? rng.range(2, 3) : 0;
    f = ctx.f = newField(rng, p, stratum, seedChests);
    f.meterTags = carriedTags; // meter persists across sweeps
    // a night dig plants no pipe hazard in its first 3 sweeps
    if (p.night && s <= 3 && f.pipeTile != null) {
      f.board[f.pipeTile] = drawSymbol(rng, stratum, p.rich);
      f.pipeTile = null;
    }
    ctx.deepestStratum = Math.max(ctx.deepestStratum, stratum) as Stratum;
    // re-bury the whole fresh field (all 36 plugs drop in for this dig)
    const refills = f.board.map((sym, t) => ({ tile: t, symbol: sym, stratum: f.strata[t] }));
    push(ctx, {
      type: 'sweepStart',
      sweep: s,
      totalSweeps: sweeps,
      stratumMap: f.strata.slice(),
      meter: meterOf(f),
      pipeTile: f.pipeTile,
      refills,
      board: f.board.slice(),
    });
    ctx.sweepsPlayed++;
    const chestsBefore = ctx.chestsSeen;
    floodCascade(ctx, false);
    // retrigger check
    if (p.retrigger && !retriggered && ctx.chestsSeen - chestsBefore >= 2) {
      retriggered = true;
      sweeps += 3;
      const chestTiles = f.board.map((sy, t) => (sy === 'SC' && f.revealed[t] ? t : -1)).filter((t) => t >= 0);
      push(ctx, { type: 'retrigger', chestTiles, addedSweeps: 3, totalSweeps: sweeps });
    }
  }
  push(ctx, {
    type: 'bonusSummary',
    totalWin: Math.min(ctx.capCents, ctx.totalCents),
    sweepsPlayed: ctx.sweepsPlayed,
    deepestStratum: ctx.deepestStratum,
    peakMeter: ctx.peakMeter,
    topFind: ctx.topFind,
  });
  void bought;
}

// --- bucket presets and distributions (design doc §14) ---

export interface Bucket {
  criteria: BookCriteria;
  weight: number;
  minX: number;
  maxX: number;
  params: (rng: Rng) => Partial<GenParams>;
}

const baseDefaults = (mode: ModeId): GenParams => ({
  mode,
  rich: 1,
  tagMul: 1,
  tagHot: 0.1,
  digBias: 1,
  chests: 0,
  pipeAfter: [7, 14],
  deepScan: false,
  sweeps: 0,
  night: false,
  startStratum: 0,
  quietEarly: 0.4,
  retrigger: false,
});

export const BUCKETS: Record<ModeId, Bucket[]> = {
  base_standard: [
    { criteria: 'dead', weight: 62, minX: 0, maxX: 0, params: (r) => ({ rich: 0.5, tagMul: r.chance(0.4) ? 1 : 0.3, digBias: 0, quietEarly: r.next() }) },
    { criteria: 'nearmiss', weight: 6, minX: 0, maxX: 0, params: () => ({ rich: 0.6, chests: 2, digBias: 0 }) },
    { criteria: 'small', weight: 15, minX: 0.01, maxX: 1, params: () => ({ rich: 1.1, digBias: 0.4 }) },
    { criteria: 'nice', weight: 8.5, minX: 1, maxX: 10, params: () => ({ rich: 1.6, tagMul: 1.3, digBias: 1 }) },
    { criteria: 'big', weight: 3.4, minX: 10, maxX: 30, params: () => ({ rich: 2.2, tagMul: 1.8, tagHot: 0.3, digBias: 2 }) },
    { criteria: 'mega', weight: 0.8, minX: 30, maxX: 100, params: () => ({ rich: 3, tagMul: 2.4, tagHot: 0.55, digBias: 3, quietEarly: 0.1 }) },
    { criteria: 'trigger', weight: 0.7, minX: 2, maxX: 400, params: () => ({ rich: 1.6, chests: 3, tagMul: 1.5, retrigger: true }) },
    { criteria: 'maxwin', weight: 0.008, minX: 800, maxX: 15000, params: () => ({ rich: 4, chests: 3, tagMul: 3.5, tagHot: 0.9, retrigger: true, quietEarly: 0 }) },
  ],
  base_xl: [
    { criteria: 'dead', weight: 78, minX: 0, maxX: 0, params: (r) => ({ rich: 0.5, tagMul: 0.5, digBias: 0, quietEarly: r.next() }) },
    { criteria: 'nearmiss', weight: 6, minX: 0, maxX: 0, params: () => ({ rich: 0.6, chests: 2, digBias: 0 }) },
    { criteria: 'small', weight: 10, minX: 0.01, maxX: 1, params: () => ({ rich: 1.1, digBias: 0.5 }) },
    { criteria: 'nice', weight: 7.5, minX: 1, maxX: 10, params: () => ({ rich: 1.7, tagMul: 1.5, digBias: 1.5 }) },
    { criteria: 'big', weight: 3.2, minX: 10, maxX: 30, params: () => ({ rich: 2.4, tagMul: 2, tagHot: 0.35, digBias: 2.5 }) },
    { criteria: 'mega', weight: 1.2, minX: 30, maxX: 100, params: () => ({ rich: 3.2, tagMul: 2.6, tagHot: 0.6, digBias: 3, quietEarly: 0.1 }) },
    { criteria: 'epic', weight: 0.28, minX: 100, maxX: 1000, params: () => ({ rich: 4, tagMul: 3.2, tagHot: 0.8, digBias: 4, quietEarly: 0 }) },
    { criteria: 'trigger', weight: 0.75, minX: 2, maxX: 500, params: () => ({ rich: 1.8, chests: 3, tagMul: 1.8, retrigger: true }) },
    { criteria: 'maxwin', weight: 0.008, minX: 800, maxX: 15000, params: () => ({ rich: 4.2, chests: 3, tagMul: 3.6, tagHot: 0.9, retrigger: true, quietEarly: 0 }) },
  ],
  base_rally: [
    { criteria: 'dead', weight: 50, minX: 0, maxX: 0, params: (r) => ({ rich: 0.5, chests: r.chance(0.5) ? r.range(1, 2) : 0, digBias: 0 }) },
    { criteria: 'nearmiss', weight: 12, minX: 0, maxX: 0, params: () => ({ rich: 0.6, chests: 2, digBias: 0 }) },
    { criteria: 'small', weight: 12, minX: 0.01, maxX: 1, params: () => ({ rich: 1.1, digBias: 0.4 }) },
    { criteria: 'nice', weight: 9, minX: 1, maxX: 10, params: () => ({ rich: 1.6, tagMul: 1.3, digBias: 1 }) },
    { criteria: 'big', weight: 3.5, minX: 10, maxX: 30, params: () => ({ rich: 2.2, tagMul: 1.8, tagHot: 0.3, digBias: 2 }) },
    { criteria: 'mega', weight: 1, minX: 30, maxX: 100, params: () => ({ rich: 3, tagMul: 2.4, tagHot: 0.55, digBias: 3 }) },
    { criteria: 'trigger', weight: 1.5, minX: 2, maxX: 400, params: () => ({ rich: 1.6, chests: 3, tagMul: 1.5, retrigger: true }) },
    { criteria: 'maxwin', weight: 0.008, minX: 800, maxX: 15000, params: () => ({ rich: 4, chests: 3, tagMul: 3.5, tagHot: 0.9, retrigger: true }) },
  ],
  feature_deepscan: [
    { criteria: 'small', weight: 62, minX: 0, maxX: 1, params: () => ({ deepScan: true, startStratum: 1, rich: 0.55, tagMul: 0.4, digBias: 0, quietEarly: 0.85, pipeAfter: [8, 16] }) },
    { criteria: 'nice', weight: 26, minX: 1, maxX: 5, params: () => ({ deepScan: true, startStratum: 1, rich: 0.7, tagMul: 0.5, digBias: 0.3, quietEarly: 0.75 }) },
    { criteria: 'big', weight: 8.5, minX: 5, maxX: 20, params: () => ({ deepScan: true, startStratum: 1, rich: 1.1, tagMul: 1, tagHot: 0.15, quietEarly: 0.5 }) },
    { criteria: 'mega', weight: 2.6, minX: 20, maxX: 100, params: () => ({ deepScan: true, startStratum: 1, rich: 1.9, tagMul: 1.7, tagHot: 0.4 }) },
    { criteria: 'epic', weight: 0.55, minX: 100, maxX: 400, params: () => ({ deepScan: true, startStratum: 1, rich: 2.8, tagMul: 2.4, tagHot: 0.7 }) },
    { criteria: 'maxwin', weight: 0.1, minX: 380, maxX: 500, params: () => ({ deepScan: true, startStratum: 1, rich: 4, tagMul: 3.4, tagHot: 0.9 }) },
  ],
  feature_bigdig: [
    { criteria: 'dead', weight: 40, minX: 0, maxX: 20, params: () => ({ sweeps: 10, rich: 0.7, tagMul: 0.7 }) },
    { criteria: 'small', weight: 30, minX: 20, maxX: 60, params: () => ({ sweeps: 10, rich: 1.2, tagMul: 1.2 }) },
    { criteria: 'nice', weight: 22, minX: 60, maxX: 120, params: () => ({ sweeps: 10, rich: 1.6, tagMul: 1.6, retrigger: true }) },
    { criteria: 'big', weight: 11, minX: 120, maxX: 300, params: () => ({ sweeps: 10, rich: 2.1, tagMul: 2, tagHot: 0.4, retrigger: true }) },
    { criteria: 'mega', weight: 2.4, minX: 300, maxX: 1000, params: () => ({ sweeps: 10, rich: 2.8, tagMul: 2.6, tagHot: 0.65, retrigger: true }) },
    { criteria: 'epic', weight: 0.6, minX: 1000, maxX: 5000, params: () => ({ sweeps: 10, rich: 3.5, tagMul: 3.2, tagHot: 0.85, retrigger: true }) },
    { criteria: 'maxwin', weight: 0.15, minX: 5000, maxX: 15000, params: () => ({ sweeps: 10, rich: 4.2, tagMul: 3.8, tagHot: 0.95, retrigger: true, deepScan: true }) },
  ],
  feature_nightdig: [
    { criteria: 'dead', weight: 42, minX: 0, maxX: 100, params: () => ({ sweeps: 10, night: true, startStratum: 1, rich: 1.2, tagMul: 1.2 }) },
    { criteria: 'small', weight: 30, minX: 100, maxX: 300, params: () => ({ sweeps: 10, night: true, startStratum: 1, rich: 1.7, tagMul: 1.6 }) },
    { criteria: 'nice', weight: 17, minX: 300, maxX: 800, params: () => ({ sweeps: 10, night: true, startStratum: 1, rich: 2.2, tagMul: 2, retrigger: true }) },
    { criteria: 'big', weight: 7.5, minX: 800, maxX: 2000, params: () => ({ sweeps: 10, night: true, startStratum: 1, rich: 2.8, tagMul: 2.5, tagHot: 0.5, retrigger: true }) },
    { criteria: 'mega', weight: 2.6, minX: 2000, maxX: 6000, params: () => ({ sweeps: 10, night: true, startStratum: 1, rich: 3.4, tagMul: 3, tagHot: 0.75, retrigger: true }) },
    { criteria: 'epic', weight: 0.65, minX: 6000, maxX: 12000, params: () => ({ sweeps: 10, night: true, startStratum: 1, rich: 4, tagMul: 3.5, tagHot: 0.9, retrigger: true }) },
    { criteria: 'maxwin', weight: 0.25, minX: 12000, maxX: 15000, params: () => ({ sweeps: 10, night: true, startStratum: 1, rich: 4.5, tagMul: 4, tagHot: 1, retrigger: true, deepScan: true }) },
  ],
};

let bookIdCounter = 1;

/** Generate a book for a mode, rejection-sampling into the chosen bucket's band. */
export function generateBook(mode: ModeId, seed?: number, forceCriteria?: BookCriteria): Book {
  const rng = new Rng(seed ?? ((Math.random() * 2 ** 31) | 0));
  const buckets = BUCKETS[mode];
  const bucket = forceCriteria
    ? buckets.find((b) => b.criteria === forceCriteria) ?? buckets[0]
    : rng.weighted(buckets.map((b) => [b, b.weight] as [Bucket, number]));

  const capCents = MODES[mode].maxWinX * 100;
  let best: Book | null = null;
  let bestDist = Infinity;
  const paying = bucket.minX > 0 || !['dead', 'nearmiss'].includes(bucket.criteria);
  for (let attempt = 0; attempt < (forceCriteria ? 400 : 120); attempt++) {
    const p: GenParams = { ...baseDefaults(mode), ...bucket.params(rng) };
    // escalate a forced paying bucket that keeps missing: boost richness, drop the pipe
    if (forceCriteria && paying && attempt >= 40) {
      const boost = 1 + Math.floor(attempt / 40) * 0.35;
      p.rich *= boost;
      p.tagMul *= boost;
      p.digBias += 1;
      if (attempt >= 80) p.pipeAfter = null;
    }
    const book = generate(rng, p, bookIdCounter++, bucket.criteria);
    const x = Math.min(book.payoutMultiplier, capCents) / 100;
    if (bucket.criteria === 'dead' || bucket.criteria === 'nearmiss') {
      if (mode.startsWith('base') && book.payoutMultiplier === 0 && !book.events.some((e) => e.type === 'freeSpinTrigger')) return book;
      if (!mode.startsWith('base') && x >= bucket.minX && x <= bucket.maxX) return book;
    } else if (x >= bucket.minX && x <= bucket.maxX) {
      if (bucket.criteria === 'trigger' && !book.events.some((e) => e.type === 'freeSpinTrigger')) {
        // trigger bucket requires the bonus actually fired
      } else {
        return book;
      }
    }
    const mid = (bucket.minX + bucket.maxX) / 2;
    const dist = Math.abs(x - mid);
    const disqualified = paying && book.payoutMultiplier === 0;
    if (!disqualified && dist < bestDist) {
      bestDist = dist;
      best = book;
    }
  }
  if (!best) {
    // pathological miss: fall back to any organic book from the mode
    best = generateBook(mode, (Math.random() * 2 ** 31) | 0);
  }
  return best;
}
