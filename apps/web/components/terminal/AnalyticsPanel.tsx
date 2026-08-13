"use client";

import { useMemo, useState } from "react";
import { DailyPnlChart, StrategyPnlChart, WinLossDistribution } from "@/components/terminal/AnalyticsCharts";
import { EmptyState } from "@/components/terminal/EmptyState";
import { MetricCard } from "@/components/terminal/MetricCard";
import { PerformanceChart } from "@/components/terminal/PerformanceChart";
import { formatCurrency, formatPercent } from "@/lib/format";
import { attributePaperTrades, calculatePerformanceForTimeframe, filterTradesByTimeframe, groupStrategyPerformance, type AnalyticsTimeframe } from "@/lib/terminalAnalytics";
import type { ControlStatus } from "@/lib/terminalTypes";

type AnalyticsMode = "paper" | "live" | "combined";

function ratio(value: number | null) {
  return value === null ? undefined : `${value.toFixed(2)}x`;
}

function StrategyPerformanceCard({ strategy, status }: { strategy: "breakout" | "reversal"; status: ControlStatus }) {
  const attributed = useMemo(() => attributePaperTrades(status.paperTrades, status.paperOrders).filter((trade) => trade.strategy === strategy), [status.paperOrders, status.paperTrades, strategy]);
  const today = calculatePerformanceForTimeframe(attributed, "today");
  const week = calculatePerformanceForTimeframe(attributed, "week");
  const month = calculatePerformanceForTimeframe(attributed, "month");
  const all = calculatePerformanceForTimeframe(attributed, "all");
  return <article className="strategy-performance-card">
    <div><p className="eyebrow">Paper strategy</p><h3>S/R {strategy}</h3></div>
    <dl className="strategy-periods"><div><dt>Today</dt><dd>{formatCurrency(today.netPnl)}</dd></div><div><dt>Week</dt><dd>{formatCurrency(week.netPnl)}</dd></div><div><dt>Month</dt><dd>{formatCurrency(month.netPnl)}</dd></div><div><dt>All-time</dt><dd>{formatCurrency(all.netPnl)}</dd></div></dl>
    <div className="strategy-performance-stats"><span>Trades <strong>{all.completedTrades}</strong></span><span>Win rate <strong>{formatPercent(all.winRate)}</strong></span><span>Avg win <strong>{formatCurrency(all.averageWinner)}</strong></span><span>Avg loss <strong>{formatCurrency(all.averageLoser)}</strong></span><span>Profit factor <strong>{all.profitFactor?.toFixed(2) ?? "Unavailable"}</strong></span></div>
  </article>;
}

