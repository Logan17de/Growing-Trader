import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

type QueryResult = { data: any; error: { message?: string } | null };

function collectError(
  errors: Record<string, string>,
  name: string,
  result: QueryResult,
) {
  if (result.error) errors[name] = result.error.message ?? "unknown Supabase error";
}

export async function GET() {
  if (!(await isDashboardAuthorized())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = serverSupabase();
    const [
      workerResult,
      commandResult,
      credentialResult,
      signalResult,
      levelsResult,
      paperResult,
      parameterResult,
      volumeResult,
    ] = await Promise.all([
      supabase.from("engine_status").select("*").eq("worker_id", "oracle-primary").maybeSingle(),
      supabase.from("engine_commands")
        .select("id,command,status,result,error,created_at,claimed_at,completed_at")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("broker_credentials").select("broker,updated_at").eq("broker", "groww").maybeSingle(),
      supabase.from("signals").select("payload,observed_at")
        .order("observed_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("strategy_levels")
        .select("id,name,kind,price,source,enabled,updated_at")
        .order("price", { ascending: true }),
      supabase.from("paper_engine_status")
        .select("payload,updated_at").eq("worker_id", "oracle-primary").maybeSingle(),
      supabase.from("strategy_parameters")
        .select("key,category,value,unit,description,updated_at")
        .order("category", { ascending: true })
        .order("key", { ascending: true }),
      supabase.from("nifty_volume_series")
        .select("observed_at,nifty_ltp,synthetic_vwap,constituent_volume_delta,constituent_turnover,cash_pressure,breadth,participation,heavyweight_score,futures_score,option_score,vwap_score,combined_score")
        .order("observed_at", { ascending: false })
        .limit(120),
    ]);

    const backendErrors: Record<string, string> = {};
    collectError(backendErrors, "worker", workerResult);
    collectError(backendErrors, "commands", commandResult);
    collectError(backendErrors, "credentials", credentialResult);
    collectError(backendErrors, "signals", signalResult);
    collectError(backendErrors, "levels", levelsResult);
    collectError(backendErrors, "paperEngine", paperResult);
    collectError(backendErrors, "strategyParameters", parameterResult);
    collectError(backendErrors, "niftyVolumeSeries", volumeResult);

    const worker = workerResult.error ? null : workerResult.data;
    const heartbeat = worker?.last_heartbeat ? Date.parse(worker.last_heartbeat) : 0;
    const heartbeatFresh = heartbeat > 0 && Date.now() - heartbeat < 20_000;
    const stopped = worker?.state === "stopped";
    const workerOnline = heartbeatFresh && !stopped;
    const workerStale = heartbeat > 0 && !heartbeatFresh && !stopped;
    const volumeSeries = volumeResult.error
      ? []
      : [...(volumeResult.data ?? [])].reverse();

    return Response.json({
      controlPlane: {
        healthy: Object.keys(backendErrors).length === 0,
        errors: backendErrors,
      },
      worker: worker ? {
        ...worker,
        online: workerOnline,
        stale: workerStale,
      } : { online: false, stale: false, state: "offline" },
      latestCommand: commandResult.error ? null : commandResult.data ?? null,
      credentials: credentialResult.error ? {
        configured: false,
        updatedAt: null,
      } : {
        configured: Boolean(credentialResult.data),
        updatedAt: credentialResult.data?.updated_at ?? null,
      },
      latestSignal: signalResult.error ? null : signalResult.data ?? null,
      levels: levelsResult.error ? [] : levelsResult.data ?? [],
      strategyParameters: parameterResult.error ? [] : parameterResult.data ?? [],
      niftyVolumeSeries: volumeSeries,
      paperEngine: paperResult.error ? {
        running: false,
        state: "unknown",
      } : {
        ...(paperResult.data?.payload ?? { running: false, state: "stopped" }),
        statusUpdatedAt: paperResult.data?.updated_at ?? null,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "control-plane status failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
