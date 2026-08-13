from __future__ import annotations

from dataclasses import asdict, dataclass, fields
import json
import math
from pathlib import Path
from typing import Any, Mapping


@dataclass(frozen=True, slots=True)
class StrategyParams:
    direction_scale_bps: float = 8.0
    rvol_cap: float = 4.0
    cash_pressure_weight: float = 0.65
    breadth_weight: float = 0.20
    heavyweight_weight: float = 0.15
    participation_floor: float = 0.55
    min_constituents: int = 45

    futures_price_weight: float = 0.45
    futures_oi_weight: float = 0.30
    futures_basis_weight: float = 0.25
    futures_direction_scale_bps: float = 8.0
    futures_oi_scale_pct: float = 0.35
    futures_basis_scale_bps: float = 4.0

    option_direction_volume_weight: float = 0.45
    option_direction_oi_weight: float = 0.40
    option_direction_iv_weight: float = 0.15
    option_iv_skew_scale_pct: float = 2.0
    option_near_atm_strikes: int = 5

    vwap_direction_scale_bps: float = 8.0

    combined_cash_weight: float = 0.50
    combined_futures_weight: float = 0.30
    combined_options_weight: float = 0.10
    combined_vwap_weight: float = 0.10

    level_watch_distance_bps: float = 35.0
    level_touch_tolerance_bps: float = 8.0
    breakout_penetration_bps: float = 12.0
    rejection_depth_bps: float = 10.0
    persistence_target_seconds: float = 30.0
    breakout_threshold: float = 0.68
    reversal_threshold: float = 0.68
    decision_margin: float = 0.08
    level_touch_memory_seconds: float = 180.0

    level_direction_weight: float = 0.40
    level_distance_weight: float = 0.20
    level_persistence_weight: float = 0.15
    level_participation_weight: float = 0.15
    level_acceleration_weight: float = 0.10

    target_abs_delta: float = 0.58
    min_abs_delta: float = 0.48
    max_abs_delta: float = 0.68
    option_delta_weight: float = 0.35
    option_liquidity_weight: float = 0.30
    option_volume_liquidity_weight: float = 0.55
    option_oi_liquidity_weight: float = 0.45
    option_theta_weight: float = 0.15
    option_iv_weight: float = 0.10
    option_gamma_weight: float = 0.10
    max_spread_pct: float = 0.02

    opening_no_entry_minutes: int = 10
    entry_cutoff_minutes_before_close: int = 15

    exit_min_hold_seconds: int = 60
    exit_profit_target_pct: float = 0.15
    exit_stop_loss_pct: float = 0.08
    exit_trailing_activation_pct: float = 0.10
    exit_trailing_drawdown_pct: float = 0.05
    exit_signal_flip_threshold: float = 0.20
    exit_level_failure_bps: float = 8.0
    exit_max_hold_seconds: int = 900

    risk_per_trade_pct: float = 0.005
    daily_loss_limit_pct: float = 0.02
    daily_profit_lock_pct: float = 0.0
    max_trades_per_day: int = 6
    max_consecutive_losses: int = 3
    max_quantity: int = 0
    max_premium_per_trade: float = 0.0
    cooldown_seconds: int = 180
    min_signal_confidence: float = 0.68
    max_data_age_seconds: int = 30

    def __post_init__(self) -> None:
        positive = {
            "direction_scale_bps": self.direction_scale_bps,
            "rvol_cap": self.rvol_cap,
            "futures_direction_scale_bps": self.futures_direction_scale_bps,
            "futures_oi_scale_pct": self.futures_oi_scale_pct,
            "futures_basis_scale_bps": self.futures_basis_scale_bps,
            "option_iv_skew_scale_pct": self.option_iv_skew_scale_pct,
            "vwap_direction_scale_bps": self.vwap_direction_scale_bps,
            "level_watch_distance_bps": self.level_watch_distance_bps,
            "level_touch_tolerance_bps": self.level_touch_tolerance_bps,
            "breakout_penetration_bps": self.breakout_penetration_bps,
            "rejection_depth_bps": self.rejection_depth_bps,
            "persistence_target_seconds": self.persistence_target_seconds,
            "level_touch_memory_seconds": self.level_touch_memory_seconds,
            "exit_level_failure_bps": self.exit_level_failure_bps,
        }
        for name, value in positive.items():
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be finite and positive")

        unit_interval = {
            "participation_floor": self.participation_floor,
            "breakout_threshold": self.breakout_threshold,
            "reversal_threshold": self.reversal_threshold,
            "decision_margin": self.decision_margin,
            "target_abs_delta": self.target_abs_delta,
            "min_abs_delta": self.min_abs_delta,
            "max_abs_delta": self.max_abs_delta,
            "max_spread_pct": self.max_spread_pct,
            "exit_profit_target_pct": self.exit_profit_target_pct,
            "exit_stop_loss_pct": self.exit_stop_loss_pct,
            "exit_trailing_activation_pct": self.exit_trailing_activation_pct,
            "exit_trailing_drawdown_pct": self.exit_trailing_drawdown_pct,
            "exit_signal_flip_threshold": self.exit_signal_flip_threshold,
            "risk_per_trade_pct": self.risk_per_trade_pct,
            "daily_loss_limit_pct": self.daily_loss_limit_pct,
            "daily_profit_lock_pct": self.daily_profit_lock_pct,
            "min_signal_confidence": self.min_signal_confidence,
        }
        for name, value in unit_interval.items():
            if not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError(f"{name} must be in [0, 1]")
        if self.rvol_cap <= 1:
            raise ValueError("rvol_cap must be > 1")
        if self.min_constituents <= 0:
            raise ValueError("min_constituents must be positive")
        if self.option_near_atm_strikes <= 0:
            raise ValueError("option_near_atm_strikes must be positive")
        if not self.min_abs_delta <= self.target_abs_delta <= self.max_abs_delta:
            raise ValueError("target_abs_delta must be inside the configured delta band")
        if self.max_trades_per_day <= 0 or self.max_consecutive_losses <= 0:
            raise ValueError("daily/consecutive trade limits must be positive")
        if self.opening_no_entry_minutes < 0 or self.entry_cutoff_minutes_before_close < 0:
            raise ValueError("entry timing limits cannot be negative")
        if self.entry_cutoff_minutes_before_close >= 375:
            raise ValueError("entry cutoff must leave some NSE session time available")
        if self.exit_min_hold_seconds < 0 or self.exit_max_hold_seconds <= 0:
            raise ValueError("exit hold times are invalid")
        if self.exit_min_hold_seconds >= self.exit_max_hold_seconds:
            raise ValueError("exit_min_hold_seconds must be below exit_max_hold_seconds")
        if self.cooldown_seconds < 0 or self.max_data_age_seconds < 0:
            raise ValueError("time limits cannot be negative")
        if self.max_quantity < 0:
            raise ValueError("max_quantity cannot be negative")
        if not math.isfinite(self.max_premium_per_trade) or self.max_premium_per_trade < 0:
            raise ValueError("max_premium_per_trade must be finite and non-negative")

        groups = {
            "cash": (self.cash_pressure_weight, self.breadth_weight, self.heavyweight_weight),
            "futures": (self.futures_price_weight, self.futures_oi_weight, self.futures_basis_weight),
            "option_direction": (self.option_direction_volume_weight, self.option_direction_oi_weight, self.option_direction_iv_weight),
            "combined": (self.combined_cash_weight, self.combined_futures_weight, self.combined_options_weight, self.combined_vwap_weight),
            "level": (self.level_direction_weight, self.level_distance_weight, self.level_persistence_weight, self.level_participation_weight, self.level_acceleration_weight),
            "option_liquidity": (self.option_volume_liquidity_weight, self.option_oi_liquidity_weight),
            "option": (self.option_delta_weight, self.option_liquidity_weight, self.option_theta_weight, self.option_iv_weight, self.option_gamma_weight),
        }
        for name, values in groups.items():
            if any(value < 0 or not math.isfinite(value) for value in values):
                raise ValueError(f"{name} weights must be finite and non-negative")
            if not math.isclose(sum(values), 1.0, abs_tol=1e-9):
                raise ValueError(f"{name} weights must sum to 1.0")

    @classmethod
    def from_json(cls, path: str | Path) -> "StrategyParams":
        raw: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(**raw)

    @classmethod
    def from_mapping(cls, values: Mapping[str, Any]) -> "StrategyParams":
        defaults = cls()
        known = {item.name: item for item in fields(cls)}
        converted: dict[str, Any] = {}
        for key, raw in values.items():
            if key not in known or raw is None:
                continue
            default = getattr(defaults, key)
            if isinstance(default, bool):
                converted[key] = bool(raw)
            elif isinstance(default, int):
                converted[key] = int(float(raw))
            else:
                converted[key] = float(raw)
        return cls(**converted)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
