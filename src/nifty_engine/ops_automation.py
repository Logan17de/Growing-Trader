from __future__ import annotations

from datetime import datetime, timezone
import time
from typing import Any

from .control_plane import SupabaseControlPlane


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
            # Emergency broker exit can complete while the stopped runtime's status row is stale.
            return
        payload = _runtime_payload(control)
        position = payload.get("open_position") or payload.get("open_paper_position")
        if not position and not live_orders:
            return
        time.sleep(2.0)
    raise TimeoutError("position did not become flat before the shutdown deadline")


def scheduled_start() -> dict[str, Any]:
    control = SupabaseControlPlane.from_env()
    _wait_worker(control)
    live_orders = _live_open_orders(control)
    if live_orders:
        raise RuntimeError(f"refusing scheduled start with unresolved LIVE orders: {live_orders}")

    control.client.table("risk_control_state").update({
        "kill_switch": False,
        "block_new_entries": False,
        "reason": "Scheduled morning startup",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", True).execute()

    execution = _execution_control(control)
    mode = str(execution.get("mode") or "paper")
    armed = bool(execution.get("live_armed"))
    runtime = _runtime_payload(control)
    if runtime.get("running"):
        return {"ok": True, "mode": mode, "started": False, "reason": "engine already running"}
    if mode == "live" and not armed:
        return {
            "ok": True,
            "mode": mode,
            "started": False,
            "reason": "LIVE mode is disarmed; Oracle control agent is online and waiting for dashboard arm/start",
        }

    command_id = _queue_command(control, "START_ENGINE")
    result = _wait_command(control, command_id, 90.0)
    return {"ok": True, "mode": mode, "started": True, "command": result}


def scheduled_shutdown() -> dict[str, Any]:
    control = SupabaseControlPlane.from_env()
    execution = _execution_control(control)
    mode = str(execution.get("mode") or "paper")
    live_orders_before = _live_open_orders(control)
    online = _worker_online(control)

    if not online:
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

    return {"ok": True, "mode": mode, "worker_online": True, "flat": True, "live_armed": False}
