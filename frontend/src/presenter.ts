/**
 * Book presenter — walks a round's predetermined events (design doc §4/§5/§7)
 * and drives board, HUD, Ron, FX, and audio. One presenter instance per game;
 * `present()` returns when the book has fully played out.
 *
 * Pacing: dead spins resolve fast, win tiers earn duration, turbo compresses
 * but keeps every amount legible (min hold per float).
 */
import {
  Book,
  BookEvent,
  EvBonusSummary,
  EvDeepScan,
  EvFreeSpinTrigger,
  EvPipeStrike,
  EvReveal,
  EvRetrigger,
  EvSetTotalWin,
  EvSetWin,
  EvSweepEnd,
  EvSweepSegment,
  EvSweepStart,
  EvUpdateGrid,
  EvUpdateSignalMeter,
  EvWinInfo,
  MODES,
  Stratum,
  SYMBOL_NAMES,
  SymbolId,
  TILES,
  COLS,
  colOf,
  equationLine,
} from './books';
import { ColorMatrixFilter } from 'pixi.js';
import { BoardView } from './board';
import { Hud } from './hud';
import { Fx, bigWinCard } from './fx';
import { Ron } from './ron';
import { audio } from './audio';
import { ms, timing, wait } from './anim';
import { moneyWin } from './currency';
import { sw } from './social';
import { bonusTriggerCard, bonusSummaryCard } from './cards';

export interface PresentOptions {
  bet: number;
  /** called after each event with its index (RGS /bet/event checkpoints) */
  onEventIndex?: (index: number) => void;
  /** live cumulative win callback in display currency */
  onTotalWin?: (amount: number) => void;
  /** fast-forward: skip all holds (resume "skip to result" uses finalWin path instead) */
  fast?: boolean;
}

/** The old canvas-wide CSS grade: brightness .85 / saturate .85 / hue-rotate -10deg. */
let _nightGrade: ColorMatrixFilter | null = null;
function nightGrade(): ColorMatrixFilter {
  if (!_nightGrade) {
    const f = new ColorMatrixFilter();
    f.brightness(0.85, false);
    f.saturate(-0.15, true);
    f.hue(-10, true);
    _nightGrade = f;
  }
  return _nightGrade;
}

export class Presenter {
  private revealedCounts = new Map<SymbolId, number>();
  private night = false;
  /** meter bump from tags on fresh tiles, held until the refill lands */
  private pendingMeter: EvUpdateSignalMeter | null = null;

  constructor(
    private board: BoardView,
    private hud: Hud,
    private fx: Fx,
    private ron: Ron,
  ) {
    // every surfaced Hot Signal tag pops at its tile and streams sparks into
    // the readout — the meter must visibly EAT the tags it sums
    this.board.cb.onTagSurfaced = (tag) => {
      const p = this.board.tileGlobal(tag.tile);
      this.fx.burst(p.x, p.y, tag.band >= 3 ? 14 : 8, 60, tag.band >= 3 ? 0xff9a66 : 0xffd684);
      const m = this.hud.meterScreenPos();
      this.fx.flyTo(p.x, p.y, m.x, m.y, tag.band + 2);
    };
  }

  private hold(standard: number, turbo?: number): Promise<void> {
    return wait(ms(standard, turbo));
  }

  /** Meter climb from tags on freshly dug tiles. The book records only the
   *  summed delta (no tile positions), so chips can't be drawn — instead fly
   *  sparks from the fresh dirt into the readout and flash the delta, so the
   *  meter never moves without an on-screen cause (Stake round 3). */
  private async presentMeterClimb(e: EvUpdateSignalMeter, fromTiles: number[]): Promise<void> {
    const m = this.hud.meterScreenPos();
    const origins = fromTiles.length ? fromTiles.slice(0, 6) : [-1];
    for (const t of origins) {
      const p = t >= 0 ? this.board.tileGlobal(t) : { x: this.centerX(), y: this.centerY() };
      this.fx.flyTo(p.x, p.y, m.x, m.y, 3);
    }
    audio.play('beep_1');
    this.hud.flashMessage(`FRESH DIRT — SIGNAL +${e.delta}!`, 1300);
    this.hud.setMeter(e.value, e.value >= 25);
    await this.hold(520, 240);
  }

  setNight(on: boolean): void {
    this.night = on;
    document.body.classList.toggle('night', on);
    // Cool ambient grade so day-lit tiles don't float on the night field. Applied
    // to the BOARD ONLY — this used to be a CSS filter on the whole canvas, which
    // also dimmed the mascot; she must stay full-brightness and pop at night.
    // (Ron shares the canvas, so CSS can't exclude her — hence a Pixi filter.)
    this.board.filters = on ? [nightGrade()] : [];
    audio.setMusic(on ? 'night' : 'day');
  }

