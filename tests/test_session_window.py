from __future__ import annotations

from datetime import datetime, timezone
import time

from nifty_engine.market_feed import GrowwLiveFeed
from nifty_engine.session_window import observation_window_open


def test_observation_window_is_ten_minutes_before_and_after_nse() -> None:
    before = datetime(2026, 8, 25, 3, 34, tzinfo=timezone.utc)  # 09:04 IST
    start = datetime(2026, 8, 25, 3, 35, tzinfo=timezone.utc)   # 09:05 IST
    close = datetime(2026, 8, 25, 10, 10, tzinfo=timezone.utc)  # 15:40 IST
    after = datetime(2026, 8, 25, 10, 11, tzinfo=timezone.utc)  # 15:41 IST
    assert not observation_window_open(before)
    assert observation_window_open(start)
    assert observation_window_open(close)
    assert not observation_window_open(after)


class _HungFeed:
    def unsubscribe_ltp(self, _requests: object) -> None:
        time.sleep(10)

    def unsubscribe_index_value(self, _requests: object) -> None:
        time.sleep(10)


def test_feed_stop_is_bounded_even_when_unsubscribe_hangs(monkeypatch) -> None:
    import nifty_engine.market_feed as market_feed

    monkeypatch.setattr(market_feed, "FEED_CLEANUP_TIMEOUT_SECONDS", 0.05)
    feed = GrowwLiveFeed.__new__(GrowwLiveFeed)
    feed.feed = _HungFeed()
    feed._equity_and_future = []
    feed._index_request = []
    feed._running = True

    started = time.monotonic()
    feed.stop()
    elapsed = time.monotonic() - started

    assert not feed.running
    assert elapsed < 0.5
