"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/terminal/Icon";
import { MetricCard } from "@/components/terminal/MetricCard";
import { jsonRequest } from "@/lib/controlClient";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { calculatePaperAnalytics } from "@/lib/terminalAnalytics";
import type { ControlStatus } from "@/lib/terminalTypes";

type ConfigPayload = { strategyParameters: Array<{ key:string; category:string; value:number; unit:string; description:string }>; riskControl: { kill_switch?:boolean; block_new_entries?:boolean; close_open_position_on_kill?:boolean; reason?:string } | null };

export function RiskPanel({ status, refresh }: { status: ControlStatus; refresh?: () => Promise<void> }) {
  const analytics = calculatePaperAnalytics(status.paperTrades, status.paperOrders);
  const signal = status.latestSignal?.payload ?? null;
  const position = status.paperEngine.open_paper_position;
  const exposure = status.paperEngine.current_exposure ?? (position?.entry_price && position.quantity ? position.entry_price * position.quantity : null);
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [draft, setDraft] = useState<Record<string,string>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const riskKeys = ["risk_per_trade_pct","daily_loss_limit_pct","max_trades_per_day","max_consecutive_losses","cooldown_seconds","min_signal_confidence","max_data_age_seconds"];
  async function load() {
    try { const data = await jsonRequest<ConfigPayload>("/api/control/config"); setConfig(data); setDraft(Object.fromEntries(data.strategyParameters.filter((p) => riskKeys.includes(p.key)).map((p) => [p.key, String(p.value)]))); } catch (e) { setNotice(e instanceof Error ? e.message : "Could not load risk configuration"); }
  }
  useEffect(() => { void load(); }, []);
  const parameters = useMemo(() => Object.fromEntries((config?.strategyParameters ?? []).map((p) => [p.key, p])), [config]);
  async function save() {
    setBusy(true); setNotice("");
    try { await jsonRequest("/api/control/config", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ strategyParameters:Object.fromEntries(riskKeys.filter((key) => key in draft).map((key) => [key, Number(draft[key])])) }) }); setNotice("Risk limits saved. Oracle will hot-reload them within 30 seconds."); await load(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Risk update failed"); } finally { setBusy(false); }
  }
  async function kill(enabled:boolean) {
    setBusy(true); setNotice("");
    try { await jsonRequest("/api/control/command", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ command: enabled ? "KILL_SWITCH" : "RESET_KILL_SWITCH", payload:{ close_position: config?.riskControl?.close_open_position_on_kill ?? true, reason: enabled ? "Activated from Risk Management" : "Reset from Risk Management" } }) }); setNotice(enabled ? "Kill switch queued: new entries blocked and open paper position will be closed if configured." : "Kill switch reset queued."); await refresh?.(); await load(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Kill switch command failed"); } finally { setBusy(false); }
  }
  async function updateKillClose(value:boolean) {
    try { await jsonRequest("/api/control/config", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ riskControl:{ close_open_position_on_kill:value } }) }); await load(); } catch (e) { setNotice(e instanceof Error ? e.message : "Could not update kill-switch policy"); }
  }
  const killActive = Boolean(status.paperEngine.kill_switch || config?.riskControl?.kill_switch);
  return <>
    {notice && <div className="notice" role="status"><Icon name="shield" />{notice}</div>}
    <section className="terminal-metric-grid four">
      <MetricCard label="Account equity" value={formatCurrency(status.paperEngine.account_equity)} unavailable={status.paperEngine.account_equity == null} icon="shield" />
      <MetricCard label="Current exposure" value={formatCurrency(exposure)} detail="Open paper premium" unavailable={exposure === null} />
      <MetricCard label="Available capital" value={formatCurrency(status.paperEngine.available_capital)} unavailable={status.paperEngine.available_capital == null} />
      <MetricCard label="Kill switch" value={killActive ? "ACTIVE" : "READY"} tone={killActive ? "negative" : "positive"} icon="shield" />
    </section>
    <section className="dashboard-grid terminal-section">
      <article className="card span-7"><div className="section-heading compact"><div><p className="eyebrow">Global limits</p><h2>DB-backed risk controls</h2></div><span>Hot reload ≤30s</span></div><div className="form-grid compact">
        {riskKeys.map((key) => <label className="field" key={key}><span>{parameters[key]?.description ?? key.replaceAll("_", " ")}{parameters[key]?.unit ? ` · ${parameters[key].unit}` : ""}</span><input type="number" step="any" value={draft[key] ?? ""} onChange={(e) => setDraft((current) => ({...current,[key]:e.target.value}))} /></label>)}
      </div><button className="primary" disabled={busy || !config} onClick={() => void save()}>Save risk limits</button></article>
      <article className="card span-5"><div className="section-heading compact"><div><p className="eyebrow">Emergency control</p><h2>Paper kill switch</h2></div></div><div className="diagnostic-list"><div><span>New entries</span><strong className={killActive ? "bad" : "good"}>{killActive ? "Blocked" : "Allowed by risk engine"}</strong></div><div><span>Open position</span><strong>{position?.trading_symbol ?? "None"}</strong></div><div><span>Latest risk verdict</span><strong>{signal ? (signal.risk.allowed ? "Allow" : "Block") : "Unavailable"}</strong></div><div><span>Trades today</span><strong>{analytics.tradesToday}</strong></div><div><span>Realized P&L</span><strong>{formatCurrency(analytics.todayPnl)}</strong></div></div><label className="toggle-row"><input type="checkbox" checked={config?.riskControl?.close_open_position_on_kill ?? true} onChange={(e) => void updateKillClose(e.target.checked)} /><span>Close open paper position when kill switch activates</span></label><div className="action-grid"><button className="kill-switch" disabled={busy || killActive || !status.worker.online} onClick={() => void kill(true)}><Icon name="shield" /><span><strong>KILL SWITCH</strong><small>Block entries + optional close</small></span></button><button className="secondary" disabled={busy || !killActive || !status.worker.online} onClick={() => void kill(false)}>Reset kill switch</button></div></article>
    </section>
    <section className="dashboard-grid terminal-section"><article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Current decision</p><h2>Signal risk snapshot</h2></div></div><div className="diagnostic-list"><div><span>Allowed</span><strong>{signal ? (signal.risk.allowed ? "YES" : "NO") : "Unavailable"}</strong></div><div><span>Quantity</span><strong>{signal ? formatNumber(signal.risk.quantity,0) : "Unavailable"}</strong></div><div><span>Max premium risk</span><strong>{signal ? formatCurrency(signal.risk.max_premium_risk) : "Unavailable"}</strong></div><div><span>Reason</span><strong>{signal?.risk.reason ?? "No signal"}</strong></div></div></article><article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Performance guardrails</p><h2>Observed outcomes</h2></div></div><div className="diagnostic-list"><div><span>Win rate</span><strong>{formatPercent(analytics.winRate)}</strong></div><div><span>Max drawdown</span><strong>{formatCurrency(analytics.maxDrawdown)}</strong></div><div><span>Largest loss</span><strong>{formatCurrency(analytics.largestLoser)}</strong></div><div><span>Consecutive losses</span><strong>{analytics.losingStreak}</strong></div></div></article></section>
  </>;
}
