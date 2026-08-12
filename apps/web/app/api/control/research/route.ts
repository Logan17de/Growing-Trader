import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

export async function GET() {
  if (!(await isDashboardAuthorized())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = serverSupabase();
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const [parameterResult, volumeResult, paperResult] = await Promise.all([
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
    ]);

    const error = parameterResult.error ?? volumeResult.error ?? paperResult.error;
    if (error) {
      return Response.json({ error: error.message }, { status: 503 });
    }

    return Response.json({
      strategyParameters: parameterResult.data ?? [],
      niftyVolumeSeries: volumeResult.data ?? [],
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
