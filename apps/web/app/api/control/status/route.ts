import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

export async function GET() {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });

  const supabase = serverSupabase();
  const [workerResult, commandResult, credentialResult, signalResult, levelsResult] = await Promise.all([
    supabase.from("engine_status").select("*").eq("worker_id", "oracle-primary").maybeSingle(),
    supabase.from("engine_commands").select("id,command,status,result,error,created_at,claimed_at,completed_at")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("broker_credentials").select("broker,updated_at").eq("broker", "groww").maybeSingle(),
    supabase.from("signals").select("payload,observed_at").order("observed_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("strategy_levels").select("id,name,kind,price,source,enabled,updated_at").order("price", { ascending: true }),
  ]);

  const error = workerResult.error ?? commandResult.error ?? credentialResult.error ?? signalResult.error ?? levelsResult.error;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const heartbeat = workerResult.data?.last_heartbeat ? Date.parse(workerResult.data.last_heartbeat) : 0;
  const workerOnline = heartbeat > 0 && Date.now() - heartbeat < 20_000;

  return Response.json({
    worker: workerResult.data ? { ...workerResult.data, online: workerOnline } : { online: false, state: "offline" },
    latestCommand: commandResult.data ?? null,
    credentials: { configured: Boolean(credentialResult.data), updatedAt: credentialResult.data?.updated_at ?? null },
    latestSignal: signalResult.data ?? null,
    levels: levelsResult.data ?? [],
  }, { headers: { "Cache-Control": "no-store" } });
}
