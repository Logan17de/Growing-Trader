"use client";

import { FormEvent, useState } from "react";
import { BackendUnavailable } from "@/components/terminal/EmptyState";
import { Icon } from "@/components/terminal/Icon";
import { jsonRequest } from "@/lib/controlClient";
import { formatDateTime } from "@/lib/format";
import type { ControlStatus } from "@/lib/terminalTypes";

export function SettingsPanel({ status, refresh }: { status: ControlStatus; refresh: () => Promise<void> }) {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function saveCredentials(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      await jsonRequest("/api/control/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey, apiSecret }) });
      setApiKey(""); setApiSecret("");
      setNotice("Groww credentials encrypted and saved. Authentication status was intentionally reset until the Oracle worker verifies them.");
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Could not save credentials");
    } finally { setBusy(false); }
  }
  return <>
    {notice && <div className="notice" role="status"><Icon name="shield" />{notice}</div>}
    <section className="settings-grid terminal-section">
      <article className="card settings-card"><div className="settings-heading"><div className="card-icon"><Icon name="key" /></div><div><p className="eyebrow">Broker</p><h2>Groww connectivity</h2></div><span className={`status-badge ${status.worker.groww_authenticated ? "good" : "warn"}`}><span className={`status-dot ${status.worker.groww_authenticated ? "good" : "warn"}`} />{status.worker.groww_authenticated ? "Verified" : status.credentials.configured ? "Saved · unverified" : "Not configured"}</span></div><div className="diagnostic-list"><div><span>Credentials</span><strong>{status.credentials.configured ? "Encrypted at rest" : "Missing"}</strong></div><div><span>Last updated</span><strong>{formatDateTime(status.credentials.updatedAt)}</strong></div><div><span>Market-data status</span><strong>{status.worker.market_data_status ?? "Unknown"}</strong></div></div><form className="credential-form settings-credentials" onSubmit={saveCredentials}><label className="field"><span>New API key</span><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Never displayed after save" required /></label><label className="field"><span>New API secret</span><input type="password" autoComplete="off" value={apiSecret} onChange={(event) => setApiSecret(event.target.value)} placeholder="Never displayed after save" required /></label><button className="primary" disabled={busy}>{busy ? <Icon name="refresh" className="spin" /> : <Icon name="lock" />}{busy ? "Encrypting…" : "Save credentials"}</button></form><p className="availability-note">Credentials are encrypted server-side and are never returned through status APIs or rendered after save.</p></article>
      <article className="card settings-card"><div className="settings-heading"><div className="card-icon"><Icon name="chart" /></div><div><p className="eyebrow">Trading</p><h2>Execution defaults</h2></div></div><BackendUnavailable title="No trading settings service" description="Default instrument, quantity, product/order defaults, and market hours remain owned by worker configuration. The UI cannot persist them." /></article>
      <article className="card settings-card"><div className="settings-heading"><div className="card-icon"><Icon name="shield" /></div><div><p className="eyebrow">Risk</p><h2>Global risk defaults</h2></div></div><BackendUnavailable title="Risk configuration unavailable" description="Active StrategyParams are not exposed through an authenticated read/write service." /></article>
      <article className="card settings-card"><div className="settings-heading"><div className="card-icon"><Icon name="bell" /></div><div><p className="eyebrow">Notifications</p><h2>Alert preferences</h2></div></div><BackendUnavailable title="Notification delivery is not implemented" description="No preference storage or email, push, SMS, or webhook delivery service exists in the current repository." /></article>
      <article className="card settings-card"><div className="settings-heading"><div className="card-icon"><Icon name="database" /></div><div><p className="eyebrow">Data</p><h2>Market-data source</h2></div></div><div className="diagnostic-list"><div><span>Source</span><strong>Groww</strong></div><div><span>Quote refresh</span><strong>{status.paperEngine.last_quote_scan ? formatDateTime(status.paperEngine.last_quote_scan) : "Unavailable"}</strong></div><div><span>Option refresh</span><strong>{status.paperEngine.last_option_refresh ? formatDateTime(status.paperEngine.last_option_refresh) : "Unavailable"}</strong></div><div><span>Data age</span><strong>{typeof status.paperEngine.data_age_seconds === "number" ? `${status.paperEngine.data_age_seconds.toFixed(1)}s` : "Unavailable"}</strong></div></div></article>
      <article className="card settings-card"><div className="settings-heading"><div className="card-icon"><Icon name="settings" /></div><div><p className="eyebrow">Application</p><h2>Terminal preferences</h2></div></div><div className="diagnostic-list"><div><span>Appearance</span><strong>Graphite dark</strong></div><div><span>Timezone</span><strong>Browser local · Asia/Kolkata expected</strong></div><div><span>Number format</span><strong>Indian locale · tabular</strong></div><div><span>Refresh</span><strong>3 seconds</strong></div></div><p className="availability-note">Display preferences are currently fixed by the UI design system; persistence is not implemented.</p></article>
    </section>
  </>;
}