  /** Present one complete book. */
  async present(book: Book, opts: PresentOptions): Promise<void> {
    this.revealedCounts.clear();
    this.hud.clearPips();
    this.hud.setEquation('');
    this.hud.setMeter(1);
    this.hud.setDepth(0);
    const isBonus = book.events.some((e) => e.type === 'sweepStart');
    // Server (real math) bonus books ship refills for ALL 36 tiles each sweep
    // and emit NO per-sweep sweepSegment (exactly one, the pre-trigger base
    // flood) — so nothing flips the re-buried field face-up. Mock books emit a
    // sweepSegment per sweep with tiny refills. Discriminate so the mock's
    // progressive-dig pacing is untouched while server books reveal the field.
    const serverBonus =
      isBonus &&
      book.events.filter((e) => e.type === 'sweepStart').some((e) => (e as EvSweepStart).refills.length === TILES) &&
      book.events.filter((e) => e.type === 'sweepSegment').length <= 1;
    this.board.boardDriven = serverBonus;
    const isNightMode = (book.events[0] as EvReveal | undefined)?.mode === 'feature_nightdig';
    if (isNightMode) this.setNight(true);

    let displayedTotal = 0;
    let lastWinLevel = 0;
    let sawMaxWin = false;
    // some books emit finalWin more than once (base + bonus tally) — the
    // celebration card must fire only ONCE per round
    let bigWinShown = false;
    // defensive: server books may carry the mode uppercased
    const mode0 = String((book.events[0] as EvReveal | undefined)?.mode ?? 'base_standard').toLowerCase() as EvReveal['mode'];
    const capX = (MODES[mode0] ?? MODES.base_standard).maxWinX;
    const capCents = capX * 100;
    if (book.payoutMultiplier >= capCents) sawMaxWin = true;

    this.pendingMeter = null;
    for (let ei = 0; ei < book.events.length; ei++) {
      const ev = book.events[ei];
      switch (ev.type) {
        case 'reveal': {
          const e = ev as EvReveal;
          this.board.setField(e.board, e.stratumMap, false);
          this.hud.setDepth(0);
          this.ron.show('sweep');
          this.hud.setSpinning(true);
          audio.play('dig_thunk');
          await this.hold(180, 90);
          break;
        }
        case 'sweepStart': {
          const e = ev as EvSweepStart;
          this.hud.setSweepCounter(`SWEEP ${e.sweep} OF ${e.totalSweeps}`);
          this.hud.setMessage(`SWEEP ${e.sweep} OF ${e.totalSweeps}`);
          this.hud.setMeter(e.meter, e.meter >= 25);
          // light the depth pills for this sweep's stratum (Night Dig starts in
          // Georgian, so sweep 1 must not read Topsoil)
          this.hud.setDepth(Math.max(...e.stratumMap) as Stratum);
          if (e.refills.length) await this.board.rebury(e.refills);
          // server bonus emits no sweepSegment → surface the whole shipped field
          // as a progressive metal-detector DIG-SWEEP (not one instant flood),
          // so the bonus keeps its suspenseful dig feel on real-math books.
          if (serverBonus) await this.digSweep();
          // resync pips with the persistent field's revealed truth
          this.tileSym = new Map(this.board.revealedSymbols());
          this.recount();
          this.hud.setPips(this.revealedCounts);
          this.ron.show('sweep');
          await this.hold(320, 160);
          break;
        }
        case 'sweepSegment': {
          const e = ev as EvSweepSegment;
          // honest anticipation pre-roll
          if (e.beepStep >= 2) {
            audio.play(`beep_${Math.min(e.beepStep, 3)}` as 'beep_2');
            this.ron.react('alert');
            if (e.beepStep >= 3) {
              this.ron.tremble(500);
              this.hud.dockExcited(true);
            }
            await this.hold(e.beepStep === 3 ? 380 : 240, 120);
          } else {
            audio.play('beep_1');
          }
          if (e.beepStep === 4) {
            audio.play('beep_4_scream');
            this.ron.tremble(900);
          }
          // near-miss shimmer: a 7-of-8 tally on the pips earns a held beat
          // before the flip (visual counterpart to the beep grammar)
          if ([...this.revealedCounts.values()].some((n) => n === 7)) {
            this.ron.react('alert');
            this.hud.dockExcited(true);
            await this.hold(300, 120);
          }
          await this.board.revealSegment(e.tiles, e.kind, e.tags);
          this.hud.dockExcited(false);
          this.trackReveals(e);
          this.hud.setPips(this.revealedCounts);
          break;
        }
        case 'updateSignalMeter': {
          const e = ev as EvUpdateSignalMeter;
          // Tags with chips on the board (sweepSegment) already streamed sparks
          // into the readout — update it directly. Tags rolled on FRESH tiles
          // (dig-deeper refills, each bonus sweep field) carry no tile positions
          // in the book, so the meter used to jump with nothing on the board
          // (Stake round 3). Defer the bump to the refill landing when an
          // updateGrid follows; else (bonus sweep start) present the climb now.
          if (e.source === 'tags' && book.events[ei - 1]?.type !== 'sweepSegment') {
            if (book.events[ei + 1]?.type === 'updateGrid') {
              this.pendingMeter = e;
              break;
            }
            await this.presentMeterClimb(e, []);
            break;
          }
          this.hud.setMeter(e.value, e.source === 'deepScan' || e.value >= 25);
          break;
        }
        case 'deepScan': {
          const e = ev as EvDeepScan;
          this.ron.react('bigwin', 1400);
          audio.play('dig_thunk');
          audio.duck(0.35);
          this.hud.flashMessage('DEEP SCAN — SIGNAL DOUBLED!');
          await this.hold(650, 320);
          this.hud.setMeter(e.meterAfter, true);
          this.fx.burst(this.centerX(), this.centerY(), 18, 90);
          audio.duck(1, 400);
          await this.hold(450, 220);
          break;
        }
        case 'winInfo': {
          const e = ev as EvWinInfo;
          // safety net: never highlight/pop a buried tile — flip any straggler
          // face-up first (no-op for already-surfaced tiles). Fixes server-bonus
          // wins and any latent base-game cascade blank.
          await this.board.ensureFaceUp(e.wins.flatMap((w) => w.tiles));
          // ratchet the WIN readout to the running cumulative NOW (was lagging to
          // setTotalWin, leaving $0.00 lit under the first float). setWin ignores
          // values <= shown, so the later setTotalWin is a confirming no-op.
          this.hud.setWin(Math.min(displayedTotal + (e.totalWin / 100) * opts.bet, capX * opts.bet), opts.bet);
          // SURVEY beat
          audio.play('survey_stamp');
          this.hud.flashMessage('SURVEY!', 900);
          await this.hold(350, 180);
          // highlight all groups; float each amount at its own tiles
          const floats: Promise<void>[] = [];
          e.wins.forEach((w, i) => {
            this.board.highlight(w.tiles);
            const anchor = w.tiles[Math.floor(w.tiles.length / 2)];
            const p = this.board.tileGlobal(anchor);
            const amt = (w.amount / 100) * opts.bet;
            floats.push(
              (async () => {
                await wait(i * ms(150, 60));
                // recompute from the CURRENT themed symbol names — the mock's
                // baked w.equation string still carries the old pre-reskin names
                this.hud.setEquation(equationLine(w.tiles.length, w.symbol, w.basePay, w.meter, w.amount));
                audio.play('bag_jingle', { overlap: true });
                this.fx.burst(p.x, p.y, 12, 70);
                await this.fx.amountFloat(p.x, p.y, moneyWin(amt, opts.bet), w.amount >= 1000);
              })(),
            );
          });
          await Promise.all(floats);
          await this.hold(280, 160);
          this.board.clearHighlights();
          const clearTiles = e.wins.flatMap((w) => w.tiles);
          await this.board.popTiles(clearTiles);
          for (const t of clearTiles) this.untrackTile(t);
          break;
        }
        case 'setWin': {
          const e = ev as EvSetWin;
          lastWinLevel = Math.max(lastWinLevel, e.winLevel);
          // Levels 1-4 (Nice Find .. BIG FIND) present inline; 5+ earn the
          // full-screen card at finalWin. Doc §6 tier names drive the copy.
          if (e.amount > 0 && e.winLevel <= 4) {
            audio.play(`win_${Math.max(1, e.winLevel)}` as 'win_1');
            if (e.winLevel >= 4) {
              this.ron.react('bigwin', 1800);
              this.hud.flashMessage('BIG FIND!', 1500);
              this.fx.burst(this.centerX(), this.centerY(), 20, 110);
            } else if (e.winLevel === 3) {
              this.ron.react('win', 1400);
              this.hud.flashMessage('GREAT FIND!', 1200);
            } else if (e.winLevel === 2) {
              this.ron.react('win', 1100);
            }
            await this.hold([0, 300, 600, 1000, 1800][e.winLevel] ?? 300, [0, 150, 300, 500, 900][e.winLevel] ?? 150);
          } else if (e.amount > 0) {
            // a MEGA+ evaluation landing mid-round gets its beat NOW (doc §7);
            // the full-screen card still waits for finalWin
            audio.play(e.winLevel >= 6 ? 'win_6' : 'win_5');
            this.ron.react('bigwin', 2200);
            this.hud.flashMessage(e.winLevel >= 6 ? 'EPIC DIG!' : 'MEGA HOARD!', 1800);
            this.fx.burst(this.centerX(), this.centerY(), 28, 140);
            this.fx.goldStorm(1300);
            await this.hold(e.winLevel >= 6 ? 2800 : 2000, e.winLevel >= 6 ? 1400 : 1000);
          }
          break;
        }
        case 'updateGrid': {
          const e = ev as EvUpdateGrid;
          this.hud.flashMessage('DIG DEEPER!', 1100);
          this.hud.setDepth(e.depthReached);
          if (!this.night) {
            audio.setMusic(e.depthReached === 2 ? 'hoard' : e.depthReached === 1 ? 'georgian' : 'day');
          }
          await this.board.applyUpdateGrid(e);
          // slides moved tiles — rebuild symbol tracking from the board truth
          this.tileSym = new Map(this.board.revealedSymbols());
          this.recount();
          this.hud.setPips(this.revealedCounts);
          // fresh dirt carried Signal — now that the refills have landed, show
          // where the climb came from (deferred from updateSignalMeter)
          if (this.pendingMeter) {
            await this.presentMeterClimb(this.pendingMeter, e.incoming.map((i) => i.tile));
            this.pendingMeter = null;
          }
          await this.hold(160, 80);
          break;
        }
        case 'pipeStrike': {
          const e = ev as EvPipeStrike;
          await this.board.pipeStrike(e.tile);
          if (e.gag === 'geyser' && !timing.turbo && !timing.reduceMotion) {
            audio.play('geyser');
            this.ron.show('soaked', 2200);
            this.hud.flashMessage('Toxic geyser! Every time!', 1900);
            this.fx.burst(this.board.tileGlobal(e.tile).x, this.board.tileGlobal(e.tile).y, 22, 120, 0x9adcf0);
            await this.hold(1800, 0);
          } else {
            this.ron.react('loss', 900);
            this.hud.flashMessage('SPLAT. Toxic ooze.', 1100);
            await this.hold(300, 150);
          }
          break;
        }
        case 'sweepEnd': {
          const e = ev as EvSweepEnd;
          if (e.reason === 'quiet') {
            if (Math.random() < 0.5) this.ron.react('loss', 900); // react to duds more often
            await this.hold(380, 160);
          }
          this.hud.clearPips();
          break;
        }
        case 'freeSpinTrigger': {
          const e = ev as EvFreeSpinTrigger;
          audio.play('retrigger');
          audio.play('ron_whoop');
          this.ron.react('bigwin', 2400);
          this.board.highlight(e.chestTiles);
          this.fx.goldStorm(1800);
          if (e.scatterPay > 0) {
            const amt = (e.scatterPay / 100) * opts.bet;
            const p = this.board.tileGlobal(e.chestTiles[0] ?? 14);
            await this.fx.amountFloat(p.x, p.y, moneyWin(amt, opts.bet), true);
          }
          await this.hold(700, 350);
          this.board.clearHighlights();
          audio.setMusic(this.night ? 'night' : 'hoard');
          await bonusTriggerCard(
            e.totalSweeps,
            mode0 === 'feature_deepscan' ? 'deepscan' : e.bonusMode === 'nightdig' ? 'nightdig' : 'bigdig',
          );
          break;
        }
        case 'retrigger': {
          const e = ev as EvRetrigger;
          audio.play('retrigger');
          this.ron.react('bigwin', 1600);
          this.board.highlight(e.chestTiles);
          this.hud.flashMessage('+3 SWEEPS!', 1800);
          await this.hold(1400, 700);
          this.board.clearHighlights();
          break;
        }
        case 'setTotalWin': {
          const e = ev as EvSetTotalWin;
          // clamp to the mode ceiling: the math emits the UNCAPPED running total
          // but the payout is capped, so the readout must never exceed the cap
          displayedTotal = (Math.min(e.amount, capCents) / 100) * opts.bet;
          this.hud.setWin(displayedTotal, opts.bet);
          opts.onTotalWin?.(displayedTotal);
          break;
        }
        case 'bonusSummary': {
          const e = ev as EvBonusSummary;
          audio.setMusic('celebration');
          this.ron.react('win', 2600);
          await this.hold(500, 250);
          await bonusSummaryCard({
            totalWin: (Math.min(e.totalWin, capCents) / 100) * opts.bet,
            bet: opts.bet,
            sweepsPlayed: e.sweepsPlayed,
            peakMeter: e.peakMeter,
            topFind: e.topFind,
            deepestStratum: e.deepestStratum,
          });
          break;
        }
        case 'finalWin': {
          const e = ev as unknown as { amount: number };
          const amount = (e.amount / 100) * opts.bet;
          const winX = e.amount / 100;
          if (winX >= 30 && !bigWinShown) {
            bigWinShown = true;
            // MEGA+: the banner rollup IS the reveal — never spoil it by
            // committing the footer first
            const level = winX >= 100 ? (winX >= 1000 ? 7 : 6) : 5;
            this.ron.react('bigwin');
            if (level === 7) audio.play('ron_gasp');
            this.fx.shake(this.board, level === 7 ? 12 : level === 6 ? 8 : 5);
            this.fx.goldStorm(level === 7 ? 3200 : level === 6 ? 2200 : 1400);
            // max win: let Ron's faint land on the board as its own beat (with
            // the gold storm) BEFORE the newspaper card covers everything
            if (level === 7) await this.hold(1500, 850);
            await bigWinCard({
              winX,
              amount,
              bet: opts.bet,
              level,
              isMaxWin: sawMaxWin,
              maxWinX: capX,
              holdMs: ms(level === 7 ? 2600 : 1400, level === 7 ? 2600 : 900),
            });
            this.hud.setWin(amount, opts.bet);
            opts.onTotalWin?.(amount);
            this.ron.show('idle');
          } else {
            this.hud.setWin(amount, opts.bet);
            opts.onTotalWin?.(amount);
          }
          break;
        }
      }
      opts.onEventIndex?.(ev.index ?? 0);
    }

    this.hud.setSpinning(false);
    this.hud.setEquation('');
    this.hud.setMessage('');
    if (isNightMode) this.setNight(false);
    audio.setMusic(this.night ? 'night' : 'day');
    // settle flourish: the signal dies with the round — the meter draining to
    // x1 and the strata pill resetting IS the round-over signal (no dead tail)
    await this.hud.drainMeter();
    this.hud.setDepth(0);
    this.ron.show('idle');
    void isBonus;
    void lastWinLevel;
  }

