"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/terminal/Icon";
import { jsonRequest } from "@/lib/controlClient";
import { formatCompact, formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { buildMoveSignature, rankFeatureSeparations, summarizeMarketWatch } from "@/lib/marketWatchAnalytics";
import type { MarketWatchObservation } from "@/lib/researchTypes";

type WindowDays = 1 | 7 | 30 | 90;
type Horizon = 1 | 5 | 15;
type Payload = { days: WindowDays; observationCount: number; recent: MarketWatchObservation[]; bigMoves: MarketWatchObservation[] };

function signed(value: number | null | undefined, suffix = "", digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${formatNumber(value, digits)}${suffix}`;
}

function tone(value: number | null | undefined) {
  return (value ?? 0) > 0 ? "good" : (value ?? 0) < 0 ? "bad" : "";
}

function outcome(row: MarketWatchObservation, horizon: Horizon) {
  return horizon === 1 ? row.nifty_move_1m_bps : horizon === 5 ? row.nifty_move_5m_bps : row.nifty_move_15m_bps;
}

function FeatureGrid({ row }: { row: MarketWatchObservation | undefined }) {
  if (!row) return <p className="muted">Waiting for the first market-watch observation.</p>;
  return <div className="market-secondary-grid">
    <div><span>NIFTY</span><strong>{formatNumber(row.nifty_ltp, 2)}</strong><small>{signed(row.vwap_distance_bps, " bps")} vs synthetic VWAP</small></div>
    <div><span>50-stock Δ volume</span><strong>{formatCompact(row.constituent_volume_delta)}</strong><small>{formatCurrency(row.constituent_turnover)} turnover</small></div>
    <div><span>Cash pressure</span><strong className={tone(row.cash_pressure)}>{signed(row.cash_pressure)}</strong><small>Breadth {signed(row.breadth)} · participation {formatPercent(row.participation)}</small></div>
    <div><span>Heavyweights</span><strong className={tone(row.heavyweight_score)}>{signed(row.heavyweight_score)}</strong><small>Index-leadership proxy</small></div>
    <div><span>Futures move</span><strong className={tone(row.futures_move_bps)}>{signed(row.futures_move_bps, " bps")}</strong><small>Δ volume {formatCompact(row.futures_volume_delta)}</small></div>
    <div><span>Futures OI</span><strong className={tone(row.futures_oi_change_pct)}>{signed(row.futures_oi_change_pct, "%")}</strong><small>Basis {signed(row.futures_basis_points, " pts")}</small></div>
    <div><span>Futures score</span><strong className={tone(row.futures_score)}>{signed(row.futures_score)}</strong><small>Price + activity + OI + basis</small></div>
    <div><span>Options activity</span><strong className={tone(row.option_score)}>{signed(row.option_score)}</strong><small>Volume imbalance {signed(row.option_volume_imbalance)}</small></div>
    <div><span>Options OI change</span><strong className={tone(row.option_oi_change_imbalance)}>{signed(row.option_oi_change_imbalance)}</strong><small>IV skew {signed(row.option_iv_skew)}</small></div>
    <div><span>Combined score</span><strong className={tone(row.combined_direction_score)}>{signed(row.combined_direction_score)}</strong><small>{row.direction?.toUpperCase() ?? "FLAT"} · {formatPercent(row.confidence)}</small></div>
  </div>;
}

export function MarketWatchPanel() {
  const [days, setDays] = useState<WindowDays>(30);
  const [horizon, setHorizon] = useState<Horizon>(15);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const payload = await jsonRequest<Payload>(`/api/control/market-watch?days=${days}`);
        if (mounted) { setData(payload); setError(""); }
      } catch (requestError) {
        if (mounted) setError(requestError instanceof Error ? requestError.message : "Market Watch could not be loaded");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [days]);

  const recent = data?.recent ?? [];
  const bigMoves = data?.bigMoves ?? [];
  const latest = recent[0];
  const coverage = useMemo(() => summarizeMarketWatch(recent), [recent]);
  const bullish = useMemo(() => buildMoveSignature(bigMoves, "bullish", horizon), [bigMoves, horizon]);
  const bearish = useMemo(() => buildMoveSignature(bigMoves, "bearish", horizon), [bigMoves, horizon]);
  const separations = useMemo(() => rankFeatureSeparations(bigMoves, horizon).filter((item) => item.separation != null).slice(0, 8), [bigMoves, horizon]);

  return <>
    {error && <div className="notice error" role="alert"><Icon name="x" />{error}</div>}

    <section className="card terminal-section">
      <div className="section-heading compact"><div><p className="eyebrow">Research layer · never executes orders</p><h2>Market Watch / Strategy Discovery</h2></div><span className="status-badge good">OBSERVE → LABEL → STUDY</span></div>
      <p className="muted threshold-intro">This is deliberately separate from S/R Breakout and S/R Reversal. Oracle continuously records market state; retrospective labels tell us what NIFTY did afterward. We use repeated patterns here to form new strategy hypotheses, then validate them in Replay/PAPER before they can ever become executable.</p>
      <div className="segmented-control large" aria-label="Market Watch history window">
        {([[1,"Today"],[7,"7 days"],[30,"30 days"],[90,"90 days"]] as Array<[WindowDays,string]>).map(([value,label]) => <button type="button" key={value} className={days===value?"active":""} aria-pressed={days===value} onClick={()=>setDays(value)}>{label}</button>)}
      </div>
      <section className="market-secondary-grid" aria-label="Research dataset coverage">
        <div><span>Observations in DB</span><strong>{data?.observationCount ?? 0}</strong><small>Selected {days}-day window</small></div>
        <div><span>Rows loaded live</span><strong>{coverage.observations}</strong><small>Latest observations for inspection</small></div>
        <div><span>Sessions represented</span><strong>{coverage.sessions}</strong><small>In loaded observation slice</small></div>
        <div><span>15m labels ready</span><strong>{coverage.labeled15m}</strong><small>Future outcome known</small></div>
        <div><span>Big-move windows</span><strong>{bigMoves.length}</strong><small>Research threshold crossings</small></div>
        <div><span>Latest sample</span><strong>{latest ? new Date(latest.observed_at).toLocaleTimeString("en-IN") : loading ? "Loading…" : "—"}</strong><small>{latest?.event?.replaceAll("_"," ") ?? "Waiting"}</small></div>
      </section>
    </section>

    <section className="card terminal-section">
      <div className="section-heading compact"><div><p className="eyebrow">Current cross-market state</p><h2>What the recorder sees now</h2></div><span>{latest ? new Date(latest.observed_at).toLocaleString("en-IN") : "No sample"}</span></div>
      <FeatureGrid row={latest} />
      <p className="availability-note">Volume/OI labels are market-state features, not proof of institutional buyer/seller identity. Green/red only reflects signed proxies or subsequent NIFTY direction.</p>
    </section>

    <section className="dashboard-grid terminal-section">
      <article className="card span-6">
        <div className="section-heading compact"><div><p className="eyebrow">Descriptive signature</p><h2>Bullish big moves</h2></div><span>{bullish.count} labeled windows</span></div>
        <div className="diagnostic-list">
          <div><span>Cash pressure</span><strong className="good">{signed(bullish.features.cash_pressure)}</strong></div>
          <div><span>Breadth</span><strong>{signed(bullish.features.breadth)}</strong></div>
          <div><span>Heavyweights</span><strong>{signed(bullish.features.heavyweight_score)}</strong></div>
          <div><span>Futures score</span><strong>{signed(bullish.features.futures_score)}</strong></div>
          <div><span>Futures OI change</span><strong>{signed(bullish.features.futures_oi_change_pct, "%")}</strong></div>
          <div><span>Options score</span><strong>{signed(bullish.features.option_score)}</strong></div>
          <div><span>Options OI imbalance</span><strong>{signed(bullish.features.option_oi_change_imbalance)}</strong></div>
          <div><span>VWAP distance</span><strong>{signed(bullish.features.vwap_distance_bps, " bps")}</strong></div>
        </div>
      </article>
      <article className="card span-6">
        <div className="section-heading compact"><div><p className="eyebrow">Descriptive signature</p><h2>Bearish big moves</h2></div><span>{bearish.count} labeled windows</span></div>
        <div className="diagnostic-list">
          <div><span>Cash pressure</span><strong className="bad">{signed(bearish.features.cash_pressure)}</strong></div>
          <div><span>Breadth</span><strong>{signed(bearish.features.breadth)}</strong></div>
          <div><span>Heavyweights</span><strong>{signed(bearish.features.heavyweight_score)}</strong></div>
          <div><span>Futures score</span><strong>{signed(bearish.features.futures_score)}</strong></div>
          <div><span>Futures OI change</span><strong>{signed(bearish.features.futures_oi_change_pct, "%")}</strong></div>
          <div><span>Options score</span><strong>{signed(bearish.features.option_score)}</strong></div>
          <div><span>Options OI imbalance</span><strong>{signed(bearish.features.option_oi_change_imbalance)}</strong></div>
          <div><span>VWAP distance</span><strong>{signed(bearish.features.vwap_distance_bps, " bps")}</strong></div>
        </div>
      </article>
    </section>

    <section className="card terminal-section">
      <div className="section-heading compact"><div><p className="eyebrow">Strategy-discovery aid</p><h2>Features separating bullish vs bearish big-move windows</h2></div><div className="segmented-control"><button type="button" className={horizon===1?"active":""} onClick={()=>setHorizon(1)}>1m</button><button type="button" className={horizon===5?"active":""} onClick={()=>setHorizon(5)}>5m</button><button type="button" className={horizon===15?"active":""} onClick={()=>setHorizon(15)}>15m</button></div></div>
      {separations.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Feature</th><th>Bullish avg</th><th>Bearish avg</th><th>Difference</th><th>Use</th></tr></thead><tbody>{separations.map((item)=><tr key={item.key}><td><strong>{item.label}</strong></td><td className="numeric good">{signed(item.bullish)}</td><td className="numeric bad">{signed(item.bearish)}</td><td className={`numeric ${tone(item.separation)}`}>{signed(item.separation)}</td><td>Candidate research feature</td></tr>)}</tbody></table></div> : <p className="muted">We need both bullish and bearish labeled big-move windows before feature separation becomes meaningful.</p>}
      <p className="availability-note">This ranking is descriptive, not proof of predictive power. Promote a pattern only after enough samples, replay, out-of-sample testing, and PAPER validation.</p>
    </section>

    <section className="card terminal-section">
      <div className="section-heading compact"><div><p className="eyebrow">Labeled evidence</p><h2>Recent big-move windows</h2></div><span>{horizon}-minute outcome selected</span></div>
      {bigMoves.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Observed</th><th>NIFTY</th><th>{horizon}m outcome</th><th>Max up 15m</th><th>Max down 15m</th><th>Cash</th><th>Breadth</th><th>Heavyweights</th><th>Futures</th><th>Fut OI</th><th>Options</th><th>Opt OI</th><th>Volume</th></tr></thead><tbody>{bigMoves.slice(0,40).map((row)=><tr key={row.observed_at}><td>{new Date(row.observed_at).toLocaleString("en-IN")}</td><td className="numeric">{formatNumber(row.nifty_ltp,2)}</td><td className={`numeric ${tone(outcome(row,horizon))}`}>{signed(outcome(row,horizon)," bps")}</td><td className="numeric good">{signed(row.max_up_15m_bps," bps")}</td><td className="numeric bad">{signed(row.max_down_15m_bps," bps")}</td><td className="numeric">{signed(row.cash_pressure)}</td><td className="numeric">{signed(row.breadth)}</td><td className="numeric">{signed(row.heavyweight_score)}</td><td className="numeric">{signed(row.futures_score)}</td><td className="numeric">{signed(row.futures_oi_change_pct,"%")}</td><td className="numeric">{signed(row.option_score)}</td><td className="numeric">{signed(row.option_oi_change_imbalance)}</td><td className="numeric">{formatCompact(row.constituent_volume_delta)}</td></tr>)}</tbody></table></div> : <p className="muted">No notable moves crossed the current research thresholds in this window.</p>}
      <p className="availability-note">Machine-readable evidence is exported every weekday at 15:25 IST as JSONL GitHub Actions artifacts for 90 days. The raw Supabase snapshot history remains the source of truth.</p>
    </section>

    <section className="card terminal-section">
      <div className="section-heading compact"><div><p className="eyebrow">Research workflow</p><h2>How a new strategy gets created</h2></div></div>
      <div className="diagnostic-list">
        <div><span>1 · Observe</span><strong>Market Watch records every cross-market state</strong></div>
        <div><span>2 · Label</span><strong>NIFTY 1/3/5/10/15m outcomes are attached retrospectively</strong></div>
        <div><span>3 · Discover</span><strong>Repeated volume + futures + OI + options structures become hypotheses</strong></div>
        <div><span>4 · Validate</span><strong>Replay → out-of-sample → PAPER</strong></div>
        <div><span>5 · Promote</span><strong>Only validated rules become Strategy #3, #4…</strong></div>
      </div>
    </section>
  </>;
}
