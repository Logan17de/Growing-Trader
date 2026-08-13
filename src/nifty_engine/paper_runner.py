from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, time as clock_time, timedelta, timezone
import logging
import math
import os
import threading
import time
from typing import Any, Callable
from zoneinfo import ZoneInfo

from .brokers.groww_data import SlidingWindowRateLimiter
from .engine import SignalEngine
from .exits import evaluate_dynamic_exit
from .instrument_registry import InstrumentRegistry, load_nifty50_universe
from .market_feed import GrowwLiveFeed
from .market_state import DEFAULT_HEAVYWEIGHTS, LiveMarketState
from .models import Direction, LevelKind, MarketSnapshot, OptionContract, Signal, SupportResistanceLevel
from .option_chain import option_ltp, parse_option_chain
from .params import StrategyParams
from .risk import RiskState
from .serialization import to_primitive

logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")
OUTCOME_HORIZONS = (60, 180, 300, 600, 900)
PARAM_REFRESH_SECONDS = 30.0
CONTROL_REFRESH_SECONDS = 10.0


def _env_float(name: str, default: float, *, minimum: float = 0.0) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    value = float(raw)
    if value < minimum:
        raise ValueError(f"{name} must be >= {minimum}")
    return value


@dataclass(frozen=True, slots=True)
class PaperEngineConfig:
    account_equity: float = 2_000_000.0
    quote_scan_seconds: float = 20.0
    option_refresh_seconds: float = 20.0
    feed_poll_seconds: float = 1.0
    signal_persist_seconds: float = 30.0

    @classmethod
    def from_env(cls) -> "PaperEngineConfig":
        return cls(
            account_equity=_env_float("PAPER_ACCOUNT_EQUITY", 2_000_000.0, minimum=1.0),
            quote_scan_seconds=_env_float("PAPER_QUOTE_SCAN_SECONDS", 20.0, minimum=5.0),
            option_refresh_seconds=_env_float("PAPER_OPTION_REFRESH_SECONDS", 20.0, minimum=5.0),
            feed_poll_seconds=_env_float("PAPER_FEED_POLL_SECONDS", 1.0, minimum=0.25),
            signal_persist_seconds=_env_float("PAPER_SIGNAL_PERSIST_SECONDS", 30.0, minimum=5.0),
        )


@dataclass(slots=True)
class OpenPaperPosition:
    order_id: str
    signal_id: str
    trading_symbol: str
    quantity: int
    entry_price: float
    entry_nifty: float
    opened_at: datetime
    recorded_horizons: set[int]
    entry_direction: Direction = Direction.FLAT
    entry_level_name: str | None = None
    entry_level_price: float | None = None
    best_price: float = 0.0
    original_quantity: int = 0
    stop_loss_pct: float | None = None
    profit_target_pct: float | None = None
    trailing_activation_pct: float | None = None
    trailing_drawdown_pct: float | None = None


def is_nse_session(now: datetime | None = None) -> bool:
    current = (now or datetime.now(timezone.utc)).astimezone(IST)
    if current.weekday() >= 5:
        return False
    local_time = current.time().replace(tzinfo=None)
    return clock_time(9, 15) <= local_time <= clock_time(15, 30)


def paper_entry_window_open(now: datetime | None = None, opening_no_entry_minutes: int = 10) -> bool:
    current = (now or datetime.now(timezone.utc)).astimezone(IST)
    if current.weekday() >= 5:
        return False
    local_time = current.time().replace(tzinfo=None)
    opening = datetime.combine(current.date(), clock_time(9, 15), tzinfo=IST)
    first_entry = opening + timedelta(minutes=max(opening_no_entry_minutes, 0))
    last_entry = datetime.combine(current.date(), clock_time(15, 15), tzinfo=IST)
    return first_entry <= current <= last_entry and clock_time(9, 15) <= local_time <= clock_time(15, 15)


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _returned_row(response: Any, operation: str) -> dict[str, Any]:
    data = getattr(response, "data", None)
    if isinstance(data, dict):
        return dict(data)
    if isinstance(data, list) and len(data) == 1 and isinstance(data[0], dict):
        return dict(data[0])
    if isinstance(data, list) and not data:
        raise RuntimeError(f"{operation} did not return an inserted row")
    if isinstance(data, list):
        raise RuntimeError(f"{operation} returned {len(data)} rows; expected exactly one")
    raise RuntimeError(f"{operation} returned an unexpected Supabase response shape")


