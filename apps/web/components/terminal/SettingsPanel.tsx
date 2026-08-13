"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/terminal/Icon";
import { jsonRequest } from "@/lib/controlClient";
import { formatDateTime } from "@/lib/format";
import type { ControlStatus, TerminalConfig } from "@/lib/terminalTypes";

const ENGINE_KEYS = ["quote_scan_seconds", "option_refresh_seconds", "feed_poll_seconds", "signal_persist_seconds", "paper_slippage_bps", "paper_fee_rate_pct"];

export function SettingsPanel({ status, refresh }: { status: ControlStatus; refresh: () => Promise<void> }) {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [config, setConfig] = useState<TerminalConfig | null>(null);
  const [engineDraft, setEngineDraft] = useState<Record<string, string>>({});
  const [refreshMs, setRefreshMs] = useState("3000");
  const [alerts, setAlerts] = useState<Record<string, boolean>>({ info: true, success: true, warning: true, critical: true });

  useEffect(() => {
    void jsonRequest<TerminalConfig>("/api/control/config").then((value) => {
      setConfig(value);
      setEngineDraft(Object.fromEntries(value.engineSettings.filter((item) => ENGINE_KEYS.includes(item.key)).map((item) => [item.key, String(item.value)])));
      if (value.terminalPreferences) {
        setRefreshMs(String(value.terminalPreferences.refresh_interval_ms));
        setAlerts(value.terminalPreferences.alert_preferences ?? alerts);
      }
    }).catch((reason) => setNotice(reason instanceof Error ? reason.message : "Could not load settings"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const engineMeta = useMemo(() => new Map(config?.engineSettings.map((item) => [item.key, item]) ?? []), [config]);
  const riskSummary = useMemo(() => new Map(config?.strategyParameters.filter((item) => item.category === "risk" || item.category === "entry").map((item) => [item.key, item.value]) ?? []), [config]);

  async function saveCredentials(event: FormEvent) {
    event.preventDefault(); setBusy("credentials"); setNotice("");
    try {
      await jsonRequest("/api/control/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey, apiSecret }) });
      setApiKey(""); setApiSecret(""); setNotice("Groww credentials encrypted and saved. Authentication status was reset until Oracle verifies them."); await refresh();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Could not save credentials"); }
    finally { setBusy(""); }
  }

  async function saveEngineSettings() {
    setBusy("engine"); setNotice("");
    try {
      const engineSettings = Object.fromEntries(Object.entries(engineDraft).map(([key, value]) => [key, Number(value)]));
      const next = await jsonRequest<TerminalConfig>("/api/control/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engineSettings }) });
      setConfig(next); setNotice("Paper runtime settings saved. Oracle refreshes them during the running session."); await refresh();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Could not save engine settings"); }
    finally { setBusy(""); }
  }

  async function savePreferences() {
    setBusy("preferences"); setNotice("");
    try {
      const next = await jsonRequest<TerminalConfig>("/api/control/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: { refresh_interval_ms: Number(refreshMs), alert_preferences: alerts } }) });
      setConfig(next); setNotice("Terminal refresh and in-app alert preferences saved."); await refresh();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Could not save terminal preferences"); }
    finally { setBusy(""); }
  }

  return <>
    {notice && <div className="notice" role="status"><Icon name="shield" />{notice}</div>}
    <section className="settings-grid terminal-section">
      <article className="card settings-card"><div className="settings-heading"><div className="card-icon"><Icon name="key" /></div><div><p className="eyebrow">Broker</p><h2>Groww connectivity</h2></div><span className={`status-badge ${status.worker.groww_authenticated ? "good" : "warn"}`}><span className={`status-dot ${status.worker.groww_authenticated ? "good" : "warn"}`} />{status.worker.groww_authenticated ? "Verified" : status.credentials.configured ? "Saved · unverified" : "Not configured"}</span></div><div className="diagnostic-list"><div><span>Credentials</span><strong>{status.credentials.configured ? "Encrypted at rest" : "Missing"}</strong></div><div><span>Last updated</span><strong>{formatDateTime(status.credentials.updatedAt)}</strong></div><div><span>Market-data status</span><strong>{status.worker.market_data_status ?? "Unknown"}</strong></div></div><form className="credential-form settings-credentials" onSubmit={saveCredentials}><label className="field"><span>New API key</span><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Never displayed after save" required /></label><label className="field"><span>New API secret</span><input type="password" autoComplete="off" value={apiSecret} onChange={(event) => setApiSecret(event.target.value)} placeholder="Never displayed after save" required /></label><button className="primary" disabled={busy === "credentials"}>{busy === "credentials" ? <Icon name="refresh" className="spin" /> : <Icon name="lock" />}{busy === "credentials" ? "Encrypting…" : "Save credentials"}</button></form><p className="availability-note">Credentials are encrypted server-side and never returned through status APIs or rendered after save.</p></article>

      <article className="card settings-card"><div className="settings-heading"><div className="card-icon"><Icon name="chart" /></div><div><p className="eyebrow">Trading</p><h2>Paper execution defaults</h2></div></div><div className="form-grid two">{ENGINE_KEYS.map((key) => { const meta = engineMeta.get(key); return <label className="field" key={key}><span>{meta?.description ?? key} {meta?.unit ? `(${meta.unit})` : ""}</span><input type="number" step="any" value={engineDraft[key] ?? ""} onChange={(event) => setEngineDraft((current) => ({ ...current, [key]: event.target.value }))} /></label>; })}</div><button className="primary" type="button" onClick={() => void saveEngineSettings()} disabled={busy === "engine"}>{busy === "engine" ? "Saving…" : "Save runtime defaults"}</button><p className="availability-note">Slippage and fee/tax values are explicit paper simulation assumptions. Zero means no simulated slippage/fees; they are never presented as broker-reported costs.</p></article>

      <article className="card settings-card"><div className="settings-heading"><div className="card-icon"><Icon name="shield" /></div><div><p className="eyebrow">Risk</p><h2>Global risk defaults</h2></div></div><div className="diagnostic-list"><div><span>Risk / trade</span><strong>{riskSummary.has("risk_per_trade_pct") ? `${Number(riskSummary.get("risk_per_trade_pct")) * 100}%` : "—"}</strong></div><div><span>Daily loss</span><strong>{riskSummary.has("daily_loss_limit_pct") ? `${Number(riskSummary.get("daily_loss_limit_pct")) * 100}%` : "—"}</strong></div><div><span>Daily profit lock</span><strong>{Number(riskSummary.get("daily_profit_lock_pct") ?? 0) > 0 ? `${Number(riskSummary.get("daily_profit_lock_pct")) * 100}%` : "Disabled"}</strong></div><div><span>Max trades</span><strong>{String(riskSummary.get("max_trades_per_day") ?? "—")}</strong></div><div><span>Entry warm-up</span><strong>{String(riskSummary.get("opening_no_entry_minutes") ?? "—")} min</strong></div></div><Link href="/risk" className="secondary" style={{ textDecoration: "none", display: "inline-flex", marginTop: 12 }}>Edit all risk controls →</Link></article>

      <article className="card settings-card"><div className="settings-heading"><div className="card-icon"><Icon name="bell" /></div><div><p className="eyebrow">Notifications</p><h2>In-app alert preferences</h2></div></div><div className="toggle-list">{["info","success","warning","critical"].map((severity) => <label key={severity}><input type="checkbox" checked={alerts[severity] ?? true} onChange={(event) => setAlerts((current) => ({ ...current, [severity]: event.target.checked }))} /><span>{severity[0].toUpperCase() + severity.slice(1)} runtime events</span></label>)}</div><button className="secondary" type="button" onClick={() => void savePreferences()} disabled={busy === "preferences"}>Save alert preferences</button><p className="availability-note">These preferences filter terminal activity alerts. Email, SMS and push delivery are not claimed or simulated because no external delivery provider is configured.</p></article>

      <article className="card settings-card"><div className="settings-heading"><div className="card-icon"><Icon name="database" /></div><div><p className="eyebrow">Data</p><h2>Market-data source</h2></div></div><div className="diagnostic-list"><div><span>Source</span><strong>Groww via Oracle</strong></div><div><span>Quote refresh</span><strong>{status.paperEngine.last_quote_scan ? formatDateTime(status.paperEngine.last_quote_scan) : "Unavailable"}</strong></div><div><span>Option refresh</span><strong>{status.paperEngine.last_option_refresh ? formatDateTime(status.paperEngine.last_option_refresh) : "Unavailable"}</strong></div><div><span>Data age</span><strong>{typeof status.paperEngine.data_age_seconds === "number" ? `${status.paperEngine.data_age_seconds.toFixed(1)}s` : "Unavailable"}</strong></div><div><span>Persisted market frame</span><strong>{formatDateTime(status.paperEngine.latest_snapshot_at)}</strong></div></div></article>

      <article className="card settings-card"><div className="settings-heading"><div className="card-icon"><Icon name="settings" /></div><div><p className="eyebrow">Application</p><h2>Terminal preferences</h2></div></div><label className="field"><span>Auto-refresh interval (ms)</span><input type="number" min="1000" max="60000" step="500" value={refreshMs} onChange={(event) => setRefreshMs(event.target.value)} /></label><div className="diagnostic-list"><div><span>Appearance</span><strong>Graphite dark</strong></div><div><span>Market timezone</span><strong>{config?.terminalPreferences?.timezone ?? "Asia/Kolkata"}</strong></div><div><span>Number format</span><strong>{config?.terminalPreferences?.number_locale ?? "en-IN"}</strong></div></div><button className="secondary" type="button" onClick={() => void savePreferences()} disabled={busy === "preferences"}>{busy === "preferences" ? "Saving…" : "Save terminal preferences"}</button><p className="availability-note">The refresh interval is consumed by the shared terminal status hook, so it applies across all terminal pages after save.</p></article>
    </section>
  </>;
}
