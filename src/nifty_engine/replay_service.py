from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from .engine import SignalEngine
from .models import (
    ConstituentTick, Direction, FuturesTick, LevelKind, MarketSnapshot,
    OptionContract, OptionGreeks, OptionType, SupportResistanceLevel,
)
from .params import StrategyParams
from .replay import ReplayFrame, ReplayRunner
from .risk import RiskState

IST = ZoneInfo("Asia/Kolkata")


def _dt(value: Any) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _snapshot(payload: dict[str, Any]) -> MarketSnapshot:
    constituents = tuple(ConstituentTick(
        symbol=str(row["symbol"]), price=float(row["price"]), previous_price=float(row["previous_price"]),
        cumulative_volume=int(row["cumulative_volume"]), previous_cumulative_volume=int(row["previous_cumulative_volume"]),
        baseline_volume_rate=float(row["baseline_volume_rate"]), previous_volume_rate=float(row["previous_volume_rate"]),
        seconds_elapsed=float(row["seconds_elapsed"]), index_weight=float(row.get("index_weight", 1.0)),
        is_heavyweight=bool(row.get("is_heavyweight", False)),
    ) for row in payload.get("constituents", []))
    future_raw = payload["futures"]
    future = FuturesTick(
        symbol=str(future_raw["symbol"]), price=float(future_raw["price"]), previous_price=float(future_raw["previous_price"]),
        volume=int(future_raw["volume"]), previous_volume=int(future_raw["previous_volume"]),
        baseline_volume_rate=float(future_raw["baseline_volume_rate"]), seconds_elapsed=float(future_raw["seconds_elapsed"]),
        open_interest=float(future_raw["open_interest"]), previous_open_interest=float(future_raw["previous_open_interest"]),
        spot_price=float(future_raw["spot_price"]), previous_spot_price=float(future_raw["previous_spot_price"]),
    )
    options = tuple(OptionContract(
        trading_symbol=str(row["trading_symbol"]), option_type=OptionType(str(row["option_type"])),
        strike=float(row["strike"]), expiry=str(row["expiry"]), ltp=float(row["ltp"]),
        open_interest=int(row["open_interest"]), volume=int(row["volume"]), lot_size=int(row["lot_size"]),
        greeks=OptionGreeks(**{key: float(row["greeks"][key]) for key in ("delta","gamma","theta","vega","rho","iv")}),
        bid_price=float(row["bid_price"]) if row.get("bid_price") is not None else None,
        ask_price=float(row["ask_price"]) if row.get("ask_price") is not None else None,
    ) for row in payload.get("options", []))
    return MarketSnapshot(
        timestamp=_dt(payload["timestamp"]), spot_price=float(payload["spot_price"]),
        previous_spot_price=float(payload["previous_spot_price"]), constituents=constituents,
        futures=future, options=options,
        synthetic_vwap=float(payload["synthetic_vwap"]) if payload.get("synthetic_vwap") is not None else None,
    )


def _levels(payload: list[dict[str, Any]]) -> tuple[SupportResistanceLevel, ...]:
    return tuple(SupportResistanceLevel(
        name=str(row["name"]), kind=LevelKind(str(row["kind"])), price=float(row["price"]),
        source=str(row.get("source", "replay")), enabled=bool(row.get("enabled", True)),
    ) for row in payload)


def replay_stored_history(client: Any, run_id: str) -> dict[str, Any]:
    run_response = client.table("replay_runs").select("request").eq("id", run_id).single().execute()
    request = dict(run_response.data["request"] if isinstance(run_response.data, dict) else run_response.data[0]["request"])
    day = str(request["date"])
    start_text = str(request.get("startTime") or request.get("start_time") or "09:15")
    end_text = str(request.get("endTime") or request.get("end_time") or "15:30")
    start = datetime.fromisoformat(f"{day}T{start_text}:00").replace(tzinfo=IST).astimezone(timezone.utc)
    end = datetime.fromisoformat(f"{day}T{end_text}:00").replace(tzinfo=IST).astimezone(timezone.utc)
    client.table("replay_runs").update({"status": "running", "error": None}).eq("id", run_id).execute()
    rows_response = client.table("market_snapshot_history").select("snapshot,levels,data_age_seconds,strategy_parameters,observed_at").gte("observed_at", start.isoformat()).lte("observed_at", end.isoformat()).order("observed_at").execute()
    rows = list(rows_response.data or [])
    if not rows:
        result = {"frames": 0, "breakouts": 0, "reversals": 0, "uncertain": 0, "noLevel": 0, "riskApproved": 0, "message": "No stored market snapshots exist for this range. Replay only uses data captured by this system."}
        client.table("replay_runs").update({"status": "completed", "result": result, "completed_at": datetime.now(timezone.utc).isoformat()}).eq("id", run_id).execute()
        return result
    parameter_map = rows[0].get("strategy_parameters") if isinstance(rows[0].get("strategy_parameters"), dict) else {}
    params = StrategyParams.from_mapping(parameter_map)
    frames = [ReplayFrame(_snapshot(dict(row["snapshot"])), _levels(list(row.get("levels") or [])), float(row.get("data_age_seconds") or 0.0)) for row in rows]
    starting_capital = float(request.get("startingCapital") or request.get("starting_capital") or 2_000_000.0)
    replay = ReplayRunner(SignalEngine(params)).run(frames, RiskState(account_equity=starting_capital))
    summary = replay.summary
    result = {
        "frames": summary.frames, "breakouts": summary.breakouts, "reversals": summary.reversals,
        "uncertain": summary.uncertain, "noLevel": summary.no_level, "riskApproved": summary.risk_approved,
        "firstObservedAt": frames[0].snapshot.timestamp.isoformat(), "lastObservedAt": frames[-1].snapshot.timestamp.isoformat(),
        "signalIds": [], "message": "Deterministic signal replay; historical fills/P&L are intentionally not invented.",
    }
    client.table("replay_runs").update({"status": "completed", "result": result, "completed_at": datetime.now(timezone.utc).isoformat()}).eq("id", run_id).execute()
    return result
