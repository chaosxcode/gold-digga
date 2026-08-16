import random
from game_override import GameStateOverride
from src.calculations.scatter import Scatter
import game_events as ev


STRATUM_STRIPS = ["TOP", "GEO", "HRD"]  # depth 0/1/2 refill strips
# per-tile tag chance by stratum. Base is sparse so most spins keep meter x1 and
# junk wins stay tiny; the bonus is where the meter builds into big multipliers.
BASE_TAG_DENSITY = [0.010, 0.020, 0.035]
BONUS_TAG_DENSITY = [0.06, 0.10, 0.16]
SCATTER_PAY = {3: 200, 4: 500, 5: 1000}  # chest pay in cents (design doc §3.2)


class GameState(GameStateOverride):
    """SWEEPER — 6x6 scatter-pays with a summed Signal-Meter multiplier and a
    strata dig-deeper cascade. Bonus = The Big Dig (persistent-field sweeps)."""

    # ---- helpers ------------------------------------------------------------

    def _weighted_pick(self, wdict):
        items = list(wdict.items())
        total = sum(w for _, w in items)
        r = random.random() * total
        acc = 0.0
        for v, w in items:
            acc += w
            if r <= acc:
                return v
        return items[-1][0]

    def _tag_bands(self):
        conds = self.get_current_distribution_conditions()
        return conds.get("mult_values", {}).get(self.gametype, {})

    def _pick_strip(self, stratum):
        """Strip to refill from: honour the distribution's reel_weights (so the
        wincap bucket's rich strip reaches the bonus), else the stratum strip."""
        rw = self.get_current_distribution_conditions().get("reel_weights", {}).get(self.gametype, {})
        if rw:
            return self._weighted_pick(rw)
        return STRATUM_STRIPS[min(stratum, 2)]

    def _roll_tags(self, tiles, stratum):
        """Surface Hot-Signal tags on revealed tiles; sum into the meter. Night
        Dig doubles tag values (design doc §4.6)."""
        bands = self._tag_bands()
        if not bands:
            return []
        table = BONUS_TAG_DENSITY if self.gametype == self.config.freegame_type else BASE_TAG_DENSITY
        density = table[min(stratum, 2)]
        drops = []
        for t in tiles:
            if random.random() < density:
                val = int(self._weighted_pick(bands))
                if getattr(self, "night_dig", False):
                    val *= 2
                drops.append({"tile": t, "value": val, "band": ev.band_of(val)})
        if drops:
            self.meter = max(1, int(round(self.meter + sum(d["value"] for d in drops))))
            self.peak_meter = max(self.peak_meter, self.meter)
        return drops

    def _tiles_all(self):
        return list(range(self.config.num_reels * len(self.board[0])))

    def _dig_deeper(self, depth):
        """Clear exploded tiles, refill in place from the next stratum's strip."""
        strip = self.config.reels[self._pick_strip(depth)]
        cleared, incoming = [], []
        for reel in range(self.config.num_reels):
            for row in range(len(self.board[reel])):
                if getattr(self.board[reel][row], "explode", False):
                    tile = ev.tile_of(reel, row)
                    cleared.append(tile)
                    name = strip[random.randrange(len(strip))][reel]
                    self.board[reel][row] = self.create_symbol(name)
                    incoming.append({"tile": tile, "symbol": name, "stratum": min(depth, 2)})
        cleared.sort()
        incoming.sort(key=lambda x: x["tile"])
        return cleared, incoming

    def _draw_field_from(self, strip_key):
        """Redraw the whole board from a strip, biasing a fraction of tiles toward
        the bonus's dominant high symbol (concentration) so 8+ clusters form and
        the meter has something big to multiply. Concentration+dominant are rolled
        once per bonus (run_freespin) → per-bonus win-magnitude spread."""
        strip = self.config.reels[strip_key]
        pos = random.randrange(len(strip))
        conc = getattr(self, "_bonus_conc", 0.0)
        dom = getattr(self, "_bonus_dom", "H3")
        for reel in range(self.config.num_reels):
            for row in range(len(self.board[reel])):
                if conc and random.random() < conc:
                    name = dom
                else:
                    name = strip[(pos + row) % len(strip)][reel]
                self.board[reel][row] = self.create_symbol(name)

    def _record_top_find(self):
        for w in self.win_data.get("wins", []):
            amt = int(round(w["win"] * 100))
            if amt > self.top_find["amount"]:
                self.top_find = {"symbol": w["symbol"], "amount": amt}

    def _evaluate_and_dig(self, start_depth, chest_tiles):
        """Evaluate current field, then dig-deeper tumble until quiet/capped.
        Meter-multiplies every evaluation. Returns cumulative-cents added."""
        depth = start_depth
        added = 0
        self.global_multiplier = self.meter
        self.get_scatterpays_update_wins()
        while self.win_data.get("totalWin", 0) > 0 and not self.wincap_triggered:
            eval_win = self.win_data["totalWin"]
            added += int(round(eval_win * 100))
            ev.win_info_event(self, self.win_data, self.meter)
            ev.set_win_event(self, int(round(eval_win * 100)), eval_win)
            self._record_top_find()
            self._running_total += int(round(eval_win * 100))
            ev.set_total_event(self, self._running_total)

            cleared, incoming = self._dig_deeper(depth)
            depth = min(depth + 1, 2)
            self.deepest_stratum = max(self.deepest_stratum, depth)
            new_tags = self._roll_tags([c["tile"] for c in incoming], depth)
            if new_tags:
                ev.update_signal_meter_event(self, self.meter, sum(t["value"] for t in new_tags))
            ev.update_grid_event(self, cleared, [], incoming,
                                 [depth] * len(self._tiles_all()), depth)

            self.global_multiplier = self.meter
            self.get_scatterpays_update_wins()
        return added

    # ---- base spin ----------------------------------------------------------

    def run_spin(self, sim: int, simulation_seed=None):
        self.reset_seed(sim)
        self.repeat = True
        while self.repeat:
            self.reset_book()
            self.meter = 1
            self.peak_meter = 1
            self.deepest_stratum = 0
            self.top_find = {"symbol": "L4", "amount": 0}
            self._running_total = 0
            self.night_dig = self.betmode == "buy_nightdig"
            self._deepscan = self.betmode == "buy_deepscan"

            self.draw_board(emit_event=False)
            board = ev.flat_board(self.board)
            chest_tiles = [i for i, s in enumerate(board) if s == "SC"]

            ev.reveal_event(self, mode=self.betmode, stratum=0)
            tags = self._roll_tags(self._tiles_all(), 0)
            ev.sweep_segment_event(self, self._tiles_all(), "flood", beep_step=2 if tags else 1, tags=tags)
            if tags:
                ev.update_signal_meter_event(self, self.meter, sum(t["value"] for t in tags))

            self._evaluate_and_dig(0, chest_tiles)
            ev.sweep_end_event(self, "quiet")

            triggered = len(chest_tiles) >= 3 and self.check_freespin_entry()
            if triggered:
                self._trigger_chests = chest_tiles
                scatter_pay = SCATTER_PAY.get(min(len(chest_tiles), 5), 1000)
                self._running_total += scatter_pay
                self.win_manager.update_spinwin(scatter_pay / 100.0)
                self.record({"kind": len(chest_tiles), "symbol": "scatter",
                             "gametype": self.config.basegame_type})
                ev.free_spin_trigger_event(self, chest_tiles, 10, scatter_pay,
                                           "nightdig" if self.night_dig else "bigdig")
                ev.set_total_event(self, self._running_total)

            # move base wins (incl. scatter pay) to the base bucket exactly once
            self.win_manager.update_gametype_wins(self.config.basegame_type)
            self.win_manager.reset_spin_win()

            if triggered:
                self.update_freespin_amount()  # tot_fs = 10
                self.run_freespin()

            self.evaluate_finalwin()
            # enforce the PER-MODE cap (SDK's clamp only uses the global wincap);
            # Deep Scan Sweep is capped at 500x, not 15000x.
            cap = float(self.get_current_betmode()._wincap)
            if self.final_win > cap:
                self.final_win = cap
                self.book.payout_multiplier = cap
            ev.final_win_event(self, int(round(self.final_win * 100)))
            self.check_repeat()

        self.imprint_wins()

    # ---- The Big Dig bonus --------------------------------------------------

    def end_freespin(self):
        """SWEEPER emits its own bonusSummary; suppress the SDK's freeSpinEnd
        event (not in the frontend vocabulary)."""
        pass

    def run_freespin(self):
        self.reset_fs_spin()
        self.gametype = self.config.freegame_type
        # Per-bonus concentration tier + which high symbol dominates → the win
        # spread. Low tiers stay junky (small), high tiers cluster a high symbol
        # 8+ so the meter multiplies it into the 1000-15000x band.
        self._bonus_conc = self._weighted_pick(
            {0.0: 40, 0.12: 22, 0.20: 16, 0.30: 12, 0.40: 7, 0.52: 2.4, 0.66: 0.6}
        )
        self._bonus_dom = self._weighted_pick({"H1": 1, "H2": 2, "H3": 4, "H4": 5, "H5": 6})
        # Night Dig / Deep Scan start in the Georgian stratum (design §4.6/§4.7).
        start = 1 if (self.night_dig or getattr(self, "_deepscan", False)) else 0
        while self.fs < self.tot_fs:
            self.fs += 1
            stratum = min(start + (self.fs - 1) // 3, 2)  # deepen every ~3 sweeps
            self._draw_field_from(self._pick_strip(stratum))
            board = ev.flat_board(self.board)
            pipe = next((i for i, s in enumerate(board) if s == "PP"), None)
            refills = [{"tile": i, "symbol": s, "stratum": stratum} for i, s in enumerate(board)]
            ev.sweep_start_event(self, self.fs, self.tot_fs, [stratum] * len(board),
                                 self.meter, pipe, refills, board)

            tags = self._roll_tags(self._tiles_all(), stratum)
            if tags:
                ev.update_signal_meter_event(self, self.meter, sum(t["value"] for t in tags))

            # Deep Scan Sweep: guaranteed coil-slam that doubles the meter (§4.7)
            if getattr(self, "_deepscan", False):
                before = self.meter
                self.meter = max(1, self.meter * 2)
                self.peak_meter = max(self.peak_meter, self.meter)
                ev.deep_scan_event(self, before, self.meter)

            self._evaluate_and_dig(stratum, [])

            # retrigger: 3+ chests in the sweep field award +3 sweeps, hard-capped
            # at 22 total so a chest-rich field can't loop forever.
            chests = [i for i, s in enumerate(board) if s == "SC"]
            if len(chests) >= 3 and self.tot_fs < 22:
                self.tot_fs += 3
                ev.retrigger_event(self, chests, 3, self.tot_fs)

        # move all bonus wins to the freegame bucket exactly once
        self.win_manager.update_gametype_wins(self.config.freegame_type)
        self.win_manager.reset_spin_win()
        ev.bonus_summary_event(self, self._running_total, self.fs, self.deepest_stratum,
                               self.peak_meter, self.top_find)
        self.end_freespin()
