import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

const MARKET_WATCH_FIELDS = [
  "observed_at",
  "session_date",
  "nifty_ltp",
  "constituent_volume_delta",
  "constituent_turnover",
  "cash_pressure",
  "breadth",
  "participation",
  "heavyweight_score",
  "futures_move_bps",
  "futures_volume_delta",
  "futures_oi_change_pct",
  "futures_basis_points",
  "futures_score",
  "option_score",
  "option_volume_imbalance",
  "option_oi_change_imbalance",
  "option_iv_skew",
  "vwap_distance_bps",
  "combined_direction_score",
  "event",
  "direction",
  "confidence",
  "nifty_move_1m_bps",
  "nifty_move_3m_bps",
  "nifty_move_5m_bps",
  "nifty_move_10m_bps",
  "nifty_move_15m_bps",
  "max_up_15m_bps",
  "max_down_15m_bps",
  "big_move_1m",
  "big_move_5m",
  "big_move_15m",
].join(",");

export async function GET() {
  if (!(await isDashboardAuthorized())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = serverSupabase();
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const [parameterResult, volumeResult, paperResult, watchResult, bigMoveResult] = await Promise.all([
      supabase.from("strategy_parameters")
        .select("key,category,value,unit,description,updated_at")
        .order("category", { ascending: true })
        .order("key", { ascending: true }),
      supabase.from("nifty_volume_minute")
        .select("observed_at,nifty_ltp,synthetic_vwap,constituent_volume_delta,constituent_turnover,cash_pressure,breadth,participation,heavyweight_score,futures_score,option_score,vwap_score,combined_score")
        .gte("observed_at", since)
        .order("observed_at", { ascending: true }),
      supabase.from("paper_engine_status")
        .select("payload,updated_at")
        .eq("worker_id", "oracle-primary")
        .maybeSingle(),
      supabase.from("market_watch_labeled")
        .select(MARKET_WATCH_FIELDS)
        .gte("observed_at", since)
        .order("observed_at", { ascending: false })
        .limit(240),
      supabase.from("market_watch_big_moves")
        .select(MARKET_WATCH_FIELDS)
        .gte("observed_at", since)
        .order("observed_at", { ascending: false })
        .limit(30),
    ]);

    const error = parameterResult.error ?? volumeResult.error ?? paperResult.error ?? watchResult.error ?? bigMoveResult.error;
    if (error) {
      return Response.json({ error: error.message }, { status: 503 });
    }

    return Response.json({
      strategyParameters: parameterResult.data ?? [],
      niftyVolumeSeries: volumeResult.data ?? [],
      marketWatch: watchResult.data ?? [],
      bigMoves: bigMoveResult.data ?? [],
      paperEngine: {
        ...(paperResult.data?.payload ?? { running: false, state: "stopped" }),
        statusUpdatedAt: paperResult.data?.updated_at ?? null,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "research status failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
