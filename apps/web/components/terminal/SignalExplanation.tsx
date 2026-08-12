import { EmptyState } from "@/components/terminal/EmptyState";
import { Icon } from "@/components/terminal/Icon";
import { formatNumber, formatPercent } from "@/lib/format";
import type { SignalPayload } from "@/lib/types";
import type { StrategyLevel } from "@/lib/terminalTypes";

export function SignalExplanation({ signal, level }: { signal: SignalPayload | null; level?: StrategyLevel }) {
  if (!signal) return <EmptyState icon="activity" title="No signal recorded" description="A real signal explanation will appear after the engine persists its first observation." />;
  const contract = signal.contract.contract;
  const direction = contract ? `${contract.option_type} · ${contract.trading_symbol}` : `${signal.event} · ${signal.direction}`;
  const reasons = signal.reasons.length > 0 ? signal.reasons : ["The engine did not persist condition-level reasons for this observation."];
  return <div className="signal-explanation">
    <div className="signal-summary">
      <div><span className="label">Signal</span><strong>{direction.toUpperCase()}</strong><small>{contract ? `Strike ${formatNumber(contract.strike, 0)} · LTP ${formatNumber(contract.ltp)}` : "No eligible option contract selected"}</small></div>
      <div className="confidence"><strong>{formatPercent(signal.confidence)}</strong><small>confidence</small></div>
    </div>
    <div className="signal-context-grid">
      <div><span>Level</span><strong>{signal.level.level_name ?? "No active level"}</strong><small>{level ? `${level.kind} · ${formatNumber(level.price)}` : `${formatNumber(signal.level.distance_bps)} bps away`}</small></div>
      <div><span>Market score</span><strong>{formatNumber(signal.combined_direction_score, 3)}</strong><small>{signal.direction}</small></div>
      <div><span>Participation</span><strong>{formatPercent(signal.cash.participation)}</strong><small>{signal.cash.advancers} advancing · {signal.cash.decliners} declining</small></div>
      <div><span>Futures / OI</span><strong>{formatNumber(signal.futures.score, 3)} / {formatNumber(signal.futures.oi_confirmation, 3)}</strong><small>Persisted engine metrics</small></div>
    </div>
    <div className="condition-list" aria-label="Persisted signal reasons">
      {reasons.map((reason, index) => <div key={`${reason}-${index}`}><span className={signal.reasons.length ? "condition-pass" : "condition-neutral"}><Icon name={signal.reasons.length ? "check" : "minus"} /></span><span>{reason}</span></div>)}
    </div>
    <div className={`risk-verdict ${signal.risk.allowed ? "allowed" : "blocked"}`}><Icon name="shield" /><div><span>Risk decision</span><strong>{signal.risk.allowed ? `Allowed · quantity ${signal.risk.quantity}` : "Blocked"}</strong><small>{signal.risk.reason}</small></div></div>
  </div>;
}
