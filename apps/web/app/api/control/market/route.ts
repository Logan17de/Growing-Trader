import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET() {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const supabase = serverSupabase();
    const [snapshotResult, configResult] = await Promise.all([
      supabase.from("market_snapshots").select("id,observed_at,payload").order("observed_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("nifty_constituent_config").select("symbol,index_weight,is_heavyweight,sector,source,as_of").order("symbol"),
    ]);
    const error = snapshotResult.error ?? configResult.error;
    if (error) return Response.json({ error: error.message }, { status: 503 });
    if (!snapshotResult.data) return Response.json({ observedAt: null, spot: null, future: null, constituents: [], options: [], optionSummary: null });

    const snapshot = record(snapshotResult.data.payload);
    const spot = number(snapshot.spot_price);
    const configs = new Map((configResult.data ?? []).map((item) => [String(item.symbol), item]));
    const constituents = rows(snapshot.constituents).map((item) => {
      const symbol = String(item.symbol ?? "");
      const price = number(item.price);
      const previous = number(item.previous_price);
      const volume = number(item.cumulative_volume);
      const previousVolume = number(item.previous_cumulative_volume);
      const config = configs.get(symbol);
      const weight = number(item.index_weight) ?? number(config?.index_weight) ?? 1;
      const movePct = price !== null && previous && previous > 0 ? (price - previous) / previous : null;
      return {
        symbol,
        price,
        previousPrice: previous,
        movePct,
        volumeDelta: volume !== null && previousVolume !== null ? Math.max(volume - previousVolume, 0) : null,
        indexWeight: weight,
        weightedContribution: movePct === null ? null : movePct * weight,
        isHeavyweight: Boolean(item.is_heavyweight ?? config?.is_heavyweight),
        sector: String(config?.sector ?? "Unclassified"),
      };
    }).sort((a, b) => Math.abs(b.weightedContribution ?? 0) - Math.abs(a.weightedContribution ?? 0));

    const allOptions = rows(snapshot.options).map((item) => {
      const greeks = record(item.greeks);
      return {
        tradingSymbol: String(item.trading_symbol ?? ""),
        optionType: String(item.option_type ?? ""),
        strike: number(item.strike),
        expiry: String(item.expiry ?? ""),
        ltp: number(item.ltp),
        openInterest: number(item.open_interest),
        volume: number(item.volume),
        lotSize: number(item.lot_size),
        bidPrice: number(item.bid_price),
        askPrice: number(item.ask_price),
        delta: number(greeks.delta),
        gamma: number(greeks.gamma),
        theta: number(greeks.theta),
        vega: number(greeks.vega),
        rho: number(greeks.rho),
        iv: number(greeks.iv),
      };
    });
    const strikes = [...new Set(allOptions.map((option) => option.strike).filter((value): value is number => value !== null))]
      .sort((a, b) => Math.abs(a - (spot ?? a)) - Math.abs(b - (spot ?? b))).slice(0, 11);
    const strikeSet = new Set(strikes);
    const options = allOptions.filter((option) => option.strike !== null && strikeSet.has(option.strike)).sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0) || a.optionType.localeCompare(b.optionType));
    const calls = allOptions.filter((option) => option.optionType === "CE");
    const puts = allOptions.filter((option) => option.optionType === "PE");
    const callOi = calls.reduce((sum, option) => sum + (option.openInterest ?? 0), 0);
    const putOi = puts.reduce((sum, option) => sum + (option.openInterest ?? 0), 0);
    const callVolume = calls.reduce((sum, option) => sum + (option.volume ?? 0), 0);
    const putVolume = puts.reduce((sum, option) => sum + (option.volume ?? 0), 0);
    const ivValues = allOptions.map((option) => option.iv).filter((value): value is number => value !== null);
    const future = record(snapshot.futures);

    return Response.json({
      observedAt: snapshotResult.data.observed_at,
      spot,
      syntheticVwap: number(snapshot.synthetic_vwap),
      future: {
        symbol: String(future.symbol ?? ""),
        price: number(future.price),
        previousPrice: number(future.previous_price),
        volume: number(future.volume),
        previousVolume: number(future.previous_volume),
        openInterest: number(future.open_interest),
        previousOpenInterest: number(future.previous_open_interest),
      },
      constituents,
      options,
      optionSummary: {
        putCallOiRatio: callOi > 0 ? putOi / callOi : null,
        putCallVolumeRatio: callVolume > 0 ? putVolume / callVolume : null,
        callOi,
        putOi,
        callVolume,
        putVolume,
        averageIv: ivValues.length ? ivValues.reduce((a, b) => a + b, 0) / ivValues.length : null,
        contracts: allOptions.length,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "market detail failed" }, { status: 503 });
  }
}
