"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/terminal/EmptyState";
import { Icon } from "@/components/terminal/Icon";
import { formatDateTime } from "@/lib/format";
import type { ControlStatus } from "@/lib/terminalTypes";

type ActivityItem = { id: string; timestamp: string | null; severity: "info" | "success" | "warning" | "critical"; component: string; title: string; detail: string; instrument?: string };

function buildActivity(status: ControlStatus): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const [component, detail] of Object.entries(status.controlPlane.errors)) items.push({ id: `control-${component}`, timestamp: null, severity: "critical", component, title: "Control-plane query failed", detail });
  if (status.worker.last_error) items.push({ id: "worker-error", timestamp: status.worker.last_heartbeat ?? null, severity: "critical", component: "oracle", title: "Oracle worker error", detail: status.worker.last_error });
  if (status.paperEngine.last_error) items.push({ id: "paper-error", timestamp: status.paperEngine.statusUpdatedAt ?? null, severity: "critical", component: "paper-engine", title: "Paper engine error", detail: status.paperEngine.last_error });
  if (status.latestCommand) items.push({ id: status.latestCommand.id, timestamp: status.latestCommand.completed_at ?? status.latestCommand.created_at, severity: status.latestCommand.status === "failed" ? "critical" : status.latestCommand.status === "completed" ? "success" : "info", component: "control-plane", title: status.latestCommand.command.replaceAll("_", " "), detail: status.latestCommand.error ?? `Command status: ${status.latestCommand.status}` });
  for (const signal of status.recentSignals) items.push({ id: `signal-${signal.observed_at}`, timestamp: signal.observed_at, severity: signal.payload.risk.allowed ? "success" : signal.payload.event === "uncertain" || signal.payload.event === "no_level" ? "info" : "warning", component: "signal-engine", title: `${signal.payload.event} · ${signal.payload.direction}`.toUpperCase(), detail: signal.payload.risk.reason, instrument: signal.payload.contract.contract?.trading_symbol });
  return items.sort((a, b) => Date.parse(b.timestamp ?? "") - Date.parse(a.timestamp ?? ""));
}

export function ActivityPanel({ status }: { status: ControlStatus }) {
  const [severity, setSeverity] = useState("all");
  const [component, setComponent] = useState("all");
  const [search, setSearch] = useState("");
  const allItems = useMemo(() => buildActivity(status), [status]);
  const items = allItems.filter((item) => (severity === "all" || item.severity === severity) && (component === "all" || item.component === component) && (!search || `${item.title} ${item.detail} ${item.instrument ?? ""}`.toLowerCase().includes(search.toLowerCase())));
  const components = [...new Set(allItems.map((item) => item.component))];
  return <>
    <section className="dashboard-grid terminal-section">
      <article className="card span-5"><div className="section-heading compact"><div><p className="eyebrow">User alerts</p><h2>Operational alerts</h2></div><span>Current snapshots</span></div>{items.length === 0 ? <EmptyState icon="bell" title="No alerts match" description="No persisted signal or current system issue matches these filters." /> : <div className="alert-list">{items.slice(0, 10).map((item) => <div className={`alert-item ${item.severity}`} key={item.id}><span className="alert-symbol"><Icon name={item.severity === "critical" ? "shield" : item.severity === "success" ? "check" : "bell"} /></span><div><div><strong>{item.title}</strong><span>{item.severity}</span></div><p>{item.detail}</p><small>{item.timestamp ? formatDateTime(item.timestamp) : "Timestamp unavailable"} · {item.component}{item.instrument ? ` · ${item.instrument}` : ""}</small></div></div>)}</div>}</article>
      <article className="card span-7"><div className="section-heading compact"><div><p className="eyebrow">System visibility</p><h2>Trading log viewer</h2></div><span>Sanitized · no secrets</span></div><div className="filter-bar logs"><label><span>Severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All severities</option><option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label><label><span>Component</span><select value={component} onChange={(event) => setComponent(event.target.value)}><option value="all">All components</option>{components.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label><span>Search / instrument</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Signal, reason, symbol" /></label></div>{items.length === 0 ? <EmptyState icon="terminal" title="No log entries match" description="Adjust the filters to view authenticated snapshots." /> : <div className="log-viewer">{items.map((item) => <div key={`log-${item.id}`}><time>{item.timestamp ? new Date(item.timestamp).toLocaleTimeString("en-IN", { hour12: false }) : "--:--:--"}</time><span className={`log-level ${item.severity}`}>{item.severity}</span><span>{item.component}</span><strong>{item.title}</strong><p>{item.detail}</p></div>)}</div>}<p className="availability-note">This is a sanitized activity projection from recent signals, the latest command, and current errors. The backend does not yet persist a full step-by-step system log stream or user alert preferences.</p></article>
    </section>
  </>;
}
