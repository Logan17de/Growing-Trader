"use client";

import { useMemo, useState } from "react";
import { DailyPnlChart, StrategyPnlChart, WinLossDistribution } from "@/components/terminal/AnalyticsCharts";
import { MetricCard } from "@/components/terminal/MetricCard";
import { PerformanceChart } from "@/components/terminal/PerformanceChart";
import { formatCurrency, formatPercent } from "@/lib/format";
import {
  attributePaperTrades,
  calculatePerformanceForTimeframe,
  filterTradesByMode,
  filterTradesByTimeframe,
  groupStrategyPerformance,
  type AnalyticsTimeframe,
  type AttributedPaperTrade,
  type PerformanceMetrics,
} from "@/lib/terminalAnalytics";
import type { ControlStatus, PaperOrder, PaperTrade } from "@/lib/terminalTypes";

type AnalyticsMode = "paper" | "live" | "combined";
type ExecutionMode = Exclude<AnalyticsMode, "combined">;

function ratio(value: number | null) {
  return value === null ? undefined : `${value.toFixed(2)}x`;
}

function ordersForMode(orders: PaperOrder[], mode: ExecutionMode) {
  return orders.filter((order) => order.mode === mode);
}

function StrategyPerformanceCard({
  strategy,
  mode,
  attributed,
}: {
  strategy: "breakout" | "reversal";
  mode: ExecutionMode;
  attributed: AttributedPaperTrade[];
}) {
  const rows = attributed.filter((trade) => trade.strategy === strategy);
  const today = calculatePerformanceForTimeframe(rows, "today");
  const week = calculatePerformanceForTimeframe(rows, "week");
  const month = calculatePerformanceForTimeframe(rows, "month");
  const all = calculatePerformanceForTimeframe(rows, "all");
  return <article className="strategy-performance-card">
    <div><p className="eyebrow">{mode.toUpperCase()} strategy</p><h3>S/R {strategy}</h3></div>
    <dl className="strategy-periods"><div><dt>Today</dt><dd>{formatCurrency(today.netPnl)}</dd></div><div><dt>Week</dt><dd>{formatCurrency(week.netPnl)}</dd></div><div><dt>Month</dt><dd>{formatCurrency(month.netPnl)}</dd></div><div><dt>All-time</dt><dd>{formatCurrency(all.netPnl)}</dd></div></dl>
    <div className="strategy-performance-stats"><span>Trades <strong>{all.completedTrades}</strong></span><span>Win rate <strong>{formatPercent(all.winRate)}</strong></span><span>Avg win <strong>{formatCurrency(all.averageWinner)}</strong></span><span>Avg loss <strong>{formatCurrency(all.averageLoser)}</strong></span><span>Profit factor <strong>{all.profitFactor?.toFixed(2) ?? "Unavailable"}</strong></span></div>
  </article>;
}

function MyTradingPerformanceCard({ trades }: { trades: PaperTrade[] }) {
  const today = calculatePerformanceForTimeframe(trades, "today");
  const week = calculatePerformanceForTimeframe(trades, "week");
  const month = calculatePerformanceForTimeframe(trades, "month");
  const all = calculatePerformanceForTimeframe(trades, "all");
  return <article className="strategy-performance-card">
    <div><p className="eyebrow">Discretionary · LIVE</p><h3>My Trades</h3></div>
    <dl className="strategy-periods"><div><dt>Today</dt><dd>{formatCurrency(today.netPnl)}</dd></div><div><dt>Week</dt><dd>{formatCurrency(week.netPnl)}</dd></div><div><dt>Month</dt><dd>{formatCurrency(month.netPnl)}</dd></div><div><dt>All-time</dt><dd>{formatCurrency(all.netPnl)}</dd></div></dl>
    <div className="strategy-performance-stats"><span>Trades <strong>{all.completedTrades}</strong></span><span>Win rate <strong>{formatPercent(all.winRate)}</strong></span><span>Avg win <strong>{formatCurrency(all.averageWinner)}</strong></span><span>Avg loss <strong>{formatCurrency(all.averageLoser)}</strong></span><span>Profit factor <strong>{all.profitFactor?.toFixed(2) ?? "Unavailable"}</strong></span></div>
  </article>;
}

