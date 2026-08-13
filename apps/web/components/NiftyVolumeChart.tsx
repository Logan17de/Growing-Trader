"use client";

import { useMemo, useState } from "react";
import { classifyMinuteDirection, formatIndianVolume, summarizeVolumeSession } from "@/lib/marketCalculations";
import type { NiftyVolumePoint } from "@/lib/researchTypes";

export type { NiftyVolumePoint } from "@/lib/researchTypes";

type Overlay = "price" | "score" | "none";

const CHART_WIDTH = 1_000;
const CHART_HEIGHT = 360;
const PLOT = { left: 74, right: 934, top: 24, bottom: 302 };
const PLOT_WIDTH = PLOT.right - PLOT.left;
const PLOT_HEIGHT = PLOT.bottom - PLOT.top;

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatNumber(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toLocaleString("en-IN", { maximumFractionDigits: digits }) : "—";
}

function formatTurnover(value: number) {
  if (!Number.isFinite(value)) return "—";
  const crores = value / 10_000_000;
  return `₹${crores.toLocaleString("en-IN", { maximumFractionDigits: crores >= 10 ? 1 : 2 })}Cr`;
}

function sessionKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function tickIndices(points: NiftyVolumePoint[]) {
  if (points.length <= 1) return [0];
  const desiredMinutes = [555, 600, 660, 720, 780, 840, 900];
  const candidates = desiredMinutes.map((target) => {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    points.forEach((point, index) => {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(point.observed_at));
      const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
      const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
      const distance = Math.abs(hour * 60 + minute - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  });
  return [...new Set([0, ...candidates, points.length - 1])].sort((a, b) => a - b);
}

function linePath(points: NiftyVolumePoint[], overlay: Overlay, step: number) {
  if (overlay === "none" || points.length === 0) return "";
  const values = overlay === "price" ? points.map((point) => point.nifty_ltp) : points.map((point) => point.combined_score);
  const min = overlay === "price" ? Math.min(...values) : -1;
  const max = overlay === "price" ? Math.max(...values) : 1;
  const range = max - min || 1;
  return values.map((value, index) => {
    const x = PLOT.left + index * step + step / 2;
    const y = PLOT.bottom - ((value - min) / range) * PLOT_HEIGHT;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

export default function NiftyVolumeChart({ points }: { points: NiftyVolumePoint[] }) {
  const [overlay, setOverlay] = useState<Overlay>("price");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const sessionPoints = useMemo(() => {
    const latestKey = points.length ? sessionKey(points.at(-1)?.observed_at ?? "") : "";
    return latestKey ? points.filter((point) => sessionKey(point.observed_at) === latestKey) : points;
  }, [points]);

  if (!sessionPoints.length) {
    return (
      <div className="volume-chart-empty">
        <strong>No minute-volume session yet</strong>
        <span>Run the paper engine to collect aggregate NIFTY-50 constituent volume. No values are simulated.</span>
      </div>
    );
  }

  const summary = summarizeVolumeSession(sessionPoints);
  const maxVolume = Math.max(...sessionPoints.map((point) => Math.max(Number(point.constituent_volume_delta) || 0, 0)), 1);
  const step = PLOT_WIDTH / sessionPoints.length;
  const barWidth = Math.max(Math.min(step * 0.76, 10), 1.25);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xTicks = tickIndices(sessionPoints);
  const path = linePath(sessionPoints, overlay, step);
  const latest = sessionPoints.at(-1) as NiftyVolumePoint;
  const hovered = hoveredIndex === null ? null : sessionPoints[hoveredIndex];
  const hoveredPrevious = hoveredIndex !== null && hoveredIndex > 0 ? sessionPoints[hoveredIndex - 1] : null;
  const hoveredDirection = hovered ? classifyMinuteDirection(hovered.nifty_ltp, hoveredPrevious?.nifty_ltp) : "flat";
  const hoveredX = hoveredIndex === null ? 0 : PLOT.left + hoveredIndex * step + step / 2;
  const priceValues = sessionPoints.map((point) => point.nifty_ltp);
  const overlayMin = overlay === "price" ? Math.min(...priceValues) : -1;
  const overlayMax = overlay === "price" ? Math.max(...priceValues) : 1;
  const latestMove = sessionPoints.length > 1 ? latest.nifty_ltp - sessionPoints[sessionPoints.length - 2].nifty_ltp : 0;

  return (
    <div className="intraday-volume-panel">
      <div className="volume-reference-grid" aria-label="Minute volume reference values">
        <div><span>Current 1-min volume</span><strong>{summary.current === null ? "—" : `${formatIndianVolume(summary.current)} shares`}</strong><small>Aggregate constituent volume</small></div>
        <div><span>Average 1-min volume</span><strong>{summary.average === null ? "—" : `${formatIndianVolume(summary.average)} shares`}</strong><small>Current session average</small></div>
        <div><span>Session-relative RVOL</span><strong>{summary.relative === null ? "—" : `${summary.relative.toFixed(2)}x`}</strong><small>Current ÷ session average</small></div>
        <div><span>Session cumulative</span><strong>{summary.cumulative === null ? "—" : `${formatIndianVolume(summary.cumulative)} shares`}</strong><small>Constituent-derived volume</small></div>
        <div><span>Current turnover</span><strong>{summary.currentTurnover === null ? "—" : formatTurnover(summary.currentTurnover)}</strong><small>Latest one-minute interval</small></div>
      </div>

      <div className="volume-chart-toolbar">
        <div>
          <span className="label">One bar = one minute · India Standard Time</span>
          <strong>Aggregate NIFTY-50 constituent volume</strong>
        </div>
        <div className="segmented-control" aria-label="Chart overlay">
          {(["price", "score", "none"] as Overlay[]).map((item) => (
            <button key={item} type="button" className={overlay === item ? "active" : ""} aria-pressed={overlay === item} onClick={() => setOverlay(item)}>
              {item === "price" ? "NIFTY price" : item === "score" ? "Direction score" : "None"}
            </button>
          ))}
        </div>
      </div>

      <div className="volume-chart-shell" onMouseLeave={() => setHoveredIndex(null)}>
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-labelledby="volume-chart-title volume-chart-description">
          <title id="volume-chart-title">One-minute aggregate NIFTY-50 constituent volume</title>
          <desc id="volume-chart-description">Green bars are up-minute volume, red bars are down-minute volume, and gray bars are unchanged. Colors are price-direction proxies, not buyer or seller identity.</desc>

          {yTicks.map((ratio) => {
            const y = PLOT.bottom - ratio * PLOT_HEIGHT;
            return <g key={ratio}><line x1={PLOT.left} x2={PLOT.right} y1={y} y2={y} className="volume-grid-line" /><text x={PLOT.left - 12} y={y + 4} textAnchor="end" className="volume-axis-label">{formatIndianVolume(maxVolume * ratio)}</text></g>;
          })}

          {xTicks.map((index) => {
            const x = PLOT.left + index * step + step / 2;
            return <g key={index}><line x1={x} x2={x} y1={PLOT.bottom} y2={PLOT.bottom + 5} className="volume-axis-tick" /><text x={x} y={PLOT.bottom + 24} textAnchor={index === 0 ? "start" : index === sessionPoints.length - 1 ? "end" : "middle"} className="volume-axis-label">{formatTime(sessionPoints[index].observed_at)}</text></g>;
          })}

          {sessionPoints.map((point, index) => {
            const volume = Math.max(Number(point.constituent_volume_delta) || 0, 0);
            const barHeight = Math.max((volume / maxVolume) * PLOT_HEIGHT, 1);
            const x = PLOT.left + index * step + step / 2 - barWidth / 2;
            const direction = classifyMinuteDirection(point.nifty_ltp, index > 0 ? sessionPoints[index - 1].nifty_ltp : null);
            return <g key={`${point.observed_at}-${index}`}>
              <rect x={x} y={PLOT.bottom - barHeight} width={barWidth} height={barHeight} rx={Math.min(barWidth / 2, 1.8)} className={`volume-bar ${direction}${index === sessionPoints.length - 1 ? " latest" : ""}`} />
              <rect x={PLOT.left + index * step} y={PLOT.top} width={Math.max(step, 2.4)} height={PLOT_HEIGHT} fill="transparent" onMouseEnter={() => setHoveredIndex(index)} onMouseMove={() => setHoveredIndex(index)} onTouchStart={() => setHoveredIndex(index)} />
            </g>;
          })}

          {path && <path d={path} className={`volume-overlay-line ${overlay}`} vectorEffect="non-scaling-stroke" />}

          {overlay !== "none" && yTicks.map((ratio) => {
            const y = PLOT.bottom - ratio * PLOT_HEIGHT;
            const value = overlayMin + (overlayMax - overlayMin) * ratio;
            return <text key={ratio} x={PLOT.right + 12} y={y + 4} className="volume-axis-label">{overlay === "price" ? formatNumber(value, 0) : value.toFixed(1)}</text>;
          })}
        </svg>

        {hovered && <div className={`volume-tooltip${hoveredX > CHART_WIDTH * 0.72 ? " align-right" : ""}`} style={{ left: `${hoveredX / CHART_WIDTH * 100}%` }} role="status">
          <div className="volume-tooltip-head"><strong>{formatTime(hovered.observed_at)}</strong><span className={`direction-chip ${hoveredDirection}`}>{hoveredDirection === "up" ? "Up-minute" : hoveredDirection === "down" ? "Down-minute" : "Unchanged"}</span></div>
          <dl>
            <div><dt>NIFTY</dt><dd>{formatNumber(hovered.nifty_ltp)}</dd></div>
            <div><dt>Minute move</dt><dd className={hoveredDirection === "up" ? "good" : hoveredDirection === "down" ? "bad" : ""}>{hoveredPrevious ? `${hovered.nifty_ltp - hoveredPrevious.nifty_ltp >= 0 ? "+" : ""}${formatNumber(hovered.nifty_ltp - hoveredPrevious.nifty_ltp)}` : "—"}</dd></div>
            <div><dt>1-min volume</dt><dd>{formatIndianVolume(hovered.constituent_volume_delta)} shares</dd></div>
            <div><dt>1-min turnover</dt><dd>{formatTurnover(hovered.constituent_turnover)}</dd></div>
            <div><dt>Breadth score</dt><dd>{hovered.breadth >= 0 ? "+" : ""}{hovered.breadth.toFixed(2)}</dd></div>
            <div><dt>Participation</dt><dd>{(hovered.participation * 100).toFixed(0)}%</dd></div>
            <div><dt>Cash pressure</dt><dd>{hovered.cash_pressure >= 0 ? "+" : ""}{hovered.cash_pressure.toFixed(2)}</dd></div>
            <div><dt>Heavyweight score</dt><dd>{hovered.heavyweight_score >= 0 ? "+" : ""}{hovered.heavyweight_score.toFixed(2)}</dd></div>
            <div><dt>Combined score</dt><dd>{hovered.combined_score >= 0 ? "+" : ""}{hovered.combined_score.toFixed(2)}</dd></div>
          </dl>
          <p>Direction proxy: {hoveredDirection === "up" ? "up-minute / buying pressure" : hoveredDirection === "down" ? "down-minute / selling pressure" : "unchanged"}</p>
        </div>}
      </div>

      <div className="volume-chart-legend">
        <span><i className="up" />Up-minute volume</span>
        <span><i className="down" />Down-minute volume</span>
        <span><i className="flat" />Unchanged</span>
        {overlay !== "none" && <span><i className="line" />{overlay === "price" ? `NIFTY · latest ${formatNumber(latest.nifty_ltp)} (${latestMove >= 0 ? "+" : ""}${formatNumber(latestMove)})` : `Direction score · ${latest.combined_score.toFixed(2)}`}</span>}
      </div>
      <p className="volume-method-note">Green and red classify the NIFTY minute move; they do not identify trade aggressors. Volume is summed from NIFTY-50 constituents and is not exchange-reported NIFTY index volume.</p>
    </div>
  );
}
