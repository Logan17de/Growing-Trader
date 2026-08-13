import { ThresholdComparison, type ThresholdRow } from "@/components/terminal/ThresholdComparison";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { StrategyParameter } from "@/lib/researchTypes";
import type { PaperEngineStatus, StrategyLevel } from "@/lib/terminalTypes";
import type { SignalPayload } from "@/lib/types";

type Setup = "breakout" | "reversal";

function value(parameters: Map<string, StrategyParameter>, key: string) {
  const found = parameters.get(key)?.value;
  return typeof found === "number" ? found : null;
}

function signed(input: number | null | undefined, digits = 3) {
  return typeof input === "number" && Number.isFinite(input) ? `${input >= 0 ? "+" : ""}${input.toFixed(digits)}` : "—";
}

function decisionFor(setup: Setup, signal: SignalPayload | null, running?: boolean) {
  if (!running) return "BLOCKED";
  if (!signal || signal.event !== setup) return "WAIT";
  if (!signal.risk.allowed) return "BLOCKED";
  if (!signal.contract.contract) return "WAIT";
  return signal.contract.contract.option_type === "CE" ? "LONG CE" : "LONG PE";
}

function statusFor(setup: Setup, signal: SignalPayload | null, running?: boolean) {
  if (!running) return "BLOCKED";
  if (!signal || signal.event !== setup) return "WAITING";
  return signal.risk.allowed ? "ACTIVE" : "BLOCKED";
}

