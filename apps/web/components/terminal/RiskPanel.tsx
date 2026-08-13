"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/terminal/ConfirmDialog";
import { EmptyState } from "@/components/terminal/EmptyState";
import { Icon } from "@/components/terminal/Icon";
import { MetricCard } from "@/components/terminal/MetricCard";
import { jsonRequest } from "@/lib/controlClient";
import { formatCurrency, formatPercent } from "@/lib/format";
import { calculatePaperAnalytics } from "@/lib/terminalAnalytics";
import type { ControlStatus, TerminalConfig } from "@/lib/terminalTypes";

const RISK_KEYS = [
  "risk_per_trade_pct", "daily_loss_limit_pct", "daily_profit_lock_pct", "max_trades_per_day",
  "max_consecutive_losses", "max_quantity", "max_premium_per_trade", "cooldown_seconds",
  "min_signal_confidence", "max_data_age_seconds", "opening_no_entry_minutes", "entry_cutoff_enabled",
  "entry_cutoff_minutes_before_close",
] as const;

export function RiskPanel({ status, refresh }: { status: ControlStatus; refresh: () => Promise<void> }) {
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [config, setConfig] = useState<TerminalConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const analytics = calculatePaperAnalytics(status.paperTrades, status.paperOrders);
  const position = status.paperEngine.open_paper_position;
  const exposure = position?.entry_price && position.quantity ? position.entry_price * position.quantity : null;
  const signal = status.latestSignal?.payload;
  const draftEquity = Number(draft.account_equity || 0);
  const equity = status.paperEngine.account_equity ?? status.engineSettings?.account_equity ?? (draftEquity > 0 ? draftEquity : null);
  const exposurePct = exposure !== null && equity ? exposure / equity : null;
  const killEnabled = status.riskControl?.kill_switch_enabled ?? status.paperEngine.kill_switch_enabled ?? false;

  useEffect(() => {
    void jsonRequest<TerminalConfig>("/api/control/config").then((value) => {
      setConfig(value);
      const values: Record<string, string> = {};
      for (const parameter of value.strategyParameters) if ((RISK_KEYS as readonly string[]).includes(parameter.key)) values[parameter.key] = String(parameter.value);
      const account = value.engineSettings.find((item) => item.key === "account_equity");
      if (account) values.account_equity = String(account.value);
      setDraft(values);
    }).catch((reason) => setNotice(reason instanceof Error ? reason.message : "Could not load risk configuration"));
  }, []);

  const parameterMeta = useMemo(() => new Map(config?.strategyParameters.map((item) => [item.key, item]) ?? []), [config]);

  async function command(commandName: string, payload: Record<string, unknown> = {}) {
    setBusy(commandName); setNotice("");
    try {
      const result = await jsonRequest<{ duplicate?: boolean }>("/api/control/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: commandName, payload }) });
      setNotice(result.duplicate ? `${commandName.replaceAll("_", " ")} is already active.` : `${commandName.replaceAll("_", " ")} queued.`);
      await refresh();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Risk action failed"); }
    finally { setBusy(""); setConfirmStop(false); setConfirmKill(false); }
  }

  async function saveLimits() {
    setBusy("save"); setNotice("");
    try {
      const parameters = Object.fromEntries(RISK_KEYS.filter((key) => draft[key] !== undefined).map((key) => [key, Number(draft[key])]));
      const engineSettings = draft.account_equity !== undefined ? { account_equity: Number(draft.account_equity) } : undefined;
      const next = await jsonRequest<TerminalConfig>("/api/control/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parameters, engineSettings }) });
      setConfig(next); setNotice("Risk limits saved. Oracle will refresh them while the paper engine is running."); await refresh();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Could not save risk limits"); }
    finally { setBusy(""); }
  }

  return <>
    {notice && <div className="notice" role="status"><Icon name="shield" />{notice}</div>}
    <section className="terminal-metric-grid six">
      <MetricCard label="Current exposure" value={formatCurrency(exposure)} detail={exposurePct !== null ? `${formatPercent(exposurePct)} of paper equity` : "Open paper premium at entry"} unavailable={exposure === null} icon="shield" />
      <MetricCard label="Available capital" value={formatCurrency(status.paperEngine.available_capital ?? (equity && exposure !== null ? equity - exposure : null))} unavailable={!equity} />
      <MetricCard label="Trades today" value={String(analytics.tradesToday)} detail="Persisted paper orders" />
      <MetricCard label="Realized P&L today" value={formatCurrency(analytics.todayPnl)} tone={(analytics.todayPnl ?? 0) >= 0 ? "positive" : "negative"} unavailable={analytics.todayPnl === null} />
      <MetricCard label="Latest risk decision" value={signal ? (signal.risk.allowed ? "ALLOW" : "BLOCK") : undefined} detail={signal?.risk.reason} tone={signal?.risk.allowed ? "positive" : "warning"} unavailable={!signal} />
      <MetricCard label="Kill switch" value={killEnabled ? "ENGAGED" : "READY"} detail={status.riskControl?.reason ?? "Persistent DB safety state"} tone={killEnabled ? "negative" : "positive"} />
    </section>

    <section className="dashboard-grid terminal-section">
      <article className="card span-7"><div className="section-heading compact"><div><p className="eyebrow">Risk controls</p><h2>Global limits</h2></div><button className="primary" type="button" onClick={() => void saveLimits()} disabled={Boolean(busy)}>{busy === "save" ? "Saving…" : "Save limits"}</button></div><div className="form-grid two"><label className="field"><span>Paper account equity</span><input type="number" min="1" step="1000" value={draft.account_equity ?? ""} onChange={(event) => setDraft((current) => ({ ...current, account_equity: event.target.value }))} /></label>{RISK_KEYS.map((key) => { const meta = parameterMeta.get(key); if (meta?.unit === "bool") return <label className="field" key={key}><span>{meta.description}</span><select value={draft[key] ?? "0"} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}><option value="1">Enabled</option><option value="0">Disabled</option></select></label>; return <label className="field" key={key}><span>{meta?.description ?? key.replaceAll("_", " ")} {meta?.unit ? `(${meta.unit})` : ""}</span><input type="number" step="any" value={draft[key] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /></label>; })}</div><p className="availability-note">Zero disables the optional daily-profit lock, max quantity and absolute max-premium limits. The one-position rule remains fixed at one position by design.</p></article>
      <article className="card span-5 emergency-card"><div className="emergency-heading"><div className="dialog-icon"><Icon name="shield" /></div><div><p className="eyebrow">Emergency controls</p><h2>Execution safety</h2></div></div><p className="muted">The kill switch is persisted before Oracle processes the command. Once engaged, new entries stay blocked across paper-engine restarts. You can also request the current paper position to be closed at the latest available option mark.</p><button className="danger button-wide" type="button" onClick={() => setConfirmStop(true)} disabled={!status.worker.online || !status.paperEngine.running || Boolean(busy)}><span>Pause paper processing</span><Icon name="stop" /></button>{killEnabled ? <button className="primary button-wide" type="button" onClick={() => void command("KILL_SWITCH", { enabled: false })} disabled={Boolean(busy)}><Icon name="shield" />Reset kill switch</button> : <button className="kill-switch" type="button" onClick={() => setConfirmKill(true)} disabled={Boolean(busy)}><Icon name="shield" /><span><strong>KILL SWITCH</strong><small>Block entries + close current paper position</small></span></button>}<p className="availability-note">Paper-only. No broker cancel/close API is called because live Groww order execution is still intentionally unavailable.</p></article>
    </section>

    <section className="terminal-section card"><div className="section-heading compact"><div><p className="eyebrow">Exposure</p><h2>Strategy &amp; instrument allocation</h2></div></div>{position ? <div className="exposure-bars"><div><div><span>Level-event strategy</span><strong>{formatCurrency(exposure)} · {exposurePct !== null ? formatPercent(exposurePct) : "—"}</strong></div><span><i style={{ width: `${Math.min((exposurePct ?? 0) * 100, 100)}%` }} /></span></div><div><div><span>{position.trading_symbol}</span><strong>{formatCurrency(exposure)}</strong></div><span><i style={{ width: `${Math.min((exposurePct ?? 0) * 100, 100)}%` }} /></span></div></div> : <EmptyState icon="shield" title="No current paper exposure" description="The risk budget is available for the next eligible strategy signal, subject to all configured limits." />}</section>
    <ConfirmDialog open={confirmStop} title="Pause all paper processing?" description="This queues STOP_PAPER_ENGINE. It stops market strategy processing but does not close the current paper position." confirmLabel="Pause paper engine" busy={busy === "STOP_PAPER_ENGINE"} onCancel={() => setConfirmStop(false)} onConfirm={() => void command("STOP_PAPER_ENGINE")} />
    <ConfirmDialog open={confirmKill} title="Engage the paper kill switch?" description="The DB safety state is set immediately. Oracle will block new entries and, when a paper position is open, attempt to close it at the latest available option mark." confirmLabel="Engage kill switch" busy={busy === "KILL_SWITCH"} onCancel={() => setConfirmKill(false)} onConfirm={() => void command("KILL_SWITCH", { enabled: true, closePosition: true, reason: "Emergency kill switch engaged from Risk page" })} />
  </>;
}
