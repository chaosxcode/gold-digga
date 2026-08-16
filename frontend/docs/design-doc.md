# SWEEPER — Final Build Design Document
**Version:** 1.0 (build spec — frozen feature set, first-submission complete)
**Tagline:** 15,000x MAX WIN — DIG UP THE KING'S RANSOM
**RTP:** 96.65% in all six modes (display each mode to the LUT's exact decimals)
**Chassis:** scatter-pays tumble book (reveal → winInfo → updateGrid) wearing a Minesweeper flood-fill presentation pass. If the presentation pass ever fails a gate, the fallback is shipping the same book as a straight tumble reveal.
**Statelessness:** depth pills, Signal Meter, and finds pouch reset every round. Persistence lives only inside the single Big Dig book (one `/wallet/play`). Nothing survives past `/wallet/end-round`.

---

## 1. Game Identity

- **Hook:** The reels are buried. Big Ron sweeps his detector over a face-down 6×6 field; every screaming signal flood-opens a patch of finds Minesweeper-style, and each bagged win digs the whole board a stratum deeper — until he CLUNKS the old water main.
- **Native verb:** SWEEP. Reveal pass = detector sweep; anticipation = graded beeps; burst reveal = signal flood; cascade-refill = digging deeper through strata; stop event = the buried water main (a stop event, not a wager).
- **Theme guardrails (documented design-diff vs the BBC touchstone):** Ron is a SOLO rogue detectorist — no club, no sidekick, no flat cap, no beard. He chases King John's crown jewels lost in the Wash (1216) — a legend the show never touched. All vocals wordless. Ordnance humor removed: the stop tile is a water main, never a shell. Nothing child-appealing.
- **Franchise spine:** "Big Ron's…" (future: Beach Sweep, Bog Dig).

---

## 2. Mode Surface — EXACTLY 6 Certified Lookup Tables

| # | Mode id | Entry | Cost | Config | Max win (advertise THIS number) |
|---|---------|-------|------|--------|--------------------------------|
| 1 | `base_standard` | Coil Select: Standard 9" | 1x bet | Frequent shallow floods, lower variance | 15,000x |
| 2 | `base_xl` | Coil Select: XL 15" | 1x bet | Rarer, deeper digs; RTP weighted into Georgian/Hoard strata | 15,000x |
| 3 | `base_rally` | Rally ante toggle ON (Standard coil ONLY) | 1.25x bet | 2x Hoard Chest frequency. **No XL+Rally combo book exists** — toggling Rally while XL is selected force-switches coil to Standard with an inline notice | 15,000x |
| 4 | `buy_deepscan` | Buy menu tier 1 | 5x bet | One sweep, guaranteed Deep Scan + guaranteed dig to Georgian | **500x — its own ceiling on the buy card, confirm dialog, and info tab. Never show 15,000x anywhere near this mode.** |
| 5 | `buy_bigdig` | Buy menu tier 2 | 80x bet | The Big Dig: 10-sweep persistent-field bonus | 15,000x |
| 6 | `buy_nightdig` | Buy menu tier 3 | 400x bet | Big Dig starting at Georgian stratum; pipe cannot strike during sweeps 1–3; all Hot Signal tag values doubled | 15,000x |

Rules:
- Buys are **coil-independent fixed configs** — they never inherit Coil Select. Stated explicitly on the buy menu and info tab.
- Every paid mode (all three buys AND the Rally ante toggle-ON) fires an explicit confirm dialog showing the full cost in the player's currency.
- All player agency is pre-commit: bet level, coil, ante, buy. **Zero mid-round decisions. No `/bet/action` calls ever.**
- Autoplay lockout: bet-adjust, coil, ante, and buys are locked during autoplay including inter-spin gaps and the buy→trigger pending window.

---

## 3. Grid, Symbols & Paytable

### 3.1 Grid
- **6×6 buried-tile field** (36 soil plugs). Tile indices **0–35, row-major, row 0 at top, column 0 at left**.
- Scatter-pays: **8+ matching symbols anywhere among REVEALED tiles** pays. Evaluation happens **only at flood boundaries** (SURVEY beat), never mid-flood.
- Three strata (tile-backs): **0 = Topsoil** (light loam, grass tufts), **1 = Georgian** (brick-flecked clay), **2 = King's Hoard** (dark-gold peat with glinting flecks). Deeper strata carry richer symbol weights and denser Hot Signal tags.

### 3.2 Symbol set

| id | Name | Class | 25px read | Pays 8–9 | Pays 10–11 | Pays 12+ |
|----|------|-------|-----------|---------:|-----------:|---------:|
| `H1` | The King's Crown | High 1 | gold crown, ruby cluster | 10.0x | 25.0x | 50.0x |
| `H2` | Silver Chalice | High 2 | tall silver cup silhouette | 4.0x | 10.0x | 25.0x |
| `H3` | Jewelled Ring | High 3 | fat gold band, blue gem | 2.5x | 6.0x | 15.0x |
| `H4` | Golden Buckle | High 4 | square gold buckle | 1.5x | 4.0x | 10.0x |
| `H5` | Hammered Silver Penny | High 5 | rough round coin, cross stamp | 1.0x | 2.5x | 7.5x |
| `L1` | Horseshoe | Low 1 | rusty U-shape | 0.8x | 1.8x | 5.0x |
| `L2` | Rusty Spoon | Low 2 | long diagonal spoon | 0.6x | 1.5x | 4.0x |
| `L3` | Bottle Cap | Low 3 | red crimped cap | 0.5x | 1.2x | 3.0x |
| `L4` | Ring Pull | Low 4 | silver can ring pull | 0.4x | 1.0x | 2.5x |
| `SC` | Hoard Chest | Scatter | banded chest, gold seam | 3 = trigger + 2.0x · 4 = trigger + 5.0x · 5+ = trigger + 10.0x | | |
| `PP` | The Pipe | Stop tile | green-patina pipe elbow | pays nothing — ends the sweep | | |

All book amounts are **hundredths of bet** (e.g. crown 12+ = `5000`). Wire amounts are integer millionths. Never mix the two.

Junk-forward comedy is the symbol identity: the four lows are color-and-silhouette-coded junk (silver ring pull, red bottle cap, long diagonal rusty spoon, U-shaped horseshoe). The money shot is ONE crown, not piles of coins.

### 3.3 Hot Signal tags (the modifier)

Tags surface ON tiles as they are revealed and **SUM** into the Signal Meter on Ron's handheld readout in the top HUD.

| Band | Chip art | Values |
|------|----------|--------|
| Band 1 (bronze-green chip) | verdigris bronze | x2, x3, x4, x5 |
| Band 2 (silver-blue chip) | polished silver | x6, x8, x10, x15, x20 |
| Band 3 (red-gold chip) | glowing red-gold | x25, x50, x100 |

**Meter rule:** meter starts each spin at **x1**. When tags exist, meter = sum of all surfaced tag values this spin (a lone x3 tag makes the meter x3, not x4). Every evaluation multiplies its total through the current meter. Meter persists across strata within the spin; inside the Big Dig it persists across all sweeps; it dies with the round.
**Deep Scan:** a random book event — Ron slams his coil and the meter itself visibly flips to **double** before the next evaluation. One readable beat, not per-tile bookkeeping.
**Equation line (mandatory on every win):** `12× Chalice 25.0x  ×  SIGNAL x27  =  675.0x` — printed under the meter so any spot-checked amount is verifiable by eye. Night Dig doubles the tag VALUES at reveal time (a x25 chip surfaces as x50) — the meter math is unchanged.

---

## 4. Feature Flows — Step by Step

### 4.1 Base spin lifecycle (one spin = one automatic dig, multiple evaluations)

1. **Commit.** Player presses the coil SPIN button (spacebar too, unless jurisdiction-disabled). Frontend POSTs `/wallet/play` with mode = the active LUT (`base_standard` / `base_xl` / `base_rally`). Bet debited. Book returned.
2. **Seed.** `reveal` event: the full 6×6 board layout exists in the book but renders **face-down** (36 soil plugs, Topsoil backs). Depth pill 1 (Topsoil) lights. Signal Meter shows x1. Finds pouch empty.
3. **Sweep playback.** The book's reveal order plays as `sweepSegment` events. Ron's coil position traces the segment's tiles:
   - `kind:"flip"` — single tile flips (one low blip, beep step 1). ~90ms.
   - `kind:"flood"` — a Signal Flood: 4–9 **book-listed adjacent tiles** pop open in one chainable burst (explicit tile-index lists → deterministic, replay-safe). Preceded by its `beepStep` (2 or 3) pre-roll. 260–420ms.
   - Tags revealed inside a segment tick the Signal Meter up live (`updateSignalMeter`).
   - Per-symbol progress pips update live (e.g. "6/8" on the leading symbol) so the 8+ rule teaches itself on-screen.
   - **Spectacle floor:** the generator guarantees ≥6 reveals per spin — no spin is a two-flip nothing. The pipe never strikes before 6 reveals (zero RTP cost).
4. **Evaluate (flood boundaries only).** Where the book places a `winInfo`: SURVEY stamp beat (350ms thunk) → each 8+ symbol group highlights, its equation line prints, its amount floats **at its own tiles** (every simultaneous win floats its own amount), finds fly to Ron's pouch (bag jingle). `setWin` fires per evaluation with its winLevel.
5. **Dig Deeper (`updateGrid` analog).** Each bagged 8+ win opens the holes into the next stratum: winning tiles clear, remaining buried tiles slide down, fresh **face-down** tiles slide in **one stratum deeper** (Topsoil → Georgian → King's Hoard) with richer weights and denser tags. Strata-crack SFX; the corresponding depth pill lights. King's Hoard is the floor — digs at stratum 2 refill at stratum 2.
6. **Deep Scan (optional, random).** `deepScan` event may occur before any evaluation: Ron slams the coil, the meter flips visibly to double (x27 → x54) in one beat, drum hit.
7. **Stop.** The spin ends when:
   - the predetermined **Pipe** tile is struck (`pipeStrike`): topsoil-depth strikes get a 0.3s micro-CLUNK + one-frame Ron shrug; strikes after the spin already reached Georgian or deeper earn the 1.8s geyser gag (rotating pool of 3 splash variants, ~1 spin in 8). Turbo skips gags entirely; **or**
   - signals go quiet (no more segments in the book) — a soft 0.4s fade-out, Ron lowers the coil.
8. **Settle.** `setTotalWin` (round meter ticks UP through each win, never jumps) → `finalWin` = exact `(payoutMultiplier/100) × bet`. `/wallet/end-round` only if payout > 0 (RGS auto-closes zero-payout rounds).

Average 2–3 evaluations per winning spin. Base hit rate ~1-in-3.6. The tail is reaching the King's Hoard layer.

### 4.2 SIGNAL FLOOD
Strong-signal tiles flood-open 4–9 adjacent tiles in one chainable burst. Flood groups are **explicit tile-index lists in the book** — pure presentation of the underlying tumble book's reveal. Chain rule: a flood segment may be immediately followed by another flood segment (chained burst); evaluation still waits for the flood **boundary** (the last segment before a `winInfo`).

### 4.3 Graded beep grammar (anticipation is honest)
| Beep step | Sound | Reserved for |
|-----------|-------|--------------|
| 1 | single low blip | every ordinary flip |
| 2 | two rising beeps | imminent flood (this segment or next) |
| 3 | urgent triple beep | imminent large flood / chest reveal |
| 4 | continuous scream | ONLY books that reach the King's Hoard stratum or trigger the bonus |

Never fire step 2–3 on a segment that doesn't lead to a flood; never fire step 4 outside Hoard-stratum/trigger books. This is a hard content rule for the fixture generator.

### 4.4 THE PIPE
Predetermined stop event encoded in the book (`pipeStrike`), exactly like "no more tumbles." Never before 6 reveals. Presentation scales with story: micro-CLUNK (0.3s) for shallow strikes; the geyser gag (1.8s, 3 variants rotating) only when the spin already dug to Georgian or deeper. It is a stop event, not a wager — no player interaction, ever.

### 4.5 THE BIG DIG (bonus — 3+ Hoard Chests or 80x buy)
1. Trigger: `freeSpinTrigger` event (3+ `SC` revealed in the base spin, or the buy). Chest scatter pay applies (2x/5x/10x). Full-screen trigger takeover: Ron headphone-pop + whoop, chest tiles burst.
2. **One round, one book, one `/wallet/play`: 10 sweeps over ONE persistent field.** The field state, depth (strata), and Signal Meter carry across all sweeps — nothing resets between sweeps.
3. Each sweep: `sweepStart` (sweep counter updates: "SWEEP 4 OF 10") → sweep segments → evaluations → dig-deeper refills, exactly as base. The pipe CAN strike inside a sweep — it ends that sweep only, not the bonus.
4. **Retrigger:** 2 further chests revealed in any sweep award **+3 sweeps** (`retrigger` event), inside the same round/book. Spelled out on the info tab.
5. **Pays once at the end:** `setTotalWin` ticks the round-cumulative meter per sweep; `finalWin` lands the exact total after the last sweep. One `/wallet/end-round`.
6. **Long-book housekeeping (pre-committed):** POST `/bet/event` with the current event index at every sweep boundary so resume can fast-forward. On reconnect with `round.active === true`, show the **Watch or Skip to Result** dialog with a sweep counter ("You were on sweep 6 of 13"). Never silent-settle.

### 4.6 NIGHT DIG (400x buy)
A Big Dig book with three config differences: (a) the field starts at the **Georgian** stratum (depth pill 2 pre-lit, night background + night music loop); (b) the pipe cannot strike during sweeps 1–3; (c) all Hot Signal tag values are **doubled at reveal**. The 15,000x hunting ground. Social mode renders every buy tier's button as "Get Bonus".

### 4.7 DEEP SCAN SWEEP (5x buy)
One base-format sweep book with a **guaranteed `deepScan` event** and a **guaranteed dig to the Georgian stratum**. Max win **500x**, advertised as its own ceiling on the buy card, its confirm dialog, and the info tab — never adjacent to the 15,000x headline.

### 4.8 Rally ante
Toggle in the bet panel, Standard coil only. +25% bet cost, 2x Hoard Chest frequency (`base_rally` LUT). Confirm dialog fires **on toggle-ON** showing the new full spin cost. Toggle state is visually loud (poppy-red painted flag on the wooden sign).

---

## 5. Book-Event Vocabulary (the math/frontend contract)

One JSON book per round: `{ id, payoutMultiplier (×100), events[], criteria }`. Every event carries `{ index, type, ... }`. Amounts in events are hundredths-of-bet. The frontend must handle every type below; the mock generator must emit nothing else.

### 5.1 Shared / base events

| type | Fields | Meaning |
|------|--------|---------|
| `reveal` | `board: string[36]` (symbol ids, row-major, face-down at render), `stratumMap: int[36]` (0/1/2 back per tile), `pipeTile: int \| null`, `chestTiles: int[]`, `mode: string` | Seed the face-down field. Board is the full final truth for this stratum state. |
| `sweepSegment` | `tiles: int[]` (1 tile = flip, 4–9 = flood), `kind: "flip" \| "flood"`, `beepStep: 1\|2\|3\|4`, `tags: [{tile:int, value:int, band:1\|2\|3}]`, `coilPath: int[]` (tile order the coil visually traces) | One sweep burst. Tags listed here surface as their tiles open. |
| `updateSignalMeter` | `value: int` (new meter total), `delta: int`, `source: "tags" \| "deepScan"` | Meter tick. Emitted after any segment that surfaced tags, and by Deep Scan. |
| `deepScan` | `meterBefore: int`, `meterAfter: int` | Ron slams the coil; meter flips to double in one beat. Always precedes the next `winInfo`. |
| `winInfo` | `wins: [{symbol: string, count: int, tiles: int[], basePay: int, meter: int, amount: int, equation: string}]`, `totalWin: int` | Evaluation at a flood boundary (SURVEY beat). `amount = basePay × meter`. `equation` is the display string, e.g. `"12× Chalice 25.0x × SIGNAL x27 = 675.0x"`. |
| `setWin` | `amount: int`, `winLevel: 1–7` | Per-evaluation win registration; drives the celebration ladder. |
| `updateGrid` | `clearedTiles: int[]`, `slides: [{from:int, to:int}]`, `incoming: [{tile:int, symbol:string, stratum:int}]`, `newStratumMap: int[36]`, `depthReached: 0\|1\|2` | Dig Deeper: clear, slide, refill one stratum down (face-down). Lights depth pills. |
| `pipeStrike` | `tile: int`, `gag: "micro" \| "geyser"`, `variant: 1\|2\|3`, `depthAtStrike: 0\|1\|2` | The stop event. `geyser` only legal when `depthAtStrike ≥ 1`. |
| `sweepEnd` | `reason: "pipe" \| "quiet"` | Spin/sweep close beat (soft fade when `quiet`). |
| `freeSpinTrigger` | `chestTiles: int[]`, `totalSweeps: int` (10), `scatterPay: int`, `bonusMode: "bigdig" \| "nightdig"` | Bonus trigger takeover. |
| `setTotalWin` | `amount: int` (round-cumulative) | Round meter tick — ticker UP through each win, never jump. |
| `finalWin` | `amount: int` | Must equal `payoutMultiplier`. Drives `/wallet/end-round` when > 0. |

### 5.2 Bonus-only events (Big Dig / Night Dig)

| type | Fields | Meaning |
|------|--------|---------|
| `sweepStart` | `sweep: int`, `totalSweeps: int`, `stratumMap: int[36]`, `meter: int`, `pipeTile: int \| null`, `refills: [{tile:int, symbol:string, stratum:int}]` | Opens each sweep; carries the persistent state forward and any inter-sweep refills. Frontend POSTs `/bet/event` with this event's `index`. |
| `retrigger` | `chestTiles: int[]`, `addedSweeps: 3`, `totalSweeps: int` (new total) | +3 sweeps inside the same round. |
| `bonusSummary` | `totalWin: int`, `sweepsPlayed: int`, `deepestStratum: int`, `peakMeter: int`, `topFind: {symbol:string, amount:int}` | End-of-bonus recap card (feeds the museum-plaque frame). Precedes `finalWin`. |

**winLevelMap** (SDK 7-level convention) is defined in §6 and is the single source for `setWin.winLevel` in both generator and frontend.

---

## 6. Win Tier Table (winLevel 1–7)

| winLevel | Name | Threshold (total win, x-bet) | Celebration |
|----------|------|------------------------------|-------------|
| 1 | Nice Find | > 0 and < 1x | coin-sparkle chirp, amount pop |
| 2 | Good Find | ≥ 1x and < 3x | pouch jingle, Ron perk pose |
| 3 | Great Find | ≥ 3x and < 10x | brass sting, Ron thumbs-up, screen-edge gold glow |
| 4 | BIG FIND | ≥ 10x and < 30x | soil-confetti particles, Ron jig (procedural rig motion), drum stem in |
| 5 | MEGA HOARD | ≥ 30x and < 100x | full-screen typography card + museum-plaque frame with the top find composited in, brass band |
| 6 | EPIC DIG | ≥ 100x and < 1,000x | screen shake, gold particle storm, Signal Meter fanfare, Ron double-take + headphone-pop (rig layers) |
| 7 | KING'S RANSOM | ≥ 1,000x (max-win variant flagged at exactly 15,000x) | Ron faints via the layered rig, flask launches skyward, the bespoke newspaper front page spins in, coin loop + full band |

No gaps, no overlaps. Per-evaluation `setWin` uses the evaluation amount; the end-of-round celebration uses the round total. Multipliers never hide: the Signal Meter is visible all spin, so the win reveal IS the rollup, ticking up through each win.

---

## 7. Pacing Table

Benchmark: dead spins fast, tiers earn duration. Autoplay gap is 380ms after full resolve in all cases.

| Outcome | Standard resolve | Turbo | Notes |
|---------|-----------------:|------:|-------|
| Dead spin | ≤ 1.1s total | ≤ 0.6s | ~0.7s sweep burst (flips at ~90ms, single low blips) + 0.3s micro-CLUNK + one-frame Ron shrug |
| Dead spin, quiet fade | ≤ 1.1s | ≤ 0.6s | 0.4s fade-out replaces the CLUNK |
| Earned geyser gag | +1.8s | skipped | only when depthAtStrike ≥ 1 (Georgian+); ~1 in 8 spins; 3 rotating variants |
| SURVEY stamp beat | 350ms | 180ms | fires only at evaluations |
| Flood burst | 260–420ms | 150ms | scaled by tile count (4–9) |
| Dig Deeper slide | 450ms | 220ms | strata-crack + refill |
| winLevel 1 pause | +0.4s | +0.2s | |
| winLevel 2 pause | +0.7s | +0.35s | |
| winLevel 3 pause | +1.0s | +0.5s | |
| winLevel 4 pause | +1.8s | +0.9s | |
| winLevel 5 pause | +2.8s | +1.4s | typography card |
| winLevel 6 pause | +4.5s | +2.2s | |
| winLevel 7 | +8.0s, tap-to-dismiss | not shortened | max-win variant adds the newspaper spin-in |

Turbo keeps every floated win amount legible (min 400ms on-screen per amount). Gags are rationed so they still land at spin 200.

---

## 8. Mobile-Portrait Layout (top to bottom; verified at 320×568 and Popout-S 400×225)

1. **Top HUD strip (in-flow, never over the grid):**
   - Left: **micro-Ron dock face** (headphones-only) — carries idle blinks, win reactions, near-miss lean-in at small size.
   - Center: **three DEPTH PILLS** — Topsoil / Georgian / King's Hoard, lighting as the spin digs. In-flow pills, the ding-log's exact prescription for persistent badges.
   - Right: **SIGNAL METER** — Ron's handheld readout device showing the live multiplier (x1 → x188). The equation line prints directly beneath it on wins.
2. **Progress pip row:** thin strip showing the top 2–3 leading symbols' live counts ("Chalice 6/8"). Hidden when the field is fully face-down.
3. **6×6 grid:** square, centered, maximum width, bright soil plugs with warm cream-gold rims — explicitly no dark edges. Nothing ever overlays it.
4. **Finds pouch:** anchored off-grid at the grid's bottom-right corner; finds fly into it; tap opens the round tally.
5. **Win/message line:** current win amount + contextual copy ("SWEEP 4 OF 10" in bonus).
6. **Bottom thumb-zone bar:** bet − / bet amount / bet + on the left · **the coil SPIN button** (Ron's detector coil, oversized, thumb-center) · autoplay + turbo on the right · menu (burger → info, sound, buy menu, coil select, Rally toggle).
7. **Footer meters:** Balance (always exactly 2 decimals) and Win (full precision) — separate formatters, official 21-code currency table, 0 decimals for JPY/IDR/KRW/VND/CLP.

Desktop/landscape: full-figure Ron stands right of the grid working the field; HUD strip persists on top. At Popout-S 400×225 Ron collapses to the micro-dock face and the week-one screenshot gate must show: all 4 junk lows readable, a red-gold tag chip, the depth pills, the meter, and micro-Ron — pass/fail before art production.

---

## 9. Mascot Behavior Map — BIG RON

60-something solo rogue detectorist: walrus mustache (NO beard), bucket hat (NO flat cap), giant ear-cup headphones, orange hi-vis over knitted jumper, wellies, tea flask. **Load-bearing:** his readout IS the Signal Meter, his coil traces the reveal order, his beeps are the anticipation instrument, his Deep Scan slam is the meter-doubling book event. Delete Ron and the game loses its multiplier display, reveal source, and anticipation engine.

Implementation: 8 pose sheets + a **7-part layered rig** (hat, headphones, eyes, mustache, arms, coil, flask) driven by rAF transforms — faint, jig, headphone-pop, tea-spit are code-driven layer animation, not new art. No Spine, no 3D.

| State | Trigger | Behavior | Assets |
|-------|---------|----------|--------|
| Idle | no input 4s+ | slow coil sway; every ~9s one of: mustache twitch, tea sip from flask, headphone adjust, distant gaze | pose sheet 1 + rig (mustache, arms, flask) |
| Spin/sweep | sweepSegment playback | leans in, coil visually tracks `coilPath`; head bobs on each flip blip | pose sheet 2 + rig (arms, coil, eyes) |
| Signal rising | beepStep 2–3 | eyes widen, grips coil two-handed, leans closer | pose sheet 3 + rig (eyes, arms) |
| Scream (step 4) | Hoard-stratum / trigger books only | headphones vibrate, hat lifts 2px, full-body tremble | pose sheet 3 + rig (hat, headphones) |
| Near-miss | 2 chests revealed + held reveal, resolves dead | lean-in freeze → slow deflate, hat settles, one wordless gasp→sigh | pose sheet 4 + rig |
| Dead spin (pipe micro) | pipeStrike micro | one-frame shrug | pose sheet 5, single frame |
| Geyser gag | pipeStrike geyser | soaked recoil, wrings hat (3 variants share the sheet) | pose sheet 5 |
| Win L1–L2 | setWin 1–2 | perk pose, small nod / pouch pat | pose sheet 6 |
| Win L3–L4 | setWin 3–4 | thumbs-up (L3); procedural jig — arms+coil rig cycled (L4) | pose sheet 6 + rig |
| Win L5–L6 | setWin 5–6 | arms-up roar (L5); double-take + headphone-pop, rig layers thrown (L6) | pose sheet 7 + rig (headphones, eyes, hat) |
| Win L7 / max win | setWin 7 | faint via rig: eyes X, body tips, flask launches skyward with its own arc | pose sheet 7 + rig (all layers) |
| Deep Scan | deepScan event | coil SLAM to ground, readout flash, meter flips x2 in one beat | pose sheet 8 + rig (arms, coil) |
| Bonus trigger | freeSpinTrigger | headphone-pop + whoop, throws hat, catches it | pose sheet 8 + rig |
| Micro-dock (portrait/Popout-S) | layout breakpoint | headphones-only face: idle blink, eye-widen on step 2–3, X-eyes on faint, bounce on wins L4+ | micro-dock face sheet |

Vocals are WORDLESS (gasp, whoop, yelp, one tea-spit splutter) — localization-proof, no UK-idiom lines.

---

## 10. UI Copy (natural English; the runtime social-swap table converts for stake.us — never hardcode swapped strings)

**Buttons / controls**
- Spin: (icon-only coil; aria-label "Spin")
- `TURBO` · `AUTOPLAY` · `STOP AUTOPLAY`
- Bet stepper aria-labels: "Increase bet", "Decrease bet"
- `BUY BONUS` (menu entry; social → "Get Bonus" via swap table)
- Coil select: `STANDARD COIL — 9″ · Steady sweeps, frequent shallow finds` / `XL DEEP COIL — 15″ · Rarer signals, deeper digs`
- Rally toggle: `RALLY +25% · Twice the Hoard Chests`

**Confirm dialogs**
- Rally ON: `Rally raises every spin's cost by 25% for double Hoard Chest frequency. New cost per spin: {amount}. Confirm?` → `CONFIRM` / `CANCEL`
- Deep Scan Sweep: `DEEP SCAN SWEEP — one guaranteed Deep Scan sweep, digging to the Georgian stratum. Cost: {5× bet as amount}. Max win in this mode: 500x. Confirm purchase?`
- Big Dig: `THE BIG DIG — 10 sweeps over one persistent field. Cost: {80× bet}. Max win: 15,000x. Confirm purchase?`
- Night Dig: `NIGHT DIG — 10 sweeps starting in the Georgian stratum, doubled signal tags, no pipe for the first 3 sweeps. Cost: {400× bet}. Max win: 15,000x. Confirm purchase?`
- Autoplay: `Start {n} automatic spins at {amount} per spin?` (+ loss-limit field where jurisdiction requires)

**In-game messages**
- `SURVEY!` (stamp) · `DIG DEEPER!` · `DEEP SCAN — SIGNAL DOUBLED!` · `SIGNAL FLOOD!`
- `SWEEP {n} OF {total}` · `+3 SWEEPS!` (retrigger) · `THE BIG DIG!` (trigger card)
- Pipe: `CLUNK. The old water main.` (micro) / `The water main! Every time!` (geyser)
- Win tiers: `NICE FIND` / `GOOD FIND` / `GREAT FIND` / `BIG FIND` / `MEGA HOARD` / `EPIC DIG` / `KING'S RANSOM`
- Max win: `15,000x — THE KING'S RANSOM, DUG UP AT LAST`
- Equation line format: `{count}× {symbol} {basePay}x × SIGNAL x{meter} = {amount}x`

**Resume / replay / errors**
- Resume: `You have an unfinished round (sweep {n} of {total}).` → `WATCH` / `SKIP TO RESULT`
- Replay screen: `REPLAY` header, `PLAY` button (never auto-start), `BONUS {bonus amount} — REAL COST {real amount}`, `PLAY AGAIN` at end. All betting UI removed. Replay `amount` arrives in micro-units — convert before display.
- Error modal: `Connection hiccup. Your balance is safe — the round will resolve when you reconnect.` → `RETRY` (any play error resets the autoplay counter and shows this modal)

---

## 11. Art Asset List — 40 images, each with a gpt_image_2 prompt seed

**GLOBAL STYLE SEED (prepend to every prompt):**
`"STYLE: flat thick-outline vector cartoon with painterly grass-and-soil grain, golden-hour pastoral palette — meadow green, harvest gold, sky blue, poppy-red accents — bright and saturated, warm cream-gold rims on all edges, absolutely no dark edges, no photorealism, no text, cohesive single-artist look."`

| # | Asset (file) | Prompt seed (append to STYLE) |
|---|--------------|-------------------------------|
| 1 | `sym_crown.png` | "Slot symbol: ornate medieval king's crown, gold with ruby cluster, faint royal glow, centered on transparent background, readable at 25px" |
| 2 | `sym_chalice.png` | "Slot symbol: tall hammered silver chalice, subtle engraved band, soft sheen, centered, transparent background, readable at 25px" |
| 3 | `sym_ring.png` | "Slot symbol: fat jewelled gold ring with one large sky-blue gem, chunky silhouette, centered, transparent background, readable at 25px" |
| 4 | `sym_buckle.png` | "Slot symbol: square golden belt buckle, medieval, tooled edge detail, centered, transparent background, readable at 25px" |
| 5 | `sym_penny.png` | "Slot symbol: rough hammered silver penny, off-round medieval coin with cross stamp, centered, transparent background, readable at 25px" |
| 6 | `sym_horseshoe.png` | "Slot symbol: rusty U-shaped horseshoe, orange-brown rust patches, comic junk charm, centered, transparent background, readable at 25px" |
| 7 | `sym_spoon.png` | "Slot symbol: long rusty spoon on a strong diagonal, bent handle, comic junk energy, centered, transparent background, readable at 25px" |
| 8 | `sym_cap.png` | "Slot symbol: crimped red bottle cap, slightly dented, poppy-red, comic junk charm, centered, transparent background, readable at 25px" |
| 9 | `sym_ringpull.png` | "Slot symbol: silver drink-can ring pull tab, clean silhouette, gentle shine, comic junk charm, centered, transparent background, readable at 25px" |
| 10 | `sym_chest.png` | "Slot scatter symbol: small banded treasure chest half-buried, gold light leaking from the seam, exciting glow, centered, transparent background" |
| 11 | `sym_pipe.png` | "Slot stop-tile symbol: green-patina Victorian water main pipe elbow, one comic drip, sturdy silhouette, centered, transparent background" |
| 12 | `tile_topsoil.png` | "Slot tile back: square soil plug of light loam topsoil with tiny grass tufts, warm cream-gold rim, painterly grain, seamless as a grid tile" |
| 13 | `tile_georgian.png` | "Slot tile back: square soil plug of Georgian-era clay flecked with red brick fragments and pottery chips, warm cream-gold rim, painterly grain" |
| 14 | `tile_hoard.png` | "Slot tile back: square soil plug of deep golden peat with tiny glinting treasure flecks, subtle regal glow, warm cream-gold rim" |
| 15 | `tags_sheet.png` | "Sprite sheet, 3 rows: small hexagonal multiplier chip badges — row 1 verdigris bronze-green, row 2 polished silver-blue, row 3 glowing red-gold — empty center for numerals, readable at 25px, transparent background" |
| 16–23 | `ron_pose_1..8.png` | Eight sheets, shared base: "BIG RON, 60-something solo metal detectorist, walrus mustache (no beard), bucket hat (no flat cap), giant ear-cup headphones, orange hi-vis vest over knitted jumper, wellies, tea flask on hip, metal detector; full body, transparent background —" + per sheet: (1) "relaxed idle, coil resting" (2) "mid-sweep, leaning, coil low over ground" (3) "alert, eyes wide, gripping coil two-handed" (4) "deflated near-miss slump, hat drooping" (5) "shrug, plus a soaked geyser-recoil variant wringing his hat, 3 splash poses" (6) "pleased perk-up nod, and thumbs-up variant" (7) "arms-up roar celebration, and shocked double-take variant" (8) "coil slam to the ground, action pose, plus hat-throw whoop variant" |
| 24 | `ron_rig.png` | "Layered rig sheet on transparent background, parts separated and labeled by position: bucket hat, ear-cup headphones, eye pair (open/wide/X), walrus mustache, two arms, detector coil, tea flask — clean cut edges for code-driven animation, consistent with BIG RON design" |
| 25 | `ron_micro.png` | "Tiny dock face: BIG RON's head only inside giant ear-cup headphones, front-facing, expressive eyes, reads clearly at 48px, transparent background" |
| 26 | `bg_day.png` | "Wide background: golden-hour English farm field, gentle hills, hedgerows, long warm shadows, big sky-blue and harvest-gold sky, soft ground area at center-bottom for a game grid, no characters" |
| 27 | `bg_night.png` | "Wide background: the same English farm field at night, deep blue sky, full moon, torch-glow warmth at the center, fireflies, soft ground area at center-bottom for a game grid, no characters" |
| 28 | `logo.png` | "Game logo lettering: the word SWEEPER hand-painted in rounded chunky letters on a carved wooden plank, harvest gold on meadow green, small detector coil swash under it, transparent background" |
| 29 | `tile_fg.png` | "Game-tile foreground: BIG RON mid-sweep, gold light bursting from bright soil at his coil, joyful surprise, character fills the frame, transparent background, no text" |
| 30 | `tile_bg.png` | "Game-tile background: bright golden-hour meadow with radiating warm gold light from the low center, brighter than a dark website, vignette-free, no dark edges, no text" |
| 31 | `hud_depthpills.png` | "UI strip: three rounded pill badges in a row carved as tiny painted wooden tags — one grassy green, one brick-flecked amber, one glowing royal gold — plus lit/unlit states, transparent background" |
| 32 | `hud_meter.png` | "UI device: handheld metal-detector readout box, cream enamel with brass trim, big rounded display window for a multiplier numeral, small red needle dial, hand-painted charm, transparent background" |
| 33 | `icons_coils.png` | "Icon sheet: two metal-detector coil heads side by side — a modest 9-inch coil and a hefty 15-inch coil with deeper glow rings — matching painted-metal style, transparent background" |
| 34 | `pouch.png` | "Prop: worn canvas finds pouch on a belt loop, slightly bulging, drawstring open, warm tan with poppy-red stitch, transparent background" |
| 35 | `stamp_survey.png` | "UI stamp: round rubber-stamp mark reading area left EMPTY for text, twine-and-cardboard field-survey tag aesthetic, poppy-red ink ring with laurel of grass blades, transparent background" |
| 36 | `plaque_frame.png` | "Frame: small museum display plaque, warm wood with brass corner fittings and an empty velvet center for compositing a found artifact, gentle spotlight glow, transparent background" |
| 37 | `newspaper.png` | "Bespoke set piece: cartoon newspaper front page bursting with a huge photo area of a mud-spattered celebrating detectorist holding a crown, big empty headline banner (no text), coins scattered on the page, slight curl, transparent background" |
| 38 | `ui_signs_1.png` | "UI sheet: hand-painted homemade wooden signs and buttons — arrow buttons, toggle plank, panel backboards, rounded frames — meadow green and harvest gold paint on warm wood, charming amateur brushwork, transparent background" |
| 39 | `ui_signs_2.png` | "UI sheet: more hand-painted wooden UI — dialog panel with rope hangers, tab shapes, small round buttons, a big circular button housing shaped like a detector coil, matching brushwork, transparent background" |
| 40 | `loading.png` | "Loading screen: BIG RON walking along a golden-hour hedgerow path toward the viewer, detector over shoulder, long shadow, space at bottom for a progress bar shaped like a coil cable, warm and inviting, no text" |

The helicopter set piece is CUT. Self-hosted hand-painted rounded lettering font (custom, no stock fonts). Max 2 text sizes on the game tile; no baked text or multipliers in any tile imagery.

---

## 12. Audio Asset List — ElevenLabs sound-generation prompts

**SFX (~24)**

| # | File | ElevenLabs prompt |
|---|------|-------------------|
| 1 | `beep_1.wav` | "Single short low metal-detector blip, soft rounded square-wave tone, 120ms, dry, unobtrusive" |
| 2 | `beep_2.wav` | "Two quick rising metal-detector beeps, mid pitch, slightly urgent, 300ms total, clean electronic tone" |
| 3 | `beep_3.wav` | "Urgent triple metal-detector beep climbing in pitch, excited electronic warble at the tail, 450ms" |
| 4 | `beep_4_scream.wav` | "Continuous screaming metal-detector tone, high pitch with frantic warble, seamlessly loopable, thrilling not painful, 2s loop" |
| 5 | `flood_pop.wav` | "Rapid burst of soft earthy pops like turf plugs flipping open in quick succession, 6 to 8 pops in 350ms, playful" |
| 6 | `dig_thunk.wav` | "Single satisfying spade thunk into soft soil with a small gravel scatter, 250ms" |
| 7 | `pipe_clunk.wav` | "Dull comedic metal CLUNK, shovel hitting a buried iron pipe, short hollow ring, 300ms" |
| 8 | `geyser.wav` | "Cartoon water geyser erupting: pressurized burst, rising water whoosh, splattering droplets landing on grass, 1.8 seconds, comedic" |
| 9 | `strata_crack.wav` | "Deep earthy crack and rumble of soil layers giving way, tiles sliding downward with gravelly texture, resolving warm, 500ms" |
| 10 | `bag_jingle.wav` | "Small handful of coins and trinkets dropping into a canvas pouch, bright jingle with cloth thump, 350ms" |
| 11 | `survey_stamp.wav` | "Firm rubber stamp thump on paper with a slight wooden desk knock, official and satisfying, 200ms" |
| 12 | `win_1.wav` | "Tiny warm coin-sparkle chirp, single glockenspiel note with a short shimmer, 400ms" |
| 13 | `win_2.wav` | "Cheerful two-note pouch jingle with a light banjo pluck, 600ms" |
| 14 | `win_3.wav` | "Short brass sting, three ascending trumpet notes with a tambourine hit, bright village-band feel, 900ms" |
| 15 | `win_4.wav` | "Punchy brass-and-drum fanfare with a snare roll into a cymbal, celebratory village brass band, 1.5s" |
| 16 | `win_5.wav` | "Full brass band flourish with tuba bounce and bell tree glissando, triumphant and warm, 2.5s" |
| 17 | `win_6.wav` | "Epic brass band climax with timpani rolls, gold-shimmer synth sparkle layer, big cymbal crashes, 3.5s" |
| 18 | `win_7.wav` | "Grand ceremonial brass fanfare resolving into a joyful full-band march with church-bell peals and coin cascade shimmer, 6 seconds" |
| 19 | `coin_loop.wav` | "Continuous cascading coin shower, bright metallic rain, seamlessly loopable, 2s loop" |
| 20 | `ron_gasp.wav` | "Older man's sharp wordless gasp of surprise, breathy, warm character, no words, 400ms" |
| 21 | `ron_whoop.wav` | "Older man's joyful wordless whoop of triumph, hearty, no words, 700ms" |
| 22 | `ron_yelp.wav` | "Older man's short comedic startled yelp, no words, 300ms" |
| 23 | `ron_splutter.wav` | "Comedic tea spit-take: a surprised splutter and cough from an older man, liquid spray, no words, 700ms" |
| 24 | `ui_click.wav` | "Soft wooden button tap, warm knock, 80ms" |
| 25 | `ui_confirm.wav` | "Two-tone wooden xylophone confirmation, friendly and rustic, 250ms" |
| 26 | `retrigger.wav` | "Bright chest-lid creak-open into a magical gold chime swell, 900ms" |

**Music loops (3, stem-layered for ducking)**

| File | Prompt |
|------|--------|
| `bgm_day.wav` | "Warm pastoral folk loop: fingerpicked banjo, soft whistling melody, light acoustic guitar, gentle brushed percussion, golden-afternoon English countryside feel, seamlessly loopable 60s. Deliver as stems: base (banjo+whistle), +drums stem, +brass stem for layered intensity" — drums stem enters at Georgian, brass stem at King's Hoard; all stems duck under win stingers and the rollup |
| `bgm_night.wav` | "Nocturnal variant of a pastoral folk loop: slower tempo, upright bass, muted banjo, distant owl and cricket ambience, moonlit mystery with warm undertone, seamlessly loopable 60s, with an intensifying string stem" |
| `bgm_celebration.wav` | "Jubilant amateur village brass band march, tuba bounce, cornets, snare, slightly loose and human, pure joy, seamlessly loopable 30s" — plays under winLevel 5–7 and the bonusSummary card |

Ducking rules: stingers duck bgm −9dB with 120ms attack / 600ms release; beeps duck the whistle stem only; the step-4 scream ducks everything except itself and the flood pops.

---

## 13. Info / Paytable Content Skeleton

Popup gate (never a persistent bar over the grid), swipeable pages, all social-swept:

1. **HOW TO PLAY** — the buried field, sweeps, floods, 8+ scatter-pays rule among revealed tiles, SURVEY evaluations, per-symbol pips, the pipe stop event, quiet-fade end.
2. **WIN TABLE** — full paytable (all 9 symbols × 3 count bands, dynamic in current bet currency), Hoard Chest values and trigger counts, the Pipe ("pays nothing — ends the sweep").
3. **HOT SIGNALS & THE SIGNAL METER** — tag bands and value ranges (x2–x100), meter = sum of tags, applies to every evaluation, persists within the spin (and across all sweeps inside The Big Dig only), resets every round. Deep Scan doubles the meter. Equation-line explanation.
4. **DIG DEEPER** — three strata, richer weights + denser tags per stratum, depth resets every round.
5. **THE BIG DIG** — trigger (3+ chests), 10 sweeps, one persistent field/depth/meter, retrigger: 2 chests = +3 sweeps (state explicitly that retriggers can repeat), pays once at the end.
6. **MODES & BUYS** — Coil Select (Standard vs XL, equal 96.65% RTP, variance difference in plain numbers); Rally (+25%, 2x chest frequency, Standard only); the three buys with per-tier cost and ceiling: Deep Scan Sweep 5x / **max 500x**; Big Dig 80x / max 15,000x; Night Dig 400x / max 15,000x (Georgian start, no pipe sweeps 1–3, doubled tags). **"Bonus purchases use their own fixed configuration and are not affected by Coil Select."**
7. **RTP & MAX WIN** — per-mode RTP to the LUT's exact decimals; per-mode max win to the last decimal; max win reachable at better than 1-in-10M in every mode that advertises it.
8. **UI GUIDE** — every button explained (spin/coil, bet, turbo, autoplay + confirm + lockout behavior, buy menu, coil select, Rally, sound, replay behavior, Watch-or-Skip resume).
9. **LEGAL** — the 7-point disclaimer: malfunction voids plays; internet required; disconnection recovery (round resolves on reconnect with Watch/Skip); expected return = stated RTP; display accuracy governs; payouts from game server records; copyright notice.

---

## 14. Mocked Math — Fixture Book Set

Two artifacts: (a) a throwaway Node generator emitting **100k books/mode** that must pass all five auto-checked gates (RTP 96.65% ±0.5% cross-mode; base hit ~1-in-3.6; ≥1,200 distinct payouts; most-likely result ≥1-in-1000; no win-table gaps; 15,000x reachable ≥1-in-10M where advertised); (b) the **curated fixture set below**, embedded as static TS and played Storybook-style — the sanctioned zero-RGS dev/demo mode. Every fixture book obeys: ≥6 reveals before any pipe; beep grammar rules (§4.3); geyser only at depth ≥1; flood tile lists explicit; equation lines precomputed.

### 14.1 `base_standard` — 60 books
| Bucket | Count | Contents |
|--------|------:|----------|
| Dead — fast pipe | 8 | 6–8 flips, micro-CLUNK, 0 tags ×5 / 1 small tag tease ×3 |
| Dead — quiet fade | 6 | 7–10 reveals incl. one small flood, no 8+ count |
| Dead — deep-dig geyser | 4 | reach Georgian via one paid-then-lost… no — reach Georgian reveal depth via a flood chain with no 8+; pipe geyser variants 1/2/3 + repeat |
| Dead — tag tease | 4 | meter builds to x8–x14 on tags, counts stall at 6–7/8, quiet fade |
| Near-miss — 2 chests | 4 | 2 `SC` early, beep step 3 held reveal on the last segment, resolves dead (tuned, not maximized) |
| Near-miss — 7/8 pips | 2 | leading crown/chalice at 7/8 into the final flip, dead |
| Small wins (<1x, winLevel 1) | 12 | single evaluation, low symbols, meter x1–x3 |
| Nice (1–<10x, L2–L3) | 9 | 1–2 evaluations; 2 books include a Dig Deeper to Georgian; 1 includes a `deepScan` |
| Big (10–<30x, L4) | 5 | 2–3 evaluations, Georgian reached, meter x8–x20 |
| Mega (30–<100x, L5) | 3 | King's Hoard reached (step-4 scream), meter x25–x60, geyser finish |
| Natural trigger → Big Dig | 2 | 3 chests; one modest bonus (~45x), one strong (~180x incl. one retrigger) |
| Max-win showcase | 1 | natural trigger → Big Dig rolling to exactly 15,000x (winLevel 7 max variant) |

### 14.2 `base_xl` — 60 books
Same buckets, XL texture: **26 dead** (longer flood chains that still miss), 5 near-miss, 8 small, 8 nice, 5 big, 4 mega, **2 epic (100–<1000x, L6)** with full Hoard-stratum boards, 1 natural trigger, 1 max-win showcase. Dead spins remain ≤1.1s — depth shows in reveal texture, not duration.

### 14.3 `base_rally` — 50 books
Chest-forward: 16 dead (half containing 1–2 visible chests that don't trigger), **8 near-miss** (2-chest held reveals — the ante's felt product), 8 small, 7 nice, 4 big, 2 mega, **4 natural triggers** (2x frequency made tangible: ~60x, ~110x, ~240x w/ retrigger, ~35x bust-ish bonus), 1 max-win showcase.

### 14.4 `buy_deepscan` — 40 books (cost 5x, ceiling 500x)
Every book: guaranteed `deepScan` + guaranteed Georgian. 10 × 0–<1x · 10 × 1–<5x · 10 × 5–<20x · 6 × 20–<100x · 3 × 100–<400x · **1 × exactly 500x showcase** (L6 celebration; this mode never reaches L7). No `SC` triggers in this mode's books.

### 14.5 `buy_bigdig` — 40 books (cost 80x)
| Bucket | Count | Notes |
|--------|------:|------|
| Bust (<20x) | 8 | incl. 2 painful early-pipe-every-sweep books and 1 near-retrigger (1 chest × three sweeps) |
| 20–<60x | 10 | 2 with a retrigger that still lands low (honesty) |
| 60–<120x | 10 | around break-even texture; meters x10–x30 |
| 120–<300x | 6 | 2 retriggers; Hoard stratum by sweep 6 |
| 300–<1,000x | 3 | deep meters x40–x90, 1 double retrigger (16 sweeps) |
| 1,000–<5,000x | 2 | L7 celebrations, full-Hoard finishes |
| Max-win showcase | 1 | 15,000x with `deepScan` on the final sweep |

### 14.6 `buy_nightdig` — 40 books (cost 400x)
6 × <100x bust · 9 × 100–<300x · 10 × 300–<800x · 8 × 800–<2,000x · 4 × 2,000–<6,000x · 2 × 6,000–<12,000x · **1 × 15,000x — THE CLIP BOOK:** sweep 9, entire 6×6 field King's Hoard stratum, crowns and jewelled rings wearing red-gold chips, wall-to-wall step-4 scream, meter x94 → `deepScan` flips it to x188 in one beat → rollup to 15,000x → Ron faints, flask skyward, newspaper spin-in. Must self-narrate muted at 400px.

### 14.7 Fixture housekeeping
- Every book's `finalWin` equals `payoutMultiplier`; every `setTotalWin` sequence is monotonically increasing.
- Each mode's fixture set includes at least one book exercising: turbo path, resume mid-bonus (`/bet/event` indices present), replay rendering, and social-mode copy surfaces.
- Criteria strings per book (`"dead"`, `"nearmiss"`, `"small"`, `"nice"`, `"big"`, `"mega"`, `"epic"`, `"trigger"`, `"maxwin"`) drive the Storybook picker.

---

## 15. Week-One Gates (before any final art)
1. **Popout-S screenshot gate:** a 400×225 capture must pass/fail on: all 4 junk lows readable, a red-gold tag chip legible, three depth pills, the Signal Meter numeral, micro-Ron dock face — nothing over the grid.
2. **Generator gate:** the throwaway Node generator emits 100k books/mode passing all five math gates automatically.

## 16. Compliance Checklist (build-in on pass one — summary)
Replay mode per spec (Play-gated, betting UI disabled, zero session calls, micro-unit conversion, real-cost line, Play Again). Social swap table incl. Get Bonus, XSC/XGC detection with stripped-code display, re-swept after every dynamic DOM rebuild incl. aria-labels and the replay window. Watch-or-Skip on `round.active`. Confirm dialogs on ante-ON and every buy; full autoplay lockout. `rgs_url` from query only, fail closed; all betLevels usable; `defaultBetLevel` micro-units; refresh mid-spin preserves bet; all 12 jurisdiction flags honored. Balance 2 decimals / win full precision, separate formatters; simultaneous wins each float their own amount; meters tick up. Info tab RTP/max-win to the last decimal vs LUTs. Game tile brighter than the platform, no dark edges, no baked text. Static self-hosted assets only, relative paths (`base:'./'`). No jackpot, no gamble, no mid-round decisions, no cross-round state. Ship the complete feature set — post-approval freeze is forever.