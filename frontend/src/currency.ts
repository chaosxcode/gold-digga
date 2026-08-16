/**
 * Per-currency display per the official Stake Engine CurrencyMeta table.
 * The 21 valid codes render distinctly (USD `$` vs CAD `CA$` vs MXN `MX$`...).
 * Unknown currency → amount + code suffix. 0-decimal currencies show no decimals.
 *
 * Two formatters, deliberately separate (review requirement):
 *  - moneyBal()  — BALANCE / BET / TOTAL / COST: fixed currency decimals, NEVER more.
 *  - moneyWin()  — WIN amounts only: full precision to the last decimal at sub-0.10 bets
 *                  so a 0.0035 win never displays as 0.00.
 */
import { isSocial, socialCoinCode } from './social';

interface Meta {
  symbol: string;
  decimals: number;
  symbolAfter?: boolean;
}

const META: Record<string, Meta> = {
  USD: { symbol: '$', decimals: 2 },
  CAD: { symbol: 'CA$', decimals: 2 },
  MXN: { symbol: 'MX$', decimals: 2 },
  BRL: { symbol: 'R$', decimals: 2 },
  CNY: { symbol: 'CN¥', decimals: 2 },
  JPY: { symbol: '¥', decimals: 0 },
  EUR: { symbol: '€', decimals: 2 },
  RUB: { symbol: '₽', decimals: 2 },
  PHP: { symbol: '₱', decimals: 2 },
  INR: { symbol: '₹', decimals: 2 },
  KRW: { symbol: '₩', decimals: 0 },
  TRY: { symbol: '₺', decimals: 2 },
  IDR: { symbol: 'Rp', decimals: 0 },
  XGC: { symbol: 'GC', decimals: 2, symbolAfter: true },
  XSC: { symbol: 'SC', decimals: 2, symbolAfter: true },
  GC: { symbol: 'GC', decimals: 2, symbolAfter: true },
  SC: { symbol: 'SC', decimals: 2, symbolAfter: true },
  DKK: { symbol: 'KR', decimals: 2, symbolAfter: true },
  PLN: { symbol: 'zł', decimals: 2, symbolAfter: true },
  VND: { symbol: '₫', decimals: 0, symbolAfter: true },
  CLP: { symbol: 'CLP', decimals: 0, symbolAfter: true },
  ARS: { symbol: 'ARS', decimals: 2, symbolAfter: true },
  PEN: { symbol: 'S/', decimals: 2, symbolAfter: true },
};

let _currency = 'USD';

export function setCurrency(code: string): void {
  _currency = (code || 'USD').toUpperCase();
}
export function getCurrency(): string {
  return _currency;
}

function metaFor(): Meta {
  if (isSocial()) {
    // Forced social under a non-social currency still shows a coin code, never `$`.
    return { symbol: socialCoinCode(_currency), decimals: 2, symbolAfter: true };
  }
  return META[_currency] ?? { symbol: _currency, decimals: 2, symbolAfter: true };
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function render(amountStr: string, meta: Meta): string {
  const [i, d] = amountStr.split('.');
  const body = d != null ? `${group(i)}.${d}` : group(i);
  return meta.symbolAfter ? `${body} ${meta.symbol}` : `${meta.symbol}${body}`;
}

/** Balance / bet / total / cost — fixed currency decimals, never widened. */
export function moneyBal(n: number): string {
  const meta = metaFor();
  return render(Math.max(0, n).toFixed(meta.decimals), meta);
}

/**
 * Win amounts — full precision to the last decimal when the bet is small enough
 * that the standard decimals would hide the win. At bets ≥ 0.10 currency units,
 * standard decimals apply.
 */
export function moneyWin(n: number, bet: number): string {
  const meta = metaFor();
  if (meta.decimals > 0 && bet > 0 && bet < 0.1) {
    // Stake approval: a sub-0.10 bet must not have its win ROUNDED AWAY — 0.9x of
    // 0.01 is 0.009 and may not read as 0.01. Payout multipliers carry 2 decimals
    // and these bets carry 2, so 4 decimals is always exactly enough; render at 4
    // and trim the padding back to the currency's own decimals.
    let s = n.toFixed(4);
    while (s.includes('.') && s.endsWith('0') && s.split('.')[1].length > meta.decimals) {
      s = s.slice(0, -1);
    }
    return render(s, meta);
  }
  return render(n.toFixed(meta.decimals), meta);
}

/** Big-win banner abbreviation (opt-in, celebration banner ONLY): $1.55M etc. */
export function moneyAbbrev(n: number): string {
  const meta = metaFor();
  if (n < 1e6) return moneyBal(n);
  const units: Array<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
  ];
  for (const [v, u] of units) {
    if (n >= v) {
      const body = (n / v).toFixed(2).replace(/\.?0+$/, '') + u;
      return meta.symbolAfter ? `${body} ${meta.symbol}` : `${meta.symbol}${body}`;
    }
  }
  return moneyBal(n);
}
