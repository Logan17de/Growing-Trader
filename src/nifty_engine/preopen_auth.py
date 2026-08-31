from __future__ import annotations

import logging

from .control_plane import SupabaseControlPlane
from .notifications import send_engine_waiting_email
from .ops_automation import _queue_command, _wait_command, _wait_worker

logger = logging.getLogger(__name__)


def main() -> None:
    """Verify saved Groww credentials before the market-start window.

    This is authentication-only. It never starts the trading runtime and never
    places an order. A failed check sends the existing waiting email early so
    the operator has time to approve/fix the Groww API session before 09:05 IST.
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    try:
        control = SupabaseControlPlane.from_env()
        _wait_worker(control, 120.0)
        command_id = _queue_command(control, "TEST_AUTH")
        result = _wait_command(control, command_id, 60.0)
        payload = result.get("result") if isinstance(result.get("result"), dict) else {}
        if payload.get("ok") is not True:
            raise RuntimeError("TEST_AUTH completed without confirmed Groww authorization")
        logger.info("Pre-open Groww authorization verified successfully")
    except Exception as exc:
        detail = f"Pre-open Groww authorization check failed: {type(exc).__name__}: {exc}"
        logger.warning(detail)
        notification = send_engine_waiting_email(detail)
        if not notification.get("sent"):
            logger.warning("Pre-open Groww warning email was not sent: %s", notification.get("reason", "unknown reason"))
        # Do not fail/restart-loop this oneshot service. The 09:05 autonomous
        # starter remains responsible for normal retry behavior.


if __name__ == "__main__":
    main()
