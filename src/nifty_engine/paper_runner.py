from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time as clock_time, timedelta, timezone
import logging
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
from .models import Direction, LevelKind, MarketSnapshot, Signal, SupportResistanceLevel
from .option_chain import option_ltp, parse_option_chain
from .params import StrategyParams
from .risk import RiskState
from .serialization import to_primitive

logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")
OUTCOME_HORIZONS = (60, 180, 300, 600, 900)
PARAM_REFRESH_SECONDS = 30.0


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
            option_refresh_seconds=_env_float(
                "PAPER_OPTION_REFRESH_SECONDS", 20.0, minimum=5.0
            ),
            feed_poll_seconds=_env_float("PAPER_FEED_POLL_SECONDS", 1.0, minimum=0.25),
            signal_persist_seconds=_env_float(
                "PAPER_SIGNAL_PERSIST_SECONDS", 30.0, minimum=5.0
            ),
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


def is_nse_session(now: datetime | None = None) -> bool:
    current = (now or datetime.now(timezone.utc)).astimezone(IST)
    if current.weekday() >= 5:
        return False
    local_time = current.time().replace(tzinfo=None)
    return clock_time(9, 15) <= local_time <= clock_time(15, 30)


def paper_entry_window_open(
    now: datetime | None = None,
    opening_no_entry_minutes: int = 10,
) -> bool:
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
        response = (
            self.client.table("strategy_parameters")
            .select("key,value,updated_at")
            .order("key")
            .execute()
        )
        rows = list(response.data or [])
        if not rows:
            self.parameters_updated_at = None
            return StrategyParams()
        values = {str(row["key"]): row.get("value") for row in rows}
        updated = [str(row.get("updated_at")) for row in rows if row.get("updated_at")]
        self.parameters_updated_at = max(updated) if updated else None
        return StrategyParams.from_mapping(values)

    def load_constituent_config(
        self, symbols: tuple[str, ...]
    ) -> tuple[dict[str, float], frozenset[str], str]:
        response = (
            self.client.table("nifty_constituent_config")
            .select("symbol,index_weight,is_heavyweight")
            .in_("symbol", list(symbols))
            .execute()
        )
        rows = list(response.data or [])
        heavyweights = frozenset(
            str(row["symbol"]) for row in rows if bool(row.get("is_heavyweight"))
        ) or DEFAULT_HEAVYWEIGHTS
        positive_weights = {
            str(row["symbol"]): float(row["index_weight"])
            for row in rows
            if row.get("index_weight") is not None and float(row["index_weight"]) > 0
        }
        if len(positive_weights) == len(symbols):
            return positive_weights, heavyweights, "database"
        return {}, heavyweights, "equal"

    def load_levels(self) -> tuple[SupportResistanceLevel, ...]:
        response = (
            self.client.table("strategy_levels")
            .select("name,kind,price,source,enabled")
            .eq("enabled", True)
            .order("price")
            .execute()
        )
        return tuple(
            SupportResistanceLevel(
                name=str(row["name"]),
                kind=LevelKind(str(row["kind"])),
                price=float(row["price"]),
                source=str(row.get("source", "manual")),
                enabled=bool(row.get("enabled", True)),
            )
            for row in (response.data or [])
        )

    def _today_start_utc(self) -> datetime:
        local = datetime.now(IST)
        return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)

    def _position_raw(self, position: OpenPaperPosition) -> dict[str, Any]:
        return {
            "entry_price": position.entry_price,
            "entry_nifty": position.entry_nifty,
            "entry_direction": position.entry_direction.value,
            "entry_level_name": position.entry_level_name,
            "entry_level_price": position.entry_level_price,
            "best_price": position.best_price,
            "exit_policy": "dynamic_scalp",
            "recorded_horizons": sorted(position.recorded_horizons),
        }

    def restore_risk_state(self) -> tuple[RiskState, OpenPaperPosition | None]:
        start = self._today_start_utc().isoformat()
        orders_response = (
            self.client.table("orders")
            .select("id,signal_id,trading_symbol,quantity,status,raw,created_at")
            .eq("mode", "paper")
            .gte("created_at", start)
            .order("created_at", desc=True)
            .execute()
        )
        trades_response = (
            self.client.table("trades")
            .select("order_id,pnl,executed_at")
            .gte("executed_at", start)
            .order("executed_at", desc=True)
            .execute()
        )
        orders = list(orders_response.data or [])
        trades = list(trades_response.data or [])
        realized = sum(float(row.get("pnl") or 0.0) for row in trades)
        consecutive_losses = 0
        for row in trades:
            pnl = float(row.get("pnl") or 0.0)
            if pnl < 0:
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
                recorded = raw.get("recorded_horizons", [])
                direction_text = str(raw.get("entry_direction") or "flat")
                direction = Direction(direction_text) if direction_text in {item.value for item in Direction} else Direction.FLAT
                level_price_raw = raw.get("entry_level_price")
                level_price = float(level_price_raw) if level_price_raw is not None else None
                entry_price = float(raw.get("entry_price") or 0.0)
                open_position = OpenPaperPosition(
                    order_id=str(open_row["id"]),
                    signal_id=str(open_row.get("signal_id") or ""),
                    trading_symbol=str(open_row["trading_symbol"]),
                    quantity=int(open_row["quantity"]),
                    entry_price=entry_price,
                    entry_nifty=float(raw.get("entry_nifty") or 0.0),
                    opened_at=opened_at,
                    recorded_horizons={int(value) for value in recorded},
                    entry_direction=direction,
                    entry_level_name=(str(raw["entry_level_name"]) if raw.get("entry_level_name") else None),
                    entry_level_price=level_price,
                    best_price=float(raw.get("best_price") or entry_price),
                )

        state = RiskState(
            account_equity=self.account_equity,
            realized_pnl_today=realized,
            trades_today=len(orders),
            consecutive_losses=consecutive_losses,
            last_trade_at=last_trade_at,
            open_position=open_row is not None,
        )
        return state, open_position

    def write_signal(self, signal: Signal) -> str:
        payload = to_primitive(signal)
        response = (
            self.client.table("signals")
            .insert(
                {
                    "observed_at": signal.timestamp.isoformat(),
                    "event": signal.event.value,
                    "direction": signal.direction.value,
                    "confidence": signal.confidence,
                    "combined_direction_score": signal.combined_direction_score,
                    "payload": payload,
                }
            )
            .select("id")
            .execute()
        )
        row = _returned_row(response, "signal insert")
        return str(row["id"])

    def write_nifty_volume_sample(self, snapshot: MarketSnapshot, signal: Signal) -> None:
        self.client.table("nifty_volume_series").insert(
            {
                "observed_at": snapshot.timestamp.isoformat(),
                "nifty_ltp": snapshot.spot_price,
                "synthetic_vwap": snapshot.synthetic_vwap,
                "constituent_volume_delta": signal.cash.share_volume_delta,
                "constituent_turnover": signal.cash.turnover_delta,
                "cash_pressure": signal.cash.pressure,
                "breadth": signal.cash.breadth,
                "participation": signal.cash.participation,
                "heavyweight_score": signal.cash.heavyweight_score,
                "futures_score": signal.futures.score,
                "option_score": signal.option_market.score,
                "vwap_score": signal.vwap.score,
                "combined_score": signal.combined_direction_score,
            }
        ).execute()

    def create_paper_order(
        self,
        signal_id: str,
        signal: Signal,
        nifty_ltp: float,
        level_price: float | None = None,
    ) -> OpenPaperPosition:
        contract = signal.contract.contract
        if contract is None or signal.risk.quantity <= 0:
            raise RuntimeError("cannot create a paper order without an eligible contract/quantity")
        position = OpenPaperPosition(
            order_id="",
            signal_id=signal_id,
            trading_symbol=contract.trading_symbol,
            quantity=signal.risk.quantity,
            entry_price=contract.ltp,
            entry_nifty=nifty_ltp,
            opened_at=signal.timestamp,
            recorded_horizons=set(),
            entry_direction=signal.direction,
            entry_level_name=signal.level.level_name,
            entry_level_price=level_price,
            best_price=contract.ltp,
        )
        raw = self._position_raw(position) | {
            "signal_event": signal.event.value,
            "confidence": signal.confidence,
            "option_score": signal.contract.score,
        }
        response = (
            self.client.table("orders")
            .insert(
                {
                    "signal_id": signal_id,
                    "mode": "paper",
                    "trading_symbol": contract.trading_symbol,
                    "side": "BUY",
                    "quantity": signal.risk.quantity,
                    "status": "OPEN",
                    "raw": raw,
                }
            )
            .select("id,created_at")
            .execute()
        )
        row = _returned_row(response, "paper order insert")
        position.order_id = str(row["id"])
        position.opened_at = _parse_datetime(row.get("created_at")) or signal.timestamp
        return position

    def record_outcome(
        self,
        position: OpenPaperPosition,
        horizon: int,
        *,
        option_price: float,
        nifty_ltp: float,
        observed_at: datetime,
    ) -> None:
        option_return = (
            (option_price - position.entry_price) / position.entry_price * 100.0
            if position.entry_price > 0
            else None
        )
        self.client.table("paper_signal_outcomes").upsert(
            {
                "signal_id": position.signal_id,
                "order_id": position.order_id,
                "horizon_seconds": horizon,
                "observed_at": observed_at.isoformat(),
                "option_ltp": option_price,
                "nifty_ltp": nifty_ltp,
                "option_return_pct": option_return,
                "underlying_move_points": nifty_ltp - position.entry_nifty,
                "raw": {"trading_symbol": position.trading_symbol},
            },
            on_conflict="signal_id,horizon_seconds",
        ).execute()
        position.recorded_horizons.add(horizon)
        self.client.table("orders").update({"raw": self._position_raw(position)}).eq(
            "id", position.order_id
        ).execute()

    def close_paper_order(
        self,
        position: OpenPaperPosition,
        *,
        option_price: float,
        observed_at: datetime,
        exit_reason: str,
    ) -> float:
        pnl = (option_price - position.entry_price) * position.quantity
        raw = self._position_raw(position) | {
            "exit_reason": exit_reason,
            "exit_price": option_price,
            "closed_at": observed_at.isoformat(),
        }
        self.client.table("orders").update({"status": "CLOSED", "raw": raw}).eq(
            "id", position.order_id
        ).execute()
        self.client.table("trades").insert(
            {
                "order_id": position.order_id,
                "trading_symbol": position.trading_symbol,
                "quantity": position.quantity,
                "fill_price": option_price,
                "pnl": pnl,
                "raw": {
                    "side": "SELL",
                    "mode": "paper",
                    "exit_policy": "dynamic_scalp",
                    "exit_reason": exit_reason,
                    "entry_price": position.entry_price,
                    "best_price": position.best_price,
                },
                "executed_at": observed_at.isoformat(),
            }
        ).execute()
        return pnl


