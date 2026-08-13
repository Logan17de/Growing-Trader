import type { PaperOrder, PaperTrade } from "@/lib/terminalTypes";

export type PaperAnalytics = {
  todayPnl: number | null;
  weekPnl: number | null;
  monthPnl: number | null;
  totalPnl: number | null;
  grossProfit: number | null;
  grossLoss: number | null;
  totalFees: number | null;
  winRate: number | null;
  profitFactor: number | null;
  averageWinner: number | null;
  averageLoser: number | null;
  averageHoldSeconds: number | null;
  expectancy: number | null;
  riskReward: number | null;
  tradeSharpe: number | null;
  maxDrawdown: number | null;
  largestWinner: number | null;
  largestLoser: number | null;
  tradesToday: number;
  completedTrades: number;
  winningStreak: number;
  losingStreak: number;
};

function startOfLocalDay(date = new Date()): Date { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function startOfLocalWeek(date = new Date()): Date { const start = startOfLocalDay(date); const day = start.getDay() || 7; start.setDate(start.getDate() - day + 1); return start; }
function startOfLocalMonth(date = new Date()): Date { return new Date(date.getFullYear(), date.getMonth(), 1); }
function pnlSince(trades: PaperTrade[], start: Date): number | null { const values = trades.filter((trade) => new Date(trade.executed_at) >= start && trade.pnl !== null).map((trade) => trade.pnl as number); return values.length ? values.reduce((sum, value) => sum + value, 0) : null; }

function drawdown(values: number[]) {
  let equity = 0; let peak = 0; let maximum = 0;
  for (const value of values) { equity += value; peak = Math.max(peak, equity); maximum = Math.min(maximum, equity - peak); }
  return maximum;
}

function sampleSharpe(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const deviation = Math.sqrt(variance);
  return deviation > 0 ? (mean / deviation) * Math.sqrt(values.length) : null;
}

export function calculatePaperAnalytics(trades: PaperTrade[], orders: PaperOrder[]): PaperAnalytics {
  const completed = trades.filter((trade) => trade.pnl !== null);
  const chronological = [...completed].sort((a, b) => Date.parse(a.executed_at) - Date.parse(b.executed_at));
  const pnl = completed.map((trade) => trade.pnl as number);
  const chronologicalPnl = chronological.map((trade) => trade.pnl as number);
  const winners = pnl.filter((value) => value > 0);
  const losers = pnl.filter((value) => value < 0);
  const grossProfit = winners.length ? winners.reduce((sum, value) => sum + value, 0) : null;
  const grossLoss = losers.length ? losers.reduce((sum, value) => sum + value, 0) : null;
  const fees = completed.map((trade) => trade.fees).filter((value): value is number => typeof value === "number");
  const holds = completed.map((trade) => trade.hold_seconds).filter((value): value is number => typeof value === "number");
  const returns = completed.flatMap((trade) => {
    const capital = (trade.entry_price ?? 0) * trade.quantity;
    return capital > 0 && trade.pnl !== null ? [trade.pnl / capital] : [];
  });

  let winningStreak = 0; let losingStreak = 0;
  for (const value of pnl) { if (value > 0 && losingStreak === 0) winningStreak += 1; else if (value < 0 && winningStreak === 0) losingStreak += 1; else break; }
  const today = startOfLocalDay();
  const winRate = pnl.length ? winners.length / pnl.length : null;
  const averageWinner = winners.length ? (grossProfit as number) / winners.length : null;
  const averageLoser = losers.length ? (grossLoss as number) / losers.length : null;
  return {
    todayPnl: pnlSince(completed, today),
    weekPnl: pnlSince(completed, startOfLocalWeek()),
    monthPnl: pnlSince(completed, startOfLocalMonth()),
    totalPnl: pnl.length ? pnl.reduce((sum, value) => sum + value, 0) : null,
    grossProfit,
    grossLoss,
    totalFees: fees.length ? fees.reduce((sum, value) => sum + value, 0) : null,
    winRate,
    profitFactor: grossProfit !== null && grossLoss !== null && grossLoss !== 0 ? grossProfit / Math.abs(grossLoss) : null,
    averageWinner,
    averageLoser,
    averageHoldSeconds: holds.length ? holds.reduce((sum, value) => sum + value, 0) / holds.length : null,
    expectancy: pnl.length ? pnl.reduce((sum, value) => sum + value, 0) / pnl.length : null,
    riskReward: averageWinner !== null && averageLoser !== null && averageLoser !== 0 ? averageWinner / Math.abs(averageLoser) : null,
    tradeSharpe: sampleSharpe(returns),
    maxDrawdown: completed.length ? drawdown(chronologicalPnl) : null,
    largestWinner: winners.length ? Math.max(...winners) : null,
    largestLoser: losers.length ? Math.min(...losers) : null,
    tradesToday: orders.filter((order) => new Date(order.created_at) >= today).length,
    completedTrades: completed.length,
    winningStreak,
    losingStreak,
  };
}

export function groupPnlBySymbol(trades: PaperTrade[]) {
  const grouped = new Map<string, { values: number[]; wins: number }>();
  for (const trade of [...trades].sort((a, b) => Date.parse(a.executed_at) - Date.parse(b.executed_at))) {
    if (trade.pnl === null) continue;
    const current = grouped.get(trade.trading_symbol) ?? { values: [], wins: 0 };
    current.values.push(trade.pnl); current.wins += trade.pnl > 0 ? 1 : 0; grouped.set(trade.trading_symbol, current);
  }
  return [...grouped.entries()].map(([symbol, value]) => ({ symbol, trades: value.values.length, pnl: value.values.reduce((sum, item) => sum + item, 0), wins: value.wins, maxDrawdown: drawdown(value.values) })).sort((a, b) => b.pnl - a.pnl);
}

export function groupPnlByOptionType(trades: PaperTrade[]) {
  const grouped = new Map<string, { trades: number; pnl: number; wins: number }>();
  for (const trade of trades) {
    if (trade.pnl === null) continue;
    const key = trade.option_type ?? (trade.trading_symbol.endsWith("CE") ? "CE" : trade.trading_symbol.endsWith("PE") ? "PE" : "Other");
    const current = grouped.get(key) ?? { trades: 0, pnl: 0, wins: 0 };
    current.trades += 1; current.pnl += trade.pnl; current.wins += trade.pnl > 0 ? 1 : 0; grouped.set(key, current);
  }
  return [...grouped.entries()].map(([optionType, value]) => ({ optionType, ...value }));
}

export function groupPnlByHour(trades: PaperTrade[]) {
  const grouped = new Map<number, { trades: number; pnl: number; wins: number }>();
  for (const trade of trades) {
    if (trade.pnl === null) continue;
    const hour = new Date(trade.executed_at).getHours();
    const current = grouped.get(hour) ?? { trades: 0, pnl: 0, wins: 0 };
    current.trades += 1; current.pnl += trade.pnl; current.wins += trade.pnl > 0 ? 1 : 0; grouped.set(hour, current);
  }
  return [...grouped.entries()].map(([hour, value]) => ({ hour, ...value })).sort((a, b) => a.hour - b.hour);
}
