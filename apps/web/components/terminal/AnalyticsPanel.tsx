import { BackendUnavailable, EmptyState } from "@/components/terminal/EmptyState";
import { MetricCard } from "@/components/terminal/MetricCard";
import { PerformanceChart } from "@/components/terminal/PerformanceChart";
import { formatCurrency, formatPercent } from "@/lib/format";
import { calculatePaperAnalytics, groupPnlBySymbol } from "@/lib/terminalAnalytics";
import type { ControlStatus } from "@/lib/terminalTypes";

export function AnalyticsPanel({ status }: { status: ControlStatus }) {
  const analytics = calculatePaperAnalytics(status.paperTrades, status.paperOrders);
  const bySymbol = groupPnlBySymbol(status.paperTrades);
  return <>
    <section className="terminal-metric-grid six">
      <MetricCard label="Net / total P&L" value={formatCurrency(analytics.totalPnl)} detail={`${analytics.completedTrades} realized paper trades`} tone={(analytics.totalPnl ?? 0) >= 0 ? "positive" : "negative"} unavailable={analytics.totalPnl === null} />
      <MetricCard label="Gross profit" value={formatCurrency(analytics.grossProfit)} tone="positive" unavailable={analytics.grossProfit === null} />
      <MetricCard label="Gross loss" value={formatCurrency(analytics.grossLoss)} tone="negative" unavailable={analytics.grossLoss === null} />
      <MetricCard label="Win rate" value={formatPercent(analytics.winRate)} unavailable={analytics.winRate === null} />
      <MetricCard label="Profit factor" value={analytics.profitFactor?.toFixed(2)} unavailable={analytics.profitFactor === null} />
      <MetricCard label="Maximum drawdown" value={formatCurrency(analytics.maxDrawdown)} tone="negative" unavailable={analytics.maxDrawdown === null} />
      <MetricCard label="Average winner" value={formatCurrency(analytics.averageWinner)} tone="positive" unavailable={analytics.averageWinner === null} />
      <MetricCard label="Average loser" value={formatCurrency(analytics.averageLoser)} tone="negative" unavailable={analytics.averageLoser === null} />
      <MetricCard label="Winning streak" value={String(analytics.winningStreak)} detail="Current newest-first streak" />
      <MetricCard label="Losing streak" value={String(analytics.losingStreak)} detail="Current newest-first streak" />
      <MetricCard label="Fees & taxes" unavailable detail="Not captured by the paper trade schema" />
      <MetricCard label="Sharpe ratio" unavailable detail="No return interval/equity series contract" />
    </section>
    <section className="dashboard-grid terminal-section"><article className="card span-8"><PerformanceChart trades={status.paperTrades} /></article><article className="card span-4"><div className="section-heading compact"><div><p className="eyebrow">Performance window</p><h2>Realized P&amp;L</h2></div></div><div className="diagnostic-list"><div><span>Today</span><strong>{formatCurrency(analytics.todayPnl)}</strong></div><div><span>This week</span><strong>{formatCurrency(analytics.weekPnl)}</strong></div><div><span>This month</span><strong>{formatCurrency(analytics.monthPnl)}</strong></div><div><span>Largest winner</span><strong className="good">{formatCurrency(analytics.largestWinner)}</strong></div><div><span>Largest loser</span><strong className="bad">{formatCurrency(analytics.largestLoser)}</strong></div></div></article></section>
    <section className="terminal-section card"><div className="section-heading compact"><div><p className="eyebrow">Breakdown</p><h2>Performance by instrument</h2></div><span>Persisted paper trades</span></div>{bySymbol.length === 0 ? <EmptyState icon="analytics" title="No strategy breakdown yet" description="The comparison table will populate from real closed paper trades." /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Instrument</th><th>Trades</th><th>Win rate</th><th>Net P&amp;L</th><th>Drawdown</th></tr></thead><tbody>{bySymbol.map((row) => <tr key={row.symbol}><td><strong>{row.symbol}</strong></td><td className="numeric">{row.trades}</td><td className="numeric">{formatPercent(row.wins / row.trades)}</td><td className={`numeric ${row.pnl >= 0 ? "good" : "bad"}`}>{formatCurrency(row.pnl)}</td><td className="unavailable-cell">Unavailable</td></tr>)}</tbody></table></div>}</section>
    <section className="terminal-section card"><BackendUnavailable title="Advanced analytics need richer persisted execution data" description="Fees, slippage, holding duration, strategy version, time-of-day buckets, CE/PE breakdown, expectancy, risk/reward, and Sharpe require fields or an analytics service that the current schema does not provide." /></section>
  </>;
}
