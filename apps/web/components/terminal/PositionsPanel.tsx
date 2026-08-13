"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/terminal/ConfirmDialog";
import { EmptyState } from "@/components/terminal/EmptyState";
import { Icon } from "@/components/terminal/Icon";
import { MetricCard } from "@/components/terminal/MetricCard";
import { jsonRequest } from "@/lib/controlClient";
import { formatCurrency, formatDateTime, formatDuration, formatNumber, formatPercent } from "@/lib/format";
import type { ControlCommand, ControlStatus } from "@/lib/terminalTypes";

export function PositionsPanel({ status, refresh }: { status: ControlStatus; refresh: () => Promise<void> }) {
  const position = status.paperEngine.open_paper_position;
  const paper = status.paperEngine;
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmExit, setConfirmExit] = useState(false);
  const [partialQty, setPartialQty] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [activation, setActivation] = useState(String(paper.trailing_activation_pct ?? 0.10));
  const [drawdown, setDrawdown] = useState(String(paper.trailing_drawdown_pct ?? 0.05));
  const deployed = position?.entry_price && position.quantity ? position.entry_price * position.quantity : null;

  async function command(commandName: ControlCommand, payload: Record<string, unknown> = {}) {
    setBusy(commandName); setNotice("");
    try {
      const result = await jsonRequest<{ duplicate?: boolean }>("/api/control/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: commandName, payload }) });
      setNotice(result.duplicate ? "That paper action is already queued or running." : `${commandName.replaceAll("_", " ")} queued.`);
      await refresh();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Paper position action failed"); }
    finally { setBusy(""); setConfirmExit(false); }
  }

  const canAct = Boolean(position && status.worker.online && !busy);
  return <>
    {notice && <div className="notice" role="status"><Icon name="activity" />{notice}</div>}
    <section className="terminal-metric-grid four">
      <MetricCard label="Open positions" value={position ? "1" : "0"} detail="One-position rule enforced by Python risk engine" icon="positions" />
      <MetricCard label="Premium deployed" value={formatCurrency(deployed)} detail="Simulated entry fill × remaining quantity" unavailable={deployed === null} />
      <MetricCard label="Unrealized P&L" value={formatCurrency(paper.unrealized_pnl)} unavailable={typeof paper.unrealized_pnl !== "number"} tone={(paper.unrealized_pnl ?? 0) >= 0 ? "positive" : "negative"} />
      <MetricCard label="Current option LTP" value={formatNumber(paper.current_option_ltp)} detail="Latest Groww option-chain mark" unavailable={typeof paper.current_option_ltp !== "number"} />
    </section>
    <section className="terminal-section card">
      <div className="section-heading compact"><div><p className="eyebrow">Open inventory</p><h2>Positions</h2></div><span>Paper execution · managed exits</span></div>
      {!position ? <EmptyState icon="positions" title="No open paper position" description="A position appears only when a persisted signal passes the engine's risk checks and the paper runner opens it." /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Instrument</th><th>Qty</th><th>Average entry</th><th>LTP</th><th>Unrealized P&amp;L</th><th>Stop</th><th>Target</th><th>Opened</th><th>Holding</th></tr></thead><tbody><tr><td><strong>{position.trading_symbol ?? "Unavailable"}</strong></td><td className="numeric">{formatNumber(position.quantity, 0)}</td><td className="numeric">{formatNumber(position.entry_price)}</td><td className="numeric">{formatNumber(paper.current_option_ltp)}</td><td className={`numeric ${(paper.unrealized_pnl ?? 0) >= 0 ? "good" : "bad"}`}>{formatCurrency(paper.unrealized_pnl)}</td><td className="numeric">{formatNumber(paper.stop_price)} <small>{paper.stop_source}</small></td><td className="numeric">{formatNumber(paper.target_price)}</td><td>{formatDateTime(position.opened_at)}</td><td>{formatDuration(position.opened_at)}</td></tr></tbody></table></div>}
    </section>
    <section className="dashboard-grid terminal-section">
      <article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Protection</p><h2>Stops, targets &amp; Greeks</h2></div></div><div className="diagnostic-list"><div><span>Stop price</span><strong>{formatNumber(paper.stop_price)}</strong></div><div><span>Profit target</span><strong>{formatNumber(paper.target_price)}</strong></div><div><span>Trailing</span><strong>{paper.trailing_enabled ? `On · ${formatPercent(paper.trailing_drawdown_pct)}` : "Off"}</strong></div><div><span>Delta</span><strong>{formatNumber(paper.current_greeks?.delta, 3)}</strong></div><div><span>Gamma</span><strong>{formatNumber(paper.current_greeks?.gamma, 5)}</strong></div><div><span>Theta</span><strong>{formatNumber(paper.current_greeks?.theta, 2)}</strong></div><div><span>IV</span><strong>{formatNumber(paper.current_greeks?.iv, 2)}</strong></div></div></article>
      <article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Actions</p><h2>Position controls</h2></div></div><div className="action-grid"><button className="danger" type="button" onClick={() => setConfirmExit(true)} disabled={!canAct}>Exit position</button><div className="field"><span>Partial quantity</span><input type="number" min="1" step="1" value={partialQty} onChange={(event) => setPartialQty(event.target.value)} placeholder="Lot multiple" /></div><button className="secondary" type="button" onClick={() => void command("PARTIAL_EXIT_PAPER_POSITION", { quantity: Number(partialQty) })} disabled={!canAct || !partialQty}>Partial exit</button><div className="field"><span>Option stop price</span><input type="number" min="0.01" step="0.05" value={stopPrice} onChange={(event) => setStopPrice(event.target.value)} placeholder={paper.stop_price ? String(paper.stop_price.toFixed(2)) : "Premium"} /></div><button className="secondary" type="button" onClick={() => void command("SET_PAPER_STOP", { stopPrice: Number(stopPrice) })} disabled={!canAct || !stopPrice}>Move stop</button></div><div className="form-grid two" style={{ marginTop: 12 }}><label className="field"><span>Trailing activation</span><input type="number" min="0" max="1" step="0.01" value={activation} onChange={(event) => setActivation(event.target.value)} /></label><label className="field"><span>Trailing drawdown</span><input type="number" min="0.01" max="1" step="0.01" value={drawdown} onChange={(event) => setDrawdown(event.target.value)} /></label></div><div className="strategy-actions"><button className="secondary" type="button" onClick={() => void command("SET_PAPER_TRAILING", { enabled: true, activationPct: Number(activation), drawdownPct: Number(drawdown) })} disabled={!canAct}>Enable / update trailing</button><button className="secondary" type="button" onClick={() => void command("SET_PAPER_TRAILING", { enabled: false })} disabled={!canAct}>Disable trailing</button></div><p className="availability-note">All actions affect only the persisted paper position. No Groww live order is placed.</p></article>
    </section>
    <ConfirmDialog open={confirmExit} title="Exit the paper position?" description="Oracle will take the latest available option mark, apply the configured paper slippage/fee model, close the persisted position and record the realized paper trade." confirmLabel="Exit paper position" busy={busy === "EXIT_PAPER_POSITION"} onCancel={() => setConfirmExit(false)} onConfirm={() => void command("EXIT_PAPER_POSITION")} />
  </>;
}
