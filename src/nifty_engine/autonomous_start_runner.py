from __future__ import annotations

import logging

from . import autonomous_start
from .notifications import send_engine_waiting_email


def _retryable_waiting_notification(error: str, already_sent: bool) -> bool:
    """Only suppress duplicate waiting alerts after Resend confirms delivery."""
    if already_sent:
        return True

    notification = send_engine_waiting_email(error)
    if notification.get("sent"):
        return True

    logging.warning(
        "Trading-engine waiting email was not sent and will be retried: %s",
        notification.get("reason", "unknown reason"),
    )
    return False


def main() -> None:
    # Keep the market-start implementation unchanged; only replace its notification
    # acknowledgement semantics so a failed email is attempted again next cycle.
    autonomous_start._notify_waiting_once = _retryable_waiting_notification
    autonomous_start.main()


if __name__ == "__main__":
    main()
