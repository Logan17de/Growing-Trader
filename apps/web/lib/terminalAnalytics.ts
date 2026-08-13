import type { PaperOrder, PaperTrade } from "@/lib/terminalTypes";

export type AnalyticsTimeframe = "today" | "week" | "month" | "all";
export type StrategyAttribution = "breakout" | "reversal" | "unattributed";

export type PerformanceMetrics = {
  netPnl: number | null;
  grossProfit: number | null;
  grossLoss: number | null;
  winRate: number | null;
  profitFactor: number | null;
  maxDrawdown: number | null;
  averagePnl: number | null;
  expectancy: number | null;
  averageWinner: number | null;
  averageLoser: number | null;
  rewardRisk: number | null;
  largestWinner: number | null;
  largestLoser: number | null;
  completedTrades: number;
  winningStreak: number;
  losingStreak: number;
};

export type PaperAnalytics = PerformanceMetrics & {
  todayPnl: number | null;
  weekPnl: number | null;
  monthPnl: number | null;
  totalPnl: number | null;
  tradesToday: number;
};

export type AttributedPaperTrade = PaperTrade & { strategy: StrategyAttribution };

function startOfLocalDay(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfLocalWeek(date = new Date()): Date {
  const start = startOfLocalDay(date);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  return start;
}

function startOfLocalMonth(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function timeframeStart(timeframe: AnalyticsTimeframe, now: Date) {
  if (timeframe === "today") return startOfLocalDay(now);
  if (timeframe === "week") return startOfLocalWeek(now);
  if (timeframe === "month") return startOfLocalMonth(now);
  return null;
}

export function filterTradesByTimeframe<T extends PaperTrade>(trades: T[], timeframe: AnalyticsTimeframe, now = new Date()): T[] {
  const start = timeframeStart(timeframe, now);
  return trades.filter((trade) => trade.pnl !== null && (!start || new Date(trade.executed_at) >= start));
}

export function filterTradesByMode<T extends PaperTrade>(trades: T[], mode: "paper" | "live"): T[] {
  return trades.filter((trade) => (trade.mode ?? "paper") === mode);
}

function pnlSince(trades: PaperTrade[], start: Date): number | null {
  const values = trades.filter((trade) => new Date(trade.executed_at) >= start && trade.pnl !== null).map((trade) => trade.pnl as number);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function calculatePerformance(trades: PaperTrade[]): PerformanceMetrics {
  const completed = trades.filter((trade) => trade.pnl !== null);
  const pnl = completed.map((trade) => trade.pnl as number);
  const winners = pnl.filter((amount) => amount > 0);
  const losers = pnl.filter((amount) => amount < 0);
  const grossProfit = winners.length ? winners.reduce((sum, amount) => sum + amount, 0) : null;
  const grossLoss = losers.length ? losers.reduce((sum, amount) => sum + amount, 0) : null;
  const netPnl = pnl.length ? pnl.reduce((sum, amount) => sum + amount, 0) : null;
  const averageWinner = winners.length ? (grossProfit as number) / winners.length : null;
  const averageLoser = losers.length ? (grossLoss as number) / losers.length : null;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of [...completed].sort((a, b) => Date.parse(a.executed_at) - Date.parse(b.executed_at))) {
    equity += trade.pnl as number;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }

  let winningStreak = 0;
  let losingStreak = 0;
  for (const trade of [...completed].sort((a, b) => Date.parse(b.executed_at) - Date.parse(a.executed_at))) {
    const amount = trade.pnl as number;
    if (amount > 0 && losingStreak === 0) winningStreak += 1;
    else if (amount < 0 && winningStreak === 0) losingStreak += 1;
    else break;
  }

  const winRate = pnl.length ? winners.length / pnl.length : null;
  const lossRate = pnl.length ? losers.length / pnl.length : null;
  const expectancy = winRate !== null && lossRate !== null && averageWinner !== null && averageLoser !== null
    ? winRate * averageWinner + lossRate * averageLoser
    : pnl.length ? (netPnl as number) / pnl.length : null;

  return {
    netPnl,
    grossProfit,
    grossLoss,
    winRate,
    profitFactor: grossProfit !== null && grossLoss !== null && grossLoss !== 0 ? grossProfit / Math.abs(grossLoss) : null,
    maxDrawdown: completed.length ? maxDrawdown : null,
    averagePnl: pnl.length ? (netPnl as number) / pnl.length : null,
    expectancy,
    averageWinner,
    averageLoser,
    rewardRisk: averageWinner !== null && averageLoser !== null && averageLoser !== 0 ? averageWinner / Math.abs(averageLoser) : null,
    largestWinner: winners.length ? Math.max(...winners) : null,
    largestLoser: losers.length ? Math.min(...losers) : null,
    completedTrades: completed.length,
    winningStreak,
    losingStreak,
  };
}

export function calculatePerformanceForTimeframe(trades: PaperTrade[], timeframe: AnalyticsTimeframe, now = new Date()) {
  return calculatePerformance(filterTradesByTimeframe(trades, timeframe, now));
}

export function attributePaperTrades(trades: PaperTrade[], orders: PaperOrder[]): AttributedPaperTrade[] {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  return trades.map((trade) => {
    const event = trade.order_id ? orderById.get(trade.order_id)?.signal_event : null;
    const strategy: StrategyAttribution = event === "breakout" || event === "reversal" ? event : "unattributed";
    return { ...trade, strategy };
  });
}

export function groupStrategyPerformance(trades: AttributedPaperTrade[], timeframe: AnalyticsTimeframe, now = new Date()) {
  return (["breakout", "reversal"] as const).map((strategy) => ({
    strategy,
    metrics: calculatePerformance(filterTradesByTimeframe(trades.filter((trade) => trade.strategy === strategy), timeframe, now)),
  }));
}

export function groupDailyPnl(trades: PaperTrade[]) {
  const grouped = new Map<string, number>();
  for (const trade of trades) {
    if (trade.pnl === null) continue;
    const date = new Date(trade.executed_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toLocaleDateString("en-CA");
    grouped.set(key, (grouped.get(key) ?? 0) + trade.pnl);
  }
  return [...grouped.entries()].map(([date, pnl]) => ({ date, pnl })).sort((a, b) => a.date.localeCompare(b.date));
}

export function calculatePaperAnalytics(trades: PaperTrade[], orders: PaperOrder[]): PaperAnalytics {
  const now = new Date();
  const all = calculatePerformance(trades);
  return {
    ...all,
    todayPnl: pnlSince(trades, startOfLocalDay(now)),
    weekPnl: pnlSince(trades, startOfLocalWeek(now)),
    monthPnl: pnlSince(trades, startOfLocalMonth(now)),
    totalPnl: all.netPnl,
    tradesToday: orders.filter((order) => new Date(order.created_at) >= startOfLocalDay(now)).length,
  };
}

export function groupPnlBySymbol(trades: PaperTrade[]) {
  const grouped = new Map<string, { trades: number; pnl: number; wins: number }>();
  for (const trade of trades) {
    if (trade.pnl === null) continue;
    const current = grouped.get(trade.trading_symbol) ?? { trades: 0, pnl: 0, wins: 0 };
    current.trades += 1;
    current.pnl += trade.pnl;
    current.wins += trade.pnl > 0 ? 1 : 0;
    grouped.set(trade.trading_symbol, current);
  }
  return [...grouped.entries()].map(([symbol, result]) => ({ symbol, ...result })).sort((a, b) => b.pnl - a.pnl);
}
