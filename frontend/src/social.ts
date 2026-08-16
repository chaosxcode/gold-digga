/**
 * Social-mode (sweepstakes jurisdiction) support.
 *
 * Detection triggers, in priority order:
 *  1. `social` URL param — `true|1` forces ON, `false|0` forces OFF (param wins).
 *  2. Currency wire code XSC / XGC (also bare SC / GC).
 *  3. authenticate config.jurisdiction.socialCasino === true.
 *
 * In social mode every user-facing string must pass through `sw()` and money
 * must never show `$` — it shows the coin code as a suffix ("1,000.00 SC").
 */

let _social = false;

export function detectSocial(
  params: URLSearchParams,
  currency: string | null | undefined,
  jurisdictionSocial: boolean | undefined,
): boolean {
  const p = (params.get('social') || '').toLowerCase();
  if (p === 'true' || p === '1') return true;
  if (p === 'false' || p === '0') return false;
  if (currency && /^X?(SC|GC)$/i.test(currency)) return true;
  return jurisdictionSocial === true;
}

export function setSocial(on: boolean): void {
  _social = on;
}
export function isSocial(): boolean {
  return _social;
}

/** Strip wire code for display: XSC→SC, XGC→GC. Non-social currency under forced social → SC. */
export function socialCoinCode(currency: string | null | undefined): 'SC' | 'GC' {
  const c = (currency || '').toUpperCase();
  if (c === 'XGC' || c === 'GC') return 'GC';
  return 'SC';
}

// Official Stake restricted→replacement table. ORDER IS LOAD-BEARING:
// longest / most-specific first so the single-pass alternation matches them first.
const TABLE: Array<[string, string]> = [
  ["be awarded to player's accounts", "appear in player's accounts"],
  ['place your bets', 'come and play'],
  ['at the cost of', 'for'],
  ['win feature', 'play feature'],
  ['buy bonus', 'get bonus'],
  ['bonus buy', 'bonus'],
  ['total bet', 'total play'],
  ['payouts', 'wins'],
  ['payout', 'win'],
  ['pays out', 'won'],
  ['pay out', 'win'],
  ['paid out', 'won'],
  ['cost of', 'can be played for'],
  ['costing', 'valued'],
  ['rebet', 'respin'],
  ['betting', 'playing'],
  ['bought', 'instantly triggered'],
  ['deposit', 'get coins'],
  ['withdraw', 'redeem'],
  ['purchases', 'plays'],
  ['purchase', 'play'],
  ['currency', 'token'],
  ['credits', 'balance'],
  ['credit', 'balance'],
  ['funds', 'balance'],
  ['fund', 'balance'],
  ['wagers', 'plays'],
  ['wager', 'play'],
  ['gambling', 'playing'],
  ['gambles', 'plays'],
  ['gamble', 'play'],
  ['payer', 'winner'],
  ['stake', 'play amount'],
  ['bets', 'plays'],
  ['pays', 'wins'],
  ['paid', 'won'],
  ['cash', 'coins'],
  ['money', 'coins'],
  ['costs', 'amounts'],
  ['cost', 'amount'],
  ['bet', 'play'],
  ['buys', 'plays'],
  ['buy', 'play'],
  ['pay', 'win'],
];

const MAP = new Map(TABLE.map(([f, t]) => [f.toLowerCase(), t]));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RE = new RegExp('\\b(' + TABLE.map(([f]) => esc(f)).join('|') + ')\\b', 'gi');

function applyCase(src: string, repl: string): string {
  if (src === src.toUpperCase() && src !== src.toLowerCase()) return repl.toUpperCase();
  const w = src.split(/\s+/);
  if (w.every((x) => x && x[0] === x[0].toUpperCase())) {
    return repl
      .split(/\s+/)
      .map((x) => (x ? x[0].toUpperCase() + x.slice(1) : x))
      .join(' ');
  }
  return repl;
}

/** Single-pass, case-preserving restricted-word swap. */
export function socialSwap(text: string): string {
  if (text == null) return text;
  return String(text).replace(RE, (m) => applyCase(m, MAP.get(m.toLowerCase()) as string));
}

/** Route ALL display strings through this: sw('Total Bet') — swaps only in social mode. */
export function sw(text: string): string {
  return _social ? socialSwap(text) : text;
}

/**
 * DOM sweep: swap restricted words in every text node + aria-label/title attribute
 * under `root`. Run after any dynamic rebuild while in social mode.
 * Nodes marked data-no-swap (e.g. the currency-code label) are skipped.
 */
export function sweepDom(root: ParentNode = document.body): void {
  if (!_social) return;
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el || el.closest('[data-no-swap]')) continue;
    const t = n.textContent;
    if (t && RE.test(t)) {
      RE.lastIndex = 0;
      n.textContent = socialSwap(t);
    }
    RE.lastIndex = 0;
  }
  const attrEls = (root as Element | Document).querySelectorAll?.('[aria-label], [title]') ?? [];
  attrEls.forEach((el) => {
    if (el.closest('[data-no-swap]')) return;
    for (const a of ['aria-label', 'title']) {
      const v = el.getAttribute(a);
      if (v) el.setAttribute(a, socialSwap(v));
    }
  });
}
