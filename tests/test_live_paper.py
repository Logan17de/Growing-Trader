from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from nifty_engine.instrument_registry import InstrumentRegistry
from nifty_engine.live_control import LiveOracleControlAgent
from nifty_engine.market_state import LiveMarketState
from nifty_engine.option_chain import parse_option_chain
from nifty_engine.paper_runner import is_nse_session, paper_entry_window_open


def test_option_chain_parser_builds_ce_and_pe_contracts() -> None:
    payload = {
        "underlying_ltp": 24280.0,
        "strikes": {
            "24300": {
                "CE": {
                    "trading_symbol": "NIFTY-DEMO-CE",
                    "ltp": 120.5,
                    "open_interest": 1000,
                    "volume": 2000,
                    "greeks": {
                        "delta": 0.55,
                        "gamma": 0.001,
                        "theta": -5.0,
                        "vega": 10.0,
                        "rho": 2.0,
                        "iv": 13.0,
                    },
                },
                "PE": {
                    "trading_symbol": "NIFTY-DEMO-PE",
                    "ltp": 135.0,
                    "open_interest": 1200,
                    "volume": 2200,
                    "greeks": {
                        "delta": -0.52,
                        "gamma": 0.0012,
                        "theta": -5.5,
                        "vega": 10.5,
                        "rho": -2.0,
                        "iv": 13.5,
                    },
                },
            }
        },
    }
    contracts = parse_option_chain(
        payload,
        expiry="2099-01-01",
        lot_size_for=lambda _symbol, _default: 65,
    )

    assert len(contracts) == 2
    assert {item.trading_symbol for item in contracts} == {"NIFTY-DEMO-CE", "NIFTY-DEMO-PE"}
    assert all(item.lot_size == 65 for item in contracts)
    assert sorted(item.greeks.delta for item in contracts) == [-0.52, 0.55]


def test_instrument_registry_keeps_nse_cash_row_when_bse_duplicate_comes_later() -> None:
    symbols = tuple(f"STOCK{index}" for index in range(45))
    rows: list[dict[str, Any]] = []
    for index, symbol in enumerate(symbols):
        rows.extend(
            [
                {
                    "exchange": "NSE",
                    "segment": "CASH",
                    "exchange_token": str(1000 + index),
                    "trading_symbol": symbol,
                    "instrument_type": "EQ",
                    "lot_size": 1,
                },
                {
                    "exchange": "BSE",
                    "segment": "CASH",
                    "exchange_token": str(2000 + index),
                    "trading_symbol": symbol,
                    "instrument_type": "EQ",
                    "lot_size": 1,
                },
            ]
        )

    class FakeGroww:
        def get_all_instruments(self) -> list[dict[str, Any]]:
            return rows

    registry = InstrumentRegistry(FakeGroww())
    resolved = registry.resolve_constituents(symbols)

    assert len(resolved) == 45
    assert all(item.exchange == "NSE" for item in resolved)
    assert all(item.segment == "CASH" for item in resolved)
    assert [item.exchange_token for item in resolved[:2]] == ["1000", "1001"]


def test_market_state_builds_snapshot_after_two_quote_scans() -> None:
    state = LiveMarketState()
    start = datetime.now(timezone.utc) - timedelta(seconds=10)
    state.update_feed_spot(24280.0, start, 0.0)

    for index in range(50):
        symbol = f"STOCK{index}"
        state.update_constituent(
            symbol,
            {"last_price": 100.0 + index, "volume": 1000 + index},
            start,
        )
        state.update_constituent(
            symbol,
            {"last_price": 100.5 + index, "volume": 1100 + index},
            start + timedelta(seconds=10),
        )

    state.update_future(
        "NIFTY-FUT",
        {"last_price": 24300.0, "volume": 10000, "open_interest": 20000},
        start,
    )
    state.update_future(
        "NIFTY-FUT",
        {"last_price": 24305.0, "volume": 10200, "open_interest": 20100},
        start + timedelta(seconds=10),
    )
    state.update_feed_spot(24285.0, start + timedelta(seconds=10), 0.0)

    built = state.build_snapshot(now=start + timedelta(seconds=10), max_age_seconds=30)
    assert built is not None
    snapshot, data_age = built
    assert len(snapshot.constituents) == 50
    assert snapshot.spot_price == 24285.0
    assert snapshot.futures.open_interest == 20100
    assert data_age <= 10.0


def test_market_hours_use_india_time_and_keep_15m_research_exit_window() -> None:
    inside = datetime(2026, 8, 12, 4, 30, tzinfo=timezone.utc)
    late = datetime(2026, 8, 12, 9, 50, tzinfo=timezone.utc)
    assert is_nse_session(inside)
    assert paper_entry_window_open(inside)
    assert is_nse_session(late)
    assert not paper_entry_window_open(late)


class FakeControl:
    def __init__(self, commands: list[dict[str, Any]]) -> None:
        self.commands = commands
        self.completed: list[tuple[str, dict[str, Any] | None, str | None]] = []

    def claim_command(self, _worker_id: str) -> dict[str, Any] | None:
        return self.commands.pop(0) if self.commands else None

    def complete_command(
        self,
        command_id: str,
        *,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        self.completed.append((command_id, result, error))


class FakeRuntime:
    def __init__(self) -> None:
        self.is_running = False

    def status(self) -> dict[str, Any]:
        return {"running": self.is_running, "state": "running" if self.is_running else "stopped"}

    def start(self, _factory: Any) -> dict[str, Any]:
        self.is_running = True
        return self.status()

    def stop(self, _timeout: float = 15.0) -> dict[str, Any]:
        self.is_running = False
        return self.status()


def test_live_control_start_and_stop_paper_engine_do_not_stop_oracle() -> None:
    control = FakeControl(
        [
            {"id": "start", "command": "START_PAPER_ENGINE"},
            {"id": "stop", "command": "STOP_PAPER_ENGINE"},
        ]
    )
    agent = LiveOracleControlAgent(control, poll_seconds=0.01)  # type: ignore[arg-type]
    runtime = FakeRuntime()
    agent.paper_runtime = runtime  # type: ignore[assignment]
    agent._write_heartbeat = lambda: None  # type: ignore[method-assign]
    agent._write_paper_status = lambda: None  # type: ignore[method-assign]
    agent._groww_client = lambda: (object(), {})  # type: ignore[method-assign]

    assert agent.run_once() is True
    assert runtime.is_running is True
    assert control.completed[-1][0] == "start"
    assert control.completed[-1][2] is None

    assert agent.run_once() is True
    assert runtime.is_running is False
    assert control.completed[-1][0] == "stop"
    assert control.completed[-1][2] is None
