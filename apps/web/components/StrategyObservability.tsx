"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import NiftyVolumeChart, { type NiftyVolumePoint } from "@/components/NiftyVolumeChart";
import { jsonRequest } from "@/lib/controlClient";
import type { StrategyParameter, TerminalConfig } from "@/lib/terminalTypes";

type PaperEngineStatus = {
  running?: boolean;
  state?: string;
  weighting?: string;
  nifty_ltp?: number | null;
  synthetic_vwap?: number | null;
  whole_nifty_volume_delta?: number;
  whole_nifty_turnover?: number;
  heavyweight_score?: number;
  cash_pressure?: number;
  breadth?: number;
  participation?: number;
  future_ltp?: number | null;
  option_direction_score?: number;
  option_direction_ready?: boolean;
  vwap_score?: number;
  combined_direction_score?: number;
  thresholds_updated_at?: string | null;
  opening_no_entry_minutes?: number;
  last_exit_reason?: string | null;
};

type ResearchPayload = {
  strategyParameters: StrategyParameter[];
  niftyVolumeSeries: NiftyVolumePoint[];
  paperEngine: PaperEngineStatus;
};

function number(value: number | null | undefined, digits = 3) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";
}
function compact(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
function turnover(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `₹${(value / 10_000_000).toFixed(1)}Cr`;
}

export default function StrategyObservability({ embedded = false, editable = false }: { embedded?: boolean; editable?: boolean }) {
  const [data, setData] = useState<ResearchPayload | null>(null);
  const [config, setConfig] = useState<TerminalConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [presetId, setPresetId] = useState("");

  const load = useCallback(async () => {
    try {
      const [research, loadedConfig] = await Promise.all([
        jsonRequest<ResearchPayload>("/api/control/research"),
        jsonRequest<TerminalConfig>("/api/control/config"),
      ]);
      setData(research);
      setConfig(loadedConfig);
      setDraft((current) => {
        if (dirty && Object.keys(current).length) return current;
        return Object.fromEntries(loadedConfig.strategyParameters.map((parameter) => [parameter.key, String(parameter.value)]));
      });
      setPresetId(loadedConfig.strategyState?.active_preset_id ?? "");
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load strategy state");
    }
  }, [dirty]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const parameters = config?.strategyParameters ?? data?.strategyParameters ?? [];
  const groups = useMemo(() => {
    const output = new Map<string, StrategyParameter[]>();
    for (const parameter of parameters) {
      const rows = output.get(parameter.category) ?? [];
      rows.push(parameter);
      output.set(parameter.category, rows);
    }
    return [...output.entries()];
  }, [parameters]);
  const paper = data?.paperEngine ?? {};

  async function saveParameters() {
    setBusy("save"); setNotice(""); setError("");
    try {
      const values = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, Number(value)]));
      const next = await jsonRequest<TerminalConfig>("/api/control/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parameters: values }) });
      setConfig(next); setDirty(false); setNotice("Strategy thresholds saved atomically. Oracle will pick them up on its next control refresh.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save strategy thresholds"); }
    finally { setBusy(""); }
  }

  async function applyPreset() {
    if (!presetId) return;
    setBusy("preset"); setNotice(""); setError("");
    try {
      const next = await jsonRequest<TerminalConfig>("/api/control/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply_preset", presetId }) });
      setConfig(next); setDraft(Object.fromEntries(next.strategyParameters.map((parameter) => [parameter.key, String(parameter.value)]))); setDirty(false); setNotice("Strategy preset applied and version incremented.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not apply preset"); }
    finally { setBusy(""); }
  }

  function resetDraft() {
    setDraft(Object.fromEntries(parameters.map((parameter) => [parameter.key, String(parameter.value)])));
    setDirty(false); setNotice(""); setError("");
  }

  return (
    <section className={embedded ? "strategy-research-embed" : "strategy-research-standalone"} style={embedded ? undefined : { width: "min(1500px, 95vw)", margin: "0 auto", padding: "28px 0 72px" }}>
      {!embedded && <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 18 }}><div><p className="eyebrow">Growing Trader · Research</p><h1 style={{ margin: "5px 0 8px", fontSize: "clamp(2rem,4vw,3.5rem)", letterSpacing: "-.045em" }}>Strategy &amp; NIFTY volume</h1><p className="muted" style={{ margin: 0, maxWidth: 820 }}>DB-backed thresholds, cross-market strategy inputs, and the synthetic aggregate volume built from all 50 NIFTY constituents.</p></div><a className="secondary" href="/" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>← Market control</a></header>}

      {error && <div className="notice error" role="alert" style={{ marginBottom: 16 }}>{error === "unauthorized" ? "Sign in from the main dashboard first." : error}</div>}
      {notice && <div className="notice" role="status" style={{ marginBottom: 16 }}>{notice}</div>}

      <section className="dashboard-grid" style={{ marginBottom: 18 }}>
        <article className="card span-12">
          <div className="card-head"><div><span className="label">Live 50-stock aggregate</span><h3>NIFTY participation volume</h3></div><span className="pill">{paper.running ? "live" : "waiting"}</span></div>
          <div className="metric-grid" style={{ marginTop: 16 }}>
            <div><span>NIFTY</span><strong>{number(paper.nifty_ltp, 2)}</strong></div><div><span>50-stock Δ volume</span><strong>{compact(paper.whole_nifty_volume_delta)} shares</strong></div><div><span>50-stock turnover</span><strong>{turnover(paper.whole_nifty_turnover)}</strong></div><div><span>Synthetic VWAP</span><strong>{number(paper.synthetic_vwap, 2)}</strong></div><div><span>Cash pressure</span><strong>{number(paper.cash_pressure)}</strong></div><div><span>Heavyweights</span><strong>{number(paper.heavyweight_score)}</strong></div><div><span>Breadth</span><strong>{number(paper.breadth)}</strong></div><div><span>Participation</span><strong>{number(paper.participation)}</strong></div><div><span>Options activity</span><strong>{paper.option_direction_ready ? number(paper.option_direction_score) : "warming"}</strong></div><div><span>VWAP score</span><strong>{number(paper.vwap_score)}</strong></div><div><span>Combined score</span><strong>{number(paper.combined_direction_score)}</strong></div><div><span>Weighting</span><strong>{paper.weighting ?? "—"}</strong></div>
          </div>
          <NiftyVolumeChart points={data?.niftyVolumeSeries ?? []} />
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="card span-12">
          <div className="card-head"><div><span className="label">Database source of truth</span><h3>All strategy thresholds</h3></div><span className="pill">{parameters.length} parameters</span></div>
          <p className="muted">Oracle reloads these values while the engine is running. Invalid ranges and weight groups are rejected before the DB update is committed. Current threshold snapshot: {paper.thresholds_updated_at ? new Date(paper.thresholds_updated_at).toLocaleString() : "—"}.</p>
          {editable && <div className="strategy-actions" style={{ marginBottom: 12 }}><select value={presetId} onChange={(event) => setPresetId(event.target.value)} aria-label="Strategy preset"><option value="">Current custom parameters</option>{config?.strategyPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><button className="secondary" type="button" onClick={() => void applyPreset()} disabled={!presetId || Boolean(busy)}>{busy === "preset" ? "Applying…" : "Apply preset"}</button><button className="primary" type="button" onClick={() => void saveParameters()} disabled={!dirty || Boolean(busy)}>{busy === "save" ? "Saving…" : "Save threshold changes"}</button><button className="ghost" type="button" onClick={resetDraft} disabled={!dirty || Boolean(busy)}>Reset edits</button></div>}
          {groups.length === 0 ? <p className="muted">Apply the strategy observability migrations to create the parameter tables.</p> : groups.map(([category, categoryParameters]) => (
            <div key={category} style={{ marginTop: 22 }}><p className="eyebrow" style={{ marginBottom: 8 }}>{category.replaceAll("_", " ")}</p><div className="level-table-wrap"><table className="level-table"><thead><tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Description</th><th>Updated</th></tr></thead><tbody>{categoryParameters.map((parameter) => <tr key={parameter.key}><td><strong>{parameter.key}</strong></td><td className="price-cell">{editable ? <input type="number" step="any" value={draft[parameter.key] ?? String(parameter.value)} onChange={(event) => { setDraft((current) => ({ ...current, [parameter.key]: event.target.value })); setDirty(true); }} aria-label={parameter.key} /> : number(Number(parameter.value), 6)}</td><td>{parameter.unit || "—"}</td><td>{parameter.description}</td><td>{parameter.updated_at ? new Date(parameter.updated_at).toLocaleString() : "—"}</td></tr>)}</tbody></table></div></div>
          ))}
        </article>
      </section>
      <p className="muted" style={{ marginTop: 16, fontSize: ".78rem" }}>Entry warm-up: {paper.opening_no_entry_minutes ?? "—"} minutes after 09:15 IST · Latest dynamic exit: {paper.last_exit_reason ?? "none"} · Execution remains paper-only.</p>
    </section>
  );
}
