from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any

from .control_plane import OracleControlAgent
from .replay_service import replay_stored_history
from .trading_runner import TradingEngineRuntime

logger = logging.getLogger(__name__)


class LiveOracleControlAgent(OracleControlAgent):
    """Oracle control worker with a separately startable trading engine."""

    def __init__(self, control: Any, **kwargs: Any) -> None:
        super().__init__(control, **kwargs)
        self.paper_runtime = TradingEngineRuntime(control)

    def _write_paper_status(self) -> None:
        status = self.paper_runtime.status()
        self.control.client.table("paper_engine_status").upsert(
            {"worker_id": self.worker_id, "payload": status, "updated_at": datetime.now(timezone.utc).isoformat()},
            on_conflict="worker_id",
        ).execute()

    def _activity(self, severity: str, event_type: str, title: str, detail: str = "") -> None:
        try:
            self.control.client.table("activity_events").insert({
                "observed_at": datetime.now(timezone.utc).isoformat(), "severity": severity,
                "component": "control-plane", "event_type": event_type, "title": title, "detail": detail,
            }).execute()
        except Exception:
            logger.debug("activity table unavailable", exc_info=True)

    def _start_engine(self) -> dict[str, Any]:
        self.groww_authenticated = True
        status = self.paper_runtime.start(self._groww_client)
        self.last_error = None
        self._write_paper_status()
        return {"ok": True, "trading_engine": status, "paper_engine": status}

    def _stop_engine(self) -> dict[str, Any]:
        status = self.paper_runtime.stop()
        self._write_paper_status()
        return {"ok": True, "trading_engine": status, "paper_engine": status}

    def _force_paper_mode(self) -> None:
        self.control.client.table("execution_control_state").update({
            "mode": "paper", "live_armed": False, "armed_at": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", True).execute()

    def _set_kill_switch(self, enabled: bool, payload: dict[str, Any]) -> dict[str, Any]:
        close_position = bool(payload.get("close_position", True))
        reason = str(payload.get("reason") or ("Dashboard kill switch" if enabled else "Kill switch reset"))[:500]
        self.control.client.table("risk_control_state").update({
            "kill_switch": enabled, "block_new_entries": enabled,
            "close_open_position_on_kill": close_position, "reason": reason,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", True).execute()
        result = self.paper_runtime.set_kill_switch(enabled, close_position=close_position)
        self._activity("critical" if enabled else "success", "kill_switch", "Kill switch activated" if enabled else "Kill switch reset", reason)
        return result

    def _run_replay(self, payload: dict[str, Any]) -> dict[str, Any]:
        run_id = str(payload.get("replay_run_id") or "")
        if not run_id:
            raise ValueError("replay_run_id is required")
        try:
            result = replay_stored_history(self.control.client, run_id)
            self._activity("success", "replay", "Historical replay completed", f"Replay {run_id}: {result.get('frames', 0)} frames")
            return {"ok": True, "replay_run_id": run_id, "result": result}
        except Exception as exc:
            self.control.client.table("replay_runs").update({
                "status": "failed", "error": f"{type(exc).__name__}: {exc}",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", run_id).execute()
            raise

    def run_once(self) -> bool:
        self._write_heartbeat()
        self._write_paper_status()
        command = self.control.claim_command(self.worker_id)
        if command is None:
            return True

        command_id = str(command["id"])
        command_name = str(command["command"])
        payload = dict(command.get("payload") or {})
        stop_requested = command_name == "STOP"
        self.state = f"running:{command_name.lower()}"
        self._write_heartbeat()
        try:
            if command_name == "TEST_AUTH":
                result = self._test_auth()
            elif command_name == "TEST_MARKET_DATA":
                result = self._test_market_data()
            elif command_name == "START_PAPER_ENGINE":
                self._force_paper_mode()
                result = self._start_engine()
            elif command_name in {"START_ENGINE"}:
                result = self._start_engine()
            elif command_name in {"STOP_PAPER_ENGINE", "STOP_ENGINE"}:
                result = self._stop_engine()
            elif command_name == "EXIT_PAPER_POSITION":
                result = self.paper_runtime.request_exit(float(payload.get("fraction", 1.0)))
            elif command_name == "UPDATE_PAPER_POSITION":
                result = self.paper_runtime.update_position_controls(payload)
            elif command_name == "KILL_SWITCH":
                result = self._set_kill_switch(True, payload)
            elif command_name == "RESET_KILL_SWITCH":
                result = self._set_kill_switch(False, payload)
            elif command_name == "RUN_REPLAY":
                result = self._run_replay(payload)
            elif command_name == "STOP":
                self.paper_runtime.stop()
                self._write_paper_status()
                self.state = "stopped"
                result = {"ok": True, "state": self.state, "trading_engine": self.paper_runtime.status(), "paper_engine": self.paper_runtime.status()}
            else:
                raise RuntimeError(f"unsupported command: {command_name}")
            self.control.complete_command(command_id, result=result)
            if command_name not in {"RUN_REPLAY", "KILL_SWITCH", "RESET_KILL_SWITCH"}:
                self._activity("success", "command", command_name.replace("_", " ").title(), "Command completed")
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            if command_name == "TEST_MARKET_DATA":
                self.market_data_status = "error"
            if command_name == "TEST_AUTH":
                self.groww_authenticated = False
            self.control.complete_command(command_id, error=self.last_error)
            self._activity("critical", "command_failed", f"{command_name} failed", self.last_error)
            logger.exception("control command %s failed", command_name)
        finally:
            if not stop_requested:
                self.state = "idle"
            self._write_heartbeat()
            try:
                self._write_paper_status()
            except Exception:
                logger.exception("trading-engine status write failed")

        return not stop_requested
