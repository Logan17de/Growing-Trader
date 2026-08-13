import { formatIndianVolume, summarizeVolumeSession } from "@/lib/marketCalculations";
import type { NiftyVolumePoint } from "@/lib/researchTypes";
import type { ControlStatus } from "@/lib/terminalTypes";

function turnover(value: number | null) {
  if (value === null) return "—";
  return `₹${(value / 10_000_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}Cr`;
}

export function VolumeAnalytics({ status, points }: { status: ControlStatus; points: NiftyVolumePoint[] }) {
  const summary = summarizeVolumeSession(points);
  const latest = points.at(-1);
  return <section className="card terminal-section volume-analytics-card">
    <div className="section-heading compact"><div><p className="eyebrow">Volume / participation</p><h2>Session activity profile</h2></div><span>Constituent-derived · 1-minute buckets</span></div>
    <div className="volume-analytics-grid">
      <div><span>Current minute</span><strong>{summary.current === null ? "—" : formatIndianVolume(summary.current)}</strong><small>shares</small></div>
      <div><span>Average minute</span><strong>{summary.average === null ? "—" : formatIndianVolume(summary.average)}</strong><small>session average</small></div>
      <div><span>Session-relative RVOL</span><strong>{summary.relative === null ? "—" : `${summary.relative.toFixed(2)}x`}</strong><small>not historical RVOL</small></div>
      <div><span>Cumulative volume</span><strong>{summary.cumulative === null ? "—" : formatIndianVolume(summary.cumulative)}</strong><small>aggregate shares</small></div>
      <div><span>Cumulative turnover</span><strong>{turnover(summary.cumulativeTurnover)}</strong><small>constituent turnover</small></div>
      <div><span>Participation</span><strong>{latest ? `${(latest.participation * 100).toFixed(0)}%` : "—"}</strong><small>activity dispersion</small></div>
      <div><span>Cash pressure</span><strong className={(latest?.cash_pressure ?? 0) >= 0 ? "good" : "bad"}>{latest ? `${latest.cash_pressure >= 0 ? "+" : ""}${latest.cash_pressure.toFixed(2)}` : "—"}</strong><small>directional proxy</small></div>
      <div><span>Heavyweight score</span><strong className={(status.paperEngine.heavyweight_score ?? 0) >= 0 ? "good" : "bad"}>{typeof status.paperEngine.heavyweight_score === "number" ? `${status.paperEngine.heavyweight_score >= 0 ? "+" : ""}${status.paperEngine.heavyweight_score.toFixed(2)}` : "—"}</strong><small>index-driving cohort</small></div>
    </div>
    <p className="availability-note volume-data-boundary">Use the authenticated constituent drill-down below for per-symbol RVOL, volume spikes, sector breadth, heavyweight contribution, and directional pressure proxies.</p>
  </section>;
}
