from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

from nifty_engine.paper_runner import PaperPersistence


class FakeInsertBuilder:
    def __init__(self, row: dict[str, Any]) -> None:
        self.row = row
        self.payload: dict[str, Any] | None = None
        self.columns: str | None = None

    def insert(self, payload: dict[str, Any]) -> "FakeInsertBuilder":
        self.payload = payload
        return self

    def select(self, columns: str) -> "FakeInsertBuilder":
        self.columns = columns
        return self

    def execute(self) -> Any:
        return SimpleNamespace(data=[self.row])


class FakeClient:
    def __init__(self) -> None:
        self.builders = {
            "signals": FakeInsertBuilder({"id": "signal-1"}),
            "orders": FakeInsertBuilder(
                {"id": "order-1", "created_at": "2026-08-12T07:15:00+00:00"}
            ),
        }

    def table(self, name: str) -> FakeInsertBuilder:
        return self.builders[name]


def test_signal_insert_does_not_require_single_modifier() -> None:
    client = FakeClient()
    persistence = PaperPersistence(client, account_equity=1_000_000.0)
    signal = SimpleNamespace(
        timestamp=datetime(2026, 8, 12, 7, 15, tzinfo=timezone.utc),
        event=SimpleNamespace(value="uncertain"),
        direction=SimpleNamespace(value="flat"),
        confidence=0.0,
        combined_direction_score=0.0,
    )

    assert persistence.write_signal(signal) == "signal-1"  # type: ignore[arg-type]


def test_order_insert_does_not_require_single_modifier() -> None:
    client = FakeClient()
    persistence = PaperPersistence(client, account_equity=1_000_000.0)
    contract = SimpleNamespace(trading_symbol="NIFTY-DEMO-CE", ltp=100.0)
    signal = SimpleNamespace(
        timestamp=datetime(2026, 8, 12, 7, 15, tzinfo=timezone.utc),
        event=SimpleNamespace(value="breakout"),
        direction=SimpleNamespace(value="bullish"),
        confidence=0.8,
        contract=SimpleNamespace(contract=contract, score=0.75),
        risk=SimpleNamespace(quantity=65),
    )

    position = persistence.create_paper_order("signal-1", signal, 24_300.0)  # type: ignore[arg-type]
    assert position.order_id == "order-1"
    assert position.signal_id == "signal-1"
    assert position.trading_symbol == "NIFTY-DEMO-CE"
