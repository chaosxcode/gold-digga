/**
 * DOM HUD controller — depth pills, signal meter, progress pips, message and
 * equation lines, bet/balance/win readouts, spin button state.
 * All display strings route through sw() (social swap).
 */
import { Stratum, SYMBOL_NAMES, SymbolId } from './books';
import { moneyBal, moneyWin } from './currency';
import { sw } from './social';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export class Hud {
  private meterBox = $('meter-box');
  private meterValue = $('meter-value');
  private pillEls = Array.from(document.querySelectorAll<HTMLElement>('.pill'));
  private pipsRow = $('pips-row');
  private equation = $('equation-line');
  private msg = $('msg-line');
  private betValue = $('bet-value');
  private balanceValue = $('balance-value');
  private winValue = $('win-value');
  private winPrimed = false;
  private spinBtn = $<HTMLButtonElement>('spin-btn');
  private dockFace = $('dock-face');
  private sweepCounter = $('sweep-counter');
  private winTicker: number | null = null;
  private shownWin = 0;
  private meterNeedle = $('meter-needle');
  private meterShown = 1;
  private meterTicker: number | null = null;

  /** x1..x1000+ mapped onto the readout's dial arc (log scale). */
  private needleAngle(v: number): number {
    return -50 + 100 * Math.min(1, Math.log10(Math.max(1, v)) / 3);
  }

  setMeter(value: number, hot = false): void {
    if (this.meterTicker) {
      cancelAnimationFrame(this.meterTicker);
      this.meterTicker = null;
    }
    const isHot = hot || value >= 25;
    this.meterValue.classList.toggle('hot', isHot);
    this.meterBox.classList.toggle('hot-box', isHot);
    const render = (v: number) => {
      this.meterValue.textContent = `x${Math.round(v)}`;
      this.meterNeedle.style.transform = `translateX(-50%) rotate(${this.needleAngle(v)}deg)`;
    };
    const from = this.meterShown;
    if (value === from) {
      render(value);
      return;
    }
    this.meterBox.classList.remove('bump');
    void this.meterBox.offsetWidth; // restart transition
    this.meterBox.classList.add('bump');
    setTimeout(() => this.meterBox.classList.remove('bump'), 180);
    // number-roll + needle sweep on every change (down-rolls drain fast)
    const dur = value < from ? 340 : Math.min(600, 160 + Math.abs(value - from) * 6);
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      this.meterShown = from + (value - from) * k;
      render(this.meterShown);
      if (k < 1) this.meterTicker = requestAnimationFrame(step);
      else {
        this.meterShown = value;
        this.meterTicker = null;
      }
    };
    this.meterTicker = requestAnimationFrame(step);
  }

  /** Round-over flourish: the signal dies with the round. */
  drainMeter(): Promise<void> {
    if (this.meterShown <= 1) return Promise.resolve();
    this.setMeter(1);
    return new Promise((res) => setTimeout(res, 380));
  }

  /** Screen-space center of the meter's display window (tag-flight target). */
  meterScreenPos(): { x: number; y: number } {
    const r = this.meterBox.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.45 };
  }

  setDepth(d: Stratum): void {
    this.pillEls.forEach((p) => {
      const pd = Number(p.dataset.d);
      p.classList.toggle('lit', pd <= d);
    });
  }

  /** Show top 3 leading symbol counts, e.g. "Chalice 6/8". */
  setPips(counts: Map<SymbolId, number>): void {
    const top = [...counts.entries()]
      .filter(([s]) => s !== 'SC' && s !== 'PP')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    this.pipsRow.innerHTML = '';
    for (const [sym, n] of top) {
      if (n < 3) continue;
      const el = document.createElement('span');
      el.className = 'pip' + (n >= 8 ? ' hit' : n >= 6 ? ' close' : '');
      const img = document.createElement('img');
      img.src = `assets/symbols/${sym}.webp`;
      img.alt = '';
      el.appendChild(img);
      el.appendChild(document.createTextNode(`${Math.min(n, 8)}/8`));
      el.title = sw(SYMBOL_NAMES[sym]);
      this.pipsRow.appendChild(el);
    }
  }

  clearPips(): void {
    this.pipsRow.innerHTML = '';
  }

  setEquation(text: string): void {
    this.equation.textContent = text ? sw(text) : '';
  }

  private baseMsg = '';

  /** Persistent message (e.g. "SWEEP 4 OF 10") — flashes restore to this. */
  setMessage(text: string): void {
    this.baseMsg = text ? sw(text) : '';
    this.msg.textContent = this.baseMsg;
  }

  flashMessage(text: string, holdMs = 2200): void {
    const t = text ? sw(text) : '';
    this.msg.textContent = t;
    window.setTimeout(() => {
      if (this.msg.textContent === t) this.msg.textContent = this.baseMsg;
    }, holdMs);
  }

  private sweepTimers: number[] = [];

  setSweepCounter(text: string | null): void {
    this.sweepTimers.forEach((t) => clearTimeout(t));
    this.sweepTimers = [];
    if (!text) {
      this.sweepCounter.style.display = 'none';
      return;
    }
    this.sweepCounter.textContent = sw(text);
    this.sweepCounter.style.display = 'block';
    this.sweepCounter.style.opacity = '1';
    this.sweepTimers.push(
      window.setTimeout(() => {
        this.sweepCounter.style.transition = 'opacity 500ms';
        this.sweepCounter.style.opacity = '0';
        this.sweepTimers.push(window.setTimeout(() => (this.sweepCounter.style.display = 'none'), 550));
      }, 1100),
    );
    this.sweepCounter.style.transition = '';
  }

  setBet(bet: number): void {
    this.betValue.textContent = moneyBal(bet);
    // prime the WIN readout with the currency symbol once — its static markup
    // default is a bare "0.00" with no symbol until the first real win
    if (!this.winPrimed) {
      this.winPrimed = true;
      this.winValue.textContent = moneyWin(0, bet);
    }
  }

  setBalance(balance: number): void {
    this.balanceValue.textContent = moneyBal(balance);
  }

  /** Win readout: rests dim at 0; ignites gold on any real value. */
  setWin(amount: number, bet: number, immediate = false): void {
    if (this.winTicker) {
      cancelAnimationFrame(this.winTicker);
      this.winTicker = null;
    }
    const render = (v: number) => {
      this.winValue.textContent = moneyWin(v, bet);
      this.winValue.classList.toggle('lit', v > 0);
    };
    if (immediate || amount <= this.shownWin) {
      this.shownWin = amount;
      render(amount);
      return;
    }
    // ticker UP through the value — never jump, never run backward: shownWin
    // commits on every rendered frame so a superseding update resumes from
    // the last painted value instead of snapping back.
    const from = this.shownWin;
    const dur = Math.min(900, 250 + (amount - from) * 12);
    const t0 = performance.now();
    this.winValue.classList.add('pulse');
    setTimeout(() => this.winValue.classList.remove('pulse'), 350);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      this.shownWin = from + (amount - from) * k;
      render(this.shownWin);
      if (k < 1) this.winTicker = requestAnimationFrame(step);
      else {
        this.shownWin = amount;
        this.winTicker = null;
      }
    };
    this.winTicker = requestAnimationFrame(step);
  }

  resetWin(): void {
    this.shownWin = 0;
    this.setWin(0, 1, true);
  }

  setSpinEnabled(on: boolean): void {
    this.spinBtn.disabled = !on;
  }

  setSpinning(on: boolean): void {
    this.spinBtn.classList.toggle('spinning', on);
  }

  dockExcited(on: boolean): void {
    this.dockFace.classList.toggle('excited', on);
  }

  setDockFace(url: string): void {
    this.dockFace.style.backgroundImage = `url('${url}')`;
  }

  /** Board layout rect: the free space of #board-slot, in CSS px. */
  boardRect(): DOMRect {
    return document.getElementById('board-slot')!.getBoundingClientRect();
  }
}
