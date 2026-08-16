/**
 * Game controller — the round state machine and all player-facing wiring.
 *
 * Paths: DEMO (mock books from bookgen) and STAKE (RGS bridge; books arrive
 * as round.state). Both feed the same Presenter. Compliance behaviors built
 * in: confirm dialogs on every paid mode + Rally-ON, autoplay confirm + full
 * session lockout (incl. inter-spin gaps and buy→trigger pending), spacebar
 * spin, jurisdiction flags, Watch-or-Skip resume, replay-URL mode with zero
 * session calls, fail-closed handled by boot (main.ts).
 */
import { Book, MODES, ModeId } from './books';
import { generateBook } from './mock/bookgen';
import { Presenter } from './presenter';
import { Hud } from './hud';
import { audio } from './audio';
import { timing } from './anim';
import { askConfirm, closeModal, currentModal, openModal } from './modals';
import { moneyBal } from './currency';
import { sw, sweepDom, isSocial } from './social';
import { renderInfo } from './info';
import {
  StakeBridge,
  eventsOf,
  fromMicros,
  getStakeBridge,
  resolveDefaultBet,
  toMicros,
} from './rgs';

type RoundState = 'idle' | 'resuming' | 'playing' | 'presenting' | 'settling';

const DEMO_LEVELS = [0.1, 0.2, 0.5, 1, 2, 3, 5, 10, 20, 50, 100];

export class Controller {
  private state: RoundState = 'idle';
  private betLevels = DEMO_LEVELS;
  private betIdx = 3;
  private balance = 1000;
  private coil: 'standard' | 'xl' = 'standard';
  private rally = false;
  private autoCount = 0;
  private autoPending = false;
  private autoTimer: number | null = null;
  private buyPending = false;
  private rgs: StakeBridge | null = null;
  private jur: Record<string, boolean> = {};
  private demo = true;

  constructor(
    private presenter: Presenter,
    private hud: Hud,
  ) {}

  // ---------- derived ----------
  get bet(): number {
    return this.betLevels[this.betIdx];
  }
  private get autoplaying(): boolean {
    return this.autoCount > 0 || this.autoPending || this.autoTimer != null;
  }
  private get locked(): boolean {
    return this.state !== 'idle' || this.autoplaying || this.buyPending;
  }
  activeMode(): ModeId {
    if (this.rally) return 'base_rally';
    return this.coil === 'xl' ? 'base_xl' : 'base_standard';
  }
  private spinCost(): number {
    return this.bet * MODES[this.activeMode()].cost;
  }

