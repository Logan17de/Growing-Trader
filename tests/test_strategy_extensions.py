from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from nifty_engine.exits import evaluate_dynamic_exit
from nifty_engine.formulas import option_market_metrics, vwap_metrics
from nifty_engine.market_state import LiveMarketState
from nifty_engine.models import (
    CashMetrics,
    ContractSelection,
    Direction,
    EventKind,
    FuturesMetrics,
    LevelMetrics,
    OptionContract,
    OptionGreeks,
    OptionMarketMetrics,
    OptionType,
    RiskDecision,
    Signal,
    VwapMetrics,
)
from nifty_engine.paper_runner import paper_entry_window_open
from nifty_engine.params import StrategyParams


def contract(
    symbol: str,
    side: OptionType,
    strike: float,
    *,
    volume: int,
    oi: int,
    iv: float = 13.0,
) -> OptionContract:
    delta = 0.55 if side is OptionType.CE else -0.55
    return OptionContract(
        symbol,
        side,
        strike,
        "2099-01-01",
        100.0,
        oi,
        volume,
        65,
        OptionGreeks(delta, 0.001, -4.0, 10.0, 1.0, iv),
    )


def fake_signal(score: float) -> Signal:
    return Signal(
        timestamp=datetime.now(timezone.utc),
        event=EventKind.BREAKOUT,
        direction=Direction.BULLISH,
        confidence=0.8,
        combined_direction_score=score,
        cash=CashMetrics(0.4, 0.3, 0.8, 0.2, 0.4, 50, 30, 20),
        futures=FuturesMetrics(0.4, 0.5, 0.3, 0.2, 0.35),
        level=LevelMetrics(EventKind.BREAKOUT, 0.8, 0.8, 0.2, 0.6, 0.0, 0.8, 3.0, "R1"),
        contract=ContractSelection(None, 0.0, "test"),
        risk=RiskDecision(False, 0, 0.0, "test"),
        reasons=(),
        option_market=OptionMarketMetrics(),
        vwap=VwapMetrics(),
    )


def test_db_mapping_covers_new_thresholds_and_validates_weight_groups() -> None:
    params = StrategyParams.from_mapping(
        {
            "opening_no_entry_minutes": 12,
            "exit_stop_loss_pct": 0.07,
            "combined_cash_weight": 0.45,
            "combined_futures_weight": 0.35,
            "combined_options_weight": 0.10,
            "combined_vwap_weight": 0.10,
            "unknown_future_key": 999,
        }
    )
    assert params.opening_no_entry_minutes == 12
    assert params.exit_stop_loss_pct == pytest.approx(0.07)
    assert params.combined_cash_weight == pytest.approx(0.45)
    with pytest.raises(ValueError):
        StrategyParams(combined_cash_weight=0.8)


def test_opening_warmup_blocks_first_ten_minutes() -> None:
    before = datetime(2026, 8, 12, 3, 54, tzinfo=timezone.utc)  # 09:24 IST
    allowed = datetime(2026, 8, 12, 3, 55, tzinfo=timezone.utc)  # 09:25 IST
    assert not paper_entry_window_open(before, 10)
    assert paper_entry_window_open(allowed, 10)


def test_option_activity_confirmation_uses_incremental_near_atm_data() -> None:
    previous = (
        contract("C", OptionType.CE, 24300, volume=1000, oi=1000),
        contract("P", OptionType.PE, 24300, volume=1000, oi=1000),
    )
    current = (
        contract("C", OptionType.CE, 24300, volume=1600, oi=1050),
        contract("P", OptionType.PE, 24300, volume=1100, oi=1400),
    )
    metric = option_market_metrics(current, previous, 24290.0, StrategyParams())
    assert metric.ready
    assert metric.call_volume_delta == 600
    assert metric.put_volume_delta == 100
    assert metric.put_oi_delta == 400
    assert metric.call_oi_delta == 50
    assert metric.score > 0


def test_synthetic_vwap_uses_constituent_turnover_as_activity_weight() -> None:
    state = LiveMarketState()
    t0 = datetime.now(timezone.utc)
    state.update_feed_spot(24000.0, t0, 0.0)
    state.update_constituent("AAA", {"last_price": 100.0, "volume": 1000}, t0)
    state.update_constituent(
        "AAA", {"last_price": 101.0, "volume": 1100}, t0 + timedelta(seconds=10)
    )
    state.update_synthetic_vwap()
    assert state.synthetic_vwap == pytest.approx(24000.0)

    state.update_feed_spot(24200.0, t0 + timedelta(seconds=20), 0.0)
    state.update_constituent(
        "AAA", {"last_price": 102.0, "volume": 1300}, t0 + timedelta(seconds=20)
    )
    state.update_synthetic_vwap()
    assert state.synthetic_vwap is not None
    assert 24000.0 < state.synthetic_vwap < 24200.0
    metric = vwap_metrics(24200.0, state.synthetic_vwap, StrategyParams())
    assert metric.ready
    assert metric.score > 0


def test_dynamic_exit_supports_stop_target_trailing_flip_and_level_failure() -> None:
    params = StrategyParams()
    opened = datetime.now(timezone.utc) - timedelta(seconds=120)

    stop = evaluate_dynamic_exit(
        now=datetime.now(timezone.utc), opened_at=opened, entry_price=100.0,
        best_price=105.0, option_price=91.0, nifty_ltp=25000.0,
        entry_direction=Direction.BULLISH, entry_level_price=24980.0,
        signal=fake_signal(0.5), params=params,
    )
    assert stop.should_exit and stop.reason == "stop_loss"

    target = evaluate_dynamic_exit(
        now=datetime.now(timezone.utc), opened_at=opened, entry_price=100.0,
        best_price=116.0, option_price=116.0, nifty_ltp=25000.0,
        entry_direction=Direction.BULLISH, entry_level_price=24980.0,
        signal=fake_signal(0.5), params=params,
    )
    assert target.should_exit and target.reason == "profit_target"

    trailing = evaluate_dynamic_exit(
        now=datetime.now(timezone.utc), opened_at=opened, entry_price=100.0,
        best_price=112.0, option_price=106.0, nifty_ltp=25000.0,
        entry_direction=Direction.BULLISH, entry_level_price=24980.0,
        signal=fake_signal(0.5), params=params,
    )
    assert trailing.should_exit and trailing.reason == "trailing_stop"

    flip = evaluate_dynamic_exit(
        now=datetime.now(timezone.utc), opened_at=opened, entry_price=100.0,
        best_price=103.0, option_price=101.0, nifty_ltp=25000.0,
        entry_direction=Direction.BULLISH, entry_level_price=24980.0,
        signal=fake_signal(-0.4), params=params,
    )
    assert flip.should_exit and flip.reason == "market_pressure_flip"

    failure = evaluate_dynamic_exit(
        now=datetime.now(timezone.utc), opened_at=opened, entry_price=100.0,
        best_price=103.0, option_price=101.0, nifty_ltp=24950.0,
        entry_direction=Direction.BULLISH, entry_level_price=24980.0,
        signal=fake_signal(0.2), params=params,
    )
    assert failure.should_exit and failure.reason == "level_failure"
