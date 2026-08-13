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