class PaperPersistence:
    def __init__(self, client: Any, account_equity: float) -> None:
        self.client = client
        self.account_equity = account_equity
        self.parameters_updated_at: str | None = None

    def load_strategy_params(self) -> StrategyParams:
        response = self.client.table("strategy_parameters").select("key,value,updated_at").order("key").execute()
        rows = list(response.data or [])
        if not rows:
            self.parameters_updated_at = None
            return StrategyParams()
        values = {str(row["key"]): row.get("value") for row in rows}
        updated = [str(row.get("updated_at")) for row in rows if row.get("updated_at")]
        self.parameters_updated_at = max(updated) if updated else None
        return StrategyParams.from_mapping(values)

    def load_runtime_config(self, default: PaperEngineConfig) -> PaperEngineConfig:
        try:
            response = self.client.table("app_settings").select("key,value").in_("key", [
                "paper_account_equity", "quote_scan_seconds", "option_refresh_seconds", "feed_poll_seconds", "signal_persist_seconds"
            ]).execute()
            values = {str(row["key"]): row.get("value") for row in (response.data or [])}
            return PaperEngineConfig(
                account_equity=max(float(values.get("paper_account_equity", default.account_equity)), 1.0),
                quote_scan_seconds=max(float(values.get("quote_scan_seconds", default.quote_scan_seconds)), 5.0),
                option_refresh_seconds=max(float(values.get("option_refresh_seconds", default.option_refresh_seconds)), 5.0),
                feed_poll_seconds=max(float(values.get("feed_poll_seconds", default.feed_poll_seconds)), 0.25),
                signal_persist_seconds=max(float(values.get("signal_persist_seconds", default.signal_persist_seconds)), 5.0),
            )
        except Exception:
            logger.exception("runtime settings load failed; using process defaults")
            return default

    def load_risk_control(self) -> dict[str, Any]:
        try:
            response = self.client.table("risk_control_state").select("kill_switch,block_new_entries,close_open_position_on_kill,reason,updated_at").eq("id", True).maybe_single().execute()
            return dict(response.data or {})
        except Exception:
            return {"kill_switch": False, "block_new_entries": False}

    def load_constituent_config(self, symbols: tuple[str, ...]) -> tuple[dict[str, float], frozenset[str], str]:
        response = self.client.table("nifty_constituent_config").select("symbol,index_weight,is_heavyweight").in_("symbol", list(symbols)).execute()
        rows = list(response.data or [])
        heavyweights = frozenset(str(row["symbol"]) for row in rows if bool(row.get("is_heavyweight"))) or DEFAULT_HEAVYWEIGHTS
        positive_weights = {str(row["symbol"]): float(row["index_weight"]) for row in rows if row.get("index_weight") is not None and float(row["index_weight"]) > 0}
        if len(positive_weights) == len(symbols):
            return positive_weights, heavyweights, "database"
        return {}, heavyweights, "equal"

    def load_sectors(self, symbols: tuple[str, ...]) -> dict[str, str]:
        try:
            response = self.client.table("nifty_constituent_config").select("symbol,sector").in_("symbol", list(symbols)).execute()
            return {str(row["symbol"]): str(row.get("sector") or "Other") for row in (response.data or [])}
        except Exception:
            return {}

    def load_levels(self) -> tuple[SupportResistanceLevel, ...]:
        response = self.client.table("strategy_levels").select("name,kind,price,source,enabled").eq("enabled", True).order("price").execute()
        return tuple(SupportResistanceLevel(name=str(row["name"]), kind=LevelKind(str(row["kind"])), price=float(row["price"]), source=str(row.get("source", "manual")), enabled=bool(row.get("enabled", True))) for row in (response.data or []))

    def write_activity(self, severity: str, component: str, event_type: str, title: str, detail: str = "", *, instrument: str | None = None, metadata: dict[str, Any] | None = None) -> None:
        try:
            self.client.table("activity_events").insert({
                "observed_at": datetime.now(timezone.utc).isoformat(), "severity": severity, "component": component,
                "event_type": event_type, "title": title, "detail": detail, "instrument": instrument,
                "metadata": metadata or {},
            }).execute()
        except Exception:
            logger.exception("activity event persistence failed")

    def write_option_chain(self, contracts: tuple[OptionContract, ...], underlying_ltp: float, observed_at: datetime) -> None:
        if not contracts:
            return
        strikes = sorted({item.strike for item in contracts}, key=lambda strike: abs(strike - underlying_ltp))[:11]
        selected = [item for item in contracts if item.strike in strikes]
        rows = [{
            "observed_at": observed_at.isoformat(), "expiry": item.expiry, "underlying_ltp": underlying_ltp,
            "strike": item.strike, "option_type": item.option_type.value, "trading_symbol": item.trading_symbol,
            "ltp": item.ltp, "open_interest": item.open_interest, "volume": item.volume,
            "delta": item.greeks.delta, "gamma": item.greeks.gamma, "theta": item.greeks.theta,
            "vega": item.greeks.vega, "rho": item.greeks.rho, "iv": item.greeks.iv,
            "bid_price": item.bid_price, "ask_price": item.ask_price,
        } for item in selected]
        if rows:
            self.client.table("option_chain_series").insert(rows).execute()

    def write_market_snapshot(self, snapshot: MarketSnapshot, levels: tuple[SupportResistanceLevel, ...], data_age: float, params: StrategyParams, sectors: dict[str, str]) -> None:
        observed = snapshot.timestamp.isoformat()
        rows = []
        for tick in snapshot.constituents:
            delta_volume = max(tick.cumulative_volume - tick.previous_cumulative_volume, 0)
            rate = delta_volume / max(tick.seconds_elapsed, 1e-6)
            move_pct = ((tick.price - tick.previous_price) / tick.previous_price * 100.0) if tick.previous_price > 0 else 0.0
            rows.append({
                "observed_at": observed, "symbol": tick.symbol, "sector": sectors.get(tick.symbol, "Other"),
                "price": tick.price, "previous_price": tick.previous_price, "move_pct": move_pct,
                "cumulative_volume": tick.cumulative_volume, "volume_delta": delta_volume, "volume_rate": rate,
                "relative_volume": rate / max(tick.baseline_volume_rate, 1e-9), "index_weight": tick.index_weight,
                "is_heavyweight": tick.is_heavyweight,
            })
        if rows:
            self.client.table("market_constituent_series").insert(rows).execute()
        self.client.table("market_snapshot_history").insert({
            "observed_at": observed, "snapshot": to_primitive(snapshot), "levels": to_primitive(levels),
            "data_age_seconds": data_age, "strategy_parameters": params.to_dict(),
        }).execute()

    def _today_start_utc(self) -> datetime:
        local = datetime.now(IST)
        return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)

    def _position_raw(self, position: OpenPaperPosition) -> dict[str, Any]:
        return {
            "entry_price": position.entry_price, "entry_nifty": position.entry_nifty,
            "entry_direction": position.entry_direction.value, "entry_level_name": position.entry_level_name,
            "entry_level_price": position.entry_level_price, "best_price": position.best_price,
            "original_quantity": position.original_quantity or position.quantity,
            "stop_loss_pct": position.stop_loss_pct, "profit_target_pct": position.profit_target_pct,
            "trailing_activation_pct": position.trailing_activation_pct,
            "trailing_drawdown_pct": position.trailing_drawdown_pct,
            "exit_policy": "dynamic_scalp", "recorded_horizons": sorted(position.recorded_horizons),
        }

    def restore_risk_state(self) -> tuple[RiskState, OpenPaperPosition | None]:
        start = self._today_start_utc().isoformat()
        orders_response = self.client.table("orders").select("id,signal_id,trading_symbol,quantity,status,raw,created_at").eq("mode", "paper").gte("created_at", start).order("created_at", desc=True).execute()
        trades_response = self.client.table("trades").select("order_id,pnl,executed_at").gte("executed_at", start).order("executed_at", desc=True).execute()
        orders = list(orders_response.data or [])
        trades = list(trades_response.data or [])
        realized = sum(float(row.get("pnl") or 0.0) for row in trades)
        consecutive_losses = 0
        for row in trades:
            if float(row.get("pnl") or 0.0) < 0:
                consecutive_losses += 1
            else:
                break
        last_trade_at = _parse_datetime(orders[0].get("created_at")) if orders else None
        open_row = next((row for row in orders if str(row.get("status")) == "OPEN"), None)
        open_position: OpenPaperPosition | None = None
        if open_row:
            raw = open_row.get("raw") if isinstance(open_row.get("raw"), dict) else {}
            opened_at = _parse_datetime(open_row.get("created_at"))
            if opened_at:
                direction_text = str(raw.get("entry_direction") or "flat")
                direction = Direction(direction_text) if direction_text in {item.value for item in Direction} else Direction.FLAT
                entry_price = float(raw.get("entry_price") or 0.0)
                open_position = OpenPaperPosition(
                    order_id=str(open_row["id"]), signal_id=str(open_row.get("signal_id") or ""),
                    trading_symbol=str(open_row["trading_symbol"]), quantity=int(open_row["quantity"]),
                    entry_price=entry_price, entry_nifty=float(raw.get("entry_nifty") or 0.0), opened_at=opened_at,
                    recorded_horizons={int(value) for value in raw.get("recorded_horizons", [])}, entry_direction=direction,
                    entry_level_name=str(raw["entry_level_name"]) if raw.get("entry_level_name") else None,
                    entry_level_price=float(raw["entry_level_price"]) if raw.get("entry_level_price") is not None else None,
                    best_price=float(raw.get("best_price") or entry_price),
                    original_quantity=int(raw.get("original_quantity") or open_row["quantity"]),
                    stop_loss_pct=float(raw["stop_loss_pct"]) if raw.get("stop_loss_pct") is not None else None,
                    profit_target_pct=float(raw["profit_target_pct"]) if raw.get("profit_target_pct") is not None else None,
                    trailing_activation_pct=float(raw["trailing_activation_pct"]) if raw.get("trailing_activation_pct") is not None else None,
                    trailing_drawdown_pct=float(raw["trailing_drawdown_pct"]) if raw.get("trailing_drawdown_pct") is not None else None,
                )
        state = RiskState(account_equity=self.account_equity, realized_pnl_today=realized, trades_today=len(orders), consecutive_losses=consecutive_losses, last_trade_at=last_trade_at, open_position=open_row is not None)
        return state, open_position

    def write_signal(self, signal: Signal) -> str:
        response = self.client.table("signals").insert({
            "observed_at": signal.timestamp.isoformat(), "event": signal.event.value,
            "direction": signal.direction.value, "confidence": signal.confidence,
            "combined_direction_score": signal.combined_direction_score, "payload": to_primitive(signal),
        }).select("id").execute()
        return str(_returned_row(response, "signal insert")["id"])

    def write_nifty_volume_sample(self, snapshot: MarketSnapshot, signal: Signal) -> None:
        self.client.table("nifty_volume_series").insert({
            "observed_at": snapshot.timestamp.isoformat(), "nifty_ltp": snapshot.spot_price,
            "synthetic_vwap": snapshot.synthetic_vwap, "constituent_volume_delta": signal.cash.share_volume_delta,
            "constituent_turnover": signal.cash.turnover_delta, "cash_pressure": signal.cash.pressure,
            "breadth": signal.cash.breadth, "participation": signal.cash.participation,
            "heavyweight_score": signal.cash.heavyweight_score, "futures_score": signal.futures.score,
            "option_score": signal.option_market.score, "vwap_score": signal.vwap.score,
            "combined_score": signal.combined_direction_score,
        }).execute()

    def create_paper_order(self, signal_id: str, signal: Signal, nifty_ltp: float, level_price: float | None = None) -> OpenPaperPosition:
        contract = signal.contract.contract
        if contract is None or signal.risk.quantity <= 0:
            raise RuntimeError("cannot create a paper order without an eligible contract/quantity")
        level = getattr(signal, "level", None)
        position = OpenPaperPosition(
            order_id="", signal_id=signal_id, trading_symbol=contract.trading_symbol, quantity=signal.risk.quantity,
            entry_price=contract.ltp, entry_nifty=nifty_ltp, opened_at=signal.timestamp, recorded_horizons=set(),
            entry_direction=signal.direction, entry_level_name=getattr(level, "level_name", None), entry_level_price=level_price,
            best_price=contract.ltp, original_quantity=signal.risk.quantity,
        )
        raw = self._position_raw(position) | {"signal_event": signal.event.value, "signal_direction": signal.direction.value, "confidence": signal.confidence, "option_score": signal.contract.score, "paper_fill_price": contract.ltp, "paper_slippage": 0.0}
        response = self.client.table("orders").insert({
            "signal_id": signal_id, "mode": "paper", "trading_symbol": contract.trading_symbol,
            "side": "BUY", "quantity": signal.risk.quantity, "status": "OPEN", "raw": raw,
        }).select("id,created_at").execute()
        row = _returned_row(response, "paper order insert")
        position.order_id = str(row["id"])
        position.opened_at = _parse_datetime(row.get("created_at")) or signal.timestamp
        self.write_activity("success", "paper-engine", "paper_entry", "Paper position opened", f"{position.quantity} × {position.trading_symbol} @ {position.entry_price:.2f}", instrument=position.trading_symbol)
        return position

    def record_outcome(self, position: OpenPaperPosition, horizon: int, *, option_price: float, nifty_ltp: float, observed_at: datetime) -> None:
        option_return = (option_price - position.entry_price) / position.entry_price * 100.0 if position.entry_price > 0 else None
        self.client.table("paper_signal_outcomes").upsert({
            "signal_id": position.signal_id, "order_id": position.order_id, "horizon_seconds": horizon,
            "observed_at": observed_at.isoformat(), "option_ltp": option_price, "nifty_ltp": nifty_ltp,
            "option_return_pct": option_return, "underlying_move_points": nifty_ltp - position.entry_nifty,
            "raw": {"trading_symbol": position.trading_symbol},
        }, on_conflict="signal_id,horizon_seconds").execute()
        position.recorded_horizons.add(horizon)
        self.client.table("orders").update({"raw": self._position_raw(position)}).eq("id", position.order_id).execute()

    def reduce_paper_order(self, position: OpenPaperPosition, *, option_price: float, observed_at: datetime, exit_reason: str, fraction: float = 1.0) -> tuple[float, bool]:
        fraction = min(max(float(fraction), 0.01), 1.0)
        exit_quantity = position.quantity if fraction >= 0.999 else max(1, min(position.quantity, int(math.ceil(position.quantity * fraction))))
        pnl = (option_price - position.entry_price) * exit_quantity
        remaining = position.quantity - exit_quantity
        self.client.table("trades").insert({
            "order_id": position.order_id, "trading_symbol": position.trading_symbol, "quantity": exit_quantity,
            "fill_price": option_price, "pnl": pnl,
            "raw": {"side": "SELL", "mode": "paper", "exit_policy": "dynamic_scalp", "exit_reason": exit_reason,
                    "entry_price": position.entry_price, "best_price": position.best_price, "paper_slippage": 0.0},
            "executed_at": observed_at.isoformat(),
        }).execute()
        if remaining <= 0:
            raw = self._position_raw(position) | {"exit_reason": exit_reason, "exit_price": option_price, "closed_at": observed_at.isoformat()}
            self.client.table("orders").update({"status": "CLOSED", "raw": raw}).eq("id", position.order_id).execute()
            self.write_activity("success" if pnl >= 0 else "warning", "paper-engine", "paper_exit", "Paper position closed", f"{exit_reason}: P&L {pnl:.2f}", instrument=position.trading_symbol)
            return pnl, True
        position.quantity = remaining
        self.client.table("orders").update({"quantity": remaining, "raw": self._position_raw(position)}).eq("id", position.order_id).execute()
        self.write_activity("info", "paper-engine", "partial_exit", "Paper position reduced", f"Exited {exit_quantity}; {remaining} remain", instrument=position.trading_symbol)
        return pnl, False

    def close_paper_order(self, position: OpenPaperPosition, *, option_price: float, observed_at: datetime, exit_reason: str) -> float:
        pnl, _ = self.reduce_paper_order(position, option_price=option_price, observed_at=observed_at, exit_reason=exit_reason, fraction=1.0)
        return pnl


