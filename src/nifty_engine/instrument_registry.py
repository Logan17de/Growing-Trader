from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import json
import os
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True, slots=True)
class InstrumentRef:
    exchange: str
    segment: str
    exchange_token: str
    trading_symbol: str
    instrument_type: str
    lot_size: int = 1
    expiry_date: str | None = None
    underlying_symbol: str | None = None

    def feed_request(self) -> dict[str, str]:
        return {
            "exchange": self.exchange,
            "segment": self.segment,
            "exchange_token": self.exchange_token,
        }


@dataclass(frozen=True, slots=True)
class NiftyUniverse:
    symbols: tuple[str, ...]
    as_of: str
    source_note: str


def _default_symbols_path() -> Path:
    configured = os.getenv("NIFTY50_SYMBOLS_PATH")
    if configured:
        return Path(configured)
    candidates = (
        Path.cwd() / "config" / "nifty50.symbols.json",
        Path(__file__).resolve().parents[2] / "config" / "nifty50.symbols.json",
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def load_nifty50_universe(path: str | Path | None = None) -> NiftyUniverse:
    target = Path(path) if path is not None else _default_symbols_path()
    raw = json.loads(target.read_text(encoding="utf-8"))
    symbols = tuple(str(item).strip().upper() for item in raw.get("symbols", []) if str(item).strip())
    if len(symbols) != 50 or len(set(symbols)) != 50:
        raise RuntimeError(f"{target} must contain exactly 50 unique NIFTY symbols")
    return NiftyUniverse(
        symbols=symbols,
        as_of=str(raw.get("as_of", "unknown")),
        source_note=str(raw.get("source_note", "")),
    )


def _clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in {"nan", "nat", "none"} else text


def _to_int(value: Any, default: int = 1) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _records(frame: Any) -> list[dict[str, Any]]:
    if hasattr(frame, "to_dict"):
        try:
            rows = frame.to_dict(orient="records")
            if isinstance(rows, list):
                return [dict(row) for row in rows]
        except TypeError:
            pass
    if isinstance(frame, list):
        return [dict(row) for row in frame if isinstance(row, dict)]
    raise RuntimeError("Groww instrument master did not return a DataFrame/list-like payload")


class InstrumentRegistry:
    def __init__(self, groww: Any, *, today: date | None = None) -> None:
        self.groww = groww
        self.today = today or date.today()
        self.rows = _records(groww.get_all_instruments())
        self._by_symbol = {
            _clean(row.get("trading_symbol")).upper(): row
            for row in self.rows
            if _clean(row.get("trading_symbol"))
        }

    @staticmethod
    def _ref(row: dict[str, Any]) -> InstrumentRef:
        return InstrumentRef(
            exchange=_clean(row.get("exchange")).upper(),
            segment=_clean(row.get("segment")).upper(),
            exchange_token=_clean(row.get("exchange_token")),
            trading_symbol=_clean(row.get("trading_symbol")).upper(),
            instrument_type=_clean(row.get("instrument_type")).upper(),
            lot_size=_to_int(row.get("lot_size"), 1),
            expiry_date=_clean(row.get("expiry_date")) or None,
            underlying_symbol=_clean(row.get("underlying_symbol")).upper() or None,
        )

    def resolve_constituents(self, symbols: Iterable[str]) -> tuple[InstrumentRef, ...]:
        resolved: list[InstrumentRef] = []
        missing: list[str] = []
        for symbol in symbols:
            name = str(symbol).upper()
            row = self._by_symbol.get(name)
            if not row:
                missing.append(name)
                continue
            ref = self._ref(row)
            if ref.exchange != "NSE" or ref.segment != "CASH":
                missing.append(name)
                continue
            resolved.append(ref)
        if len(resolved) < 45:
            raise RuntimeError(
                f"only {len(resolved)} NIFTY constituents resolved from instrument master; "
                f"missing={missing[:10]}"
            )
        return tuple(resolved)

    def nifty_index(self) -> InstrumentRef:
        for row in self.rows:
            if (
                _clean(row.get("exchange")).upper() == "NSE"
                and _clean(row.get("segment")).upper() == "CASH"
                and _clean(row.get("trading_symbol")).upper() == "NIFTY"
            ):
                ref = self._ref(row)
                return InstrumentRef(
                    exchange=ref.exchange,
                    segment=ref.segment,
                    exchange_token="NIFTY",
                    trading_symbol="NIFTY",
                    instrument_type=ref.instrument_type or "INDEX",
                    lot_size=1,
                )
        return InstrumentRef("NSE", "CASH", "NIFTY", "NIFTY", "INDEX", 1)

    def nearest_nifty_future(self) -> InstrumentRef:
        candidates: list[InstrumentRef] = []
        today_text = self.today.isoformat()
        for row in self.rows:
            ref = self._ref(row)
            if (
                ref.exchange == "NSE"
                and ref.segment == "FNO"
                and ref.instrument_type == "FUT"
                and ref.underlying_symbol == "NIFTY"
                and ref.expiry_date
                and ref.expiry_date >= today_text
            ):
                candidates.append(ref)
        if not candidates:
            raise RuntimeError("no current NIFTY future found in Groww instrument master")
        return min(candidates, key=lambda item: item.expiry_date or "9999-12-31")

    def nearest_nifty_option_expiry(self) -> str:
        today_text = self.today.isoformat()
        expiries = {
            ref.expiry_date
            for row in self.rows
            if (ref := self._ref(row)).exchange == "NSE"
            and ref.segment == "FNO"
            and ref.instrument_type in {"CE", "PE"}
            and ref.underlying_symbol == "NIFTY"
            and ref.expiry_date
            and ref.expiry_date >= today_text
        }
        if not expiries:
            raise RuntimeError("no current NIFTY option expiry found in Groww instrument master")
        return min(expiries)

    def lot_size_for(self, trading_symbol: str, default: int = 1) -> int:
        row = self._by_symbol.get(trading_symbol.upper())
        return _to_int(row.get("lot_size"), default) if row else default
