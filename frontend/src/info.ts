/**
 * Info / paytable modal content (design doc §13). Natural English; every
 * string passes through the social sweep after render. Pays are rendered
 * dynamically in the current bet's currency so the table always matches.
 */
import { MODES, PAYTABLE, SYMBOL_NAMES, SymbolId, TAG_BANDS } from './books';
import { moneyBal } from './currency';
import { sweepDom } from './social';

const PAGES: Array<{ id: string; title: string }> = [
  { id: 'how', title: 'Play' },
  { id: 'pays', title: 'Pays' },
  // Stake approval: the info must show an example of a WINNING and a LOSING
  // combination (they raised this on a sibling game's review).
  { id: 'examples', title: 'Examples' },
  { id: 'signals', title: 'Signal' },
  { id: 'bigdig', title: 'Big Dig' },
  { id: 'modes', title: 'Bonuses' },
  { id: 'rtp', title: 'RTP' },
  { id: 'ui', title: 'Controls' },
  { id: 'legal', title: 'Legal' },
];

function payRows(bet: number): string {
  const order: SymbolId[] = ['H1', 'H2', 'H3', 'H4', 'H5', 'L1', 'L2', 'L3', 'L4'];
  return order
    .map((s) => {
      const [a, b, c] = PAYTABLE[s as keyof typeof PAYTABLE];
      const f = (cents: number) => moneyBal((cents / 100) * bet);
      return `<tr><td><img class="pay-sym" src="assets/symbols/${s}.webp" alt=""> ${SYMBOL_NAMES[s]}</td><td>8–9: ${f(a)}</td><td>10–11: ${f(b)}</td><td>12+: ${f(c)}</td></tr>`;
    })
    .join('');
}

