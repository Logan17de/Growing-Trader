"use client";

import NiftyVolumeChart from "@/components/NiftyVolumeChart";
import { BackendUnavailable, EmptyState } from "@/components/terminal/EmptyState";
import { MarketDecisionCards } from "@/components/terminal/MarketDecisionCards";
import { VolumeAnalytics } from "@/components/terminal/VolumeAnalytics";
import { useResearchData } from "@/hooks/useResearchData";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { ControlStatus } from "@/lib/terminalTypes";

export function MarketOverviewPanel({ status }: { status: ControlStatus }) {
  const { data, error } = useResearchData();
  const paper = status.paperEngine;
  const signal = status.latestSignal?.payload ?? null;
  const points = data?.niftyVolumeSeries ?? [];
  const basis = typeof paper.future_ltp === "number" && typeof paper.nifty_ltp === "number" ? paper.future_ltp - paper.nifty_ltp : null;

  return <>
    {error && <div className="notice error" role="alert">Minute research data could not be loaded: {error}</div>}
    <MarketDecisionCards status={status} points={points} />

    <section className="card terminal-section market-volume-card">
      <div className="section-heading compact"><div><p className="eyebrow">Intraday participation</p><h2>NIFTY minute volume</h2></div><span>Price-direction coloring · session-relative baseline</span></div>
      <NiftyVolumeChart points={points} />
    </section>

    <section className="market-secondary-grid" aria-label="Secondary market metrics">
      <div><span>Turnover / minute</span><strong>{formatCurrency(paper.whole_nifty_turnover)}</strong><small>Aggregate constituents</small></div>
      <div><span>Participation</span><strong>{typeof paper.participation === "number" ? `${(paper.participation * 100).toFixed(0)}%` : "—"}</strong><small>Activity dispersion</small></div>
      <div><span>Heavyweight score</span><strong className={(paper.heavyweight_score ?? 0) >= 0 ? "good" : "bad"}>{typeof paper.heavyweight_score === "number" ? `${paper.heavyweight_score >= 0 ? "+" : ""}${paper.heavyweight_score.toFixed(2)}` : "—"}</strong><small>Direction contribution</small></div>
      <div><span>Options activity</span><strong>{paper.option_direction_ready ? formatNumber(paper.option_direction_score, 3) : "Warming"}</strong><small>{paper.option_direction_ready ? "Near-ATM activity score" : "Not ready"}</small></div>
      <div><span>Futures confirmation</span><strong>{signal ? `${signal.futures.score >= 0 ? "+" : ""}${signal.futures.score.toFixed(2)}` : "—"}</strong><small>{paper.future_symbol ?? "Future unavailable"}</small></div>
      <div><span>Synthetic VWAP</span><strong>{formatNumber(paper.synthetic_vwap)}</strong><small>{typeof paper.vwap_score === "number" ? `Score ${paper.vwap_score.toFixed(2)}` : "Derived value unavailable"}</small></div>
      <div><span>Futures basis</span><strong className={(basis ?? 0) >= 0 ? "good" : "bad"}>{basis === null ? "—" : `${basis >= 0 ? "+" : ""}${formatNumber(basis)} pts`}</strong><small>Future minus spot</small></div>
      <div><span>Weighting model</span><strong>{paper.weighting ?? "—"}</strong><small>{paper.constituents_fresh ?? 0} / {paper.constituents_total ?? 50} fresh</small></div>
    </section>

    <section className="dashboard-grid terminal-section">
      <article className="card span-8">
        <div className="section-heading compact"><div><p className="eyebrow">Market internals</p><h2>Decision inputs</h2></div><span>Latest authenticated scan</span></div>
        <div className="market-internals-grid">
          <div><span>Advancers</span><strong className="good">{signal?.cash.advancers ?? "—"}</strong></div>
          <div><span>Decliners</span><strong className="bad">{signal?.cash.decliners ?? "—"}</strong></div>
          <div><span>Breadth score</span><strong>{typeof paper.breadth === "number" ? `${paper.breadth >= 0 ? "+" : ""}${paper.breadth.toFixed(2)}` : "—"}</strong></div>
          <div><span>1-min volume</span><strong>{formatNumber(paper.whole_nifty_volume_delta, 0)}</strong></div>
          <div><span>Turnover</span><strong>{formatCurrency(paper.whole_nifty_turnover)}</strong></div>
          <div><span>Participation</span><strong>{typeof paper.participation === "number" ? `${(paper.participation * 100).toFixed(0)}%` : "—"}</strong></div>
          <div><span>Futures basis</span><strong>{basis === null ? "—" : `${basis >= 0 ? "+" : ""}${formatNumber(basis)}`}</strong></div>
          <div><span>Option positioning</span><strong>{paper.option_direction_ready ? formatNumber(paper.option_direction_score, 3) : "Not ready"}</strong></div>
        </div>
      </article>
      <article className="card span-4">
        <div className="section-heading compact"><div><p className="eyebrow">Market structure</p><h2>Support / resistance</h2></div></div>
        {status.levels.length === 0 ? <EmptyState icon="layers" title="No active levels" description="Create levels from Settings; the engine reads the same records." compact /> : <div className="level-ladder compact-ladder">{status.levels.map((level) => <div key={level.id}><span className={`level-kind ${level.kind}`}>{level.kind}</span><strong>{formatNumber(level.price)}</strong><div><span>{level.name}</span><small>{level.enabled ? "enabled" : "disabled"}</small></div></div>)}</div>}
      </article>
    </section>

    <VolumeAnalytics status={status} points={points} />

    <details className="card terminal-section market-drilldown">
      <summary><div><p className="eyebrow">Constituent drill-down</p><h2>Movers, sectors &amp; full NIFTY-50 tape</h2></div><span>Expand details</span></summary>
      <div className="market-drilldown-grid">
        <section><h3>Buying-pressure proxies</h3><BackendUnavailable title="Per-symbol price and RVOL are not persisted" description="Ranking requires current move, volume delta, RVOL, and index weight for each constituent. Aggregate cash pressure cannot identify the contributing symbols." /></section>
        <section><h3>Selling-pressure proxies</h3><BackendUnavailable title="Per-symbol directional pressure is not exposed" description="No buyer/seller identity is inferred from the aggregate minute series. Oracle remains the only Groww-connected process." /></section>
        <section><h3>Volume spikes &amp; heavyweight watch</h3><BackendUnavailable title="Constituent scan rows are unavailable to the web app" description="The engine calculates an aggregate heavyweight score, but does not publish individual scan rows through the current status contract." /></section>
        <section><h3>Sector heatmap</h3><BackendUnavailable title="Sector membership is absent from the source contract" description="A heatmap would be fabricated without sector tags and per-symbol movement. This state will populate only after those fields are intentionally exposed." /></section>
      </div>
      <div className="full-tape-boundary"><h3>Full NIFTY-50 tape</h3><BackendUnavailable title="Searchable constituent tape awaiting real rows" description="Sorting, search, sector filters, heavyweight filters, RVOL, move, and weight controls are withheld until the backend supplies the corresponding authenticated data." /></div>
    </details>
  </>;
}
