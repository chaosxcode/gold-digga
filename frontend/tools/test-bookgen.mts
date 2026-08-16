// Invariant smoke test for the mock book generator.
// Run: node tools/test-bookgen.mts
import { generateBook, BUCKETS } from '../src/mock/bookgen.ts';
import { MODES, rowOf, colOf } from '../src/books.ts';

const modes = Object.keys(BUCKETS) as Array<keyof typeof BUCKETS>;
let failures = 0;
const fail = (msg: string) => { console.error('FAIL:', msg); failures++; };

for (const mode of modes) {
  let totalX = 0;
  const N = 800;
  let pipeBooks = 0, geysers = 0, triggers = 0;
  for (let i = 0; i < N; i++) {
    const book = generateBook(mode, i * 7919 + 13);
    // finalWin === payoutMultiplier
    const fin = book.events.filter((e) => e.type === 'finalWin').pop() as { amount: number } | undefined;
    if (!fin) { fail(`${mode} #${i}: no finalWin`); continue; }
    if (fin.amount !== book.payoutMultiplier) fail(`${mode} #${i}: finalWin ${fin.amount} != pm ${book.payoutMultiplier}`);
    // setTotalWin monotonic
    let last = -1;
    for (const e of book.events) {
      if (e.type === 'setTotalWin') {
        const a = (e as { amount: number }).amount;
        if (a < last) fail(`${mode} #${i}: setTotalWin decreased ${last} -> ${a}`);
        last = a;
      }
    }
    // cap respected
    const capC = MODES[mode].maxWinX * 100;
    if (book.payoutMultiplier > capC) fail(`${mode} #${i}: pm ${book.payoutMultiplier} over cap ${capC}`);
    // reveals-before-pipe ≥ 6 (per spin/sweep), geyser depth rule, flood adjacency
    let reveals = 0;
    for (const e of book.events) {
      if (e.type === 'sweepStart') reveals = 0;
      if (e.type === 'sweepSegment') {
        const seg = e as unknown as { tiles: number[]; kind: string };
        if (seg.kind === 'flood') {
          if (seg.tiles.length < 4 || seg.tiles.length > 9) fail(`${mode} #${i}: flood size ${seg.tiles.length}`);
          // adjacency: each tile after first must touch some earlier tile
          for (let k = 1; k < seg.tiles.length; k++) {
            const t = seg.tiles[k];
            const ok = seg.tiles.slice(0, k).some((u) => (Math.abs(rowOf(u) - rowOf(t)) + Math.abs(colOf(u) - colOf(t))) === 1);
            if (!ok) { fail(`${mode} #${i}: flood not contiguous`); break; }
          }
        }
        reveals += seg.tiles.length;
      }
      if (e.type === 'pipeStrike') {
        pipeBooks++;
        const ps = e as unknown as { gag: string; depthAtStrike: number };
        if (reveals < 6) fail(`${mode} #${i}: pipe after only ${reveals} reveals`);
        if (ps.gag === 'geyser') { geysers++; if (ps.depthAtStrike < 1) fail(`${mode} #${i}: geyser at depth 0`); }
      }
      if (e.type === 'freeSpinTrigger') triggers++;
      // winInfo: amount = basePay*meter and totalWin = sum
      if (e.type === 'winInfo') {
        const wi = e as unknown as { wins: Array<{ basePay: number; meter: number; amount: number }>; totalWin: number };
        let sum = 0;
        for (const w of wi.wins) {
          if (w.amount !== w.basePay * w.meter) fail(`${mode} #${i}: win amount ${w.amount} != ${w.basePay}*${w.meter}`);
          sum += w.amount;
        }
        if (sum !== wi.totalWin) fail(`${mode} #${i}: winInfo total ${wi.totalWin} != sum ${sum}`);
      }
    }
    totalX += Math.min(book.payoutMultiplier, capC) / 100;
  }
  const cost = MODES[mode].cost;
  const rtp = (totalX / N / cost) * 100;
  console.log(`${mode}: pseudo-RTP ${rtp.toFixed(1)}% | pipes ${pipeBooks} | geysers ${geysers} | triggers ${triggers}`);
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL INVARIANTS PASS');
process.exit(failures ? 1 : 0);
