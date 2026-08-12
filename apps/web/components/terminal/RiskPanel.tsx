"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/terminal/ConfirmDialog";
import { BackendUnavailable } from "@/components/terminal/EmptyState";
import { Icon } from "@/components/terminal/Icon";
import { MetricCard } from "@/components/terminal/MetricCard";
import { jsonRequest } from "@/lib/controlClient";
import { formatCurrency, formatNumber } from "@/lib/format";
import { calculatePaperAnalytics } from "@/lib/terminalAnalytics";
import type { ControlStatus } from "@/lib/terminalTypes";

export function RiskPanel({ status, refresh }: { status: ControlStatus; refresh: () => Promise<void> }) {
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const analytics = calculatePaperAnalytics(status.paperTrades, status.paperOrders);
  const position = status.paperEngine.open_paper_position;
  const exposure = position?.entry_price && position.quantity ? position.entry_price * position.quantity : null;
  const signal = status.latestSignal?.payload;
  async function stopPaperEngine() {
    setBusy(true);
    setNotice("");
    try {
      const result = await jsonRequest<{ duplicate?: boolean }>("/api/control/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: "STOP_PAPER_ENGINE" }) });
      setNotice(result.duplicate ? "Stop command already queued or running." : "Paper-engine stop queued through the Oracle control plane.");
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Could not stop the paper engine");
    } finally {
      setBusy(false);
      setConfirmStop(false);
    }
  }
  return <>
    {notice && <div className="notice" role="status"><Icon name="shield" />{notice}</div>}
    <section className="terminal-metric-grid six">
      <MetricCard label="Current exposure" value={formatCurrency(exposure)} detail="Open paper premium at entry" unavailable={exposure === null} icon="shield" />
      <MetricCard label="Positions" value={position ? "1" : "0"} detail="Python engine enforces a one-position rule" />
      <MetricCard label="Trades today" value={String(analytics.tradesToday)} detail="Persisted paper orders" />
      <MetricCard label="Realized P&L today" value={formatCurrency(analytics.todayPnl)} tone={(analytics.todayPnl ?? 0) >= 0 ? "positive" : "negative"} unavailable={analytics.todayPnl === null} />
      <MetricCard label="Latest risk decision" value={signal ? (signal.risk.allowed ? "ALLOW" : "BLOCK") : undefined} detail={signal?.risk.reason} tone={signal?.risk.allowed ? "positive" : "warning"} unavailable={!signal} />
      <MetricCard label="Risk-approved quantity" value={signal ? formatNumber(signal.risk.quantity, 0) : undefined} detail="Latest persisted signal" unavailable={!signal} />
    </section>
    <section className="dashboard-grid terminal-section">
      <article className="card span-7"><div className="section-heading compact"><div><p className="eyebrow">Risk controls</p><h2>Global limits</h2></div><span>Runtime service required</span></div><BackendUnavailable title="Risk limits cannot be read or edited from the web app" description="The Python RiskEngine enforces account equity, confidence, constituent coverage, data age, one-position, trade-count, consecutive-loss, daily-loss, cooldown, and premium-budget checks. No authenticated configuration contract exposes their active values." /><div className="risk-limit-grid">{["Maximum daily loss","Daily profit lock","Maximum trades / day","Trades / strategy","Concurrent positions","Capital exposure","Risk / trade","Consecutive-loss cutoff","Maximum quantity","Maximum premium","Trading window"].map((label) => <div key={label}><span>{label}</span><strong>Unavailable</strong></div>)}</div></article>
      <article className="card span-5 emergency-card"><div className="emergency-heading"><div className="dialog-icon"><Icon name="shield" /></div><div><p className="eyebrow">Emergency controls</p><h2>Execution safety</h2></div></div><p className="muted">Stopping the paper engine is the only strategy-level safety command currently implemented. It follows the existing control-plane queue and duplicate-command guard.</p><button className="danger button-wide" type="button" onClick={() => setConfirmStop(true)} disabled={!status.worker.online || !status.paperEngine.running || busy}><span>Pause all paper strategies</span><Icon name="stop" /></button><button className="kill-switch" type="button" disabled><Icon name="shield" /><span><strong>KILL SWITCH</strong><small>Backend integration unavailable</small></span></button><p className="availability-note">Full kill behavior—prevent new entries, cancel pending orders, optionally close positions—must be implemented inside the order/risk pipeline before this control can be enabled.</p></article>
    </section>
    <section className="terminal-section card"><div className="section-heading compact"><div><p className="eyebrow">Exposure</p><h2>Strategy &amp; instrument allocation</h2></div></div>{position ? <div className="exposure-bars"><div><div><span>Level-event strategy</span><strong>{formatCurrency(exposure)}</strong></div><span><i style={{ width: "100%" }} /></span></div><div><div><span>{position.trading_symbol}</span><strong>{formatCurrency(exposure)}</strong></div><span><i style={{ width: "100%" }} /></span></div></div> : <BackendUnavailable title="No current exposure to allocate" description="There is no open paper position. Risk-budget percentages remain unavailable because account equity and configured limits are not exposed." />}</section>
    <ConfirmDialog open={confirmStop} title="Pause all paper processing?" description="This sends STOP_PAPER_ENGINE once through the existing command queue. It prevents further paper strategy processing after the Oracle worker handles the command; it does not close the current research position." confirmLabel="Pause paper engine" busy={busy} onCancel={() => setConfirmStop(false)} onConfirm={() => void stopPaperEngine()} />
  </>;
}
