import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

type QueryResult = { data: unknown; error: { message?: string } | null };

function collectError(errors: Record<string, string>, name: string, result: QueryResult) {
  if (result.error) errors[name] = result.error.message ?? "unknown Supabase error";
}

export async function GET() {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const supabase = serverSupabase();
    const [workerResult, commandResult, credentialResult, signalResult, levelsResult, paperResult, strategyResult, riskResult, settingsResult, preferencesResult] = await Promise.all([
      supabase.from("engine_status").select("*").eq("worker_id", "oracle-primary").maybeSingle(),
      supabase.from("engine_commands").select("id,command,status,result,error,created_at,claimed_at,completed_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("broker_credentials").select("broker,updated_at").eq("broker", "groww").maybeSingle(),
      supabase.from("signals").select("payload,observed_at").order("observed_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("strategy_levels").select("id,name,kind,price,source,enabled,updated_at").order("price", { ascending: true }),
      supabase.from("paper_engine_status").select("payload,updated_at").eq("worker_id", "oracle-primary").maybeSingle(),
      supabase.from("strategy_runtime_state").select("strategy_id,name,enabled,version,active_preset_id,updated_at").eq("strategy_id", "level-event").maybeSingle(),
      supabase.from("risk_control_state").select("worker_id,kill_switch_enabled,reason,updated_at").eq("worker_id", "oracle-primary").maybeSingle(),
      supabase.from("engine_settings").select("key,value,unit,updated_at").order("key"),
      supabase.from("terminal_preferences").select("preference_id,refresh_interval_ms,timezone,number_locale,alert_preferences,updated_at").eq("preference_id", "default").maybeSingle(),
    ]);

    const backendErrors: Record<string, string> = {};
    collectError(backendErrors, "worker", workerResult);
    collectError(backendErrors, "commands", commandResult);
    collectError(backendErrors, "credentials", credentialResult);
    collectError(backendErrors, "signals", signalResult);
    collectError(backendErrors, "levels", levelsResult);
    collectError(backendErrors, "paperEngine", paperResult);
    collectError(backendErrors, "strategyState", strategyResult);
    collectError(backendErrors, "riskControl", riskResult);
    collectError(backendErrors, "engineSettings", settingsResult);
    collectError(backendErrors, "preferences", preferencesResult);

    const worker = workerResult.error ? null : workerResult.data;
    const heartbeat = worker?.last_heartbeat ? Date.parse(worker.last_heartbeat) : 0;
    const heartbeatFresh = heartbeat > 0 && Date.now() - heartbeat < 20_000;
    const stopped = worker?.state === "stopped";
    const engineSettings = Object.fromEntries((settingsResult.error ? [] : settingsResult.data ?? []).map((row) => [row.key, Number(row.value)]));

    return Response.json({
      controlPlane: { healthy: Object.keys(backendErrors).length === 0, errors: backendErrors },
      worker: worker ? { ...worker, online: heartbeatFresh && !stopped, stale: heartbeat > 0 && !heartbeatFresh && !stopped } : { online: false, stale: false, state: "offline" },
      latestCommand: commandResult.error ? null : commandResult.data ?? null,
      credentials: credentialResult.error ? { configured: false, updatedAt: null } : { configured: Boolean(credentialResult.data), updatedAt: credentialResult.data?.updated_at ?? null },
      latestSignal: signalResult.error ? null : signalResult.data ?? null,
      levels: levelsResult.error ? [] : levelsResult.data ?? [],
      paperEngine: paperResult.error ? { running: false, state: "unknown" } : { ...(paperResult.data?.payload ?? { running: false, state: "stopped" }), statusUpdatedAt: paperResult.data?.updated_at ?? null },
      strategyState: strategyResult.error ? null : strategyResult.data ?? null,
      riskControl: riskResult.error ? null : riskResult.data ?? null,
      engineSettings,
      terminalPreferences: preferencesResult.error ? null : preferencesResult.data ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "control-plane status failed" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