function StrategyTable({
  paperRows,
  liveRows,
  showModes,
  timeframeLabel,
}: {
  paperRows: ReturnType<typeof groupStrategyPerformance>;
  liveRows: ReturnType<typeof groupStrategyPerformance>;
  showModes: ExecutionMode[];
  timeframeLabel: string;
}) {
  const rows = showModes.flatMap((mode) => (mode === "paper" ? paperRows : liveRows).map((row) => ({ ...row, mode })));
  return <section className="card terminal-section"><div className="section-heading compact"><div><p className="eyebrow">Persisted attribution</p><h2>Algo performance by setup and mode</h2></div><span>{timeframeLabel}</span></div>
    <div className="table-scroll"><table className="data-table strategy-performance-table"><thead><tr><th>Strategy</th><th>Mode</th><th>Trades</th><th>Win rate</th><th>Net P&amp;L</th><th>Avg P&amp;L</th><th>Profit factor</th><th>Drawdown</th></tr></thead><tbody>
      {rows.map((row) => <tr key={`${row.strategy}-${row.mode}`}><td><strong>S/R {row.strategy}</strong></td><td><span className={`side-badge ${row.mode}`}>{row.mode.toUpperCase()}</span></td><td className="numeric">{row.metrics.completedTrades}</td><td className="numeric">{formatPercent(row.metrics.winRate)}</td><td className={`numeric ${(row.metrics.netPnl ?? 0) >= 0 ? "good" : "bad"}`}>{formatCurrency(row.metrics.netPnl)}</td><td className="numeric">{formatCurrency(row.metrics.averagePnl)}</td><td className="numeric">{row.metrics.profitFactor?.toFixed(2) ?? "Unavailable"}</td><td className="numeric bad">{formatCurrency(row.metrics.maxDrawdown)}</td></tr>)}
    </tbody></table></div>
    <p className="availability-note">Breakout/Reversal attribution remains algorithm-only. Discretionary app entries are reported separately as My Trades.</p>
  </section>;
}

