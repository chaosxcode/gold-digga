"""SWEEPER book events — emit the frontend's exact event vocabulary
(hoardsweeper/src/books.ts) from the SDK's simulation state.

Board is column-major board[reel][row]; the frontend uses a flat 36-tile
row-major array (tile = row*NUM_REELS + reel, tile 0 = top-left).
All book amounts are hundredths of bet (design doc §3.2).
"""

NUM_REELS = 6

# ---- position / board helpers ----------------------------------------------

def tile_of(reel: int, row: int) -> int:
    return row * NUM_REELS + reel


def flat_board(board) -> list:
    n = NUM_REELS * len(board[0])
    flat = [None] * n
    for r, reel in enumerate(board):
        for row, sym in enumerate(reel):
            flat[tile_of(r, row)] = sym.name
    return flat


def positions_to_tiles(positions) -> list:
    return sorted(tile_of(p["reel"], p["row"]) for p in positions)


# ---- win-level ladder (design doc §6) --------------------------------------

def win_level(win_x: float) -> int:
    if win_x < 1:
        return 1
    if win_x < 3:
        return 2
    if win_x < 10:
        return 3
    if win_x < 30:
        return 4
    if win_x < 100:
        return 5
    if win_x < 1000:
        return 6
    return 7


SYMBOL_LABELS = {
    "H1": "Crown", "H2": "Chalice", "H3": "Ring", "H4": "Buckle", "H5": "Penny",
    "L1": "Horseshoe", "L2": "Spoon", "L3": "Bottle Cap", "L4": "Ring Pull",
    "SC": "Hoard Chest",
}


# ---- events -----------------------------------------------------------------

def reveal_event(gs, mode: str, stratum: int = 0):
    """Full buried field (rendered face-down by the client)."""
    board = flat_board(gs.board)
    n = len(board)
    pipe = next((i for i, s in enumerate(board) if s == "PP"), None)
    chests = [i for i, s in enumerate(board) if s == "SC"]
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "reveal",
        "board": board,
        "stratumMap": [stratum] * n,
        "pipeTile": pipe,
        "chestTiles": chests,
        "mode": mode,
    })


def sweep_segment_event(gs, tiles: list, kind: str, beep_step: int = 1, tags=None):
    """Reveal a batch of tiles (flip=1, flood=4-9). Presentation-only."""
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "sweepSegment",
        "tiles": tiles,
        "kind": kind,
        "beepStep": beep_step,
        "tags": tags or [],
        "coilPath": tiles,
    })


def update_signal_meter_event(gs, value: int, delta: int, source: str = "tags"):
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "updateSignalMeter",
        "value": value,
        "delta": delta,
        "source": source,
    })


def deep_scan_event(gs, meter_before: int, meter_after: int):
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "deepScan",
        "meterBefore": meter_before,
        "meterAfter": meter_after,
    })


def win_info_event(gs, win_data, meter: int):
    """Map SDK win_data -> frontend winInfo with per-group WinGroup shape."""
    wins = []
    total = 0
    for w in win_data.get("wins", []):
        tiles = positions_to_tiles(w["positions"])
        base_x = w["meta"]["winWithoutMult"]
        base_pay = int(round(base_x * 100))
        amount = int(round(w["win"] * 100))
        label = SYMBOL_LABELS.get(w["symbol"], w["symbol"])
        eq = f"{len(tiles)}× {label} {base_x:.1f}x × SIGNAL x{meter} = {w['win']:.1f}x"
        wins.append({
            "symbol": w["symbol"],
            "count": len(tiles),
            "tiles": tiles,
            "basePay": base_pay,
            "meter": meter,
            "amount": amount,
            "equation": eq,
        })
        total += amount
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "winInfo",
        "wins": wins,
        "totalWin": total,
    })


def set_win_event(gs, amount_cents: int, win_x: float):
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "setWin",
        "amount": amount_cents,
        "winLevel": win_level(win_x),
    })


def update_grid_event(gs, cleared_tiles, slides, incoming, new_stratum_map, depth):
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "updateGrid",
        "clearedTiles": cleared_tiles,
        "slides": slides,
        "incoming": incoming,
        "newStratumMap": new_stratum_map,
        "depthReached": depth,
    })


def set_total_event(gs, amount_cents: int):
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "setTotalWin",
        "amount": amount_cents,
    })


def sweep_end_event(gs, reason: str = "quiet"):
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "sweepEnd",
        "reason": reason,
    })


def final_win_event(gs, amount_cents: int):
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "finalWin",
        "amount": amount_cents,
    })


# ---- Signal-Meter tags + The Big Dig bonus ---------------------------------

def band_of(value: int) -> int:
    """Design doc §3.3 bands: 2-5 bronze, 6-20 silver, 25-100 red-gold."""
    if value <= 5:
        return 1
    if value <= 20:
        return 2
    return 3


def free_spin_trigger_event(gs, chest_tiles, total_sweeps, scatter_pay_cents, bonus_mode):
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "freeSpinTrigger",
        "chestTiles": chest_tiles,
        "totalSweeps": total_sweeps,
        "scatterPay": scatter_pay_cents,
        "bonusMode": bonus_mode,
    })


def sweep_start_event(gs, sweep, total_sweeps, stratum_map, meter, pipe_tile, refills, board):
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "sweepStart",
        "sweep": sweep,
        "totalSweeps": total_sweeps,
        "stratumMap": stratum_map,
        "meter": meter,
        "pipeTile": pipe_tile,
        "refills": refills,
        "board": board,
    })


def retrigger_event(gs, chest_tiles, added_sweeps, total_sweeps):
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "retrigger",
        "chestTiles": chest_tiles,
        "addedSweeps": added_sweeps,
        "totalSweeps": total_sweeps,
    })


def bonus_summary_event(gs, total_cents, sweeps_played, deepest_stratum, peak_meter, top_find):
    gs.book.add_event({
        "index": len(gs.book.events),
        "type": "bonusSummary",
        "totalWin": total_cents,
        "sweepsPlayed": sweeps_played,
        "deepestStratum": deepest_stratum,
        "peakMeter": peak_meter,
        "topFind": top_find,
    })
