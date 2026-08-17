"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/terminal/EmptyState";
import { MetricCard } from "@/components/terminal/MetricCard";
import { jsonRequest } from "@/lib/controlClient";
import { formatCurrency, formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import type { ControlCommand, ControlStatus } from "@/lib/terminalTypes";

type MarketOption = {
  trading_symbol: string; option_type: "CE" | "PE"; strike: number; ltp: number; bid_price?: number | null; ask_price?: number | null;
  expiry?: string | null; observed_at?: string | null;
};
type MarketResponse = { optionChain?: MarketOption[]; summary?: { optionObservedAt?: string | null } };

export function PositionsPanel({ status, refresh }: { status: ControlStatus; refresh?: () => Promise<void> }) {
  const position = status.paperEngine.open_position ?? status.paperEngine.open_paper_position;
  const mode = status.executionControl?.mode ?? status.paperEngine.mode ?? "paper";
  const armed = Boolean(status.executionControl?.live_armed ?? status.paperEngine.live_armed);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [target, setTarget] = useState("");
  const [trailActivation, setTrailActivation] = useState("");
  const [trailDrawdown, setTrailDrawdown] = useState("");
  const [marketOptions, setMarketOptions] = useState<MarketOption[]>([]);
  const [marketError, setMarketError] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [manualLots, setManualLots] = useState("1");

  useEffect(() => {
    setStopLoss(position?.stop_loss_pct != null ? String(position.stop_loss_pct * 100) : "");
    setTarget(position?.profit_target_pct != null ? String(position.profit_target_pct * 100) : "");
    setTrailActivation(position?.trailing_activation_pct != null ? String(position.trailing_activation_pct * 100) : "");
    setTrailDrawdown(position?.trailing_drawdown_pct != null ? String(position.trailing_drawdown_pct * 100) : "");
  }, [position?.trading_symbol, position?.stop_loss_pct, position?.profit_target_pct, position?.trailing_activation_pct, position?.trailing_drawdown_pct]);

  useEffect(() => {
    if (mode !== "live") return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await jsonRequest<MarketResponse>("/api/control/market", { cache: "no-store" });
        if (cancelled) return;
        const rows = (response.optionChain ?? []).filter((row) => row.trading_symbol && (row.option_type === "CE" || row.option_type === "PE") && Number(row.ltp) > 0);
        setMarketOptions(rows);
        setMarketError("");
        setSelectedSymbol((current) => {
          if (current && rows.some((row) => row.trading_symbol === current)) return current;
          const nifty = Number(status.paperEngine.nifty_ltp ?? 0);
          const nearest = rows.reduce<MarketOption | null>((best, row) => !best || Math.abs(Number(row.strike) - nifty) < Math.abs(Number(best.strike) - nifty) ? row : best, null);
          return nearest?.trading_symbol ?? rows[0]?.trading_symbol ?? "";
        });
      } catch (reason) {
        if (!cancelled) setMarketError(reason instanceof Error ? reason.message : "Could not load option chain");
      }
    })();
    return () => { cancelled = true; };
  }, [mode, status.paperEngine.nifty_ltp, status.paperEngine.last_option_refresh]);

  async function command(commandName: ControlCommand, payload: Record<string, unknown> = {}) {
    setBusy(commandName); setNotice("");
    try {
      const response=await jsonRequest<{duplicate?:boolean}>("/api/control/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: commandName, payload }) });
      setNotice(response.duplicate?`${commandName.replaceAll("_", " ")} is already queued/running.`:`${commandName.replaceAll("_", " ")} queued for Oracle.`); await refresh?.();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Position command failed"); }
    finally { setBusy(""); }
  }
  async function saveProtection() {
    const pct = (value: string) => value.trim() === "" ? null : Number(value) / 100;
    await command("UPDATE_PAPER_POSITION", { stop_loss_pct: pct(stopLoss), profit_target_pct: pct(target), trailing_activation_pct: pct(trailActivation), trailing_drawdown_pct: pct(trailDrawdown) });
  }

  const deployed = position?.entry_price && position.quantity ? position.entry_price * position.quantity : null;
  const live = mode === "live";
  const auditResult=status.latestCommand?.command==="CHECK_LIVE_POSITIONS"&&status.latestCommand.status==="completed"?status.latestCommand.result:null;
  const openOrder = useMemo(() => status.paperOrders.find((order) => order.mode === mode && order.status.toUpperCase() === "OPEN" && (!position?.trading_symbol || order.trading_symbol === position.trading_symbol)), [mode, position?.trading_symbol, status.paperOrders]);
  const positionSource = openOrder?.execution_source === "manual" ? "MY TRADE" : openOrder ? "ALGO" : "—";
  const selectedOption = marketOptions.find((row) => row.trading_symbol === selectedSymbol) ?? null;
  const manualReady = live && armed && Boolean(status.paperEngine.running) && status.worker.online && !status.paperEngine.kill_switch && !status.paperEngine.block_new_entries && !position && Boolean(selectedOption);

  return <>
    {notice && <div className="notice" role="status">{notice}</div>}
    {live && armed && <div className="notice error" role="status"><strong>LIVE execution armed</strong><span> The engine watches + analyzes the market and eligible algo/manual actions can send actual Groww F&amp;O orders.</span></div>}
    {!live && <div className="notice" role="status"><strong>PAPER observation mode</strong><span> The engine watches + analyzes the same live market data and records simulated strategy trades only. No broker order is sent.</span></div>}
    <section className="terminal-metric-grid four">
      <MetricCard label="Open positions" value={position ? "1" : "0"} detail="One managed position rule" icon="positions" />
      <MetricCard label="Premium deployed" value={formatCurrency(deployed)} detail="Entry premium × current quantity" unavailable={deployed === null} />
      <MetricCard label="Unrealized P&L" value={formatCurrency(position?.unrealized_pnl)} unavailable={position?.unrealized_pnl == null} tone={(position?.unrealized_pnl ?? 0) >= 0 ? "positive" : "negative"} />
      <MetricCard label="Position source" value={positionSource} detail={live ? "Discretionary app trade or algo" : "Paper strategy simulation"} tone={positionSource === "MY TRADE" ? "warning" : undefined} icon="strategy" />
    </section>

    {live && <section className="terminal-section card">
      <div className="section-heading compact"><div><p className="eyebrow">Discretionary execution</p><h2>My LIVE trade</h2></div><span>Oracle → Groww · MARKET BUY</span></div>
      <p className="availability-note">Choose a currently persisted NIFTY option and number of lots. Oracle independently revalidates the live arm, kill switch, broker-flat state, quote freshness, actual lot size, premium cap and available Groww margin before submitting. Manual entries are tracked separately from algo strategies.</p>
      {marketError && <div className="notice error" role="alert">{marketError}</div>}
      <div className="form-grid compact">
        <label className="field"><span>Option contract</span><select value={selectedSymbol} onChange={(event) => setSelectedSymbol(event.target.value)} disabled={Boolean(position) || Boolean(busy)}><option value="">Select current option</option>{marketOptions.map((row) => <option key={row.trading_symbol} value={row.trading_symbol}>{row.option_type} · {formatNumber(row.strike, 0)} · LTP {formatNumber(row.ltp)} · {row.trading_symbol}</option>)}</select></label>
        <label className="field"><span>Lots</span><input type="number" min="1" max="20" step="1" value={manualLots} onChange={(event) => setManualLots(event.target.value)} disabled={Boolean(position) || Boolean(busy)} /></label>
        <div className="diagnostic-list"><div><span>Selected LTP</span><strong>{formatNumber(selectedOption?.ltp)}</strong></div><div><span>Bid / Ask</span><strong>{formatNumber(selectedOption?.bid_price)} / {formatNumber(selectedOption?.ask_price)}</strong></div></div>
      </div>
      <button className="danger" disabled={!manualReady || Boolean(busy) || !Number.isInteger(Number(manualLots)) || Number(manualLots) < 1 || Number(manualLots) > 20} onClick={() => void command("MANUAL_LIVE_ENTRY", { trading_symbol: selectedSymbol, lots: Number(manualLots) })}>{busy === "MANUAL_LIVE_ENTRY" ? "Submitting through Oracle…" : "BUY selected option"}</button>
      {!armed && <p className="availability-note bad">LIVE mode must be armed before discretionary broker entry is enabled.</p>}
      {position && <p className="availability-note warn">A managed position is already open. The one-position rule blocks another manual or algo entry.</p>}
    </section>}

    {live&&<section className="terminal-section card"><div className="section-heading compact"><div><p className="eyebrow">Broker reconciliation</p><h2>Groww vs database</h2></div><button className="secondary" disabled={!status.worker.online||Boolean(busy)} onClick={()=>void command("CHECK_LIVE_POSITIONS")}>{busy==="CHECK_LIVE_POSITIONS"?"Checking…":"Verify Groww positions"}</button></div><div className="diagnostic-list"><div><span>Managed DB position</span><strong>{position?`${position.trading_symbol} · ${position.quantity} · ${positionSource}`:"Flat"}</strong></div><div><span>Last broker audit</span><strong>{auditResult?String(auditResult.flat?"FLAT / MATCHED":"POSITION MATCHED"):"Run audit"}</strong></div></div><p className="availability-note">Oracle queries Groww&apos;s full F&amp;O position book, filters non-zero NIFTY positions, and compares it with the managed Supabase position. Any orphan or quantity mismatch activates fail-closed behavior; automation will not power off Oracle.</p></section>}
    <section className="terminal-section card">
      <div className="section-heading compact"><div><p className="eyebrow">Open inventory</p><h2>Positions</h2></div><span>Current option mark from Oracle</span></div>
      {!position ? <EmptyState icon="positions" title={`No open ${live ? "LIVE" : "paper"} position`} description={live ? "An open position can come from an armed algo signal or from My LIVE trade above." : "A position appears when a persisted signal passes risk checks and the paper runner simulates an entry."} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Instrument</th><th>Source</th><th>Qty</th><th>Entry</th><th>LTP</th><th>Unrealized P&amp;L</th><th>Opened</th><th>Holding</th><th>Mode</th></tr></thead><tbody><tr><td><strong>{position.trading_symbol ?? "Unavailable"}</strong></td><td><span className={`status-badge ${positionSource === "MY TRADE" ? "warn" : "good"}`}>{positionSource}</span></td><td className="numeric">{formatNumber(position.quantity, 0)}</td><td className="numeric">{formatNumber(position.entry_price)}</td><td className="numeric">{formatNumber(position.current_price)}</td><td className={`numeric ${(position.unrealized_pnl ?? 0) >= 0 ? "good" : "bad"}`}>{formatCurrency(position.unrealized_pnl)}</td><td>{formatDateTime(position.opened_at)}</td><td>{formatDuration(position.opened_at)}</td><td><span className={`status-badge ${live ? "bad" : "warn"}`}><span className={`status-dot ${live ? "bad" : "amber"}`} />{live ? "LIVE" : "Paper"}</span></td></tr></tbody></table></div>}
    </section>
    <section className="dashboard-grid terminal-section">
      <article className="card span-6">
        <div className="section-heading compact"><div><p className="eyebrow">Protection</p><h2>Stops, targets &amp; Greeks</h2></div></div>
        {position ? <><div className="diagnostic-list">
          <div><span>Stop premium</span><strong>{formatNumber(position.stop_price)}</strong></div><div><span>Target premium</span><strong>{formatNumber(position.target_price)}</strong></div>
          <div><span>Best premium</span><strong>{formatNumber(position.best_price)}</strong></div><div><span>Delta / IV</span><strong>{formatNumber(position.greeks?.delta)} / {position.greeks?.iv != null ? `${formatNumber(position.greeks.iv)}%` : "—"}</strong></div>
          <div><span>Gamma</span><strong>{formatNumber(position.greeks?.gamma, 4)}</strong></div><div><span>Theta</span><strong>{formatNumber(position.greeks?.theta)}</strong></div>
        </div><div className="form-grid compact"><label className="field"><span>Stop loss %</span><input type="number" min="0" max="100" step="0.1" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} /></label><label className="field"><span>Profit target %</span><input type="number" min="0" max="100" step="0.1" value={target} onChange={(e) => setTarget(e.target.value)} /></label><label className="field"><span>Trail activation %</span><input type="number" min="0" max="100" step="0.1" value={trailActivation} onChange={(e) => setTrailActivation(e.target.value)} /></label><label className="field"><span>Trail drawdown %</span><input type="number" min="0" max="100" step="0.1" value={trailDrawdown} onChange={(e) => setTrailDrawdown(e.target.value)} /></label></div><button className="primary" disabled={Boolean(busy)} onClick={() => void saveProtection()}>Save protection</button></> : <EmptyState icon="shield" title="No active protection to edit" description={`Open a ${live ? "LIVE" : "paper"} position to override its stop, target, and trailing parameters.`} />}
      </article>
      <article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Actions</p><h2>Position controls</h2></div></div><div className="action-grid"><button className="danger" disabled={!position || Boolean(busy)} onClick={() => void command("EXIT_PAPER_POSITION", { fraction: 1 })}>{live ? "SELL / Exit position" : "Exit position"}</button><button className="secondary" disabled={!position || Boolean(busy)} onClick={() => void command("EXIT_PAPER_POSITION", { fraction: 0.5 })}>Exit 50%</button><button className="secondary" disabled={!position || Boolean(busy)} onClick={() => { setStopLoss("4"); void command("UPDATE_PAPER_POSITION", { stop_loss_pct: 0.04 }); }}>Tighten stop</button><button className="secondary" disabled={!position || Boolean(busy)} onClick={() => void command("UPDATE_PAPER_POSITION", { trailing_activation_pct: 0, trailing_drawdown_pct: 0.03 })}>Trail now</button></div><p className="availability-note">{live ? `LIVE exits are submitted as real Groww market SELL orders from Oracle. ${positionSource === "MY TRADE" ? "This discretionary entry remains attributed to My Trades even when app protection performs the exit." : "Algo entries retain their strategy attribution."}` : "Paper actions execute against the next available option-chain mark; no Groww order is sent."}</p></article>
    </section>
  </>;
}
