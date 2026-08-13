export type NiftyVolumePoint = {
  observed_at: string;
  nifty_ltp: number;
  synthetic_vwap: number | null;
  constituent_volume_delta: number;
  constituent_turnover: number;
  cash_pressure: number;
  breadth: number;
  participation: number;
  heavyweight_score: number;
  futures_score: number;
  option_score: number;
  vwap_score: number;
  combined_score: number;
};

function compact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function crores(value: number) {
  return `₹${(value / 10_000_000).toFixed(value >= 100_000_000 ? 0 : 1)}Cr`;
}

function minuteLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function NiftyVolumeChart({ points, showScore = false }: { points: NiftyVolumePoint[]; showScore?: boolean }) {
  if (!points.length) {
    return (
      <div style={{ minHeight: 260, display: "grid", placeItems: "center", color: "var(--muted)" }}>
        Run the trading engine to start collecting one-minute NIFTY-50 aggregate volume bars.
      </div>
    );
  }

  const width = 1040;
  const height = 330;
  const left = 58;
  const right = 12;
  const plotTop = 18;
  const plotBottom = 280;
  const plotWidth = width - left - right;
  const plotHeight = plotBottom - plotTop;
  const maxVolume = Math.max(...points.map((point) => Number(point.constituent_volume_delta) || 0), 1);
  const step = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(Math.min(step * 0.78, 10), 1.25);
  const gridFractions = [0, 0.25, 0.5, 0.75, 1];
  const labelCount = Math.min(7, points.length);
  const timeIndexes = Array.from(new Set(Array.from({ length: labelCount }, (_, index) => Math.round(index * (points.length - 1) / Math.max(labelCount - 1, 1)))));

  const scorePath = showScore ? points.map((point, index) => {
    const x = left + index * step + step / 2;
    const score = Math.max(-1, Math.min(1, Number(point.combined_score) || 0));
    const y = plotTop + plotHeight / 2 - score * (plotHeight * 0.42);
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ") : "";

  const latest = points[points.length - 1];
  const sessionVolume = points.reduce((sum, point) => sum + Math.max(Number(point.constituent_volume_delta) || 0, 0), 0);

  return (
    <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 22, alignItems: "baseline" }}>
        <div><span className="label">Latest 1m volume</span><strong style={{ display: "block", marginTop: 5 }}>{compact(Number(latest.constituent_volume_delta) || 0)} shares</strong></div>
        <div><span className="label">Session aggregate</span><strong style={{ display: "block", marginTop: 5 }}>{compact(sessionVolume)} shares</strong></div>
        <div><span className="label">Latest 1m turnover</span><strong style={{ display: "block", marginTop: 5 }}>{crores(Number(latest.constituent_turnover) || 0)}</strong></div>
        <div><span className="label">Minute</span><strong style={{ display: "block", marginTop: 5 }}>{minuteLabel(latest.observed_at)}</strong></div>
        {showScore && <div><span className="label">Combined direction</span><strong style={{ display: "block", marginTop: 5 }}>{Number(latest.combined_score).toFixed(3)}</strong></div>}
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface-soft)", padding: "10px 10px 4px", overflow: "hidden" }}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="One-minute aggregate incremental volume across the fifty NIFTY constituents" style={{ display: "block", width: "100%", height: 330 }}>
          {gridFractions.map((fraction) => {
            const y = plotBottom - fraction * plotHeight;
            const value = fraction * maxVolume;
            return <g key={fraction}>
              <line x1={left} x2={width - right} y1={y} y2={y} stroke="rgba(141,154,168,.16)" />
              <text x={left - 8} y={y + 4} textAnchor="end" fill="var(--muted-dim)" fontSize="11">{compact(value)}</text>
            </g>;
          })}
          {points.map((point, index) => {
            const volume = Math.max(Number(point.constituent_volume_delta) || 0, 0);
            const barHeight = (volume / maxVolume) * plotHeight;
            const x = left + index * step + step / 2 - barWidth / 2;
            const previousPrice = index > 0 ? Number(points[index - 1].nifty_ltp) : Number(point.nifty_ltp);
            const currentPrice = Number(point.nifty_ltp);
            const fill = currentPrice > previousPrice ? "rgba(44,196,142,.66)" : currentPrice < previousPrice ? "rgba(240,92,92,.62)" : "rgba(24,211,208,.52)";
            return (
              <rect key={`${point.observed_at}-${index}`} x={x} y={plotBottom - barHeight} width={barWidth} height={Math.max(barHeight, 0.8)} rx={Math.min(barWidth / 2, 1.5)} fill={fill}>
                <title>{`${minuteLabel(point.observed_at)} · ${compact(volume)} shares · NIFTY ${Number(point.nifty_ltp).toFixed(2)}`}</title>
              </rect>
            );
          })}
          {showScore && <path d={scorePath} fill="none" stroke="var(--cyan-bright)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
          {timeIndexes.map((index) => {
            const x = left + index * step + step / 2;
            return <g key={`time-${index}`}>
              <line x1={x} x2={x} y1={plotBottom} y2={plotBottom + 4} stroke="rgba(141,154,168,.32)" />
              <text x={x} y={plotBottom + 21} textAnchor="middle" fill="var(--muted-dim)" fontSize="11">{minuteLabel(points[index].observed_at)}</text>
            </g>;
          })}
          <text x="15" y={(plotTop + plotBottom) / 2} transform={`rotate(-90 15 ${(plotTop + plotBottom) / 2})`} textAnchor="middle" fill="var(--muted-dim)" fontSize="11">1-minute aggregate volume</text>
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, color: "var(--muted-dim)", fontSize: ".72rem", lineHeight: 1.45 }}>
          <span>Each bar = one minute. Green: NIFTY minute up · Red: NIFTY minute down.</span>
          <span>Volume = summed incremental shares across all available NIFTY-50 constituents.</span>
        </div>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: ".76rem" }}>
        This is a synthetic NIFTY-50 participation-volume series derived from constituent trades. The NIFTY index itself does not publish a directly tradable index-volume field.
      </p>
    </div>
  );
}
