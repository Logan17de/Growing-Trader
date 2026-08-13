"use client";

import { useState } from "react";
import { EmptyState } from "@/components/terminal/EmptyState";
import { Icon } from "@/components/terminal/Icon";
import { MetricCard } from "@/components/terminal/MetricCard";
import { jsonRequest } from "@/lib/controlClient";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { BacktestRequest, BacktestResult, CommandStatus, ControlStatus } from "@/lib/terminalTypes";

function sleep(ms: number) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }

export function ReplayPanel({ status }: { status: ControlStatus }) {
  const [request, setRequest] = useState<BacktestRequest>({ instrument: "NIFTY", date: "", startTime: "09:15", endTime: "15:15", strategyId: "level-event", strategyVersion: "current", startingCapital: status.paperEngine.account_equity ?? status.engineSettings?.account_equity ?? 100000, confirmations: ["volume", "futures", "oi", "options"] });
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  function toggle(value: BacktestRequest["confirmations"][number]) { setRequest((current) => ({ ...current, confirmations: current.confirmations.includes(value) ? current.confirmations.filter((item) => item !== value) : [...current.confirmations, value] })); }

  async function runReplay() {
    setBusy(true); setNotice(""); setResult(null);
    try {
      const queued = await jsonRequest<{ id: string }>("/api/control/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: "RUN_REPLAY", payload: request }) });
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await sleep(1000);
        const command = await jsonRequest<CommandStatus>(`/api/control/command?id=${encodeURIComponent(queued.id)}`);
        if (command.status === "failed") throw new Error(command.error ?? "Replay failed");
        if (command.status === "completed") {
          setResult(command.result as BacktestResult); setNotice("Replay completed against persisted paper-market frames."); return;
        }
      }
      throw new Error("Replay is still running. Its command result remains in the control-plane history.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Replay failed"); }
    finally { setBusy(false); }
  }

  return <>
    {notice && <div className="notice" role="status"><Icon name="replay" />{notice}</div>}
    <section className="dashboard-grid terminal-section replay-layout">
      <article className="card span-5"><div className="section-heading compact"><div><p className="eyebrow">Replay request</p><h2>Historical simulation</h2></div><span>Persisted market frames</span></div><div className="form-grid two"><label className="field"><span>Instrument</span><select value={request.instrument} onChange={(event) => setRequest({ ...request, instrument: event.target.value })}><option>NIFTY</option></select></label><label className="field"><span>Date</span><input type="date" value={request.date} onChange={(event) => setRequest({ ...request, date: event.target.value })} /></label><label className="field"><span>Start time</span><input type="time" value={request.startTime} onChange={(event) => setRequest({ ...request, startTime: event.target.value })} /></label><label className="field"><span>End time</span><input type="time" value={request.endTime} onChange={(event) => setRequest({ ...request, endTime: event.target.value })} /></label><label className="field"><span>Strategy</span><select value={request.strategyId} onChange={(event) => setRequest({ ...request, strategyId: event.target.value })}><option value="level-event">Level-event engine</option></select></label><label className="field"><span>Version / config</span><input value={request.strategyVersion} onChange={(event) => setRequest({ ...request, strategyVersion: event.target.value })} /></label><label className="field span-form"><span>Starting capital</span><input type="number" min="1" value={request.startingCapital} onChange={(event) => setRequest({ ...request, startingCapital: Number(event.target.value) })} /></label></div><div className="confirmation-options"><span>Confirmation set</span>{(["volume", "futures", "oi", "options"] as const).map((item) => <label key={item}><input type="checkbox" checked={request.confirmations.includes(item)} onChange={() => toggle(item)} />{item === "oi" ? "OI" : item[0].toUpperCase() + item.slice(1)}</label>)}</div><button className="primary button-wide" type="button" onClick={() => void runReplay()} disabled={busy || !request.date || !status.worker.online}><span>{busy ? "Running replay…" : "Run historical replay"}</span><Icon name={busy ? "refresh" : "replay"} className={busy ? "spin" : undefined} /></button><p className="availability-note">Replay never calls Groww for historical fills. It evaluates only market snapshots persisted by this paper runtime and applies the configured paper slippage/fee assumptions.</p></article>
      <article className="card span-7"><div className="section-heading compact"><div><p className="eyebrow">Results</p><h2>Backtest output</h2></div><span>{result?.frames ? `${result.frames} frames` : "Awaiting replay"}</span></div>{!result ? <EmptyState icon="replay" title="No replay result yet" description="Choose a date after snapshot persistence was deployed, then run the replay. Dates with no stored frames return an explicit no-data result rather than fabricated performance." /> : <><section className="terminal-metric-grid two nested"><MetricCard label="Trades generated" value={formatNumber(result.tradesGenerated, 0)} /><MetricCard label="Win rate" value={formatPercent(result.winRate)} unavailable={result.winRate === null} /><MetricCard label="P&L" value={formatCurrency(result.pnl)} unavailable={result.pnl === null} tone={(result.pnl ?? 0) >= 0 ? "positive" : "negative"} /><MetricCard label="Maximum drawdown" value={formatCurrency(result.maximumDrawdown)} unavailable={result.maximumDrawdown === null} tone="negative" /></section>{result.message && <p className="availability-note">{result.message}</p>}{result.eventCounts && <div className="diagnostic-list" style={{ marginTop: 14 }}>{Object.entries(result.eventCounts).map(([name, value]) => <div key={name}><span>{name.replaceAll("_", " ")}</span><strong>{formatNumber(value, 0)}</strong></div>)}</div>}</>}</article>
    </section>
  </>;
}
