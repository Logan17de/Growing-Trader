"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/terminal/EmptyState";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { ControlStatus, PaperOrder } from "@/lib/terminalTypes";

type OrderView = "all" | "pending" | "open" | "completed" | "cancelled" | "rejected";

function orderView(order: PaperOrder): OrderView {
  const state = order.status.toUpperCase();
  if (["QUEUED", "PENDING", "SUBMITTED"].includes(state)) return "pending";
  if (["OPEN", "ACCEPTED"].includes(state)) return "open";
  if (["CLOSED", "COMPLETED", "FILLED", "FILLED_SIMULATED"].includes(state)) return "completed";
  if (state.includes("CANCEL")) return "cancelled";
  if (state.includes("REJECT") || state.includes("FAIL")) return "rejected";
  return "all";
}

export function OrdersPanel({ status }: { status: ControlStatus }) {
  const [view, setView] = useState<OrderView>("all");
  const [side, setSide] = useState("all");
  const [strategy, setStrategy] = useState("all");
  const [instrument, setInstrument] = useState("");
  const [date, setDate] = useState("");
  const strategies = useMemo(() => [...new Set(status.paperOrders.map((order) => order.strategy_id ?? "level-event"))], [status.paperOrders]);
  const orders = useMemo(() => status.paperOrders.filter((order) => {
    if (view !== "all" && orderView(order) !== view) return false;
    if (side !== "all" && order.side !== side) return false;
    if (strategy !== "all" && (order.strategy_id ?? "level-event") !== strategy) return false;
    if (instrument && !order.trading_symbol.toLowerCase().includes(instrument.toLowerCase())) return false;
    if (date && order.created_at.slice(0, 10) !== date) return false;
    return true;
  }), [date, instrument, side, status.paperOrders, strategy, view]);
  const tabs: OrderView[] = ["all", "pending", "open", "completed", "cancelled", "rejected"];
  return <section className="terminal-section card">
    <div className="section-heading compact"><div><p className="eyebrow">Lifecycle</p><h2>Paper orders</h2></div><span>{status.paperOrders.length} persisted records</span></div>
    <div className="order-tabs" role="tablist" aria-label="Order status">{tabs.map((tab) => <button type="button" role="tab" aria-selected={view === tab} className={view === tab ? "active" : ""} onClick={() => setView(tab)} key={tab}>{tab}<span>{tab === "all" ? status.paperOrders.length : status.paperOrders.filter((order) => orderView(order) === tab).length}</span></button>)}</div>
    <div className="filter-bar"><label><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label><span>Instrument</span><input placeholder="Search symbol" value={instrument} onChange={(event) => setInstrument(event.target.value)} /></label><label><span>Side</span><select value={side} onChange={(event) => setSide(event.target.value)}><option value="all">All sides</option><option value="BUY">BUY</option><option value="SELL">SELL</option></select></label><label><span>Strategy</span><select value={strategy} onChange={(event) => setStrategy(event.target.value)}><option value="all">All strategies</option>{strategies.map((value) => <option value={value} key={value}>{value}</option>)}</select></label></div>
    {orders.length === 0 ? <EmptyState icon="orders" title="No orders match these filters" description={status.paperOrders.length ? "Adjust the lifecycle or field filters to see persisted paper orders." : "No paper order has been persisted by the execution service."} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Order ID</th><th>Instrument</th><th>Type</th><th>Side</th><th>Qty</th><th>Requested</th><th>Average fill</th><th>Status</th><th>Strategy</th><th>Version</th><th>Timestamp</th><th>Slippage</th><th>Exit reason</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><span className="mono-id" title={order.broker_order_id ?? order.id}>{order.broker_order_id ?? `PAPER-${order.id.slice(0, 8)}`}</span></td><td><strong>{order.trading_symbol}</strong></td><td>{order.option_type ?? (order.trading_symbol.endsWith("CE") ? "CE" : order.trading_symbol.endsWith("PE") ? "PE" : "—")}</td><td><span className={`side-badge ${order.side.toLowerCase()}`}>{order.side}</span></td><td className="numeric">{formatNumber(order.quantity, 0)}</td><td className="numeric">{formatNumber(order.requested_price ?? order.entry_price)}</td><td className="numeric">{formatNumber(order.average_fill ?? order.entry_price)}</td><td><span className={`status-badge ${orderView(order) === "rejected" ? "bad" : orderView(order) === "completed" ? "good" : "warn"}`}><span className={`status-dot ${orderView(order) === "rejected" ? "bad" : orderView(order) === "completed" ? "good" : "warn"}`} />{order.status}</span></td><td>{order.strategy_id ?? "level-event"}</td><td className="numeric">{order.strategy_version ?? "—"}</td><td>{formatDateTime(order.created_at)}</td><td className="numeric">{order.slippage_bps !== null && order.slippage_bps !== undefined ? `${formatNumber(order.slippage_bps, 2)} bps` : "—"}</td><td>{order.exit_reason ?? "—"}</td></tr>)}</tbody></table></div>}
    <p className="availability-note">Requested and simulated fill prices, strategy version, slippage assumptions and exit reason now come from the paper order metadata. These are simulation fields, not broker execution reports.</p>
  </section>;
}
