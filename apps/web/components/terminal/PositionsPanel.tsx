import { BackendUnavailable, EmptyState } from "@/components/terminal/EmptyState";
import { MetricCard } from "@/components/terminal/MetricCard";
import { formatCurrency, formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import type { ControlStatus } from "@/lib/terminalTypes";

export function PositionsPanel({ status }: { status: ControlStatus }) {
  const position = status.paperEngine.open_paper_position;
  const deployed = position?.entry_price && position.quantity ? position.entry_price * position.quantity : null;
  return <>
    <section className="terminal-metric-grid four">
      <MetricCard label="Open positions" value={position ? "1" : "0"} detail="One-position rule enforced by Python risk engine" icon="positions" />
      <MetricCard label="Premium deployed" value={formatCurrency(deployed)} detail="Entry premium × quantity" unavailable={deployed === null} />
      <MetricCard label="Unrealized P&L" unavailable detail="Current option LTP is not exposed in position status" tone="neutral" />
      <MetricCard label="Execution mode" value="PAPER" detail="No live order placement implementation" tone="warning" icon="shield" />
    </section>
    <section className="terminal-section card">
      <div className="section-heading compact"><div><p className="eyebrow">Open inventory</p><h2>Positions</h2></div><span>Separate from order lifecycle</span></div>
      {!position ? <EmptyState icon="positions" title="No open paper position" description="A position appears only when a persisted signal passes the engine's risk checks and the paper runner opens it." /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Instrument</th><th>Qty</th><th>Average entry</th><th>LTP</th><th>Unrealized P&amp;L</th><th>Opened</th><th>Holding</th><th>Mode</th></tr></thead><tbody><tr><td><strong>{position.trading_symbol ?? "Unavailable"}</strong></td><td className="numeric">{formatNumber(position.quantity, 0)}</td><td className="numeric">{formatNumber(position.entry_price)}</td><td className="unavailable-cell">Unavailable</td><td className="unavailable-cell">Unavailable</td><td>{formatDateTime(position.opened_at)}</td><td>{formatDuration(position.opened_at)}</td><td><span className="status-badge warn"><span className="status-dot amber" />Paper</span></td></tr></tbody></table></div>}
    </section>
    <section className="dashboard-grid terminal-section">
      <article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Protection</p><h2>Stops, targets &amp; Greeks</h2></div></div><BackendUnavailable title="Position protection fields are not in the current contract" description="Stop loss, target, trailing stop, Greeks, and current option marks are not persisted with an open paper position." /></article>
      <article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Actions</p><h2>Position controls</h2></div></div><div className="action-grid"><button className="danger" disabled>Exit position</button><button className="secondary" disabled>Partial exit</button><button className="secondary" disabled>Move stop</button><button className="secondary" disabled>Trailing stop</button></div><p className="availability-note">Disabled: the current paper execution service auto-closes research positions after its configured mark horizon and exposes no manual exit command.</p></article>
    </section>
  </>;
}
