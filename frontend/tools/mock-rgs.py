#!/usr/bin/env python3
"""
Mock Stake Engine RGS for LOCAL TESTING.

Serves the REAL published books (library/publish_files/*.jsonl.zst) via the same
wire contract the frontend bridge (stake-engine-bridge.js) speaks — so the demo
plays byte-identical to Stake, with no mock-math drift.

Endpoints:
  POST /wallet/authenticate      -> balance + config (bet levels, jurisdiction)
  POST /wallet/play {amount,mode}-> weighted-random REAL book for that mode
  POST /wallet/end-round         -> credits the round's win
  POST /wallet/balance           -> current balance
  POST /bet/event                -> ack (mid-round checkpoint)
  GET  /bet/replay/<game>/<ver>/<mode>/<eventId> -> book by id (replay feature)
  GET  /force?mode=feature_bigdig&min=15000 -> pin the NEXT play to a book >= min x

Books are decompressed to a temp .jsonl once per mode (lazily) and indexed by
byte offset, so memory stays tiny and each play is a single seek+read.

Usage: python3 mock-rgs.py [--port 8787] [--books <publish_files dir>]
"""
import argparse
import bisect
import json
import os
import random
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import zstandard
except ImportError:
    sys.exit("pip install zstandard  (needed to read the .zst books)")

MODE_COST = {
    "base_standard": 1.0, "base_xl": 1.0, "base_rally": 1.25,
    "feature_deepscan": 5.0, "feature_bigdig": 80.0, "feature_nightdig": 400.0,
}
CURRENCY = "USD"
START_BALANCE = 100_000.0                       # display units
BET_LEVELS = [0.20, 0.40, 1.00, 2.00, 5.00, 10.00, 20.00, 50.00, 100.00]
DEFAULT_BET = 1.00
MICRO = 1_000_000

BOOKS_DIR = ""
TMP = os.path.join(tempfile.gettempdir(), "sweeper-mock-rgs")
os.makedirs(TMP, exist_ok=True)

_prepped = {}                 # mode -> {path, offsets, cums, ids, payouts, total}
_sessions = {}                # sessionID -> {balance_micro, round}
_force_next = {}              # mode -> book_id
_active_round = None          # test-only: an interrupted round for /wallet/authenticate


def prep_mode(mode):
    if mode in _prepped:
        return _prepped[mode]
    src = os.path.join(BOOKS_DIR, f"books_{mode}.jsonl.zst")
    lut = os.path.join(BOOKS_DIR, f"lookUpTable_{mode}_0.csv")
    if not os.path.exists(src):
        raise FileNotFoundError(src)
    dst = os.path.join(TMP, f"books_{mode}.jsonl")
    if not os.path.exists(dst) or os.path.getsize(dst) == 0:
        sys.stderr.write(f"[rgs] decompressing {mode} (first play, one-time)...\n")
        with open(src, "rb") as f, open(dst, "wb") as out:
            zstandard.ZstdDecompressor().copy_stream(f, out)
    # byte offset of each line == book id (books are stored in id order)
    offsets = []
    with open(dst, "rb") as f:
        pos = 0
        for line in f:
            offsets.append(pos)
            pos += len(line)
    # weighted lookup table: id,weight,payoutMultiplier(hundredths)
    cums, ids, payouts, total = [], [], [], 0
    with open(lut) as f:
        for row in f:
            row = row.strip()
            if not row:
                continue
            bid, w, pay = row.split(",")[:3]
            total += int(w)
            cums.append(total)
            ids.append(int(bid))
            payouts.append(int(pay))
    _prepped[mode] = {"path": dst, "offsets": offsets, "cums": cums,
                      "ids": ids, "payouts": payouts, "total": total}
    sys.stderr.write(f"[rgs] {mode} ready: {len(offsets)} books, {len(ids)} lut rows\n")
    return _prepped[mode]


def read_book(mode, book_id):
    p = _prepped[mode]
    with open(p["path"], "rb") as f:
        f.seek(p["offsets"][book_id])
        return json.loads(f.readline())


def pick_book(mode):
    p = prep_mode(mode)
    if mode in _force_next:
        bid = _force_next.pop(mode)
    else:
        r = random.randint(1, p["total"])
        bid = p["ids"][bisect.bisect_left(p["cums"], r)]
    return read_book(mode, bid)