function ModeAnalytics({
  mode,
  trades,
  orders,
  timeframe,
  timeframeLabel,
}: {
  mode: ExecutionMode;
  trades: PaperTrade[];
  orders: PaperOrder[];
  timeframe: AnalyticsTimeframe;
  timeframeLabel: string;
}) {
  const attributed = useMemo(() => attributePaperTrades(trades, orders), [orders, trades]);
  const selectedTrades = useMemo(() => filterTradesByTimeframe(trades, timeframe), [timeframe, trades]);
  const analytics = useMemo(() => calculatePerformanceForTimeframe(trades, timeframe), [timeframe, trades]);
  const strategyRows = useMemo(() => groupStrategyPerformance(attributed, timeframe), [attributed, timeframe]);
  const modeLabel = mode.toUpperCase();

  return <>
    <section className="terminal-metric-grid six analytics-metrics" aria-label={`${timeframeLabel} ${mode} performance`}>
      <MetricCard label="Net P&L" value={formatCurrency(analytics.netPnl)} detail={`${analytics.completedTrades} realized ${modeLabel} trades`} tone={(analytics.netPnl ?? 0) >= 0 ? "positive" : "negative"} unavailable={analytics.netPnl === null} />
      <MetricCard label="Gross profit" value={formatCurrency(analytics.grossProfit)} tone="positive" unavailable={analytics.grossProfit === null} />
      <MetricCard label="Gross loss" value={formatCurrency(analytics.grossLoss)} tone="negative" unavailable={analytics.grossLoss === null} />
      <MetricCard label="Win rate" value={formatPercent(analytics.winRate)} unavailable={analytics.winRate === null} />
      <MetricCard label="Profit factor" value={analytics.profitFactor?.toFixed(2)} unavailable={analytics.profitFactor === null} />
      <MetricCard label="Maximum drawdown" value={formatCurrency(analytics.maxDrawdown)} tone="negative" unavailable={analytics.maxDrawdown === null} />
      <MetricCard label="Average P&L / trade" value={formatCurrency(analytics.averagePnl)} unavailable={analytics.averagePnl === null} />
      <MetricCard label="Expectancy" value={formatCurrency(analytics.expectancy)} unavailable={analytics.expectancy === null} />
      <MetricCard label="Average win" value={formatCurrency(analytics.averageWinner)} tone="positive" unavailable={analytics.averageWinner === null} />
      <MetricCard label="Average loss" value={formatCurrency(analytics.averageLoser)} tone="negative" unavailable={analytics.averageLoser === null} />
      <MetricCard label="Reward / risk" value={ratio(analytics.rewardRisk)} unavailable={analytics.rewardRisk === null} />
      <MetricCard label="Current streak" value={analytics.winningStreak ? `${analytics.winningStreak} winning` : analytics.losingStreak ? `${analytics.losingStreak} losing` : "None"} detail={`Newest realized ${modeLabel} trades`} />
    </section>

    <section className="analytics-chart-grid terminal-section">
      <article className="card analytics-chart-wide"><div className="section-heading compact"><div><p className="eyebrow">{modeLabel} equity curve</p><h2>Cumulative realized P&amp;L</h2></div><span>{timeframeLabel} · {modeLabel}</span></div><PerformanceChart trades={selectedTrades} /></article>
      <article className="card"><div className="section-heading compact"><div><p className="eyebrow">Distribution</p><h2>Wins vs losses</h2></div></div><WinLossDistribution metrics={analytics} /></article>
      <article className="card"><div className="section-heading compact"><div><p className="eyebrow">Daily result</p><h2>P&amp;L by day</h2></div></div><DailyPnlChart trades={selectedTrades} /></article>
      <article className="card"><div className="section-heading compact"><div><p className="eyebrow">Attribution</p><h2>Strategy P&amp;L</h2></div></div><StrategyPnlChart rows={strategyRows} /></article>
    </section>

    <section className="strategy-performance-grid terminal-section"><StrategyPerformanceCard strategy="breakout" mode={mode} attributed={attributed} /><StrategyPerformanceCard strategy="reversal" mode={mode} attributed={attributed} /></section>
    <StrategyTable paperRows={mode === "paper" ? strategyRows : []} liveRows={mode === "live" ? strategyRows : []} showModes={[mode]} timeframeLabel={timeframeLabel} />
  </>;
}

function ComparisonCard({ label, metrics }: { label: string; metrics: PerformanceMetrics }) {
  return <article><span>{label}</span><strong>{formatCurrency(metrics.netPnl)}</strong><small>{metrics.completedTrades} realized trades · {formatPercent(metrics.winRate)} win rate</small></article>;
}

