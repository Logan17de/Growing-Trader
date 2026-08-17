"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/terminal/Icon";
import type { CurrentStatusReport, ReportSeriesPoint } from "@/lib/currentStatusReport";

function money(value: number | null | undefined, signed = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${signed && value > 0 ? "+" : ""}₹${Math.round(value).toLocaleString("en-IN")}`;
}
function pct(value: number | null | undefined) { return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`; }
function num(value: number | null | undefined, digits = 2) { return value === null || value === undefined ? "—" : value.toFixed(digits); }
function compact(value: number) { const n = Math.abs(value); return n >= 10_000_000 ? `${(value / 10_000_000).toFixed(2)}Cr` : n >= 100_000 ? `${(value / 100_000).toFixed(2)}L` : n >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : Math.round(value).toLocaleString("en-IN"); }
function show(value: unknown) { return value === null || value === undefined || value === "" ? "—" : String(value); }

function MiniLine({ points, color = "#2878ff" }: { points: ReportSeriesPoint[]; color?: string }) {
  if (points.length < 2) return <div style={{ height: 120, display: "grid", placeItems: "center", color: "#7a8797", fontSize: 13 }}>Not enough data yet</div>;
  const values = points.map((point) => point.value); const min = Math.min(...values); const max = Math.max(...values); const span = Math.max(max - min, 1);
  const path = points.map((point, index) => `${index ? "L" : "M"}${(index / (points.length - 1)) * 520},${110 - ((point.value - min) / span) * 90}`).join(" ");
  return <svg viewBox="0 0 520 120" width="100%" height="120" role="img"><line x1="0" y1="110" x2="520" y2="110" stroke="#e8edf4" /><path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return <div style={{ padding: "15px 16px", borderRight: "1px solid #29435e" }}><div style={{ color: "#aebdcd", fontSize: 10, letterSpacing: ".08em", fontWeight: 700 }}>{label}</div><div style={{ marginTop: 6, fontSize: 21, fontWeight: 800, color: tone === "good" ? "#47d69f" : tone === "bad" ? "#ff7474" : "#fff" }}>{value}</div></div>;
}

