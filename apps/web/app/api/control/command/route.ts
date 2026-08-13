import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

const ALLOWED = new Set([
  "TEST_AUTH", "TEST_MARKET_DATA", "START_PAPER_ENGINE", "STOP_PAPER_ENGINE", "STOP",
  "EXIT_PAPER_POSITION", "UPDATE_PAPER_POSITION", "KILL_SWITCH", "RESET_KILL_SWITCH", "RUN_REPLAY",
]);

const NEEDS_CREDENTIALS = new Set(["TEST_AUTH", "TEST_MARKET_DATA", "START_PAPER_ENGINE"]);

function workerIsOnline(worker: { last_heartbeat?: string; state?: string } | null): boolean {
  if (!worker?.last_heartbeat || worker.state === "stopped") return false;
  const heartbeat = Date.parse(worker.last_heartbeat);
  return Number.isFinite(heartbeat) && Date.now() - heartbeat < 20_000;
}

function validatePayload(command: string, payload: Record<string, unknown>) {
  if (command === "EXIT_PAPER_POSITION") {
    const fraction = Number(payload.fraction ?? 1);
    if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) throw new Error("exit fraction must be in (0, 1]");
  }
  if (command === "UPDATE_PAPER_POSITION") {
    const allowed = ["stop_loss_pct", "profit_target_pct", "trailing_activation_pct", "trailing_drawdown_pct"];
    for (const [key, raw] of Object.entries(payload)) {
      if (!allowed.includes(key)) continue;
      if (raw === null) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${key} must be in [0, 1]`);
    }
  }
}

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { command?: string; payload?: Record<string, unknown> };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const command = body.command ?? "";
  const payload = body.payload ?? {};
  if (!ALLOWED.has(command)) return Response.json({ error: "unsupported command" }, { status: 400 });
  try { validatePayload(command, payload); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "invalid command payload" }, { status: 400 }); }

  const supabase = serverSupabase();
  const { data: worker, error: workerError } = await supabase.from("engine_status").select("state,last_heartbeat").eq("worker_id", "oracle-primary").maybeSingle();
  if (workerError) return Response.json({ error: workerError.message }, { status: 503 });
  if (!workerIsOnline(worker)) return Response.json({ error: "Oracle worker is offline or stale" }, { status: 409 });

  if (NEEDS_CREDENTIALS.has(command)) {
    const { data: credentials, error: credentialError } = await supabase.from("broker_credentials").select("broker").eq("broker", "groww").maybeSingle();
    if (credentialError) return Response.json({ error: credentialError.message }, { status: 503 });
    if (!credentials) return Response.json({ error: "Save Groww credentials before starting broker work" }, { status: 409 });
  }

  if (["EXIT_PAPER_POSITION", "UPDATE_PAPER_POSITION"].includes(command)) {
    const { data: paper, error } = await supabase.from("paper_engine_status").select("payload").eq("worker_id", "oracle-primary").maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 503 });
    const position = paper?.payload && typeof paper.payload === "object" ? (paper.payload as Record<string, unknown>).open_paper_position : null;
    if (!position) return Response.json({ error: "No open paper position" }, { status: 409 });
  }

  const { data, error } = await supabase.from("engine_commands").insert({ command, payload }).select("id, command, status, created_at").single();
  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await supabase.from("engine_commands").select("id,command,status,created_at").eq("command", command).in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!existingError && existing) return Response.json({ ...existing, duplicate: true }, { status: 202 });
    return Response.json({ error: "An identical command is already active" }, { status: 409 });
  }
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 202 });
}
