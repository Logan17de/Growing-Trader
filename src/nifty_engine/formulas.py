from __future__ import annotations

import math
from typing import Iterable

from .math_utils import activity_from_rvol, bps_change, clamp, pct_change, safe_div, squash
from .models import (
    CashMetrics,
    ConstituentTick,
    FuturesMetrics,
    OptionContract,
    OptionMarketMetrics,
    OptionType,
    VwapMetrics,
)
from .params import StrategyParams


def constituent_metrics(
    ticks: Iterable[ConstituentTick], params: StrategyParams
) -> CashMetrics:
    rows = tuple(ticks)
    if not rows:
        raise ValueError("at least one constituent is required")

    weights = [max(row.index_weight, 0.0) for row in rows]
    total_weight = sum(weights)
    if total_weight <= 0:
        weights = [1.0 for _ in rows]
        total_weight = float(len(rows))
    weights = [w / total_weight for w in weights]

    weighted_signed_activity = 0.0
    weighted_activity = 0.0
    heavyweight_signed_activity = 0.0
    heavyweight_activity = 0.0
    signed_acceleration = 0.0
    advancers = 0
    decliners = 0
    active_shares: list[float] = []
    share_volume_delta = 0
    turnover_delta = 0.0

    for row, weight in zip(rows, weights, strict=True):
        dt = max(row.seconds_elapsed, 1e-6)
        delta_volume = max(row.cumulative_volume - row.previous_cumulative_volume, 0)
        share_volume_delta += delta_volume
        turnover_delta += delta_volume * max(row.price, 0.0)
        volume_rate = delta_volume / dt
        baseline = max(row.baseline_volume_rate, 1e-6)
        rvol = volume_rate / baseline
        activity = activity_from_rvol(rvol, params.rvol_cap)

        move_bps = bps_change(row.price, row.previous_price)
        direction = squash(move_bps, params.direction_scale_bps)
        if move_bps > 0:
            advancers += 1
        elif move_bps < 0:
            decliners += 1

        previous_rate = max(row.previous_volume_rate, 1e-6)
        accel_ratio = (volume_rate - previous_rate) / previous_rate
        accel = math.tanh(accel_ratio)

        signed = weight * activity * direction
        weighted_signed_activity += signed
        weighted_activity += weight * activity
        if row.is_heavyweight:
            heavyweight_signed_activity += signed
            heavyweight_activity += weight * activity
        signed_acceleration += weight * accel * direction
        active_shares.append(weight * activity)

    pressure = safe_div(weighted_signed_activity, weighted_activity)
    heavyweight_score = safe_div(heavyweight_signed_activity, heavyweight_activity)
    breadth = (advancers - decliners) / len(rows)

    # Participation uses normalized 1-HHI. It is high when activity is spread broadly and
    # low when only one or two names dominate the weighted activity.
    if weighted_activity <= 1e-12:
        participation = 0.0
    else:
        shares = [share / weighted_activity for share in active_shares if share > 0]
        hhi = sum(share * share for share in shares)
        n = len(rows)
        participation = clamp((1.0 - hhi) / (1.0 - 1.0 / n), 0.0, 1.0) if n > 1 else 1.0

    participation_factor = params.participation_floor + (
        1.0 - params.participation_floor
    ) * participation
    raw_score = (
        params.cash_pressure_weight * pressure
        + params.breadth_weight * breadth
        + params.heavyweight_weight * heavyweight_score
    )
    score = clamp(raw_score * participation_factor)

    return CashMetrics(
        pressure=clamp(pressure),
        breadth=clamp(breadth),
        participation=participation,
        signed_volume_acceleration=clamp(signed_acceleration),
        score=score,
        active_count=len(rows),
        advancers=advancers,
        decliners=decliners,
        heavyweight_score=clamp(heavyweight_score),
        share_volume_delta=share_volume_delta,
        turnover_delta=turnover_delta,
    )


def futures_metrics(tick: FuturesTick, params: StrategyParams) -> FuturesMetrics:
    dt = max(tick.seconds_elapsed, 1e-6)
    price_move_bps = bps_change(tick.price, tick.previous_price)
    price_direction = squash(price_move_bps, params.futures_direction_scale_bps)

    volume_rate = max(tick.volume - tick.previous_volume, 0) / dt
    rvol = volume_rate / max(tick.baseline_volume_rate, 1e-6)
    volume_activity = activity_from_rvol(rvol, params.rvol_cap)

    oi_change_pct = pct_change(tick.open_interest, tick.previous_open_interest)
    # Positive OI change confirms the direction; falling OI reduces confidence in it.
    oi_confirmation = price_direction * squash(oi_change_pct, params.futures_oi_scale_pct)

    current_basis = tick.price - tick.spot_price
    previous_basis = tick.previous_price - tick.previous_spot_price
    basis_change_bps = safe_div(current_basis - previous_basis, tick.spot_price) * 10_000.0
    basis_change = squash(basis_change_bps, params.futures_basis_scale_bps)

    directional_with_activity = price_direction * (0.50 + 0.50 * volume_activity)
    score = clamp(
        params.futures_price_weight * directional_with_activity
        + params.futures_oi_weight * oi_confirmation
        + params.futures_basis_weight * basis_change
    )

    return FuturesMetrics(
        price_direction=clamp(price_direction),
        volume_activity=volume_activity,
        oi_confirmation=clamp(oi_confirmation),
        basis_change=clamp(basis_change),
        score=score,
    )


