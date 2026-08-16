# GOLD DIGGA (was GOLD DIGGER / SWEEPER / hoardsweeper) — Session Handoff

## ⬆️ CURRENT STATE — 2026-07-30 — ROUND 4: ALL DONE, READY TO UPLOAD (frontend only)

**Round 4 arrived as reviewer screenshots in chat (no PDF): "game does not function
correctly in Popout S/L".** All fixed + verified 2026-07-30, `dist/` rebuilt, commit
`0f4824e`. MATH UNTOUCHED — frontend `dist/` re-upload only.

| # | Item | Root cause → fix |
|---|------|------------------|
| 1 | Popout-L: logo overlaps the board | `#brand` holds dock-face + logo side by side ≈131px in a 117px `--pcol` column → logo shoved right past the board's left edge. Popout block now stacks them (`#brand{flex-direction:column}`); logo max-width already keyed to `--pcol`. |
| 2 | Popout-S: logo missing | The ≤640px mobile block's `#brand{position:absolute; top:50%}` leaks into popout at ≤480px wide, parking the logo exactly BEHIND the meter. Popout block re-anchors it (`position:static; transform:none`). |
| 3 | Bet "+" cut off (all popout sizes) | The −/value/+ cluster was ~129px wide (generic `#bet-box > div` 10px side padding + 28px value min-width + 46px steppers) vs 117px column flush to the screen edge. Tightened plate/value/steppers + `#controls{right:8px}` (user: "buttons off to the left a bit"). Board-slot right inset grew to `--pcol + 10px` to match. |
| 4 | USER relayout, Popout-S (≤300px tall) | New `--popout-s` sub-block (CSS owns the breakpoint, JS reads the flag): buttons shrink into a row UNDER the board — `relayout()` centres the row on the board span and pins the hamburger at the screen's right edge — board yields a 50px bottom band (192²→161² at 400×225), and Ron stands in the freed right slack (the tiny branch's existing `slack ≥ 110` rule). |
| 5 | USER: Get Bonus at popout | `#bonus-btn` no longer `display:none` in popout — pinned bottom-right of the controls column (absolute within `#controls`), `img max-height:30px`. Popout-S re-hides it (no room; buy stays reachable via menu — verified). |

Verified: DOM-rect probe CLEAN at 400×225, 800×450, 480×270, 802×471 (reviewer's likely
dpr-1.6 real size), 844×390, 1400×900, 390×844 (desktop + portrait unchanged). Screenshots
confirm S/mid/L visuals. Interactions at S+L: bet ± steps, spin plays, hamburger opens,
Get Bonus opens the buy modal at L, buy reachable via menu at S.
NOTE: `clearOverlay()` in relayout() now ALSO resets `#controls` left/width + `#menu-btn`
left — popout-S sets these inline; removing the reset re-breaks desktop after a resize.

**Stake's preview-size picker confirmed by user screenshot (2026-07-30):** Desktop
1200×675, Laptop 1024×576, Popout S 400×225, Popout L 800×450, Mobile L 425×812,
M 375×667, S 320×568 — ALL SEVEN probed CLEAN on this build. Ready to upload
(frontend `dist/` only; math untouched since round 1).

**Cover/tile art (2026-07-30):** `../cover-art/` — new tile candidates (gpt_image_2 via
Higgsfield, `ron_idle.webp` likeness ref), loading-screen split into layers, transparent
cutouts (closeup-1, closeup-2, torso @4K). 10 tile mocks + contact sheet in
`~/Pictures/gold-digga-tile-mocks/` — **C1 (closeup-1 coil-at-camera) is the
recommended cover**; C6 runner-up. Traps: Higgsfield moderation nsfw-flags
`ui/loading.webp` on upload (never usable as a ref there); Higgsfield's bg-remover
leaves backlit hair semi-transparent — use Adobe's `image_remove_background`; Adobe MCP
has no super-resolution — upscale via Higgsfield 4k on a blue-key flatten, then re-apply
the original alpha lanczos-scaled.

## Previous state — 2026-07-28 — ROUND 3: ALL 3 DONE (frontend only)

