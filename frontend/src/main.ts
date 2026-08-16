/**
 * Boot: parse launch URL → social/currency → bridge (FAIL CLOSED) → assets →
 * Pixi scene (board/Ron/FX) → controller → loader gate (audio unlock) →
 * resume check. Replay mode (?replay=true) is its own gated path with ZERO
 * session calls.
 */
import { Application, Container, Graphics } from 'pixi.js';
import { BoardView, loadBoardTextures, setSymbolFill } from './board';
import { Hud } from './hud';
import { Fx } from './fx';
import { Ron, RonPose } from './ron';
import { Presenter } from './presenter';
import { Controller } from './controller';
import { audio } from './audio';
import { timing } from './anim';
import { detectSocial, isSocial, setSocial, sweepDom, sw } from './social';
import { setCurrency, moneyBal, moneyWin } from './currency';
import { Book, MODES, ModeId } from './books';
import { eventsOf, fromMicros, getBridgeAlways } from './rgs';
import { wireModalCloseButtons, openModal } from './modals';

const qs = new URLSearchParams(location.search);

function setLoaderProgress(p: number): void {
  (document.getElementById('loader-fill') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
}

function defineAudio(): void {
  const sfx: Array<[string, number]> = [
    ['beep_1', 0.35], ['beep_2', 0.45], ['beep_3', 0.5], ['beep_4_scream', 0.4],
    ['flood_pop', 0.55], ['dig_thunk', 0.5], ['pipe_clunk', 0.6], ['geyser', 0.6],
    ['strata_crack', 0.55], ['bag_jingle', 0.55], ['survey_stamp', 0.6],
    ['win_1', 0.5], ['win_2', 0.55], ['win_3', 0.6], ['win_4', 0.65], ['win_5', 0.7],
    ['win_6', 0.7], ['win_7', 0.75], ['coin_loop', 0.5],
    ['ron_gasp', 0.6], ['ron_whoop', 0.65], ['ron_yelp', 0.6], ['ron_splutter', 0.6],
    ['ui_click', 0.4], ['ui_confirm', 0.5], ['retrigger', 0.65],
  ];
  for (const [n, v] of sfx) audio.defineSfx(n, `assets/sfx/${n}.mp3`, v);
  audio.defineMusic('day', 'assets/music/bgm_day.mp3');
  audio.defineMusic('georgian', 'assets/music/bgm_day_georgian.mp3');
  audio.defineMusic('hoard', 'assets/music/bgm_day_hoard.mp3');
  audio.defineMusic('night', 'assets/music/bgm_night.mp3');
  audio.defineMusic('celebration', 'assets/music/bgm_celebration.mp3');
}

/** Dev-only overlay: one button per mascot beat so animations can be triggered
 *  directly (?anim=1, or any vite dev run). Not shipped in a Stake launch. */
function mountAnimTester(ron: Ron): void {
  if (document.getElementById('anim-tester')) return;
  const poses: Array<[string, RonPose]> = [
    ['idle', 'idle'], ['sweep', 'sweep'], ['alert', 'alert'],
    ['thumbs · win', 'thumbs'], ['roar · big win', 'roar'],
    ['slump · dud', 'slump'], ['faint · jackpot', 'faint'],
    ['soaked', 'soaked'], ['slam', 'slam'],
  ];
  const panel = document.createElement('div');
  panel.id = 'anim-tester';
  panel.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:99999;display:flex;flex-wrap:wrap;gap:6px;max-width:46vw;' +
    'font:600 12px/1 Rubik,system-ui,sans-serif;background:rgba(12,20,18,.74);padding:8px;border-radius:10px;' +
    '-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,.15)';
  const mk = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'appearance:none;cursor:pointer;color:#eafff4;background:#1c6f5a;border:1px solid #2fae86;' +
      'padding:8px 10px;border-radius:8px;min-height:34px';
    b.addEventListener('click', (e) => { e.preventDefault(); ron.visible = true; fn(); });
    panel.appendChild(b);
  };
  for (const [label, pose] of poses) mk(label, () => ron.show(pose));
  mk('tremble', () => ron.tremble(700));
  document.body.appendChild(panel);
  (window as unknown as { __ron: Ron }).__ron = ron;
}

