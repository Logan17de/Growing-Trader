from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime
import math
from typing import Any, Iterable
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def _number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=IST)


def _local_date(value: Any) -> date | None:
    parsed = _dt(value)
    return parsed.astimezone(IST).date() if parsed else None


def _strategy_name(value: Any) -> str:
    text = str(value or "").lower()
    if text == "breakout":
        return "S/R Breakout"
    if text == "reversal":
        return "S/R Reversal"
    return "Other / Unattributed"


@dataclass(frozen=True, slots=True)
class TradeMetrics:
    trades: int
    wins: int
    losses: int
    net_pnl: float
    gross_profit: float
    gross_loss: float
    win_rate: float | None
    average_win: float | None
    average_loss: float | None
    profit_factor: float | None
    expectancy: float | None
    max_drawdown: float
    best_trade: float | None
    worst_trade: float | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def calculate_trade_metrics(rows: Iterable[dict[str, Any]]) -> TradeMetrics:
    values = [_number(row.get("pnl")) for row in rows]
    pnl = [value for value in values if value is not None]
    wins = [value for value in pnl if value > 0]
    losses = [value for value in pnl if value < 0]
    gross_profit = sum(wins)
    gross_loss = sum(losses)
    running = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for value in pnl:
        running += value
        peak = max(peak, running)
        max_drawdown = min(max_drawdown, running - peak)
    count = len(pnl)
    return TradeMetrics(
        trades=count,
        wins=len(wins),
        losses=len(losses),
        net_pnl=sum(pnl),
        gross_profit=gross_profit,
        gross_loss=gross_loss,
        win_rate=(len(wins) / count) if count else None,
        average_win=(gross_profit / len(wins)) if wins else None,
        average_loss=(gross_loss / len(losses)) if losses else None,
        profit_factor=(gross_profit / abs(gross_loss)) if gross_loss < 0 else None,
        expectancy=(sum(pnl) / count) if count else None,
        max_drawdown=max_drawdown,
        best_trade=max(pnl) if pnl else None,
        worst_trade=min(pnl) if pnl else None,
    )


def rows_for_session(rows: Iterable[dict[str, Any]], session_date: date, mode: str | None = None) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        if _local_date(row.get("executed_at")) != session_date:
            continue
        row_mode = str(row.get("mode") or "paper").lower()
        if mode and row_mode != mode:
            continue
        result.append(row)
    return sorted(result, key=lambda row: str(row.get("executed_at") or ""))


def rows_for_month(rows: Iterable[dict[str, Any]], session_date: date, mode: str | None = None) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        local = _local_date(row.get("executed_at"))
        if not local or (local.year, local.month) != (session_date.year, session_date.month):
            continue
        row_mode = str(row.get("mode") or "paper").lower()
        if mode and row_mode != mode:
            continue
        result.append(row)
    return sorted(result, key=lambda row: str(row.get("executed_at") or ""))


def strategy_metrics(rows: Iterable[dict[str, Any]]) -> dict[str, TradeMetrics]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        strategy = str(row.get("strategy") or _strategy_name(row.get("signal_event")))
        grouped.setdefault(strategy, []).append(row)
    return {name: calculate_trade_metrics(items) for name, items in sorted(grouped.items())}


def cumulative_pnl_points(rows: Iterable[dict[str, Any]]) -> list[tuple[datetime, float]]:
    running = 0.0
    points: list[tuple[datetime, float]] = []
    for row in sorted(rows, key=lambda item: str(item.get("executed_at") or "")):
        when = _dt(row.get("executed_at"))
        pnl = _number(row.get("pnl"))
        if when is None or pnl is None:
            continue
        running += pnl
        points.append((when.astimezone(IST), running))
    return points


