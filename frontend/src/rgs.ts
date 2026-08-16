/**
 * Pure helpers around the RGS bridge (window.StakeEngineBridge).
 */

export interface StakeBridge {
  isStake: boolean;
  sessionID: string | null;
  rgsUrl: string | null;
  query: URLSearchParams;
  ready: Promise<AuthResponse | null>;
  auth: AuthResponse | null;
  authenticate(): Promise<AuthResponse>;
  play(amountMicros: number, mode: string): Promise<PlayResponse>;
  endRound(): Promise<{ balance?: BalanceObj }>;
  balance(): Promise<{ balance?: BalanceObj }>;
  event(name: string): Promise<{ event: string }>;
  fetchReplay(game: string, version: string, mode: string, eventId: string): Promise<ReplayResponse>;
}

export interface BalanceObj {
  amount: number; // micro-units
  currency: string;
}

export interface Jurisdiction {
  socialCasino?: boolean;
  disabledFullscreen?: boolean;
  disabledTurbo?: boolean;
  disabledSuperTurbo?: boolean;
  disabledAutoplay?: boolean;
  disabledSlamstop?: boolean;
  disabledSpacebar?: boolean;
  disabledBuyFeature?: boolean;
  displayNetPosition?: boolean;
  displayRTP?: boolean;
  displaySessionTimer?: boolean;
  minimumRoundDuration?: number;
}

export interface AuthConfig {
  minBet?: number;
  maxBet?: number;
  stepBet?: number;
  defaultBetLevel?: number;
  betLevels?: number[];
  jurisdiction?: Jurisdiction;
}

export interface AuthResponse {
  balance?: BalanceObj;
  config?: AuthConfig;
  round?: RoundObj | null;
}

export interface RoundObj {
  active?: boolean;
  mode?: string;
  amount?: number; // micro
  payout?: number; // micro
  payoutMultiplier?: number; // DIRECT multiplier on the wire (books value / 100)
  state?: { events?: BookEvent[] } | BookEvent[] | null;
  events?: BookEvent[];
}

export interface PlayResponse {
  round?: RoundObj;
  balance?: BalanceObj;
}

export interface ReplayResponse {
  payoutMultiplier?: number;
  costMultiplier?: number;
  amount?: number; // micro-units
  currency?: string;
  state?: { events?: BookEvent[] } | BookEvent[] | null;
  mode?: string;
}

/** One entry of a predetermined round event list ("book"). */
export interface BookEvent {
  index?: number;
  type: string;
  [k: string]: unknown;
}

export function getStakeBridge(): StakeBridge | null {
  const b = (window as unknown as { StakeEngineBridge?: StakeBridge }).StakeEngineBridge;
  return b && b.isStake ? b : null;
}

export function getBridgeAlways(): StakeBridge | null {
  return (window as unknown as { StakeEngineBridge?: StakeBridge }).StakeEngineBridge ?? null;
}

export const toMicros = (d: number): number => Math.round(d * 1e6);
export const fromMicros = (m: number): number => m / 1e6;

/** Extract the event list from a round/replay `state` in any of its shapes. */
export function eventsOf(obj: { state?: RoundObj['state']; events?: BookEvent[] } | null | undefined): BookEvent[] {
  if (!obj) return [];
  if (Array.isArray(obj.events)) return obj.events;
  const s = obj.state;
  if (Array.isArray(s)) return s;
  if (s && Array.isArray((s as { events?: BookEvent[] }).events)) return (s as { events: BookEvent[] }).events;
  return [];
}

/** Clamp + snap a configured default bet to the offered levels. */
export function resolveDefaultBet(cfg: AuthConfig | undefined, fallback: number): number {
  if (!cfg) return fallback;
  const levels = (cfg.betLevels ?? []).map(fromMicros).filter((v) => v > 0);
  let def = cfg.defaultBetLevel != null ? fromMicros(cfg.defaultBetLevel) : fallback;
  const min = cfg.minBet != null ? fromMicros(cfg.minBet) : undefined;
  const max = cfg.maxBet != null ? fromMicros(cfg.maxBet) : undefined;
  if (min != null) def = Math.max(min, def);
  if (max != null) def = Math.min(max, def);
  if (levels.length) {
    let best = levels[0];
    for (const l of levels) if (Math.abs(l - def) < Math.abs(best - def)) best = l;
    return best;
  }
  return def;
}
