from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class LevelKind(str, Enum):
    SUPPORT = "support"
    RESISTANCE = "resistance"


class EventKind(str, Enum):
    BREAKOUT = "breakout"
    REVERSAL = "reversal"
    UNCERTAIN = "uncertain"
    NO_LEVEL = "no_level"


class Direction(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"
    FLAT = "flat"


class OptionType(str, Enum):
    CE = "CE"
    PE = "PE"


@dataclass(frozen=True, slots=True)
class ConstituentTick:
    symbol: str
    price: float
    previous_price: float
    cumulative_volume: int
    previous_cumulative_volume: int
    baseline_volume_rate: float
    previous_volume_rate: float
    seconds_elapsed: float
    index_weight: float = 1.0
    is_heavyweight: bool = False


@dataclass(frozen=True, slots=True)
class FuturesTick:
    symbol: str
    price: float
    previous_price: float
    volume: int
    previous_volume: int
    baseline_volume_rate: float
    seconds_elapsed: float
    open_interest: float
    previous_open_interest: float
    spot_price: float
    previous_spot_price: float


@dataclass(frozen=True, slots=True)
class OptionGreeks:
    delta: float
    gamma: float
    theta: float
    vega: float
    rho: float
    iv: float


@dataclass(frozen=True, slots=True)
class OptionContract:
    trading_symbol: str
    option_type: OptionType
    strike: float
    expiry: str
    ltp: float
    open_interest: int
    volume: int
    lot_size: int
    greeks: OptionGreeks
    bid_price: float | None = None
    ask_price: float | None = None


@dataclass(frozen=True, slots=True)
class SupportResistanceLevel:
    name: str
    kind: LevelKind
    price: float
    source: str = "manual"
    enabled: bool = True


@dataclass(frozen=True, slots=True)
class CashMetrics:
    pressure: float
    breadth: float
    participation: float
    signed_volume_acceleration: float
    score: float
    active_count: int
    advancers: int
    decliners: int
    heavyweight_score: float = 0.0
    share_volume_delta: int = 0
    turnover_delta: float = 0.0


@dataclass(frozen=True, slots=True)
class FuturesMetrics:
    price_direction: float
    volume_activity: float
    oi_confirmation: float
    basis_change: float
    score: float


@dataclass(frozen=True, slots=True)
class OptionMarketMetrics:
    score: float = 0.0
    volume_imbalance: float = 0.0
    oi_change_imbalance: float = 0.0
    iv_skew: float = 0.0
    call_volume_delta: int = 0
    put_volume_delta: int = 0
    call_oi_delta: int = 0
    put_oi_delta: int = 0
    contracts_used: int = 0
    ready: bool = False


@dataclass(frozen=True, slots=True)
class VwapMetrics:
    synthetic_vwap: float | None = None
    distance_bps: float = 0.0
    score: float = 0.0
    ready: bool = False


@dataclass(frozen=True, slots=True)
class LevelMetrics:
    event: EventKind
    event_score: float
    breakout_score: float
    reversal_score: float
    penetration: float
    rejection: float
    persistence: float
    distance_bps: float
    level_name: str | None


@dataclass(frozen=True, slots=True)
class ContractSelection:
    contract: OptionContract | None
    score: float
    reason: str


@dataclass(frozen=True, slots=True)
class RiskDecision:
    allowed: bool
    quantity: int
    max_premium_risk: float
    reason: str


@dataclass(frozen=True, slots=True)
class MarketSnapshot:
    timestamp: datetime
    spot_price: float
    previous_spot_price: float
    constituents: tuple[ConstituentTick, ...]
    futures: FuturesTick
    options: tuple[OptionContract, ...] = field(default_factory=tuple)
    synthetic_vwap: float | None = None


@dataclass(frozen=True, slots=True)
class Signal:
    timestamp: datetime
    event: EventKind
    direction: Direction
    confidence: float
    combined_direction_score: float
    cash: CashMetrics
    futures: FuturesMetrics
    level: LevelMetrics
    contract: ContractSelection
    risk: RiskDecision
    reasons: tuple[str, ...]
    option_market: OptionMarketMetrics = field(default_factory=OptionMarketMetrics)
    vwap: VwapMetrics = field(default_factory=VwapMetrics)
