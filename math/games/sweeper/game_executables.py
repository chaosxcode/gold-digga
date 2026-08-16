"""

"""

from copy import copy

from game_calculations import GameCalculations
from src.calculations.scatter import Scatter
from src.events.events import (
    fs_trigger_event,
    update_global_mult_event,
    update_freespin_event,
)


class GameExecutables(GameCalculations):
    """Game specific executable functions. Used for grouping commonly used/repeated applications."""

    def update_freespin_amount(self, scatter_key: str = "scatter"):
        """The Big Dig is 10 sweeps; Deep Scan Sweep is a single sweep (§4.5/§4.7)."""
        self.tot_fs = 1 if getattr(self, "_deepscan", False) else 10

    def get_scatterpays_update_wins(self):
        """Return the board since we are assigning the 'explode' attribute."""
        self.win_data = Scatter.get_scatterpay_wins(
            self.config, self.board, global_multiplier=self.global_multiplier
        )  # Evaluate wins, self.board is modified in-place
        Scatter.record_scatter_wins(self)
        self.win_manager.tumble_win = self.win_data["totalWin"]
        self.win_manager.update_spinwin(self.win_data["totalWin"])  # Update wallet

    def update_freespin(self) -> None:
        """Called before a new reveal during freegame."""
        self.fs += 1
        update_freespin_event(self)
        # This game does not reset the global multiplier on each spin
        self.global_multiplier = 1
        update_global_mult_event(self)
        self.win_manager.reset_spin_win()
        self.tumblewin_mult = 0
        self.win_data = {}