  // ---------- boot ----------
  async init(): Promise<void> {
    this.rgs = getStakeBridge();
    this.demo = !this.rgs;
    if (this.rgs?.auth) {
      const a = this.rgs.auth;
      const cfg = a.config;
      if (cfg?.betLevels?.length) {
        this.betLevels = cfg.betLevels.map(fromMicros).filter((v) => v > 0).sort((x, y) => x - y);
      } else if (cfg?.minBet && cfg?.maxBet) {
        // no operator levels supplied: synthesize min..max stepping by stepBet
        const min = fromMicros(cfg.minBet);
        const max = fromMicros(cfg.maxBet);
        const step = cfg.stepBet ? fromMicros(cfg.stepBet) : min;
        const lv: number[] = [];
        for (let v = min; v <= max + 1e-9 && lv.length < 500; v += step) lv.push(Number(v.toFixed(6)));
        if (lv.length) this.betLevels = lv;
      }
      // operator min/max always bound whatever list we ended up with
      const lo = cfg?.minBet != null ? fromMicros(cfg.minBet) : 0;
      const hi = cfg?.maxBet != null ? fromMicros(cfg.maxBet) : Infinity;
      this.betLevels = this.betLevels.filter((v) => v >= lo && v <= hi);
      if (!this.betLevels.length) this.betLevels = [lo > 0 ? lo : 1];
      // Stake approval: when /authenticate returns an ACTIVE round (the player was
      // interrupted mid-round), display the bet level THAT round was played at.
      // The operator default applies only when there is no active round.
      const roundBet =
        a.round?.active === true && a.round.amount != null ? fromMicros(a.round.amount) : null;
      const def = roundBet ?? resolveDefaultBet(cfg, 1);
      const fi = this.betLevels.findIndex((l) => Math.abs(l - def) < 1e-9);
      // a restored round's bet need not sit exactly on a level (the operator's list
      // can change between sessions) — snap to the nearest rather than silently
      // falling back to the lowest, which is the very bug this fixes
      const nearest = (t: number) =>
        this.betLevels.reduce((b, l, i) => (Math.abs(l - t) < Math.abs(this.betLevels[b] - t) ? i : b), 0);
      this.betIdx = fi >= 0 ? fi : roundBet != null ? nearest(roundBet) : 0;
      if (a.balance) this.balance = fromMicros(a.balance.amount);
      const j = cfg?.jurisdiction ?? {};
      this.jur = j as Record<string, boolean>;
      if ((j as { disabledTurbo?: boolean }).disabledTurbo) {
        document.getElementById('turbo-btn')!.style.display = 'none';
      }
      if ((j as unknown as { disabledAutoplay?: boolean }).disabledAutoplay) {
        document.getElementById('auto-btn')!.style.display = 'none';
      }
      if ((j as unknown as { disabledBuyFeature?: boolean }).disabledBuyFeature) {
        document.getElementById('row-buy')!.style.display = 'none';
        document.getElementById('bonus-btn')!.style.display = 'none';
      }
      const jf = j as unknown as Record<string, boolean | number>;
      if (jf.displaySessionTimer) {
        const el = document.getElementById('session-timer')!;
        el.style.display = 'block';
        const t0 = Date.now();
        setInterval(() => {
          const s = Math.floor((Date.now() - t0) / 1000);
          el.textContent = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        }, 1000);
      }
      if (jf.displayNetPosition) {
        document.getElementById('net-block')!.style.display = 'block';
      }
      if (jf.displayRTP) {
        document.getElementById('rtp-inline')!.style.display = 'block';
      }
      this.minRoundMs = Number(jf.minimumRoundDuration ?? 0) * 1000 || 0;
      // disabledSuperTurbo / disabledSlamstop: this game ships neither a
      // super-turbo tier nor a slam-stop; single turbo stays legal.
    }
    this.wireControls();
    this.refresh();

    // dev/QA hook (demo mode only): force a specific outcome bucket
    if (!this.rgs) {
      (window as unknown as { __hs?: unknown }).__hs = {
        spin: (criteria?: string, mode?: string) => {
          this.forcedCriteria = criteria as never;
          void this.spin((mode as ModeId) ?? undefined);
        },
      };
    }

  }

  /** Watch-or-Skip on an active round left open server-side. Call AFTER the
   *  loader is gone (a modal behind the loader would deadlock the boot). */
  async maybeOfferResume(): Promise<void> {
    const round = this.rgs?.auth?.round;
    if (round?.active === true) {
      await this.offerResume(round);
    }
  }

