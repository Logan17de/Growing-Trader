import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { buildCurrentStatusReport, type CurrentStatusReport } from "@/lib/currentStatusReport";

export const dynamic = "force-dynamic";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function money(value: number | null | undefined, signed = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}₹${Math.round(value).toLocaleString("en-IN")}`;
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

function reportHtml(report: CurrentStatusReport) {
  const tone = report.summary.dailyPnl >= 0 ? "#16a765" : "#e8453c";
  const monthlyTone = report.summary.monthlyPnl >= 0 ? "#16a765" : "#e8453c";
  const strategies = report.strategies.filter((row) => row.trades > 0).map((row) => `<tr><td style="padding:8px;border-bottom:1px solid #e9eef5">${escapeHtml(row.strategy)}</td><td style="padding:8px;border-bottom:1px solid #e9eef5;text-align:right">${row.trades}</td><td style="padding:8px;border-bottom:1px solid #e9eef5;text-align:right">${percent(row.winRate)}</td><td style="padding:8px;border-bottom:1px solid #e9eef5;text-align:right;font-weight:700">${money(row.pnl, true)}</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f3f6fa;font-family:Arial,sans-serif;color:#10243f"><div style="max-width:1120px;margin:0 auto;padding:24px">
    <div style="background:#071d35;border-radius:14px;padding:20px;color:white"><div style="font-size:22px;font-weight:800">📊 Growing Trader · Current Status Snapshot</div><div style="margin-top:5px;color:#c7d4e4">Generated ${escapeHtml(new Date(report.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))} IST · ${report.mode.toUpperCase()}${report.mode === "live" ? report.modeArmed ? " · ARMED" : " · DISARMED" : ""}</div>
    <table role="presentation" style="width:100%;margin-top:18px;border-collapse:collapse"><tr><td style="padding:12px"><small>NET P&amp;L</small><div style="font-size:25px;font-weight:800;color:${tone}">${money(report.summary.dailyPnl, true)}</div></td><td style="padding:12px"><small>MONTHLY P&amp;L</small><div style="font-size:25px;font-weight:800;color:${monthlyTone}">${money(report.summary.monthlyPnl, true)}</div></td><td style="padding:12px"><small>TRADES</small><div style="font-size:25px;font-weight:800">${report.summary.trades}</div></td><td style="padding:12px"><small>WIN RATE</small><div style="font-size:25px;font-weight:800">${percent(report.summary.winRate)}</div></td></tr></table></div>
    <div style="margin-top:18px;background:#eef6ff;border:1px solid #d6e8ff;border-radius:14px;padding:16px;color:#27486c"><strong>Full visual report attached as PDF.</strong><div style="margin-top:5px;font-size:12px">The PDF is generated from the same current-status report used by the Export PDF action in the app.</div></div>
    <div style="margin-top:18px;background:white;border:1px solid #dfe7f1;border-radius:14px;padding:18px"><div style="font-size:16px;font-weight:800;margin-bottom:10px">Strategy performance</div><table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px"><tr style="background:#f6f9fc"><th style="padding:8px;text-align:left">Strategy</th><th style="padding:8px;text-align:right">Trades</th><th style="padding:8px;text-align:right">Win rate</th><th style="padding:8px;text-align:right">P&amp;L</th></tr>${strategies || '<tr><td colspan="4" style="padding:12px;color:#667085">No realized strategy trades yet today.</td></tr>'}</table></div>
    <div style="margin-top:18px;background:white;border:1px solid #dfe7f1;border-radius:14px;padding:18px;font-size:13px"><strong>Market:</strong> NIFTY ${report.market.nifty ?? "—"} · 1m volume ${Math.round(report.market.minuteVolume).toLocaleString("en-IN")} · session volume ${Math.round(report.market.sessionVolume).toLocaleString("en-IN")} · breadth ${percent(report.market.breadth)} · participation ${percent(report.market.participation)}<br><br><strong>Safety:</strong> broker ${report.safety.brokerFlat === true ? "flat" : report.safety.brokerFlat === false ? "NOT flat" : "audit unavailable"} · unresolved LIVE orders ${report.safety.unresolvedLiveOrders} · kill switch ${report.safety.killSwitch ? "ACTIVE" : "clear"} · engine ${escapeHtml(report.safety.engineState ?? "—")}</div>
    <div style="margin-top:16px;color:#8491a3;font-size:11px;text-align:center">Manual current-status export. PAPER and LIVE remain separate. NIFTY volume is constituent-derived.</div>
  </div></body></html>`;
}

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.TRADING_REPORT_TO?.trim();
  const from = process.env.TRADING_REPORT_FROM?.trim();
  if (!apiKey || !to || !from) {
    return Response.json({ error: "Manual mail export needs RESEND_API_KEY, TRADING_REPORT_TO and TRADING_REPORT_FROM in the Vercel project environment." }, { status: 503 });
  }
  try {
    const body = await request.json().catch(() => ({})) as { pdfData?: unknown; requestId?: unknown };
    const pdfData = typeof body.pdfData === "string" && body.pdfData.startsWith("data:application/pdf;base64,") ? body.pdfData : null;
    if (!pdfData) return Response.json({ error: "PDF snapshot is missing. Refresh the app and try again." }, { status: 400 });
    if (pdfData.length > 10_000_000) return Response.json({ error: "snapshot PDF is too large" }, { status: 413 });
    const requestId = typeof body.requestId === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(body.requestId) ? body.requestId : crypto.randomUUID();
    const report = await buildCurrentStatusReport();
    const attachments: Array<Record<string, string>> = [
      { filename: `growing-trader-status-${report.sessionDate}.pdf`, content: pdfData.slice("data:application/pdf;base64,".length), content_type: "application/pdf" },
      { filename: `growing-trader-status-${report.sessionDate}.json`, content: Buffer.from(JSON.stringify(report, null, 2)).toString("base64"), content_type: "application/json" },
    ];
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `growing-trader-manual-${requestId}` },
      body: JSON.stringify({ from, to: [to], subject: `📊 Growing Trader Current Status — ${report.sessionDate}`, html: reportHtml(report), attachments }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(`Resend ${response.status}: ${String(result.message ?? result.name ?? "delivery failed")}`);
    return Response.json({ ok: true, id: result.id ?? null, generatedAt: report.generatedAt });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "manual report email failed" }, { status: 503 });
  }
}