  /** Reveal a server-bonus field like a metal-detector sweep across the columns
   * with escalating beeps — restores the progressive dig feel without changing
   * outcomes or breaking real-math (Stake) compatibility. */
  private async digSweep(): Promise<void> {
    this.ron.show('sweep');
    for (let c = 0; c < COLS; c++) {
      const col = [...Array(TILES).keys()].filter((t) => colOf(t) === c);
      audio.play(`beep_${Math.min(c + 1, 3)}` as 'beep_1');
      if (c >= COLS - 2) {
        this.ron.show('alert');
        this.hud.dockExcited(true);
      }
      await this.board.revealSegment(col, 'flood', []);
      await this.hold(150, 70);
    }
    this.hud.dockExcited(false);
    this.ron.show('sweep');
  }

  // --- revealed symbol tracking for pips ---
  tileSym = new Map<number, SymbolId>();

  private trackReveals(e: EvSweepSegment): void {
    for (const t of e.tiles) {
      const tv = this.board.tileView(t) as unknown as { sym?: SymbolId } | null;
      const sym = tv?.sym;
      if (!sym) continue;
      this.tileSym.set(t, sym);
    }
    this.recount();
  }

  private untrackTile(t: number): void {
    this.tileSym.delete(t);
    this.recount();
  }

  private recount(): void {
    this.revealedCounts.clear();
    for (const s of this.tileSym.values()) {
      this.revealedCounts.set(s, (this.revealedCounts.get(s) ?? 0) + 1);
    }
  }

  resetTracking(): void {
    this.tileSym.clear();
    this.revealedCounts.clear();
  }

  private centerX(): number {
    return this.board.toGlobal({ x: this.board.sizePx / 2, y: this.board.sizePx / 2 }).x;
  }
  private centerY(): number {
    return this.board.toGlobal({ x: this.board.sizePx / 2, y: this.board.sizePx / 2 }).y;
  }
}
