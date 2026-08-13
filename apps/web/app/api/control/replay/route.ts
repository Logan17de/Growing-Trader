import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

export async function GET(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const supabase = serverSupabase();
  const query = supabase.from("replay_runs").select("id,status,request,result,error,created_at,completed_at").order("created_at", { ascending: false });
  const response = id ? await query.eq("id", id).maybeSingle() : await query.limit(20);
  if (response.error) return Response.json({ error: response.error.message }, { status: 503 });
  return Response.json(id ? { run: response.data ?? null } : { runs: response.data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as null | {
    instrument?: string; date?: string; startTime?: string; endTime?: string;
    strategyId?: string; strategyVersion?: string; startingCapital?: number; confirmations?: string[];
  };
  if (!body?.date || !body.startTime || !body.endTime) return Response.json({ error: "date and time range are required" }, { status: 400 });
  if (body.instrument && body.instrument !== "NIFTY") return Response.json({ error: "only NIFTY replay is supported" }, { status: 400 });
  const supabase = serverSupabase();
  const { data: worker, error: workerError } = await supabase.from("engine_status").select("state,last_heartbeat").eq("worker_id", "oracle-primary").maybeSingle();
  if (workerError) return Response.json({ error: workerError.message }, { status: 503 });
  const heartbeat = worker?.last_heartbeat ? Date.parse(worker.last_heartbeat) : 0;
  if (!heartbeat || Date.now() - heartbeat >= 20_000 || worker?.state === "stopped") return Response.json({ error: "Oracle worker is offline or stale" }, { status: 409 });
  const { data: run, error } = await supabase.from("replay_runs").insert({ status: "queued", request: { ...body, instrument: "NIFTY" } }).select("id,status,request,created_at").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const command = await supabase.from("engine_commands").insert({ command: "RUN_REPLAY", payload: { replay_run_id: run.id } }).select("id").single();
  if (command.error) {
    await supabase.from("replay_runs").update({ status: "failed", error: command.error.message, completed_at: new Date().toISOString() }).eq("id", run.id);
    return Response.json({ error: command.error.message }, { status: 500 });
  }
  return Response.json({ run }, { status: 202 });
}
