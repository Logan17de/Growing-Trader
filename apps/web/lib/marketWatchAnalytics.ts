import type { MarketWatchObservation } from "@/lib/researchTypes";

export type MarketWatchWindow = "today" | "week" | "month" | "all";
export type OutcomeSide = "bullish" | "bearish";

export const DISCOVERY_FEATURES = [
  ["cash_pressure", "Cash pressure"],
  ["breadth", "Breadth"],
  ["participation", "Participation"],
  ["heavyweight_score", "Heavyweights"],
  ["futures_move_bps", "Futures move"],
  ["futures_oi_change_pct", "Futures OI change"],
  ["futures_score", "Futures score"],
  ["option_volume_imbalance", "Option volume imbalance"],
  ["option_oi_change_imbalance", "Option OI imbalance"],
  ["option_iv_skew", "IV skew"],
  ["option_score", "Options score"],
  ["vwap_distance_bps", "VWAP distance"],
  ["combined_direction_score", "Combined score"],
] as const;

export type DiscoveryFeatureKey = typeof DISCOVERY_FEATURES[number][0];

function startOfWindow(window: MarketWatchWindow, now = new Date()) {
  if (window === "all") return null;
  const start = new Date(now);
  if (window === "today") {
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  if (window === "week") {
    start.setDate(start.getDate() - 7);
    return start.getTime();
  }
  start.setDate(start.getDate() - 30);
  return start.getTime();
}

export function filterMarketWatchWindow(rows: MarketWatchObservation[], window: MarketWatchWindow, now = new Date()) {
  const since = startOfWindow(window, now);
  return since === null ? rows : rows.filter((row) => Date.parse(row.observed_at) >= since);
}

export function rowOutcomeBps(row: MarketWatchObservation, horizon: 1 | 5 | 15 = 15) {
  return horizon === 1 ? row.nifty_move_1m_bps : horizon === 5 ? row.nifty_move_5m_bps : row.nifty_move_15m_bps;
}

export function bigMoveSide(row: MarketWatchObservation, horizon: 1 | 5 | 15 = 15): OutcomeSide | null {
  const outcome = rowOutcomeBps(row, horizon);
  if (typeof outcome !== "number" || !Number.isFinite(outcome) || outcome === 0) return null;
  return outcome > 0 ? "bullish" : "bearish";
}

function average(rows: MarketWatchObservation[], key: DiscoveryFeatureKey) {
  const values = rows.map((row) => row[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function buildMoveSignature(rows: MarketWatchObservation[], side: OutcomeSide, horizon: 1 | 5 | 15 = 15) {
  const selected = rows.filter((row) => bigMoveSide(row, horizon) === side);
  return {
    side,
    count: selected.length,
    features: Object.fromEntries(DISCOVERY_FEATURES.map(([key]) => [key, average(selected, key)])) as Record<DiscoveryFeatureKey, number | null>,
  };
}

export type FeatureSeparation = {
  key: DiscoveryFeatureKey;
  label: string;
  bullish: number | null;
  bearish: number | null;
  separation: number | null;
};

export function rankFeatureSeparations(rows: MarketWatchObservation[], horizon: 1 | 5 | 15 = 15): FeatureSeparation[] {
  const bullish = buildMoveSignature(rows, "bullish", horizon);
  const bearish = buildMoveSignature(rows, "bearish", horizon);
  return DISCOVERY_FEATURES.map(([key, label]) => {
    const up = bullish.features[key];
    const down = bearish.features[key];
    const separation = up == null || down == null ? null : up - down;
    return { key, label, bullish: up, bearish: down, separation };
  }).sort((a, b) => Math.abs(b.separation ?? -Infinity) - Math.abs(a.separation ?? -Infinity));
}

export function summarizeMarketWatch(rows: MarketWatchObservation[]) {
  const sessions = new Set(rows.map((row) => row.session_date));
  const labeled1m = rows.filter((row) => row.nifty_move_1m_bps != null).length;
  const labeled5m = rows.filter((row) => row.nifty_move_5m_bps != null).length;
  const labeled15m = rows.filter((row) => row.nifty_move_15m_bps != null).length;
  const bigMoves = rows.filter((row) => row.big_move_1m || row.big_move_5m || row.big_move_15m).length;
  return { observations: rows.length, sessions: sessions.size, labeled1m, labeled5m, labeled15m, bigMoves };
}