**`Gold Digga Revisions 3.pdf` (3 items), all fixed + verified, `dist/` rebuilt. MATH
UNTOUCHED — only the frontend needs re-uploading.** Reviewer-reply text handed to the user.

| # | Item | Fix |
|---|------|-----|
| 1 | Final Win card extends beyond the frame at Popout-S | `#fc-inner` plaque width refactored to `--plaque-w` (the has-plaque art margins key off it, so ONE override rescales the whole composition). Popout block: `--plaque-w: min(230px, 36vh)` + compact fonts/gaps. Verified via getBoundingClientRect at 400×225 AND 800×450, summary + trigger variants: every child inside the frame. Also bounded the BIG WIN overlays by height (`min(…, 92vh)` plaque, 56vh news, vh-based tier/amount) — same defect class, banner variant measured clean at both sizes. |
| 2+3 | Signal Meter "increases with no multipliers visible" / "changed at Big Dig trigger without doubling" (Base, Event 89554) | **NOT A BUG — two real presentation/copy gaps.** (a) The meter is additive from x1 (`gamestate.py _roll_tags`: `meter += sum(tags)`), so the x2 tag in the reviewer's own screenshot → x1+2 = **x3**; "random hit doubles" is Deep Scan-ONLY. (b) Tags rolled on FRESH tiles (dig-deeper refills in base `_evaluate_and_dig`, and every Big Dig `sweepStart`) are in the book only as aggregate `updateSignalMeter {value,delta}` — NO tile positions — so the frontend used to bump the meter with nothing on the board. Fix: presenter defers the bump until the refill lands (`pendingMeter`, consumed in `updateGrid`; immediate after `sweepStart`) and presents it — sparks fly from the fresh tiles into the readout + `FRESH DIRT — SIGNAL +N!` flash. Info updated: additive rule spelled out ("x1 plus an x2 tag reads SIGNAL x3"), fresh-ground tags documented, doubling marked Deep Scan-only, Big Dig tab describes carry + per-sweep tags, win example shows "(x1 + an x3 tag)". Verified with book 89554 turbo replay: all 11 climbs flash, meter lands exactly on the book's values (3,5,8,21,24,67,77,82,90,148,216,226 peak). |

Round-3 traps: the loader ("Press anywhere to continue") needs ~8s under swiftshader before
its click dismisses — click it in a retry loop, THEN spin. `page.screenshot()` hangs
indefinitely in this env (canvas+swiftshader) — assert on DOM rects, not pixels.
Reviewer "Event ID: 89554" = book id 89554 (`/force?mode=base_standard&id=89554`), a
11.90x Big Dig trigger; its base x2 tag lands on tile 34 (the chip the reviewer red-boxed).

## Previous state — 2026-07-27 — ROUND 2: ALL 3 DONE (frontend only)

**`Gold Digga Revisions 2.pdf` (3 items), all fixed + verified, `dist/` rebuilt. MATH UNTOUCHED
this round — only the frontend needs re-uploading.** Commits: `961c298` (round 2),
`333db16` (Poseidon rounds 1–4 sweep: added `payout`/`payouts` to the social TABLE —
`\bpay\b` can't match "payout"; fixed mock `/bet/replay` to accept the bridge's 6-part URL,
it had always 404ed locally. Everything else already covered — replay card shows
multiplier + full-precision win upfront in both modes, English-only, bonus summary
includes the trigger-spin win, accumulated win shown during bonuses).

