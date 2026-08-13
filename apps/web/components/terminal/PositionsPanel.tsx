"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/terminal/EmptyState";
import { MetricCard } from "@/components/terminal/MetricCard";
import { jsonRequest } from "@/lib/controlClient";
import { formatCurrency, formatDateTime, formatDuration, formatNumber, formatPercent } from "@/lib/format";
import type { ControlCommand, ControlStatus } from "@/lib/terminalTypes";

export function PositionsPanel({ status, refresh }: { status: ControlStatus; refresh?: () => Promise<void> }) {
  const position = status.paperEngine.open_paper_position;
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [target, setTarget] = useState("");
  const [trailActivation, setTrailActivation] = useState("");
  const [trailDrawdown, setTrailDrawdown] = useState("");
  useEffect(() => {
    setStopLoss(position?.stop_loss_pct != null ? String(position.stop_loss_pct * 100) : "");
    setTarget(position?.profit_target_pct != null ? String(position.profit_target_pct * 100) : "");
    setTrailActivation(position?.trailing_activation_pct != null ? String(position.trailing_activation_pct * 100) : "");
    setTrailDrawdown(position?.trailing_drawdown_pct != null ? String(position.trailing_drawdown_pct * 100) : "");
  }, [position?.trading_symbol, position?.stop_loss_pct, position?.profit_target_pct, position?.trailing_activation_pct, position?.trailing_drawdown_pct]);

  async function command(commandName: ControlCommand, payload: Record<string, unknown> = {}) {
    setBusy(commandName); setNotice("");
    try {
      await jsonRequest("/api/control/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: commandName, payload }) });
      setNotice(`${commandName.replaceAll("_", " ")} queued.`); await refresh?.();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Position command failed"); }
    finally { setBusy(""); }
  }
  async function saveProtection() {
    const pct = (value: string) => value.trim() === "" ? null : Number(value) / 100;
    await command("UPDATE_PAPER_POSITION", { stop_loss_pct: pct(stopLoss), profit_target_pct: pct(target), trailing_activation_pct: pct(trailActivation), trailing_drawdown_pct: pct(trailDrawdown) });
  }

  const deployed = position?.entry_price && position.quantity ? position.entry_price * position.quantity : null;
  return <>
    {notice && <div className="notice" role="status">{notice}</div>}
    <section className="terminal-metric-grid four">
      <MetricCard label="Open positions" value={position ? "1" : "0"} detail="One-position rule enforced by Python risk engine" icon="positions" />
      <MetricCard label="Premium deployed" value={formatCurrency(deployed)} detail="Entry premium × current quantity" unavailable={deployed === null} />
      <MetricCard label="Unrealized P&L" value={formatCurrency(position?.unrealized_pnl)} unavailable={position?.unrealized_pnl == null} tone={(position?.unrealized_pnl ?? 0) >= 0 ? "positive" : "negative"} />
      <MetricCard label="Execution mode" value="PAPER" detail="No live broker order placement" tone="warning" icon="shield" />
    </section>
    <section className="terminal-section card">
      <div className="section-heading compact"><div><p className="eyebrow">Open inventory</p><h2>Positions</h2></div><span>Current option mark from Oracle</span></div>
      {!position ? <EmptyState icon="positions" title="No open paper position" description="A position appears when a persisted signal passes risk checks and the paper runner opens it." /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Instrument</th><th>Qty</th><th>Entry</th><th>LTP</th><th>Unrealized P&amp;L</th><th>Opened</th><th>Holding</th><th>Mode</th></tr></thead><tbody><tr><td><strong>{position.trading_symbol ?? "Unavailable"}</strong></td><td className="numeric">{formatNumber(position.quantity, 0)}</td><td className="numeric">{formatNumber(position.entry_price)}</td><td className="numeric">{formatNumber(position.current_price)}</td><td className={`numeric ${(position.unrealized_pnl ?? 0) >= 0 ? "good" : "bad"}`}>{formatCurrency(position.unrealized_pnl)}</td><td>{formatDateTime(position.opened_at)}</td><td>{formatDuration(position.opened_at)}</td><td><span className="status-badge warn"><span className="status-dot amber" />Paper</span></td></tr></tbody></table></div>}
    </section>
    <section className="dashboard-grid terminal-section">
      <article className="card span-6">
        <div className="section-heading compact"><div><p className="eyebrow">Protection</p><h2>Stops, targets &amp; Greeks</h2></div></div>
        {position ? <><div className="diagnostic-list">
          <div><span>Stop premium</span><strong>{formatNumber(position.stop_price)}</strong></div><div><span>Target premium</span><strong>{formatNumber(position.target_price)}</strong></div>
          <div><span>Best premium</span><strong>{formatNumber(position.best_price)}</strong></div><div><span>Delta / IV</span><strong>{formatNumber(position.greeks?.delta)} / {position.greeks?.iv != null ? `${formatNumber(position.greeks.iv)}%` : "—"}</strong></div>
          <div><span>Gamma</span><strong>{formatNumber(position.greeks?.gamma, 4)}</strong></div><div><span>Theta</span><strong>{formatNumber(position.greeks?.theta)}</strong></div>
        </div><div className="form-grid compact"><label className="field"><span>Stop loss %</span><input type="number" min="0" max="100" step="0.1" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} /></label><label className="field"><span>Profit target %</span><input type="number" min="0" max="100" step="0.1" value={target} onChange={(e) => setTarget(e.target.value)} /></label><label className="field"><span>Trail activation %</span><input type="number" min="0" max="100" step="0.1" value={trailActivation} onChange={(e) => setTrailActivation(e.target.value)} /></label><label className="field"><span>Trail drawdown %</span><input type="number" min="0" max="100" step="0.1" value={trailDrawdown} onChange={(e) => setTrailDrawdown(e.target.value)} /></label></div><button className="primary" disabled={Boolean(busy)} onClick={() => void saveProtection()}>Save protection</button></> : <EmptyState icon="shield" title="No active protection to edit" description="Open a paper position to override its stop, target, and trailing parameters." />}
      </article>
      <article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Actions</p><h2>Position controls</h2></div></div><div className="action-grid"><button className="danger" disabled={!position || Boolean(busy)} onClick={() => void command("EXIT_PAPER_POSITION", { fraction: 1 })}>Exit position</button><button className="secondary" disabled={!position || Boolean(busy)} onClick={() => void command("EXIT_PAPER_POSITION", { fraction: 0.5 })}>Exit 50%</button><button className="secondary" disabled={!position || Boolean(busy)} onClick={() => { setStopLoss("4"); void command("UPDATE_PAPER_POSITION", { stop_loss_pct: 0.04 }); }}>Tighten stop</button><button className="secondary" disabled={!position || Boolean(busy)} onClick={() => void command("UPDATE_PAPER_POSITION", { trailing_activation_pct: 0, trailing_drawdown_pct: 0.03 })}>Trail now</button></div><p className="availability-note">All actions are paper-only. Oracle executes them against the next available option-chain mark; no Groww order is sent.</p></article>
    </section>
  </>;
}
