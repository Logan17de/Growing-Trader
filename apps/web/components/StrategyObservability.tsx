"use client";

import { useMemo } from "react";
import NiftyVolumeChart from "@/components/NiftyVolumeChart";
import { StrategyLiveCalculations } from "@/components/terminal/StrategyLiveCalculations";
import { useResearchData } from "@/hooks/useResearchData";
import type { PaperEngineStatus, StrategyLevel } from "@/lib/terminalTypes";
import type { SignalPayload } from "@/lib/types";

function number(value: number | null | undefined, digits = 3) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-IN", { maximumFractionDigits: digits })
    : "—";
}

function signed(value: number | null | undefined, suffix = "", digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${number(value, digits)}${suffix}`;
}

export default function StrategyObservability({ embedded = false, signal = null, paperEngine, levels = [] }: { embedded?: boolean; signal?: SignalPayload | null; paperEngine?: PaperEngineStatus; levels?: StrategyLevel[] }) {
  const { data, error } = useResearchData();
  const groups = useMemo(() => {
    const output = new Map<string, NonNullable<typeof data>["strategyParameters"]>();
    for (const parameter of data?.strategyParameters ?? []) {
      const rows = output.get(parameter.category) ?? [];
      rows.push(parameter);
      output.set(parameter.category, rows);
    }
    return [...output.entries()];
  }, [data]);
  const paper: PaperEngineStatus = paperEngine ?? data?.paperEngine ?? {};
  const mode = paper.mode ?? "paper";
  const activePosition = paper.open_position ?? paper.open_paper_position;
  const executionLabel = mode === "live" ? (paper.live_armed ? "LIVE · ARMED" : "LIVE · DISARMED") : "PAPER";
  const watch = data?.marketWatch ?? [];
  const latestWatch = watch[0];
  const labeled15m = watch.filter((row) => row.nifty_move_15m_bps != null).length;
  const bigMoves = data?.bigMoves ?? [];

  return <section className={embedded ? "strategy-research-embed" : "strategy-research-standalone"}>
    {!embedded && <header className="research-standalone-header">
      <div><p className="eyebrow">Growing Trader · Research</p><h1>Strategy &amp; NIFTY volume</h1><p className="muted">DB-backed thresholds, cross-market inputs, and aggregate volume built from all 50 NIFTY constituents.</p></div>
      <a className="secondary" href="/">← Market control</a>
    </header>}

    {error && <div className="notice error" role="alert">{error === "unauthorized" ? "Sign in from the main dashboard first." : error}</div>}

    <section className="market-secondary-grid strategy-runtime-truth" aria-label="Current strategy execution state">
      <div><span>Execution mode</span><strong className={mode === "live" ? (paper.live_armed ? "bad" : "warn") : "good"}>{executionLabel}</strong><small>{mode === "live" ? "Groww broker path" : "Simulated fills"}</small></div>
      <div><span>Engine</span><strong>{paper.running ? "RUNNING" : "PAUSED"}</strong><small>{paper.state ?? "State unavailable"}</small></div>
      <div><span>Kill switch</span><strong className={paper.kill_switch ? "bad" : "good"}>{paper.kill_switch ? "ACTIVE" : "CLEAR"}</strong><small>{paper.block_new_entries ? "New entries blocked" : "Normal risk policy"}</small></div>
      <div><span>Current position</span><strong>{activePosition?.trading_symbol ?? "NONE"}</strong><small>{activePosition?.quantity ? `${activePosition.quantity} quantity` : "No open inventory"}</small></div>
    </section>

    {embedded && <StrategyLiveCalculations signal={signal} paper={paper} levels={levels} parameters={data?.strategyParameters ?? []} />}

    {!embedded && <section className="card terminal-section">
      <div className="section-heading compact"><div><p className="eyebrow">Market Watch · research only</p><h2>Strategy discovery recorder</h2></div><a className="secondary" href="/market-watch">Open Market Watch →</a></div>
      <p className="muted threshold-intro">This layer never places an order. It records cash participation, whole-NIFTY volume, futures price/volume/OI/basis, option volume/OI/IV positioning, VWAP and the current decision state, then retrospectively labels what NIFTY did 1/3/5/10/15 minutes later. Those future labels are research outcomes only and are never fed into LIVE decisions.</p>
      <section className="market-secondary-grid" aria-label="Market watch recorder status">
        <div><span>Recent observations</span><strong>{watch.length}</strong><small>Latest 12-hour API window</small></div>
        <div><span>15m labels ready</span><strong>{labeled15m}</strong><small>Observations old enough to evaluate</small></div>
        <div><span>Recent big-move rows</span><strong>{bigMoves.length}</strong><small>Research thresholds only</small></div>
        <div><span>Latest observation</span><strong>{latestWatch ? new Date(latestWatch.observed_at).toLocaleTimeString("en-IN") : "—"}</strong><small>{latestWatch?.event?.replaceAll("_", " ") ?? "Waiting for data"}</small></div>
        <div><span>NIFTY</span><strong>{number(latestWatch?.nifty_ltp, 2)}</strong><small>{signed(latestWatch?.vwap_distance_bps, " bps")} vs synthetic VWAP</small></div>
        <div><span>50-stock Δ volume</span><strong>{number(latestWatch?.constituent_volume_delta, 0)}</strong><small>Latest observation interval</small></div>
        <div><span>Cash pressure</span><strong className={(latestWatch?.cash_pressure ?? 0) >= 0 ? "good" : "bad"}>{signed(latestWatch?.cash_pressure)}</strong><small>Breadth {signed(latestWatch?.breadth)}</small></div>
        <div><span>Futures</span><strong className={(latestWatch?.futures_score ?? 0) >= 0 ? "good" : "bad"}>{signed(latestWatch?.futures_score)}</strong><small>OI {signed(latestWatch?.futures_oi_change_pct, "%")}</small></div>
        <div><span>Options positioning</span><strong className={(latestWatch?.option_score ?? 0) >= 0 ? "good" : "bad"}>{signed(latestWatch?.option_score)}</strong><small>OI imbalance {signed(latestWatch?.option_oi_change_imbalance)}</small></div>
        <div><span>Combined market score</span><strong className={(latestWatch?.combined_direction_score ?? 0) >= 0 ? "good" : "bad"}>{signed(latestWatch?.combined_direction_score)}</strong><small>{latestWatch?.direction?.toUpperCase() ?? "—"}</small></div>
      </section>
      <div className="section-heading compact"><div><p className="eyebrow">Recent labeled events</p><h3>Big-move research windows</h3></div><span>Retrospective outcomes</span></div>
      {bigMoves.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Observed</th><th>NIFTY</th><th>1m</th><th>5m</th><th>15m</th><th>Cash</th><th>Futures</th><th>Options</th><th>Volume</th></tr></thead><tbody>{bigMoves.slice(0, 8).map((row) => <tr key={row.observed_at}><td>{new Date(row.observed_at).toLocaleTimeString("en-IN")}</td><td className="numeric">{number(row.nifty_ltp, 2)}</td><td className={`numeric ${(row.nifty_move_1m_bps ?? 0) >= 0 ? "good" : "bad"}`}>{signed(row.nifty_move_1m_bps, " bps")}</td><td className={`numeric ${(row.nifty_move_5m_bps ?? 0) >= 0 ? "good" : "bad"}`}>{signed(row.nifty_move_5m_bps, " bps")}</td><td className={`numeric ${(row.nifty_move_15m_bps ?? 0) >= 0 ? "good" : "bad"}`}>{signed(row.nifty_move_15m_bps, " bps")}</td><td className="numeric">{signed(row.cash_pressure)}</td><td className="numeric">{signed(row.futures_score)}</td><td className="numeric">{signed(row.option_score)}</td><td className="numeric">{number(row.constituent_volume_delta, 0)}</td></tr>)}</tbody></table></div> : <p className="muted">No observation in the loaded window has crossed the current research-only big-move thresholds yet.</p>}
      <p className="availability-note">The raw snapshot history remains the source of truth. A weekday GitHub Actions artifact exports the flattened log as JSONL so market-move conditions can be inspected later without putting high-frequency data in Git history.</p>
    </section>}

    <section className="card terminal-section strategy-volume-card">
      <div className="section-heading compact"><div><p className="eyebrow">Cross-market context</p><h2>Volume behind the decision</h2></div><span>{paper.running ? "Collecting" : "Waiting"} · 1-minute buckets</span></div>
      <NiftyVolumeChart points={data?.niftyVolumeSeries ?? []} />
    </section>

    <section className="card terminal-section">
      <div className="section-heading compact"><div><p className="eyebrow">Database source of truth</p><h2>All strategy thresholds</h2></div><span>{data?.strategyParameters.length ?? 0} parameters</span></div>
      <p className="muted threshold-intro">Oracle reloads these values while the engine is running. Comparisons above use only thresholds whose direction is explicit in backend semantics. Snapshot: {paper.thresholds_updated_at ? new Date(paper.thresholds_updated_at).toLocaleString("en-IN") : "—"}.</p>
      {groups.length === 0 ? <p className="muted">Apply the observability migrations to expose strategy parameters.</p> : groups.map(([category, parameters]) => <details className="parameter-group" key={category}>
        <summary><span>{category.replaceAll("_", " ")}</span><small>{parameters.length} parameters</small></summary>
        <div className="level-table-wrap"><table className="level-table parameter-table"><thead><tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Description</th><th>Updated</th></tr></thead><tbody>{parameters.map((parameter) => <tr key={parameter.key}><td><strong>{parameter.key}</strong></td><td className="numeric">{number(Number(parameter.value), 6)}</td><td>{parameter.unit || "—"}</td><td>{parameter.description}</td><td>{parameter.updated_at ? new Date(parameter.updated_at).toLocaleString("en-IN") : "—"}</td></tr>)}</tbody></table></div>
      </details>)}
    </section>

    <p className="availability-note strategy-footnote">Entry warm-up: {paper.opening_no_entry_minutes ?? "—"} minutes after 09:15 IST · Latest dynamic exit: {paper.last_exit_reason ?? "none"} · Execution: {executionLabel}.</p>
  </section>;
}
