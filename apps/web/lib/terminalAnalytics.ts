import type { PaperOrder, PaperTrade } from "@/lib/terminalTypes";

export type PaperAnalytics = {
  todayPnl: number | null;
  weekPnl: number | null;
  monthPnl: number | null;
  totalPnl: number | null;
  grossProfit: number | null;
  grossLoss: number | null;
  winRate: number | null;
  profitFactor: number | null;
  averageWinner: number | null;
  averageLoser: number | null;
  maxDrawdown: number | null;
  largestWinner: number | null;
  largestLoser: number | null;
  tradesToday: number;
  completedTrades: number;
  winningStreak: number;
  losingStreak: number;
};

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

function pnlSince(trades: PaperTrade[], start: Date): number | null {
  const values = trades.filter((trade) => new Date(trade.executed_at) >= start && trade.pnl !== null).map((trade) => trade.pnl as number);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function calculatePaperAnalytics(trades: PaperTrade[], orders: PaperOrder[]): PaperAnalytics {
  const completed = trades.filter((trade) => trade.pnl !== null);
  const pnl = completed.map((trade) => trade.pnl as number);
  const winners = pnl.filter((value) => value > 0);
  const losers = pnl.filter((value) => value < 0);
  const grossProfit = winners.length ? winners.reduce((sum, value) => sum + value, 0) : null;
  const grossLoss = losers.length ? losers.reduce((sum, value) => sum + value, 0) : null;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of [...completed].reverse()) {
    equity += trade.pnl as number;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }

  let winningStreak = 0;
  let losingStreak = 0;
  for (const value of pnl) {
    if (value > 0 && losingStreak === 0) winningStreak += 1;
    else if (value < 0 && winningStreak === 0) losingStreak += 1;
    else break;
  }

  const today = startOfLocalDay();
  return {
    todayPnl: pnlSince(completed, today),
    weekPnl: pnlSince(completed, startOfLocalWeek()),
    monthPnl: pnlSince(completed, startOfLocalMonth()),
    totalPnl: pnl.length ? pnl.reduce((sum, value) => sum + value, 0) : null,
    grossProfit,
    grossLoss,
    winRate: pnl.length ? winners.length / pnl.length : null,
    profitFactor: grossProfit !== null && grossLoss !== null && grossLoss !== 0 ? grossProfit / Math.abs(grossLoss) : null,
    averageWinner: winners.length ? (grossProfit as number) / winners.length : null,
    averageLoser: losers.length ? (grossLoss as number) / losers.length : null,
    maxDrawdown: completed.length ? maxDrawdown : null,
    largestWinner: winners.length ? Math.max(...winners) : null,
    largestLoser: losers.length ? Math.min(...losers) : null,
    tradesToday: orders.filter((order) => new Date(order.created_at) >= today).length,
    completedTrades: completed.length,
    winningStreak,
    losingStreak,
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
  return [...grouped.entries()].map(([symbol, value]) => ({ symbol, ...value })).sort((a, b) => b.pnl - a.pnl);
}
