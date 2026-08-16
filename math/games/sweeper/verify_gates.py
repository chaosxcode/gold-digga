"""Verify all SWEEPER modes against Stake approval gates from the optimized LUTs.
Run: cd math-sdk && source env/bin/activate && python games/sweeper/verify_gates.py
"""
import csv, math, glob, os

PUB = os.path.join(os.path.dirname(__file__), "library", "publish_files")
MODE_CAP = {"base": 15000, "base_xl": 15000, "base_rally": 15000,
            "buy_deepscan": 500, "buy_bigdig": 15000, "buy_nightdig": 15000}
MODE_COST = {"base": 1.0, "base_xl": 1.0, "base_rally": 1.25,
             "buy_deepscan": 5.0, "buy_bigdig": 80.0, "buy_nightdig": 400.0}


def load(mode):
    fn = os.path.join(PUB, f"lookUpTable_{mode}_0.csv")
    if not os.path.exists(fn):
        return None
    rows = []
    with open(fn) as f:
        for r in csv.reader(f):
            if len(r) >= 3:
                try:
                    rows.append((float(r[1]), float(r[2]) / 100.0))
                except ValueError:
                    pass
    return rows


def stats(mode):
    rows = load(mode)
    if not rows:
        return None
    tw = sum(w for w, _ in rows)
    cost = MODE_COST[mode]
    rtp = sum(w * x for w, x in rows) / tw / cost
    mean = sum(w * x for w, x in rows) / tw
    sd = math.sqrt(sum(w * (x - mean) ** 2 for w, x in rows) / tw)
    nz = sum(w for w, x in rows if x > 0)
    cap = MODE_CAP[mode]
    pcap = sum(w for w, x in rows if x >= cap) / tw
    over = max((x for _, x in rows), default=0)
    # win-range gap check up to the cap
    bands = [(30, 100), (100, 300), (300, 1000), (1000, 5000), (5000, 15000)]
    gap = any(lo < cap and sum(w for w, x in rows if lo <= x < hi) == 0 for lo, hi in bands)
    return dict(rtp=rtp, sd=sd, hit=tw / nz if nz else 0, pcap=pcap, over=over, cap=cap, gap=gap)


def tail_scale(cost):
    if cost >= 1000: return 0.2
    if cost >= 500: return 0.5
    if cost >= 200: return 0.8
    return 1.0


def tail_probs(mode):
    rows = load(mode)
    tw = sum(w for w, _ in rows)
    sc = tail_scale(MODE_COST[mode])
    p5 = sum(w for w, x in rows if x >= 5000) / tw * sc
    p10 = sum(w for w, x in rows if x >= 10000) / tw * sc
    return p5, p10


print(f"{'mode':14} {'RTP%':>7} {'std(base)':>10} {'hit':>8} {'maxwin freq':>15} {'cap':>4} {'gap':>4}")
rtps = []
for mode in MODE_CAP:
    s = stats(mode)
    if not s:
        print(f"{mode:14}  (no LUT)")
        continue
    rtps.append(s["rtp"] * 100)
    freq = f"1 in {1/s['pcap']:,.0f}" if s["pcap"] > 0 else "none"
    okrtp = "✓" if 90.0 <= s["rtp"] * 100 <= 96.70 else "✗"
    # std-dev gate applies ONLY to the 1.0x-cost base mode (doc: "Base (1.0x cost)")
    sd_str = f"{s['sd']:6.1f}" + ("✓" if 0.6 <= s["sd"] <= 60 else "✗") if MODE_COST[mode] == 1.0 else f"{s['sd']:6.1f} —"
    okcap = "✓" if s["over"] <= s["cap"] * 1.001 else f"✗{s['over']:.0f}"
    okgap = "✗" if s["gap"] else "✓"
    print(f"{mode:14} {s['rtp']*100:6.2f}{okrtp} {sd_str:>10} 1 in {s['hit']:.2f} {freq:>15} {okcap:>4} {okgap:>4}")

spread = max(rtps) - min(rtps)
print(f"\ncross-mode RTP spread = {spread:.3f}%  (gate <0.5%: {'✓ PASS' if spread < 0.5 else '✗ FAIL'})")

# tail-risk gates (3-star): P(>=5000x) <= 1e-2, P(>=10000x) <= 2e-2 (cost-scaled)
print("\ntail-risk (cost-scaled; 3-star limits P5<=1e-2, P10<=2e-2):")
worst5 = worst10 = 0
for mode in MODE_CAP:
    if not load(mode): continue
    p5, p10 = tail_probs(mode)
    worst5, worst10 = max(worst5, p5), max(worst10, p10)
    print(f"   {mode:14} P(>=5000)={p5:.2e} {'✓' if p5<=1e-2 else '✗'}   P(>=10000)={p10:.2e} {'✓' if p10<=2e-2 else '✗'}")
print(f"   WORST: P5={worst5:.2e} ({'PASS' if worst5<=1e-2 else 'FAIL'})  P10={worst10:.2e} ({'PASS' if worst10<=2e-2 else 'FAIL'})")
