import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

function engineRunning(payload: unknown): boolean {
  return Boolean(payload && typeof payload === "object" && (payload as Record<string, unknown>).running);
}

export async function GET() {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supabase = serverSupabase();
  const { data, error } = await supabase.from("execution_control_state").select("*").eq("id", true).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 503 });
  return Response.json({ executionControl: data ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as null | {
    action?: "SET_MODE" | "ARM_LIVE" | "DISARM_LIVE" | "SET_LIMIT";
    mode?: "paper" | "live";
    confirmation?: string;
    maxOrderPremium?: number;
  };
  if (!body?.action) return Response.json({ error: "invalid request" }, { status: 400 });
  const supabase = serverSupabase();
  const [{ data: control, error: controlError }, { data: runtime, error: runtimeError }] = await Promise.all([
    supabase.from("execution_control_state").select("*").eq("id", true).maybeSingle(),
    supabase.from("paper_engine_status").select("payload").eq("worker_id", "oracle-primary").maybeSingle(),
  ]);
  const readError = controlError ?? runtimeError;
  if (readError) return Response.json({ error: readError.message }, { status: 503 });
  if (!control) return Response.json({ error: "execution control is not initialized" }, { status: 409 });

  if (body.action === "DISARM_LIVE") {
    const { error } = await supabase.from("execution_control_state").update({ live_armed: false, armed_at: null, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) return Response.json({ error: error.message }, { status: 503 });
    return Response.json({ ok: true, liveArmed: false });
  }

  if (body.action === "SET_LIMIT") {
    const value = Number(body.maxOrderPremium);
    if (!Number.isFinite(value) || value < 0) return Response.json({ error: "max order premium must be >= 0" }, { status: 400 });
    if (engineRunning(runtime?.payload)) return Response.json({ error: "Stop the trading engine before changing the live premium cap" }, { status: 409 });
    const { error } = await supabase.from("execution_control_state").update({ max_order_premium: value, live_armed: false, armed_at: null, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) return Response.json({ error: error.message }, { status: 503 });
    return Response.json({ ok: true, maxOrderPremium: value, liveArmed: false });
  }

  if (body.action === "SET_MODE") {
    if (body.mode !== "paper" && body.mode !== "live") return Response.json({ error: "mode must be paper or live" }, { status: 400 });
    if (engineRunning(runtime?.payload)) return Response.json({ error: "Stop the trading engine before switching execution mode" }, { status: 409 });
    const { error } = await supabase.from("execution_control_state").update({ mode: body.mode, live_armed: false, armed_at: null, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) return Response.json({ error: error.message }, { status: 503 });
    return Response.json({ ok: true, mode: body.mode, liveArmed: false });
  }

  if (body.action === "ARM_LIVE") {
    if (engineRunning(runtime?.payload)) return Response.json({ error: "Stop the trading engine before arming live execution" }, { status: 409 });
    if (control.mode !== "live") return Response.json({ error: "Select LIVE mode first" }, { status: 409 });
    if (String(body.confirmation ?? "") !== "LIVE") return Response.json({ error: "Type LIVE exactly to arm real execution" }, { status: 400 });
    if (Number(control.max_order_premium ?? 0) <= 0) return Response.json({ error: "Set a positive maximum live order premium before arming" }, { status: 409 });
    const [{ data: credentials, error: credentialError }, { data: risk, error: riskError }] = await Promise.all([
      supabase.from("broker_credentials").select("broker").eq("broker", "groww").maybeSingle(),
      supabase.from("risk_control_state").select("kill_switch,block_new_entries").eq("id", true).maybeSingle(),
    ]);
    const dependencyError = credentialError ?? riskError;
    if (dependencyError) return Response.json({ error: dependencyError.message }, { status: 503 });
    if (!credentials) return Response.json({ error: "Groww credentials must be configured before live trading can be armed" }, { status: 409 });
    if (risk?.kill_switch || risk?.block_new_entries) return Response.json({ error: "Reset the kill switch before arming live trading" }, { status: 409 });
    const now = new Date().toISOString();
    const { error } = await supabase.from("execution_control_state").update({ live_armed: true, armed_at: now, updated_at: now }).eq("id", true);
    if (error) return Response.json({ error: error.message }, { status: 503 });
    return Response.json({ ok: true, mode: "live", liveArmed: true, armedAt: now });
  }

  return Response.json({ error: "unsupported action" }, { status: 400 });
}
