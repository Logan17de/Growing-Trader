from __future__ import annotations

from typing import Any

from nifty_engine.execution import GrowwOrderExecutor, make_order_reference


class FakeGroww:
    SEGMENT_FNO = "FNO"
    EXCHANGE_NSE = "NSE"
    PRODUCT_MIS = "MIS"
    ORDER_TYPE_MARKET = "MARKET"
    TRANSACTION_TYPE_BUY = "BUY"
    TRANSACTION_TYPE_SELL = "SELL"
    VALIDITY_DAY = "DAY"

    def __init__(self, *, existing: bool = False) -> None:
        self.existing = existing
        self.place_calls: list[dict[str, Any]] = []

    def get_available_margin_details(self) -> dict[str, Any]:
        return {"clear_cash": 5000.0, "fno_margin_details": {"option_buy_balance_available": 12345.0}}

    def get_order_status_by_reference(self, *, order_reference_id: str, segment: str) -> dict[str, Any]:
        assert segment == "FNO"
        if not self.existing:
            return {}
        return {"groww_order_id": "G-EXISTING", "order_status": "EXECUTED", "filled_quantity": 65, "order_reference_id": order_reference_id}

    def place_order(self, **kwargs: Any) -> dict[str, Any]:
        self.place_calls.append(kwargs)
        return {"groww_order_id": "G-NEW", "order_status": "OPEN", "order_reference_id": kwargs["order_reference_id"]}

    def get_order_status(self, *, groww_order_id: str, segment: str) -> dict[str, Any]:
        return {"groww_order_id": groww_order_id, "order_status": "EXECUTED", "filled_quantity": 65}

    def get_order_detail(self, *, groww_order_id: str, segment: str) -> dict[str, Any]:
        return {"groww_order_id": groww_order_id, "order_status": "EXECUTED", "filled_quantity": 65, "average_fill_price": 101.25}

    def get_trade_list_for_order(self, *, groww_order_id: str, segment: str, page: int, page_size: int) -> dict[str, Any]:
        return {"trade_list": [{"quantity": 65, "price": 101.25}]}

    def cancel_order(self, **_kwargs: Any) -> dict[str, Any]:
        return {}

    def get_position_for_trading_symbol(self, *, trading_symbol: str, segment: str) -> dict[str, Any]:
        return {"trading_symbol": trading_symbol, "quantity": 65}

    def get_positions_for_user(self, *, segment: str) -> dict[str, Any]:
        assert segment == "FNO"
        return {"positions": [
            {"trading_symbol": "NIFTY26AUG24300CE", "segment": "FNO", "quantity": 65, "product": "MIS", "net_price": 101.25, "realised_pnl": 0},
            {"trading_symbol": "BANKNIFTY26AUG55000CE", "segment": "FNO", "quantity": 30, "product": "MIS", "net_price": 80.0, "realised_pnl": 0},
            {"trading_symbol": "NIFTY26AUG24400PE", "segment": "FNO", "quantity": 0, "product": "MIS", "net_price": 0, "realised_pnl": 0},
        ]}


def test_order_reference_is_stable_and_groww_compatible() -> None:
    first = make_order_reference("GT", "123e4567-e89b-12d3-a456-426614174000")
    second = make_order_reference("GT", "123e4567-e89b-12d3-a456-426614174000")
    assert first == second
    assert 8 <= len(first) <= 20
    assert first.count("-") <= 2


def test_live_market_buy_uses_nse_fno_mis_and_actual_fill() -> None:
    groww = FakeGroww()
    executor = GrowwOrderExecutor(groww, timeout_seconds=1, poll_seconds=0.01)
    fill = executor.submit_market_option(
        trading_symbol="NIFTY-DEMO-CE", quantity=65, side="BUY", order_reference_id="GT-123456789012"
    )
    assert fill.filled
    assert fill.filled_quantity == 65
    assert fill.average_fill_price == 101.25
    assert len(groww.place_calls) == 1
    call = groww.place_calls[0]
    assert call["exchange"] == "NSE"
    assert call["segment"] == "FNO"
    assert call["product"] == "MIS"
    assert call["order_type"] == "MARKET"
    assert call["transaction_type"] == "BUY"
    assert call["validity"] == "DAY"


def test_existing_reference_is_reconciled_without_duplicate_place_order() -> None:
    groww = FakeGroww(existing=True)
    executor = GrowwOrderExecutor(groww, timeout_seconds=1, poll_seconds=0.01)
    fill = executor.submit_market_option(
        trading_symbol="NIFTY-DEMO-CE", quantity=65, side="BUY", order_reference_id="GT-123456789012"
    )
    assert fill.groww_order_id == "G-EXISTING"
    assert fill.filled
    assert groww.place_calls == []


def test_option_buy_margin_uses_fno_balance() -> None:
    executor = GrowwOrderExecutor(FakeGroww())
    assert executor.available_option_buy_margin() == 12345.0


def test_broker_position_quantity_is_read_back() -> None:
    executor = GrowwOrderExecutor(FakeGroww())
    assert executor.broker_position_quantity("NIFTY-DEMO-CE") == 65


def test_broker_nifty_positions_reads_full_fno_book_and_filters_zero_and_other_indices() -> None:
    executor = GrowwOrderExecutor(FakeGroww())
    rows = executor.broker_nifty_positions()
    assert rows == [{
        "trading_symbol": "NIFTY26AUG24300CE",
        "quantity": 65,
        "segment": "FNO",
        "product": "MIS",
        "net_price": 101.25,
        "realised_pnl": 0.0,
    }]