class PaperEngineRuntime:
    def __init__(self, control: Any, *, config: PaperEngineConfig | None = None) -> None:
        self.control = control
        self.config = config or PaperEngineConfig.from_env()
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._client_factory: Callable[[], tuple[Any, dict[str, Any]]] | None = None
        self._manual_exit_fraction: float | None = None
        self._position_overrides: dict[str, float | None] = {}
        self._kill_switch = False
        self._close_on_kill = True
        self._status: dict[str, Any] = {"running": False, "state": "stopped", "mode": "paper"}

    def _set_status(self, **values: Any) -> None:
        with self._lock:
            self._status.update(values)
            self._status["updated_at"] = datetime.now(timezone.utc).isoformat()

    def status(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._status)

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def request_exit(self, fraction: float = 1.0) -> dict[str, Any]:
        with self._lock:
            self._manual_exit_fraction = min(max(float(fraction), 0.01), 1.0)
        return {"ok": True, "queued": True, "fraction": self._manual_exit_fraction}

    def update_position_controls(self, values: dict[str, Any]) -> dict[str, Any]:
        allowed = {"stop_loss_pct", "profit_target_pct", "trailing_activation_pct", "trailing_drawdown_pct"}
        parsed: dict[str, float | None] = {}
        for key, raw in values.items():
            if key not in allowed:
                continue
            if raw is None:
                parsed[key] = None
                continue
            value = float(raw)
            if not 0 <= value <= 1:
                raise ValueError(f"{key} must be in [0, 1]")
            parsed[key] = value
        with self._lock:
            self._position_overrides.update(parsed)
        return {"ok": True, "position_controls": dict(self._position_overrides)}

    def set_kill_switch(self, enabled: bool, *, close_position: bool = True) -> dict[str, Any]:
        with self._lock:
            self._kill_switch = bool(enabled)
            self._close_on_kill = bool(close_position)
            if enabled and close_position:
                self._manual_exit_fraction = 1.0
        self._set_status(kill_switch=self._kill_switch, block_new_entries=self._kill_switch)
        return {"ok": True, "kill_switch": self._kill_switch, "close_position": self._close_on_kill}

    def start(self, client_factory: Callable[[], tuple[Any, dict[str, Any]]]) -> dict[str, Any]:
        if self.running:
            return self.status()
        self._client_factory = client_factory
        self._stop_event.clear()
        self._set_status(running=True, state="starting", started_at=datetime.now(timezone.utc).isoformat(), last_error=None)
        self._thread = threading.Thread(target=self._run, name="nifty-paper-engine", daemon=True)
        self._thread.start()
        return self.status()

    def stop(self, timeout: float = 15.0) -> dict[str, Any]:
        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=timeout)
        self._set_status(state="stopping" if thread and thread.is_alive() else "stopped", running=bool(thread and thread.is_alive()))
        return self.status()

    def _quote_scan(self, *, groww: Any, limiter: SlidingWindowRateLimiter, state: LiveMarketState, constituents: tuple[Any, ...], future: Any) -> tuple[int, list[str]]:
        successes = 0
        errors: list[str] = []
        for ref in constituents:
            if self._stop_event.is_set():
                break
            try:
                limiter.wait()
                quote = dict(groww.get_quote(exchange="NSE", segment="CASH", trading_symbol=ref.trading_symbol))
                state.update_constituent(ref.trading_symbol, quote, datetime.now(timezone.utc))
                successes += 1
            except Exception as exc:
                errors.append(f"{ref.trading_symbol}: {type(exc).__name__}: {exc}")
        if not self._stop_event.is_set():
            try:
                limiter.wait()
                quote = dict(groww.get_quote(exchange="NSE", segment="FNO", trading_symbol=future.trading_symbol))
                state.update_future(future.trading_symbol, quote, datetime.now(timezone.utc))
            except Exception as exc:
                errors.append(f"{future.trading_symbol}: {type(exc).__name__}: {exc}")
        state.update_synthetic_vwap()
        return successes, errors

    def _position_status(self, position: OpenPaperPosition | None, *, current_price: float | None = None, contract: OptionContract | None = None) -> dict[str, Any] | None:
        if position is None:
            return None
        price = current_price
        unrealized = (price - position.entry_price) * position.quantity if price is not None else None
        return {
            "trading_symbol": position.trading_symbol, "quantity": position.quantity,
            "original_quantity": position.original_quantity or position.quantity, "entry_price": position.entry_price,
            "current_price": price, "unrealized_pnl": unrealized, "best_price": position.best_price,
            "entry_direction": position.entry_direction.value, "entry_level_name": position.entry_level_name,
            "entry_level_price": position.entry_level_price, "opened_at": position.opened_at.isoformat(),
            "marks_recorded": sorted(position.recorded_horizons), "stop_loss_pct": position.stop_loss_pct,
            "profit_target_pct": position.profit_target_pct, "trailing_activation_pct": position.trailing_activation_pct,
            "trailing_drawdown_pct": position.trailing_drawdown_pct,
            "stop_price": position.entry_price * (1 - position.stop_loss_pct) if position.stop_loss_pct is not None else None,
            "target_price": position.entry_price * (1 + position.profit_target_pct) if position.profit_target_pct is not None else None,
            "greeks": to_primitive(contract.greeks) if contract else None,
        }

    def _apply_overrides(self, position: OpenPaperPosition) -> None:
        with self._lock:
            overrides = dict(self._position_overrides)
            self._position_overrides.clear()
        for key, value in overrides.items():
            setattr(position, key, value)

    def _record_position_marks(self, persistence: PaperPersistence, position: OpenPaperPosition | None, chain: dict[str, Any], nifty_ltp: float, risk_state: RiskState, params: StrategyParams, signal: Signal | None, options: tuple[OptionContract, ...] = ()) -> tuple[OpenPaperPosition | None, str | None]:
        if position is None:
            return None, None
        self._apply_overrides(position)
        now = datetime.now(timezone.utc)
        age = max((now - position.opened_at).total_seconds(), 0.0)
        price = option_ltp(chain, position.trading_symbol)
        contract = next((item for item in options if item.trading_symbol == position.trading_symbol), None)
        if price is None:
            self._set_status(open_paper_position=self._position_status(position, contract=contract))
            return position, None
        position.best_price = max(position.best_price, price)
        for horizon in OUTCOME_HORIZONS:
            if age >= horizon and horizon not in position.recorded_horizons:
                persistence.record_outcome(position, horizon, option_price=price, nifty_ltp=nifty_ltp, observed_at=now)

        with self._lock:
            manual_fraction = self._manual_exit_fraction
            if manual_fraction is not None:
                self._manual_exit_fraction = None
        if manual_fraction is not None:
            pnl, closed = persistence.reduce_paper_order(position, option_price=price, observed_at=now, exit_reason="manual_exit", fraction=manual_fraction)
            risk_state.realized_pnl_today += pnl
            if closed:
                risk_state.open_position = False
                risk_state.consecutive_losses = risk_state.consecutive_losses + 1 if pnl < 0 else 0
                self._set_status(open_paper_position=None, last_exit_reason="manual_exit")
                return None, "manual_exit"
            self._set_status(open_paper_position=self._position_status(position, current_price=price, contract=contract), last_exit_reason="partial_manual_exit")
            return position, "partial_manual_exit"

        exit_params = replace(
            params,
            exit_stop_loss_pct=position.stop_loss_pct if position.stop_loss_pct is not None else params.exit_stop_loss_pct,
            exit_profit_target_pct=position.profit_target_pct if position.profit_target_pct is not None else params.exit_profit_target_pct,
            exit_trailing_activation_pct=position.trailing_activation_pct if position.trailing_activation_pct is not None else params.exit_trailing_activation_pct,
            exit_trailing_drawdown_pct=position.trailing_drawdown_pct if position.trailing_drawdown_pct is not None else params.exit_trailing_drawdown_pct,
        )
        decision = evaluate_dynamic_exit(now=now, opened_at=position.opened_at, entry_price=position.entry_price, best_price=position.best_price, option_price=price, nifty_ltp=nifty_ltp, entry_direction=position.entry_direction, entry_level_price=position.entry_level_price, signal=signal, params=exit_params)
        self._set_status(open_paper_position=self._position_status(position, current_price=price, contract=contract))
        if not decision.should_exit:
            return position, None
        pnl = persistence.close_paper_order(position, option_price=price, observed_at=now, exit_reason=decision.reason)
        risk_state.realized_pnl_today += pnl
        risk_state.open_position = False
        risk_state.consecutive_losses = risk_state.consecutive_losses + 1 if pnl < 0 else 0
        self._set_status(open_paper_position=None)
        return None, decision.reason

    def _run_session(self) -> None:
        if self._client_factory is None:
            raise RuntimeError("paper engine client factory is not configured")
        groww, _profile = self._client_factory()
        today = datetime.now(IST).date()
        registry = InstrumentRegistry(groww, today=today)
        universe = load_nifty50_universe()
        constituents = registry.resolve_constituents(universe.symbols)
        index = registry.nifty_index()
        future = registry.nearest_nifty_future()
        expiry = registry.nearest_nifty_option_expiry()
        feed = GrowwLiveFeed(groww, constituents, index, future)
        state = LiveMarketState()
        persistence = PaperPersistence(self.control.client, self.config.account_equity)
        self.config = persistence.load_runtime_config(self.config)
        persistence.account_equity = self.config.account_equity
        params = persistence.load_strategy_params()
        index_weights, heavyweights, weighting = persistence.load_constituent_config(universe.symbols)
        sectors = persistence.load_sectors(universe.symbols)
        risk_control = persistence.load_risk_control()
        self._kill_switch = bool(risk_control.get("kill_switch") or risk_control.get("block_new_entries"))
        self._close_on_kill = bool(risk_control.get("close_open_position_on_kill", True))
        if self._kill_switch and self._close_on_kill:
            self._manual_exit_fraction = 1.0
        engine = SignalEngine(params)
        risk_state, open_position = persistence.restore_risk_state()
        limiter = SlidingWindowRateLimiter(max_per_second=8, max_per_minute=220)
        feed.start()
        persistence.write_activity("info", "paper-engine", "session_start", "Paper market session started", f"{len(constituents)} NIFTY constituents resolved")

        self._set_status(
            running=True, state="warming", feed_connected=True, universe_as_of=universe.as_of, weighting=weighting,
            account_equity=self.config.account_equity, available_capital=self.config.account_equity,
            constituents_total=50, constituents_resolved=len(constituents), constituents_fresh=0,
            future_symbol=future.trading_symbol, future_ltp=None, nifty_ltp=None, synthetic_vwap=None,
            whole_nifty_volume_delta=0, whole_nifty_turnover=0.0, option_expiry=expiry, option_contract_count=0,
            thresholds_updated_at=persistence.parameters_updated_at, opening_no_entry_minutes=params.opening_no_entry_minutes,
            kill_switch=self._kill_switch, block_new_entries=self._kill_switch, last_exit_reason=None,
            open_paper_position=self._position_status(open_position),
            runtime_settings={"quote_scan_seconds": self.config.quote_scan_seconds, "option_refresh_seconds": self.config.option_refresh_seconds, "feed_poll_seconds": self.config.feed_poll_seconds, "signal_persist_seconds": self.config.signal_persist_seconds},
        )

        next_quote = 0.0
        next_option = 0.0
        next_param_refresh = time.monotonic() + PARAM_REFRESH_SECONDS
        next_control_refresh = time.monotonic() + CONTROL_REFRESH_SECONDS
        last_signal_persist = 0.0
        latest_chain: dict[str, Any] = {}
        latest_signal: Signal | None = None
        try:
            while not self._stop_event.is_set() and is_nse_session():
                loop_started = time.monotonic()
                feed_snapshot = feed.snapshot()
                if feed_snapshot.spot:
                    spot_age = max((datetime.now(timezone.utc) - feed_snapshot.spot.observed_at).total_seconds(), 0.0)
                    state.update_feed_spot(feed_snapshot.spot.value, feed_snapshot.spot.observed_at, spot_age)

                now_mono = time.monotonic()
                if now_mono >= next_param_refresh:
                    refreshed = persistence.load_strategy_params()
                    if refreshed != params:
                        params = refreshed
                        engine.update_params(params)
                        persistence.write_activity("info", "strategy", "parameters_reload", "Strategy parameters reloaded", "DB-backed thresholds changed")
                    next_param_refresh = now_mono + PARAM_REFRESH_SECONDS
                    self._set_status(thresholds_updated_at=persistence.parameters_updated_at, opening_no_entry_minutes=params.opening_no_entry_minutes)

                if now_mono >= next_control_refresh:
                    control_state = persistence.load_risk_control()
                    self._kill_switch = bool(control_state.get("kill_switch") or control_state.get("block_new_entries"))
                    self._close_on_kill = bool(control_state.get("close_open_position_on_kill", True))
                    if self._kill_switch and self._close_on_kill and open_position:
                        with self._lock:
                            self._manual_exit_fraction = 1.0
                    next_control_refresh = now_mono + CONTROL_REFRESH_SECONDS
                    self._set_status(kill_switch=self._kill_switch, block_new_entries=self._kill_switch)

                did_quote_scan = False
                if now_mono >= next_quote:
                    successes, quote_errors = self._quote_scan(groww=groww, limiter=limiter, state=state, constituents=constituents, future=future)
                    did_quote_scan = True
                    next_quote = time.monotonic() + self.config.quote_scan_seconds
                    self._set_status(last_quote_scan=datetime.now(timezone.utc).isoformat(), quote_successes=successes, quote_errors=quote_errors[:5])

                if time.monotonic() >= next_option and not self._stop_event.is_set():
                    limiter.wait()
                    latest_chain = dict(groww.get_option_chain(exchange="NSE", underlying="NIFTY", expiry_date=expiry))
                    observed_at = datetime.now(timezone.utc)
                    contracts = parse_option_chain(latest_chain, expiry=expiry, lot_size_for=registry.lot_size_for)
                    state.set_options(contracts, observed_at)
                    next_option = time.monotonic() + self.config.option_refresh_seconds
                    chain_spot = float(latest_chain.get("underlying_ltp") or state.spot_price or 0.0)
                    if chain_spot > 0 and state.spot_price <= 0:
                        state.update_feed_spot(chain_spot, observed_at, 0.0)
                    try:
                        persistence.write_option_chain(contracts, chain_spot, observed_at)
                    except Exception:
                        logger.exception("option telemetry persistence failed")
                    last_exit_reason = None
                    if open_position and latest_chain:
                        open_position, last_exit_reason = self._record_position_marks(persistence, open_position, latest_chain, state.spot_price or chain_spot, risk_state, params, latest_signal, contracts)
                    self._set_status(last_option_refresh=observed_at.isoformat(), option_contract_count=len(contracts), last_exit_reason=last_exit_reason)

                if did_quote_scan and not self._stop_event.is_set():
                    built = state.build_snapshot(max_age_seconds=params.max_data_age_seconds, index_weights=index_weights, heavyweights=heavyweights)
                    if built is not None:
                        snapshot, data_age = built
                        levels = persistence.load_levels()
                        signal = engine.evaluate(snapshot, levels, risk_state, data_age_seconds=data_age)
                        latest_signal = signal
                        persistence.write_nifty_volume_sample(snapshot, signal)
                        try:
                            persistence.write_market_snapshot(snapshot, levels, data_age, params, sectors)
                        except Exception:
                            logger.exception("market detail persistence failed")

                        last_exit_reason = None
                        if open_position and latest_chain:
                            open_position, last_exit_reason = self._record_position_marks(persistence, open_position, latest_chain, snapshot.spot_price, risk_state, params, signal, state.options)

                        actionable = signal.event.value in {"breakout", "reversal"}
                        should_persist = actionable or time.monotonic() - last_signal_persist >= self.config.signal_persist_seconds
                        signal_id: str | None = None
                        if should_persist:
                            signal_id = persistence.write_signal(signal)
                            last_signal_persist = time.monotonic()
                            if actionable:
                                persistence.write_activity("success" if signal.risk.allowed else "warning", "signal-engine", "signal", f"{signal.event.value} · {signal.direction.value}", signal.risk.reason, instrument=signal.contract.contract.trading_symbol if signal.contract.contract else None, metadata={"confidence": signal.confidence})

                        paper_entry = False
                        if signal_id and signal.risk.allowed and open_position is None and not self._kill_switch and paper_entry_window_open(signal.timestamp, params.opening_no_entry_minutes):
                            level_price = next((level.price for level in levels if level.name == signal.level.level_name), None)
                            open_position = persistence.create_paper_order(signal_id, signal, snapshot.spot_price, level_price)
                            open_position.stop_loss_pct = params.exit_stop_loss_pct
                            open_position.profit_target_pct = params.exit_profit_target_pct
                            open_position.trailing_activation_pct = params.exit_trailing_activation_pct
                            open_position.trailing_drawdown_pct = params.exit_trailing_drawdown_pct
                            risk_state.open_position = True
                            risk_state.trades_today += 1
                            risk_state.last_trade_at = signal.timestamp
                            paper_entry = True

                        exposure = open_position.entry_price * open_position.quantity if open_position else 0.0
                        current_position = self.status().get("open_paper_position") if open_position else None
                        if open_position and not current_position:
                            current_position = self._position_status(open_position)
                        self._set_status(
                            state="running", constituents_fresh=state.fresh_constituent_count(max_age_seconds=params.max_data_age_seconds),
                            nifty_ltp=snapshot.spot_price, synthetic_vwap=snapshot.synthetic_vwap,
                            whole_nifty_volume_delta=signal.cash.share_volume_delta, whole_nifty_turnover=signal.cash.turnover_delta,
                            heavyweight_score=signal.cash.heavyweight_score, cash_pressure=signal.cash.pressure,
                            breadth=signal.cash.breadth, participation=signal.cash.participation, future_ltp=snapshot.futures.price,
                            option_direction_score=signal.option_market.score, option_direction_ready=signal.option_market.ready,
                            vwap_score=signal.vwap.score, combined_direction_score=signal.combined_direction_score,
                            data_age_seconds=round(data_age, 3), last_exit_reason=last_exit_reason,
                            account_equity=self.config.account_equity, current_exposure=exposure,
                            available_capital=max(self.config.account_equity - exposure, 0.0), kill_switch=self._kill_switch,
                            block_new_entries=self._kill_switch,
                            last_signal={"event": signal.event.value, "direction": signal.direction.value, "confidence": signal.confidence, "risk_allowed": signal.risk.allowed, "paper_entry": paper_entry, "reason": "kill switch active" if self._kill_switch and signal.risk.allowed else signal.risk.reason},
                            open_paper_position=current_position,
                        )
                    else:
                        self._set_status(state="warming", constituents_fresh=state.fresh_constituent_count(max_age_seconds=params.max_data_age_seconds), nifty_ltp=state.spot_price or None, synthetic_vwap=state.synthetic_vwap)

                elapsed = time.monotonic() - loop_started
                self._stop_event.wait(max(self.config.feed_poll_seconds - elapsed, 0.05))
        finally:
            feed.stop()
            persistence.write_activity("info", "paper-engine", "session_stop", "Paper market session stopped", "Market feed disconnected")
            self._set_status(feed_connected=False)

    def _run(self) -> None:
        try:
            while not self._stop_event.is_set():
                if not is_nse_session():
                    self._set_status(running=True, state="waiting_market", feed_connected=False)
                    self._stop_event.wait(5.0)
                    continue
                try:
                    self._run_session()
                except Exception as exc:
                    logger.exception("live paper engine session failed")
                    self._set_status(state="error", running=True, feed_connected=False, last_error=f"{type(exc).__name__}: {exc}")
                    self._stop_event.wait(5.0)
        finally:
            self._set_status(running=False, state="stopped", feed_connected=False)
