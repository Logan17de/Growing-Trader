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
    ]);

    const backendErrors: Record<string, string> = {};
    collectError(backendErrors, "worker", workerResult);
    collectError(backendErrors, "commands", commandResult);
    collectError(backendErrors, "credentials", credentialResult);
    collectError(backendErrors, "signals", signalResult);
    collectError(backendErrors, "levels", levelsResult);
    collectError(backendErrors, "paperEngine", paperResult);

    const worker = workerResult.error ? null : workerResult.data;
    const heartbeat = worker?.last_heartbeat ? Date.parse(worker.last_heartbeat) : 0;
    const heartbeatFresh = heartbeat > 0 && Date.now() - heartbeat < 20_000;
    const stopped = worker?.state === "stopped";
    const workerOnline = heartbeatFresh && !stopped;
    const workerStale = heartbeat > 0 && !heartbeatFresh && !stopped;

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
