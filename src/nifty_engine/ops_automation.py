from __future__ import annotations

from datetime import datetime, time as wall_time, timezone
import time
from typing import Any
from zoneinfo import ZoneInfo

from .control_plane import SupabaseControlPlane

IST = ZoneInfo("Asia/Kolkata")
AUTH_RETRY_SECONDS = 10 * 60
AUTH_RETRY_CUTOFF = wall_time(15, 20)


def _first_row(data: Any) -> dict[str, Any] | None:
    if isinstance(data, dict):
        return dict(data)
    if isinstance(data, list) and data:
        return dict(data[0])
    return None


def _queue_command(control: SupabaseControlPlane, command: str, payload: dict[str, Any] | None = None) -> str:
    active = control.client.table("engine_commands").select("id,status").eq("command", command).in_(
        "status", ["queued", "running"]
    ).order("created_at", desc=True).limit(1).execute()
    row = _first_row(active.data)
    if row:
        return str(row["id"])
    created = control.client.table("engine_commands").insert({
        "command": command,
        "payload": payload or {},
        "status": "queued",
    }).select("id").execute()
    row = _first_row(created.data)
    if not row:
        raise RuntimeError(f"could not queue {command}")
    return str(row["id"])


def _wait_command(control: SupabaseControlPlane, command_id: str, timeout_seconds: float = 60.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        response = control.client.table("engine_commands").select(
            "id,command,status,result,error,completed_at"
        ).eq("id", command_id).maybe_single().execute()
        row = _first_row(response.data)
        if row and row.get("status") == "completed":
            return row
        if row and row.get("status") == "failed":
            raise RuntimeError(f"{row.get('command')} failed: {row.get('error')}")
        time.sleep(1.0)
    raise TimeoutError(f"command {command_id} did not complete within {timeout_seconds:.0f}s")


def _worker_online(control: SupabaseControlPlane, max_age_seconds: float = 30.0) -> bool:
    response = control.client.table("engine_status").select("last_heartbeat,state").order(
        "last_heartbeat", desc=True
    ).limit(1).execute()
    row = _first_row(response.data)
    if not row or not row.get("last_heartbeat"):
        return False
    heartbeat = datetime.fromisoformat(str(row["last_heartbeat"]).replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - heartbeat).total_seconds() <= max_age_seconds


def _wait_worker(control: SupabaseControlPlane, timeout_seconds: float = 180.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if _worker_online(control):
            return
        time.sleep(2.0)
    raise TimeoutError("Oracle control agent did not become online")


def _execution_control(control: SupabaseControlPlane) -> dict[str, Any]:
    response = control.client.table("execution_control_state").select(
        "mode,live_armed,max_order_premium,updated_at"
    ).eq("id", True).maybe_single().execute()
    return _first_row(response.data) or {"mode": "paper", "live_armed": False}


def _runtime_payload(control: SupabaseControlPlane) -> dict[str, Any]:
    response = control.client.table("paper_engine_status").select("payload,updated_at").order(
        "updated_at", desc=True
    ).limit(1).execute()
    row = _first_row(response.data) or {}
    payload = row.get("payload")
    return dict(payload) if isinstance(payload, dict) else {}


def _live_open_orders(control: SupabaseControlPlane) -> list[dict[str, Any]]:
    response = control.client.table("orders").select(
        "id,trading_symbol,quantity,status,broker_order_id,order_reference_id"
    ).eq("mode", "live").in_("status", ["OPEN", "SUBMITTING"]).gt("quantity", 0).execute()
    return [dict(row) for row in (response.data or [])]


def _wait_flat(control: SupabaseControlPlane, mode: str, timeout_seconds: float = 120.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        live_orders = _live_open_orders(control)
        if mode == "live" and not live_orders:
            return
        payload = _runtime_payload(control)
        position = payload.get("open_position") or payload.get("open_paper_position")
        if not position and not live_orders:
            return
        time.sleep(2.0)
    raise TimeoutError("position did not become flat before the shutdown deadline")


def _broker_audit(control: SupabaseControlPlane, timeout_seconds: float = 90.0) -> dict[str, Any]:
    command_id = _queue_command(control, "CHECK_LIVE_POSITIONS")
    row = _wait_command(control, command_id, timeout_seconds)
    result = row.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("broker position audit returned no structured result")
    return dict(result)


def _force_paper_mode(control: SupabaseControlPlane) -> None:
    now = datetime.now(timezone.utc).isoformat()
    control.client.table("execution_control_state").update({
        "mode": "paper",
        "live_armed": False,
        "armed_at": None,
        "updated_at": now,
    }).eq("id", True).execute()


def scheduled_start() -> dict[str, Any]:
    """Authenticate Groww first, then start the autonomous PAPER runtime.

    Scheduled background startup is deliberately PAPER-only. LIVE always remains
    an explicit dashboard action and is disarmed before the morning automation.
    """
    control = SupabaseControlPlane.from_env()
    _wait_worker(control)
    live_orders = _live_open_orders(control)
    if live_orders:
        raise RuntimeError(f"refusing scheduled PAPER start with unresolved LIVE orders: {live_orders}")

    runtime = _runtime_payload(control)
    if runtime.get("running"):
        mode = str(runtime.get("mode") or _execution_control(control).get("mode") or "paper")
        if mode != "paper":
            raise RuntimeError("LIVE engine is already running; refusing autonomous PAPER switch")
        return {"ok": True, "mode": "paper", "started": False, "reason": "PAPER engine already running"}

    _force_paper_mode(control)
    control.client.table("risk_control_state").update({
        "kill_switch": False,
        "block_new_entries": False,
        "reason": "Scheduled morning PAPER startup",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", True).execute()

    command_id = _queue_command(control, "RUN_PAPER")
    result = _wait_command(control, command_id, 90.0)
    payload = result.get("result") if isinstance(result.get("result"), dict) else {}
    authentication = payload.get("authentication") if isinstance(payload, dict) else None
    if not isinstance(authentication, dict) or authentication.get("ok") is not True:
        raise RuntimeError("RUN_PAPER completed without confirmed Groww authentication")
    return {"ok": True, "mode": "paper", "started": True, "command": result}


def scheduled_retry(
    *,
    interval_seconds: float = AUTH_RETRY_SECONDS,
    initial_delay_seconds: float = AUTH_RETRY_SECONDS,
) -> dict[str, Any]:
    """Retry Groww authentication every ten minutes without sending any email.

    The morning GitHub workflow performs the first attempt and owns the single
    notification email. This Oracle-side watcher starts with a ten-minute delay,
    retries until Groww accepts the saved key/secret, and exits at the final safe
    startup cutoff before the market-close shutdown window.
    """
    if interval_seconds <= 0 or initial_delay_seconds < 0:
        raise ValueError("retry intervals must be non-negative and interval_seconds must be positive")

    last_error: str | None = None
    attempts = 0
    delay_seconds = initial_delay_seconds

    while True:
        now = datetime.now(IST)
        if now.weekday() >= 5 or now.time() >= AUTH_RETRY_CUTOFF:
            return {
                "ok": False,
                "started": False,
                "attempts": attempts,
                "last_error": last_error,
                "reason": "Groww was not authenticated before the final safe startup cutoff",
            }

        if delay_seconds > 0:
            seconds_until_cutoff = max(
                (datetime.combine(now.date(), AUTH_RETRY_CUTOFF, tzinfo=IST) - now).total_seconds(),
                0.0,
            )
            sleep_for = min(delay_seconds, seconds_until_cutoff)
            if sleep_for <= 0:
                continue
            time.sleep(sleep_for)

        now = datetime.now(IST)
        if now.time() >= AUTH_RETRY_CUTOFF:
            continue

        attempts += 1
        try:
            result = scheduled_start()
            return {"ok": True, "started": True, "attempts": attempts, "result": result}
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            delay_seconds = interval_seconds


def scheduled_shutdown() -> dict[str, Any]:
    control = SupabaseControlPlane.from_env()
    execution = _execution_control(control)
    mode = str(execution.get("mode") or "paper")
    live_orders_before = _live_open_orders(control)
    online = _worker_online(control)

    if not online:
        if mode == "live":
            raise RuntimeError(
                "Oracle control agent is offline in LIVE mode; broker-flat state cannot be verified, refusing VM shutdown"
            )
        if live_orders_before:
            raise RuntimeError(
                "Oracle control agent is offline while a LIVE order is unresolved; refusing VM shutdown"
            )
        control.client.table("execution_control_state").update({
            "live_armed": False,
            "armed_at": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", True).execute()
        return {"ok": True, "mode": mode, "worker_online": False, "flat": True}

    kill_id = _queue_command(control, "KILL_SWITCH", {
        "close_position": True,
        "reason": "Scheduled market-close shutdown",
    })
    _wait_command(control, kill_id, 60.0)
    _wait_flat(control, mode, 150.0)

    broker_audit: dict[str, Any] | None = None
    if mode == "live":
        broker_audit = _broker_audit(control)
        if not bool(broker_audit.get("flat")):
            raise RuntimeError(f"Groww still has a NIFTY F&O position after flatten: {broker_audit}")

    stop_id = _queue_command(control, "STOP_ENGINE")
    _wait_command(control, stop_id, 60.0)

    control.client.table("execution_control_state").update({
        "live_armed": False,
        "armed_at": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", True).execute()
    control.client.table("risk_control_state").update({
        "kill_switch": False,
        "block_new_entries": False,
        "reason": "Scheduled shutdown completed; LIVE remains disarmed",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", True).execute()

    live_orders_after = _live_open_orders(control)
    if live_orders_after:
        raise RuntimeError(f"LIVE orders remain after safe shutdown: {live_orders_after}")

    return {
        "ok": True,
        "mode": mode,
        "worker_online": True,
        "flat": True,
        "live_armed": False,
        "broker_audit": broker_audit,
    }
