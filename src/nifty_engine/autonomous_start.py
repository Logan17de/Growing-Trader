from __future__ import annotations

from datetime import datetime, time as wall_time, timezone
import logging
import time
from typing import Any
from zoneinfo import ZoneInfo

from .control_plane import SupabaseControlPlane
from .notifications import send_engine_started_email, send_engine_waiting_email
from .ops_automation import scheduled_start

IST = ZoneInfo("Asia/Kolkata")
# Observation starts ten minutes before the 09:15 NSE cash session. Entry rules remain
# independently constrained by paper_entry_window_open() and are not widened here.
MARKET_START_TIME = wall_time(9, 5)
# Keep recovery available until shortly before the 15:40 observation window ends. New
# entries are already blocked after 15:15 by the trading engine.
FINAL_START_CUTOFF = wall_time(15, 35)
RETRY_SECONDS = 10 * 60
RESTART_STATUS_SETTLE_SECONDS = 3.0


def _seconds_until(now: datetime, target: wall_time) -> float:
    target_dt = datetime.combine(now.date(), target, tzinfo=IST)
    return max((target_dt - now).total_seconds(), 0.0)


def _notify_waiting_once(error: str, already_sent: bool) -> bool:
    if already_sent:
        return True
    notification = send_engine_waiting_email(error)
    if not notification.get("sent"):
        logging.warning("Trading-engine waiting email was not sent: %s", notification.get("reason", "unknown reason"))
    return True


def _confirmed_runtime_running(max_age_seconds: float = 15.0) -> bool:
    """Confirm that PAPER-running status is fresh after a control-agent restart.

    During a service replacement, Supabase can briefly retain the previous process's
    `running=true` payload. Treat it as authoritative only when it remains fresh
    after a short settle period; otherwise the autonomous starter must try again.
    """
    try:
        control = SupabaseControlPlane.from_env()
        response = control.client.table("paper_engine_status").select(
            "payload,updated_at"
        ).order("updated_at", desc=True).limit(1).execute()
        data = response.data
        row: dict[str, Any] | None = None
        if isinstance(data, dict):
            row = dict(data)
        elif isinstance(data, list) and data and isinstance(data[0], dict):
            row = dict(data[0])
        if not row or not row.get("updated_at"):
            return False
        payload = row.get("payload")
        if not isinstance(payload, dict):
            return False
        updated_at = datetime.fromisoformat(str(row["updated_at"]).replace("Z", "+00:00"))
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - updated_at.astimezone(timezone.utc)).total_seconds()
        state = str(payload.get("state") or "")
        return (
            -2.0 <= age <= max_age_seconds
            and bool(payload.get("running"))
            and state not in {"stopped", "stopping"}
        )
    except Exception:
        logging.debug("Could not confirm fresh PAPER runtime status", exc_info=True)
        return False


def run_autonomous_start() -> dict[str, Any]:
    """Own the weekday PAPER startup loop on Oracle itself.

    The VM can boot and start this service without GitHub remaining connected.
    It waits until 09:05 IST when necessary, attempts Groww authentication and
    PAPER startup immediately, sends one waiting email after the first failure,
    retries every ten minutes, and sends a success email once PAPER starts.
    """
    now = datetime.now(IST)
    if now.weekday() >= 5:
        return {"ok": False, "started": False, "reason": "weekend"}
    if now.time() >= FINAL_START_CUTOFF:
        return {"ok": False, "started": False, "reason": "past final safe startup cutoff"}

    if now.time() < MARKET_START_TIME:
        time.sleep(_seconds_until(now, MARKET_START_TIME))

    attempts = 0
    waiting_email_sent = False
    last_error: str | None = None

    while True:
        now = datetime.now(IST)
        if now.weekday() >= 5 or now.time() >= FINAL_START_CUTOFF:
            return {
                "ok": False,
                "started": False,
                "attempts": attempts,
                "last_error": last_error,
                "reason": "Groww/PAPER startup did not succeed before the final safe startup cutoff",
            }

        attempts += 1
        try:
            result = scheduled_start()
            if result.get("ok"):
                if result.get("started"):
                    email_result = dict(result)
                    retry_attempts = attempts - 1
                    if retry_attempts > 0:
                        email_result["attempts"] = retry_attempts
                    notification = send_engine_started_email(email_result)
                    if not notification.get("sent"):
                        logging.warning(
                            "Trading-engine startup email was not sent: %s",
                            notification.get("reason", "unknown reason"),
                        )
                    return {
                        "ok": True,
                        "started": True,
                        "attempts": attempts,
                        "result": result,
                    }

                if str(result.get("reason") or "") == "PAPER engine already running":
                    time.sleep(RESTART_STATUS_SETTLE_SECONDS)
                    if _confirmed_runtime_running():
                        return {
                            "ok": True,
                            "started": False,
                            "attempts": attempts,
                            "result": result,
                        }
                    last_error = "stale PAPER-running status observed during control-agent restart"
                    logging.warning("%s; retrying startup immediately", last_error)
                    time.sleep(2.0)
                    continue

                return {
                    "ok": True,
                    "started": False,
                    "attempts": attempts,
                    "result": result,
                }
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            logging.warning("Autonomous PAPER startup attempt %s failed: %s", attempts, last_error)
            waiting_email_sent = _notify_waiting_once(last_error, waiting_email_sent)

        now = datetime.now(IST)
        seconds_until_cutoff = _seconds_until(now, FINAL_START_CUTOFF)
        if seconds_until_cutoff <= 0:
            continue
        time.sleep(min(RETRY_SECONDS, seconds_until_cutoff))


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    result = run_autonomous_start()
    logging.info("Autonomous market-start service finished: %s", result)


if __name__ == "__main__":
    main()
