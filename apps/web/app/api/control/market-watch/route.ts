import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

const FIELDS = [
  "observed_at", "session_date", "nifty_ltp", "constituent_volume_delta", "constituent_turnover",
  "cash_pressure", "breadth", "participation", "heavyweight_score", "futures_move_bps",
  "futures_volume_delta", "futures_oi_change_pct", "futures_basis_points", "futures_score",
  "option_score", "option_volume_imbalance", "option_oi_change_imbalance", "option_iv_skew",
  "vwap_distance_bps", "combined_direction_score", "event", "direction", "confidence",
  "nifty_move_1m_bps", "nifty_move_3m_bps", "nifty_move_5m_bps", "nifty_move_10m_bps",
  "nifty_move_15m_bps", "max_up_15m_bps", "max_down_15m_bps", "big_move_1m", "big_move_5m", "big_move_15m",
].join(",");

const ALLOWED_DAYS = new Set([1, 7, 30, 90]);

export async function GET(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const requestedDays = Number(url.searchParams.get("days") ?? 30);
    const days = ALLOWED_DAYS.has(requestedDays) ? requestedDays : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const supabase = serverSupabase();

    const [recentResult, bigMoveResult, countResult] = await Promise.all([
      supabase.from("market_watch_labeled")
        .select(FIELDS)
        .gte("observed_at", since)
        .order("observed_at", { ascending: false })
        .limit(240),
      supabase.from("market_watch_big_moves")
        .select(FIELDS)
        .gte("observed_at", since)
        .order("observed_at", { ascending: false })
        .limit(1000),
      supabase.from("market_watch_labeled")
        .select("signal_id", { count: "exact", head: true })
        .gte("observed_at", since),
    ]);

    const error = recentResult.error ?? bigMoveResult.error ?? countResult.error;
    if (error) return Response.json({ error: error.message }, { status: 503 });

    return Response.json({
      days,
      observationCount: countResult.count ?? 0,
      recent: recentResult.data ?? [],
      bigMoves: bigMoveResult.data ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "market-watch query failed" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