  // ---------- resume ----------
  private async offerResume(round: NonNullable<StakeBridge['auth']>['round'] & object): Promise<void> {
    const events = eventsOf(round as { state?: unknown; events?: unknown } as never);
    const sweeps = (events as Array<{ type: string; totalSweeps?: number; sweep?: number }>).filter(
      (e) => e.type === 'sweepStart',
    );
    const body = document.getElementById('resume-body')!;
    body.textContent = sweeps.length
      ? sw(`You have an unfinished round (sweep ${sweeps[sweeps.length - 1]?.sweep ?? 1} of ${sweeps[sweeps.length - 1]?.totalSweeps ?? sweeps.length}).`)
      : sw('You have an unfinished round.');
    this.state = 'resuming';
    this.refresh();
    openModal('m-resume');
    await new Promise<void>((resolve) => {
      const watch = document.getElementById('resume-watch') as HTMLButtonElement;
      const skip = document.getElementById('resume-skip') as HTMLButtonElement;
      const betMicro = (round as { amount?: number }).amount ?? toMicros(this.bet);
      const bet = fromMicros(betMicro);
      const done = async (mode: 'watch' | 'skip') => {
        watch.onclick = null;
        skip.onclick = null;
        closeModal();
        this.state = 'presenting';
        this.refresh();
        try {
          if (mode === 'watch' && events.length) {
            const book: Book = {
              id: 0,
              payoutMultiplier: Math.round(((round as { payoutMultiplier?: number }).payoutMultiplier ?? 0) * 100),
              events: events as unknown as Book['events'],
              criteria: 'small',
            };
            await this.presenter.present(book, { bet });
          } else {
            const payout = fromMicros((round as { payout?: number }).payout ?? 0);
            this.hud.setWin(payout, bet, true);
          }
        } finally {
          await this.settle((round as { payoutMultiplier?: number }).payoutMultiplier ?? 0);
          this.state = 'idle';
          this.refresh();
          resolve();
        }
      };
      watch.onclick = () => void done('watch');
      skip.onclick = () => void done('skip');
    });
  }

  // ---------- settle ----------
  private async settle(wirePayoutMultiplier: number): Promise<void> {
    if (!this.rgs) return;
    // zero-payout rounds auto-close on the RGS; end-round only credits wins
    if (wirePayoutMultiplier > 0) {
      try {
        const r = await this.rgs.endRound();
        if (r.balance) this.balance = fromMicros(r.balance.amount);
      } catch {
        try {
          const b = await this.rgs.balance();
          if (b.balance) this.balance = fromMicros(b.balance.amount);
        } catch {
          /* keep local */
        }
      }
      this.hud.setBalance(this.balance);
    }
  }

