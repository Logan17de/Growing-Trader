from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import logging
import threading
from typing import Any

from .instrument_registry import InstrumentRef

logger = logging.getLogger(__name__)
FEED_CLEANUP_TIMEOUT_SECONDS = 3.0


@dataclass(frozen=True, slots=True)
class FeedValue:
    value: float
    observed_at: datetime


@dataclass(frozen=True, slots=True)
class FeedSnapshot:
    spot: FeedValue | None
    constituents: dict[str, FeedValue]
    future: FeedValue | None

    @property
    def max_age_seconds(self) -> float:
        now = datetime.now(timezone.utc)
        values = [value for value in self.constituents.values()]
        if self.spot:
            values.append(self.spot)
        if self.future:
            values.append(self.future)
        if not values:
            return float("inf")
        return max(max((now - item.observed_at).total_seconds(), 0.0) for item in values)


def _timestamp(value: Any) -> datetime:
    try:
        millis = float(value)
        return datetime.fromtimestamp(millis / 1000.0, tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return datetime.now(timezone.utc)


class GrowwLiveFeed:
    def __init__(
        self,
        groww: Any,
        constituents: tuple[InstrumentRef, ...],
        index: InstrumentRef,
        future: InstrumentRef,
    ) -> None:
        from growwapi import GrowwFeed

        self.feed = GrowwFeed(groww)
        self.constituents = constituents
        self.index = index
        self.future = future
        self._equity_and_future = [
            ref.feed_request() for ref in (*constituents, future)
        ]
        self._index_request = [index.feed_request()]
        self._token_to_symbol = {
            ref.exchange_token: ref.trading_symbol for ref in constituents
        }
        self._running = False

    def start(self) -> None:
        if self._running:
            return
        self.feed.subscribe_ltp(self._equity_and_future)
        self.feed.subscribe_index_value(self._index_request)
        self._running = True

    def stop(self) -> None:
        """Best-effort unsubscribe without ever blocking session recovery.

        Groww can disconnect the socket before our cleanup runs. Synchronous
        unsubscribe calls on that dead connection have previously stalled the
        runtime, preventing the outer engine loop from creating a fresh feed.
        Mark the feed stopped immediately and bound cleanup in a daemon thread.
        """
        if not self._running:
            return
        self._running = False

        def cleanup() -> None:
            try:
                self.feed.unsubscribe_ltp(self._equity_and_future)
            except Exception:
                logger.debug("Groww LTP unsubscribe failed during feed cleanup", exc_info=True)
            try:
                self.feed.unsubscribe_index_value(self._index_request)
            except Exception:
                logger.debug("Groww index unsubscribe failed during feed cleanup", exc_info=True)

        worker = threading.Thread(target=cleanup, name="groww-feed-cleanup", daemon=True)
        worker.start()
        worker.join(FEED_CLEANUP_TIMEOUT_SECONDS)
        if worker.is_alive():
            logger.warning(
                "Groww feed cleanup exceeded %.1fs; continuing with a fresh feed",
                FEED_CLEANUP_TIMEOUT_SECONDS,
            )

    @property
    def running(self) -> bool:
        return self._running

    def snapshot(self) -> FeedSnapshot:
        if not self._running:
            return FeedSnapshot(None, {}, None)

        constituent_values: dict[str, FeedValue] = {}
        future_value: FeedValue | None = None
        try:
            ltp_payload = self.feed.get_ltp() or {}
        except Exception:
            ltp_payload = {}
        ltp_root = ltp_payload.get("ltp", ltp_payload) if isinstance(ltp_payload, dict) else {}
        exchange_root = ltp_root.get("NSE", {}) if isinstance(ltp_root, dict) else {}
        if isinstance(exchange_root, dict):
            cash = exchange_root.get("CASH", {})
            if isinstance(cash, dict):
                for token, item in cash.items():
                    symbol = self._token_to_symbol.get(str(token))
                    if not symbol or not isinstance(item, dict):
                        continue
                    try:
                        price = float(item.get("ltp"))
                    except (TypeError, ValueError):
                        continue
                    constituent_values[symbol] = FeedValue(
                        price, _timestamp(item.get("tsInMillis"))
                    )
            fno = exchange_root.get("FNO", {})
            if isinstance(fno, dict):
                item = fno.get(self.future.exchange_token)
                if item is None:
                    item = next(
                        (
                            candidate for token, candidate in fno.items()
                            if str(token) == self.future.exchange_token
                        ),
                        None,
                    )
                if isinstance(item, dict):
                    try:
                        future_value = FeedValue(
                            float(item.get("ltp")), _timestamp(item.get("tsInMillis"))
                        )
                    except (TypeError, ValueError):
                        future_value = None

        spot_value: FeedValue | None = None
        try:
            index_payload = self.feed.get_index_value() or {}
        except Exception:
            index_payload = {}
        if isinstance(index_payload, dict):
            item = (
                index_payload.get("NSE", {})
                .get("CASH", {})
                .get(self.index.exchange_token)
            )
            if item is None and self.index.exchange_token != "NIFTY":
                item = index_payload.get("NSE", {}).get("CASH", {}).get("NIFTY")
            if isinstance(item, dict):
                try:
                    spot_value = FeedValue(
                        float(item.get("value")), _timestamp(item.get("tsInMillis"))
                    )
                except (TypeError, ValueError):
                    spot_value = None

        return FeedSnapshot(spot_value, constituent_values, future_value)
