from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from .models import ConstituentTick, FuturesTick, MarketSnapshot, OptionContract


# Apr-2026 NIFTY factsheet top-ten membership. The symbols are configuration context,
# not a claim that these weights stay constant; DB-backed index weights can override
# the numeric contribution while this set exposes the explicit heavyweight feature.
DEFAULT_HEAVYWEIGHTS = frozenset(
    {
        "HDFCBANK",
        "RELIANCE",
        "ICICIBANK",
        "BHARTIARTL",
        "LT",
        "SBIN",
        "INFY",
        "AXISBANK",
        "ITC",
        "KOTAKBANK",
    }
)


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@dataclass(slots=True)
class QuoteWindow:
    symbol: str
    price: float = 0.0
    previous_price: float = 0.0
    cumulative_volume: int = 0
    previous_cumulative_volume: int = 0
    previous_volume_rate: float = 1.0
    last_volume_rate: float = 1.0
    baseline_volume_rate: float = 1.0
    open_interest: float = 0.0
    previous_open_interest: float = 0.0
    updated_at: datetime | None = None
    seconds_elapsed: float = 1.0
    samples: int = 0
    last_delta_volume: int = 0
    last_turnover: float = 0.0

    def update(self, quote: dict[str, Any], at: datetime) -> None:
        price = _num(quote.get("last_price"), self.price)
        volume = max(int(_num(quote.get("volume"), self.cumulative_volume)), 0)
        oi = _num(quote.get("open_interest"), self.open_interest)
        if self.updated_at is None:
            self.price = price
            self.previous_price = price
            self.cumulative_volume = volume
            self.previous_cumulative_volume = volume
            self.open_interest = oi
            previous_oi = quote.get("previous_open_interest")
            self.previous_open_interest = _num(previous_oi, oi)
            self.updated_at = at
            self.samples = 1
            self.last_delta_volume = 0
            self.last_turnover = 0.0
            return

        elapsed = max((at - self.updated_at).total_seconds(), 0.001)
        delta_volume = max(volume - self.cumulative_volume, 0)
        rate = delta_volume / elapsed
        self.previous_price = self.price
        self.price = price
        self.previous_cumulative_volume = self.cumulative_volume
        self.cumulative_volume = volume
        self.previous_open_interest = self.open_interest
        self.open_interest = oi
        self.seconds_elapsed = elapsed
        if self.samples <= 1:
            self.baseline_volume_rate = max(rate, 1.0)
            self.previous_volume_rate = max(rate, 1e-6)
        else:
            self.previous_volume_rate = max(self.last_volume_rate, 1e-6)
            self.baseline_volume_rate = max(
                0.90 * self.baseline_volume_rate + 0.10 * max(rate, 0.0),
                1e-6,
            )
        self.last_volume_rate = max(rate, 1e-6)
        self.last_delta_volume = delta_volume
        self.last_turnover = delta_volume * max(price, 0.0)
        self.updated_at = at
        self.samples += 1

    def age(self, now: datetime) -> float:
        if self.updated_at is None:
            return float("inf")
        return max((now - self.updated_at).total_seconds(), 0.0)


