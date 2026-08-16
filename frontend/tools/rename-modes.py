#!/usr/bin/env python3
"""
Rename the published math-package modes to drop the word "buy".

Stake approval (revisions round 1): mode names are visible in the Provably Fairness
modal and "buy" is a restricted term on Stake.us. The dropdown is rendered by Stake
from THIS package's index.json, so it cannot be fixed in the frontend.

This is a RENAME ONLY. It never touches weights, payouts, event structure or RTP:
  * lookUpTable_<mode>_0.csv  — renamed, bytes untouched
  * books_<mode>.jsonl.zst    — one string per book (events[0].mode) rewritten
  * index.json                — name / events / weights fields rewritten

Every book is verified after rewrite: same payoutMultiplier, same event count, and
the ONLY textual difference is the mode string. Run with --verify-only to check a
package without modifying it.

Usage:
  python3 tools/rename-modes.py [--dir <publish_files>] [--apply|--verify-only]
"""
import argparse
import io
import json
import os
import sys

try:
    import zstandard
except ImportError:
    sys.exit("pip install zstandard")

RENAMES = {
    "buy_deepscan": "feature_deepscan",
    "buy_bigdig": "feature_bigdig",
    "buy_nightdig": "feature_nightdig",
}

DEFAULT_DIR = os.path.expanduser(
    "~/Desktop/gold digger/math-sdk/games/sweeper/library/publish_files"
)


def read_lines(path):
    d = zstandard.ZstdDecompressor()
    with open(path, "rb") as fh, d.stream_reader(fh) as r:
        return io.TextIOWrapper(r, encoding="utf-8").read().splitlines()


def write_lines(path, lines):
    c = zstandard.ZstdCompressor(level=10)
    with open(path, "wb") as fh, c.stream_writer(fh) as w:
        w.write(("\n".join(lines) + "\n").encode("utf-8"))


def rewrite_mode(lines, old, new):
    """String-replace the mode token only. Returns (new_lines, stats)."""
    out, hits, bad = [], 0, []
    for i, ln in enumerate(lines):
        n = ln.count('"%s"' % old)
        if n != 1:
            bad.append((i, n))
        out.append(ln.replace('"%s"' % old, '"%s"' % new))
        hits += n
    return out, hits, bad


def verify(before, after, old, new):
    """Prove nothing but the mode string moved."""
    errs = []
    if len(before) != len(after):
        errs.append("book count %d -> %d" % (len(before), len(after)))
        return errs
    for i, (b, a) in enumerate(zip(before, after)):
        # the ONLY allowed textual delta is the mode token
        if b.replace('"%s"' % old, '"%s"' % new) != a:
            errs.append("book %d: unexpected textual change" % i)
            break
        jb, ja = json.loads(b), json.loads(a)
        if jb["payoutMultiplier"] != ja["payoutMultiplier"]:
            errs.append("book %d: payoutMultiplier changed!" % i)
            break
        if len(jb["events"]) != len(ja["events"]):
            errs.append("book %d: event count changed!" % i)
            break
        if ja["events"][0].get("mode") != new:
            errs.append("book %d: mode not renamed" % i)
            break
        if old in a:
            errs.append("book %d: '%s' still present" % (i, old))
            break
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=DEFAULT_DIR)
    ap.add_argument("--verify-only", action="store_true")
    args = ap.parse_args()
    d = args.dir

    idx_path = os.path.join(d, "index.json")
    idx = json.load(open(idx_path))

    if args.verify_only:
        names = [m["name"] for m in idx["modes"]]
        print("modes:", names)
        bad = [n for n in names if "buy" in n.lower()]
        print("FAIL: 'buy' still in", bad) if bad else print("OK: no 'buy' in mode names")
        for m in idx["modes"]:
            for f in (m["events"], m["weights"]):
                ok = os.path.exists(os.path.join(d, f))
                print(("  ok  " if ok else "  MISSING "), f)
                if not ok:
                    return 1
            lines = read_lines(os.path.join(d, m["events"]))
            modes_in = {json.loads(l)["events"][0].get("mode") for l in lines[:200]}
            print("      in-book mode(s):", modes_in, "books:", len(lines))
            if modes_in != {m["name"]}:
                print("      FAIL: in-book mode != index name")
                return 1
        return 0

    total_books = 0
    for old, new in RENAMES.items():
        src = os.path.join(d, "books_%s.jsonl.zst" % old)
        dst = os.path.join(d, "books_%s.jsonl.zst" % new)
        lut_src = os.path.join(d, "lookUpTable_%s_0.csv" % old)
        lut_dst = os.path.join(d, "lookUpTable_%s_0.csv" % new)
        if not os.path.exists(src):
            print("skip (already renamed?):", src)
            continue

        before = read_lines(src)
        after, hits, bad = rewrite_mode(before, old, new)
        if bad:
            print("ABORT: %s — %d book(s) did not contain exactly one mode token: %s"
                  % (old, len(bad), bad[:5]))
            return 1
        errs = verify(before, after, old, new)
        if errs:
            print("ABORT: %s — verification failed: %s" % (old, errs[:5]))
            return 1

        write_lines(dst, after)
        os.remove(src)
        os.rename(lut_src, lut_dst)
        total_books += len(before)
        print("%-16s -> %-18s  books=%-6d mode-strings-rewritten=%d  LUT renamed (bytes untouched)"
              % (old, new, len(before), hits))

    for m in idx["modes"]:
        if m["name"] in RENAMES:
            n = RENAMES[m["name"]]
            m["name"] = n
            m["events"] = "books_%s.jsonl.zst" % n
            m["weights"] = "lookUpTable_%s_0.csv" % n
    with open(idx_path, "w") as fh:
        json.dump(idx, fh, indent=4)
        fh.write("\n")
    print("index.json updated:", [m["name"] for m in idx["modes"]])
    print("TOTAL books rewritten:", total_books, "— payouts/weights/RTP untouched")
    return 0


if __name__ == "__main__":
    sys.exit(main())
