import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

export async function GET() {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supabase = serverSupabase();
  try {
    const [latestConstituent, latestOption] = await Promise.all([
      supabase.from("market_constituent_series").select("observed_at").order("observed_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("option_chain_series").select("observed_at").order("observed_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const constituentAt = latestConstituent.data?.observed_at ?? null;
    const optionAt = latestOption.data?.observed_at ?? null;
    const [constituents, options] = await Promise.all([
      constituentAt ? supabase.from("market_constituent_series").select("observed_at,symbol,sector,price,previous_price,move_pct,cumulative_volume,volume_delta,volume_rate,relative_volume,index_weight,is_heavyweight").eq("observed_at", constituentAt).order("move_pct", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      optionAt ? supabase.from("option_chain_series").select("observed_at,expiry,underlying_ltp,strike,option_type,trading_symbol,ltp,open_interest,volume,delta,gamma,theta,vega,rho,iv,bid_price,ask_price").eq("observed_at", optionAt).order("strike").order("option_type") : Promise.resolve({ data: [], error: null }),
    ]);
    const error = latestConstituent.error ?? latestOption.error ?? constituents.error ?? options.error;
    if (error) return Response.json({ error: error.message }, { status: 503 });
    const chain = options.data ?? [];
    const calls = chain.filter((row) => row.option_type === "CE");
    const puts = chain.filter((row) => row.option_type === "PE");
    const callOi = calls.reduce((sum, row) => sum + Number(row.open_interest ?? 0), 0);
    const putOi = puts.reduce((sum, row) => sum + Number(row.open_interest ?? 0), 0);
    const callVolume = calls.reduce((sum, row) => sum + Number(row.volume ?? 0), 0);
    const putVolume = puts.reduce((sum, row) => sum + Number(row.volume ?? 0), 0);
    const average = (rows: typeof chain) => rows.length ? rows.reduce((sum, row) => sum + Number(row.iv ?? 0), 0) / rows.length : null;
    return Response.json({
      constituents: constituents.data ?? [], optionChain: chain,
      summary: {
        constituentObservedAt: constituentAt, optionObservedAt: optionAt,
        pcrOi: callOi > 0 ? putOi / callOi : null,
        pcrVolume: callVolume > 0 ? putVolume / callVolume : null,
        callIv: average(calls), putIv: average(puts),
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "market telemetry failed" }, { status: 503 });
  }
}