class LiveMarketState:
    def __init__(self) -> None:
        self.constituents: dict[str, QuoteWindow] = {}
        self.future: QuoteWindow | None = None
        self.spot_price = 0.0
        self.previous_spot_price = 0.0
        self.spot_updated_at: datetime | None = None
        self.feed_age_seconds = float("inf")
        self.options: tuple[OptionContract, ...] = ()
        self.options_updated_at: datetime | None = None
        self.synthetic_vwap: float | None = None
        self._vwap_turnover = 0.0
        self._vwap_price_turnover = 0.0

    def update_feed_spot(self, price: float, observed_at: datetime, feed_age_seconds: float) -> None:
        if price <= 0:
            return
        if self.spot_price <= 0:
            self.previous_spot_price = price
        self.spot_price = price
        self.spot_updated_at = observed_at
        self.feed_age_seconds = feed_age_seconds

    def update_constituent(self, symbol: str, quote: dict[str, Any], at: datetime) -> None:
        window = self.constituents.setdefault(symbol, QuoteWindow(symbol))
        window.update(quote, at)

    def update_future(self, symbol: str, quote: dict[str, Any], at: datetime) -> None:
        if self.future is None or self.future.symbol != symbol:
            self.future = QuoteWindow(symbol)
        self.future.update(quote, at)

    def update_synthetic_vwap(self) -> None:
        """Update a NIFTY-price VWAP using the 50-stock interval turnover as activity weight."""
        if self.spot_price <= 0:
            return
        interval_turnover = sum(item.last_turnover for item in self.constituents.values())
        if interval_turnover <= 0:
            return
        self._vwap_turnover += interval_turnover
        self._vwap_price_turnover += self.spot_price * interval_turnover
        self.synthetic_vwap = self._vwap_price_turnover / self._vwap_turnover

    def update_baselines(self, baselines: Mapping[tuple[str, int], float], minute_bucket: int) -> None:
        """Apply prior-session minute-of-day baselines when available."""
        for symbol, item in self.constituents.items():
            baseline = baselines.get((symbol, minute_bucket))
            if baseline is not None and baseline > 0:
                item.baseline_volume_rate = baseline
        if self.future is not None:
            baseline = baselines.get((self.future.symbol, minute_bucket))
            if baseline is not None and baseline > 0:
                self.future.baseline_volume_rate = baseline

    def set_options(self, contracts: tuple[OptionContract, ...], at: datetime) -> None:
        self.options = contracts
        self.options_updated_at = at

    def build_snapshot(
        self,
        *,
        now: datetime | None = None,
        max_age_seconds: float = 30.0,
        index_weights: Mapping[str, float] | None = None,
        heavyweights: frozenset[str] | set[str] | None = None,
    ) -> tuple[MarketSnapshot, float] | None:
        now = now or datetime.now(timezone.utc)
        fresh = [
            item
            for item in self.constituents.values()
            if item.samples >= 2 and item.age(now) <= max_age_seconds
        ]
        if len(fresh) < 45 or self.future is None or self.future.samples < 2:
            return None
        if self.future.age(now) > max_age_seconds or self.spot_updated_at is None:
            return None

        weights = index_weights or {}
        heavyweight_symbols = heavyweights if heavyweights is not None else DEFAULT_HEAVYWEIGHTS
        ticks = tuple(
            ConstituentTick(
                symbol=item.symbol,
                price=item.price,
                previous_price=item.previous_price,
                cumulative_volume=item.cumulative_volume,
                previous_cumulative_volume=item.previous_cumulative_volume,
                baseline_volume_rate=item.baseline_volume_rate,
                previous_volume_rate=item.previous_volume_rate,
                seconds_elapsed=item.seconds_elapsed,
                index_weight=max(float(weights.get(item.symbol, 1.0)), 0.0),
                is_heavyweight=item.symbol in heavyweight_symbols,
            )
            for item in fresh
        )
        previous_spot = self.previous_spot_price or self.spot_price
        future = FuturesTick(
            symbol=self.future.symbol,
            price=self.future.price,
            previous_price=self.future.previous_price,
            volume=self.future.cumulative_volume,
            previous_volume=self.future.previous_cumulative_volume,
            baseline_volume_rate=self.future.baseline_volume_rate,
            seconds_elapsed=self.future.seconds_elapsed,
            open_interest=self.future.open_interest,
            previous_open_interest=self.future.previous_open_interest,
            spot_price=self.spot_price,
            previous_spot_price=previous_spot,
        )
        ages = [item.age(now) for item in fresh]
        ages.extend([self.future.age(now), self.feed_age_seconds])
        if self.options_updated_at:
            ages.append(max((now - self.options_updated_at).total_seconds(), 0.0))
        data_age = max(ages) if ages else float("inf")
        snapshot = MarketSnapshot(
            timestamp=now,
            spot_price=self.spot_price,
            previous_spot_price=previous_spot,
            constituents=ticks,
            futures=future,
            options=self.options,
            synthetic_vwap=self.synthetic_vwap,
        )
        self.previous_spot_price = self.spot_price
        return snapshot, data_age

    def fresh_constituent_count(
        self, *, now: datetime | None = None, max_age_seconds: float = 30.0
    ) -> int:
        now = now or datetime.now(timezone.utc)
        return sum(
            1
            for item in self.constituents.values()
            if item.samples >= 2 and item.age(now) <= max_age_seconds
        )