| # | Item | Fix |
|---|------|-----|
| 1 | Big Dig: reviewer landed 2 Chests, Info promised "+3 Free Spins", nothing granted (Event ID 1086) | **INFO COPY BUG, not a game bug.** The math rule (`gamestate.py:239`) is **3+ chests on the freshly-revealed sweep field = +3 sweeps, hard cap 22 total** — cascaded-in chests don't count. Verified against ALL 1,054,059 sweeps in the published books: 0 mismatches; book 1086's boards show exactly 2 SC per sweep → correctly no retrigger. Fixed `info.ts` (Play-tab Retrigger + Big Dig tab): "a fresh field revealing 3+ Loot Chests awards +3 sweeps (22 max)". Retrigger presentation re-verified with book 33 (flash `+3 SWEEPS!`, counter 10→22). |
| 2 | 56x signal: the x50 tag chip hidden behind Ron's hair | User rule: DO NOT move the mascot/hair. `board.ts` TileView gets `chipLeft` (set wherever a tile is assigned a slot — setField, slides, incoming): rightmost-column tiles hang the tag chip at the tile's **LEFT edge** (`-0.5*cell`; `-0.28` wasn't enough at desktop — hair reaches past the corner and react frames swing it further). Verified with book 1086 (the reviewer's exact round) at 800×450 AND 1400×900: X50 fully readable. Other columns unchanged (+0.28 top-right). |
| 3 | Game Info unreadable at Popout-S (only 1 line visible) | Popout media block (kept LAST) now compacts modals: `.modal` max-height `calc(100vh-8px)` + width `100vw-12px`, slim `.modal-head` (3px/13px), tabs 11px/2px-pad, body 13px/1.4. Result at 400×225: tab strip 47px (2 rows), **body 130px ≈ 7 lines** (was ~1). Buy + menu modals also verified FITS. Beware: `getBoundingClientRect` during the 340ms `modalIn` animation reads translateY(24)/scale(.97) — measure after ~1s or you'll see phantom clipping. |

Test-only: `tools/mock-rgs.py` `/force` now takes `&id=<bookId>` to pin an exact book
(ids are 0-based; line N of the jsonl = id N−1). Reviewer "Event ID 1086" replays as
`/force?mode=feature_bigdig&id=1086` → 9× Doll × SIGNAL x56 = 33.6x, the PDF's exact round.

## Previous state — 2026-07-15 — round 1: ALL 8 DONE + 3 pre-emptive

**Branch `golddigger-reskin` @ `7a88649`.** `tsc --noEmit` clean; `npm run build` green; all fixes
verified in-browser against the real books via the mock RGS. Math package committed separately in
the math-sdk repo @ `942ca41` (branch `sweeper-game`).

Session commits:
`91b9677` revisions round 1 (all 8) · `c19f464` desktop board clears the UI · `4cb1c25` logo
shrink so the board keeps 822px · `927549f` teal text + mascot pops at night + pips under the
meter · `6faf45f` the text-fill/stroke fix · `7a88649` info examples + buttons depicted + mobile
font.

### ⚠️ PROJECT MOVED — every path in the old handoff was stale
`~/Desktop/sweeper/` → **`~/Desktop/gold digger/`**. Fixed `tools/mock-rgs.py` (its `--books`
default still pointed at the old path). The art masters at `~/Desktop/golddigger-art/`
**NO LONGER EXIST** — `public/assets/ui/logo.webp` is now the only logo source.

---

## 📤 THE TWO UPLOAD DIRECTORIES (Stake Engine ACP takes RAW files — NO zip)

**1. FRONTEND** — upload as a NEW FRONTEND VERSION:
```
/home/x/Desktop/gold digger/hoardsweeper/dist/
```
Contains `index.html` + `assets/` + `stake-engine-bridge.js` + `maxwin.json`.
Rebuild with `npm run build` from `/home/x/Desktop/gold digger/hoardsweeper/`.

**2. MATH** — game_id `sweeper`:
```
/home/x/Desktop/gold digger/math-sdk/games/sweeper/library/publish_files/
```
6× `books_<mode>.jsonl.zst` + 6× `lookUpTable_<mode>_0.csv` + `index.json`.

### 🔴 THIS TIME THE MATH **MUST** BE RE-UPLOADED TOO
Previous rounds left the math untouched. Round 1 renamed the modes, so **both directories must be
published together**. If the book mode names and the frontend's `books.ts` MODES keys drift apart,
`presenter.ts` (`MODES[mode0]`) silently falls back to `base_standard` and **Deep Scan would
advertise a 15,000× cap instead of its 500× ceiling** — an approval violation in itself.

**Modes (renamed this round):** `base_standard` (1×), `base_xl` (1×), `base_rally` (1.25×),
`feature_deepscan` (5×, **500× ceiling**), `feature_bigdig` (80×), `feature_nightdig` (400×).
RTP 96.65% on all six. Max win 15,000× (except Deep Scan: 500×).
Original pre-rename package backed up to `<scratchpad>/publish_files.BAK`.