export function renderInfo(bet: number): void {
  const tabs = document.getElementById('info-tabs')!;
  const body = document.getElementById('info-body')!;
  tabs.innerHTML = PAGES.map(
    (p, i) => `<button class="info-tab${i === 0 ? ' active' : ''}" data-page="${p.id}">${p.title}</button>`,
  ).join('');

  body.innerHTML = `
  <div class="info-page active" data-page="how">
    <h3>Dig for Gold</h3>
    <p>Toxic wasteland. Buried gold. Sweep a fresh 6×6 field — blips flip one tile, strong signals flood a whole patch.</p>
    <h3>Wins</h3>
    <p><b>8+ matching symbols anywhere pay.</b> Scored after every signal flood.</p>
    <h3>Dig Deeper</h3>
    <p>Each win clears its tiles and digs one layer down — Topsoil, Toxic, Motherlode. Deeper = richer, more tags.</p>
    <h3>The Ooze</h3>
    <p>Strike a toxic ooze pocket and the sweep ends — pays nothing. Quiet signals end it too.</p>
    <h3>Retrigger</h3>
    <p>In a bonus dig, a fresh field revealing 3+ Loot Chests awards +3 sweeps (22 sweeps max).</p>
  </div>
  <div class="info-page" data-page="pays">
    <h3>Symbol Pays (play ${moneyBal(bet)})</h3>
    <table><tr><th>Symbol</th><th colspan="3">Count → Win</th></tr>${payRows(bet)}</table>
    <h3>Loot Chest (Scatter)</h3>
    <p><img class="pay-sym" src="assets/symbols/SC.webp" alt=""> 3 = trigger + ${moneyBal(2 * bet)} · 4 = + ${moneyBal(5 * bet)} · 5+ = + ${moneyBal(10 * bet)}</p>
    <h3>Toxic Ooze</h3>
    <p><img class="pay-sym" src="assets/symbols/PP.webp" alt=""> Pays nothing — ends the sweep.</p>
  </div>
  <div class="info-page" data-page="signals">
    <h3>Signal Tags</h3>
    <p>Tags surface on tiles and add into the Signal Meter.</p>
    <table>
      <tr><th>Band</th><th>Values</th></tr>
      <tr><td>Bronze</td><td>${TAG_BANDS[1].map((v) => `x${v}`).join(' · ')}</td></tr>
      <tr><td>Silver</td><td>${TAG_BANDS[2].map((v) => `x${v}`).join(' · ')}</td></tr>
      <tr><td>Red-gold</td><td>${TAG_BANDS[3].map((v) => `x${v}`).join(' · ')}</td></tr>
    </table>
    <p>Night Dig doubles every tag.</p>
    <h3>Signal Meter</h3>
    <p>Starts at x1, and <b>every surfaced tag ADDS its value</b> — x1 plus an x2 tag reads SIGNAL x3. <b>Every win multiplies through it.</b> Carries across layers and all Big Dig sweeps; resets each round.</p>
    <p>Fresh ground can carry Signal too: tiles dug up by DIG DEEPER, and each new Big Dig field, may surface extra tags the moment they land — the game flashes <i>FRESH DIRT — SIGNAL +N</i> as the meter climbs.</p>
    <h3>Deep Scan</h3>
    <p><b>Deep Scan bonus only:</b> a guaranteed random hit each sweep — the meter doubles.</p>
    <h3>Reading a win</h3>
    <p><i>12× Skull 25.0x × SIGNAL x27 = 675.0x</i></p>
  </div>
  <div class="info-page" data-page="examples">
    <h3>A winning sweep</h3>
    <p><img class="pay-sym" src="assets/symbols/H2.webp" alt=""> <b>8 or more of the same symbol</b> anywhere on the field pay — they do not need to touch.</p>
    <p class="ex-good"><b>WIN.</b> 9× Gold Skull surfaced → 9 is 8 or more, so it pays. 9× Gold Skull ${(PAYTABLE.H2[0] / 100).toFixed(1)}x × SIGNAL x4 (x1 + an x3 tag) = ${((PAYTABLE.H2[0] / 100) * 4).toFixed(1)}x your play.</p>
    <h3>A losing sweep</h3>
    <p class="ex-bad"><b>NO WIN.</b> 7× Gold Skull surfaced → 7 is under 8, so it pays nothing, no matter how high the Signal Meter is.</p>
    <p class="ex-bad"><b>NO WIN.</b> The sweep hits a <img class="pay-sym" src="assets/symbols/PP.webp" alt=""> <b>Toxic Ooze</b> pocket → the sweep ends there and pays nothing.</p>
    <p class="ex-bad"><b>NO WIN.</b> The signal goes quiet before 8 of anything surfaces → the sweep ends and pays nothing.</p>
    <p>Counts are per symbol — 5× Diamond and 5× Coin Stack is still no win. Only 8+ of the <i>same</i> symbol pays.</p>
  </div>
  <div class="info-page" data-page="bigdig">
    <h3>The Big Dig</h3>
    <p>3+ Loot Chests trigger it. <b>10 sweeps, fresh field each</b> — depth and Signal carry all ten.</p>
    <p>The Signal Meter keeps the base-game rule (each tag ADDS its value) and never resets between sweeps. Every fresh field can surface new tags as it lands — <i>FRESH DIRT — SIGNAL +N</i> — so the meter can climb at the start of a sweep.</p>
    <p>Ooze ends only its own sweep, never the bonus. A fresh field revealing 3+ chests = +3 sweeps (22 max). Pays once at the end.</p>
    <h3>Night Dig</h3>
    <p>Premium dig: Toxic start, all tags doubled, no ooze for 3 sweeps.</p>
  </div>
  <div class="info-page" data-page="modes">
    <h3>Coil Select</h3>
    <p><b>Standard 9″</b> — steady, shallow finds. <b>XL Deep 15″</b> — rarer, deeper, richer. Both 96.65%.</p>
    <h3>Rally (+25%)</h3>
    <p>Costs 25% more for double Loot Chests. Standard coil only.</p>
    <h3>Get Bonus</h3>
    <table>
      <tr><th>Bonus</th><th>Cost</th><th>Max win</th></tr>
      <tr><td>Deep Scan Sweep</td><td>5x</td><td><b>500x</b></td></tr>
      <tr><td>The Big Dig</td><td>80x</td><td>15,000x</td></tr>
      <tr><td>Night Dig</td><td>400x</td><td>15,000x</td></tr>
    </table>
    <p>Each bonus is fixed — Coil Select doesn't apply.</p>
  </div>
  <div class="info-page" data-page="rtp">
    <h3>Return to Player</h3>
    <table>
      <tr><th>Mode</th><th>Cost</th><th>RTP</th><th>Max win</th></tr>
      ${Object.values(MODES)
        .map(
          (m) =>
            `<tr><td>${m.label}</td><td>${m.cost}x</td><td>${m.rtp}%</td><td>${m.maxWinX.toLocaleString('en-US')}x</td></tr>`,
        )
        .join('')}
    </table>
    <p>Wins cap at each mode's ceiling; the round ends there. Return is calculated over many plays.</p>
  </div>
  <div class="info-page" data-page="ui">
    <h3>Controls</h3>
    <table class="ctl-table">
      <tr><td><img class="ctl-ico" src="assets/ui/btn_spin.webp" alt=""></td><td><b>Spin</b> — start a round, or hold Spacebar. While Autoplay runs, this stops it.</td></tr>
      <tr><td><img class="ctl-ico" src="assets/ui/btn_minus.webp" alt=""><img class="ctl-ico" src="assets/ui/btn_plus.webp" alt=""></td><td><b>Minus / Plus</b> — lower or raise your play amount.</td></tr>
      <tr><td><img class="ctl-ico" src="assets/ui/get_bonus.webp" alt=""></td><td><b>Get Bonus</b> — open the bonus menu (Deep Scan Sweep, The Big Dig, Night Dig).</td></tr>
      <tr><td><span class="ctl-ico ctl-burger"><span></span><span></span><span></span></span></td><td><b>Menu</b> — opens everything below.</td></tr>
      <tr><td><img class="ctl-ico" src="assets/ui/btn_turbo.webp" alt=""></td><td><b>Turbo</b> — faster sweeps while lit.</td></tr>
      <tr><td><img class="ctl-ico" src="assets/ui/btn_autoplay.webp" alt=""></td><td><b>Autoplay</b> — choose a number of automatic rounds; you confirm before they run. Stop it any time with Spin.</td></tr>
      <tr><td><img class="ctl-ico" src="assets/ui/btn_mute.webp" alt=""></td><td><b>Sound</b> — mute or unmute the audio.</td></tr>
      <tr><td><img class="ctl-ico" src="assets/ui/btn_settings.webp" alt=""></td><td><b>Game Info</b> — these rules and the full pay table.</td></tr>
      <tr><td><img class="ctl-ico" src="assets/ui/meter.webp" alt=""></td><td><b>Signal Meter</b> — the live multiplier. Every win multiplies through it.</td></tr>
    </table>
    <h3>Interrupted rounds</h3>
    <p>Disconnect? Reopen to Watch the round or Skip to the result.</p>
  </div>
  <div class="info-page" data-page="legal">
    <p class="legal" data-no-swap>Malfunction voids all wins and plays. A consistent internet connection is required. In the event of a disconnection, reload the game to finish any uncompleted rounds. The expected return is calculated over many plays. The game display is not representative of any physical device and is for illustrative purposes only. Winnings are settled according to the amount received from the Remote Game Server and not from events within the web browser. TM and © 2026 Stake Engine.</p>
  </div>`;

  tabs.querySelectorAll<HTMLButtonElement>('.info-tab').forEach((b) => {
    b.onclick = () => {
      tabs.querySelectorAll('.info-tab').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      body.querySelectorAll('.info-page').forEach((p) => p.classList.remove('active'));
      body.querySelector(`.info-page[data-page="${b.dataset.page}"]`)?.classList.add('active');
      sweepDom(body);
    };
  });
  sweepDom(document.getElementById('m-info')!);
}
