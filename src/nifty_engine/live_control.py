from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any

from .control_plane import OracleControlAgent
from .paper_runner import PaperEngineRuntime

logger = logging.getLogger(__name__)


class LiveOracleControlAgent(OracleControlAgent):
    """Oracle control worker with a separately startable/stoppable paper engine."""

    def __init__(self, control: Any, **kwargs: Any) -> None:
        super().__init__(control, **kwargs)
        self.paper_runtime = PaperEngineRuntime(control)

    def _write_paper_status(self) -> None:
        status = self.paper_runtime.status()
        self.control.client.table("paper_engine_status").upsert(
            {
                "worker_id": self.worker_id,
                "payload": status,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="worker_id",
        ).execute()

    def _start_paper_engine(self) -> dict[str, Any]:
        self.groww_authenticated = True
        status = self.paper_runtime.start(self._groww_client)
        self.last_error = None
        self._write_paper_status()
        return {"ok": True, "paper_engine": status}

    def _stop_paper_engine(self) -> dict[str, Any]:
        status = self.paper_runtime.stop()
        self._write_paper_status()
        return {"ok": True, "paper_engine": status}

    def run_once(self) -> bool:
        self._write_heartbeat()
        self._write_paper_status()
        command = self.control.claim_command(self.worker_id)
        if command is None:
            return True

        command_id = str(command["id"])
        command_name = str(command["command"])
        stop_requested = command_name == "STOP"
        self.state = f"running:{command_name.lower()}"
        self._write_heartbeat()
        try:
            if command_name == "TEST_AUTH":
                result = self._test_auth()
            elif command_name == "TEST_MARKET_DATA":
                result = self._test_market_data()
            elif command_name == "START_PAPER_ENGINE":
                result = self._start_paper_engine()
            elif command_name == "STOP_PAPER_ENGINE":
                result = self._stop_paper_engine()
            elif command_name == "STOP":
                self.paper_runtime.stop()
                self._write_paper_status()
                self.state = "stopped"
                result = {"ok": True, "state": self.state, "paper_engine": self.paper_runtime.status()}
            else:
                raise RuntimeError(f"unsupported command: {command_name}")
            self.control.complete_command(command_id, result=result)
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            if command_name == "TEST_MARKET_DATA":
                self.market_data_status = "error"
            if command_name == "TEST_AUTH":
                self.groww_authenticated = False
            self.control.complete_command(command_id, error=self.last_error)
            logger.exception("control command %s failed", command_name)
        finally:
            if not stop_requested:
                self.state = "idle"
            self._write_heartbeat()
            try:
                self._write_paper_status()
            except Exception:
                logger.exception("paper-engine status write failed")

        return not stop_requested
