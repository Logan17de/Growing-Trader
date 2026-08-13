from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Any


TERMINAL_ORDER_STATES = {"EXECUTED", "COMPLETED", "REJECTED", "FAILED", "CANCELLED"}
SUCCESS_ORDER_STATES = {"EXECUTED", "COMPLETED"}


def make_order_reference(prefix: str, local_id: str) -> str:
    compact = "".join(ch for ch in str(local_id) if ch.isalnum())
    token = (compact or "000000000000")[:12]
    reference = f"{prefix[:2].upper()}-{token}"
    if not 8 <= len(reference) <= 20:
        raise ValueError("Groww order reference must be 8-20 characters")
    return reference


@dataclass(frozen=True, slots=True)
class BrokerFill:
    groww_order_id: str
    order_reference_id: str
    status: str
    requested_quantity: int
    filled_quantity: int
    average_fill_price: float
    raw: dict[str, Any]

    @property
    def filled(self) -> bool:
        return self.filled_quantity > 0 and self.average_fill_price > 0


class GrowwOrderExecutor:
    """Small idempotent wrapper around Groww's NSE F&O order APIs.

    The strategy only buys options and later sells the same quantity to exit.  A
    caller-provided reference is checked before submission so a retry after a
    process/network failure does not intentionally create a duplicate order.
    """

    def __init__(
        self,
        groww: Any,
        *,
        product: str = "MIS",
        timeout_seconds: float = 8.0,
        poll_seconds: float = 0.5,
    ) -> None:
        self.groww = groww
        self.product = product
        self.timeout_seconds = max(float(timeout_seconds), 1.0)
        self.poll_seconds = max(float(poll_seconds), 0.1)

    def available_option_buy_margin(self) -> float:
        payload = dict(self.groww.get_available_margin_details() or {})
        fno = payload.get("fno_margin_details")
        if isinstance(fno, dict):
            value = fno.get("option_buy_balance_available")
            if value is not None:
                return max(float(value), 0.0)
        return max(float(payload.get("clear_cash") or 0.0), 0.0)

    def _status_by_reference(self, order_reference_id: str) -> dict[str, Any] | None:
        try:
            response = self.groww.get_order_status_by_reference(
                order_reference_id=order_reference_id,
                segment=getattr(self.groww, "SEGMENT_FNO", "FNO"),
            )
        except Exception:
            return None
        return dict(response or {})

    def _average_price_from_trades(self, groww_order_id: str) -> tuple[int, float]:
        try:
            response = dict(self.groww.get_trade_list_for_order(
                groww_order_id=groww_order_id,
                segment=getattr(self.groww, "SEGMENT_FNO", "FNO"),
                page=0,
                page_size=50,
            ) or {})
        except Exception:
            return 0, 0.0
        trades = response.get("trade_list")
        if not isinstance(trades, list):
            return 0, 0.0
        qty = 0
        value = 0.0
        for trade in trades:
            if not isinstance(trade, dict):
                continue
            trade_qty = int(trade.get("quantity") or 0)
            price = float(trade.get("price") or 0.0)
            if trade_qty > 0 and price > 0:
                qty += trade_qty
                value += trade_qty * price
        return qty, value / qty if qty else 0.0

    def _resolve_fill(self, groww_order_id: str, order_reference_id: str, requested_quantity: int) -> BrokerFill:
        deadline = time.monotonic() + self.timeout_seconds
        last: dict[str, Any] = {}
        while time.monotonic() < deadline:
            last = dict(self.groww.get_order_status(
                groww_order_id=groww_order_id,
                segment=getattr(self.groww, "SEGMENT_FNO", "FNO"),
            ) or {})
            status = str(last.get("order_status") or "").upper()
            filled_quantity = int(last.get("filled_quantity") or 0)
            if status in TERMINAL_ORDER_STATES or filled_quantity >= requested_quantity:
                break
            time.sleep(self.poll_seconds)

        status = str(last.get("order_status") or "UNKNOWN").upper()
        filled_quantity = int(last.get("filled_quantity") or 0)
        if filled_quantity < requested_quantity and status not in TERMINAL_ORDER_STATES:
            try:
                self.groww.cancel_order(
                    segment=getattr(self.groww, "SEGMENT_FNO", "FNO"),
                    groww_order_id=groww_order_id,
                )
            except Exception:
                pass
            try:
                last = dict(self.groww.get_order_status(
                    groww_order_id=groww_order_id,
                    segment=getattr(self.groww, "SEGMENT_FNO", "FNO"),
                ) or last)
                status = str(last.get("order_status") or status).upper()
                filled_quantity = int(last.get("filled_quantity") or filled_quantity)
            except Exception:
                pass

        average_fill_price = 0.0
        try:
            detail = dict(self.groww.get_order_detail(
                groww_order_id=groww_order_id,
                segment=getattr(self.groww, "SEGMENT_FNO", "FNO"),
            ) or {})
            average_fill_price = float(detail.get("average_fill_price") or 0.0)
            filled_quantity = max(filled_quantity, int(detail.get("filled_quantity") or 0))
            if detail.get("order_status"):
                status = str(detail["order_status"]).upper()
            last = {**last, "detail": detail}
        except Exception:
            pass

        trade_quantity, trade_average = self._average_price_from_trades(groww_order_id)
        if trade_quantity > 0:
            filled_quantity = max(filled_quantity, trade_quantity)
        if average_fill_price <= 0 and trade_average > 0:
            average_fill_price = trade_average

        return BrokerFill(
            groww_order_id=groww_order_id,
            order_reference_id=order_reference_id,
            status=status,
            requested_quantity=requested_quantity,
            filled_quantity=min(max(filled_quantity, 0), requested_quantity),
            average_fill_price=average_fill_price,
            raw=last,
        )

    def submit_market_option(
        self,
        *,
        trading_symbol: str,
        quantity: int,
        side: str,
        order_reference_id: str,
    ) -> BrokerFill:
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        side = side.upper()
        if side not in {"BUY", "SELL"}:
            raise ValueError("side must be BUY or SELL")

        existing = self._status_by_reference(order_reference_id)
        groww_order_id = str((existing or {}).get("groww_order_id") or "")
        if not groww_order_id:
            response = dict(self.groww.place_order(
                trading_symbol=trading_symbol,
                quantity=quantity,
                validity=getattr(self.groww, "VALIDITY_DAY", "DAY"),
                exchange=getattr(self.groww, "EXCHANGE_NSE", "NSE"),
                segment=getattr(self.groww, "SEGMENT_FNO", "FNO"),
                product=getattr(self.groww, f"PRODUCT_{self.product}", self.product),
                order_type=getattr(self.groww, "ORDER_TYPE_MARKET", "MARKET"),
                transaction_type=getattr(self.groww, f"TRANSACTION_TYPE_{side}", side),
                order_reference_id=order_reference_id,
            ) or {})
            groww_order_id = str(response.get("groww_order_id") or "")
            if not groww_order_id:
                raise RuntimeError(f"Groww did not return an order id: {response}")
        return self._resolve_fill(groww_order_id, order_reference_id, quantity)

    def broker_position_quantity(self, trading_symbol: str) -> int | None:
        try:
            response = dict(self.groww.get_position_for_trading_symbol(
                trading_symbol=trading_symbol,
                segment=getattr(self.groww, "SEGMENT_FNO", "FNO"),
            ) or {})
        except Exception:
            return None
        positions = response.get("positions")
        if isinstance(positions, list):
            for row in positions:
                if isinstance(row, dict) and str(row.get("trading_symbol")) == trading_symbol:
                    return int(row.get("quantity") or 0)
            return 0
        if str(response.get("trading_symbol") or "") == trading_symbol:
            return int(response.get("quantity") or 0)
        return None
