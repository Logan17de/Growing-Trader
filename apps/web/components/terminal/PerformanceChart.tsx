import { EmptyState } from "@/components/terminal/EmptyState";
import { formatCurrency } from "@/lib/format";
import type { PaperTrade } from "@/lib/terminalTypes";

export function PerformanceChart({ trades }: { trades: PaperTrade[] }) {
  const ordered = [...trades].filter((trade) => trade.pnl !== null).reverse();
  if (ordered.length === 0) return <EmptyState icon="analytics" title="No realized P&L series" description="The curve will use persisted paper trades once at least one research position closes." />;
  const cumulative = ordered.reduce<number[]>((points, trade) => {
    points.push((points.at(-1) ?? 0) + (trade.pnl as number));
    return points;
  }, [0]);
  const low = Math.min(...cumulative);
  const high = Math.max(...cumulative);
  const range = high - low || 1;
  const coordinates = cumulative.map((value, index) => {
    const x = cumulative.length === 1 ? 0 : index / (cumulative.length - 1) * 100;
    const y = 42 - ((value - low) / range * 36 + 3);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const finalValue = cumulative.at(-1) ?? 0;
  return <div className="performance-chart">
    <div className="chart-head"><div><span className="label">Cumulative realized P&amp;L</span><strong className={finalValue >= 0 ? "good" : "bad"}>{formatCurrency(finalValue)}</strong></div><small>{ordered.length} persisted paper trades</small></div>
    <svg viewBox="0 0 100 46" preserveAspectRatio="none" role="img" aria-label={`Cumulative realized paper P and L ${formatCurrency(finalValue)}`}>
      <path className="chart-grid" d="M0 8H100M0 23H100M0 38H100" />
      <polyline className={finalValue >= 0 ? "positive" : "negative"} points={coordinates} />
    </svg>
    <div className="chart-scale"><span>{formatCurrency(low)}</span><span>{formatCurrency(high)}</span></div>
  </div>;
}
