"""Set conditions/parameters for optimization program program"""

from optimization_program.optimization_config import (
    ConstructScaling,
    ConstructParameters,
    ConstructFenceBias,
    ConstructConditions,
    verify_optimization_input,
)


class OptimizationSetup:
    """Handle all game mode optimization parameters."""

    def __init__(self, game_config):
        self.game_config = game_config
        self.game_config.opt_params = {
            "base_standard": {
                "conditions": {
                    # Bonus concentration model fills the 1000-15000x band and
                    # spans both sides of the target → bonus-heavy split converges.
                    # basegame 0.59 + freegame 0.3745 + wincap 0.002 = 0.9665.
                    "wincap": ConstructConditions(rtp=0.002, av_win=15000, search_conditions=15000).return_dict(),
                    "0": ConstructConditions(rtp=0, av_win=0, search_conditions=0).return_dict(),
                    "freegame": ConstructConditions(
                        rtp=0.3745, hr=200, search_conditions={"symbol": "scatter"}
                    ).return_dict(),
                    "basegame": ConstructConditions(hr=3.5, rtp=0.59).return_dict(),
                },
                "scaling": ConstructScaling(
                    [
                        {
                            "criteria": "basegame",
                            "scale_factor": 1.2,
                            "win_range": (1, 2),
                            "probability": 1.0,
                        },
                        {
                            "criteria": "basegame",
                            "scale_factor": 1.5,
                            "win_range": (10, 20),
                            "probability": 1.0,
                        },
                        {
                            "criteria": "freegame",
                            "scale_factor": 0.8,
                            "win_range": (1000, 2000),
                            "probability": 1.0,
                        },
                        {
                            "criteria": "freegame",
                            "scale_factor": 1.2,
                            "win_range": (3000, 4000),
                            "probability": 1.0,
                        },
                    ]
                ).return_dict(),
                "parameters": ConstructParameters(
                    num_show=5000,
                    num_per_fence=10000,
                    min_m2m=4,
                    max_m2m=8,
                    pmb_rtp=1.0,
                    sim_trials=5000,
                    test_spins=[50, 100, 200],
                    test_weights=[0.3, 0.4, 0.3],
                    score_type="rtp",
                    max_trial_dist=15,
                ).return_dict(),
                "distribution_bias": ConstructFenceBias(
                    applied_criteria=["basegame"],
                    bias_ranges=[(3.0, 5.0)],
                    bias_weights=[0.5],
                ).return_dict(),
            },
        }

        # base-style variants (base_xl, base_rally) reuse the base allocation.
        base_scaling = self.game_config.opt_params["base_standard"]["scaling"]
        base_params = self.game_config.opt_params["base_standard"]["parameters"]
        for m in ("base_xl", "base_rally"):
            self.game_config.opt_params[m] = {
                "conditions": {
                    "wincap": ConstructConditions(rtp=0.002, av_win=15000, search_conditions=15000).return_dict(),
                    "0": ConstructConditions(rtp=0, av_win=0, search_conditions=0).return_dict(),
                    "freegame": ConstructConditions(rtp=0.3745, hr=200, search_conditions={"symbol": "scatter"}).return_dict(),
                    "basegame": ConstructConditions(hr=3.5, rtp=0.59).return_dict(),
                },
                "scaling": base_scaling,
                "parameters": base_params,
                "distribution_bias": ConstructFenceBias(
                    applied_criteria=["basegame"], bias_ranges=[(3.0, 5.0)], bias_weights=[0.5],
                ).return_dict(),
            }

        # buy modes: the bought bonus carries essentially all RTP (wincap + freegame).
        buy_specs = {
            "buy_bigdig": (15000.0, 0.002, 0.9645),
            "buy_nightdig": (15000.0, 0.002, 0.9645),
            "buy_deepscan": (500.0, 0.006, 0.9605),
        }
        for m, (cap, wc, fg) in buy_specs.items():
            self.game_config.opt_params[m] = {
                "conditions": {
                    "wincap": ConstructConditions(rtp=wc, av_win=cap, search_conditions=cap).return_dict(),
                    "freegame": ConstructConditions(rtp=fg, hr="x").return_dict(),
                },
                "scaling": ConstructScaling([
                    {"criteria": "freegame", "scale_factor": 1.2,
                     "win_range": (round(cap * 0.2), round(cap * 0.27)), "probability": 1.0},
                ]).return_dict(),
                "parameters": ConstructParameters(
                    num_show=5000, num_per_fence=10000, min_m2m=4, max_m2m=8, pmb_rtp=1.0,
                    sim_trials=5000, test_spins=[10, 20, 50], test_weights=[0.6, 0.2, 0.2],
                    score_type="rtp", max_trial_dist=15,
                ).return_dict(),
                "distribution_bias": ConstructFenceBias(
                    applied_criteria=["freegame"],
                    bias_ranges=[(round(cap * 0.06, 1), round(cap * 0.1, 1))], bias_weights=[0.1],
                ).return_dict(),
            }

        verify_optimization_input(self.game_config, self.game_config.opt_params)