export function AnalyticsPanel({ status }: { status: ControlStatus }) {
  const [timeframe, setTimeframe] = useState<AnalyticsTimeframe>("today");
  const [mode, setMode] = useState<AnalyticsMode>("paper");
  const paperTrades = useMemo(() => filterTradesByMode(status.paperTrades, "paper"), [status.paperTrades]);
  const liveTrades = useMemo(() => filterTradesByMode(status.paperTrades, "live"), [status.paperTrades]);
  const liveManualTrades = useMemo(() => liveTrades.filter((trade) => trade.execution_source === "manual"), [liveTrades]);
  const liveAlgoTrades = useMemo(() => liveTrades.filter((trade) => trade.execution_source !== "manual"), [liveTrades]);
  const paperOrders = useMemo(() => ordersForMode(status.paperOrders, "paper"), [status.paperOrders]);
  const liveOrders = useMemo(() => ordersForMode(status.paperOrders, "live"), [status.paperOrders]);
  const paperAttributed = useMemo(() => attributePaperTrades(paperTrades, paperOrders), [paperOrders, paperTrades]);
  const liveAttributed = useMemo(() => attributePaperTrades(liveAlgoTrades, liveOrders.filter((order) => order.execution_source !== "manual")), [liveAlgoTrades, liveOrders]);
  const paperMetrics = useMemo(() => calculatePerformanceForTimeframe(paperTrades, timeframe), [paperTrades, timeframe]);
  const liveMetrics = useMemo(() => calculatePerformanceForTimeframe(liveTrades, timeframe), [liveTrades, timeframe]);
  const manualMetrics = useMemo(() => calculatePerformanceForTimeframe(liveManualTrades, timeframe), [liveManualTrades, timeframe]);
  const algoLiveMetrics = useMemo(() => calculatePerformanceForTimeframe(liveAlgoTrades, timeframe), [liveAlgoTrades, timeframe]);
  const paperStrategyRows = useMemo(() => groupStrategyPerformance(paperAttributed, timeframe), [paperAttributed, timeframe]);
  const liveStrategyRows = useMemo(() => groupStrategyPerformance(liveAttributed, timeframe), [liveAttributed, timeframe]);
  const timeframeLabel = timeframe === "all" ? "All time" : timeframe[0].toUpperCase() + timeframe.slice(1);

  return <>
    <section className="analytics-controls" aria-label="Analytics filters">
      <div className="segmented-control large">{(["paper", "live", "combined"] as AnalyticsMode[]).map((item) => <button type="button" key={item} className={mode === item ? "active" : ""} aria-pressed={mode === item} onClick={() => setMode(item)}>{item === "combined" ? "Combined view" : item}</button>)}</div>
      <div className="segmented-control large">{(["today", "week", "month", "all"] as AnalyticsTimeframe[]).map((item) => <button type="button" key={item} className={timeframe === item ? "active" : ""} aria-pressed={timeframe === item} onClick={() => setTimeframe(item)}>{item}</button>)}</div>
    </section>

    {(mode === "live" || mode === "combined") && <>
      <section className="analytics-mode-comparison">
        <ComparisonCard label={`MY TRADES · ${timeframeLabel}`} metrics={manualMetrics} />
        <ComparisonCard label={`ALGO LIVE · ${timeframeLabel}`} metrics={algoLiveMetrics} />
        <p>My Trades are discretionary entries submitted from the app. Algo LIVE contains only engine-generated entries. Together they reconcile to total LIVE performance.</p>
      </section>
      <section className="strategy-performance-grid terminal-section"><MyTradingPerformanceCard trades={liveManualTrades} /></section>
    </>}

    {mode === "combined" ? <>
      <section className="analytics-mode-comparison">
        <ComparisonCard label={`PAPER · ${timeframeLabel}`} metrics={paperMetrics} />
        <ComparisonCard label={`LIVE TOTAL · ${timeframeLabel}`} metrics={liveMetrics} />
        <p>Side-by-side only: simulated PAPER results are never summed with broker-reconciled LIVE fills. LIVE total includes Algo LIVE + My Trades.</p>
      </section>
      <section className="analytics-chart-grid terminal-section">
        <article className="card"><div className="section-heading compact"><div><p className="eyebrow">PAPER equity</p><h2>Simulated fills</h2></div><span>{paperMetrics.completedTrades} realized</span></div><PerformanceChart trades={filterTradesByTimeframe(paperTrades, timeframe)} /></article>
        <article className="card"><div className="section-heading compact"><div><p className="eyebrow">LIVE equity</p><h2>Broker fills</h2></div><span>{liveMetrics.completedTrades} realized</span></div><PerformanceChart trades={filterTradesByTimeframe(liveTrades, timeframe)} /></article>
      </section>
      <StrategyTable paperRows={paperStrategyRows} liveRows={liveStrategyRows} showModes={["paper", "live"]} timeframeLabel={timeframeLabel} />
    </> : <ModeAnalytics mode={mode} trades={mode === "paper" ? paperTrades : liveTrades} orders={mode === "paper" ? paperOrders : liveOrders} timeframe={timeframe} timeframeLabel={timeframeLabel} />}
  </>;
}
