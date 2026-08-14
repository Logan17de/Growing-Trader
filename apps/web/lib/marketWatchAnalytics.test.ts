import assert from "node:assert/strict";
import test from "node:test";
import { buildMoveSignature, rankFeatureSeparations, summarizeMarketWatch } from "./marketWatchAnalytics.ts";
import type { MarketWatchObservation } from "./researchTypes.ts";

function row(overrides: Partial<MarketWatchObservation>): MarketWatchObservation {
  return {
    observed_at: "2026-08-14T04:00:00Z", session_date: "2026-08-14", nifty_ltp: 24_000,
    constituent_volume_delta: 100, constituent_turnover: 1_000, cash_pressure: 0, breadth: 0,
    participation: 0.8, heavyweight_score: 0, futures_move_bps: 0, futures_volume_delta: 10,
    futures_oi_change_pct: 0, futures_basis_points: 50, futures_score: 0, option_score: 0,
    option_volume_imbalance: 0, option_oi_change_imbalance: 0, option_iv_skew: 0, vwap_distance_bps: 0,
    combined_direction_score: 0, event: "no_level", direction: "flat", confidence: 0,
    nifty_move_1m_bps: null, nifty_move_3m_bps: null, nifty_move_5m_bps: null, nifty_move_10m_bps: null,
    nifty_move_15m_bps: null, max_up_15m_bps: null, max_down_15m_bps: null,
    big_move_1m: false, big_move_5m: false, big_move_15m: false,
    ...overrides,
  };
}

test("summarizes label coverage without inventing outcomes", () => {
  const rows = [row({ nifty_move_1m_bps: 10 }), row({ nifty_move_1m_bps: -5, nifty_move_5m_bps: -20, nifty_move_15m_bps: -40, big_move_15m: true })];
  assert.deepEqual(summarizeMarketWatch(rows), { observations: 2, sessions: 1, labeled1m: 2, labeled5m: 1, labeled15m: 1, bigMoves: 1 });
});

test("builds separate bullish and bearish descriptive signatures", () => {
  const rows = [
    row({ nifty_move_15m_bps: 50, cash_pressure: 0.7, futures_score: 0.6 }),
    row({ nifty_move_15m_bps: 40, cash_pressure: 0.5, futures_score: 0.4 }),
    row({ nifty_move_15m_bps: -60, cash_pressure: -0.8, futures_score: -0.5 }),
  ];
  const bullish = buildMoveSignature(rows, "bullish", 15);
  const bearish = buildMoveSignature(rows, "bearish", 15);
  assert.equal(bullish.count, 2);
  assert.equal(bullish.features.cash_pressure, 0.6);
  assert.equal(bearish.count, 1);
  assert.equal(bearish.features.cash_pressure, -0.8);
});

test("ranks features by absolute bullish-bearish separation", () => {
  const rows = [
    row({ nifty_move_15m_bps: 50, cash_pressure: 0.9, breadth: 0.1 }),
    row({ nifty_move_15m_bps: -50, cash_pressure: -0.9, breadth: 0 }),
  ];
  const ranked = rankFeatureSeparations(rows, 15);
  assert.equal(ranked[0].key, "cash_pressure");
  assert.equal(ranked[0].separation, 1.8);
});