---

## Stake revisions round 1 — all 8 fixed (`gold digger revisions 1.pdf`)

| # | Item | Fix |
|---|------|-----|
| 1 | Name "Gold Digger" already in use | → **GOLD DIGGA**. `<title>`, `#brand-logo` alt, `#dock-face` aria-label, `info.ts` copy + a NEW `ui/logo.webp`. (`<title>`/alt had still said "Sweeper" — never updated in the reskin.) |
| 2 | Active round must restore its bet level | `controller.init()` always used `resolveDefaultBet` and never read `a.round`. Now uses `a.round.amount` when `active===true`, snapping to the nearest level; default only when no active round. |
| 3 | Deep Scan showed the Big Dig card ("10 sweeps") | **Root cause is in the MATH DATA:** every deepscan book emits a `freeSpinTrigger` byte-identical to Big Dig's (`totalSweeps:10, bonusMode:"bigdig"`) then runs `sweepStart sweep:1 of 1`. Fixed frontend-side: `bonusTriggerCard(totalSweeps, kind)` takes `'bigdig'\|'nightdig'\|'deepscan'`; presenter picks `kind` from the book's mode, never the event's lying fields. |
| 4 | 4-decimal precision | TWO bugs. Replay window used `moneyBal` (never widens) → now `moneyWin`. And `moneyWin` itself only prevented "0.00" — it still rounded 0.009→0.01. Rewritten: render `toFixed(4)`, trim padding back to the currency's decimals. |
| 5 | Info missing Loot Chest / Toxic Ooze images | Added `img.pay-sym` SC.webp / PP.webp to those two sections in `info.ts`. |
| 6 | Popout S/L: UI covers the grid | See below — the biggest one. |
| 7 | Autoplay only stoppable between spins | `refresh()` did `setSpinEnabled(state==='idle' && !autoPending)`, so the spin button (whose handler already stops autoplay) was DEAD mid-round. Now `setSpinEnabled(autoplaying \|\| (idle && !autoPending))`. Safe: `spin()` returns early unless idle. |
| 8 | Mode names must drop "buy" | Renamed to `feature_*`. See below. |

### Item 6 — popout layout (Popout-S 400×225, Popout-L 800×450)
Cause: `main.ts relayout()`'s `wide` branch sizes the board off the FULL viewport height and
ignores the in-flow DOM HUD rows. **Not popout-specific — it's worst on desktop.**
- Extended the side-column popout CSS to ALL short landscape: `(max-height:500px) and (orientation:landscape)`.
- Columns/widgets now scale: `--pcol: clamp(96px, 26vh, 150px)`.
- `#board-slot` reserves a bottom band so `#msg-line` sits under the grid, not across it.
- Ron now stands in the leftover slack at Popout-L (`slack >= 110`) instead of always collapsing to the dock face.
- **Fixed a latent CSS/JS split:** the CSS pinned side columns from 300px tall while JS `tiny` was
  `innerHeight<=260`, so 480×270 got side-column CSS with desktop board math. The CSS is now the
  single source of truth — `:root{--popout:0/1}` and `relayout()` READS it. **Never re-test that
  breakpoint in JS.**

Result: every popout size clean AND the board grew (L 372²→414², 480×270 176²→238²); Popout-S
unchanged at 192²; mobile portrait untouched; landscape phones (844×390) fixed too.

**CSS specificity traps (both bit me):** `.step-btn.img-btn` (2 classes) pins the bet ± to 46px and
outranks any `.step-btn` rule — at 46px the −/value/+ overflows the column and the `+` is clipped
off the right edge. `#brand img#brand-logo` likewise outranks `#brand img`. **Keep the popout media
block LAST in the sheet** — several rules win only on source order.

### Item 8 — mode rename (`tools/rename-modes.py`)
Stake's Provably Fairness dropdown is **their** UI reading our `index.json` — not frontend-fixable.
It is a **RENAME ONLY: no re-simulation, no RTP/payout change.** "buy" lived in exactly 2 places:
`index.json` and ONE string per book (`events[0].mode`).
```
python3 tools/rename-modes.py                # apply
python3 tools/rename-modes.py --verify-only  # audit a package
```
Verified all 6 modes vs the backup: LUTs byte-identical, every payoutMultiplier + event count
unchanged, only-mode-changed across 450k books, RTP 96.65% everywhere.