def option_market_metrics(
    contracts: tuple[OptionContract, ...],
    previous_contracts: tuple[OptionContract, ...],
    spot_price: float,
    params: StrategyParams,
) -> OptionMarketMetrics:
    """Experimental near-ATM option activity confirmation.

    Positive score means call-side incremental volume, put-side incremental OI build,
    and/or call IV relative to put IV lean bullish under the configured hypothesis.
    This is deliberately a low-weight research feature because aggregate option data
    does not identify whether activity was initiated by buyers or sellers.
    """
    if not contracts or not previous_contracts or spot_price <= 0:
        return OptionMarketMetrics()

    strikes = sorted({item.strike for item in contracts}, key=lambda strike: abs(strike - spot_price))
    selected_strikes = set(strikes[: params.option_near_atm_strikes])
    current = [item for item in contracts if item.strike in selected_strikes]
    previous_by_symbol = {item.trading_symbol: item for item in previous_contracts}
    if not current:
        return OptionMarketMetrics()

    call_volume_delta = 0
    put_volume_delta = 0
    call_oi_delta = 0
    put_oi_delta = 0
    call_ivs: list[float] = []
    put_ivs: list[float] = []
    matched = 0

    for item in current:
        previous = previous_by_symbol.get(item.trading_symbol)
        if previous is not None:
            matched += 1
            volume_delta = max(item.volume - previous.volume, 0)
            oi_delta = max(item.open_interest - previous.open_interest, 0)
            if item.option_type is OptionType.CE:
                call_volume_delta += volume_delta
                call_oi_delta += oi_delta
            else:
                put_volume_delta += volume_delta
                put_oi_delta += oi_delta
        if item.greeks.iv > 0:
            if item.option_type is OptionType.CE:
                call_ivs.append(item.greeks.iv)
            else:
                put_ivs.append(item.greeks.iv)

    if matched == 0:
        return OptionMarketMetrics()

    volume_imbalance = safe_div(
        call_volume_delta - put_volume_delta,
        call_volume_delta + put_volume_delta,
    )
    # More incremental put OI than call OI is treated as bullish support for this
    # research hypothesis; this convention remains configurable/ablatable.
    oi_change_imbalance = safe_div(
        put_oi_delta - call_oi_delta,
        put_oi_delta + call_oi_delta,
    )
    call_iv = sum(call_ivs) / len(call_ivs) if call_ivs else 0.0
    put_iv = sum(put_ivs) / len(put_ivs) if put_ivs else 0.0
    iv_skew = (
        squash(call_iv - put_iv, params.option_iv_skew_scale_pct)
        if call_iv > 0 and put_iv > 0
        else 0.0
    )
    score = clamp(
        params.option_direction_volume_weight * volume_imbalance
        + params.option_direction_oi_weight * oi_change_imbalance
        + params.option_direction_iv_weight * iv_skew
    )
    return OptionMarketMetrics(
        score=score,
        volume_imbalance=clamp(volume_imbalance),
        oi_change_imbalance=clamp(oi_change_imbalance),
        iv_skew=clamp(iv_skew),
        call_volume_delta=call_volume_delta,
        put_volume_delta=put_volume_delta,
        call_oi_delta=call_oi_delta,
        put_oi_delta=put_oi_delta,
        contracts_used=len(current),
        ready=True,
    )


def vwap_metrics(spot_price: float, synthetic_vwap: float | None, params: StrategyParams) -> VwapMetrics:
    if synthetic_vwap is None or synthetic_vwap <= 0 or spot_price <= 0:
        return VwapMetrics()
    distance_bps = (spot_price / synthetic_vwap - 1.0) * 10_000.0
    return VwapMetrics(
        synthetic_vwap=synthetic_vwap,
        distance_bps=distance_bps,
        score=clamp(squash(distance_bps, params.vwap_direction_scale_bps)),
        ready=True,
    )


def combined_direction_score(
    cash: CashMetrics,
    futures: FuturesMetrics,
    params: StrategyParams,
    option_market: OptionMarketMetrics | None = None,
    vwap: VwapMetrics | None = None,
) -> float:
    weighted = [
        (params.combined_cash_weight, cash.score),
        (params.combined_futures_weight, futures.score),
    ]
    if option_market is not None and option_market.ready:
        weighted.append((params.combined_options_weight, option_market.score))
    if vwap is not None and vwap.ready:
        weighted.append((params.combined_vwap_weight, vwap.score))
    total = sum(weight for weight, _score in weighted)
    if total <= 0:
        raise ValueError("combined weights must be positive")
    return clamp(sum(weight * score for weight, score in weighted) / total)