async function boot(): Promise<void> {
  // reduced motion
  timing.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- social + currency from launch URL (param wins over currency code) ---
  const currency = qs.get('currency') || 'USD';
  setCurrency(currency);

  const bridge = getBridgeAlways();
  const isReplay = (qs.get('replay') || '').toLowerCase() === 'true';

  // Fail closed: a Stake launch whose authenticate fails must block entry.
  let auth = null;
  if (bridge?.isStake && !isReplay) {
    try {
      setLoaderProgress(0.1);
      auth = await bridge.ready;
    } catch (e) {
      (document.getElementById('loader-note') as HTMLElement).textContent =
        'Failed to connect to the game server. Please relaunch the game.';
      (document.getElementById('loader-fill') as HTMLElement).style.background = '#d94f3d';
      setLoaderProgress(1);
      if (qs.get('debug') === '1') console.error('authenticate failed', e);
      return; // never drop into a playable game on failed auth
    }
  }

  const social = detectSocial(qs, auth?.balance?.currency ?? currency, auth?.config?.jurisdiction?.socialCasino);
  setSocial(social);
  if (auth?.balance?.currency) setCurrency(auth.balance.currency);
  if (social) {
    // coin-code display + balance label stays honest
    document.getElementById('balance-label')!.textContent = 'Balance';
  }

  setLoaderProgress(0.2);
  defineAudio();

  // --- Pixi scene ---
  const RES = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
  const app = new Application();
  await app.init({
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true,
    resolution: RES,
    autoDensity: true,
    preference: 'webgl',
    // The mascot has 9 full-res animation sheets (~400MB VRAM if all stay
    // resident) — that overran GPU memory on real phones and dropped the WebGL
    // context (board + mascot vanish, audio/logic keep running). Aggressive
    // texture-GC unloads a sheet ~8s after it stops rendering, so only the idle
    // sheet + the active reaction sit in VRAM (~120MB) at FULL resolution.
    textureGCActive: true,
    textureGCMaxIdle: 60 * 8,
    textureGCCheckCountMax: 60 * 2,
  });
  document.getElementById('game-container')!.appendChild(app.canvas);
  // Safety net: if the GPU still loses the context, recover gracefully (the RGS
  // resumes the round) instead of leaving a permanently blank canvas. One-shot
  // guarded so a persistent problem can't become a reload loop.
  app.canvas.addEventListener(
    'webglcontextlost',
    (e) => {
      e.preventDefault();
      if (sessionStorage.getItem('gd_ctx_reload')) return;
      sessionStorage.setItem('gd_ctx_reload', '1');
      setTimeout(() => location.reload(), 900);
    },
    false,
  );
  setTimeout(() => sessionStorage.removeItem('gd_ctx_reload'), 45000);
  setLoaderProgress(0.35);

  await Promise.all([
    loadBoardTextures(),
    document.fonts.load('16px Baloo2').catch(() => {}),
    document.fonts.load('16px Rubik').catch(() => {}),
  ]);
  setLoaderProgress(0.7);

  const boardWrap = new Container();
  const board = new BoardView();
  boardWrap.addChild(board);
  // clip drop-in/cascade tiles that overshoot ABOVE the board's top edge — they
  // briefly poked into the header on tall/wide phones when the board sits flush
  const boardMask = new Graphics();
  boardWrap.addChild(boardMask);
  boardWrap.mask = boardMask;
  const ron = new Ron();
  const fx = new Fx(app);
  app.stage.addChild(boardWrap, ron, fx.layer);
  await ron.load();
  setLoaderProgress(0.85);

  const hud = new Hud();
  hud.setDockFace('assets/ron/ron_dock.webp');
  const presenter = new Presenter(board, hud, fx, ron);
  const controller = new Controller(presenter, hud);

  // --- layout ---
  const relayout = () => {
    const rect = hud.boardRect();
    const pad = 6;
    const availW = rect.width - pad * 2;
    const availH = rect.height - pad * 2;
    // reserve a side column for full-figure Ron on wide viewports; in the popout
    // views Ron collapses to the topbar dock face and the board takes the middle.
    // `--popout` is owned by the popout media query in index.html — read it rather
    // than re-testing the breakpoint here, so the CSS layout and the board's
    // position can never disagree about which layout is on screen.
    const tiny =
      getComputedStyle(document.documentElement).getPropertyValue('--popout').trim() === '1';
    const wide = !tiny && window.innerWidth > window.innerHeight * 1.15;
    // backdrop orientation from the visual viewport (what the layout actually
    // sees) instead of a CSS aspect-ratio query, which iOS Safari mis-evaluated.
    // Pure w>h so the wide-but-short popout view still gets the landscape image.
    document.body.classList.toggle('landscape', window.innerWidth > window.innerHeight);
    const ronW = wide ? Math.min(220, window.innerWidth * 0.2) : 0;
    // landscape: center the board on the viewport axis (so spin button and
    // win math line up under it) whenever Ron still fits in the side margin
    const symmetric = wide && availW - 2 * ronW >= availH;
    // no fixed floors: the board always shrinks to FIT (popout-S rule)
    let size = Math.max(60, Math.min(symmetric ? availH : availW - ronW, availH));
    // desktop only: left edge the board may not cross (set in the `wide` branch)
    let leftGuard = 8;
    // Portrait: the board sits flush to the top and takes the full width; the
    // big mascot now stands BENEATH it, so no sky band is reserved above.
    if (wide) {
      // Desktop: much bigger board — bounded by viewport height, leaving the
      // right column for a big mascot. (User: ~2x bigger, reach near the top.)
      // reserve ~54px under the board for the centered announcement line.
      //
      // The board must ALSO clear the left UI column (logo top-left, Get Bonus +
      // bet bottom-left) — Stake requires nothing overlap the grid, and at 822px
      // the board ran under the logo. Measure the cluster live rather than
      // hard-coding, so a logo resize can't silently reintroduce the overlap.
      // Right bound: Ron is centred at boardRight + rhEst*0.18 + 30 with a
      // half-width of ~rhEst*0.31 (her shadow is 0.62*h) — cap the width so she
      // still lands fully on-screen instead of being pushed off the right edge.
      const rightOf = (id: string): number => {
        const e = document.getElementById(id);
        if (!e || getComputedStyle(e).display === 'none') return 0;
        const b = e.getBoundingClientRect();
        return b.width ? b.right : 0;
      };
      const leftOf = (id: string): number => {
        const e = document.getElementById(id);
        if (!e || getComputedStyle(e).display === 'none') return Infinity;
        const b = e.getBoundingClientRect();
        return b.width ? b.left : Infinity;
      };
      leftGuard = Math.max(8, rightOf('brand'), rightOf('bonus-btn'), rightOf('bet-box')) + 8;
      const rhEst = Math.min(window.innerHeight * 0.72, 720) * 0.9;
      const rightLimit = Math.min(
        // Ron stays fully on-screen
        window.innerWidth - 4 - 30 - rhEst * 0.49,
        // ...and the board clears the right-hand UI (spin, hamburger, meter) too
        Math.min(leftOf('spin-btn'), leftOf('menu-btn'), leftOf('meter-box')) - 8,
      );
      size = Math.max(
        60,
        Math.min(window.innerHeight - 24 - 54, rightLimit - leftGuard, availW - ronW),
      );
    }
    const gap = Math.max(3, Math.round(size * 0.016));
    const cell = Math.floor((size - 5 * gap) / 6);
    setSymbolFill(wide ? 0.74 : 0.82); // desktop symbols ~10% smaller (user request)
    board.layout(cell, gap);
    const bw = board.sizePx;
    // keep the top-clip mask matched to the board size (generous on the sides +
    // bottom so reveal pops and refills are never clipped)
    boardMask.clear().rect(-40, -4, bw + 80, bw + 400).fill(0xffffff);
    // #msg-line + #sweep-counter are re-anchored per layout; reset any inline
    // positioning first so desktop/landscape falls back to the flex flow + CSS
    const msgEl = document.getElementById('msg-line');
    const scEl = document.getElementById('sweep-counter');
    const ctlEl = document.getElementById('controls');
    const menuEl = document.getElementById('menu-btn');
    const clearOverlay = () => {
      // popout-S pins #controls to the board span and the hamburger to the
      // screen edge (below) — reset so other layouts fall back to the CSS
      if (ctlEl) {
        ctlEl.style.left = '';
        ctlEl.style.width = '';
      }
      if (menuEl) menuEl.style.left = '';
      if (msgEl) {
        msgEl.style.position = '';
        msgEl.style.top = '';
        msgEl.style.bottom = '';
        msgEl.style.left = '';
        msgEl.style.right = '';
        msgEl.style.width = '';
        msgEl.style.zIndex = '';
      }
      if (scEl) {
        scEl.style.top = '';
        scEl.style.left = '';
      }
    };
    if (wide) {
      clearOverlay();
      // Desktop: big board pushed a little left of centre and near the top;
      // big mascot tucked into the bottom-right corner. (User layout request.)
      // leftGuard keeps it off the logo / Get Bonus / bet cluster.
      const bx = Math.max(8, leftGuard, (window.innerWidth - bw) * 0.32);
      boardWrap.position.set(bx, 12);
      // announcement text centered UNDER the board (the board sits left-of-centre)
      if (msgEl) {
        msgEl.style.position = 'absolute';
        msgEl.style.left = Math.round(bx) + 'px';
        msgEl.style.right = 'auto';
        msgEl.style.width = Math.round(bw) + 'px';
        msgEl.style.top = Math.round(Math.min(12 + bw + 10, window.innerHeight - 44)) + 'px';
        msgEl.style.bottom = 'auto';
        msgEl.style.zIndex = '6';
      }
      if (scEl) scEl.style.left = Math.round(bx + bw / 2) + 'px';
      ron.visible = true;
      const rh = Math.min(window.innerHeight * 0.72, 720) * 0.9; // 10% smaller
      ron.setHeight(rh);
      // tucked bottom-right, nudged left so her shoulder overlaps the board's
      // right edge, then shifted +30px right / -30px up (user request).
      ron.position.set(boardWrap.x + bw + rh * 0.18 + 30, window.innerHeight - 4 - 30);
    } else if (tiny) {
      clearOverlay();
      // Popout: the board owns the middle band between the pinned side columns —
      // never overlapped by UI. The board is height-bound there, so Popout-L
      // (800×450) leaves real slack beside it: stand Ron in that gap instead of
      // dropping her. Popout-S (400×225) has none, so she collapses to the dock
      // face as the design doc prescribes.
      const by = rect.top + Math.max(0, (rect.height - bw) * 0.5);
      const slack = rect.width - bw;
      const RON_MIN = 110; // any narrower and she reads as a smudge, not a mascot
      if (slack >= RON_MIN) {
        boardWrap.position.set(rect.left, by);
        ron.visible = true;
        // cap at slack*1.5: her half-width is ~0.29×height, so this keeps her
        // silhouette from reaching back over the grid we just cleared
        ron.setHeight(Math.min(rect.height - 4, slack * 1.5));
        ron.position.set(rect.left + bw + slack / 2, rect.top + rect.height - 2);
      } else {
        boardWrap.position.set(rect.left + (rect.width - bw) / 2, by);
        ron.visible = false;
      }
      // Popout-S (round 4, user layout): the CSS puts the button row under the
      // board but can only span the middle band — centre it on the BOARD
      // instead, and hang the hamburger off the right edge of the screen.
      const popS =
        getComputedStyle(document.documentElement).getPropertyValue('--popout-s').trim() === '1';
      if (popS && ctlEl) {
        ctlEl.style.left = Math.round(boardWrap.x) + 'px';
        ctlEl.style.width = Math.round(bw) + 'px';
        if (menuEl) {
          const mw = menuEl.offsetWidth || 26;
          menuEl.style.left = Math.round(window.innerWidth - 4 - mw - boardWrap.x) + 'px';
        }
      }
    } else {
      // Portrait / mobile: board flush to the TOP and full-width; the big mascot
      // stands CENTERED BENEATH it, behind the bottom controls. (User request.)
      clearOverlay(); // reset any msg-line width / sweep-counter left left over from a wide layout
      boardWrap.position.set(rect.left + (rect.width - bw) / 2, rect.top + 4);
      const boardBottom = boardWrap.y + bw;
      // announcement text rides just under the board (moves up with the board)
      if (msgEl) {
        msgEl.style.position = 'absolute';
        msgEl.style.left = '0';
        msgEl.style.right = '0';
        msgEl.style.bottom = 'auto';
        msgEl.style.top = Math.round(boardBottom + 4) + 'px';
        msgEl.style.zIndex = '6';
      }
      if (scEl) scEl.style.top = Math.round(boardWrap.y + bw * 0.05) + 'px';
      // big mascot centered beneath the board: feet near the screen bottom
      // (behind the controls), head kept just BELOW the board bottom (small gap)
      // so it never covers the bottom symbol row (user request).
      ron.visible = true;
      const feetY = window.innerHeight - 2;
      const rh = Math.min(feetY - boardBottom - bw * 0.04, bw * 1.35);
      ron.setHeight(rh);
      ron.position.set(rect.left + rect.width / 2, feetY);
    }
  };
  const doRelayout = () => {
    app.resize();          // keep the Pixi renderer matched to the viewport
    relayout();
  };
  relayout();
  if (qs.get('anim') === '1') mountAnimTester(ron);
  // ambient idle motion — the board breathes; the top-payer wiggles
  const boardTick = () => {
    board.tick(performance.now() / 1000);
    requestAnimationFrame(boardTick);
  };
  requestAnimationFrame(boardTick);
  window.addEventListener('resize', doRelayout);
  window.visualViewport?.addEventListener('resize', doRelayout);
  window.addEventListener('orientationchange', () => setTimeout(doRelayout, 50));
  void document.fonts.ready.then(relayout);
  // Robust re-layout for embedded/preview contexts: Stake's preview device
  // presets (mobile S/M/L) and iframes can change the game's size WITHOUT
  // firing window 'resize' (e.g. container/CSS resize, late sizing). A
  // ResizeObserver re-detects orientation on any size change of the root.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => doRelayout()).observe(document.documentElement);
  }
  // catch a viewport that only gets its real size a beat after first paint
  [120, 400, 1000, 2000].forEach((t) => setTimeout(doRelayout, t));

  wireModalCloseButtons();
  sweepDom(document.body);

  // --- REPLAY MODE: its own gated path, zero session calls ---
  if (isReplay) {
    document.getElementById('controls')!.style.display = 'none';
    document.getElementById('footer')!.style.display = 'none';
    document.getElementById('replay-badge')!.style.display = 'block';
    setLoaderProgress(1);
    hideLoader(false);
    await runReplay(presenter, hud, board);
    return;
  }

  await controller.init();
  setLoaderProgress(1);

  // idle field greeting: a face-down field so the first frame reads as the game
  const teaser = (await import('./mock/bookgen')).generateBook('base_standard', 42, 'dead');
  const reveal = teaser.events[0] as unknown as { board: never; stratumMap: never };
  board.setField(reveal.board, reveal.stratumMap, false);

  // Preload symbol images for the DOM cards (trigger chests, bonus-summary top
  // find). Board symbols are Pixi textures; the cards use separate <img> tags,
  // so on a cold CDN a card can flash blank for a symbol that never hit the
  // board this round. Warming the browser cache here prevents that.
  for (const s of ['H1', 'H2', 'H3', 'H4', 'H5', 'L1', 'L2', 'L3', 'L4', 'SC']) {
    const im = new Image();
    im.src = `assets/symbols/${s}.webp`;
  }
  // dock-face avatar is a JS-set CSS background → warm its cache too
  new Image().src = 'assets/ron/ron_dock.webp';
  // Backgrounds are CSS background-images swapped by the .night/.landscape body
  // classes. Only day_p is visible at boot, so day_l/night_p/night_l download
  // lazily on first switch → a cream flash (the tan body colour) shows while
  // night_p loads at bonus start. Preload them so every switch is instant.
  for (const bg of ['day_l', 'night_p', 'night_l']) {
    new Image().src = `assets/bg/${bg}.webp`;
  }

  await hideLoader(true);
  // only offer the Watch-or-Skip resume once the loader is gone — a modal
  // behind the opaque loader would deadlock the boot
  await controller.maybeOfferResume();

  // DEMO: ?maxwin=1 replays the exact 15,000x max-win book (for testing).
  if (qs.get('maxwin') === '1') {
    const evs = await fetch('maxwin.json').then((r) => r.json());
    void presenter.present({ events: evs } as never, { bet: 1 });
  }
}