---

## DESKTOP GRID OVERLAP — FIXED (2026-07-15, after the revisions)
Pre-existing, not in the PDF, but the same defect class and it broke the design doc's own
"nothing over the grid" gate: at 1400×900 the logo sat on the top-left grid tile (15,346px²) plus
smaller Get Bonus / bet-box overlaps.

`relayout()`'s `wide` branch now measures the UI live and bounds the board by it:
- `leftGuard` = right edge of `#brand` / `#bonus-btn` / `#bet-box` + 8 → the board starts right of it.
- `rightLimit` = min(Ron stays fully on-screen, left edge of `#spin-btn`/`#menu-btn`/`#meter-box` − 8).
- `size` is then clamped to `rightLimit - leftGuard`, so it fits between the two clusters.

Measured, not hard-coded — a logo resize can't silently reintroduce the overlap.
Cost: 1400×900 board 822²→**762²** (7% smaller) and moved x 185→296. 1920×1080 UNCHANGED at 1002².
Ron's placement formula is unchanged and she keeps the same shoulder-over-board-edge relationship
(the rightLimit exists precisely so pushing the board right doesn't shove her off-screen).
**Every viewport now verified clean: popout S/L, mobile portrait, landscape phone, 1400, 1920.**

## PRE-EMPTIVE FIXES from the Poseidon reviews (2026-07-15)
Stake's reviewers ask the same things across games. Swept `~/Desktop/poseidon/poseidon
stake-engine revisions round 1.pdf` (10 items) + `round 2.pdf` (8 items) against this game.
**Most were already covered**; 3 real gaps found and fixed:
- **Info: a WINNING and a LOSING combination example** — new `Examples` tab (1 win, 3 no-win:
  under 8 of a symbol / Toxic Ooze strike / quiet signal). Pay figure computed from `PAYTABLE`
  so it cannot drift from the math.
- **Unlabelled buttons DEPICTED in the controls section** — every control here is unlabelled art;
  the Controls page now shows each button image beside its description. (`.ctl-table` must undo
  the generic paytable rules, which right-align and nowrap every non-first cell.)
- **Info text too small on mobile** — smallest rendered font was 11px at 390px wide, now 13px.

Already covered, verified: spacebar blocked while a modal is open; modals fit+scroll at Popout-S;
bet only steps between valid levels; low balance leaves spin clickable + flashes a message; no
"500.00k" formatting; replay shows the win multiplier; replay social wording; no Max Bet button;
currency already prefers `auth.balance.currency` (main.ts:106).
**Full recurring checklist: memory `stake-review-patterns.md` — run it before ANY submission.**

## STILL OPEN
- Optional: confirm the identical 96.65% RTP across feature modes with the math team (flagged in an
  earlier review; not a code bug — the LUTs do compute to exactly 96.65% for all six).
- Store/marketing art: user confirmed 2026-07-15 they ALREADY HAVE Gold Digga art. `store/` in this
  repo is empty — that's fine, don't regenerate.
- Never visually confirmed in-session (user checked on the live host instead): the BIG WIN /
  MEGA / EPIC overlay text, and the mascot's brightness at night after the Pixi-filter change.

## Upload / approval flow (user does this on stake-engine.com)
1. ACP → `sweeper` game → upload a NEW FRONTEND VERSION from the raw `dist/` files (no zip).
2. **Re-publish the math** from `publish_files/` — REQUIRED this round (modes renamed).
3. Submit for approval. Game is stateless, no jackpot/gamble/cashout.
- **Blurb:** "GOLD DIGGA — a mint-haired punk gremlin sweeps a toxic chemical-waste yard for buried
  gold. Sweep a 6×6 field, match 8+ symbols to win, and dig deeper through Topsoil → Toxic →
  Motherlode while a Signal Meter multiplies every find. Three bonus digs (Deep Scan, The Big Dig,
  Night Dig). Max win 15,000×."

---

## Naming constraint — READ `src/social.ts` TABLE (~line 43) BEFORE NAMING ANYTHING
It is Stake's official restricted→replacement list and it is why the obvious slot puns are unusable:
`pay`, `cash`, `money`, `bet`, `stake`, `buy`, `gamble`, `credit`, `wager`, `cost`, `deposit`,
`purchase` are all swapped in social mode ("Pay Dirt" → "Win Dirt"). `gold`, `dirt`, `rich`,
`toxic`, `loot`, `dig`, `sweep`, `feature`, `bonus` are clean.

## Run it locally
```
python3 tools/mock-rgs.py --port 8787          # serves the REAL books
npm run dev                                     # vite, binds 0.0.0.0:5173
```
`http://<ip>:5173/?rgs_url=http://<ip>:8787&sessionID=dev&currency=USD`
- Force an outcome: `/force?mode=feature_nightdig&min=15000` — **`min` defaults to 15000**, so
  omitting it 404s for any mode with a lower ceiling (deepscan caps at 500×).
- Force an interrupted round: `/force-round?amount=20&mode=feature_deepscan` (`?clear=1` resets) —
  makes `/wallet/authenticate` return an active round (test-only, exercises item 2).
- Assets reuse filenames → **hard-refresh** (Ctrl/Cmd-Shift-R).
- **NEVER `pkill -f mock-rgs.py`** — the pattern matches the issuing shell and kills it (exit 144).

## Playwright QA traps (cost several runs each)
- Never pipe node stdout to `head`/`tail` — a pipe makes it block-buffered, so a killed hung script
  prints NOTHING. Redirect to a file.
- `waitUntil:'networkidle'` never settles (the game polls). Use `'domcontentloaded'`.
- Default click timeout is 30s and stacks — pass an explicit short `{timeout:4000}`.
- `#open-buy`, `#open-info`, `#auto-btn`, `#turbo-btn`, `#coil-btn`, `#rally-toggle` all live INSIDE
  the `#m-menu` hamburger — click `#menu-btn` first or they're 0×0.
- Buy cards have **no `data-mode`/id** — select by text (`/deep scan/i`).
- `.click()` times out on `#buy-accept`/`#bonus-btn` even when enabled — use `page.evaluate(() => el.click())`.
- Modals sit at `opacity:0` in headless swiftshader — an ENV artifact, not a bug. Assert on the DOM,
  don't trust modal screenshots.
- Buy flow: `#menu-btn` → `#open-buy` → click card by text → `#buy-accept` → `#confirm-ok` → poll
  `#feature-card.open` → read `#fc-title`/`#fc-sub`.

## Higgsfield
Account THIS session: `user_3GSrMorIlReozlboc3wMdoVynIZ` (~2 credits left). **Accounts change often
and reference media_ids are PER-ACCOUNT — old ids are dead.** Recurring trap: the user tops up a
login that ISN'T the one the MCP bills → balance reads 0 mid-build.
- Costs: `gpt_image_2` (low/1k) **0.5cr**, `flux_kontext` 1.5cr, `openai_hazel` 2cr.
- **Logo regen recipe (GOLD DIGGA):** composite `ui/logo.webp` on flat chroma green `#00ff00`
  (the logo has ZERO pure-green pixels → clean key), upload, `gpt_image_2` low/1k 16:9 with the ref.
  **CRITICAL:** the logo's star glints are semi-transparent white (alpha down to 1) — compositing
  them straight onto green turns them GREEN and the key then DELETES them. Harden them to opaque
  white first (`alpha*3+90`, force RGB 255) or the glints get cut out.
  Key back out with cv2 `connectedComponents` (border-touching = bg), then clamp
  `G = min(G, max(R,B)+12)` to kill green fringe (safe: the teal shadow and gold survive).
  gpt_image_2 at `low` is unreliable on text — it produced "DIGG**G**A"; prompt the letter count
  explicitly and generate `count:2`. flux_kontext got the spelling right first try.

Auto-memory: `/home/x/.claude/projects/-home-x-Desktop-gold-digger/memory/` (MEMORY.md index).
