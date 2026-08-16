# Round-1 fix progress (audit: docs/audit-round1.json) — COMPLETE 2026-07-02

All 21 must-fix findings applied + the minor/polish tail. Final QA sweep
(tools/qa-full.mjs against the rebuilt dist): 0 console errors, 0 bad
requests, 0 social leaks, 0 overlaps.

## Applied (all verified in source + screenshots)
- R1 resume flow gated after loader (controller.maybeOfferResume from main.ts boot)
- R2 legal data-no-swap (verbatim "Stake Engine" survives social sweep — screenshot-verified)
- R3 bookgen forced-bucket escalation (big/mega books can no longer pay 0)
- R4 ≤400px HUD media query — 320×568 fits all controls incl. menu (screenshot-verified)
- R5 Popout-S 400×225: pinned side-column HUD, board fills height (~29px cells), tiny→Ron collapses to dock face
- R6 brand-logo overlap: fixed dead `#brand img#brand-logo` specificity + overflow guard + ≤380px pill ellipsis
- R7 uiBlocked guard on spin/Space
- R8 Signal Meter skinned with meter.webp readout art + CSS needle (log-scale -50°..+50°) + number roll + hot glow; board.onTagSurfaced → burst + fx.flyTo spark stream into the meter
- R10 tier ladder aligned to doc §6 (bookgen + presenter winX>=30 card gate)
- R11 big-win staging: radial dim + blur + plaque plate behind #bigwin; goldStorm/shake at L5+; Ron roar/faint; setWin L5+ mid-round beat added
- R12 wooden chrome: signs.webp sliced (panel9/knob_gold/sign_hang/btn_round in public/assets/ui/), modal border-image frame, wooden head strip, gold CTAs, plank+rosette toggles, wood buy-cards + ✓ selected state
- R13 paint-order: stroke fill + doubled strokes on all 5 headline rules (glyph corruption gone — screenshot-verified)
- R14/R15 pips tracking resync (sweepStart + updateGrid from board truth)
- R16 win ticker never runs backward
- R17 persistent bonus field in bookgen
- R18 full jurisdiction flag set + ADDED the missing DOM nodes (#session-timer, #net-block/#net-value, #rtp-inline) that would have crashed init
- R19 replay social labels (mandated verbatim, data-no-swap) — was already in main.ts
- R20 per-cluster plated floats (was already in presenter/fx)
- R21 win table: fixed name column, nowrap pay cells, scroll fade on .modal-body
- R22 settle flourish: meter drains to x1 + strata reset + Ron idle at round end
- R23 persistent "SWEEP n/N" in msg-line (flashes restore baseMsg) + sweep counter timers cleared
- R24 buy race: spin() returns started-bool, onBuyAccept re-checks lock + resets buyPending with feedback
- R25 disabled/selected states (spin silhouette, buy-card ✓ badge)
- R26 ≥44px hit areas via ::after padding on .step-btn/.x-btn
- R27 Ron AO ground-shadow ellipse
- R28 max-win label templates from mode maxWinX (Deep Scan can never show 15,000x)
- R29 distinct UX per ERR_GLE/ERR_LOC/ERR_MAINTENANCE/ERR_IB (no Retry on blocking)
- R30 replay gate: MODES label + themed panel
- R31 resume sweep number uses last sweepStart
- R32 exact TAG_BANDS values table in Hot Signals page (generated from constant)
- R33 bridge skips auto-auth on ?replay=true
- R34 betLevels synthesized from min/max/step + clamped to operator bounds
- R35 near-miss beat (7-of-8 tally → alert + held flip)
- R36 trigger card chest-trio art with pop-in
- R37 summary: top find spotlit in plaque + amount count-up
- R38 tag chips: verdigris-bronze / silver-blue / red-gold band palette
- R39 night cool grade on canvas (body.night filter)
- R40 landscape symmetric board centering when Ron fits the margin
- R41 money-block contrast strips (stronger at night)
- R43 equation format already doc-exact
- R45 autoplay badge = stop glyph + remaining count
- R46 flashMessage restores persistent message
- R47 console noise gated behind ?debug=1
- R49 dead code removed (tileView loop, betIdx clamp)
- QA harness: leak scan honors data-no-swap, 2D overlap probe, horizontal-overflow probe

## Known gaps (candidates for round 2)
- R44 buy-card vignette illustrations (needs new art per tier)
- R48 resize mid-tween tile snap (rare, rotate-during-cascade)
- Spin-button coil housing art (design doc asset 39 — never generated)
- Band-3 tag chip glow pulse (static bright edge for now)
- Tags stay visible on the settled board until next reveal (meter correctly drains)
- Store tile: guidelines require a PROVIDER/STUDIO logo (ProviderName-Logo.png), not the game wordmark — needs a studio name + logo before submission. Official guidelines scraped to docs/stake-approval-guidelines.md; Sweeper-BG converted to JPG to meet the 3MB combined BG+FG budget.
- Replay mode: guidelines ask for a visible loading state while replay data is fetched (we hide the loader before the fetch) — cosmetic, quick fix.

## Next
- Round-2 audit (multi-agent) against the rebuilt game if requested
- Real-math integration checks happen at RGS hookup time

## Rename + new controls (2026-07-02, user request)
- Game renamed HOARDSWEEPER → SWEEPER: title, logo alts, code comments, docs, package.json, store files (audit-round1.json left as historical record)
- New logo.webp generated (gpt_image_2, same wooden-sign style) + store/Sweeper-Logo.png rebuilt from it
- GET BONUS painted plank (ui/get_bonus.webp) above the bet box → opens buy menu; locked with round state, hidden on disabledBuyFeature and popout-tiny
- On-screen mute button (#sound-btn, footer center) synced with the menu sound toggle; hidden at popout-tiny (menu still has it)
- Full qa-full sweep after: 0 errors / 0 leaks / 0 overlaps

## iOS Safari fixes (2026-07-02, real-device report)
- **Landscape ("desktop") background on a portrait iPhone**: root cause was `@media (min-aspect-ratio: 1/1)` selecting day_l — iOS Safari evaluates aspect-ratio media queries against the LAYOUT viewport, which disagrees with the VISUAL viewport the JS layout uses. Fix: removed the aspect-ratio queries; backdrop now driven by `body.landscape` toggled in relayout() from `window.innerWidth > window.innerHeight` (pure orientation, same visual-viewport signal as the layout, re-runs on resize/rotate). day_p/day_l + night variants keyed off the class.
- **Light green bar under the game**: body used `height:100%` on a `position:fixed` body → iOS dynamic-toolbar gap showed body bg (#7ba95e). Fix: `height:100vh` fallback + `height:100dvh` (dynamic viewport, tracks the Safari toolbar) + `overscroll-behavior:none`.
- Verified in Playwright **WebKit** (Safari engine), incl. dynamic rotate portrait↔landscape: class + bg follow correctly and bg always covers the viewport. Note: Playwright can't reproduce the iOS toolbar's exact visual/layout split, so on-device confirmation still needed — but the fix is robust by construction (portrait phone → innerWidth<innerHeight → always day_p).
