import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

const ALLOWED = new Set([
  "TEST_AUTH",
  "TEST_MARKET_DATA",
  "START_PAPER_ENGINE",
  "STOP_PAPER_ENGINE",
  "STOP",
]);

const NEEDS_CREDENTIALS = new Set([
  "TEST_AUTH",
  "TEST_MARKET_DATA",
  "START_PAPER_ENGINE",
]);

function workerIsOnline(worker: { last_heartbeat?: string; state?: string } | null): boolean {
  if (!worker?.last_heartbeat || worker.state === "stopped") return false;
  const heartbeat = Date.parse(worker.last_heartbeat);
  return Number.isFinite(heartbeat) && Date.now() - heartbeat < 20_000;
}

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { command?: string; payload?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const command = body.command ?? "";
  if (!ALLOWED.has(command)) {
    return Response.json({ error: "unsupported command" }, { status: 400 });
  }

  const supabase = serverSupabase();
  const { data: worker, error: workerError } = await supabase
    .from("engine_status")
    .select("state,last_heartbeat")
    .eq("worker_id", "oracle-primary")
    .maybeSingle();

  if (workerError) return Response.json({ error: workerError.message }, { status: 503 });
  if (!workerIsOnline(worker)) {
    return Response.json({ error: "Oracle worker is offline or stale" }, { status: 409 });
  }

  if (NEEDS_CREDENTIALS.has(command)) {
    const { data: credentials, error: credentialError } = await supabase
      .from("broker_credentials")
      .select("broker")
      .eq("broker", "groww")
      .maybeSingle();
    if (credentialError) return Response.json({ error: credentialError.message }, { status: 503 });
    if (!credentials) {
      return Response.json({ error: "Save Groww credentials before starting broker work" }, { status: 409 });
    }
  }

  const { data, error } = await supabase.from("engine_commands")
    .insert({ command, payload: body.payload ?? {} })
    .select("id, command, status, created_at")
    .single();

  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await supabase
      .from("engine_commands")
      .select("id,command,status,created_at")
      .eq("command", command)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!existingError && existing) {
      return Response.json({ ...existing, duplicate: true }, { status: 202 });
    }
    return Response.json({ error: "An identical command is already active" }, { status: 409 });
  }

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 202 });
}
