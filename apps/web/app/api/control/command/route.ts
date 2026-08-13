import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

const ALLOWED = new Set([
  "TEST_AUTH",
  "TEST_MARKET_DATA",
  "START_PAPER_ENGINE",
  "STOP_PAPER_ENGINE",
  "EXIT_PAPER_POSITION",
  "PARTIAL_EXIT_PAPER_POSITION",
  "SET_PAPER_STOP",
  "SET_PAPER_TRAILING",
  "KILL_SWITCH",
  "RUN_REPLAY",
  "STOP",
]);

const NEEDS_CREDENTIALS = new Set(["TEST_AUTH", "TEST_MARKET_DATA", "START_PAPER_ENGINE"]);
const MAY_QUEUE_OFFLINE = new Set(["KILL_SWITCH"]);

function workerIsOnline(worker: { last_heartbeat?: string; state?: string } | null): boolean {
  if (!worker?.last_heartbeat || worker.state === "stopped") return false;
  const heartbeat = Date.parse(worker.last_heartbeat);
  return Number.isFinite(heartbeat) && Date.now() - heartbeat < 20_000;
}

function validatePayload(command: string, payload: Record<string, unknown>) {
  if (command === "PARTIAL_EXIT_PAPER_POSITION") {
    const quantity = Number(payload.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("partial-exit quantity must be a positive integer");
  }
  if (command === "SET_PAPER_STOP") {
    const price = Number(payload.stopPrice);
    if (!Number.isFinite(price) || price <= 0) throw new Error("stop price must be positive");
  }
  if (command === "SET_PAPER_TRAILING") {
    if (typeof payload.enabled !== "boolean") throw new Error("trailing enabled flag is required");
    if (payload.enabled) {
      const activation = Number(payload.activationPct);
      const drawdown = Number(payload.drawdownPct);
      if (!Number.isFinite(activation) || activation < 0 || activation > 1) throw new Error("trailing activation must be between 0 and 1");
      if (!Number.isFinite(drawdown) || drawdown <= 0 || drawdown > 1) throw new Error("trailing drawdown must be between 0 and 1");
    }
  }
  if (command === "KILL_SWITCH" && typeof payload.enabled !== "boolean") throw new Error("kill-switch enabled flag is required");
  if (command === "RUN_REPLAY") {
    const date = String(payload.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("replay date is required");
    const capital = Number(payload.startingCapital);
    if (!Number.isFinite(capital) || capital <= 0) throw new Error("starting capital must be positive");
  }
}

export async function GET(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "command id is required" }, { status: 400 });
  const { data, error } = await serverSupabase().from("engine_commands")
    .select("id,command,payload,status,result,error,created_at,claimed_at,completed_at")
    .eq("id", id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 503 });
  if (!data) return Response.json({ error: "command not found" }, { status: 404 });
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { command?: string; payload?: Record<string, unknown> };
  try { body = await request.json(); }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  const command = body.command ?? "";
  const payload = body.payload ?? {};
  if (!ALLOWED.has(command)) return Response.json({ error: "unsupported command" }, { status: 400 });
  try { validatePayload(command, payload); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "invalid command payload" }, { status: 400 }); }

  const supabase = serverSupabase();

  if (command === "KILL_SWITCH") {
    const enabled = Boolean(payload.enabled);
    const { error } = await supabase.from("risk_control_state").upsert({
      worker_id: "oracle-primary",
      kill_switch_enabled: enabled,
      reason: enabled ? String(payload.reason ?? "Dashboard kill switch") : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "worker_id" });
    if (error) return Response.json({ error: error.message }, { status: 503 });
  }

  const { data: worker, error: workerError } = await supabase.from("engine_status")
    .select("state,last_heartbeat").eq("worker_id", "oracle-primary").maybeSingle();
  if (workerError) return Response.json({ error: workerError.message }, { status: 503 });
  const online = workerIsOnline(worker);
  if (!online && !MAY_QUEUE_OFFLINE.has(command)) return Response.json({ error: "Oracle worker is offline or stale" }, { status: 409 });

  if (command === "START_PAPER_ENGINE") {
    const { data: kill, error: killError } = await supabase.from("risk_control_state")
      .select("kill_switch_enabled").eq("worker_id", "oracle-primary").maybeSingle();
    if (killError) return Response.json({ error: killError.message }, { status: 503 });
    if (kill?.kill_switch_enabled) return Response.json({ error: "Reset the kill switch before starting paper market collection" }, { status: 409 });
  }

  if (NEEDS_CREDENTIALS.has(command)) {
    const { data: credentials, error: credentialError } = await supabase.from("broker_credentials")
      .select("broker").eq("broker", "groww").maybeSingle();
    if (credentialError) return Response.json({ error: credentialError.message }, { status: 503 });
    if (!credentials) return Response.json({ error: "Save Groww credentials before starting broker work" }, { status: 409 });
  }

  const { data, error } = await supabase.from("engine_commands")
    .insert({ command, payload }).select("id,command,status,created_at").single();

  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await supabase.from("engine_commands")
      .select("id,command,status,created_at").eq("command", command)
      .in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!existingError && existing) return Response.json({ ...existing, duplicate: true }, { status: 202 });
    return Response.json({ error: "An identical command is already active" }, { status: 409 });
  }
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ...data, workerOnline: online }, { status: 202 });
}
