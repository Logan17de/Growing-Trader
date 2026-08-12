from __future__ import annotations

from typing import Any, Callable

from .models import OptionContract, OptionGreeks, OptionType


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_option_chain(
    payload: dict[str, Any],
    *,
    expiry: str,
    lot_size_for: Callable[[str, int], int],
) -> tuple[OptionContract, ...]:
    strikes = payload.get("strikes", {})
    if not isinstance(strikes, dict):
        return ()
    contracts: list[OptionContract] = []
    for strike_text, sides in strikes.items():
        if not isinstance(sides, dict):
            continue
        strike = _number(strike_text)
        for side in ("CE", "PE"):
            raw = sides.get(side)
            if not isinstance(raw, dict):
                continue
            symbol = str(raw.get("trading_symbol", "")).strip()
            if not symbol:
                continue
            greeks_raw = raw.get("greeks", {})
            if not isinstance(greeks_raw, dict):
                greeks_raw = {}
            contracts.append(
                OptionContract(
                    trading_symbol=symbol,
                    option_type=OptionType(side),
                    strike=strike,
                    expiry=expiry,
                    ltp=_number(raw.get("ltp")),
                    open_interest=max(int(_number(raw.get("open_interest"))), 0),
                    volume=max(int(_number(raw.get("volume"))), 0),
                    lot_size=lot_size_for(symbol, 1),
                    greeks=OptionGreeks(
                        delta=_number(greeks_raw.get("delta")),
                        gamma=_number(greeks_raw.get("gamma")),
                        theta=_number(greeks_raw.get("theta")),
                        vega=_number(greeks_raw.get("vega")),
                        rho=_number(greeks_raw.get("rho")),
                        iv=_number(greeks_raw.get("iv")),
                    ),
                )
            )
    return tuple(contracts)


def option_ltp(payload: dict[str, Any], trading_symbol: str) -> float | None:
    strikes = payload.get("strikes", {})
    if not isinstance(strikes, dict):
        return None
    for sides in strikes.values():
        if not isinstance(sides, dict):
            continue
        for side in ("CE", "PE"):
            raw = sides.get(side)
            if not isinstance(raw, dict):
                continue
            if str(raw.get("trading_symbol", "")) != trading_symbol:
                continue
            value = _number(raw.get("ltp"), -1.0)
            return value if value >= 0 else None
    return None
