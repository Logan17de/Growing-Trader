"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/terminal/ConfirmDialog";
import { BackendUnavailable } from "@/components/terminal/EmptyState";
import { Icon } from "@/components/terminal/Icon";
import { SignalExplanation } from "@/components/terminal/SignalExplanation";
import { jsonRequest } from "@/lib/controlClient";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { ControlCommand, ControlStatus } from "@/lib/terminalTypes";

export function StrategiesPanel({ status, refresh }: { status: ControlStatus; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmPause, setConfirmPause] = useState(false);
  const paper = status.paperEngine;
  const signal = status.latestSignal?.payload ?? null;
  const activeLevel = signal?.level.level_name ? status.levels.find((level) => level.name === signal.level.level_name) : undefined;

  async function runCommand(command: ControlCommand) {
    setBusy(command);
    setNotice("");
    try {
      const response = await jsonRequest<{ duplicate?: boolean }>("/api/control/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }) });
      setNotice(response.duplicate ? "This command is already queued or running." : `${command.replaceAll("_", " ")} queued for the Oracle worker.`);
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Command failed");
    } finally {
      setBusy("");
      setConfirmPause(false);
    }
  }

  const canStart = Boolean(status.worker.online && status.credentials.configured && !paper.running && !busy);
  const canStop = Boolean(status.worker.online && paper.running && !busy);
  return <>
    {notice && <div className="notice" role="status"><Icon name="activity" />{notice}</div>}
    <section className="terminal-section strategy-card card">
      <div className="strategy-header">
        <div className="title-with-icon"><div className="card-icon"><Icon name="strategy" /></div><div><p className="eyebrow">Level-event research</p><h2>NIFTY participation + futures confirmation</h2><p className="muted">Framework-independent Python strategy engine · Groww market data · paper execution</p></div></div>
        <div className="strategy-mode-stack"><span className={`status-badge ${paper.running ? "good" : "warn"}`}><span className={`status-dot ${paper.running ? "good" : "warn"}`} />{paper.running ? "Active" : "Paused"}</span><span className="mode-badge"><span className="status-dot amber" />Paper</span></div>
      </div>
      <div className="strategy-stats">
        <div><span>Instrument</span><strong>NIFTY</strong></div>
        <div><span>Current signal</span><strong>{signal ? `${signal.event} · ${signal.direction}`.toUpperCase() : "Unavailable"}</strong></div>
        <div><span>Trades today</span><strong>{status.paperOrders.filter((order) => new Date(order.created_at).toDateString() === new Date().toDateString()).length}</strong></div>
        <div><span>Daily P&amp;L</span><strong>{status.paperTrades.some((trade) => new Date(trade.executed_at).toDateString() === new Date().toDateString() && trade.pnl !== null) ? formatCurrency(status.paperTrades.filter((trade) => new Date(trade.executed_at).toDateString() === new Date().toDateString()).reduce((sum, trade) => sum + (trade.pnl ?? 0), 0)) : "Unavailable"}</strong></div>
        <div><span>Confidence</span><strong>{signal ? formatPercent(signal.confidence) : "Unavailable"}</strong></div>
        <div><span>Position</span><strong>{paper.open_paper_position?.trading_symbol ?? "None"}</strong></div>
      </div>
      <div className="strategy-actions">
        <button className="primary" type="button" onClick={() => void runCommand("START_PAPER_ENGINE")} disabled={!canStart}>{busy === "START_PAPER_ENGINE" ? <Icon name="refresh" className="spin" /> : <Icon name="activity" />}Activate / resume</button>
        <button className="secondary" type="button" onClick={() => setConfirmPause(true)} disabled={!canStop}><Icon name="stop" />Pause</button>
        <button className="secondary" disabled>Deactivate</button><button className="secondary" disabled>Edit</button><button className="secondary" disabled>Duplicate</button>
        <button className="mode-action selected" disabled><span className="status-dot amber" />Paper mode</button><button className="mode-action live" disabled>Live mode unavailable</button>
      </div>
      <p className="availability-note">Activate and Pause use the existing allow-listed paper-engine command pipeline. Other controls remain disabled until a strategy configuration service exists.</p>
    </section>

    <section className="dashboard-grid terminal-section">
      <article className="card span-7"><div className="section-heading compact"><div><p className="eyebrow">Explainability</p><h2>Latest signal reasoning</h2></div><span>{status.latestSignal ? new Date(status.latestSignal.observed_at).toLocaleString("en-IN") : "No observation"}</span></div><SignalExplanation signal={signal} level={activeLevel} /></article>
      <article className="card span-5"><div className="section-heading compact"><div><p className="eyebrow">Runtime</p><h2>Strategy health</h2></div></div><div className="diagnostic-list"><div><span>Engine state</span><strong>{paper.state ?? "Unavailable"}</strong></div><div><span>Feed</span><strong className={paper.feed_connected ? "good" : "warn"}>{paper.feed_connected ? "Connected" : "Waiting"}</strong></div><div><span>Constituent coverage</span><strong>{paper.constituents_fresh ?? 0} / {paper.constituents_total ?? 50}</strong></div><div><span>Latest risk verdict</span><strong>{signal ? (signal.risk.allowed ? "Allow" : "Block") : "Unavailable"}</strong></div><div><span>Selected premium</span><strong>{signal?.contract.contract ? formatNumber(signal.contract.contract.ltp) : "Unavailable"}</strong></div></div></article>
    </section>
    <section className="terminal-section card"><div className="section-heading compact"><div><p className="eyebrow">Configuration</p><h2>Versioned strategy parameters</h2></div></div><BackendUnavailable title="Runtime strategy configuration is not exposed" description="The engine already models confirmation weights, confidence thresholds, daily loss, trade limits, risk per trade, cooldown, and option-selection parameters. The web app has no read/write configuration API, so this page does not pretend that static form values are active." /></section>
    <ConfirmDialog open={confirmPause} title="Pause the paper strategy?" description="This queues STOP_PAPER_ENGINE through the existing Oracle control plane. It stops new paper processing, but does not represent a live-market kill switch or manually close an open research position." confirmLabel="Pause paper engine" busy={busy === "STOP_PAPER_ENGINE"} onCancel={() => setConfirmPause(false)} onConfirm={() => void runCommand("STOP_PAPER_ENGINE")} />
  </>;
}
