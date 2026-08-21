from __future__ import annotations

from datetime import datetime, time as wall_time
import logging
import time
from typing import Any
from zoneinfo import ZoneInfo

from .notifications import send_engine_started_email, send_engine_waiting_email
from .ops_automation import scheduled_start

IST = ZoneInfo("Asia/Kolkata")
MARKET_START_TIME = wall_time(9, 10)
FINAL_START_CUTOFF = wall_time(15, 20)
RETRY_SECONDS = 10 * 60


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


def run_autonomous_start() -> dict[str, Any]:
    """Own the weekday PAPER startup loop on Oracle itself.

    The VM can boot and start this service without GitHub remaining connected.
    It waits until 09:10 IST when necessary, attempts Groww authentication and
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
                    "started": bool(result.get("started")),
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
