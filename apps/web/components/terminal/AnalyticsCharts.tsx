import { EmptyState } from "@/components/terminal/EmptyState";
import { formatCurrency } from "@/lib/format";
import { groupDailyPnl, type PerformanceMetrics } from "@/lib/terminalAnalytics";
import type { PaperTrade } from "@/lib/terminalTypes";

export function DailyPnlChart({ trades }: { trades: PaperTrade[] }) {
  const days = groupDailyPnl(trades).slice(-14);
  if (days.length === 0) return <EmptyState icon="analytics" title="No daily P&L bars" description="Bars appear after the first realized paper trade in this timeframe." compact />;
  const maximum = Math.max(...days.map((day) => Math.abs(day.pnl)), 1);
  return <div className="daily-pnl-chart" role="img" aria-label="Daily realized paper profit and loss">
    <div className="daily-pnl-zero" />
    {days.map((day) => <div className="daily-pnl-column" key={day.date} title={`${day.date}: ${formatCurrency(day.pnl)}`}>
      <span className={day.pnl >= 0 ? "positive" : "negative"} style={{ height: `${Math.max(Math.abs(day.pnl) / maximum * 42, 3)}%` }} />
      <small>{new Date(`${day.date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</small>
    </div>)}
  </div>;
}

export function StrategyPnlChart({ rows }: { rows: Array<{ strategy: "breakout" | "reversal"; metrics: PerformanceMetrics }> }) {
  const values = rows.map((row) => Math.abs(row.metrics.netPnl ?? 0));
  if (rows.every((row) => row.metrics.netPnl === null)) return <EmptyState icon="strategy" title="No attributed strategy P&L" description="The comparison uses order IDs and persisted breakout/reversal events; unattributed fills are not guessed." compact />;
  const maximum = Math.max(...values, 1);
  return <div className="strategy-pnl-bars">{rows.map((row) => {
    const pnl = row.metrics.netPnl;
    return <div key={row.strategy}><div><span>S/R {row.strategy}</span><strong className={(pnl ?? 0) >= 0 ? "good" : "bad"}>{formatCurrency(pnl)}</strong></div><span><i className={(pnl ?? 0) >= 0 ? "positive" : "negative"} style={{ width: `${Math.abs(pnl ?? 0) / maximum * 100}%` }} /></span></div>;
  })}</div>;
}

export function WinLossDistribution({ metrics }: { metrics: PerformanceMetrics }) {
  if (metrics.completedTrades === 0 || metrics.winRate === null) return <EmptyState icon="analytics" title="No win/loss distribution" description="A distribution is shown only after realized trades exist." compact />;
  const wins = Math.round(metrics.winRate * metrics.completedTrades);
  const losses = metrics.completedTrades - wins;
  return <div className="win-loss-distribution">
    <div className="win-loss-bar" aria-label={`${wins} wins and ${losses} losses`}><i style={{ width: `${metrics.winRate * 100}%` }} /><b style={{ width: `${(1 - metrics.winRate) * 100}%` }} /></div>
    <div><span><i className="good-dot" />Wins <strong>{wins}</strong></span><span><i className="bad-dot" />Losses / flat <strong>{losses}</strong></span></div>
  </div>;
}