def market_summary(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(rows, key=lambda row: str(row.get("observed_at") or ""))
    if not ordered:
        return {
            "open": None, "close": None, "change_points": None, "change_pct": None,
            "volume": 0.0, "turnover": 0.0, "breadth": None, "participation": None,
            "cash_pressure": None, "heavyweight_score": None, "synthetic_vwap": None,
        }
    first = ordered[0]
    last = ordered[-1]
    opening = _number(first.get("nifty_ltp"))
    closing = _number(last.get("nifty_ltp"))
    change = (closing - opening) if opening is not None and closing is not None else None
    change_pct = (change / opening) if change is not None and opening else None
    return {
        "open": opening,
        "close": closing,
        "change_points": change,
        "change_pct": change_pct,
        "volume": sum(_number(row.get("constituent_volume_delta")) or 0.0 for row in ordered),
        "turnover": sum(_number(row.get("constituent_turnover")) or 0.0 for row in ordered),
        "breadth": _number(last.get("breadth")),
        "participation": _number(last.get("participation")),
        "cash_pressure": _number(last.get("cash_pressure")),
        "heavyweight_score": _number(last.get("heavyweight_score")),
        "synthetic_vwap": _number(last.get("synthetic_vwap")),
        "futures_score": _number(last.get("futures_score")),
        "option_score": _number(last.get("option_score")),
        "combined_score": _number(last.get("combined_score")),
    }


def largest_market_watch_move(rows: Iterable[dict[str, Any]]) -> dict[str, Any] | None:
    best: tuple[float, dict[str, Any], str, float] | None = None
    horizons = (("1m", "nifty_move_1m_bps"), ("5m", "nifty_move_5m_bps"), ("15m", "nifty_move_15m_bps"))
    for row in rows:
        for label, key in horizons:
            value = _number(row.get(key))
            if value is None:
                continue
            candidate = (abs(value), row, label, value)
            if best is None or candidate[0] > best[0]:
                best = candidate
    if best is None:
        return None
    _, row, horizon, value = best
    keys = (
        "observed_at", "nifty_ltp", "cash_pressure", "breadth", "participation",
        "heavyweight_score", "futures_move_bps", "futures_volume_delta",
        "futures_oi_change_pct", "futures_basis_points", "futures_score",
        "option_score", "option_volume_imbalance", "option_oi_change_imbalance",
        "option_iv_skew", "vwap_distance_bps", "combined_direction_score",
        "constituent_volume_delta", "constituent_turnover", "max_up_15m_bps", "max_down_15m_bps",
    )
    result = {key: row.get(key) for key in keys}
    result.update({"horizon": horizon, "move_bps": value})
    return result


def choose_primary_mode(execution_mode: Any, session_rows: Iterable[dict[str, Any]]) -> str:
    mode = str(execution_mode or "").lower()
    if mode in {"paper", "live"}:
        return mode
    modes = {str(row.get("mode") or "paper").lower() for row in session_rows}
    return "live" if "live" in modes else "paper"


def build_report_summary(
    *,
    session_date: date,
    trade_rows: list[dict[str, Any]],
    minute_rows: list[dict[str, Any]],
    watch_rows: list[dict[str, Any]],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    all_session = rows_for_session(trade_rows, session_date)
    execution = metadata.get("execution") if isinstance(metadata.get("execution"), dict) else {}
    primary_mode = choose_primary_mode(execution.get("mode"), all_session)
    modes: dict[str, Any] = {}
    for mode in ("paper", "live"):
        day_rows = rows_for_session(trade_rows, session_date, mode)
        month_rows = rows_for_month(trade_rows, session_date, mode)
        modes[mode] = {
            "daily": calculate_trade_metrics(day_rows).to_dict(),
            "monthly": calculate_trade_metrics(month_rows).to_dict(),
            "strategies": {name: metrics.to_dict() for name, metrics in strategy_metrics(day_rows).items()},
            "daily_rows": day_rows,
        }
    market = market_summary(minute_rows)
    watch = largest_market_watch_move(watch_rows)
    lifecycle = metadata.get("lifecycle") if isinstance(metadata.get("lifecycle"), dict) else {}
    audit = metadata.get("broker_audit") if isinstance(metadata.get("broker_audit"), dict) else {}
    paper_equity = _number(metadata.get("paper_account_equity"))
    primary = modes[primary_mode]
    daily_pnl = _number(primary["daily"].get("net_pnl")) or 0.0
    starting_balance = paper_equity if primary_mode == "paper" and paper_equity is not None else None
    ending_balance = starting_balance + daily_pnl if starting_balance is not None else None
    return {
        "session_date": session_date.isoformat(),
        "primary_mode": primary_mode,
        "primary": primary,
        "modes": modes,
        "market": market,
        "market_watch": watch,
        "starting_balance": starting_balance,
        "ending_balance": ending_balance,
        "safety": {
            "broker_flat": audit.get("flat"),
            "broker_positions": audit.get("positions") or audit.get("broker_positions") or [],
            "unresolved_live_orders": int(metadata.get("unresolved_live_orders") or 0),
            "live_armed": bool(execution.get("live_armed")),
            "kill_switch": bool((metadata.get("risk") or {}).get("kill_switch")) if isinstance(metadata.get("risk"), dict) else False,
            "engine_state": (metadata.get("engine") or {}).get("state") if isinstance(metadata.get("engine"), dict) else None,
            "market_data_status": (metadata.get("worker") or {}).get("market_data_status") if isinstance(metadata.get("worker"), dict) else None,
            "shutdown_result": lifecycle,
        },
    }
