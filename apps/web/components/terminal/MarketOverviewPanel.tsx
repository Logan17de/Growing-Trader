"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/terminal/EmptyState";
import { Icon } from "@/components/terminal/Icon";
import { MetricCard } from "@/components/terminal/MetricCard";
import { jsonRequest } from "@/lib/controlClient";
import { formatCurrency, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import type { ControlCommand, ControlStatus, MarketDetail } from "@/lib/terminalTypes";

export function MarketOverviewPanel({ status, refresh }: { status: ControlStatus; refresh: () => Promise<void> }) {
  const paper = status.paperEngine;
  const [market, setMarket] = useState<MarketDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const basis = typeof paper.future_ltp === "number" && typeof paper.nifty_ltp === "number" ? paper.future_ltp - paper.nifty_ltp : null;
  const deployed = paper.open_paper_position?.entry_price && paper.open_paper_position.quantity ? paper.open_paper_position.entry_price * paper.open_paper_position.quantity : null;
  const strategyEnabled = status.strategyState?.enabled ?? paper.strategy_enabled ?? true;
  const killEnabled = status.riskControl?.kill_switch_enabled ?? paper.kill_switch_enabled ?? false;

  const loadMarket = useCallback(async () => {
    try { setMarket(await jsonRequest<MarketDetail>("/api/control/market")); setDetailError(""); }
    catch (reason) { setDetailError(reason instanceof Error ? reason.message : "Market detail unavailable"); }
  }, []);
  useEffect(() => { void loadMarket(); const timer = window.setInterval(() => void loadMarket(), 10_000); return () => window.clearInterval(timer); }, [loadMarket]);

  async function command(name: ControlCommand) {
    setBusy(name); setNotice("");
    try {
      const result = await jsonRequest<{ duplicate?: boolean }>("/api/control/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: name }) });
      setNotice(result.duplicate ? "That market-collection command is already active." : `${name === "START_PAPER_ENGINE" ? "Market collection start" : "Market collection stop"} queued.`);
      await refresh();
      await loadMarket();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Could not change market collection state"); }
    finally { setBusy(""); }
  }

  const sectors = useMemo(() => {
    const grouped = new Map<string, { count: number; move: number; contribution: number }>();
    for (const item of market?.constituents ?? []) {
      const current = grouped.get(item.sector) ?? { count: 0, move: 0, contribution: 0 };
      current.count += 1; current.move += item.movePct ?? 0; current.contribution += item.weightedContribution ?? 0;
      grouped.set(item.sector, current);
    }
    return [...grouped.entries()].map(([sector, value]) => ({ sector, ...value, averageMove: value.count ? value.move / value.count : 0 })).sort((a, b) => b.contribution - a.contribution);
  }, [market]);

  const canStartCollection = Boolean(status.worker.online && status.credentials.configured && !paper.running && !killEnabled && !busy);
  const canStopCollection = Boolean(status.worker.online && paper.running && !busy);

  return <>
    {notice && <div className="notice" role="status"><Icon name="activity" />{notice}</div>}
    {!strategyEnabled && <div className="notice" role="status"><Icon name="shield" /><span>Strategy is deactivated. Market collection can still run, but the Python risk engine blocks every new paper entry.</span></div>}
    <section className="terminal-metric-grid six" aria-label="Market snapshot">
      <MetricCard label="NIFTY spot" value={formatNumber(paper.nifty_ltp)} detail={paper.last_quote_scan ? `Quote scan ${formatDateTime(paper.last_quote_scan)}` : "Awaiting quote scan"} icon="chart" unavailable={typeof paper.nifty_ltp !== "number"} />
      <MetricCard label="NIFTY futures" value={formatNumber(paper.future_ltp)} detail={paper.future_symbol ?? "Instrument unavailable"} icon="activity" unavailable={typeof paper.future_ltp !== "number"} />
      <MetricCard label="Spot / futures basis" value={basis === null ? undefined : `${basis >= 0 ? "+" : ""}${formatNumber(basis)} pts`} detail="Derived from authenticated spot and futures LTP" tone={basis === null ? "neutral" : basis >= 0 ? "positive" : "negative"} unavailable={basis === null} />
      <MetricCard label="Fresh constituents" value={`${paper.constituents_fresh ?? 0} / ${paper.constituents_total ?? 50}`} detail={`${paper.quote_successes ?? 0} successful quote reads`} icon="positions" />
      <MetricCard label="Option contracts" value={formatNumber(paper.option_contract_count, 0)} detail={paper.option_expiry ? `Expiry ${paper.option_expiry}` : "Expiry unavailable"} icon="orders" unavailable={typeof paper.option_contract_count !== "number"} />
      <MetricCard label="Market exposure" value={formatCurrency(deployed)} detail={deployed === null ? undefined : "Current paper premium deployed"} icon="shield" unavailable={deployed === null} />
      <MetricCard label="50-stock volume" value={formatNumber(paper.whole_nifty_volume_delta, 0)} detail="Latest aggregate share-volume delta" unavailable={typeof paper.whole_nifty_volume_delta !== "number"} />
      <MetricCard label="50-stock turnover" value={formatCurrency(paper.whole_nifty_turnover)} detail="Aggregate constituent turnover" unavailable={typeof paper.whole_nifty_turnover !== "number"} />
      <MetricCard label="Market breadth" value={typeof paper.breadth === "number" ? formatNumber(paper.breadth, 3) : undefined} detail="Engine aggregate breadth score" unavailable={typeof paper.breadth !== "number"} />
      <MetricCard label="Participation" value={typeof paper.participation === "number" ? formatNumber(paper.participation, 3) : undefined} detail="Fresh constituent participation" unavailable={typeof paper.participation !== "number"} />
      <MetricCard label="Synthetic VWAP" value={formatNumber(paper.synthetic_vwap)} detail={typeof paper.vwap_score === "number" ? `VWAP score ${formatNumber(paper.vwap_score, 3)}` : "VWAP score unavailable"} unavailable={typeof paper.synthetic_vwap !== "number"} />
      <MetricCard label="Options activity" value={paper.option_direction_ready ? formatNumber(paper.option_direction_score, 3) : undefined} detail={paper.option_direction_ready ? "Cross-chain direction score" : "Option activity warming or unavailable"} unavailable={!paper.option_direction_ready || typeof paper.option_direction_score !== "number"} />
    </section>

    <section className="dashboard-grid terminal-section">
      <article className="card span-8"><div className="section-heading compact"><div><p className="eyebrow">Market structure</p><h2>Support and resistance</h2></div><span>Dashboard-managed levels</span></div>{status.levels.length === 0 ? <EmptyState icon="layers" title="No active levels" description="Create support and resistance levels from the dashboard. The engine reads the same persisted records." /> : <div className="level-ladder">{status.levels.map((level) => <div key={level.id}><span className={`level-kind ${level.kind}`}>{level.kind}</span><strong>{formatNumber(level.price)}</strong><div><span>{level.name}</span><small>{level.source} · {level.enabled ? "enabled" : "disabled"}</small></div></div>)}</div>}</article>
      <article className="card span-4"><div className="section-heading compact"><div><p className="eyebrow">Data quality</p><h2>Feed health</h2></div></div><div className="diagnostic-list"><div><span>Collection</span><strong className={paper.running ? "good" : "warn"}>{paper.running ? "Running" : "Stopped"}</strong></div><div><span>Strategy entries</span><strong className={strategyEnabled ? "good" : "warn"}>{strategyEnabled ? "Enabled" : "Blocked"}</strong></div><div><span>Feed</span><strong className={paper.feed_connected ? "good" : "warn"}>{paper.feed_connected ? "Connected" : "Waiting"}</strong></div><div><span>Data age</span><strong>{typeof paper.data_age_seconds === "number" ? `${paper.data_age_seconds.toFixed(1)}s` : "Unavailable"}</strong></div><div><span>Weighting</span><strong>{paper.weighting ?? "Unavailable"}</strong></div><div><span>Universe date</span><strong>{paper.universe_as_of ?? "Unavailable"}</strong></div><div><span>Detail snapshot</span><strong>{formatDateTime(market?.observedAt)}</strong></div></div><div className="strategy-actions"><button className="primary" type="button" onClick={() => void command("START_PAPER_ENGINE")} disabled={!canStartCollection}>{busy === "START_PAPER_ENGINE" ? <Icon name="refresh" className="spin" /> : <Icon name="activity" />}{strategyEnabled ? "Start paper engine" : "Start collection only"}</button><button className="secondary" type="button" onClick={() => void command("STOP_PAPER_ENGINE")} disabled={!canStopCollection}><Icon name="stop" />Stop collection</button></div><p className="availability-note">When the strategy is deactivated, starting this runtime collects and persists market data while the risk engine blocks new entries.</p></article>
    </section>

    {detailError && <div className="notice error" role="alert">{detailError}</div>}
    <section className="dashboard-grid terminal-section">
      <article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Derivatives</p><h2>Option chain, PCR &amp; IV</h2></div><span>{market?.optionSummary ? `${market.optionSummary.contracts} contracts` : "Awaiting snapshot"}</span></div>{!market?.optionSummary ? <EmptyState icon="orders" title="No persisted option snapshot yet" description="Start market collection after migration 007. Each valid market frame persists the sanitized option chain used by the strategy." /> : <><div className="terminal-metric-grid two nested"><MetricCard label="OI PCR" value={formatNumber(market.optionSummary.putCallOiRatio, 3)} unavailable={market.optionSummary.putCallOiRatio === null} /><MetricCard label="Volume PCR" value={formatNumber(market.optionSummary.putCallVolumeRatio, 3)} unavailable={market.optionSummary.putCallVolumeRatio === null} /><MetricCard label="Average IV" value={formatNumber(market.optionSummary.averageIv, 2)} unavailable={market.optionSummary.averageIv === null} /><MetricCard label="Put / call OI" value={`${formatNumber(market.optionSummary.putOi, 0)} / ${formatNumber(market.optionSummary.callOi, 0)}`} /></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Strike</th><th>Type</th><th>LTP</th><th>Volume</th><th>OI</th><th>IV</th><th>Delta</th><th>Theta</th><th>Spread</th></tr></thead><tbody>{market.options.map((option) => <tr key={option.tradingSymbol}><td className="numeric">{formatNumber(option.strike)}</td><td><span className={`side-badge ${option.optionType === "CE" ? "buy" : "sell"}`}>{option.optionType}</span></td><td className="numeric">{formatNumber(option.ltp)}</td><td className="numeric">{formatNumber(option.volume, 0)}</td><td className="numeric">{formatNumber(option.openInterest, 0)}</td><td className="numeric">{formatNumber(option.iv, 2)}</td><td className="numeric">{formatNumber(option.delta, 3)}</td><td className="numeric">{formatNumber(option.theta, 2)}</td><td className="numeric">{option.bidPrice !== null && option.askPrice !== null ? formatNumber(option.askPrice - option.bidPrice, 2) : "—"}</td></tr>)}</tbody></table></div></>}</article>
      <article className="card span-6"><div className="section-heading compact"><div><p className="eyebrow">Constituents</p><h2>Movement &amp; sector heatmap</h2></div><span>{market?.constituents.length ?? 0} constituents</span></div>{!market?.constituents.length ? <EmptyState icon="positions" title="No constituent frame yet" description="Constituent movement and sector contribution populate from persisted paper-engine snapshots." /> : <><div className="diagnostic-list">{sectors.map((sector) => <div key={sector.sector}><span>{sector.sector} · {sector.count}</span><strong className={sector.averageMove >= 0 ? "good" : "bad"}>{formatPercent(sector.averageMove)}</strong></div>)}</div><div className="table-scroll"><table className="data-table"><thead><tr><th>Symbol</th><th>Sector</th><th>Move</th><th>Δ volume</th><th>Index weight</th><th>Contribution</th></tr></thead><tbody>{market.constituents.slice(0, 20).map((item) => <tr key={item.symbol}><td><strong>{item.symbol}</strong>{item.isHeavyweight ? " ★" : ""}</td><td>{item.sector}</td><td className={`numeric ${(item.movePct ?? 0) >= 0 ? "good" : "bad"}`}>{formatPercent(item.movePct)}</td><td className="numeric">{formatNumber(item.volumeDelta, 0)}</td><td className="numeric">{formatNumber(item.indexWeight, 3)}</td><td className={`numeric ${(item.weightedContribution ?? 0) >= 0 ? "good" : "bad"}`}>{formatNumber(item.weightedContribution, 5)}</td></tr>)}</tbody></table></div></>}</article>
    </section>
  </>;
}