function hideLoader(withStart: boolean): Promise<void> {
  const loader = document.getElementById('loader')!;
  const startBtn = document.getElementById('loader-start') as HTMLButtonElement;
  const note = document.getElementById('loader-note')!;
  if (!withStart) {
    loader.style.display = 'none';
    return Promise.resolve();
  }
  note.style.display = 'none';
  startBtn.style.display = 'inline-flex';
  startBtn.textContent = sw('Press anywhere to continue…');
  loader.style.cursor = 'pointer';
  return new Promise((resolve) => {
    let done = false;
    const start = () => {
      if (done) return;
      done = true;
      loader.removeEventListener('click', start);
      window.removeEventListener('keydown', onKey);
      audio.unlock();
      audio.setMusic('day');
      loader.style.transition = 'opacity 400ms';
      loader.style.opacity = '0';
      setTimeout(() => {
        loader.style.display = 'none';
        resolve();
      }, 420);
    };
    const onKey = (e: KeyboardEvent) => {
      // "press anything to continue" — any key is a valid start gesture
      e.preventDefault();
      start();
    };
    // start the game on a tap/click ANYWHERE on the loader, or any key — all
    // are valid user gestures for unlocking audio
    loader.addEventListener('click', start);
    window.addEventListener('keydown', onKey);
  });
}