function LiveMetric({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "good" | "bad" | "warn" }) {
  return <div className="strategy-live-metric"><span>{label}</span><strong className={tone}>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function SetupCard({ setup, signal, paper, levels, parameters }: { setup: Setup; signal: SignalPayload | null; paper: PaperEngineStatus; levels: StrategyLevel[]; parameters: Map<string, StrategyParameter> }) {
  const isBreakout = setup === "breakout";
  const mode = paper.mode ?? "paper";
  const activePosition = paper.open_position ?? paper.open_paper_position;
  const status = statusFor(setup, signal, paper.running);
  const decision = decisionFor(setup, signal, paper.running);
  const level = signal?.level.level_name ? levels.find((item) => item.name === signal.level.level_name) : null;
  const contract = signal?.contract.contract ?? null;
  const greeks = contract?.greeks;
  const spread = contract?.bid_price != null && contract.ask_price != null && contract.ltp > 0 ? (contract.ask_price - contract.bid_price) / contract.ltp : null;
  const rows: ThresholdRow[] = [
    { label: isBreakout ? "Breakout score" : "Reversal score", live: isBreakout ? signal?.level.breakout_score : signal?.level.reversal_score, required: value(parameters, isBreakout ? "breakout_threshold" : "reversal_threshold"), operator: ">=" },
    { label: "Signal confidence", live: signal?.confidence, required: value(parameters, "min_signal_confidence"), operator: ">=", liveLabel: signal ? formatPercent(signal.confidence) : "—", requiredLabel: value(parameters, "min_signal_confidence") === null ? "—" : `≥ ${formatPercent(value(parameters, "min_signal_confidence"))}` },
    { label: "Distance from level", live: signal ? Math.abs(signal.level.distance_bps) : null, required: value(parameters, "level_watch_distance_bps"), operator: "<=", liveLabel: signal ? `${Math.abs(signal.level.distance_bps).toFixed(1)} bps` : "—", requiredLabel: value(parameters, "level_watch_distance_bps") === null ? "—" : `≤ ${value(parameters, "level_watch_distance_bps")} bps` },
    { label: "Data age", live: paper.data_age_seconds, required: value(parameters, "max_data_age_seconds"), operator: "<=", liveLabel: typeof paper.data_age_seconds === "number" ? `${paper.data_age_seconds.toFixed(1)}s` : "—", requiredLabel: value(parameters, "max_data_age_seconds") === null ? "—" : `≤ ${value(parameters, "max_data_age_seconds")}s` },
    { label: "Contract spread", live: spread, required: value(parameters, "max_spread_pct"), operator: "<=", liveLabel: spread === null ? "—" : formatPercent(spread), requiredLabel: value(parameters, "max_spread_pct") === null ? "—" : `≤ ${formatPercent(value(parameters, "max_spread_pct"))}` },
  ];

  return <article className={`strategy-setup-card ${status.toLowerCase()}`}>
    <div className="strategy-setup-header">
      <div><p className="eyebrow">Setup {isBreakout ? "01" : "02"}</p><h3>S/R {isBreakout ? "Breakout" : "Reversal"}</h3></div>
      <span className={`setup-status ${status.toLowerCase()}`}><i />{status}</span>
    </div>

    <div className="strategy-status-strip">
      <div><span>Direction</span><strong>{signal?.direction.toUpperCase() ?? "—"}</strong></div>
      <div><span>Confidence</span><strong>{signal ? formatPercent(signal.confidence) : "—"}</strong></div>
      <div><span>Last evaluated</span><strong>{signal ? new Date(signal.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</strong></div>
      <div><span>Current S/R</span><strong>{signal?.level.level_name ?? "No level"}</strong></div>
      <div><span>Distance</span><strong>{signal ? `${signed(signal.level.distance_bps, 1)} bps` : "—"}</strong></div>
    </div>

    <details className="strategy-calculation-details" open={signal?.event === setup}>
      <summary>Live calculations <span>Cash · derivatives · level · contract · risk</span></summary>
      <div className="strategy-input-groups">
        <section><h4>Cash</h4><div className="strategy-live-grid">
          <LiveMetric label="Pressure" value={signed(signal?.cash.pressure)} />
          <LiveMetric label="Breadth" value={signed(signal?.cash.breadth)} detail={`${signal?.cash.advancers ?? "—"} adv / ${signal?.cash.decliners ?? "—"} dec`} />
          <LiveMetric label="Participation" value={signal ? formatPercent(signal.cash.participation) : "—"} />
          <LiveMetric label="Volume acceleration" value={signed(signal?.cash.signed_volume_acceleration)} />
          <LiveMetric label="Heavyweight score" value={signed(signal?.cash.heavyweight_score)} />
          <LiveMetric label="Aggregate volume" value={formatNumber(signal?.cash.share_volume_delta, 0)} detail="constituent shares" />
          <LiveMetric label="Turnover" value={formatCurrency(signal?.cash.turnover_delta)} />
        </div></section>
        <section><h4>Futures</h4><div className="strategy-live-grid">
          <LiveMetric label="Future price" value={formatNumber(paper.future_ltp)} />
          <LiveMetric label="Price direction" value={signed(signal?.futures.price_direction)} />
          <LiveMetric label="Volume activity" value={signed(signal?.futures.volume_activity)} />
          <LiveMetric label="OI confirmation" value={signed(signal?.futures.oi_confirmation)} />
          <LiveMetric label="Basis change" value={signed(signal?.futures.basis_change)} />
          <LiveMetric label="Futures score" value={signed(signal?.futures.score)} />
        </div></section>
        <section><h4>Options + VWAP</h4><div className="strategy-live-grid">
          <LiveMetric label="Direction score" value={signal?.option_market?.ready ? signed(signal.option_market.score) : "Not ready"} />
          <LiveMetric label="CE / PE volume Δ" value={signal?.option_market ? `${formatNumber(signal.option_market.call_volume_delta, 0)} / ${formatNumber(signal.option_market.put_volume_delta, 0)}` : "—"} />
          <LiveMetric label="Volume imbalance" value={signed(signal?.option_market?.volume_imbalance)} />
          <LiveMetric label="CE / PE OI Δ" value={signal?.option_market ? `${formatNumber(signal.option_market.call_oi_delta, 0)} / ${formatNumber(signal.option_market.put_oi_delta, 0)}` : "—"} />
          <LiveMetric label="OI imbalance" value={signed(signal?.option_market?.oi_change_imbalance)} />
          <LiveMetric label="IV skew" value={signed(signal?.option_market?.iv_skew)} detail={`${signal?.option_market?.contracts_used ?? 0} contracts`} />
          <LiveMetric label="Synthetic VWAP" value={formatNumber(signal?.vwap?.synthetic_vwap)} />
          <LiveMetric label="VWAP distance" value={signal?.vwap ? `${signed(signal.vwap.distance_bps, 1)} bps` : "—"} detail={`score ${signed(signal?.vwap?.score)}`} />
        </div></section>
        <section><h4>Level + contract</h4><div className="strategy-live-grid">
          <LiveMetric label="Level" value={signal?.level.level_name ?? "—"} detail={level?.kind ?? "type unavailable"} />
          <LiveMetric label="Penetration" value={signed(signal?.level.penetration)} />
          <LiveMetric label="Rejection" value={signed(signal?.level.rejection)} />
          <LiveMetric label="Persistence" value={signed(signal?.level.persistence)} />
          <LiveMetric label="Breakout / reversal" value={signal ? `${signal.level.breakout_score.toFixed(2)} / ${signal.level.reversal_score.toFixed(2)}` : "—"} />
          <LiveMetric label="Selected contract" value={contract?.trading_symbol ?? "None"} detail={contract ? `${contract.option_type} · ${formatNumber(contract.strike, 0)} · ${contract.expiry ?? "expiry unavailable"}` : signal?.contract.reason} />
          <LiveMetric label="LTP / bid / ask" value={contract ? `${formatNumber(contract.ltp)} / ${formatNumber(contract.bid_price)} / ${formatNumber(contract.ask_price)}` : "—"} detail={spread === null ? "spread unavailable" : `${formatPercent(spread)} spread`} />
          <LiveMetric label="Delta / gamma" value={greeks ? `${signed(greeks.delta)} / ${signed(greeks.gamma)}` : "—"} />
          <LiveMetric label="Theta / IV" value={greeks ? `${signed(greeks.theta)} / ${formatNumber(greeks.iv)}` : "—"} />
          <LiveMetric label="OI / volume" value={contract ? `${formatNumber(contract.open_interest, 0)} / ${formatNumber(contract.volume, 0)}` : "—"} detail={`contract score ${signed(signal?.contract.score)}`} />
        </div></section>
        <section><h4>Risk</h4><div className="strategy-live-grid">
          <LiveMetric label="Risk gate" value={signal ? (signal.risk.allowed ? "ALLOW" : "BLOCK") : "—"} tone={signal ? (signal.risk.allowed ? "good" : "bad") : undefined} />
          <LiveMetric label="Quantity" value={formatNumber(signal?.risk.quantity, 0)} />
          <LiveMetric label="Max premium risk" value={formatCurrency(signal?.risk.max_premium_risk)} />
          <LiveMetric label="Execution" value={mode === "live" ? (paper.live_armed ? "LIVE ARMED" : "LIVE DISARMED") : "PAPER"} tone={mode === "live" ? (paper.live_armed ? "bad" : "warn") : "good"} />
          <LiveMetric label="Current exposure" value={activePosition?.trading_symbol ?? "None"} detail={activePosition?.quantity ? `${activePosition.quantity} quantity` : undefined} />
          <LiveMetric label="Kill switch" value={paper.kill_switch ? "ACTIVE" : "CLEAR"} detail={paper.block_new_entries ? "New entries blocked" : "Normal risk policy"} tone={paper.kill_switch ? "bad" : "good"} />
          <LiveMetric label="Reason" value={signal?.risk.reason ?? "—"} />
        </div></section>
      </div>
    </details>

    <div className="strategy-threshold-section"><h4>Live vs required thresholds</h4><ThresholdComparison rows={rows} /></div>

    <div className={`strategy-decision-box ${decision.toLowerCase().replace(" ", "-")}`}>
      <span>Decision</span><strong>{decision}</strong>
      <ul>{signal?.reasons.length ? signal.reasons.slice(0, 6).map((reason) => <li key={reason}>{reason}</li>) : <li>{paper.running ? "Waiting for a persisted signal evaluation." : `${mode.toUpperCase()} strategy engine is paused.`}</li>}</ul>
    </div>
  </article>;
}

export function StrategyLiveCalculations({ signal, paper, levels, parameters }: { signal: SignalPayload | null; paper: PaperEngineStatus; levels: StrategyLevel[]; parameters: StrategyParameter[] }) {
  const map = new Map(parameters.map((parameter) => [parameter.key, parameter]));
  return <section className="strategy-setup-grid" aria-label="Executable strategy setups">
    <SetupCard setup="breakout" signal={signal} paper={paper} levels={levels} parameters={map} />
    <SetupCard setup="reversal" signal={signal} paper={paper} levels={levels} parameters={map} />
  </section>;
}