class PaperEngineRuntime:
    def __init__(
        self,
        control: Any,
        *,
        config: PaperEngineConfig | None = None,
    ) -> None:
        self.control = control
        self.config = config or PaperEngineConfig.from_env()
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._client_factory: Callable[[], tuple[Any, dict[str, Any]]] | None = None
        self._status: dict[str, Any] = {
            "running": False,
            "state": "stopped",
            "mode": "paper",
        }

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

    def start(self, client_factory: Callable[[], tuple[Any, dict[str, Any]]]) -> dict[str, Any]:
        if self.running:
            return self.status()
        self._client_factory = client_factory
        self._stop_event.clear()
        self._set_status(
            running=True,
            state="starting",
            started_at=datetime.now(timezone.utc).isoformat(),
            last_error=None,
        )
        self._thread = threading.Thread(
            target=self._run,
            name="nifty-paper-engine",
            daemon=True,
        )
        self._thread.start()
        return self.status()

    def stop(self, timeout: float = 15.0) -> dict[str, Any]:
        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=timeout)
        if thread and thread.is_alive():
            self._set_status(state="stopping", running=True)
        else:
            self._set_status(state="stopped", running=False)
        return self.status()

    def _quote_scan(
        self,
        *,
        groww: Any,
        limiter: SlidingWindowRateLimiter,
        state: LiveMarketState,
        constituents: tuple[Any, ...],
        future: Any,
    ) -> tuple[int, list[str]]:
        successes = 0
        errors: list[str] = []
        for ref in constituents:
            if self._stop_event.is_set():
                break
            try:
                limiter.wait()
                quote = dict(
                    groww.get_quote(
                        exchange="NSE",
                        segment="CASH",
                        trading_symbol=ref.trading_symbol,
                    )
                )
                state.update_constituent(
                    ref.trading_symbol, quote, datetime.now(timezone.utc)
                )
                successes += 1
            except Exception as exc:
                errors.append(f"{ref.trading_symbol}: {type(exc).__name__}: {exc}")
        if not self._stop_event.is_set():
            try:
                limiter.wait()
                quote = dict(
                    groww.get_quote(
                        exchange="NSE",
                        segment="FNO",
                        trading_symbol=future.trading_symbol,
                    )
                )
                state.update_future(
                    future.trading_symbol, quote, datetime.now(timezone.utc)
                )
            except Exception as exc:
                errors.append(f"{future.trading_symbol}: {type(exc).__name__}: {exc}")
        state.update_synthetic_vwap()
        return successes, errors

    def _record_position_marks(
        self,
        persistence: PaperPersistence,
        position: OpenPaperPosition | None,
        chain: dict[str, Any],
        nifty_ltp: float,
        risk_state: RiskState,
        params: StrategyParams,
        signal: Signal | None,
    ) -> tuple[OpenPaperPosition | None, str | None]:
        if position is None:
            return None, None
        now = datetime.now(timezone.utc)
        age = max((now - position.opened_at).total_seconds(), 0.0)
        price = option_ltp(chain, position.trading_symbol)
        if price is None:
            return position, None
        position.best_price = max(position.best_price, price)
        for horizon in OUTCOME_HORIZONS:
            if age >= horizon and horizon not in position.recorded_horizons:
                persistence.record_outcome(
                    position,
                    horizon,
                    option_price=price,
                    nifty_ltp=nifty_ltp,
                    observed_at=now,
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
        if not decision.should_exit:
            return position, None

        pnl = persistence.close_paper_order(
            position,
            option_price=price,
            observed_at=now,
            exit_reason=decision.reason,
        )
        risk_state.realized_pnl_today += pnl
        risk_state.open_position = False
        risk_state.consecutive_losses = risk_state.consecutive_losses + 1 if pnl < 0 else 0
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
        params = persistence.load_strategy_params()
        index_weights, heavyweights, weighting = persistence.load_constituent_config(universe.symbols)
        engine = SignalEngine(params)
        risk_state, open_position = persistence.restore_risk_state()
        limiter = SlidingWindowRateLimiter(max_per_second=8, max_per_minute=220)
        feed.start()

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
            open_paper_position=(
                {
                    "trading_symbol": open_position.trading_symbol,
                    "quantity": open_position.quantity,
                    "opened_at": open_position.opened_at.isoformat(),
                    "best_price": open_position.best_price,
                }
                if open_position
                else None
            ),
        )

        next_quote = 0.0
        next_option = 0.0
        next_param_refresh = time.monotonic() + PARAM_REFRESH_SECONDS
        last_signal_persist = 0.0
        latest_chain: dict[str, Any] = {}
        latest_signal: Signal | None = None
        try:
            while not self._stop_event.is_set() and is_nse_session():
                loop_started = time.monotonic()
                feed_snapshot = feed.snapshot()
                if feed_snapshot.spot:
                    spot_age = max(
                        (
                            datetime.now(timezone.utc) - feed_snapshot.spot.observed_at
                        ).total_seconds(),
                        0.0,
                    )
                    state.update_feed_spot(
                        feed_snapshot.spot.value,
                        feed_snapshot.spot.observed_at,
                        spot_age,
                    )

                now_mono = time.monotonic()
                if now_mono >= next_param_refresh:
                    refreshed = persistence.load_strategy_params()
                    if refreshed != params:
                        params = refreshed
                        engine.update_params(params)
                    next_param_refresh = now_mono + PARAM_REFRESH_SECONDS
                    self._set_status(
                        thresholds_updated_at=persistence.parameters_updated_at,
                        opening_no_entry_minutes=params.opening_no_entry_minutes,
                    )

                did_quote_scan = False
                if now_mono >= next_quote:
                    successes, quote_errors = self._quote_scan(
                        groww=groww,
                        limiter=limiter,
                        state=state,
                        constituents=constituents,
                        future=future,
                    )
                    did_quote_scan = True
                    next_quote = time.monotonic() + self.config.quote_scan_seconds
                    self._set_status(
                        last_quote_scan=datetime.now(timezone.utc).isoformat(),
                        quote_successes=successes,
                        quote_errors=quote_errors[:5],
                    )

                if time.monotonic() >= next_option and not self._stop_event.is_set():
                    limiter.wait()
                    latest_chain = dict(
                        groww.get_option_chain(
                            exchange="NSE",
                            underlying="NIFTY",
                            expiry_date=expiry,
                        )
                    )
                    contracts = parse_option_chain(
                        latest_chain,
                        expiry=expiry,
                        lot_size_for=registry.lot_size_for,
                    )
                    state.set_options(contracts, datetime.now(timezone.utc))
                    next_option = time.monotonic() + self.config.option_refresh_seconds
                    chain_spot = float(latest_chain.get("underlying_ltp") or 0.0)
                    if chain_spot > 0 and state.spot_price <= 0:
                        state.update_feed_spot(
                            chain_spot,
                            datetime.now(timezone.utc),
                            0.0,
                        )
                    last_exit_reason = None
                    if open_position and latest_chain:
                        open_position, last_exit_reason = self._record_position_marks(
                            persistence,
                            open_position,
                            latest_chain,
                            state.spot_price or chain_spot,
                            risk_state,
                            params,
                            latest_signal,
                        )
                    self._set_status(
                        last_option_refresh=datetime.now(timezone.utc).isoformat(),
                        option_contract_count=len(contracts),
                        last_exit_reason=last_exit_reason,
                    )

                if did_quote_scan and not self._stop_event.is_set():
                    built = state.build_snapshot(
                        max_age_seconds=params.max_data_age_seconds,
                        index_weights=index_weights,
                        heavyweights=heavyweights,
                    )
                    if built is not None:
                        snapshot, data_age = built
                        levels = persistence.load_levels()
                        signal = engine.evaluate(
                            snapshot,
                            levels,
                            risk_state,
                            data_age_seconds=data_age,
                        )
                        latest_signal = signal
                        persistence.write_nifty_volume_sample(snapshot, signal)

                        last_exit_reason = None
                        if open_position and latest_chain:
                            open_position, last_exit_reason = self._record_position_marks(
                                persistence,
                                open_position,
                                latest_chain,
                                snapshot.spot_price,
                                risk_state,
                                params,
                                signal,
                            )

                        actionable = signal.event.value in {"breakout", "reversal"}
                        should_persist = (
                            actionable
                            or time.monotonic() - last_signal_persist
                            >= self.config.signal_persist_seconds
                        )
                        signal_id: str | None = None
                        if should_persist:
                            signal_id = persistence.write_signal(signal)
                            last_signal_persist = time.monotonic()

                        paper_entry = False
                        if (
                            signal_id
                            and signal.risk.allowed
                            and open_position is None
                            and paper_entry_window_open(
                                signal.timestamp,
                                params.opening_no_entry_minutes,
                            )
                        ):
                            level_price = next(
                                (
                                    level.price
                                    for level in levels
                                    if level.name == signal.level.level_name
                                ),
                                None,
                            )
                            open_position = persistence.create_paper_order(
                                signal_id,
                                signal,
                                snapshot.spot_price,
                                level_price,
                            )
                            risk_state.open_position = True
                            risk_state.trades_today += 1
                            risk_state.last_trade_at = signal.timestamp
                            paper_entry = True

                        self._set_status(
                            state="running",
                            constituents_fresh=state.fresh_constituent_count(
                                max_age_seconds=params.max_data_age_seconds
                            ),
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
                            last_exit_reason=last_exit_reason,
                            last_signal={
                                "event": signal.event.value,
                                "direction": signal.direction.value,
                                "confidence": signal.confidence,
                                "risk_allowed": signal.risk.allowed,
                                "paper_entry": paper_entry,
                                "reason": signal.risk.reason,
                            },
                            open_paper_position=(
                                {
                                    "trading_symbol": open_position.trading_symbol,
                                    "quantity": open_position.quantity,
                                    "entry_price": open_position.entry_price,
                                    "best_price": open_position.best_price,
                                    "entry_direction": open_position.entry_direction.value,
                                    "entry_level_name": open_position.entry_level_name,
                                    "entry_level_price": open_position.entry_level_price,
                                    "opened_at": open_position.opened_at.isoformat(),
                                    "marks_recorded": sorted(open_position.recorded_horizons),
                                }
                                if open_position
                                else None
                            ),
                        )
                    else:
                        self._set_status(
                            state="warming",
                            constituents_fresh=state.fresh_constituent_count(
                                max_age_seconds=params.max_data_age_seconds
                            ),
                            nifty_ltp=state.spot_price or None,
                            synthetic_vwap=state.synthetic_vwap,
                        )

                elapsed = time.monotonic() - loop_started
                self._stop_event.wait(max(self.config.feed_poll_seconds - elapsed, 0.05))
        finally:
            feed.stop()
            self._set_status(feed_connected=False)

    def _run(self) -> None:
        try:
            while not self._stop_event.is_set():
                if not is_nse_session():
                    self._set_status(
                        running=True,
                        state="waiting_market",
                        feed_connected=False,
                    )
                    self._stop_event.wait(5.0)
                    continue
                try:
                    self._run_session()
                except Exception as exc:
                    logger.exception("live paper engine session failed")
                    self._set_status(
                        state="error",
                        running=True,
                        feed_connected=False,
                        last_error=f"{type(exc).__name__}: {exc}",
                    )
                    self._stop_event.wait(5.0)
        finally:
            self._set_status(running=False, state="stopped", feed_connected=False)
