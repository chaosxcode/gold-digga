/**
 * Feature cards — the bonus trigger takeover and the end-of-bonus summary
 * (museum plaque). Block until the player taps Continue (or auto-continue
 * after a hold in autoplay/turbo).
 */
import { ms } from './anim';
import { moneyWin } from './currency';
import { sw, sweepDom } from './social';
import { SYMBOL_NAMES, SymbolId } from './books';

const el = (id: string) => document.getElementById(id)!;

function showCard(opts: {
  title: string;
  sub: string;
  amount?: string;
  /** animate the amount from 0 → value instead of a static string */
  countUp?: { value: number; bet: number };
  stats?: string;
  plaque?: boolean;
  /** symbol/art image URLs shown above the title (chests, top find) */
  art?: string[];
  btn: string;
  autoMs?: number;
}): Promise<void> {
  el('fc-title').textContent = sw(opts.title);
  el('fc-sub').textContent = sw(opts.sub);
  const amountEl = el('fc-amount');
  const hasAmount = Boolean(opts.amount || opts.countUp);
  amountEl.textContent = opts.countUp ? moneyWin(0, opts.countUp.bet) : (opts.amount ?? '');
  amountEl.style.display = hasAmount ? 'block' : 'none';
  el('fc-stats').textContent = opts.stats ? sw(opts.stats) : '';
  (el('fc-plaque') as HTMLImageElement).style.display = opts.plaque ? 'block' : 'none';
  el('fc-inner').classList.toggle('has-plaque', Boolean(opts.plaque));
  const art = el('fc-art');
  art.innerHTML = '';
  art.classList.toggle('show', Boolean(opts.art?.length));
  for (const src of opts.art ?? []) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    art.appendChild(img);
  }
  const btn = el('fc-btn') as HTMLButtonElement;
  btn.textContent = sw(opts.btn);
  el('feature-card').classList.add('open');
  sweepDom(el('feature-card'));
  let raf = 0;
  if (opts.countUp) {
    const { value, bet } = opts.countUp;
    const dur = ms(Math.min(2200, 700 + value * 6), 900);
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      amountEl.textContent = moneyWin(value * k, bet);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      btn.onclick = null;
      if (raf) cancelAnimationFrame(raf);
      if (opts.countUp) amountEl.textContent = moneyWin(opts.countUp.value, opts.countUp.bet);
      el('feature-card').classList.remove('open');
      resolve();
    };
    btn.onclick = finish;
    if (opts.autoMs) setTimeout(finish, opts.autoMs);
  });
}

// feature_deepscan books carry a copy-pasted Big Dig trigger event (totalSweeps: 10,
// bonusMode: 'bigdig') even though the feature runs a single sweep — so the copy
// comes from `kind` (read off the book's mode), never from the event's fields.
export function bonusTriggerCard(totalSweeps: number, kind: 'bigdig' | 'nightdig' | 'deepscan'): Promise<void> {
  const deep = kind === 'deepscan';
  return showCard({
    title: deep ? 'DEEP SCAN SWEEP' : kind === 'nightdig' ? 'NIGHT DIG' : 'THE BIG DIG',
    sub: deep ? 'One sweep — guaranteed Deep Scan.' : `${totalSweeps} digs — depth & Signal carry.`,
    art: ['assets/symbols/SC.webp', 'assets/symbols/SC.webp', 'assets/symbols/SC.webp'],
    btn: 'Start Digging',
    autoMs: ms(6000, 3000),
  });
}

export function bonusSummaryCard(opts: {
  totalWin: number;
  bet: number;
  sweepsPlayed: number;
  peakMeter: number;
  topFind: { symbol: SymbolId; amount: number };
  deepestStratum: number;
}): Promise<void> {
  const strata = ['Topsoil', 'Toxic', 'Motherlode'];
  return showCard({
    title: 'DIG COMPLETE',
    sub: 'The haul',
    countUp: { value: opts.totalWin, bet: opts.bet },
    stats: `${opts.sweepsPlayed} sweeps · peak signal x${opts.peakMeter} · deepest: ${strata[opts.deepestStratum]} · best find: ${SYMBOL_NAMES[opts.topFind.symbol]}`,
    plaque: true,
    art: [`assets/symbols/${opts.topFind.symbol}.webp`],
    btn: 'Collect',
    autoMs: ms(9000, 4500),
  });
}