export function AnalyticsPanel({ status }: { status: ControlStatus }) {
  const [timeframe, setTimeframe] = useState<AnalyticsTimeframe>("today");
  const [mode, setMode] = useState<AnalyticsMode>("paper");
  const attributed = useMemo(() => attributePaperTrades(status.paperTrades, status.paperOrders), [status.paperOrders, status.paperTrades]);
  const selectedTrades = filterTradesByTimeframe(status.paperTrades, timeframe);
  const analytics = calculatePerformanceForTimeframe(status.paperTrades, timeframe);
  const strategyRows = groupStrategyPerformance(attributed, timeframe);
  const timeframeLabel = timeframe === "all" ? "All time" : timeframe[0].toUpperCase() + timeframe.slice(1);

  return <>
    <section className="analytics-controls" aria-label="Analytics filters">
      <div className="segmented-control large">{(["paper", "live", "combined"] as AnalyticsMode[]).map((item) => <button type="button" key={item} className={mode === item ? "active" : ""} aria-pressed={mode === item} onClick={() => setMode(item)}>{item === "combined" ? "Combined view" : item}</button>)}</div>
      <div className="segmented-control large">{(["today", "week", "month", "all"] as AnalyticsTimeframe[]).map((item) => <button type="button" key={item} className={timeframe === item ? "active" : ""} aria-pressed={timeframe === item} onClick={() => setTimeframe(item)}>{item}</button>)}</div>
    </section>

    {mode === "live" ? <section className="card terminal-section"><EmptyState icon="shield" title="No live execution dataset" description="LIVE fills are not exposed by the current repository. Paper records are never relabeled as live performance." /></section> : <>
      {mode === "combined" && <section className="analytics-mode-comparison"><article><span>Paper · {timeframeLabel}</span><strong>{formatCurrency(analytics.netPnl)}</strong><small>{analytics.completedTrades} realized trades</small></article><article className="unavailable"><span>Live · {timeframeLabel}</span><strong>Unavailable</strong><small>No live fills in the data contract</small></article><p>Combined view keeps modes side by side. It does not add paper and live fills into one performance number.</p></section>}

      <section className="terminal-metric-grid six analytics-metrics" aria-label={`${timeframeLabel} paper performance`}>
        <MetricCard label="Net P&L" value={formatCurrency(analytics.netPnl)} detail={`${analytics.completedTrades} realized paper trades`} tone={(analytics.netPnl ?? 0) >= 0 ? "positive" : "negative"} unavailable={analytics.netPnl === null} />
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
        <MetricCard label="Current streak" value={analytics.winningStreak ? `${analytics.winningStreak} winning` : analytics.losingStreak ? `${analytics.losingStreak} losing` : "None"} detail="Newest realized paper trades" />
      </section>

      <section className="analytics-chart-grid terminal-section">
        <article className="card analytics-chart-wide"><div className="section-heading compact"><div><p className="eyebrow">Equity curve</p><h2>Cumulative realized P&amp;L</h2></div><span>{timeframeLabel} · paper</span></div><PerformanceChart trades={selectedTrades} /></article>
        <article className="card"><div className="section-heading compact"><div><p className="eyebrow">Distribution</p><h2>Wins vs losses</h2></div></div><WinLossDistribution metrics={analytics} /></article>
        <article className="card"><div className="section-heading compact"><div><p className="eyebrow">Daily result</p><h2>P&amp;L by day</h2></div></div><DailyPnlChart trades={selectedTrades} /></article>
        <article className="card"><div className="section-heading compact"><div><p className="eyebrow">Attribution</p><h2>Strategy P&amp;L</h2></div></div><StrategyPnlChart rows={strategyRows} /></article>
      </section>

      <section className="strategy-performance-grid terminal-section"><StrategyPerformanceCard strategy="breakout" status={status} /><StrategyPerformanceCard strategy="reversal" status={status} /></section>

      <section className="card terminal-section"><div className="section-heading compact"><div><p className="eyebrow">Strategy table</p><h2>Performance by setup and mode</h2></div><span>{timeframeLabel}</span></div>
        <div className="table-scroll"><table className="data-table strategy-performance-table"><thead><tr><th>Strategy</th><th>Mode</th><th>Trades</th><th>Win rate</th><th>Net P&amp;L</th><th>Avg P&amp;L</th><th>Profit factor</th><th>Drawdown</th></tr></thead><tbody>
          {strategyRows.map((row) => <tr key={`${row.strategy}-paper`}><td><strong>S/R {row.strategy}</strong></td><td><span className="side-badge paper">PAPER</span></td><td className="numeric">{row.metrics.completedTrades}</td><td className="numeric">{formatPercent(row.metrics.winRate)}</td><td className={`numeric ${(row.metrics.netPnl ?? 0) >= 0 ? "good" : "bad"}`}>{formatCurrency(row.metrics.netPnl)}</td><td className="numeric">{formatCurrency(row.metrics.averagePnl)}</td><td className="numeric">{row.metrics.profitFactor?.toFixed(2) ?? "Unavailable"}</td><td className="numeric bad">{formatCurrency(row.metrics.maxDrawdown)}</td></tr>)}
          {(["breakout", "reversal"] as const).map((strategy) => <tr key={`${strategy}-live`} className="unavailable-row"><td><strong>S/R {strategy}</strong></td><td><span className="side-badge live">LIVE</span></td><td colSpan={6}>Live fills unavailable · not combined with paper</td></tr>)}
        </tbody></table></div>
      </section>
    </>}
  </>;
}
