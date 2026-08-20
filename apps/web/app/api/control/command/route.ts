import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

const ALLOWED = new Set([
  "TEST_AUTH", "TEST_MARKET_DATA", "RUN_PAPER", "START_PAPER_ENGINE", "STOP_PAPER_ENGINE", "START_ENGINE", "STOP_ENGINE", "STOP",
  "EXIT_PAPER_POSITION", "UPDATE_PAPER_POSITION", "KILL_SWITCH", "RESET_KILL_SWITCH", "CHECK_LIVE_POSITIONS", "RUN_REPLAY",
  "MANUAL_LIVE_ENTRY",
]);

const NEEDS_CREDENTIALS = new Set(["TEST_AUTH", "TEST_MARKET_DATA", "RUN_PAPER", "START_PAPER_ENGINE", "START_ENGINE", "CHECK_LIVE_POSITIONS", "MANUAL_LIVE_ENTRY"]);

function workerIsOnline(worker: { last_heartbeat?: string; state?: string } | null): boolean {
  if (!worker?.last_heartbeat || worker.state === "stopped") return false;
  const heartbeat = Date.parse(worker.last_heartbeat);
  return Number.isFinite(heartbeat) && Date.now() - heartbeat < 20_000;
}

function runtimePayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
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
  if (command === "MANUAL_LIVE_ENTRY") {
    const symbol = String(payload.trading_symbol ?? "").trim().toUpperCase();
    const lots = Number(payload.lots);
    if (!/^NIFTY[A-Z0-9-]*?(CE|PE)$/.test(symbol)) throw new Error("manual entry requires a NIFTY CE/PE trading symbol");
    if (!Number.isInteger(lots) || lots < 1 || lots > 20) throw new Error("manual entry lots must be an integer from 1 to 20");
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

  if (command === "RUN_PAPER") {
    const [{ data: runtime, error: runtimeError }, { data: execution, error: executionError }] = await Promise.all([
      supabase.from("paper_engine_status").select("payload").eq("worker_id", "oracle-primary").maybeSingle(),
      supabase.from("execution_control_state").select("mode").eq("id", true).maybeSingle(),
    ]);
    const readError = runtimeError ?? executionError;
    if (readError) return Response.json({ error: readError.message }, { status: 503 });
    if (!execution) return Response.json({ error: "execution control is not initialized" }, { status: 409 });

    const currentRuntime = runtimePayload(runtime?.payload);
    if (Boolean(currentRuntime.running)) {
      return Response.json({
        error: currentRuntime.mode === "paper"
          ? "PAPER engine is already running"
          : "Stop the LIVE engine before switching to PAPER",
      }, { status: 409 });
    }

    const now = new Date().toISOString();
    const { error: modeError } = await supabase.from("execution_control_state").update({
      mode: "paper",
      live_armed: false,
      armed_at: null,
      updated_at: now,
    }).eq("id", true);
    if (modeError) return Response.json({ error: modeError.message }, { status: 503 });
  }

  if (["EXIT_PAPER_POSITION", "UPDATE_PAPER_POSITION"].includes(command)) {
    const { data: runtime, error } = await supabase.from("paper_engine_status").select("payload").eq("worker_id", "oracle-primary").maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 503 });
    const currentRuntime = runtimePayload(runtime?.payload);
    const position = currentRuntime.open_position ?? currentRuntime.open_paper_position ?? null;
    if (!position) return Response.json({ error: "No open trading position" }, { status: 409 });
  }

  if (command === "START_ENGINE") {
    const { data: execution, error } = await supabase.from("execution_control_state").select("mode,live_armed,max_order_premium").eq("id", true).maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 503 });
    if (execution?.mode === "live" && (!execution.live_armed || Number(execution.max_order_premium ?? 0) <= 0)) {
      return Response.json({ error: "LIVE execution must be explicitly armed with a positive max order premium" }, { status: 409 });
    }
  }

  if (command === "MANUAL_LIVE_ENTRY") {
    const [executionResult, runtimeResult, riskResult] = await Promise.all([
      supabase.from("execution_control_state").select("mode,live_armed,max_order_premium").eq("id", true).maybeSingle(),
      supabase.from("paper_engine_status").select("payload").eq("worker_id", "oracle-primary").maybeSingle(),
      supabase.from("risk_control_state").select("kill_switch,block_new_entries").eq("id", true).maybeSingle(),
    ]);
    const error = executionResult.error ?? runtimeResult.error ?? riskResult.error;
    if (error) return Response.json({ error: error.message }, { status: 503 });
    const execution = executionResult.data;
    if (execution?.mode !== "live" || !execution.live_armed || Number(execution.max_order_premium ?? 0) <= 0) {
      return Response.json({ error: "Manual entry requires LIVE mode to be explicitly armed with a positive premium cap" }, { status: 409 });
    }
    if (riskResult.data?.kill_switch || riskResult.data?.block_new_entries) {
      return Response.json({ error: "Manual entry is blocked by the current risk / kill-switch state" }, { status: 409 });
    }
    const runtime = runtimePayload(runtimeResult.data?.payload);
    if (!runtime.running || runtime.mode !== "live") {
      return Response.json({ error: "Start the LIVE trading engine before placing a manual app trade" }, { status: 409 });
    }
    if (runtime.open_position ?? runtime.open_paper_position) {
      return Response.json({ error: "A managed position is already open; only one LIVE position is allowed" }, { status: 409 });
    }
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
