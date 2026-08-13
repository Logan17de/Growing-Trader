import { EmptyState } from "@/components/terminal/EmptyState";
import { MetricCard } from "@/components/terminal/MetricCard";
import { PerformanceChart } from "@/components/terminal/PerformanceChart";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { calculatePaperAnalytics, groupPnlByHour, groupPnlByOptionType, groupPnlBySymbol } from "@/lib/terminalAnalytics";
import type { ControlStatus } from "@/lib/terminalTypes";

function hold(value: number | null) {
  if (value === null) return undefined;
  if (value < 60) return `${value.toFixed(0)}s`;
  return `${(value / 60).toFixed(1)}m`;
}

export function AnalyticsPanel({ status }: { status: ControlStatus }) {
  const analytics = calculatePaperAnalytics(status.paperTrades, status.paperOrders);
  const bySymbol = groupPnlBySymbol(status.paperTrades);
  const byType = groupPnlByOptionType(status.paperTrades);
  const byHour = groupPnlByHour(status.paperTrades);
  return <>
    <section className="terminal-metric-grid six">
      <MetricCard label="Net / total P&L" value={formatCurrency(analytics.totalPnl)} detail={`${analytics.completedTrades} realized paper fills`} tone={(analytics.totalPnl ?? 0) >= 0 ? "positive" : "negative"} unavailable={analytics.totalPnl === null} />
      <MetricCard label="Gross profit" value={formatCurrency(analytics.grossProfit)} tone="positive" unavailable={analytics.grossProfit === null} />
      <MetricCard label="Gross loss" value={formatCurrency(analytics.grossLoss)} tone="negative" unavailable={analytics.grossLoss === null} />
      <MetricCard label="Win rate" value={formatPercent(analytics.winRate)} unavailable={analytics.winRate === null} />
      <MetricCard label="Profit factor" value={analytics.profitFactor?.toFixed(2)} unavailable={analytics.profitFactor === null} />
      <MetricCard label="Maximum drawdown" value={formatCurrency(analytics.maxDrawdown)} tone="negative" unavailable={analytics.maxDrawdown === null} />
      <MetricCard label="Average winner" value={formatCurrency(analytics.averageWinner)} tone="positive" unavailable={analytics.averageWinner === null} />
      <MetricCard label="Average loser" value={formatCurrency(analytics.averageLoser)} tone="negative" unavailable={analytics.averageLoser === null} />
      <MetricCard label="Expectancy / fill" value={formatCurrency(analytics.expectancy)} tone={(analytics.expectancy ?? 0) >= 0 ? "positive" : "negative"} unavailable={analytics.expectancy === null} />
      <MetricCard label="Reward / risk" value={analytics.riskReward?.toFixed(2)} unavailable={analytics.riskReward === null} />
      <MetricCard label="Paper fees & taxes" value={formatCurrency(analytics.totalFees)} detail={`Model rate ${formatPercent(status.paperEngine.paper_fee_rate_pct ?? status.engineSettings?.paper_fee_rate_pct ?? 0)}`} unavailable={analytics.totalFees === null} />
      <MetricCard label="Trade-level Sharpe" value={analytics.tradeSharpe?.toFixed(2)} detail="Based on realized paper return per fill; not annualized market Sharpe" unavailable={analytics.tradeSharpe === null} />
      <MetricCard label="Average holding" value={hold(analytics.averageHoldSeconds)} unavailable={analytics.averageHoldSeconds === null} />
      <MetricCard label="Winning streak" value={String(analytics.winningStreak)} detail="Current newest-first streak" />
      <MetricCard label="Losing streak" value={String(analytics.losingStreak)} detail="Current newest-first streak" />
      <MetricCard label="Paper slippage" value={`${formatNumber(status.paperEngine.paper_slippage_bps ?? status.engineSettings?.paper_slippage_bps ?? 0, 2)} bps`} detail="Configured simulation assumption" />
    </section>
    <section className="dashboard-grid terminal-section"><article className="card span-8"><PerformanceChart trades={status.paperTrades} /></article><article className="card span-4"><div className="section-heading compact"><div><p className="eyebrow">Performance window</p><h2>Realized P&amp;L</h2></div></div><div className="diagnostic-list"><div><span>Today</span><strong>{formatCurrency(analytics.todayPnl)}</strong></div><div><span>This week</span><strong>{formatCurrency(analytics.weekPnl)}</strong></div><div><span>This month</span><strong>{formatCurrency(analytics.monthPnl)}</strong></div><div><span>Largest winner</span><strong className="good">{formatCurrency(analytics.largestWinner)}</strong></div><div><span>Largest loser</span><strong className="bad">{formatCurrency(analytics.largestLoser)}</strong></div></div></article></section>
    <section className="terminal-section card"><div className="section-heading compact"><div><p className="eyebrow">Breakdown</p><h2>Performance by instrument</h2></div><span>Persisted paper fills</span></div>{bySymbol.length === 0 ? <EmptyState icon="analytics" title="No strategy breakdown yet" description="The comparison table populates from realized paper trades." /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Instrument</th><th>Trades</th><th>Win rate</th><th>Net P&amp;L</th><th>Drawdown</th></tr></thead><tbody>{bySymbol.map((row) => <tr key={row.symbol}><td><strong>{row.symbol}</strong></td><td className="numeric">{row.trades}</td><td className="numeric">{formatPercent(row.wins / row.trades)}</td><td className={`numeric ${row.pnl >= 0 ? "good" : "bad"}`}>{formatCurrency(row.pnl)}</td><td className="numeric bad">{formatCurrency(row.maxDrawdown)}</td></tr>)}</tbody></table></div>}</section>
    <section className="dashboard-grid terminal-section"><article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Contract side</p><h2>CE / PE performance</h2></div></div>{byType.length === 0 ? <EmptyState icon="analytics" title="No option-side data" description="New managed paper fills persist the selected option type." /> : <div className="diagnostic-list">{byType.map((row) => <div key={row.optionType}><span>{row.optionType} · {row.trades} fills · {formatPercent(row.wins / row.trades)}</span><strong className={row.pnl >= 0 ? "good" : "bad"}>{formatCurrency(row.pnl)}</strong></div>)}</div>}</article><article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Time of day</p><h2>Realized exits by hour</h2></div></div>{byHour.length === 0 ? <EmptyState icon="analytics" title="No time bucket data" description="Exit timestamps will populate this breakdown as paper trades close." /> : <div className="diagnostic-list">{byHour.map((row) => <div key={row.hour}><span>{String(row.hour).padStart(2, "0")}:00 · {row.trades} fills · {formatPercent(row.wins / row.trades)}</span><strong className={row.pnl >= 0 ? "good" : "bad"}>{formatCurrency(row.pnl)}</strong></div>)}</div>}</article></section>
    <p className="availability-note">Fees, slippage, holding duration, strategy version and option side are simulation metadata persisted by the managed paper runtime. They are not broker execution statements.</p>
  </>;
}