function SmallMetricGrid({ rows, columns = 4 }: { rows: Array<[string, string]>; columns?: number }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns},1fr)`, gap: 10, marginTop: 12 }}>{rows.map(([label, value]) => <div key={label} style={{ background: "#f6f8fb", borderRadius: 9, padding: 10 }}><div style={{ color: "#788697", fontSize: 10 }}>{label}</div><strong style={{ display: "block", marginTop: 4, fontSize: 14 }}>{value}</strong></div>)}</div>;
}

function ExportReportCard({ report, nodeRef }: { report: CurrentStatusReport; nodeRef: React.RefObject<HTMLDivElement | null> }) {
  const watch = report.marketWatch ?? {};
  const marketRows: Array<[string, string]> = [
    ["NIFTY", report.market.nifty?.toLocaleString("en-IN") ?? "—"], ["1m volume", compact(report.market.minuteVolume)], ["Session volume", compact(report.market.sessionVolume)], ["Turnover", money(report.market.turnover)],
    ["Breadth", pct(report.market.breadth)], ["Participation", pct(report.market.participation)], ["Cash pressure", num(report.market.cashPressure)], ["Heavyweights", num(report.market.heavyweightScore)],
    ["Synthetic VWAP", num(report.market.syntheticVwap)], ["Futures score", num(report.market.futuresScore)], ["Options score", num(report.market.optionScore)], ["Combined score", num(report.market.combinedScore)],
  ];
  const watchRows: Array<[string, string]> = [
    ["NIFTY", show(watch.nifty_ltp)], ["Cash pressure", show(watch.cash_pressure)], ["Breadth", show(watch.breadth)], ["Futures score", show(watch.futures_score)], ["Futures OI Δ%", show(watch.futures_oi_change_pct)], ["Options score", show(watch.option_score)],
    ["Options OI imbalance", show(watch.option_oi_change_imbalance)], ["VWAP dist bps", show(watch.vwap_distance_bps)], ["Combined score", show(watch.combined_direction_score)], ["1m future move", show(watch.nifty_move_1m_bps)], ["5m future move", show(watch.nifty_move_5m_bps)], ["15m future move", show(watch.nifty_move_15m_bps)],
  ];
  const safetyRows: Array<[string, string]> = [
    ["Groww positions", report.safety.brokerFlat === true ? "Confirmed flat" : report.safety.brokerFlat === false ? "NOT flat" : "Audit unavailable"],
    ["Unresolved LIVE orders", String(report.safety.unresolvedLiveOrders)], ["LIVE armed", report.safety.liveArmed ? "YES" : "No"], ["Kill switch", report.safety.killSwitch ? "ACTIVE" : "Clear"],
    ["Worker", report.safety.workerState ?? "—"], ["Engine", report.safety.engineState ?? "—"], ["Open position", report.safety.openPosition && Object.keys(report.safety.openPosition).length ? String(report.safety.openPosition.trading_symbol ?? "Open") : "None"],
  ];
  const perfRows: Array<[string, string]> = [
    ["Wins / Losses", `${report.summary.wins} / ${report.summary.losses}`], ["Avg win", money(report.summary.averageWin, true)], ["Avg loss", money(report.summary.averageLoss, true)],
    ["Profit factor", report.summary.profitFactor === null ? "—" : report.summary.profitFactor.toFixed(2)], ["Max drawdown", money(report.summary.maxDrawdown, true)], ["Expectancy", money(report.summary.expectancy, true)],
  ];

  return <div ref={nodeRef} style={{ width: 1080, padding: 28, background: "#f4f7fb", color: "#10243f", fontFamily: "Arial, sans-serif" }}>
    <div style={{ background: "#071d35", borderRadius: 16, color: "white", overflow: "hidden" }}>
      <div style={{ padding: "20px 22px 12px", display: "flex", justifyContent: "space-between", alignItems: "start" }}><div><div style={{ fontSize: 24, fontWeight: 900 }}>📊 Growing Trader</div><div style={{ color: "#b9c8d7", marginTop: 4, fontSize: 13 }}>Current Status Snapshot · {report.mode.toUpperCase()}{report.mode === "live" ? report.modeArmed ? " · ARMED" : " · DISARMED" : ""}</div></div><div style={{ textAlign: "right", color: "#dbe6f0", fontSize: 12 }}>{new Date(report.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}<br />IST</div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderTop: "1px solid #29435e" }}><Metric label="NET P&L" value={money(report.summary.dailyPnl, true)} tone={report.summary.dailyPnl >= 0 ? "good" : "bad"} /><Metric label="MONTHLY P&L" value={money(report.summary.monthlyPnl, true)} tone={report.summary.monthlyPnl >= 0 ? "good" : "bad"} /><Metric label="TRADES" value={String(report.summary.trades)} /><Metric label="WIN RATE" value={pct(report.summary.winRate)} /><Metric label="START BALANCE" value={money(report.summary.startingBalance)} /><Metric label="END BALANCE" value={money(report.summary.endingBalance)} /><Metric label="BEST TRADE" value={money(report.summary.bestTrade, true)} tone="good" /></div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1.25fr .75fr", gap: 16, marginTop: 16 }}><section style={{ background: "white", border: "1px solid #dde6f0", borderRadius: 14, padding: 18 }}><div style={{ fontWeight: 800, fontSize: 14 }}>P&L OVER TIME</div><MiniLine points={report.pnlSeries} color={report.summary.dailyPnl >= 0 ? "#16a765" : "#e8453c"} /></section><section style={{ background: "white", border: "1px solid #dde6f0", borderRadius: 14, padding: 18 }}><div style={{ fontWeight: 800, fontSize: 14 }}>PERFORMANCE</div><SmallMetricGrid rows={perfRows} columns={2} /></section></div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}><section style={{ background: "white", border: "1px solid #dde6f0", borderRadius: 14, padding: 18 }}><div style={{ fontWeight: 800, fontSize: 14 }}>EQUITY / REALIZED CURVE</div><MiniLine points={report.equitySeries} /></section><section style={{ background: "white", border: "1px solid #dde6f0", borderRadius: 14, padding: 18 }}><div style={{ fontWeight: 800, fontSize: 14 }}>NIFTY 50 · INTRADAY</div><MiniLine points={report.niftySeries} color="#596bff" /></section></div>

    <section style={{ background: "white", border: "1px solid #dde6f0", borderRadius: 14, padding: 18, marginTop: 16 }}><div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>STRATEGY PERFORMANCE</div><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr style={{ background: "#f4f7fb", color: "#687789" }}><th style={{ padding: 9, textAlign: "left" }}>Strategy</th><th style={{ padding: 9, textAlign: "right" }}>Trades</th><th style={{ padding: 9, textAlign: "right" }}>Wins</th><th style={{ padding: 9, textAlign: "right" }}>Win rate</th><th style={{ padding: 9, textAlign: "right" }}>P&L</th></tr></thead><tbody>{report.strategies.map((row) => <tr key={row.strategy}><td style={{ padding: 9, borderBottom: "1px solid #edf1f6", fontWeight: 700 }}>{row.strategy}</td><td style={{ padding: 9, borderBottom: "1px solid #edf1f6", textAlign: "right" }}>{row.trades}</td><td style={{ padding: 9, borderBottom: "1px solid #edf1f6", textAlign: "right" }}>{row.wins}</td><td style={{ padding: 9, borderBottom: "1px solid #edf1f6", textAlign: "right" }}>{pct(row.winRate)}</td><td style={{ padding: 9, borderBottom: "1px solid #edf1f6", textAlign: "right", fontWeight: 800, color: row.pnl >= 0 ? "#16a765" : "#e8453c" }}>{money(row.pnl, true)}</td></tr>)}</tbody></table></section>

    <div style={{ display: "grid", gridTemplateColumns: "1.2fr .8fr", gap: 16, marginTop: 16 }}><section style={{ background: "white", border: "1px solid #dde6f0", borderRadius: 14, padding: 18 }}><div style={{ fontWeight: 800, fontSize: 14 }}>MARKET OVERVIEW</div><SmallMetricGrid rows={marketRows} /><div style={{ color: "#8592a3", fontSize: 10, marginTop: 10 }}>Volume is aggregate NIFTY-50 constituent volume, not exchange-reported index volume.</div></section><section style={{ background: "white", border: "1px solid #dde6f0", borderRadius: 14, padding: 18 }}><div style={{ fontWeight: 800, fontSize: 14 }}>BROKER & SYSTEM SAFETY</div><div style={{ display: "grid", gap: 9, marginTop: 12, fontSize: 12 }}>{safetyRows.map(([label, value]) => <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 16, borderBottom: "1px solid #edf1f6", paddingBottom: 7 }}><span style={{ color: "#788697" }}>{label}</span><strong>{value}</strong></div>)}</div></section></div>

    <section style={{ background: "#eef6ff", border: "1px solid #d6e8ff", borderRadius: 14, padding: 18, marginTop: 16 }}><div style={{ color: "#1967d2", fontWeight: 900, fontSize: 13 }}>🔬 MARKET WATCH · LATEST RESEARCH OBSERVATION</div><SmallMetricGrid rows={watchRows} columns={6} /><div style={{ color: "#718196", fontSize: 10, marginTop: 10 }}>Forward-move labels are retrospective research labels only; they are not available to live execution at observation time.</div></section>
  </div>;
}

async function fetchReport() {
  const response = await fetch("/api/export/status", { cache: "no-store" }); const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not build current status snapshot"); return body as CurrentStatusReport;
}
function download(data: string | Blob, filename: string) { const href = typeof data === "string" ? data : URL.createObjectURL(data); const anchor = document.createElement("a"); anchor.href = href; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); if (typeof data !== "string") URL.revokeObjectURL(href); }
function blobDataUrl(blob: Blob) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error ?? new Error("Could not encode PDF")); reader.readAsDataURL(blob); }); }

export function ReportExportMenu() {
  const [open, setOpen] = useState(false); const [report, setReport] = useState<CurrentStatusReport | null>(null); const [busy, setBusy] = useState<"pdf" | "mail" | "json" | null>(null); const [message, setMessage] = useState<string | null>(null); const nodeRef = useRef<HTMLDivElement>(null); const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const close = (event: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  async function ensureReport() { const latest = await fetchReport(); setReport(latest); await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); return latest; }
  async function renderPdf() {
    const latest = await ensureReport();
    if (!nodeRef.current) throw new Error("Export canvas is not ready");
    const [{ toPng }, { PDFDocument }] = await Promise.all([import("html-to-image"), import("pdf-lib")]);
    const image = await toPng(nodeRef.current, { pixelRatio: 1.5, cacheBust: true, backgroundColor: "#f4f7fb" });
    const pngBytes = new Uint8Array(await (await fetch(image)).arrayBuffer());
    const document = await PDFDocument.create();
    const embedded = await document.embedPng(pngBytes);
    const scale = 0.75;
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    const page = document.addPage([width, height]);
    page.drawImage(embedded, { x: 0, y: 0, width, height });
    const pdfBytes = await document.save();
    const buffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
    return { latest, pdf: new Blob([buffer], { type: "application/pdf" }) };
  }
  async function action(kind: "pdf" | "mail" | "json") {
    setBusy(kind); setMessage(null); setOpen(false);
    try {
      if (kind === "json") { const latest = await ensureReport(); download(new Blob([JSON.stringify(latest, null, 2)], { type: "application/json" }), `growing-trader-status-${latest.sessionDate}.json`); setMessage("JSON exported"); return; }
      const { latest, pdf } = await renderPdf();
      if (kind === "pdf") { download(pdf, `growing-trader-status-${latest.sessionDate}.pdf`); setMessage("Snapshot PDF exported"); return; }
      const pdfData = await blobDataUrl(pdf);
      const response = await fetch("/api/export/mail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdfData, requestId: crypto.randomUUID() }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Email delivery failed"); setMessage("Current status PDF sent by mail");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Export failed"); } finally { setBusy(null); }
  }
  return <><div ref={menuRef} style={{ position: "relative" }}><button className="ghost" type="button" onClick={() => setOpen((value) => !value)} disabled={busy !== null}><Icon name="chart" />{busy ? "Exporting…" : "Export"}<span aria-hidden="true">▾</span></button>{open && <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 60, width: 238, padding: 7, border: "1px solid var(--border)", borderRadius: 12, background: "#151a1f", boxShadow: "0 18px 48px rgba(0,0,0,.45)" }}><button type="button" role="menuitem" className="export-menu-item" onClick={() => void action("pdf")}><span>↓</span><div><strong>Export PDF</strong><small>PDF · same current report</small></div></button><button type="button" role="menuitem" className="export-menu-item" onClick={() => void action("mail")}><span>✉</span><div><strong>Send by mail</strong><small>PDF snapshot · Resend</small></div></button><button type="button" role="menuitem" className="export-menu-item" onClick={() => void action("json")}><span>{`{}`}</span><div><strong>Export JSON</strong><small>Machine-readable snapshot</small></div></button></div>}</div>{message && <span style={{ maxWidth: 280, color: /failed|needs|error|too large/i.test(message) ? "var(--red)" : "var(--green)", fontSize: ".68rem" }}>{message}</span>}<div aria-hidden="true" style={{ position: "fixed", left: -12000, top: 0, zIndex: -1, pointerEvents: "none" }}>{report && <ExportReportCard report={report} nodeRef={nodeRef} />}</div></>;
}
