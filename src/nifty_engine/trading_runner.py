from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import logging
import math
import time
from typing import Any

from .engine import SignalEngine
from .execution import BrokerFill, GrowwOrderExecutor, make_order_reference
from .exits import evaluate_dynamic_exit
from .instrument_registry import InstrumentRegistry, load_nifty50_universe
from .market_feed import GrowwLiveFeed
from .market_state import LiveMarketState
from .models import Direction, MarketSnapshot, OptionContract, Signal
from .option_chain import option_ltp, parse_option_chain
from .paper_runner import (
    CONTROL_REFRESH_SECONDS,
    OUTCOME_HORIZONS,
    PARAM_REFRESH_SECONDS,
    OpenPaperPosition,
    PaperEngineRuntime,
    PaperPersistence,
    _parse_datetime,
    _returned_row,
    is_nse_session,
    paper_entry_window_open,
)
from .params import StrategyParams
from .risk import RiskState
from .serialization import to_primitive
from .brokers.groww_data import SlidingWindowRateLimiter

logger = logging.getLogger(__name__)


class TradingPersistence(PaperPersistence):
    def load_execution_control(self) -> dict[str, Any]:
        response = self.client.table("execution_control_state").select(
            "mode,live_armed,max_order_premium,product,order_type,armed_at,updated_at"
        ).eq("id", True).maybe_single().execute()
        row = dict(response.data or {})
        return {
            "mode": str(row.get("mode") or "paper"),
            "live_armed": bool(row.get("live_armed", False)),
            "max_order_premium": float(row.get("max_order_premium") or 0.0),
            "product": str(row.get("product") or "MIS"),
            "order_type": str(row.get("order_type") or "MARKET"),
            "armed_at": row.get("armed_at"),
            "updated_at": row.get("updated_at"),
        }

    def _live_orders_today(self) -> list[dict[str, Any]]:
        start = self._today_start_utc().isoformat()
        response = self.client.table("orders").select(
            "id,signal_id,broker_order_id,order_reference_id,trading_symbol,quantity,status,raw,created_at"
        ).eq("mode", "live").gte("created_at", start).order("created_at", desc=True).execute()
        return list(response.data or [])

    def recover_submitting_entries(self, executor: GrowwOrderExecutor) -> None:
        for row in self._live_orders_today():
            if str(row.get("status")) != "SUBMITTING":
                continue
            reference = str(row.get("order_reference_id") or "")
            if not reference:
                self.client.table("orders").update({"status": "FAILED", "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", row["id"]).execute()
                continue
            fill = executor.recover_by_reference(reference, int(row.get("quantity") or 0))
            if fill is None or not fill.filled:
                self.client.table("orders").update({
                    "status": fill.status if fill is not None else "FAILED",
                    "broker_order_id": fill.groww_order_id if fill is not None else row.get("broker_order_id"),
                    "filled_quantity": fill.filled_quantity if fill is not None else 0,
                    "average_fill_price": fill.average_fill_price if fill is not None and fill.average_fill_price > 0 else None,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", row["id"]).execute()
                continue
            raw = dict(row.get("raw") or {})
            raw.update({"entry_price": fill.average_fill_price, "live_fill": to_primitive(fill), "recovered_after_restart": True})
            self.client.table("orders").update({
                "status": "OPEN", "broker_order_id": fill.groww_order_id,
                "quantity": fill.filled_quantity, "filled_quantity": fill.filled_quantity,
                "average_fill_price": fill.average_fill_price, "raw": raw,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", row["id"]).execute()
            self.write_activity("warning", "live-engine", "live_entry_recovered", "Recovered live entry after restart", reference, instrument=str(row.get("trading_symbol") or ""))

    def recover_pending_exits(self, executor: GrowwOrderExecutor) -> None:
        for row in self._live_orders_today():
            if str(row.get("status")) != "OPEN":
                continue
            raw = dict(row.get("raw") or {})
            reference = str(raw.get("pending_exit_reference") or "")
            requested = int(raw.get("pending_exit_quantity") or 0)
            if not reference or requested <= 0:
                continue
            fill = executor.recover_by_reference(reference, requested)
            if fill is None:
                raw.pop("pending_exit_reference", None)
                raw.pop("pending_exit_quantity", None)
                raw.pop("pending_exit_reason", None)
                self.client.table("orders").update({"raw": raw, "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", row["id"]).execute()
                self.write_activity("warning", "live-engine", "stale_exit_intent", "Cleared unsubmitted live exit intent", reference, instrument=str(row.get("trading_symbol") or ""))
                continue
            if not fill.filled:
                raw["last_exit_attempt"] = to_primitive(fill)
                raw.pop("pending_exit_reference", None)
                raw.pop("pending_exit_quantity", None)
                raw.pop("pending_exit_reason", None)
                self.client.table("orders").update({"raw": raw, "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", row["id"]).execute()
                continue
            current_quantity = int(row.get("quantity") or 0)
            actual_exit = min(fill.filled_quantity, current_quantity)
            entry_price = float(raw.get("entry_price") or row.get("average_fill_price") or 0.0)
            pnl = (fill.average_fill_price - entry_price) * actual_exit
            self.client.table("trades").insert({
                "order_id": row["id"], "trading_symbol": row["trading_symbol"], "quantity": actual_exit,
                "fill_price": fill.average_fill_price, "pnl": pnl,
                "raw": {"side": "SELL", "mode": "live", "exit_reason": raw.get("pending_exit_reason") or "recovered_exit", "entry_price": entry_price,
                        "broker_order_id": fill.groww_order_id, "order_reference_id": fill.order_reference_id, "recovered_after_restart": True},
                "executed_at": datetime.now(timezone.utc).isoformat(),
            }).execute()
            remaining = current_quantity - actual_exit
            raw.pop("pending_exit_reference", None)
            raw.pop("pending_exit_quantity", None)
            raw.pop("pending_exit_reason", None)
            raw["last_exit_fill"] = to_primitive(fill)
            self.client.table("orders").update({
                "status": "CLOSED" if remaining <= 0 else "OPEN", "quantity": max(remaining, 0), "raw": raw,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", row["id"]).execute()
            self.write_activity("warning", "live-engine", "live_exit_recovered", "Recovered live exit after restart", f"{actual_exit} @ {fill.average_fill_price:.2f}", instrument=str(row.get("trading_symbol") or ""))

    def restore_risk_state_for_mode(self, mode: str) -> tuple[RiskState, OpenPaperPosition | None]:
        if mode == "paper":
            return super().restore_risk_state()
        orders = self._live_orders_today()
        order_ids = [str(row["id"]) for row in orders]
        trades: list[dict[str, Any]] = []
        if order_ids:
            response = self.client.table("trades").select("order_id,pnl,executed_at").in_("order_id", order_ids).order("executed_at", desc=True).execute()
            trades = list(response.data or [])
        realized = sum(float(row.get("pnl") or 0.0) for row in trades)
        consecutive_losses = 0
        for row in trades:
            if float(row.get("pnl") or 0.0) < 0:
                consecutive_losses += 1
            else:
                break
        last_trade_at = _parse_datetime(orders[0].get("created_at")) if orders else None
        open_row = next((row for row in orders if str(row.get("status")) == "OPEN" and int(row.get("quantity") or 0) > 0), None)
        position: OpenPaperPosition | None = None
        if open_row:
            raw = dict(open_row.get("raw") or {})
            opened_at = _parse_datetime(open_row.get("created_at"))
            if opened_at:
                direction_text = str(raw.get("entry_direction") or "flat")
                direction = Direction(direction_text) if direction_text in {item.value for item in Direction} else Direction.FLAT
                entry_price = float(raw.get("entry_price") or open_row.get("average_fill_price") or 0.0)
                position = OpenPaperPosition(
                    order_id=str(open_row["id"]), signal_id=str(open_row.get("signal_id") or ""), trading_symbol=str(open_row["trading_symbol"]),
                    quantity=int(open_row["quantity"]), entry_price=entry_price, entry_nifty=float(raw.get("entry_nifty") or 0.0), opened_at=opened_at,
                    recorded_horizons=set(), entry_direction=direction, entry_level_name=str(raw["entry_level_name"]) if raw.get("entry_level_name") else None,
                    entry_level_price=float(raw["entry_level_price"]) if raw.get("entry_level_price") is not None else None,
                    best_price=float(raw.get("best_price") or entry_price), original_quantity=int(raw.get("original_quantity") or open_row["quantity"]),
                    stop_loss_pct=float(raw["stop_loss_pct"]) if raw.get("stop_loss_pct") is not None else None,
                    profit_target_pct=float(raw["profit_target_pct"]) if raw.get("profit_target_pct") is not None else None,
                    trailing_activation_pct=float(raw["trailing_activation_pct"]) if raw.get("trailing_activation_pct") is not None else None,
                    trailing_drawdown_pct=float(raw["trailing_drawdown_pct"]) if raw.get("trailing_drawdown_pct") is not None else None,
                )
        state = RiskState(account_equity=self.account_equity, realized_pnl_today=realized, trades_today=len(orders), consecutive_losses=consecutive_losses, last_trade_at=last_trade_at, open_position=position is not None)
        return state, position

    def create_live_order(
        self,
        signal_id: str,
        signal: Signal,
        nifty_ltp: float,
        level_price: float | None,
        executor: GrowwOrderExecutor,
        *,
        max_order_premium: float,
        available_margin: float,
    ) -> OpenPaperPosition:
        contract = signal.contract.contract
        if contract is None or signal.risk.quantity <= 0:
            raise RuntimeError("cannot create a live order without an eligible contract/quantity")
        if max_order_premium <= 0:
            raise RuntimeError("live max order premium must be configured above zero")
        lot = max(int(contract.lot_size), 1)
        premium_per_lot = contract.ltp * lot
        if premium_per_lot <= 0:
            raise RuntimeError("invalid option premium or lot size")
        cap_lots = math.floor(max_order_premium / premium_per_lot)
        margin_lots = math.floor(max(available_margin, 0.0) / premium_per_lot)
        risk_lots = signal.risk.quantity // lot
        lots = min(cap_lots, margin_lots, risk_lots)
        if lots < 1:
            raise RuntimeError("live premium cap / Groww option-buy margin cannot fund one lot")
        quantity = lots * lot
        level = getattr(signal, "level", None)
        position = OpenPaperPosition(
            order_id="", signal_id=signal_id, trading_symbol=contract.trading_symbol, quantity=quantity,
            entry_price=contract.ltp, entry_nifty=nifty_ltp, opened_at=signal.timestamp, recorded_horizons=set(),
            entry_direction=signal.direction, entry_level_name=getattr(level, "level_name", None), entry_level_price=level_price,
            best_price=contract.ltp, original_quantity=quantity,
        )
        reference = make_order_reference("GT", signal_id)
        raw = self._position_raw(position) | {
            "mode": "live", "signal_event": signal.event.value, "signal_direction": signal.direction.value,
            "confidence": signal.confidence, "option_score": signal.contract.score,
            "requested_price": contract.ltp, "max_order_premium": max_order_premium,
        }
        response = self.client.table("orders").insert({
            "signal_id": signal_id, "mode": "live", "trading_symbol": contract.trading_symbol,
            "side": "BUY", "quantity": quantity, "status": "SUBMITTING", "order_reference_id": reference,
            "raw": raw,
        }).select("id,created_at").execute()
        row = _returned_row(response, "live order reservation")
        position.order_id = str(row["id"])
        position.opened_at = _parse_datetime(row.get("created_at")) or signal.timestamp
        try:
            fill = executor.submit_market_option(trading_symbol=contract.trading_symbol, quantity=quantity, side="BUY", order_reference_id=reference)
        except Exception as exc:
            self.client.table("orders").update({"status": "FAILED", "raw": raw | {"submit_error": f"{type(exc).__name__}: {exc}"}, "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", position.order_id).execute()
            raise
        if not fill.filled:
            self.client.table("orders").update({
                "status": fill.status or "FAILED", "broker_order_id": fill.groww_order_id,
                "filled_quantity": fill.filled_quantity, "average_fill_price": fill.average_fill_price or None,
                "raw": raw | {"live_fill": to_primitive(fill)}, "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", position.order_id).execute()
            raise RuntimeError(f"Groww live entry was not filled: {fill.status}")
        position.quantity = fill.filled_quantity
        position.original_quantity = fill.filled_quantity
        position.entry_price = fill.average_fill_price
        position.best_price = fill.average_fill_price
        raw = self._position_raw(position) | raw | {"entry_price": fill.average_fill_price, "live_fill": to_primitive(fill)}
        self.client.table("orders").update({
            "status": "OPEN", "broker_order_id": fill.groww_order_id, "quantity": fill.filled_quantity,
            "filled_quantity": fill.filled_quantity, "average_fill_price": fill.average_fill_price,
            "raw": raw, "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", position.order_id).execute()
        self.write_activity("critical", "live-engine", "live_entry", "LIVE position opened", f"{position.quantity} × {position.trading_symbol} @ {position.entry_price:.2f}", instrument=position.trading_symbol, metadata={"broker_order_id": fill.groww_order_id})
        return position

    def reduce_live_order(
        self,
        position: OpenPaperPosition,
        *,
        executor: GrowwOrderExecutor,
        observed_at: datetime,
        exit_reason: str,
        fraction: float = 1.0,
    ) -> tuple[float, bool, BrokerFill]:
        fraction = min(max(float(fraction), 0.01), 1.0)
        exit_quantity = position.quantity if fraction >= 0.999 else max(1, min(position.quantity, int(math.ceil(position.quantity * fraction))))
        reference = make_order_reference("LX", f"{position.quantity}{position.order_id}")
        pending_raw = self._position_raw(position) | {
            "mode": "live", "pending_exit_reference": reference, "pending_exit_quantity": exit_quantity,
            "pending_exit_reason": exit_reason,
        }
        self.client.table("orders").update({"raw": pending_raw, "updated_at": observed_at.isoformat()}).eq("id", position.order_id).execute()
        fill = executor.submit_market_option(trading_symbol=position.trading_symbol, quantity=exit_quantity, side="SELL", order_reference_id=reference)
        if not fill.filled:
            clean = dict(pending_raw)
            clean.pop("pending_exit_reference", None); clean.pop("pending_exit_quantity", None); clean.pop("pending_exit_reason", None)
            clean["last_exit_attempt"] = to_primitive(fill)
            self.client.table("orders").update({"raw": clean, "updated_at": observed_at.isoformat()}).eq("id", position.order_id).execute()
            raise RuntimeError(f"Groww live exit was not filled: {fill.status}")
        actual_exit = min(fill.filled_quantity, position.quantity)
        pnl = (fill.average_fill_price - position.entry_price) * actual_exit
        remaining = position.quantity - actual_exit
        self.client.table("trades").insert({
            "order_id": position.order_id, "trading_symbol": position.trading_symbol, "quantity": actual_exit,
            "fill_price": fill.average_fill_price, "pnl": pnl,
            "raw": {"side": "SELL", "mode": "live", "exit_policy": "dynamic_scalp", "exit_reason": exit_reason,
                    "entry_price": position.entry_price, "best_price": position.best_price,
                    "broker_order_id": fill.groww_order_id, "order_reference_id": fill.order_reference_id},
            "executed_at": observed_at.isoformat(),
        }).execute()
        clean = self._position_raw(position) | {"mode": "live", "last_exit_fill": to_primitive(fill)}
        if remaining <= 0:
            clean.update({"exit_reason": exit_reason, "exit_price": fill.average_fill_price, "closed_at": observed_at.isoformat()})
            self.client.table("orders").update({"status": "CLOSED", "quantity": 0, "raw": clean, "updated_at": observed_at.isoformat()}).eq("id", position.order_id).execute()
            self.write_activity("critical", "live-engine", "live_exit", "LIVE position closed", f"{exit_reason}: P&L {pnl:.2f}", instrument=position.trading_symbol, metadata={"broker_order_id": fill.groww_order_id})
            return pnl, True, fill
        position.quantity = remaining
        self.client.table("orders").update({"quantity": remaining, "raw": clean, "updated_at": observed_at.isoformat()}).eq("id", position.order_id).execute()
        self.write_activity("warning", "live-engine", "live_partial_exit", "LIVE position reduced", f"Exited {actual_exit}; {remaining} remain", instrument=position.trading_symbol)
        return pnl, False, fill


class TradingEngineRuntime(PaperEngineRuntime):
    """The existing market/signal runtime with selectable PAPER or armed LIVE execution."""

    def __init__(self, control: Any, **kwargs: Any) -> None:
        super().__init__(control, **kwargs)
        self._execution_mode = "paper"
        self._live_armed = False
        self._max_order_premium = 0.0
        self._executor: GrowwOrderExecutor | None = None

    def _record_position_marks_mode(
        self,
        persistence: TradingPersistence,
        position: OpenPaperPosition | None,
        chain: dict[str, Any],
        nifty_ltp: float,
        risk_state: RiskState,
        params: StrategyParams,
        signal: Signal | None,
        options: tuple[OptionContract, ...] = (),
    ) -> tuple[OpenPaperPosition | None, str | None]:
        if position is None or self._execution_mode == "paper":
            return super()._record_position_marks(persistence, position, chain, nifty_ltp, risk_state, params, signal, options)
        if self._executor is None:
            raise RuntimeError("live order executor is unavailable")
        self._apply_overrides(position)
        now = datetime.now(timezone.utc)
        price = option_ltp(chain, position.trading_symbol)
        contract = next((item for item in options if item.trading_symbol == position.trading_symbol), None)
        if price is None:
            self._set_status(open_position=self._position_status(position, contract=contract), open_paper_position=self._position_status(position, contract=contract))
            return position, None
        position.best_price = max(position.best_price, price)
        with self._lock:
            manual_fraction = self._manual_exit_fraction
            if manual_fraction is not None:
                self._manual_exit_fraction = None
        if manual_fraction is not None:
            pnl, closed, _fill = persistence.reduce_live_order(position, executor=self._executor, observed_at=now, exit_reason="manual_exit", fraction=manual_fraction)
            risk_state.realized_pnl_today += pnl
            if closed:
                risk_state.open_position = False
                risk_state.consecutive_losses = risk_state.consecutive_losses + 1 if pnl < 0 else 0
                self._set_status(open_position=None, open_paper_position=None, last_exit_reason="manual_exit")
                return None, "manual_exit"
            current = self._position_status(position, current_price=price, contract=contract)
            self._set_status(open_position=current, open_paper_position=current, last_exit_reason="partial_manual_exit")
            return position, "partial_manual_exit"
        exit_params = replace(
            params,
            exit_stop_loss_pct=position.stop_loss_pct if position.stop_loss_pct is not None else params.exit_stop_loss_pct,
            exit_profit_target_pct=position.profit_target_pct if position.profit_target_pct is not None else params.exit_profit_target_pct,
            exit_trailing_activation_pct=position.trailing_activation_pct if position.trailing_activation_pct is not None else params.exit_trailing_activation_pct,
            exit_trailing_drawdown_pct=position.trailing_drawdown_pct if position.trailing_drawdown_pct is not None else params.exit_trailing_drawdown_pct,
        )
        decision = evaluate_dynamic_exit(now=now, opened_at=position.opened_at, entry_price=position.entry_price, best_price=position.best_price, option_price=price, nifty_ltp=nifty_ltp, entry_direction=position.entry_direction, entry_level_price=position.entry_level_price, signal=signal, params=exit_params)
        current = self._position_status(position, current_price=price, contract=contract)
        self._set_status(open_position=current, open_paper_position=current)
        if not decision.should_exit:
            return position, None
        pnl, _closed, _fill = persistence.reduce_live_order(position, executor=self._executor, observed_at=now, exit_reason=decision.reason, fraction=1.0)
        risk_state.realized_pnl_today += pnl
        risk_state.open_position = False
        risk_state.consecutive_losses = risk_state.consecutive_losses + 1 if pnl < 0 else 0
        self._set_status(open_position=None, open_paper_position=None)
        return None, decision.reason

    def _run_session(self) -> None:
        if self._client_factory is None:
            raise RuntimeError("trading engine client factory is not configured")
        groww, _profile = self._client_factory()
        today = datetime.now().astimezone().date()
        registry = InstrumentRegistry(groww, today=today)
        universe = load_nifty50_universe()
        constituents = registry.resolve_constituents(universe.symbols)
        index = registry.nifty_index()
        future = registry.nearest_nifty_future()
        expiry = registry.nearest_nifty_option_expiry()
        feed = GrowwLiveFeed(groww, constituents, index, future)
        state = LiveMarketState()
        persistence = TradingPersistence(self.control.client, self.config.account_equity)
        self.config = persistence.load_runtime_config(self.config)
        execution = persistence.load_execution_control()
        self._execution_mode = execution["mode"] if execution["mode"] in {"paper", "live"} else "paper"
        self._live_armed = bool(execution["live_armed"])
        self._max_order_premium = float(execution["max_order_premium"])
        if self._execution_mode == "live":
            if not self._live_armed:
                raise RuntimeError("LIVE mode is selected but live trading is not armed")
            if self._max_order_premium <= 0:
                raise RuntimeError("LIVE mode requires a positive max order premium")
            if str(execution.get("order_type")) != "MARKET":
                raise RuntimeError("only MARKET live execution is currently supported")
            self._executor = GrowwOrderExecutor(groww, product=str(execution.get("product") or "MIS"))
            live_margin = self._executor.available_option_buy_margin()
            persistence.account_equity = max(live_margin, 1.0)
            persistence.recover_submitting_entries(self._executor)
            persistence.recover_pending_exits(self._executor)
        else:
            self._executor = None
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
        risk_state, open_position = persistence.restore_risk_state_for_mode(self._execution_mode)
        if self._execution_mode == "live" and open_position and self._executor:
            broker_quantity = self._executor.broker_position_quantity(open_position.trading_symbol)
            if broker_quantity is None or broker_quantity != open_position.quantity:
                persistence.client.table("risk_control_state").update({
                    "kill_switch": True, "block_new_entries": True,
                    "reason": f"LIVE position reconciliation mismatch for {open_position.trading_symbol}: DB={open_position.quantity}, broker={broker_quantity}",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", True).execute()
                raise RuntimeError(f"live position reconciliation mismatch: DB={open_position.quantity}, broker={broker_quantity}")
        limiter = SlidingWindowRateLimiter(max_per_second=8, max_per_minute=220)
        feed.start()
        component = "live-engine" if self._execution_mode == "live" else "paper-engine"
        persistence.write_activity("critical" if self._execution_mode == "live" else "info", component, "session_start", f"{self._execution_mode.upper()} market session started", f"{len(constituents)} NIFTY constituents resolved")
        account_equity = risk_state.account_equity
        self._set_status(
            running=True, state="warming", mode=self._execution_mode, live_armed=self._live_armed,
            max_order_premium=self._max_order_premium, feed_connected=True, universe_as_of=universe.as_of, weighting=weighting,
            account_equity=account_equity, available_capital=account_equity,
            constituents_total=50, constituents_resolved=len(constituents), constituents_fresh=0,
            future_symbol=future.trading_symbol, future_ltp=None, nifty_ltp=None, synthetic_vwap=None,
            whole_nifty_volume_delta=0, whole_nifty_turnover=0.0, option_expiry=expiry, option_contract_count=0,
            thresholds_updated_at=persistence.parameters_updated_at, opening_no_entry_minutes=params.opening_no_entry_minutes,
            kill_switch=self._kill_switch, block_new_entries=self._kill_switch, last_exit_reason=None,
            open_position=self._position_status(open_position), open_paper_position=self._position_status(open_position),
            runtime_settings={"quote_scan_seconds": self.config.quote_scan_seconds, "option_refresh_seconds": self.config.option_refresh_seconds, "feed_poll_seconds": self.config.feed_poll_seconds, "signal_persist_seconds": self.config.signal_persist_seconds},
        )
        next_quote = 0.0; next_option = 0.0
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
                        params = refreshed; engine.update_params(params)
                        persistence.write_activity("info", "strategy", "parameters_reload", "Strategy parameters reloaded", "DB-backed thresholds changed")
                    next_param_refresh = now_mono + PARAM_REFRESH_SECONDS
                    self._set_status(thresholds_updated_at=persistence.parameters_updated_at, opening_no_entry_minutes=params.opening_no_entry_minutes)
                if now_mono >= next_control_refresh:
                    control_state = persistence.load_risk_control()
                    self._kill_switch = bool(control_state.get("kill_switch") or control_state.get("block_new_entries"))
                    self._close_on_kill = bool(control_state.get("close_open_position_on_kill", True))
                    execution = persistence.load_execution_control()
                    self._live_armed = bool(execution["live_armed"])
                    if self._execution_mode == "live" and not self._live_armed:
                        self._kill_switch = True
                    if self._kill_switch and self._close_on_kill and open_position:
                        with self._lock: self._manual_exit_fraction = 1.0
                    if self._execution_mode == "live" and self._executor:
                        available = self._executor.available_option_buy_margin()
                        risk_state.account_equity = max(available + max(risk_state.realized_pnl_today, 0.0), 1.0)
                    next_control_refresh = now_mono + CONTROL_REFRESH_SECONDS
                    self._set_status(kill_switch=self._kill_switch, block_new_entries=self._kill_switch, live_armed=self._live_armed)
                did_quote_scan = False
                if now_mono >= next_quote:
                    successes, quote_errors = self._quote_scan(groww=groww, limiter=limiter, state=state, constituents=constituents, future=future)
                    did_quote_scan = True; next_quote = time.monotonic() + self.config.quote_scan_seconds
                    self._set_status(last_quote_scan=datetime.now(timezone.utc).isoformat(), quote_successes=successes, quote_errors=quote_errors[:5])
                if time.monotonic() >= next_option and not self._stop_event.is_set():
                    limiter.wait(); latest_chain = dict(groww.get_option_chain(exchange="NSE", underlying="NIFTY", expiry_date=expiry))
                    observed_at = datetime.now(timezone.utc)
                    contracts = parse_option_chain(latest_chain, expiry=expiry, lot_size_for=registry.lot_size_for)
                    state.set_options(contracts, observed_at); next_option = time.monotonic() + self.config.option_refresh_seconds
                    chain_spot = float(latest_chain.get("underlying_ltp") or state.spot_price or 0.0)
                    if chain_spot > 0 and state.spot_price <= 0: state.update_feed_spot(chain_spot, observed_at, 0.0)
                    try: persistence.write_option_chain(contracts, chain_spot, observed_at)
                    except Exception: logger.exception("option telemetry persistence failed")
                    last_exit_reason = None
                    if open_position and latest_chain:
                        open_position, last_exit_reason = self._record_position_marks_mode(persistence, open_position, latest_chain, state.spot_price or chain_spot, risk_state, params, latest_signal, contracts)
                    self._set_status(last_option_refresh=observed_at.isoformat(), option_contract_count=len(contracts), last_exit_reason=last_exit_reason)
                if did_quote_scan and not self._stop_event.is_set():
                    built = state.build_snapshot(max_age_seconds=params.max_data_age_seconds, index_weights=index_weights, heavyweights=heavyweights)
                    if built is not None:
                        snapshot, data_age = built
                        levels = persistence.load_levels(); signal = engine.evaluate(snapshot, levels, risk_state, data_age_seconds=data_age); latest_signal = signal
                        persistence.write_nifty_volume_sample(snapshot, signal)
                        try: persistence.write_market_snapshot(snapshot, levels, data_age, params, sectors)
                        except Exception: logger.exception("market detail persistence failed")
                        last_exit_reason = None
                        if open_position and latest_chain:
                            open_position, last_exit_reason = self._record_position_marks_mode(persistence, open_position, latest_chain, snapshot.spot_price, risk_state, params, signal, state.options)
                        actionable = signal.event.value in {"breakout", "reversal"}
                        should_persist = actionable or time.monotonic() - last_signal_persist >= self.config.signal_persist_seconds
                        signal_id: str | None = None
                        if should_persist:
                            signal_id = persistence.write_signal(signal); last_signal_persist = time.monotonic()
                            if actionable: persistence.write_activity("success" if signal.risk.allowed else "warning", "signal-engine", "signal", f"{signal.event.value} · {signal.direction.value}", signal.risk.reason, instrument=signal.contract.contract.trading_symbol if signal.contract.contract else None, metadata={"confidence": signal.confidence, "mode": self._execution_mode})
                        entered = False
                        if signal_id and signal.risk.allowed and open_position is None and not self._kill_switch and paper_entry_window_open(signal.timestamp, params.opening_no_entry_minutes):
                            level_price = next((level.price for level in levels if level.name == signal.level.level_name), None)
                            if self._execution_mode == "live":
                                if not self._live_armed or not self._executor: raise RuntimeError("live execution became disarmed")
                                available_margin = self._executor.available_option_buy_margin()
                                open_position = persistence.create_live_order(signal_id, signal, snapshot.spot_price, level_price, self._executor, max_order_premium=self._max_order_premium, available_margin=available_margin)
                            else:
                                open_position = persistence.create_paper_order(signal_id, signal, snapshot.spot_price, level_price)
                            open_position.stop_loss_pct = params.exit_stop_loss_pct; open_position.profit_target_pct = params.exit_profit_target_pct
                            open_position.trailing_activation_pct = params.exit_trailing_activation_pct; open_position.trailing_drawdown_pct = params.exit_trailing_drawdown_pct
                            risk_state.open_position = True; risk_state.trades_today += 1; risk_state.last_trade_at = signal.timestamp; entered = True
                        exposure = open_position.entry_price * open_position.quantity if open_position else 0.0
                        current_position = self.status().get("open_position") if open_position else None
                        if open_position and not current_position: current_position = self._position_status(open_position)
                        available_capital = max(risk_state.account_equity - exposure, 0.0) if self._execution_mode == "paper" else (self._executor.available_option_buy_margin() if self._executor else 0.0)
                        self._set_status(
                            state="running", mode=self._execution_mode, constituents_fresh=state.fresh_constituent_count(max_age_seconds=params.max_data_age_seconds),
                            nifty_ltp=snapshot.spot_price, synthetic_vwap=snapshot.synthetic_vwap, whole_nifty_volume_delta=signal.cash.share_volume_delta,
                            whole_nifty_turnover=signal.cash.turnover_delta, heavyweight_score=signal.cash.heavyweight_score, cash_pressure=signal.cash.pressure,
                            breadth=signal.cash.breadth, participation=signal.cash.participation, future_ltp=snapshot.futures.price,
                            option_direction_score=signal.option_market.score, option_direction_ready=signal.option_market.ready, vwap_score=signal.vwap.score,
                            combined_direction_score=signal.combined_direction_score, data_age_seconds=round(data_age, 3), last_exit_reason=last_exit_reason,
                            account_equity=risk_state.account_equity, current_exposure=exposure, available_capital=available_capital,
                            kill_switch=self._kill_switch, block_new_entries=self._kill_switch,
                            last_signal={"event": signal.event.value, "direction": signal.direction.value, "confidence": signal.confidence, "risk_allowed": signal.risk.allowed, "entry": entered, "mode": self._execution_mode, "reason": "kill switch active" if self._kill_switch and signal.risk.allowed else signal.risk.reason},
                            open_position=current_position, open_paper_position=current_position,
                        )
                    else:
                        self._set_status(state="warming", constituents_fresh=state.fresh_constituent_count(max_age_seconds=params.max_data_age_seconds), nifty_ltp=state.spot_price or None, synthetic_vwap=state.synthetic_vwap)
                elapsed = time.monotonic() - loop_started
                self._stop_event.wait(max(self.config.feed_poll_seconds - elapsed, 0.05))
        finally:
            feed.stop(); persistence.write_activity("critical" if self._execution_mode == "live" else "info", component, "session_stop", f"{self._execution_mode.upper()} market session stopped", "Market feed disconnected")
            self._set_status(feed_connected=False)
