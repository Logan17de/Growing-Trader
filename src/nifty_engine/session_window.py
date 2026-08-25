from __future__ import annotations

from datetime import datetime, time as clock_time, timezone
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
OBSERVATION_START = clock_time(9, 5)
OBSERVATION_END = clock_time(15, 40)


def observation_window_open(now: datetime | None = None) -> bool:
    """Return True during the data-watcher window, including 10m pre/post market.

    This deliberately does not control order-entry eligibility. Trading entry rules
    remain in paper_entry_window_open(), which stays inside the regular NSE session.
    """
    current = (now or datetime.now(timezone.utc)).astimezone(IST)
    if current.weekday() >= 5:
        return False
    local_time = current.time().replace(tzinfo=None)
    return OBSERVATION_START <= local_time <= OBSERVATION_END
