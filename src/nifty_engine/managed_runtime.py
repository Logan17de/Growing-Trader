from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import logging
import threading
import time
from typing import Any, Callable, Iterable

from .brokers.groww_data import SlidingWindowRateLimiter
from .engine import SignalEngine
from .exits import evaluate_dynamic_exit
from .instrument_registry import InstrumentRegistry, load_nifty50_universe
from .market_feed import GrowwLiveFeed
from .market_state import LiveMarketState
from .models import (
    ConstituentTick,
    Direction,
    FuturesTick,
    LevelKind,
    MarketSnapshot,
    OptionContract,
    OptionGreeks,
    OptionType,
    Signal,
    SupportResistanceLevel,
)
from .option_chain import option_ltp, parse_option_chain
from .paper_runner import (
    IST,
    OUTCOME_HORIZONS,
    OpenPaperPosition,
    PaperEngineRuntime,
    PaperPersistence,
    is_nse_session,
    paper_entry_window_open,
)
from .params import StrategyParams
from .risk import RiskState
from .serialization import to_primitive

logger = logging.getLogger(__name__)
CONTROL_REFRESH_SECONDS = 10.0


def _record(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _number(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed


def _parse_datetime(value: Any) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def snapshot_from_primitive(payload: dict[str, Any]) -> MarketSnapshot:
    constituents = tuple(
        ConstituentTick(
            symbol=str(item["symbol"]),
            price=float(item["price"]),
            previous_price=float(item["previous_price"]),
            cumulative_volume=int(item["cumulative_volume"]),
            previous_cumulative_volume=int(item["previous_cumulative_volume"]),
            baseline_volume_rate=float(item["baseline_volume_rate"]),
            previous_volume_rate=float(item["previous_volume_rate"]),
            seconds_elapsed=float(item["seconds_elapsed"]),
            index_weight=float(item.get("index_weight", 1.0)),
            is_heavyweight=bool(item.get("is_heavyweight", False)),
        )
        for item in payload.get("constituents", [])
    )
    future = payload["futures"]
    futures = FuturesTick(
        symbol=str(future["symbol"]),
        price=float(future["price"]),
        previous_price=float(future["previous_price"]),
        volume=int(future["volume"]),
        previous_volume=int(future["previous_volume"]),
        baseline_volume_rate=float(future["baseline_volume_rate"]),
        seconds_elapsed=float(future["seconds_elapsed"]),
        open_interest=float(future["open_interest"]),
        previous_open_interest=float(future["previous_open_interest"]),
        spot_price=float(future["spot_price"]),
        previous_spot_price=float(future["previous_spot_price"]),
    )
    options: list[OptionContract] = []
    for item in payload.get("options", []):
        greeks = item["greeks"]
        options.append(
            OptionContract(
                trading_symbol=str(item["trading_symbol"]),
                option_type=OptionType(str(item["option_type"])),
                strike=float(item["strike"]),
                expiry=str(item["expiry"]),
                ltp=float(item["ltp"]),
                open_interest=int(item["open_interest"]),
                volume=int(item["volume"]),
                lot_size=int(item["lot_size"]),
                greeks=OptionGreeks(
                    float(greeks["delta"]), float(greeks["gamma"]), float(greeks["theta"]),
                    float(greeks["vega"]), float(greeks["rho"]), float(greeks["iv"]),
                ),
                bid_price=float(item["bid_price"]) if item.get("bid_price") is not None else None,
                ask_price=float(item["ask_price"]) if item.get("ask_price") is not None else None,
            )
        )
    return MarketSnapshot(
        timestamp=_parse_datetime(payload["timestamp"]),
        spot_price=float(payload["spot_price"]),
        previous_spot_price=float(payload["previous_spot_price"]),
        constituents=constituents,
        futures=futures,
        options=tuple(options),
        synthetic_vwap=float(payload["synthetic_vwap"]) if payload.get("synthetic_vwap") is not None else None,
    )


def levels_from_primitive(items: Iterable[dict[str, Any]]) -> tuple[SupportResistanceLevel, ...]:
    return tuple(
        SupportResistanceLevel(
            name=str(item["name"]),
            kind=LevelKind(str(item["kind"])),
            price=float(item["price"]),
            source=str(item.get("source", "replay")),
            enabled=bool(item.get("enabled", True)),
        )
        for item in items
    )


class ManagedPaperEngineRuntime(PaperEngineRuntime):
    """Paper-only runtime with terminal controls, persisted market frames and replay."""

    def __init__(self, control: Any, **kwargs: Any) -> None:
        super().__init__(control, **kwargs)
        self._position_lock = threading.RLock()
        self._persistence: PaperPersistence | None = None
        self._risk_state: RiskState | None = None
        self._open_position: OpenPaperPosition | None = None
        self._latest_chain: dict[str, Any] = {}
        self._latest_contracts: tuple[OptionContract, ...] = ()
        self._latest_signal: Signal | None = None
        self._latest_spot = 0.0
        self._params = StrategyParams()
        self._strategy_enabled = True
        self._strategy_version = 1
        self._kill_switch = False
        self._kill_reason: str | None = None
        self._manual_stop_price: float | None = None
        self._trailing_enabled: bool | None = None
        self._trailing_activation_pct: float | None = None
        self._trailing_drawdown_pct: float | None = None
        self._order_meta: dict[str, Any] = {}
        self._settings = self._default_settings()

    def _default_settings(self) -> dict[str, float]:
        return {
            "account_equity": self.config.account_equity,
            "quote_scan_seconds": self.config.quote_scan_seconds,
            "option_refresh_seconds": self.config.option_refresh_seconds,
            "feed_poll_seconds": self.config.feed_poll_seconds,
            "signal_persist_seconds": self.config.signal_persist_seconds,
            "paper_slippage_bps": 0.0,
            "paper_fee_rate_pct": 0.0,
        }

    def _write_event(
        self,
        severity: str,
        component: str,
        event_type: str,
        message: str,
        detail: str = "",
        *,
        instrument: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        try:
            self.control.client.table("runtime_events").insert(
                {
                    "observed_at": datetime.now(timezone.utc).isoformat(),
                    "severity": severity,
                    "component": component,
                    "event_type": event_type,
                    "message": message,
                    "detail": detail,
                    "instrument": instrument,
                    "metadata": metadata or {},
                }
            ).execute()
        except Exception:
            logger.debug("runtime event persistence unavailable", exc_info=True)

    def _load_settings(self) -> dict[str, float]:
        settings = self._default_settings()
        try:
            response = self.control.client.table("engine_settings").select("key,value").execute()
            for row in response.data or []:
                key = str(row.get("key"))
                if key in settings:
                    settings[key] = float(row.get("value"))
        except Exception:
            logger.warning("engine_settings unavailable; using environment defaults", exc_info=True)
        return settings

    def _load_controls(self, risk_state: RiskState | None = None) -> None:
        self._settings = self._load_settings()
        try:
            strategy = (
                self.control.client.table("strategy_runtime_state")
                .select("enabled,version")
                .eq("strategy_id", "level-event")
                .maybe_single().execute().data
            )
            if strategy:
                self._strategy_enabled = bool(strategy.get("enabled", True))
                self._strategy_version = int(strategy.get("version") or 1)
        except Exception:
            self._strategy_enabled = True
            self._strategy_version = 1
        try:
            control = (
                self.control.client.table("risk_control_state")
                .select("kill_switch_enabled,reason")
                .eq("worker_id", "oracle-primary")
                .maybe_single().execute().data
            )
            if control:
                self._kill_switch = bool(control.get("kill_switch_enabled", False))
                self._kill_reason = str(control.get("reason")) if control.get("reason") else None
        except Exception:
            self._kill_switch = False
            self._kill_reason = None
        if risk_state is not None:
            risk_state.account_equity = self._settings["account_equity"]
            if self._kill_switch:
                risk_state.external_block_reason = "kill switch enabled"
            elif not self._strategy_enabled:
                risk_state.external_block_reason = "strategy deactivated"
            else:
                risk_state.external_block_reason = None

    def _load_order_overrides(self, position: OpenPaperPosition | None) -> None:
        self._manual_stop_price = None
        self._trailing_enabled = None
        self._trailing_activation_pct = None
        self._trailing_drawdown_pct = None
        self._order_meta = {}
        if position is None:
            return
        try:
            row = (
                self.control.client.table("orders").select("raw")
                .eq("id", position.order_id).maybe_single().execute().data
            )
            raw = _record(row.get("raw")) if row else {}
            self._order_meta = dict(raw)
            if raw.get("manual_stop_price") is not None:
                self._manual_stop_price = float(raw["manual_stop_price"])
            if raw.get("trailing_enabled") is not None:
                self._trailing_enabled = bool(raw["trailing_enabled"])
            if raw.get("trailing_activation_pct") is not None:
                self._trailing_activation_pct = float(raw["trailing_activation_pct"])
            if raw.get("trailing_drawdown_pct") is not None:
                self._trailing_drawdown_pct = float(raw["trailing_drawdown_pct"])
        except Exception:
            logger.warning("could not restore paper protection overrides", exc_info=True)

    def _position_contract(self) -> OptionContract | None:
        if self._open_position is None:
            return None
        return next(
            (item for item in self._latest_contracts if item.trading_symbol == self._open_position.trading_symbol),
            None,
        )

    def _position_mark(self) -> float | None:
        if self._open_position is None:
            return None
        price = option_ltp(self._latest_chain, self._open_position.trading_symbol) if self._latest_chain else None
        if price is not None:
            return float(price)
        contract = self._position_contract()
        return contract.ltp if contract else None

    def _managed_raw(self, position: OpenPaperPosition) -> dict[str, Any]:
        raw = dict(self._order_meta)
        raw.update(
            {
                "entry_price": position.entry_price,
                "entry_nifty": position.entry_nifty,
                "entry_direction": position.entry_direction.value,
                "entry_level_name": position.entry_level_name,
                "entry_level_price": position.entry_level_price,
                "best_price": position.best_price,
                "exit_policy": "dynamic_scalp",
                "recorded_horizons": sorted(position.recorded_horizons),
                "strategy_id": "level-event",
                "strategy_version": self._strategy_version,
                "manual_stop_price": self._manual_stop_price,
                "trailing_enabled": self._trailing_enabled,
                "trailing_activation_pct": self._trailing_activation_pct,
                "trailing_drawdown_pct": self._trailing_drawdown_pct,
                "paper_slippage_bps": self._settings["paper_slippage_bps"],
                "paper_fee_rate_pct": self._settings["paper_fee_rate_pct"],
            }
        )
        return raw

    def _persist_position_raw(self) -> None:
        if not self._open_position:
            return
        self.control.client.table("orders").update(
            {"raw": self._managed_raw(self._open_position), "quantity": self._open_position.quantity}
        ).eq("id", self._open_position.order_id).execute()

    def _persist_snapshot(
        self,
        snapshot: MarketSnapshot,
        levels: tuple[SupportResistanceLevel, ...],
        params: StrategyParams,
    ) -> None:
        try:
            self.control.client.table("market_snapshots").insert(
                {
                    "observed_at": snapshot.timestamp.isoformat(),
                    "session_date": snapshot.timestamp.astimezone(IST).date().isoformat(),
                    "payload": to_primitive(snapshot),
                    "levels": to_primitive(levels),
                    "strategy_parameters": params.to_dict(),
                }
            ).execute()
        except Exception:
            logger.warning("market snapshot persistence failed", exc_info=True)

    def _buy_fill(self, market_price: float) -> float:
        return market_price * (1.0 + self._settings["paper_slippage_bps"] / 10_000.0)

    def _sell_fill(self, market_price: float) -> float:
        return market_price * (1.0 - self._settings["paper_slippage_bps"] / 10_000.0)

    def _fees(self, entry_price: float, exit_price: float, quantity: int) -> float:
        return (entry_price + exit_price) * quantity * self._settings["paper_fee_rate_pct"]

    def _open_paper_order(
        self,
        signal_id: str,
        signal: Signal,
        snapshot: MarketSnapshot,
        level_price: float | None,
    ) -> OpenPaperPosition:
        contract = signal.contract.contract
        if contract is None or signal.risk.quantity <= 0:
            raise RuntimeError("cannot open paper position without an eligible contract")
        requested = contract.ltp
        fill = self._buy_fill(requested)
        now = signal.timestamp
        raw = {
            "entry_price": fill,
            "requested_price": requested,
            "entry_nifty": snapshot.spot_price,
            "entry_direction": signal.direction.value,
            "entry_level_name": signal.level.level_name,
            "entry_level_price": level_price,
            "best_price": fill,
            "exit_policy": "dynamic_scalp",
            "recorded_horizons": [],
            "signal_event": signal.event.value,
            "signal_direction": signal.direction.value,
            "confidence": signal.confidence,
            "option_score": signal.contract.score,
            "strategy_id": "level-event",
            "strategy_version": self._strategy_version,
            "entry_greeks": to_primitive(contract.greeks),
            "option_type": contract.option_type.value,
            "strike": contract.strike,
            "expiry": contract.expiry,
            "lot_size": contract.lot_size,
            "paper_slippage_bps": self._settings["paper_slippage_bps"],
            "paper_fee_rate_pct": self._settings["paper_fee_rate_pct"],
            "manual_stop_price": None,
            "trailing_enabled": None,
            "trailing_activation_pct": None,
            "trailing_drawdown_pct": None,
        }
        response = (
            self.control.client.table("orders").insert(
                {
                    "signal_id": signal_id,
                    "mode": "paper",
                    "trading_symbol": contract.trading_symbol,
                    "side": "BUY",
                    "quantity": signal.risk.quantity,
                    "status": "OPEN",
                    "raw": raw,
                }
            ).select("id,created_at").execute()
        )
        rows = response.data or []
        if not rows:
            raise RuntimeError("paper order insert did not return an id")
        row = rows[0]
        position = OpenPaperPosition(
            order_id=str(row["id"]),
            signal_id=signal_id,
            trading_symbol=contract.trading_symbol,
            quantity=signal.risk.quantity,
            entry_price=fill,
            entry_nifty=snapshot.spot_price,
            opened_at=_parse_datetime(row.get("created_at") or now.isoformat()),
            recorded_horizons=set(),
            entry_direction=signal.direction,
            entry_level_name=signal.level.level_name,
            entry_level_price=level_price,
            best_price=fill,
        )
        self._order_meta = raw
        self._write_event(
            "success", "paper-execution", "position_opened", "Paper position opened",
            f"{position.quantity} × {position.trading_symbol} at simulated fill {fill:.2f}",
            instrument=position.trading_symbol,
            metadata={"requested_price": requested, "fill_price": fill, "signal_id": signal_id},
        )
        return position

    def _record_outcomes(self, position: OpenPaperPosition, price: float, nifty_ltp: float, now: datetime) -> None:
        age = max((now - position.opened_at).total_seconds(), 0.0)
        changed = False
        for horizon in OUTCOME_HORIZONS:
            if age < horizon or horizon in position.recorded_horizons:
                continue
            option_return = (price - position.entry_price) / position.entry_price * 100.0 if position.entry_price > 0 else None
            self.control.client.table("paper_signal_outcomes").upsert(
                {
                    "signal_id": position.signal_id,
                    "order_id": position.order_id,
                    "horizon_seconds": horizon,
                    "observed_at": now.isoformat(),
                    "option_ltp": price,
                    "nifty_ltp": nifty_ltp,
                    "option_return_pct": option_return,
                    "underlying_move_points": nifty_ltp - position.entry_nifty,
                    "raw": {"trading_symbol": position.trading_symbol},
                },
                on_conflict="signal_id,horizon_seconds",
            ).execute()
            position.recorded_horizons.add(horizon)
            changed = True
        if changed:
            self._persist_position_raw()

    def _close_quantity(self, quantity: int, market_price: float, reason: str, now: datetime) -> dict[str, Any]:
        position = self._open_position
        risk_state = self._risk_state
        if position is None:
            raise RuntimeError("no open paper position")
        if quantity <= 0 or quantity > position.quantity:
            raise ValueError("exit quantity is outside the open paper quantity")
        exit_fill = self._sell_fill(market_price)
        fees = self._fees(position.entry_price, exit_fill, quantity)
        pnl = (exit_fill - position.entry_price) * quantity - fees
        hold_seconds = max((now - position.opened_at).total_seconds(), 0.0)
        is_full = quantity == position.quantity
        trade_raw = {
            "side": "SELL",
            "mode": "paper",
            "exit_policy": "manual" if reason.startswith("manual") or reason == "kill_switch" else "dynamic_scalp",
            "exit_reason": reason,
            "entry_price": position.entry_price,
            "requested_exit_price": market_price,
            "best_price": position.best_price,
            "fees": fees,
            "paper_slippage_bps": self._settings["paper_slippage_bps"],
            "paper_fee_rate_pct": self._settings["paper_fee_rate_pct"],
            "opened_at": position.opened_at.isoformat(),
            "hold_seconds": hold_seconds,
            "strategy_id": "level-event",
            "strategy_version": self._strategy_version,
            "option_type": self._order_meta.get("option_type"),
            "strike": self._order_meta.get("strike"),
        }
        self.control.client.table("trades").insert(
            {
                "order_id": position.order_id,
                "trading_symbol": position.trading_symbol,
                "quantity": quantity,
                "fill_price": exit_fill,
                "pnl": pnl,
                "raw": trade_raw,
                "executed_at": now.isoformat(),
            }
        ).execute()
        if is_full:
            raw = self._managed_raw(position) | {
                "exit_reason": reason,
                "exit_price": exit_fill,
                "requested_exit_price": market_price,
                "fees": fees,
                "closed_at": now.isoformat(),
                "hold_seconds": hold_seconds,
            }
            self.control.client.table("orders").update({"status": "CLOSED", "raw": raw}).eq("id", position.order_id).execute()
            self._open_position = None
            self._manual_stop_price = None
            self._trailing_enabled = None
            self._trailing_activation_pct = None
            self._trailing_drawdown_pct = None
            if risk_state is not None:
                risk_state.realized_pnl_today += pnl
                risk_state.open_position = False
                risk_state.consecutive_losses = risk_state.consecutive_losses + 1 if pnl < 0 else 0
        else:
            position.quantity -= quantity
            partials = list(self._order_meta.get("partial_exits", [])) if isinstance(self._order_meta.get("partial_exits"), list) else []
            partials.append({"quantity": quantity, "fill_price": exit_fill, "pnl": pnl, "fees": fees, "at": now.isoformat()})
            self._order_meta["partial_exits"] = partials
            if risk_state is not None:
                risk_state.realized_pnl_today += pnl
            self._persist_position_raw()
        self._write_event(
            "success" if pnl >= 0 else "warning", "paper-execution",
            "position_closed" if is_full else "position_partial_exit",
            "Paper position closed" if is_full else "Paper position partially exited",
            f"{quantity} × {position.trading_symbol} at {exit_fill:.2f}; P&L {pnl:.2f}; reason {reason}",
            instrument=position.trading_symbol,
            metadata={"quantity": quantity, "pnl": pnl, "fees": fees, "reason": reason},
        )
        return {"ok": True, "quantity": quantity, "fill_price": exit_fill, "pnl": pnl, "fees": fees, "reason": reason, "fully_closed": is_full}

    def _mark_and_maybe_exit(self, nifty_ltp: float, signal: Signal | None) -> str | None:
        with self._position_lock:
            position = self._open_position
            if position is None:
                return None
            price = self._position_mark()
            if price is None:
                return None
            now = datetime.now(timezone.utc)
            position.best_price = max(position.best_price, price)
            self._record_outcomes(position, price, nifty_ltp, now)
            if self._manual_stop_price is not None and price <= self._manual_stop_price:
                self._close_quantity(position.quantity, price, "manual_stop", now)
                return "manual_stop"
            params = self._params
            if self._trailing_enabled is False:
                params = replace(params, exit_trailing_activation_pct=1.0, exit_trailing_drawdown_pct=1.0)
            elif self._trailing_enabled is True:
                params = replace(
                    params,
                    exit_trailing_activation_pct=self._trailing_activation_pct if self._trailing_activation_pct is not None else params.exit_trailing_activation_pct,
                    exit_trailing_drawdown_pct=self._trailing_drawdown_pct if self._trailing_drawdown_pct is not None else params.exit_trailing_drawdown_pct,
                )
            decision = evaluate_dynamic_exit(
                now=now,
                opened_at=position.opened_at,
                entry_price=position.entry_price,
                best_price=position.best_price,
                option_price=price,
                nifty_ltp=nifty_ltp,
                entry_direction=position.entry_direction,
                entry_level_price=position.entry_level_price,
                signal=signal,
                params=params,
            )
            if decision.should_exit:
                self._close_quantity(position.quantity, price, decision.reason, now)
                return decision.reason
            self._persist_position_raw()
            return None

    def _update_position_status(self, *, last_exit_reason: str | None = None) -> None:
        position = self._open_position
        mark = self._position_mark()
        contract = self._position_contract()
        exposure = position.entry_price * position.quantity if position else 0.0
        unrealized = (mark - position.entry_price) * position.quantity if position and mark is not None else None
        target = position.entry_price * (1 + self._params.exit_profit_target_pct) if position else None
        default_stop = position.entry_price * (1 - self._params.exit_stop_loss_pct) if position else None
        self._set_status(
            strategy_enabled=self._strategy_enabled,
            strategy_version=self._strategy_version,
            kill_switch_enabled=self._kill_switch,
            kill_switch_reason=self._kill_reason,
            account_equity=self._settings["account_equity"],
            available_capital=max(self._settings["account_equity"] - exposure, 0.0),
            paper_slippage_bps=self._settings["paper_slippage_bps"],
            paper_fee_rate_pct=self._settings["paper_fee_rate_pct"],
            current_option_ltp=mark,
            unrealized_pnl=unrealized,
            stop_price=self._manual_stop_price if self._manual_stop_price is not None else default_stop,
            stop_source="manual" if self._manual_stop_price is not None else "strategy",
            target_price=target,
            trailing_enabled=self._trailing_enabled if self._trailing_enabled is not None else True,
            trailing_activation_pct=self._trailing_activation_pct if self._trailing_activation_pct is not None else self._params.exit_trailing_activation_pct,
            trailing_drawdown_pct=self._trailing_drawdown_pct if self._trailing_drawdown_pct is not None else self._params.exit_trailing_drawdown_pct,
            current_greeks=to_primitive(contract.greeks) if contract else None,
            last_exit_reason=last_exit_reason,
            open_paper_position=(
                {
                    "trading_symbol": position.trading_symbol,
                    "quantity": position.quantity,
                    "entry_price": position.entry_price,
                    "best_price": position.best_price,
                    "entry_direction": position.entry_direction.value,
                    "entry_level_name": position.entry_level_name,
                    "entry_level_price": position.entry_level_price,
                    "opened_at": position.opened_at.isoformat(),
                    "marks_recorded": sorted(position.recorded_horizons),
                }
                if position else None
            ),
        )

    def _ensure_position(self) -> OpenPaperPosition:
        if self._open_position is not None:
            return self._open_position
        settings = self._load_settings()
        persistence = PaperPersistence(self.control.client, settings["account_equity"])
        risk_state, position = persistence.restore_risk_state()
        if position is None:
            raise RuntimeError("no open paper position")
        self._settings = settings
        self._persistence = persistence
        self._risk_state = risk_state
        self._open_position = position
        self._load_order_overrides(position)
        return position

    def _quote_position_mark(self, client_factory: Callable[[], tuple[Any, dict[str, Any]]] | None = None) -> float:
        if client_factory is not None:
            self._client_factory = client_factory
        mark = self._position_mark()
        if mark is not None:
            return mark
        position = self._ensure_position()
        if self._client_factory is None:
            raise RuntimeError("broker client is unavailable for a fresh paper mark")
        groww, _ = self._client_factory()
        quote = dict(groww.get_quote(exchange="NSE", segment="FNO", trading_symbol=position.trading_symbol))
        mark = _number(quote.get("last_price") or quote.get("ltp"), 0.0)
        if mark <= 0:
            raise RuntimeError("Groww did not return a valid option mark")
        return mark

    def manual_exit(self, client_factory: Callable[[], tuple[Any, dict[str, Any]]] | None = None) -> dict[str, Any]:
        with self._position_lock:
            position = self._ensure_position()
            mark = self._quote_position_mark(client_factory)
            result = self._close_quantity(position.quantity, mark, "manual_exit", datetime.now(timezone.utc))
            self._update_position_status(last_exit_reason="manual_exit")
            return result

    def partial_exit(self, quantity: int, client_factory: Callable[[], tuple[Any, dict[str, Any]]] | None = None) -> dict[str, Any]:
        with self._position_lock:
            position = self._ensure_position()
            if quantity >= position.quantity:
                raise ValueError("partial exit quantity must be smaller than the open quantity")
            contract = self._position_contract()
            lot_size = contract.lot_size if contract else int(self._order_meta.get("lot_size") or 1)
            if lot_size > 1 and quantity % lot_size != 0:
                raise ValueError(f"partial exit quantity must be a multiple of lot size {lot_size}")
            mark = self._quote_position_mark(client_factory)
            result = self._close_quantity(quantity, mark, "manual_partial_exit", datetime.now(timezone.utc))
            self._update_position_status(last_exit_reason="manual_partial_exit")
            return result

    def set_stop(self, stop_price: float) -> dict[str, Any]:
        with self._position_lock:
            position = self._ensure_position()
            if stop_price <= 0:
                raise ValueError("stop price must be positive")
            self._manual_stop_price = float(stop_price)
            self._persist_position_raw()
            self._update_position_status()
            self._write_event("info", "risk", "manual_stop_updated", "Manual paper stop updated", f"Stop set to {stop_price:.2f}", instrument=position.trading_symbol)
            return {"ok": True, "stop_price": self._manual_stop_price}

    def set_trailing(self, enabled: bool, activation_pct: float | None = None, drawdown_pct: float | None = None) -> dict[str, Any]:
        with self._position_lock:
            position = self._ensure_position()
            if enabled:
                activation = self._params.exit_trailing_activation_pct if activation_pct is None else float(activation_pct)
                drawdown = self._params.exit_trailing_drawdown_pct if drawdown_pct is None else float(drawdown_pct)
                if not 0 <= activation <= 1 or not 0 < drawdown <= 1:
                    raise ValueError("invalid trailing percentages")
                self._trailing_activation_pct = activation
                self._trailing_drawdown_pct = drawdown
            self._trailing_enabled = bool(enabled)
            self._persist_position_raw()
            self._update_position_status()
            self._write_event("info", "risk", "trailing_updated", "Paper trailing stop updated", f"Trailing {'enabled' if enabled else 'disabled'}", instrument=position.trading_symbol)
            return {"ok": True, "enabled": self._trailing_enabled, "activation_pct": self._trailing_activation_pct, "drawdown_pct": self._trailing_drawdown_pct}

    def set_kill_switch(
        self,
        enabled: bool,
        *,
        close_position: bool = False,
        reason: str | None = None,
        client_factory: Callable[[], tuple[Any, dict[str, Any]]] | None = None,
    ) -> dict[str, Any]:
        self._kill_switch = bool(enabled)
        self._kill_reason = reason if enabled else None
        self.control.client.table("risk_control_state").upsert(
            {
                "worker_id": "oracle-primary",
                "kill_switch_enabled": self._kill_switch,
                "reason": self._kill_reason,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="worker_id",
        ).execute()
        if self._risk_state is not None:
            self._load_controls(self._risk_state)
        exit_result = None
        if enabled and close_position:
            try:
                position = self._ensure_position()
            except RuntimeError:
                position = None
            if position is not None:
                mark = self._quote_position_mark(client_factory)
                exit_result = self._close_quantity(position.quantity, mark, "kill_switch", datetime.now(timezone.utc))
        self._update_position_status(last_exit_reason="kill_switch" if exit_result else None)
        self._write_event(
            "critical" if enabled else "success", "risk", "kill_switch_engaged" if enabled else "kill_switch_reset",
            "Paper kill switch engaged" if enabled else "Paper kill switch reset",
            self._kill_reason or "New entries may resume when all normal risk checks pass.",
            metadata={"close_position": close_position, "position_closed": bool(exit_result)},
        )
        return {"ok": True, "enabled": self._kill_switch, "position_exit": exit_result}

    def _replay_params(self, params: StrategyParams, confirmations: set[str]) -> StrategyParams:
        futures_price = params.futures_price_weight
        futures_basis = params.futures_basis_weight
        futures_oi = params.futures_oi_weight if "oi" in confirmations else 0.0
        futures_total = futures_price + futures_basis + futures_oi
        if futures_total <= 0:
            futures_price, futures_basis, futures_oi, futures_total = 0.5, 0.5, 0.0, 1.0
        cash_weight = params.combined_cash_weight if "volume" in confirmations else 0.0
        futures_weight = params.combined_futures_weight if "futures" in confirmations else 0.0
        options_weight = params.combined_options_weight if "options" in confirmations else 0.0
        vwap_weight = params.combined_vwap_weight
        combined_total = cash_weight + futures_weight + options_weight + vwap_weight
        if combined_total <= 0:
            vwap_weight, combined_total = 1.0, 1.0
        return replace(
            params,
            futures_price_weight=futures_price / futures_total,
            futures_basis_weight=futures_basis / futures_total,
            futures_oi_weight=futures_oi / futures_total,
            combined_cash_weight=cash_weight / combined_total,
            combined_futures_weight=futures_weight / combined_total,
            combined_options_weight=options_weight / combined_total,
            combined_vwap_weight=vwap_weight / combined_total,
        )

    def run_replay(self, payload: dict[str, Any]) -> dict[str, Any]:
        session_date = str(payload.get("date") or "")
        start_time = str(payload.get("startTime") or "09:15")
        end_time = str(payload.get("endTime") or "15:15")
        capital = float(payload.get("startingCapital") or self._settings["account_equity"])
        confirmations = {str(item) for item in payload.get("confirmations", [])}
        response = (
            self.control.client.table("market_snapshots")
            .select("id,observed_at,payload,levels,strategy_parameters")
            .eq("session_date", session_date)
            .order("observed_at").execute()
        )
        raw_rows = list(response.data or [])
        selected: list[dict[str, Any]] = []
        for row in raw_rows:
            local = _parse_datetime(row["observed_at"]).astimezone(IST)
            local_text = local.strftime("%H:%M")
            if start_time <= local_text <= end_time:
                selected.append(row)
        if not selected:
            return {
                "ok": True,
                "frames": 0,
                "tradesGenerated": 0,
                "winRate": None,
                "pnl": None,
                "maximumDrawdown": None,
                "signalIds": [],
                "eventCounts": {"breakout": 0, "reversal": 0, "uncertain": 0, "no_level": 0},
                "message": "No persisted market snapshots exist for the requested replay window.",
            }

        first_params = StrategyParams.from_mapping(_record(selected[0].get("strategy_parameters")))
        params = self._replay_params(first_params, confirmations)
        engine = SignalEngine(params)
        state = RiskState(account_equity=capital)
        event_counts = {"breakout": 0, "reversal": 0, "uncertain": 0, "no_level": 0}
        active: dict[str, Any] | None = None
        trades: list[float] = []
        signal_ids: list[str] = []
        slippage = self._load_settings()["paper_slippage_bps"]
        fee_rate = self._load_settings()["paper_fee_rate_pct"]

        def close_active(snapshot: MarketSnapshot, reason: str) -> None:
            nonlocal active
            if not active:
                return
            contract = next((item for item in snapshot.options if item.trading_symbol == active["symbol"]), None)
            if contract is None:
                return
            exit_fill = contract.ltp * (1 - slippage / 10_000.0)
            qty = int(active["quantity"])
            fees = (float(active["entry_price"]) + exit_fill) * qty * fee_rate
            pnl = (exit_fill - float(active["entry_price"])) * qty - fees
            trades.append(pnl)
            state.realized_pnl_today += pnl
            state.open_position = False
            state.consecutive_losses = state.consecutive_losses + 1 if pnl < 0 else 0
            active = None

        last_snapshot: MarketSnapshot | None = None
        for row in selected:
            snapshot = snapshot_from_primitive(_record(row["payload"]))
            levels = levels_from_primitive(list(row.get("levels") or []))
            signal = engine.evaluate(snapshot, levels, state, data_age_seconds=0.0)
            last_snapshot = snapshot
            event_counts[signal.event.value] = event_counts.get(signal.event.value, 0) + 1
            if active:
                contract = next((item for item in snapshot.options if item.trading_symbol == active["symbol"]), None)
                if contract:
                    active["best_price"] = max(float(active["best_price"]), contract.ltp)
                    decision = evaluate_dynamic_exit(
                        now=snapshot.timestamp,
                        opened_at=active["opened_at"],
                        entry_price=float(active["entry_price"]),
                        best_price=float(active["best_price"]),
                        option_price=contract.ltp,
                        nifty_ltp=snapshot.spot_price,
                        entry_direction=active["direction"],
                        entry_level_price=active["level_price"],
                        signal=signal,
                        params=params,
                    )
                    if decision.should_exit:
                        close_active(snapshot, decision.reason)
            if not active and signal.event.value in {"breakout", "reversal"} and signal.risk.allowed:
                contract = signal.contract.contract
                if contract is not None:
                    entry = contract.ltp * (1 + slippage / 10_000.0)
                    level_price = next((level.price for level in levels if level.name == signal.level.level_name), None)
                    active = {
                        "symbol": contract.trading_symbol,
                        "quantity": signal.risk.quantity,
                        "entry_price": entry,
                        "best_price": entry,
                        "opened_at": snapshot.timestamp,
                        "direction": signal.direction,
                        "level_price": level_price,
                    }
                    state.open_position = True
                    state.trades_today += 1
                    state.last_trade_at = snapshot.timestamp
                    signal_ids.append(str(row["id"]))
        if active and last_snapshot is not None:
            close_active(last_snapshot, "replay_end")

        total = sum(trades) if trades else None
        winners = sum(1 for value in trades if value > 0)
        equity = 0.0
        peak = 0.0
        max_drawdown = 0.0
        for value in trades:
            equity += value
            peak = max(peak, equity)
            max_drawdown = min(max_drawdown, equity - peak)
        result = {
            "ok": True,
            "frames": len(selected),
            "tradesGenerated": len(trades),
            "winRate": winners / len(trades) if trades else None,
            "pnl": total,
            "maximumDrawdown": max_drawdown if trades else None,
            "signalIds": signal_ids,
            "eventCounts": event_counts,
            "confirmations": sorted(confirmations),
            "slippageBps": slippage,
            "feeRatePct": fee_rate,
        }
        self._write_event("info", "replay", "replay_completed", "Historical paper replay completed", f"{len(selected)} frames, {len(trades)} simulated trades", metadata={"date": session_date, **result})
        return result

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
        self._settings = self._load_settings()
        persistence = PaperPersistence(self.control.client, self._settings["account_equity"])
        params = persistence.load_strategy_params()
        index_weights, heavyweights, weighting = persistence.load_constituent_config(universe.symbols)
        engine = SignalEngine(params)
        risk_state, position = persistence.restore_risk_state()
        self._persistence = persistence
        self._risk_state = risk_state
        self._open_position = position
        self._params = params
        self._load_order_overrides(position)
        self._load_controls(risk_state)
        limiter = SlidingWindowRateLimiter(max_per_second=8, max_per_minute=220)
        feed.start()
        self._write_event("success", "paper-engine", "engine_started", "Paper engine session started", f"Resolved {len(constituents)} NIFTY constituents and {future.trading_symbol}")

        self._set_status(
            running=True,
            state="warming",
            feed_connected=True,
            universe_as_of=universe.as_of,
            weighting=weighting,
            constituents_total=50,
            constituents_resolved=len(constituents),
            constituents_fresh=0,
            future_symbol=future.trading_symbol,
            future_ltp=None,
            nifty_ltp=None,
            synthetic_vwap=None,
            whole_nifty_volume_delta=0,
            whole_nifty_turnover=0.0,
            option_expiry=expiry,
            option_contract_count=0,
            thresholds_updated_at=persistence.parameters_updated_at,
            opening_no_entry_minutes=params.opening_no_entry_minutes,
            last_exit_reason=None,
        )
        self._update_position_status()

        next_quote = 0.0
        next_option = 0.0
        next_control = 0.0
        last_signal_persist = 0.0
        try:
            while not self._stop_event.is_set() and is_nse_session():
                loop_started = time.monotonic()
                feed_snapshot = feed.snapshot()
                if feed_snapshot.spot:
                    spot_age = max((datetime.now(timezone.utc) - feed_snapshot.spot.observed_at).total_seconds(), 0.0)
                    state.update_feed_spot(feed_snapshot.spot.value, feed_snapshot.spot.observed_at, spot_age)
                    self._latest_spot = feed_snapshot.spot.value

                now_mono = time.monotonic()
                if now_mono >= next_control:
                    refreshed = persistence.load_strategy_params()
                    if refreshed != params:
                        params = refreshed
                        engine.update_params(params)
                        self._params = params
                        self._write_event("info", "strategy", "parameters_reloaded", "Strategy parameters reloaded", f"Threshold snapshot {persistence.parameters_updated_at or 'default'}")
                    self._load_controls(risk_state)
                    next_control = now_mono + CONTROL_REFRESH_SECONDS
                    self._set_status(thresholds_updated_at=persistence.parameters_updated_at, opening_no_entry_minutes=params.opening_no_entry_minutes)

                did_quote_scan = False
                if now_mono >= next_quote:
                    successes, quote_errors = self._quote_scan(groww=groww, limiter=limiter, state=state, constituents=constituents, future=future)
                    did_quote_scan = True
                    next_quote = time.monotonic() + self._settings["quote_scan_seconds"]
                    self._set_status(last_quote_scan=datetime.now(timezone.utc).isoformat(), quote_successes=successes, quote_errors=quote_errors[:5])

                if time.monotonic() >= next_option and not self._stop_event.is_set():
                    limiter.wait()
                    chain = dict(groww.get_option_chain(exchange="NSE", underlying="NIFTY", expiry_date=expiry))
                    contracts = parse_option_chain(chain, expiry=expiry, lot_size_for=registry.lot_size_for)
                    state.set_options(contracts, datetime.now(timezone.utc))
                    self._latest_chain = chain
                    self._latest_contracts = contracts
                    next_option = time.monotonic() + self._settings["option_refresh_seconds"]
                    chain_spot = float(chain.get("underlying_ltp") or 0.0)
                    if chain_spot > 0:
                        self._latest_spot = chain_spot
                        if state.spot_price <= 0:
                            state.update_feed_spot(chain_spot, datetime.now(timezone.utc), 0.0)
                    exit_reason = self._mark_and_maybe_exit(state.spot_price or chain_spot, self._latest_signal)
                    self._set_status(last_option_refresh=datetime.now(timezone.utc).isoformat(), option_contract_count=len(contracts))
                    self._update_position_status(last_exit_reason=exit_reason)

                if did_quote_scan and not self._stop_event.is_set():
                    built = state.build_snapshot(max_age_seconds=params.max_data_age_seconds, index_weights=index_weights, heavyweights=heavyweights)
                    if built is not None:
                        snapshot, data_age = built
                        self._latest_spot = snapshot.spot_price
                        levels = persistence.load_levels()
                        signal = engine.evaluate(snapshot, levels, risk_state, data_age_seconds=data_age)
                        self._latest_signal = signal
                        persistence.write_nifty_volume_sample(snapshot, signal)
                        self._persist_snapshot(snapshot, levels, params)
                        exit_reason = self._mark_and_maybe_exit(snapshot.spot_price, signal)

                        actionable = signal.event.value in {"breakout", "reversal"}
                        should_persist = actionable or time.monotonic() - last_signal_persist >= self._settings["signal_persist_seconds"]
                        signal_id: str | None = None
                        if should_persist:
                            signal_id = persistence.write_signal(signal)
                            last_signal_persist = time.monotonic()
                            if actionable:
                                self._write_event(
                                    "success" if signal.risk.allowed else "warning",
                                    "signal-engine",
                                    "actionable_signal",
                                    f"{signal.event.value} · {signal.direction.value}",
                                    signal.risk.reason,
                                    instrument=signal.contract.contract.trading_symbol if signal.contract.contract else None,
                                    metadata={"confidence": signal.confidence, "combined_score": signal.combined_direction_score, "signal_id": signal_id},
                                )

                        paper_entry = False
                        with self._position_lock:
                            if (
                                signal_id
                                and signal.risk.allowed
                                and self._open_position is None
                                and paper_entry_window_open(signal.timestamp, params.opening_no_entry_minutes)
                            ):
                                level_price = next((level.price for level in levels if level.name == signal.level.level_name), None)
                                self._open_position = self._open_paper_order(signal_id, signal, snapshot, level_price)
                                risk_state.open_position = True
                                risk_state.trades_today += 1
                                risk_state.last_trade_at = signal.timestamp
                                paper_entry = True

                        self._set_status(
                            state="running",
                            constituents_fresh=state.fresh_constituent_count(max_age_seconds=params.max_data_age_seconds),
                            nifty_ltp=snapshot.spot_price,
                            synthetic_vwap=snapshot.synthetic_vwap,
                            whole_nifty_volume_delta=signal.cash.share_volume_delta,
                            whole_nifty_turnover=signal.cash.turnover_delta,
                            heavyweight_score=signal.cash.heavyweight_score,
                            cash_pressure=signal.cash.pressure,
                            breadth=signal.cash.breadth,
                            participation=signal.cash.participation,
                            future_ltp=snapshot.futures.price,
                            option_direction_score=signal.option_market.score,
                            option_direction_ready=signal.option_market.ready,
                            vwap_score=signal.vwap.score,
                            combined_direction_score=signal.combined_direction_score,
                            data_age_seconds=round(data_age, 3),
                            last_signal={
                                "event": signal.event.value,
                                "direction": signal.direction.value,
                                "confidence": signal.confidence,
                                "risk_allowed": signal.risk.allowed,
                                "paper_entry": paper_entry,
                                "reason": signal.risk.reason,
                            },
                            latest_snapshot_at=snapshot.timestamp.isoformat(),
                        )
                        self._update_position_status(last_exit_reason=exit_reason)
                    else:
                        self._set_status(
                            state="warming",
                            constituents_fresh=state.fresh_constituent_count(max_age_seconds=params.max_data_age_seconds),
                            nifty_ltp=state.spot_price or None,
                            synthetic_vwap=state.synthetic_vwap,
                        )
                        self._update_position_status()

                elapsed = time.monotonic() - loop_started
                self._stop_event.wait(max(self._settings["feed_poll_seconds"] - elapsed, 0.05))
        finally:
            feed.stop()
            self._set_status(feed_connected=False)
            self._write_event("info", "paper-engine", "engine_session_stopped", "Paper engine market session stopped", "The live paper processing session ended; the Oracle control agent remains separate.")
