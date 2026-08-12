from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .models import Direction, Signal
from .params import StrategyParams


@dataclass(frozen=True, slots=True)
class ExitDecision:
    should_exit: bool
    reason: str
    option_return_pct: float
    age_seconds: float


def evaluate_dynamic_exit(
    *,
    now: datetime,
    opened_at: datetime,
    entry_price: float,
    best_price: float,
    option_price: float,
    nifty_ltp: float,
    entry_direction: Direction,
    entry_level_price: float | None,
    signal: Signal | None,
    params: StrategyParams,
) -> ExitDecision:
    age = max((now - opened_at).total_seconds(), 0.0)
    if entry_price <= 0 or option_price < 0:
        return ExitDecision(False, "invalid premium for exit evaluation", 0.0, age)

    option_return = (option_price - entry_price) / entry_price
    best_return = (max(best_price, option_price) - entry_price) / entry_price

    # Hard premium risk and target exits are allowed even during the minimum-hold window.
    if option_return <= -params.exit_stop_loss_pct:
        return ExitDecision(True, "stop_loss", option_return, age)
    if option_return >= params.exit_profit_target_pct:
        return ExitDecision(True, "profit_target", option_return, age)
    if age >= params.exit_max_hold_seconds:
        return ExitDecision(True, "max_hold", option_return, age)

    if best_return >= params.exit_trailing_activation_pct:
        drawdown_from_best = (max(best_price, option_price) - option_price) / max(
            max(best_price, option_price), 1e-9
        )
        if drawdown_from_best >= params.exit_trailing_drawdown_pct:
            return ExitDecision(True, "trailing_stop", option_return, age)

    if age < params.exit_min_hold_seconds:
        return ExitDecision(False, "minimum_hold", option_return, age)

    direction_sign = 1.0 if entry_direction is Direction.BULLISH else -1.0
    if signal is not None and direction_sign * signal.combined_direction_score <= -params.exit_signal_flip_threshold:
        return ExitDecision(True, "market_pressure_flip", option_return, age)

    if entry_level_price is not None and entry_level_price > 0:
        tolerance = entry_level_price * params.exit_level_failure_bps / 10_000.0
        if entry_direction is Direction.BULLISH and nifty_ltp < entry_level_price - tolerance:
            return ExitDecision(True, "level_failure", option_return, age)
        if entry_direction is Direction.BEARISH and nifty_ltp > entry_level_price + tolerance:
            return ExitDecision(True, "level_failure", option_return, age)

    return ExitDecision(False, "hold", option_return, age)
