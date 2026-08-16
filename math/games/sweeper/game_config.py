import os
from src.config.config import Config
from src.config.distributions import Distribution
from src.config.betmode import BetMode


class GameConfig(Config):
    """SWEEPER — British metal-detectorist scatter-pays with strata dig-deeper
    and a summed Signal-Meter multiplier. 6x6 pay-anywhere, 8+ matching symbols
    among revealed tiles pay. Bonus = The Big Dig (10-sweep persistent field)."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        super().__init__()
        self.game_id = "sweeper"
        self.game_name = "sweeper"
        self.provider_number = 0
        self.working_name = "Sweeper (scatter-pays, strata dig-deeper)"
        self.wincap = 15000.0
        self.win_type = "scatter"
        self.rtp = 0.9665
        self.construct_paths()

        # 6x6 grid
        self.num_reels = 6
        self.num_rows = [6] * self.num_reels

        # Paytable (design doc §3.2). Tiers: 8-9, 10-11, 12+ matching anywhere.
        t1, t2, t3 = (8, 9), (10, 11), (12, 36)
        pay_group = {
            (t1, "H1"): 10.0, (t2, "H1"): 25.0, (t3, "H1"): 50.0,   # King's Crown
            (t1, "H2"): 4.0,  (t2, "H2"): 10.0, (t3, "H2"): 25.0,   # Silver Chalice
            (t1, "H3"): 2.5,  (t2, "H3"): 6.0,  (t3, "H3"): 15.0,   # Jewelled Ring
            (t1, "H4"): 1.5,  (t2, "H4"): 4.0,  (t3, "H4"): 10.0,   # Golden Buckle
            (t1, "H5"): 1.0,  (t2, "H5"): 2.5,  (t3, "H5"): 7.5,    # Hammered Penny
            (t1, "L1"): 0.8,  (t2, "L1"): 1.8,  (t3, "L1"): 5.0,    # Horseshoe
            (t1, "L2"): 0.6,  (t2, "L2"): 1.5,  (t3, "L2"): 4.0,    # Rusty Spoon
            (t1, "L3"): 0.5,  (t2, "L3"): 1.2,  (t3, "L3"): 3.0,    # Bottle Cap
            (t1, "L4"): 0.4,  (t2, "L4"): 1.0,  (t3, "L4"): 2.5,    # Ring Pull
        }
        self.paytable = self.convert_range_table(pay_group)

        # No reel-spin padding: SWEEPER reveals a static buried 6x6 field, and
        # the frontend expects a flat 36-tile board with no padding rows.
        self.include_padding = False
        # SC = Hoard Chest (scatter trigger). PP = The Pipe (stop tile, pays nothing).
        # The meter multiplier is built from Hot Signal TAG values, modelled as the
        # "multiplier" special-symbol pool applied to evaluations.
        # "wild" required by the scatter calc even though SWEEPER has none.
        self.special_symbols = {"wild": [], "scatter": ["SC"], "stop": ["PP"], "multiplier": ["M"]}

        # 3+ Hoard Chests trigger The Big Dig (always 10 sweeps). 2+ chests inside
        # a sweep retrigger +3. Range spans any chest count possible on 36 tiles.
        self.freespin_triggers = {
            self.basegame_type: {n: 10 for n in range(3, 37)},
            self.freegame_type: {n: 3 for n in range(2, 37)},
        }
        self.anticipation_triggers = {
            self.basegame_type: min(self.freespin_triggers[self.basegame_type].keys()) - 1,
            self.freegame_type: min(self.freespin_triggers[self.freegame_type].keys()) - 1,
        }

        # Stratum reel strips (Topsoil / Georgian / King's Hoard) + wincap strip.
        # BGE/BHD are richer bonus strips (less pipe dilution) so the Big Dig's
        # high meter connects with wins → fills the 100-15000x band.
        reels = {"TOP": "TOP.csv", "GEO": "GEO.csv", "HRD": "HRD.csv", "WCAP": "WCAP.csv",
                 "BGE": "BGE.csv", "BHD": "BHD.csv",
                 "RTOP": "RTOP.csv", "RGEO": "RGEO.csv", "RHRD": "RHRD.csv"}
        self.reels = {}
        for r, f in reels.items():
            self.reels[r] = self.read_reels_csv(os.path.join(self.reels_path, f))
        self.padding_reels[self.basegame_type] = self.reels["TOP"]
        self.padding_reels[self.freegame_type] = self.reels["GEO"]

        # Signal-meter tag values (design doc §3.3) modelled as multiplier pool.
        tag_bands = {2: 60, 3: 45, 4: 35, 5: 25, 6: 18, 8: 14, 10: 10, 15: 6, 20: 4, 25: 3, 50: 2, 100: 1}

        base_reels = {self.basegame_type: {"TOP": 6, "GEO": 3, "HRD": 1},
                      self.freegame_type: {"BGE": 4, "BHD": 3}}
        wcap_reels = {self.basegame_type: {"HRD": 1, "WCAP": 6},
                      self.freegame_type: {"BHD": 1, "WCAP": 8}}

        # NOTE: minimal validation distribution set — no forced wincap/freegame
        # yet (those resample until criteria hit; the wincap strip can't reach
        # 15000x until the meter model is tuned). Reintroduced once the core
        # loop + event vocabulary are verified.
        self.bet_modes = [
            BetMode(
                name="base_standard",
                cost=1.0,
                rtp=self.rtp,
                max_win=self.wincap,
                auto_close_disabled=False,
                is_feature=True,
                is_buybonus=False,
                distributions=[
                    Distribution(
                        criteria="wincap",
                        quota=0.001,
                        win_criteria=self.wincap,
                        conditions={
                            "reel_weights": wcap_reels,
                            "scatter_triggers": {4: 2, 5: 1},
                            "mult_values": {self.basegame_type: tag_bands, self.freegame_type: tag_bands},
                            "force_wincap": True,
                            "force_freegame": True,
                        },
                    ),
                    Distribution(
                        criteria="freegame",
                        quota=0.04,
                        conditions={
                            "reel_weights": base_reels,
                            "scatter_triggers": {3: 8, 4: 3, 5: 1},
                            "mult_values": {self.basegame_type: tag_bands, self.freegame_type: tag_bands},
                            "force_wincap": False,
                            "force_freegame": True,
                        },
                    ),
                    Distribution(
                        criteria="0",
                        quota=0.35,
                        win_criteria=0.0,
                        conditions={
                            "reel_weights": {self.basegame_type: {"TOP": 6, "GEO": 2}},
                            "mult_values": {self.basegame_type: tag_bands, self.freegame_type: tag_bands},
                            "force_wincap": False,
                            "force_freegame": False,
                        },
                    ),
                    Distribution(
                        criteria="basegame",
                        quota=0.61,
                        conditions={
                            "reel_weights": {self.basegame_type: {"TOP": 6, "GEO": 3, "HRD": 1}},
                            "mult_values": {self.basegame_type: tag_bands, self.freegame_type: tag_bands},
                            "force_wincap": False,
                            "force_freegame": False,
                        },
                    ),
                ],
            ),
        ]

        # ---- variant + buy modes ------------------------------------------
        # All reuse the same gamestate; they differ by cost, reel mix, cap, and
        # (for buys) forcing the bonus. Night Dig's tag-doubling + Georgian start
        # and Deep Scan's single capped sweep are handled in gamestate by name.
        def base_style(name, cost, reels_bg, reels_fg, freeq=0.05):
            return BetMode(
                name=name, cost=cost, rtp=self.rtp, max_win=self.wincap,
                auto_close_disabled=False, is_feature=True, is_buybonus=False,
                distributions=[
                    Distribution(criteria="wincap", quota=0.001, win_criteria=self.wincap,
                        conditions={"reel_weights": {self.basegame_type: {"HRD": 1, "WCAP": 6}, self.freegame_type: {"BHD": 1, "WCAP": 8}},
                            "scatter_triggers": {4: 2, 5: 1}, "mult_values": {self.basegame_type: tag_bands, self.freegame_type: tag_bands},
                            "force_wincap": True, "force_freegame": True}),
                    Distribution(criteria="freegame", quota=freeq,
                        conditions={"reel_weights": {self.basegame_type: reels_bg, self.freegame_type: reels_fg},
                            "scatter_triggers": {3: 8, 4: 3, 5: 1}, "mult_values": {self.basegame_type: tag_bands, self.freegame_type: tag_bands},
                            "force_wincap": False, "force_freegame": True}),
                    Distribution(criteria="0", quota=0.34, win_criteria=0.0,
                        conditions={"reel_weights": {self.basegame_type: reels_bg},
                            "mult_values": {self.basegame_type: tag_bands, self.freegame_type: tag_bands},
                            "force_wincap": False, "force_freegame": False}),
                    Distribution(criteria="basegame", quota=1.0 - 0.001 - freeq - 0.34,
                        conditions={"reel_weights": {self.basegame_type: reels_bg},
                            "mult_values": {self.basegame_type: tag_bands, self.freegame_type: tag_bands},
                            "force_wincap": False, "force_freegame": False}),
                ])

        def buy_style(name, cost, cap):
            return BetMode(
                name=name, cost=cost, rtp=self.rtp, max_win=cap,
                auto_close_disabled=False, is_feature=False, is_buybonus=True,
                distributions=[
                    Distribution(criteria="wincap", quota=0.002, win_criteria=cap,
                        conditions={"reel_weights": {self.basegame_type: {"HRD": 1, "WCAP": 6}, self.freegame_type: {"BHD": 1, "WCAP": 8}},
                            "scatter_triggers": {4: 2, 5: 1}, "mult_values": {self.basegame_type: tag_bands, self.freegame_type: tag_bands},
                            "force_wincap": True, "force_freegame": True}),
                    Distribution(criteria="freegame", quota=0.998,
                        conditions={"reel_weights": {self.basegame_type: {"GEO": 4, "HRD": 3}, self.freegame_type: {"BGE": 4, "BHD": 3}},
                            "scatter_triggers": {3: 8, 4: 3, 5: 1}, "mult_values": {self.basegame_type: tag_bands, self.freegame_type: tag_bands},
                            "force_wincap": False, "force_freegame": True}),
                ])

        self.bet_modes += [
            base_style("base_xl", 1.0, {"GEO": 5, "TOP": 2, "HRD": 3}, {"BGE": 3, "BHD": 4}),
            base_style("base_rally", 1.25, {"RTOP": 6, "RGEO": 3, "RHRD": 1}, {"BGE": 4, "BHD": 3}, freeq=0.09),
            buy_style("buy_deepscan", 5.0, 500.0),
            buy_style("buy_bigdig", 80.0, self.wincap),
            buy_style("buy_nightdig", 400.0, self.wincap),
        ]
