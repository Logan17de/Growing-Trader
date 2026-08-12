import { BackendUnavailable, EmptyState } from "@/components/terminal/EmptyState";
import { MetricCard } from "@/components/terminal/MetricCard";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import type { ControlStatus } from "@/lib/terminalTypes";

export function MarketOverviewPanel({ status }: { status: ControlStatus }) {
  const paper = status.paperEngine;
  const basis = typeof paper.future_ltp === "number" && typeof paper.nifty_ltp === "number" ? paper.future_ltp - paper.nifty_ltp : null;
  const deployed = paper.open_paper_position?.entry_price && paper.open_paper_position.quantity
    ? paper.open_paper_position.entry_price * paper.open_paper_position.quantity
    : null;
  return <>
    <section className="terminal-metric-grid six" aria-label="Market snapshot">
      <MetricCard label="NIFTY spot" value={formatNumber(paper.nifty_ltp)} detail={paper.last_quote_scan ? `Quote scan ${formatDateTime(paper.last_quote_scan)}` : "Awaiting quote scan"} icon="chart" unavailable={typeof paper.nifty_ltp !== "number"} />
      <MetricCard label="NIFTY futures" value={formatNumber(paper.future_ltp)} detail={paper.future_symbol ?? "Instrument unavailable"} icon="activity" unavailable={typeof paper.future_ltp !== "number"} />
      <MetricCard label="Spot / futures basis" value={basis === null ? undefined : `${basis >= 0 ? "+" : ""}${formatNumber(basis)} pts`} detail="Derived from authenticated spot and futures LTP" tone={basis === null ? "neutral" : basis >= 0 ? "positive" : "negative"} unavailable={basis === null} />
      <MetricCard label="Fresh constituents" value={`${paper.constituents_fresh ?? 0} / ${paper.constituents_total ?? 50}`} detail={`${paper.quote_successes ?? 0} successful quote reads`} icon="positions" />
      <MetricCard label="Option contracts" value={formatNumber(paper.option_contract_count, 0)} detail={paper.option_expiry ? `Expiry ${paper.option_expiry}` : "Expiry unavailable"} icon="orders" unavailable={typeof paper.option_contract_count !== "number"} />
      <MetricCard label="Market exposure" value={formatCurrency(deployed)} detail={deployed === null ? undefined : "Current paper premium deployed"} icon="shield" unavailable={deployed === null} />
    </section>

    <section className="dashboard-grid terminal-section">
      <article className="card span-8">
        <div className="section-heading compact"><div><p className="eyebrow">Market structure</p><h2>Support and resistance</h2></div><span>Dashboard-managed levels</span></div>
        {status.levels.length === 0 ? <EmptyState icon="layers" title="No active levels" description="Create support and resistance levels from the dashboard. The engine reads the same persisted records." /> : <div className="level-ladder">{status.levels.map((level) => <div key={level.id}><span className={`level-kind ${level.kind}`}>{level.kind}</span><strong>{formatNumber(level.price)}</strong><div><span>{level.name}</span><small>{level.source} · {level.enabled ? "enabled" : "disabled"}</small></div></div>)}</div>}
      </article>
      <article className="card span-4">
        <div className="section-heading compact"><div><p className="eyebrow">Data quality</p><h2>Feed health</h2></div></div>
        <div className="diagnostic-list">
          <div><span>Feed</span><strong className={paper.feed_connected ? "good" : "warn"}>{paper.feed_connected ? "Connected" : "Waiting"}</strong></div>
          <div><span>Data age</span><strong>{typeof paper.data_age_seconds === "number" ? `${paper.data_age_seconds.toFixed(1)}s` : "Unavailable"}</strong></div>
          <div><span>Weighting</span><strong>{paper.weighting ?? "Unavailable"}</strong></div>
          <div><span>Universe date</span><strong>{paper.universe_as_of ?? "Unavailable"}</strong></div>
        </div>
      </article>
    </section>

    <section className="dashboard-grid terminal-section">
      <article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Derivatives</p><h2>Option chain, PCR &amp; IV</h2></div></div><BackendUnavailable title="Option-chain rows are not exposed to the web app" description="The paper worker consumes real chain data for contract selection, but the authenticated status API currently exposes only expiry and contract count. No strikes, OI, PCR, or IV are invented here." /></article>
      <article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Breadth</p><h2>Constituents &amp; sector heatmap</h2></div></div><BackendUnavailable title="Constituent and sector snapshots are not persisted" description="The engine calculates participation and breadth inside each signal, but per-symbol and sector rows are not available through the current storage contract." /></article>
    </section>
  </>;
}
