"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/terminal/EmptyState";
import { Icon } from "@/components/terminal/Icon";
import { jsonRequest } from "@/lib/controlClient";
import { formatDateTime } from "@/lib/format";
import type { ControlStatus, RuntimeEvent } from "@/lib/terminalTypes";

type ActivityItem = { id: string; timestamp: string | null; severity: "info" | "success" | "warning" | "critical"; component: string; title: string; detail: string; instrument?: string };

function currentIssues(status: ControlStatus): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const [component, detail] of Object.entries(status.controlPlane.errors)) items.push({ id: `control-${component}`, timestamp: null, severity: "critical", component, title: "Control-plane query failed", detail });
  if (status.worker.last_error) items.push({ id: "worker-error", timestamp: status.worker.last_heartbeat ?? null, severity: "critical", component: "oracle", title: "Oracle worker error", detail: status.worker.last_error });
  if (status.paperEngine.last_error) items.push({ id: "paper-error", timestamp: status.paperEngine.statusUpdatedAt ?? null, severity: "critical", component: "paper-engine", title: "Paper engine error", detail: status.paperEngine.last_error });
  return items;
}

export function ActivityPanel({ status }: { status: ControlStatus }) {
  const [severity, setSeverity] = useState("all");
  const [component, setComponent] = useState("all");
  const [search, setSearch] = useState("");
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const load = async () => {
      try { const result = await jsonRequest<{ events: RuntimeEvent[] }>("/api/control/activity?limit=500"); setEvents(result.events); setLoadError(""); }
      catch (reason) { setLoadError(reason instanceof Error ? reason.message : "Could not load runtime events"); }
    };
    void load(); const timer = window.setInterval(() => void load(), 10_000); return () => window.clearInterval(timer);
  }, []);

  const allItems = useMemo(() => {
    const persisted: ActivityItem[] = events.map((event) => ({ id: event.id, timestamp: event.observed_at, severity: event.severity, component: event.component, title: event.message, detail: event.detail || event.event_type, instrument: event.instrument ?? undefined }));
    return [...currentIssues(status), ...persisted].sort((a, b) => Date.parse(b.timestamp ?? "") - Date.parse(a.timestamp ?? ""));
  }, [events, status]);
  const items = allItems.filter((item) => (severity === "all" || item.severity === severity) && (component === "all" || item.component === component) && (!search || `${item.title} ${item.detail} ${item.instrument ?? ""}`.toLowerCase().includes(search.toLowerCase())));
  const components = [...new Set(allItems.map((item) => item.component))];
  const alertPrefs = status.terminalPreferences?.alert_preferences ?? { info: true, success: true, warning: true, critical: true };
  const alerts = items.filter((item) => alertPrefs[item.severity] !== false);

  return <>
    {loadError && <div className="notice error" role="alert">{loadError}</div>}
    <section className="dashboard-grid terminal-section">
      <article className="card span-5"><div className="section-heading compact"><div><p className="eyebrow">User alerts</p><h2>Operational alerts</h2></div><span>Persisted runtime events</span></div>{alerts.length === 0 ? <EmptyState icon="bell" title="No alerts match" description="No enabled runtime alert matches the active filters." /> : <div className="alert-list">{alerts.slice(0, 12).map((item) => <div className={`alert-item ${item.severity}`} key={item.id}><span className="alert-symbol"><Icon name={item.severity === "critical" ? "shield" : item.severity === "success" ? "check" : "bell"} /></span><div><div><strong>{item.title}</strong><span>{item.severity}</span></div><p>{item.detail}</p><small>{item.timestamp ? formatDateTime(item.timestamp) : "Timestamp unavailable"} · {item.component}{item.instrument ? ` · ${item.instrument}` : ""}</small></div></div>)}</div>}</article>
      <article className="card span-7"><div className="section-heading compact"><div><p className="eyebrow">System visibility</p><h2>Trading log viewer</h2></div><span>Persisted · sanitized · no secrets</span></div><div className="filter-bar logs"><label><span>Severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All severities</option><option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label><label><span>Component</span><select value={component} onChange={(event) => setComponent(event.target.value)}><option value="all">All components</option>{components.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label><span>Search / instrument</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Signal, reason, symbol" /></label></div>{items.length === 0 ? <EmptyState icon="terminal" title="No log entries match" description="Adjust the filters to view persisted Oracle and strategy events." /> : <div className="log-viewer">{items.map((item) => <div key={`log-${item.id}`}><time>{item.timestamp ? new Date(item.timestamp).toLocaleTimeString("en-IN", { hour12: false }) : "--:--:--"}</time><span className={`log-level ${item.severity}`}>{item.severity}</span><span>{item.component}</span><strong>{item.title}</strong><p>{item.detail}</p></div>)}</div>}<p className="availability-note">The managed Oracle runtime now persists paper-engine, signal, risk, position and replay events. Alert-severity preferences are stored in terminal settings and applied to the alert pane.</p></article>
    </section>
  </>;
}
