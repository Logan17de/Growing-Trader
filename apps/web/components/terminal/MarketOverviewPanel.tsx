"use client";

import { useEffect, useMemo, useState } from "react";
import NiftyVolumeChart, { type NiftyVolumePoint } from "@/components/NiftyVolumeChart";
import { EmptyState } from "@/components/terminal/EmptyState";
import { MarketDecisionCards } from "@/components/terminal/MarketDecisionCards";
import { VolumeAnalytics } from "@/components/terminal/VolumeAnalytics";
import { jsonRequest } from "@/lib/controlClient";
import { formatCompact, formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { ControlStatus } from "@/lib/terminalTypes";

type Constituent = {
  observed_at: string;
  symbol: string;
  sector: string | null;
  price: number;
  previous_price: number;
  move_pct: number;
  cumulative_volume: number;
  volume_delta: number;
  volume_rate: number;
  relative_volume: number;
  index_weight: number;
  is_heavyweight: boolean;
};

type OptionRow = {
  observed_at: string;
  expiry: string;
  underlying_ltp: number | null;
  strike: number;
  option_type: "CE" | "PE";
  trading_symbol: string;
  ltp: number;
  open_interest: number;
  volume: number;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  iv: number | null;
  bid_price: number | null;
  ask_price: number | null;
};

type MarketPayload = {
  constituents: Constituent[];
  optionChain: OptionRow[];
  summary: {
    constituentObservedAt: string | null;
    optionObservedAt: string | null;
    pcrOi: number | null;
    pcrVolume: number | null;
    callIv: number | null;
    putIv: number | null;
  };
};

type ResearchPayload = { niftyVolumeSeries: NiftyVolumePoint[] };
type SortKey = "symbol" | "move_pct" | "volume_delta" | "relative_volume" | "index_weight";

function PressureList({ rows, empty }: { rows: Constituent[]; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return <div className="diagnostic-list pressure-list">{rows.map((row) => <div key={row.symbol}><span><strong>{row.symbol}</strong><small>{row.sector ?? "Other"}</small></span><strong className={row.move_pct >= 0 ? "good" : "bad"}>{row.move_pct >= 0 ? "+" : ""}{formatNumber(row.move_pct)}% · {formatNumber(row.relative_volume, 2)}× RVOL</strong></div>)}</div>;
}

export function MarketOverviewPanel({ status }: { status: ControlStatus }) {
  const paper = status.paperEngine;
  const signal = status.latestSignal?.payload ?? null;
  const [detail, setDetail] = useState<MarketPayload | null>(null);
  const [volume, setVolume] = useState<NiftyVolumePoint[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("move_pct");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [market, research] = await Promise.all([
          jsonRequest<MarketPayload>("/api/control/market"),
          jsonRequest<ResearchPayload>("/api/control/research"),
        ]);
        if (mounted) {
          setDetail(market);
          setVolume(research.niftyVolumeSeries ?? []);
          setError("");
        }
      } catch (requestError) {
        if (mounted) setError(requestError instanceof Error ? requestError.message : "Market detail unavailable");
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const rows = detail?.constituents ?? [];
  const sectors = useMemo(() => {
    const map = new Map<string, { move: number; count: number; volume: number }>();
    for (const row of rows) {
      const key = row.sector ?? "Other";
      const item = map.get(key) ?? { move: 0, count: 0, volume: 0 };
      item.move += row.move_pct;
      item.count += 1;
      item.volume += row.volume_delta;
      map.set(key, item);
    }
    return [...map.entries()].map(([name, item]) => ({ name, move: item.count ? item.move / item.count : 0, volume: item.volume, count: item.count })).sort((a, b) => b.move - a.move);
  }, [rows]);

  const buyingPressure = useMemo(() => rows.filter((row) => row.move_pct > 0).sort((a, b) => (b.move_pct * Math.max(b.relative_volume, 0)) - (a.move_pct * Math.max(a.relative_volume, 0))).slice(0, 5), [rows]);
  const sellingPressure = useMemo(() => rows.filter((row) => row.move_pct < 0).sort((a, b) => (a.move_pct * Math.max(a.relative_volume, 0)) - (b.move_pct * Math.max(b.relative_volume, 0))).slice(0, 5), [rows]);
  const volumeSpikes = useMemo(() => [...rows].sort((a, b) => b.relative_volume - a.relative_volume || b.volume_delta - a.volume_delta).slice(0, 5), [rows]);
  const heavyweights = useMemo(() => rows.filter((row) => row.is_heavyweight).sort((a, b) => (Math.abs(b.move_pct) * b.index_weight) - (Math.abs(a.move_pct) * a.index_weight)).slice(0, 5), [rows]);
  const sectorNames = useMemo(() => [...new Set(rows.map((row) => row.sector ?? "Other"))].sort(), [rows]);

  const tapeRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = rows.filter((row) => (sector === "all" || (row.sector ?? "Other") === sector) && (!query || row.symbol.toLowerCase().includes(query) || (row.sector ?? "Other").toLowerCase().includes(query)));
    return [...filtered].sort((a, b) => {
      const left = sortKey === "symbol" ? a.symbol : a[sortKey];
      const right = sortKey === "symbol" ? b.symbol : b[sortKey];
      const comparison = typeof left === "string" ? left.localeCompare(String(right)) : Number(left) - Number(right);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [rows, search, sector, sortDirection, sortKey]);

  function changeSort(key: SortKey) {
    if (sortKey === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDirection(key === "symbol" ? "asc" : "desc");
    }
  }

  const basis = typeof paper.nifty_ltp === "number" && typeof paper.future_ltp === "number" ? paper.future_ltp - paper.nifty_ltp : null;
  const sortMark = (key: SortKey) => sortKey === key ? (sortDirection === "asc" ? " ↑" : " ↓") : "";

  return <>
    {error && <div className="notice error" role="alert">Market telemetry could not be refreshed: {error}</div>}
    <MarketDecisionCards status={status} points={volume} />

    <section className="card terminal-section market-volume-card">
      <div className="section-heading compact"><div><p className="eyebrow">Intraday participation</p><h2>NIFTY minute volume</h2></div><span>Price-direction proxy · NIFTY overlay · Indian units</span></div>
      <NiftyVolumeChart points={volume} />
    </section>

    <section className="market-secondary-grid" aria-label="Secondary market metrics">
      <div><span>Turnover / minute</span><strong>{formatCurrency(paper.whole_nifty_turnover)}</strong><small>Aggregate constituents</small></div>
      <div><span>Participation</span><strong>{formatPercent(paper.participation)}</strong><small>Activity dispersion</small></div>
      <div><span>Heavyweight score</span><strong className={(paper.heavyweight_score ?? 0) >= 0 ? "good" : "bad"}>{formatNumber(paper.heavyweight_score)}</strong><small>Index-weight contribution</small></div>
      <div><span>Options activity</span><strong>{paper.option_direction_ready ? formatNumber(paper.option_direction_score, 3) : "Warming"}</strong><small>Near-ATM activity score</small></div>
      <div><span>Futures confirmation</span><strong>{signal ? `${signal.futures.score >= 0 ? "+" : ""}${signal.futures.score.toFixed(2)}` : "—"}</strong><small>{paper.future_symbol ?? "Future unavailable"}</small></div>
      <div><span>Synthetic VWAP</span><strong>{formatNumber(paper.synthetic_vwap)}</strong><small>{typeof paper.vwap_score === "number" ? `Score ${paper.vwap_score.toFixed(2)}` : "Derived value unavailable"}</small></div>
      <div><span>Futures basis</span><strong className={(basis ?? 0) >= 0 ? "good" : "bad"}>{basis === null ? "—" : `${basis >= 0 ? "+" : ""}${formatNumber(basis)} pts`}</strong><small>Future minus spot</small></div>
      <div><span>Fresh constituents</span><strong>{paper.constituents_fresh ?? 0} / {paper.constituents_total ?? 50}</strong><small>{paper.weighting ?? "Weighting unavailable"}</small></div>
    </section>

    <VolumeAnalytics status={status} points={volume} />

    <details className="card terminal-section market-drilldown" open>
      <summary><div><p className="eyebrow">Constituent drill-down</p><h2>Pressure, participation &amp; leadership</h2></div><span>{rows.length} authenticated rows</span></summary>
      <div className="market-drilldown-grid">
        <section><h3>Top buying-pressure proxies</h3><PressureList rows={buyingPressure} empty="No advancing constituents in the latest persisted scan." /><p className="availability-note">Ranked by positive price move × RVOL; this does not identify buyer identity.</p></section>
        <section><h3>Top selling-pressure proxies</h3><PressureList rows={sellingPressure} empty="No declining constituents in the latest persisted scan." /><p className="availability-note">Ranked by negative price move × RVOL; this does not identify seller identity.</p></section>
        <section><h3>Volume spikes</h3><PressureList rows={volumeSpikes} empty="Volume telemetry is warming." /><p className="availability-note">Highest persisted relative volume, with latest incremental share volume.</p></section>
        <section><h3>Heavyweight watch</h3><PressureList rows={heavyweights} empty="Heavyweight telemetry is warming." /><p className="availability-note">Index-weighted names ranked by absolute contribution risk.</p></section>
      </div>

      <section className="sector-heatmap-section">
        <div className="section-heading compact"><div><p className="eyebrow">Sector breadth</p><h3>Heatmap</h3></div><span>Average constituent move</span></div>
        {sectors.length ? <div className="sector-heatmap-grid">{sectors.map((item) => <div key={item.name} className={item.move >= 0 ? "positive" : "negative"}><span>{item.name}</span><strong>{item.move >= 0 ? "+" : ""}{formatNumber(item.move)}%</strong><small>{item.count} stocks · {formatCompact(item.volume)} Δ vol</small></div>)}</div> : <p className="muted">Sector telemetry will appear after the first persisted constituent scan.</p>}
      </section>

      <section className="full-tape-boundary">
        <div className="section-heading compact"><div><p className="eyebrow">Full NIFTY-50 tape</p><h3>Search and sort every constituent</h3></div><span>{tapeRows.length} shown</span></div>
        <div className="market-tape-toolbar">
          <label className="field"><span>Search symbol or sector</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="RELIANCE or Financials" /></label>
          <label className="field"><span>Sector</span><select value={sector} onChange={(event) => setSector(event.target.value)}><option value="all">All sectors</option>{sectorNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        </div>
        {tapeRows.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th><button type="button" className="table-sort" onClick={() => changeSort("symbol")}>Symbol{sortMark("symbol")}</button></th><th>Sector</th><th>Price</th><th><button type="button" className="table-sort" onClick={() => changeSort("move_pct")}>Move{sortMark("move_pct")}</button></th><th><button type="button" className="table-sort" onClick={() => changeSort("volume_delta")}>Δ volume{sortMark("volume_delta")}</button></th><th><button type="button" className="table-sort" onClick={() => changeSort("relative_volume")}>RVOL{sortMark("relative_volume")}</button></th><th><button type="button" className="table-sort" onClick={() => changeSort("index_weight")}>Weight{sortMark("index_weight")}</button></th><th>Role</th></tr></thead><tbody>{tapeRows.map((row) => <tr key={row.symbol}><td><strong>{row.symbol}</strong></td><td>{row.sector ?? "Other"}</td><td className="numeric">{formatNumber(row.price)}</td><td className={`numeric ${row.move_pct >= 0 ? "good" : "bad"}`}>{row.move_pct >= 0 ? "+" : ""}{formatNumber(row.move_pct)}%</td><td className="numeric">{formatCompact(row.volume_delta)}</td><td className="numeric">{formatNumber(row.relative_volume, 2)}×</td><td className="numeric">{formatNumber(row.index_weight, 2)}%</td><td>{row.is_heavyweight ? <span className="status-badge good">Heavyweight</span> : "Constituent"}</td></tr>)}</tbody></table></div> : <EmptyState icon="chart" title="No matching constituents" description="Clear the search or sector filter, or wait for the next persisted Oracle scan." />}
      </section>
    </details>

    <section className="terminal-section card">
      <div className="section-heading compact"><div><p className="eyebrow">Near-ATM chain</p><h2>NIFTY options</h2></div><div className="section-meta"><span>PCR OI {formatNumber(detail?.summary.pcrOi)}</span><span>PCR Vol {formatNumber(detail?.summary.pcrVolume)}</span><span>CE IV {detail?.summary.callIv != null ? `${formatNumber(detail.summary.callIv)}%` : "—"}</span><span>PE IV {detail?.summary.putIv != null ? `${formatNumber(detail.summary.putIv)}%` : "—"}</span></div></div>
      {detail?.optionChain.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Strike</th><th>Type</th><th>LTP</th><th>OI</th><th>Volume</th><th>IV</th><th>Delta</th><th>Gamma</th><th>Theta</th><th>Vega</th><th>Bid / ask</th></tr></thead><tbody>{detail.optionChain.map((row) => <tr key={`${row.strike}-${row.option_type}`}><td className="numeric"><strong>{formatNumber(row.strike, 0)}</strong></td><td><span className={`status-badge ${row.option_type === "CE" ? "good" : "warn"}`}>{row.option_type}</span></td><td className="numeric">{formatNumber(row.ltp)}</td><td className="numeric">{formatCompact(row.open_interest)}</td><td className="numeric">{formatCompact(row.volume)}</td><td className="numeric">{row.iv != null ? `${formatNumber(row.iv)}%` : "—"}</td><td className="numeric">{formatNumber(row.delta)}</td><td className="numeric">{formatNumber(row.gamma, 4)}</td><td className="numeric">{formatNumber(row.theta)}</td><td className="numeric">{formatNumber(row.vega)}</td><td className="numeric">{row.bid_price != null && row.ask_price != null ? `${formatNumber(row.bid_price)} / ${formatNumber(row.ask_price)}` : "—"}</td></tr>)}</tbody></table></div> : <EmptyState icon="chart" title="Option-chain telemetry is warming" description="Oracle persists the nearest 11 strikes after each option-chain refresh." />}
      <p className="availability-note">Persisted chain telemetry includes OI, volume, IV, Greeks, and bid/ask. PCR and pressure labels are descriptive proxies, never buyer/seller identity.</p>
    </section>
  </>;
}
