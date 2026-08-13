from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from nifty_engine.managed_runtime import snapshot_from_primitive
from nifty_engine.models import (
    ConstituentTick,
    ContractSelection,
    FuturesTick,
    MarketSnapshot,
    OptionContract,
    OptionGreeks,
    OptionType,
)
from nifty_engine.params import StrategyParams
from nifty_engine.risk import RiskEngine, RiskState
from nifty_engine.serialization import to_primitive

IST = ZoneInfo("Asia/Kolkata")


def contract() -> ContractSelection:
    option = OptionContract(
        trading_symbol="NIFTY-DEMO-CE",
        option_type=OptionType.CE,
        strike=25_000,
        expiry="2099-01-01",
        ltp=100.0,
        open_interest=100_000,
        volume=50_000,
        lot_size=50,
        greeks=OptionGreeks(0.58, 0.001, -5.0, 10.0, 1.0, 14.0),
        bid_price=99.5,
        ask_price=100.5,
    )
    return ContractSelection(option, 0.9, "eligible")


def test_db_boolean_mapping_and_entry_cutoff_are_explicit() -> None:
    params = StrategyParams.from_mapping(
        {"entry_cutoff_enabled": 1, "entry_cutoff_minutes_before_close": 15}
    )
    assert params.entry_cutoff_enabled is True

    decision = RiskEngine(params).evaluate(
        now=datetime(2026, 8, 13, 15, 20, tzinfo=IST),
        confidence=1.0,
        contract=contract(),
        state=RiskState(account_equity=2_000_000),
        constituent_count=50,
    )
    assert not decision.allowed
    assert decision.reason == "new-entry cutoff before market close"

    no_cutoff = RiskEngine(StrategyParams()).evaluate(
        now=datetime(2026, 8, 13, 15, 20, tzinfo=IST),
        confidence=1.0,
        contract=contract(),
        state=RiskState(account_equity=2_000_000),
        constituent_count=50,
    )
    assert no_cutoff.allowed


def test_optional_risk_extensions_cap_or_block_paper_entries() -> None:
    quantity_limited = StrategyParams(
        risk_per_trade_pct=0.10,
        max_quantity=50,
        min_signal_confidence=0.50,
    )
    decision = RiskEngine(quantity_limited).evaluate(
        now=datetime(2026, 8, 13, 12, 0, tzinfo=IST),
        confidence=1.0,
        contract=contract(),
        state=RiskState(account_equity=100_000),
        constituent_count=50,
    )
    assert decision.allowed
    assert decision.quantity == 50

    premium_limited = StrategyParams(
        risk_per_trade_pct=0.10,
        max_premium_per_trade=4_000,
        min_signal_confidence=0.50,
    )
    decision = RiskEngine(premium_limited).evaluate(
        now=datetime(2026, 8, 13, 12, 0, tzinfo=IST),
        confidence=1.0,
        contract=contract(),
        state=RiskState(account_equity=100_000),
        constituent_count=50,
    )
    assert not decision.allowed
    assert "one option lot" in decision.reason

    profit_locked = StrategyParams(daily_profit_lock_pct=0.01, min_signal_confidence=0.50)
    decision = RiskEngine(profit_locked).evaluate(
        now=datetime(2026, 8, 13, 12, 0, tzinfo=IST),
        confidence=1.0,
        contract=contract(),
        state=RiskState(account_equity=100_000, realized_pnl_today=1_000),
        constituent_count=50,
    )
    assert not decision.allowed
    assert decision.reason == "daily profit lock reached"


def test_external_strategy_block_precedes_position_sizing() -> None:
    decision = RiskEngine(StrategyParams()).evaluate(
        now=datetime(2026, 8, 13, 12, 0, tzinfo=IST),
        confidence=1.0,
        contract=contract(),
        state=RiskState(account_equity=100_000, external_block_reason="kill switch enabled"),
        constituent_count=50,
    )
    assert not decision.allowed
    assert decision.reason == "kill switch enabled"


def test_persisted_market_snapshot_round_trips_for_replay() -> None:
    snapshot = MarketSnapshot(
        timestamp=datetime(2026, 8, 13, 12, 0, tzinfo=IST),
        spot_price=25_000,
        previous_spot_price=24_990,
        constituents=(
            ConstituentTick(
                symbol="RELIANCE",
                price=1_500,
                previous_price=1_490,
                cumulative_volume=1_000_000,
                previous_cumulative_volume=990_000,
                baseline_volume_rate=800,
                previous_volume_rate=700,
                seconds_elapsed=20,
                index_weight=0.10,
                is_heavyweight=True,
            ),
        ),
        futures=FuturesTick(
            symbol="NIFTY-FUT",
            price=25_010,
            previous_price=25_000,
            volume=2_000_000,
            previous_volume=1_990_000,
            baseline_volume_rate=1_500,
            seconds_elapsed=20,
            open_interest=10_100_000,
            previous_open_interest=10_000_000,
            spot_price=25_000,
            previous_spot_price=24_990,
        ),
        options=(contract().contract,),
        synthetic_vwap=24_995,
    )
    restored = snapshot_from_primitive(to_primitive(snapshot))
    assert restored.timestamp == snapshot.timestamp
    assert restored.spot_price == 25_000
    assert restored.constituents[0].symbol == "RELIANCE"
    assert restored.constituents[0].is_heavyweight
    assert restored.futures.open_interest == 10_100_000
    assert restored.options[0].option_type is OptionType.CE
    assert restored.options[0].greeks.delta == 0.58
    assert restored.synthetic_vwap == 24_995