/** Replay-URL mode (mandatory): GET the event, Play gate, no betting UI. */
async function runReplay(presenter: Presenter, hud: Hud, board: BoardView): Promise<void> {
  const bridge = getBridgeAlways();
  const game = qs.get('game') || '';
  const version = qs.get('version') || '';
  const mode = qs.get('mode') || 'BASE';
  const eventId = qs.get('event') || '';
  const amountMicro = Number(qs.get('amount') || 0);
  const bet = amountMicro > 0 ? fromMicros(amountMicro) : 1;

  const body = document.getElementById('replay-body')!;
  try {
    let rep;
    if (bridge?.isStake || (bridge && qs.get('rgs_url'))) {
      rep = await bridge.fetchReplay(game, version, mode, eventId);
    } else {
      // local QA only: no RGS present — synthesize a replayable book
      const { generateBook } = await import('./mock/bookgen');
      const demoBook = generateBook('base_standard', Number(eventId) || 7, 'trigger');
      rep = {
        payoutMultiplier: demoBook.payoutMultiplier / 100,
        costMultiplier: 1,
        state: { events: demoBook.events as never },
      };
    }
    const events = eventsOf(rep as never);
    if (!events.length) throw new Error('empty replay state');
    const costMult = (rep as { costMultiplier?: number }).costMultiplier ?? 1;
    const realCost = bet * costMult;
    const pm = (rep as { payoutMultiplier?: number }).payoutMultiplier ?? 0;
    const isBuy = costMult > 1;
    // Stake.US replay wording is mandated verbatim in social; we use "Base Play"
    // in BOTH modes so the word "bet" never appears (Cost -> Feature Multiplier,
    // Payout -> Final Multiplier remain social-only).
    const social = isSocial();
    const lBet = 'Base Play';
    const lCost = social ? 'Feature Multiplier' : 'Cost Multiplier';
    const lPm = social ? 'Final Multiplier' : 'Payout Multiplier';
    const modeLabel = MODES[mode.toLowerCase() as ModeId]?.label ?? mode.replace(/_/g, ' ').toUpperCase();
    body.innerHTML = `
      <p style="font-family:Baloo2;font-weight:800;font-size:16px;">${sw(modeLabel)}</p>
      <p><span data-no-swap>${lBet}</span>: <b>${moneyBal(bet)}</b></p>
      ${isBuy ? `<p><span data-no-swap>${lCost}</span>: <b>${costMult}x</b> — ${sw('Real Cost')}: <b>${moneyBal(realCost)}</b></p>` : ''}
      <p><span data-no-swap>${lPm}</span>: <b>${pm}x</b> — ${sw('Win')}: <b>${moneyWin(pm * bet, bet)}</b></p>`;
    sweepDom(body);
    openModal('m-replay');

    const playBtn = document.getElementById('replay-play') as HTMLButtonElement;
    const play = async () => {
      playBtn.onclick = null;
      const { closeModal } = await import('./modals');
      closeModal(); // clean, unobstructed grid during playback
      hud.resetWin();
      presenter.resetTracking();
      const book: Book = {
        id: 0,
        payoutMultiplier: Math.round(pm * 100),
        events: events as unknown as Book['events'],
        criteria: 'small',
      };
      audio.unlock();
      audio.setMusic('day');
      await presenter.present(book, { bet });
      // re-show with the realized result + Play Again; keep outcome visible
      playBtn.textContent = sw('Play Again');
      openModal('m-replay');
      playBtn.onclick = () => void play();
    };
    playBtn.onclick = () => void play();
  } catch (e) {
    body.textContent = sw('This replay could not be loaded. Check the replay link and try again.');
    openModal('m-replay');
    (document.getElementById('replay-play') as HTMLButtonElement).style.display = 'none';
    if (qs.get('debug') === '1') console.error(e);
  }
  void board;
}

void boot();
