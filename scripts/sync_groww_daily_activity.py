#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime, timezone
import json
import sys
from typing import Any

from nifty_engine.control_plane import OracleControlAgent, SupabaseControlPlane


def _safe(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


def _extract_list(payload: Any, *keys: str) -> list[dict[str, Any]]:
    value = _safe(payload)
    if isinstance(value, list):
        return [dict(row) for row in value if isinstance(row, dict)]
    if not isinstance(value, dict):
        return []
    for key in keys:
        rows = value.get(key)
        if isinstance(rows, list):
            return [dict(row) for row in rows if isinstance(row, dict)]
    nested = value.get("payload")
    if isinstance(nested, dict):
        return _extract_list(nested, *keys)
    return []


def _normalize_order(row: dict[str, Any]) -> dict[str, Any]:
    keep = (
        "groww_order_id", "trading_symbol", "order_status", "transaction_type",
        "segment", "exchange", "product", "order_type", "quantity",
        "filled_quantity", "remaining_quantity", "average_fill_price", "price",
        "trigger_price", "order_reference_id", "created_at", "order_timestamp",
        "exchange_time", "remark",
    )
    return {key: _safe(row.get(key)) for key in keep if row.get(key) is not None}


def _normalize_trade(row: dict[str, Any], order: dict[str, Any], segment: str) -> dict[str, Any]:
    keep = (
        "groww_trade_id", "trade_id", "groww_order_id", "trading_symbol",
        "transaction_type", "quantity", "price", "trade_price", "fill_price",
        "trade_timestamp", "exchange_time", "created_at",
    )
    result = {key: _safe(row.get(key)) for key in keep if row.get(key) is not None}
    result.setdefault("groww_order_id", order.get("groww_order_id"))
    result.setdefault("trading_symbol", order.get("trading_symbol"))
    result.setdefault("transaction_type", order.get("transaction_type"))
    result["segment"] = segment
    return result


def _record(control: SupabaseControlPlane, *, ok: bool, detail: str, metadata: dict[str, Any]) -> None:
    control.client.table("activity_events").insert({
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "severity": "success" if ok else "warning",
        "component": "broker-sync",
        "event_type": "daily_broker_activity" if ok else "daily_broker_activity_failed",
        "title": "Groww daily broker activity synced" if ok else "Groww daily broker activity sync failed",
        "detail": detail[:1000],
        "metadata": metadata,
    }).execute()


def _day_orders(groww: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page_size = 25
    for page in range(20):
        response = groww.get_order_list(page=page, page_size=page_size)
        batch = _extract_list(response, "order_list", "orders")
        rows.extend(batch)
        if len(batch) < page_size:
            break
    return rows


def main() -> int:
    control = SupabaseControlPlane.from_env()
    try:
        groww, profile = OracleControlAgent(control)._groww_client()
        orders = [_normalize_order(row) for row in _day_orders(groww)]
        trades: list[dict[str, Any]] = []

        for order in orders:
            order_id = str(order.get("groww_order_id") or "").strip()
            try:
                filled_quantity = int(float(order.get("filled_quantity") or 0))
            except (TypeError, ValueError):
                filled_quantity = 0
            if not order_id or filled_quantity <= 0:
                continue
            declared = str(order.get("segment") or "").strip().upper()
            candidates = [declared] if declared in {"CASH", "FNO", "COMMODITY"} else ["FNO", "CASH"]
            for segment in candidates:
                segment_value = getattr(groww, f"SEGMENT_{segment}", segment)
                try:
                    response = groww.get_trade_list_for_order(
                        groww_order_id=order_id,
                        segment=segment_value,
                        page=0,
                        page_size=50,
                    )
                    rows = _extract_list(response, "trade_list", "trades")
                    trades.extend(_normalize_trade(row, order, segment) for row in rows)
                    if rows:
                        break
                except Exception:
                    continue

        metadata = {
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "profile": profile,
            "order_count": len(orders),
            "trade_fill_count": len(trades),
            "orders": orders,
            "trades": trades,
        }
        _record(control, ok=True, detail=f"{len(orders)} orders; {len(trades)} trade fills", metadata=metadata)
        print(json.dumps({"ok": True, "orders": len(orders), "trades": len(trades)}))
        return 0
    except Exception as exc:
        detail = f"{type(exc).__name__}: {exc}"
        try:
            _record(control, ok=False, detail=detail, metadata={"error": detail})
        except Exception:
            pass
        print(detail, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
