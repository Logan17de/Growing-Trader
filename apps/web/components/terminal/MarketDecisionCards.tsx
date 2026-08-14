import { formatIndianVolume, latestContinuousRun, summarizeVolumeSession } from "@/lib/marketCalculations";
import type { NiftyVolumePoint } from "@/lib/researchTypes";
import { formatNumber, formatPercent } from "@/lib/format";
import type { ControlStatus } from "@/lib/terminalTypes";

function biasFromScore(score?: number) {
  if (typeof score !== "number") return { label: "Unavailable", tone: "neutral" };
  if (score >= 0.2) return { label: "Bullish", tone: "positive" };
  if (score <= -0.2) return { label: "Bearish", tone: "negative" };
  return { label: "Neutral", tone: "neutral" };
}

export function MarketDecisionCards({ status, points }: { status: ControlStatus | null; points: NiftyVolumePoint[] }) {
  const paper = status?.paperEngine ?? {};
  const latestSignal = status?.latestSignal?.payload ?? null;
  const currentRun = latestContinuousRun(points);
  const volume = summarizeVolumeSession(currentRun);
  const first = currentRun[0];
  const latest = currentRun.at(-1);
  const move = latest && first ? latest.nifty_ltp - first.nifty_ltp : null;
  const movePercent = move !== null && first.nifty_ltp ? move / first.nifty_ltp : null;
  const vwapDistance = typeof paper.nifty_ltp === "number" && typeof paper.synthetic_vwap === "number" && paper.synthetic_vwap > 0
    ? (paper.nifty_ltp / paper.synthetic_vwap - 1) * 10_000
    : null;
  const activity = volume.relative === null ? "Unavailable" : volume.relative >= 1.5 ? "High activity" : volume.relative < 0.75 ? "Low activity" : "Normal activity";
  const advancers = latestSignal?.cash.advancers;
  const decliners = latestSignal?.cash.decliners;
  const breadthTotal = (advancers ?? 0) + (decliners ?? 0);
  const advancingShare = breadthTotal > 0 ? (advancers ?? 0) / breadthTotal : 0.5;
  const bias = biasFromScore(paper.combined_direction_score);

  return <section className="market-decision-grid" aria-label="Primary market snapshot">
    <article className={`market-decision-card ${move !== null && move < 0 ? "negative" : "positive"}`}>
      <div className="market-decision-head"><span>NIFTY</span><span className="market-card-tag">Spot</span></div>
      <strong>{formatNumber(paper.nifty_ltp)}</strong>
      <div className="market-decision-change">
        <span className={move !== null && move < 0 ? "bad" : "good"}>{move === null ? "—" : `${move >= 0 ? "+" : ""}${formatNumber(move)} pts`}</span>
        <span>{movePercent === null ? "—" : formatPercent(movePercent)}</span>
      </div>
      <small>{vwapDistance === null ? "Synthetic VWAP unavailable" : `${Math.abs(vwapDistance).toFixed(1)} bps ${vwapDistance >= 0 ? "above" : "below"} synthetic VWAP`}</small>
    </article>

    <article className="market-decision-card volume">
      <div className="market-decision-head"><span>Current 1-min volume</span><span className="market-card-tag">50 stocks</span></div>
      <strong>{volume.current === null ? "—" : formatIndianVolume(volume.current)}</strong>
      <div className="market-decision-change"><span>{volume.relative === null ? "—" : `${volume.relative.toFixed(2)}x`}</span><span>current run average</span></div>
      <small>{activity} · aggregate constituent shares</small>
    </article>

    <article className="market-decision-card breadth">
      <div className="market-decision-head"><span>Market breadth</span><span className="market-card-tag">Cash</span></div>
      <strong>{typeof advancers === "number" && typeof decliners === "number" ? `${advancers} / ${decliners}` : "—"}</strong>
      <div className="breadth-meter" aria-label={`${advancers ?? 0} advancers and ${decliners ?? 0} decliners`}><i style={{ width: `${advancingShare * 100}%` }} /><b style={{ width: `${(1 - advancingShare) * 100}%` }} /></div>
      <small>{typeof paper.breadth === "number" ? `Breadth score ${paper.breadth >= 0 ? "+" : ""}${paper.breadth.toFixed(2)}` : "Advancers / decliners unavailable"}</small>
    </article>

    <article className={`market-decision-card bias ${bias.tone}`}>
      <div className="market-decision-head"><span>Market bias</span><span className="market-card-tag">Decision</span></div>
      <strong>{bias.label}</strong>
      <div className="market-decision-change"><span>{typeof paper.combined_direction_score === "number" ? `${paper.combined_direction_score >= 0 ? "+" : ""}${paper.combined_direction_score.toFixed(2)}` : "—"}</span><span>{latestSignal ? `${formatPercent(latestSignal.confidence)} confidence` : "No signal"}</span></div>
      <small>Risk {latestSignal ? (latestSignal.risk.allowed ? "ALLOW" : "BLOCK") : "unavailable"}</small>
    </article>
  </section>;
}
