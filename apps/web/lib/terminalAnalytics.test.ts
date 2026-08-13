import assert from "node:assert/strict";
import test from "node:test";
import { attributePaperTrades, calculatePerformance, filterTradesByMode, filterTradesByTimeframe } from "./terminalAnalytics.ts";
import type { PaperOrder, PaperTrade } from "./terminalTypes.ts";

function trade(id: string, orderId: string, pnl: number | null, executedAt: string, mode?: "paper" | "live"): PaperTrade {
  return { id, order_id: orderId, trading_symbol: "NIFTY", quantity: 1, fill_price: 100, pnl, executed_at: executedAt, entry_price: 90, exit_policy: "test", mode };
}

test("filters realized trades by selected timeframe", () => {
  const now = new Date("2026-08-13T12:00:00+05:30");
  const rows = [trade("1", "a", 20, "2026-08-13T10:00:00+05:30"), trade("2", "b", -5, "2026-07-01T10:00:00+05:30")];
  assert.equal(filterTradesByTimeframe(rows, "today", now).length, 1);
  assert.equal(filterTradesByTimeframe(rows, "all", now).length, 2);
});

test("attributes breakout and reversal P&L through persisted order ids", () => {
  const orders = [
    { id: "a", signal_event: "breakout" },
    { id: "b", signal_event: "reversal" },
  ] as PaperOrder[];
  const attributed = attributePaperTrades([trade("1", "a", 20, "2026-08-13T10:00:00+05:30"), trade("2", "b", -5, "2026-08-13T11:00:00+05:30")], orders);
  assert.deepEqual(attributed.map((row) => row.strategy), ["breakout", "reversal"]);
});

test("performance calculations remain empty instead of fabricating zeros", () => {
  const metrics = calculatePerformance([]);
  assert.equal(metrics.netPnl, null);
  assert.equal(metrics.winRate, null);
  assert.equal(metrics.completedTrades, 0);
});

test("keeps PAPER simulations and LIVE broker fills in separate datasets", () => {
  const mixed = [
    trade("paper", "a", 125, "2026-08-13T10:00:00+05:30", "paper"),
    trade("legacy-paper", "b", -25, "2026-08-13T10:30:00+05:30"),
    trade("live", "c", 410, "2026-08-13T11:00:00+05:30", "live"),
  ];
  assert.deepEqual(filterTradesByMode(mixed, "paper").map((row) => row.id), ["paper", "legacy-paper"]);
  assert.deepEqual(filterTradesByMode(mixed, "live").map((row) => row.id), ["live"]);
  assert.equal(calculatePerformance(filterTradesByMode(mixed, "paper")).netPnl, 100);
  assert.equal(calculatePerformance(filterTradesByMode(mixed, "live")).netPnl, 410);
});

test("calculates expectancy, reward risk, and drawdown", () => {
  const metrics = calculatePerformance([trade("1", "a", 100, "2026-08-13T10:00:00+05:30"), trade("2", "a", -50, "2026-08-13T11:00:00+05:30")]);
  assert.equal(metrics.netPnl, 50);
  assert.equal(metrics.expectancy, 25);
  assert.equal(metrics.rewardRisk, 2);
  assert.equal(metrics.maxDrawdown, -50);
});
