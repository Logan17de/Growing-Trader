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

export default function NiftyVolumeChart({ points }: { points: NiftyVolumePoint[] }) {
  if (!points.length) {
    return (
      <div style={{ minHeight: 210, display: "grid", placeItems: "center", color: "var(--muted)" }}>
        Run the paper engine to start collecting the 50-stock aggregate volume series.
      </div>
    );
  }

  const width = 900;
  const height = 270;
  const plotTop = 18;
  const plotBottom = 224;
  const plotHeight = plotBottom - plotTop;
  const zeroY = plotTop + plotHeight / 2;
  const maxVolume = Math.max(...points.map((point) => Number(point.constituent_volume_delta) || 0), 1);
  const step = width / Math.max(points.length, 1);
  const barWidth = Math.max(Math.min(step * 0.68, 10), 1.5);

  const scorePath = points
    .map((point, index) => {
      const x = index * step + step / 2;
      const score = Math.max(-1, Math.min(1, Number(point.combined_score) || 0));
      const y = zeroY - score * (plotHeight * 0.45);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const latest = points[points.length - 1];
  const firstTime = new Date(points[0].observed_at);
  const lastTime = new Date(latest.observed_at);

  return (
    <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "baseline" }}>
        <div><span className="label">50-stock volume / scan</span><strong style={{ display: "block", marginTop: 5 }}>{compact(Number(latest.constituent_volume_delta) || 0)} shares</strong></div>
        <div><span className="label">Turnover / scan</span><strong style={{ display: "block", marginTop: 5 }}>{crores(Number(latest.constituent_turnover) || 0)}</strong></div>
        <div><span className="label">Combined direction</span><strong style={{ display: "block", marginTop: 5 }}>{Number(latest.combined_score).toFixed(3)}</strong></div>
        <div><span className="label">Synthetic VWAP</span><strong style={{ display: "block", marginTop: 5 }}>{latest.synthetic_vwap ? Number(latest.synthetic_vwap).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</strong></div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface-soft)", padding: "12px 12px 8px", overflow: "hidden" }}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Aggregate incremental volume across the fifty NIFTY constituents with combined direction score" style={{ display: "block", width: "100%", height: 270 }}>
          <line x1="0" x2={width} y1={plotBottom} y2={plotBottom} stroke="rgba(141,154,168,.22)" />
          <line x1="0" x2={width} y1={zeroY} y2={zeroY} stroke="rgba(141,154,168,.14)" strokeDasharray="5 5" />
          {points.map((point, index) => {
            const volume = Math.max(Number(point.constituent_volume_delta) || 0, 0);
            const barHeight = (volume / maxVolume) * (plotHeight * 0.86);
            const x = index * step + step / 2 - barWidth / 2;
            return (
              <rect
                key={`${point.observed_at}-${index}`}
                x={x}
                y={plotBottom - barHeight}
                width={barWidth}
                height={barHeight}
                rx={Math.min(barWidth / 2, 2)}
                fill="rgba(24,211,208,.32)"
              />
            );
          })}
          <path d={scorePath} fill="none" stroke="var(--cyan-bright)" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
          <text x="4" y={height - 8} fill="var(--muted-dim)" fontSize="12">{Number.isNaN(firstTime.getTime()) ? "" : firstTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text>
          <text x={width - 4} y={height - 8} textAnchor="end" fill="var(--muted-dim)" fontSize="12">{Number.isNaN(lastTime.getTime()) ? "" : lastTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text>
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, color: "var(--muted-dim)", fontSize: ".72rem", lineHeight: 1.45 }}>
          <span>Bars: summed incremental share volume across the 50 constituents.</span>
          <span>Line: combined direction score (−1 → +1).</span>
        </div>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: ".76rem" }}>
        This is a synthetic NIFTY-50 participation series derived from constituent trades. It is not an exchange-reported “NIFTY index volume.”
      </p>
    </div>
  );
}