  // ---------- spin ----------
  /** @returns whether a round actually started (buy flow resets on false) */
  async spin(mode?: ModeId): Promise<boolean> {
    if (this.state !== 'idle') return false;
    const m = mode ?? this.activeMode();
    const cost = this.bet * MODES[m].cost;
    if (this.balance < cost) {
      this.stopAutoplay();
      this.hud.flashMessage('Balance too low for this play.');
      return false;
    }
    this.state = 'playing';
    this.hud.resetWin();
    this.presenter.resetTracking();
    this.refresh();
    audio.play('ui_click');
    const roundStart = performance.now();
    this.updateNet(-cost);

    let started = true;
    try {
      let book: Book;
      let bet = this.bet;
      if (this.rgs) {
        const resp = await this.rgs.play(toMicros(this.bet), m.toUpperCase());
        if (resp.balance) {
          this.balance = fromMicros(resp.balance.amount);
          this.hud.setBalance(this.balance);
        }
        const events = eventsOf(resp.round ?? null);
        if (!events.length) throw new Error('Empty state in round');
        book = {
          id: 0,
          payoutMultiplier: Math.round((resp.round?.payoutMultiplier ?? 0) * 100),
          events: events as unknown as Book['events'],
          criteria: 'small',
        };
      } else {
        // demo wallet
        this.balance -= cost;
        this.hud.setBalance(this.balance);
        book = generateBook(m, undefined, this.forcedCriteria ?? undefined);
        this.forcedCriteria = null;
      }

      this.state = 'presenting';
      await this.presenter.present(book, {
        bet,
        onEventIndex: (idx) => {
          // mid-round checkpoint for long bonuses (fire-and-forget)
          if (this.rgs && book.events.length > 25 && idx % 20 === 0) {
            void this.rgs.event(String(idx)).catch(() => {});
          }
        },
      });

      this.state = 'settling';
      const winX = book.payoutMultiplier / 100;
      this.updateNet(winX * bet);
      if (this.rgs) {
        await this.settle(winX);
      } else {
        this.balance += winX * bet;
        this.hud.setBalance(this.balance);
      }
      // jurisdictional minimum round duration (overrides turbo)
      const elapsed = performance.now() - roundStart;
      if (this.minRoundMs > elapsed) {
        await new Promise((r) => setTimeout(r, this.minRoundMs - elapsed));
      }
    } catch (err) {
      this.stopAutoplay();
      started = false; // a caught error means the round did not cleanly start/settle
      // distinct UX per RGS error class: limit/location/maintenance messages
      // must never read as "retry into play"
      const code = (err as { code?: string })?.code ?? '';
      const blocking = code === 'ERR_GLE' || code === 'ERR_LOC' || code === 'ERR_MAINTENANCE';
      // a blocking / insufficient-balance rejection placed NO bet — undo the net
      // debit from line above so the readout doesn't show a phantom loss
      if (blocking || code === 'ERR_IB') this.updateNet(cost);
      const msgs: Record<string, string> = {
        ERR_GLE: 'This play would exceed a limit on your account. The bet was not placed.',
        ERR_LOC: 'Play is not available from your current location.',
        ERR_MAINTENANCE: 'The game server is briefly down for maintenance. Please try again in a few minutes.',
        ERR_IB: 'Balance too low for this play.',
      };
      document.getElementById('error-body')!.textContent = sw(
        msgs[code] ?? 'Connection hiccup. Your balance is safe — the round will resolve when you reconnect.',
      );
      const retry = document.getElementById('error-retry') as HTMLButtonElement;
      retry.textContent = sw(blocking || code === 'ERR_IB' ? 'OK' : 'Retry');
      openModal('m-error');
      await new Promise<void>((res) => (retry.onclick = () => { retry.onclick = null; closeModal(); res(); }));
      if (this.rgs && !blocking) {
        // best-effort recovery: settle anything left open + refresh balance
        try { await this.rgs.endRound(); } catch { /* no open round */ }
        try {
          const b = await this.rgs.balance();
          if (b.balance) this.balance = fromMicros(b.balance.amount);
          this.hud.setBalance(this.balance);
        } catch { /* offline */ }
      }
      if (new URLSearchParams(location.search).get('debug') === '1') console.error(err);
    } finally {
      this.buyPending = false;
      this.state = 'idle';
      this.refresh();
      this.maybeAutoNext();
    }
    return started;
  }

  // ---------- autoplay ----------
  private maybeAutoNext(): void {
    if (this.autoCount <= 0) return;
    this.autoCount--;
    this.updateAutoBadge();
    if (this.autoCount <= 0) {
      this.stopAutoplay();
      return;
    }
    if (this.balance < this.spinCost()) {
      this.stopAutoplay();
      this.hud.flashMessage('Autoplay stopped — balance too low.');
      return;
    }
    this.autoPending = true;
    this.autoTimer = window.setTimeout(() => {
      this.autoTimer = null;
      this.autoPending = false;
      void this.spin();
    }, 380);
  }