def session(sid):
    return _sessions.setdefault(sid, {"balance_micro": int(START_BALANCE * MICRO), "round": None})


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send({})

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/force":
            from urllib.parse import parse_qs, urlparse
            q = parse_qs(urlparse(self.path).query)
            mode = q.get("mode", ["feature_bigdig"])[0].lower()
            minx = float(q.get("min", ["15000"])[0])
            p = prep_mode(mode)
            if "id" in q:  # test-only: pin an exact book id
                bid = int(q["id"][0])
                if bid < 0 or bid >= len(p["offsets"]):
                    return self._send({"error": "no book id %d" % bid}, 404)
                _force_next[mode] = bid
                return self._send({"forced": {"mode": mode, "bookId": bid}})
            want = int(minx * 100)
            hit = next((p["ids"][i] for i, pay in enumerate(p["payouts"]) if pay >= want), None)
            if hit is None:
                return self._send({"error": "no book >= %sx" % minx}, 404)
            _force_next[mode] = hit
            return self._send({"forced": {"mode": mode, "bookId": hit, "minX": minx}})
        if path == "/force-round":
            # test-only: make the NEXT /wallet/authenticate return an ACTIVE round,
            # so the client's "restore the interrupted round's bet level" path runs.
            from urllib.parse import parse_qs, urlparse
            global _active_round
            q = parse_qs(urlparse(self.path).query)
            if "clear" in q:
                _active_round = None
                return self._send({"activeRound": None})
            amount = float(q.get("amount", ["1"])[0])
            mode = q.get("mode", ["base_standard"])[0].lower()
            p = prep_mode(mode)
            book = read_book(mode, p["ids"][0])
            _active_round = {
                "active": True,
                "mode": mode.upper(),
                "amount": int(amount * MICRO),
                "payout": int(amount * book["payoutMultiplier"] / 100 * MICRO),
                "payoutMultiplier": book["payoutMultiplier"] / 100,
                "state": {"events": book["events"]},
            }
            return self._send({"activeRound": {"amount": amount, "mode": mode}})
        # /bet/replay/<game>/<version>/<mode>/<eventId>
        parts = path.strip("/").split("/")
        if len(parts) in (5, 6) and parts[0] == "bet" and parts[1] == "replay":
            # 6 parts = the real bridge URL (/bet/replay/<game>/<version>/<mode>/<id>);
            # 5 parts = the old version-less form, kept for hand-typed QA URLs
            mode, event_id = parts[-2].lower(), parts[-1]
            try:
                prep_mode(mode)
                book = read_book(mode, int(event_id))
            except Exception as e:
                return self._send({"error": str(e)}, 404)
            wire = book.get("payoutMultiplier", 0) / 100.0
            return self._send({"state": {"events": book["events"]},
                               "payoutMultiplier": wire, "mode": mode,
                               "amount": int(DEFAULT_BET * MICRO), "currency": CURRENCY})
        self._send({"error": "not found"}, 404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            body = {}
        sid = body.get("sessionID", "anon")
        s = session(sid)
        path = self.path.split("?")[0]

        if path == "/wallet/authenticate":
            return self._send({
                "balance": {"amount": s["balance_micro"], "currency": CURRENCY},
                "config": {
                    "minBet": int(BET_LEVELS[0] * MICRO), "maxBet": int(BET_LEVELS[-1] * MICRO),
                    "stepBet": int(BET_LEVELS[0] * MICRO),
                    "defaultBetLevel": int(DEFAULT_BET * MICRO),
                    "betLevels": [int(b * MICRO) for b in BET_LEVELS],
                    "jurisdiction": {"socialCasino": False, "displayRTP": True,
                                     "displaySessionTimer": True},
                },
                "round": _active_round,
            })

        if path in ("/wallet/play", "/play"):
            mode = str(body.get("mode", "BASE_STANDARD")).lower()
            bet_micro = int(body.get("amount", int(DEFAULT_BET * MICRO)))
            cost_micro = int(round(bet_micro * MODE_COST.get(mode, 1.0)))
            if cost_micro > s["balance_micro"]:
                return self._send({"error": "INSUFFICIENT_FUNDS", "message": "Balance too low"}, 402)
            s["balance_micro"] -= cost_micro
            try:
                book = pick_book(mode)
            except Exception as e:
                return self._send({"error": "BOOK", "message": str(e)}, 500)
            wire = book.get("payoutMultiplier", 0) / 100.0
            win_micro = int(round(wire * bet_micro))
            s["round"] = {"mode": mode, "win_micro": win_micro}
            return self._send({
                "balance": {"amount": s["balance_micro"], "currency": CURRENCY},
                "round": {"active": True, "mode": mode.upper(), "amount": cost_micro,
                          "payout": win_micro, "payoutMultiplier": wire,
                          "state": {"events": book["events"]}},
            })

        if path == "/wallet/end-round":
            r = s.get("round")
            if r:
                s["balance_micro"] += r["win_micro"]
                s["round"] = None
            return self._send({"balance": {"amount": s["balance_micro"], "currency": CURRENCY}})

        if path == "/wallet/balance":
            return self._send({"balance": {"amount": s["balance_micro"], "currency": CURRENCY}})

        if path == "/bet/event":
            return self._send({"event": body.get("event", "")})

        self._send({"error": "not found"}, 404)


def main():
    global BOOKS_DIR
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--books", default=os.path.expanduser(
        "~/Desktop/gold digger/math-sdk/games/sweeper/library/publish_files"))
    args = ap.parse_args()
    BOOKS_DIR = args.books
    if not os.path.isdir(BOOKS_DIR):
        sys.exit(f"books dir not found: {BOOKS_DIR}")
    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    sys.stderr.write(f"[rgs] mock RGS on :{args.port}  books={BOOKS_DIR}\n")
    srv.serve_forever()


if __name__ == "__main__":
    main()