  private stopAutoplay(): void {
    this.autoCount = 0;
    this.autoPending = false;
    if (this.autoTimer) {
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
    this.updateAutoBadge();
    this.refresh();
  }

  private updateAutoBadge(): void {
    const b = document.getElementById('auto-btn')!;
    // the running badge doubles as the stop control: stop glyph + remaining
    b.textContent = this.autoCount > 0 ? `■ ${this.autoCount}` : ''; // idle shows the autoplay art alone
    b.classList.toggle('on', this.autoCount > 0);
  }

  // ---------- UI wiring ----------
  private refresh(): void {
    this.hud.setBet(this.bet);
    this.hud.setBalance(this.balance);
    // While autoplay runs the spin button doubles as STOP (see its click handler)
    // and must stay live mid-round — Stake requires autoplay be stoppable at any
    // time, and reaching it via the hamburger menu alone does not satisfy that.
    // A stray click cannot start a round: spin() returns early unless state==='idle'.
    this.hud.setSpinEnabled(this.autoplaying || (this.state === 'idle' && !this.autoPending));
    const lock = this.locked;
    (document.getElementById('bet-down') as HTMLButtonElement).disabled = lock || this.betIdx === 0;
    (document.getElementById('bet-up') as HTMLButtonElement).disabled = lock || this.betIdx === this.betLevels.length - 1;
    (document.getElementById('open-buy') as HTMLButtonElement).disabled = lock;
    (document.getElementById('bonus-btn') as HTMLButtonElement).disabled = lock;
    (document.getElementById('coil-btn') as HTMLButtonElement).disabled = lock;
    (document.getElementById('rally-toggle') as HTMLInputElement).disabled = lock;
  }

  private wireControls(): void {
    const $ = (id: string) => document.getElementById(id)!;

    const uiBlocked = () => {
      if (currentModal() != null) return true;
      const loader = document.getElementById('loader');
      return !!loader && loader.style.display !== 'none' && loader.offsetParent !== null;
    };
    $('spin-btn').addEventListener('click', () => {
      if (uiBlocked()) return;
      if (this.autoplaying) {
        this.stopAutoplay();
        return;
      }
      void this.spin();
    });

    // spacebar → spin; HOLD it down to keep spinning (honour jurisdiction)
    if (!(this.jur as { disabledSpacebar?: boolean }).disabledSpacebar) {
      let spaceHeld = false;
      let spinLooping = false;
      const runHeldSpins = async () => {
        if (spinLooping) return; // one loop at a time
        spinLooping = true;
        while (spaceHeld && !uiBlocked() && !this.autoplaying) {
          const ok = await this.spin();
          if (!ok) break; // busy / low balance / error → end the held streak
        }
        spinLooping = false;
      };
      window.addEventListener('keydown', (e) => {
        if (e.code !== 'Space') return;
        e.preventDefault();
        if (e.repeat) return; // ignore OS key-repeat; round completion drives the loop
        if (uiBlocked()) return;
        if (this.autoplaying) { this.stopAutoplay(); return; }
        spaceHeld = true;
        void runHeldSpins();
      });
      window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') spaceHeld = false;
      });
    }
    // never allow scroll keys to move the frame
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) e.preventDefault();
    });

    $('bet-down').addEventListener('click', () => {
      if (this.locked || this.betIdx === 0) return;
      this.betIdx--;
      audio.play('ui_click');
      this.refresh();
    });
    $('bet-up').addEventListener('click', () => {
      if (this.locked || this.betIdx === this.betLevels.length - 1) return;
      this.betIdx++;
      audio.play('ui_click');
      this.refresh();
    });

    $('turbo-btn').addEventListener('click', () => {
      timing.turbo = !timing.turbo;
      $('turbo-btn').classList.toggle('on', timing.turbo);
      audio.play('ui_click');
    });

    $('menu-btn').addEventListener('click', () => openModal('m-menu'));
    $('open-info').addEventListener('click', () => {
      renderInfo(this.bet);
      openModal('m-info');
    });

    // sound — on-screen mute button and the menu toggle stay in lockstep
    const soundToggle = $('sound-toggle') as HTMLInputElement;
    const soundBtn = $('sound-btn') as HTMLButtonElement;
    const syncSound = () => {
      soundToggle.checked = !audio.muted;
      // plain wood in both states — a gold "on" here would fight the gold
      // spin button directly above it
      soundBtn.classList.toggle('muted', audio.muted);
      soundBtn.setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
    };
    syncSound();
    soundToggle.addEventListener('change', () => {
      audio.setMuted(!soundToggle.checked);
      syncSound();
    });
    soundBtn.addEventListener('click', () => {
      audio.setMuted(!audio.muted);
      syncSound();
      audio.play('ui_click');
    });

    // coil select
    $('coil-btn').addEventListener('click', () => {
      this.markCoilCards();
      openModal('m-coil');
    });
    $('coil-std').addEventListener('click', () => this.setCoil('standard'));
    $('coil-xl').addEventListener('click', () => void this.setCoilXl());

    // rally
    const rallyToggle = $('rally-toggle') as HTMLInputElement;
    rallyToggle.addEventListener('change', () => void this.onRallyToggle(rallyToggle));

    // buy menu
    $('open-buy').addEventListener('click', () => this.openBuyMenu());
    $('bonus-btn').addEventListener('click', () => {
      if (uiBlocked()) return;
      audio.play('ui_click');
      this.openBuyMenu();
    });
    $('buy-accept').addEventListener('click', () => void this.onBuyAccept());
    // adjust the play amount from inside the buy modal (kept in sync with the HUD)
    $('buy-bet-down').addEventListener('click', () => {
      if (this.locked || this.betIdx === 0) return;
      this.betIdx--;
      audio.play('ui_click');
      this.refreshBuyModal();
      this.refresh();
    });
    $('buy-bet-up').addEventListener('click', () => {
      if (this.locked || this.betIdx === this.betLevels.length - 1) return;
      this.betIdx++;
      audio.play('ui_click');
      this.refreshBuyModal();
      this.refresh();
    });
    document.querySelectorAll<HTMLElement>('.buy-card[data-buy]').forEach((card) => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.buy-card[data-buy]').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        ($('buy-accept') as HTMLButtonElement).disabled = false;
        audio.play('ui_click');
      });
    });

    // autoplay
    $('auto-btn').addEventListener('click', () => {
      if (this.autoplaying) {
        this.stopAutoplay();
        return;
      }
      if (this.state !== 'idle') return;
      this.selectedAuto = 0;
      ($('auto-start') as HTMLButtonElement).disabled = true;
      $('auto-cost').textContent = '';
      document.querySelectorAll('#auto-counts .wood-btn').forEach((b) => b.classList.remove('on'));
      openModal('m-auto');
    });
    document.querySelectorAll<HTMLButtonElement>('#auto-counts [data-n]').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#auto-counts .wood-btn').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        this.selectedAuto = Number(b.dataset.n);
        $('auto-cost').textContent = sw(
          `${this.selectedAuto} automatic spins at ${moneyBal(this.spinCost())} per spin.`,
        );
        sweepDom($('m-auto'));
        ($('auto-start') as HTMLButtonElement).disabled = false;
        audio.play('ui_click');
      });
    });
    $('auto-start').addEventListener('click', () => {
      if (!this.selectedAuto) return;
      closeModal();
      this.autoCount = this.selectedAuto;
      this.updateAutoBadge();
      this.refresh();
      audio.play('ui_confirm');
      void this.spin();
    });
  }

  private selectedAuto = 0;
  private forcedCriteria: import('./books').BookCriteria | null = null;
  private minRoundMs = 0;
  private netPosition = 0;

  private updateNet(delta: number): void {
    this.netPosition += delta;
    const el = document.getElementById('net-value');
    if (el) {
      el.textContent = (this.netPosition >= 0 ? '+' : '−') + moneyBal(Math.abs(this.netPosition));
    }
  }

  private markCoilCards(): void {
    document.getElementById('coil-std')!.classList.toggle('selected', this.coil === 'standard');
    document.getElementById('coil-xl')!.classList.toggle('selected', this.coil === 'xl');
  }

  private setCoil(c: 'standard' | 'xl'): void {
    if (this.locked) return;
    this.coil = c;
    (document.getElementById('coil-btn') as HTMLButtonElement).textContent =
      c === 'xl' ? 'XL Deep 15″' : 'Standard 9″';
    this.markCoilCards();
    audio.play('ui_confirm');
    closeModal();
  }

  private async setCoilXl(): Promise<void> {
    if (this.locked) return;
    if (this.rally) {
      // no XL+Rally combo exists — inform and switch rally off
      const ok = await askConfirm({
        title: 'Coil Select',
        message: sw('Rally is available on the Standard coil only. Switching to the XL coil turns Rally off. Continue?'),
      });
      if (!ok) return;
      this.rally = false;
      (document.getElementById('rally-toggle') as HTMLInputElement).checked = false;
    }
    this.setCoil('xl');
  }

  private async onRallyToggle(el: HTMLInputElement): Promise<void> {
    if (this.locked) {
      el.checked = this.rally;
      return;
    }
    if (!el.checked) {
      this.rally = false;
      this.refresh();
      return;
    }
    // toggle-ON requires confirm with the new full cost
    el.checked = false;
    let msg = `Rally raises every spin's cost by 25% for double Hoard Chest frequency. New cost per spin: ${moneyBal(this.bet * 1.25)}. Confirm?`;
    if (this.coil === 'xl') {
      msg = `Rally runs on the Standard coil only — your coil will switch to Standard. ` + msg;
    }
    const ok = await askConfirm({ title: 'Rally', message: sw(msg) });
    if (!ok) return;
    if (this.coil === 'xl') this.setCoil('standard');
    this.rally = true;
    el.checked = true;
    this.refresh();
  }

  private openBuyMenu(): void {
    if (this.locked) return;
    document.querySelectorAll('.buy-card[data-buy]').forEach((c) => c.classList.remove('selected'));
    (document.getElementById('buy-accept') as HTMLButtonElement).disabled = true;
    this.refreshBuyModal();
    openModal('m-buy');
  }

  /** Sync the buy modal's play amount, per-tier costs, and +/- bounds. */
  private refreshBuyModal(): void {
    (document.getElementById('buy-bet-value') as HTMLElement).textContent = moneyBal(this.bet);
    document.querySelectorAll<HTMLElement>('[data-cost]').forEach((el) => {
      const mult = Number(el.dataset.cost);
      el.textContent = moneyBal(this.bet * mult);
    });
    (document.getElementById('buy-bet-down') as HTMLButtonElement).disabled = this.betIdx === 0;
    (document.getElementById('buy-bet-up') as HTMLButtonElement).disabled = this.betIdx === this.betLevels.length - 1;
  }

  private async onBuyAccept(): Promise<void> {
    const sel = document.querySelector<HTMLElement>('.buy-card.selected[data-buy]');
    if (!sel || this.locked) return;
    const mode = sel.dataset.buy as ModeId;
    const meta = MODES[mode];
    const cost = this.bet * meta.cost;
    closeModal();
    const messages: Record<string, string> = {
      feature_deepscan: `DEEP SCAN SWEEP — one guaranteed Deep Scan, dug to Toxic. Cost: ${moneyBal(cost)}. Max win 500x. Confirm?`,
      feature_bigdig: `THE BIG DIG — 10 fresh sweeps, depth & Signal carry. Cost: ${moneyBal(cost)}. Max win 15,000x. Confirm?`,
      feature_nightdig: `NIGHT DIG — Toxic start, double tags, no ooze for 3 sweeps. Cost: ${moneyBal(cost)}. Max win 15,000x. Confirm?`,
    };
    const ok = await askConfirm({
      title: sw('Get Bonus'),
      message: sw(messages[mode]),
      confirmLabel: sw('Get Bonus'),
    });
    if (!ok) return;
    if (this.locked) return; // state may have moved while the confirm was up
    if (this.balance < cost) {
      this.hud.flashMessage('Balance too low for this bonus.');
      return;
    }
    this.buyPending = true;
    this.refresh();
    const started = await this.spin(mode);
    if (!started) {
      // a swallowed start must never leave the purchase lock latched
      this.buyPending = false;
      this.hud.flashMessage('This bonus could not start. Nothing was charged.');
      this.refresh();
    }
  }
}
