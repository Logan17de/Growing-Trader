import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

const STRATEGY_GROUPS = [
  ["cash_pressure_weight", "breadth_weight", "heavyweight_weight"],
  ["futures_price_weight", "futures_oi_weight", "futures_basis_weight"],
  ["option_direction_volume_weight", "option_direction_oi_weight", "option_direction_iv_weight"],
  ["combined_cash_weight", "combined_futures_weight", "combined_options_weight", "combined_vwap_weight"],
  ["level_direction_weight", "level_distance_weight", "level_persistence_weight", "level_participation_weight", "level_acceleration_weight"],
  ["option_volume_liquidity_weight", "option_oi_liquidity_weight"],
  ["option_delta_weight", "option_liquidity_weight", "option_theta_weight", "option_iv_weight", "option_gamma_weight"],
] as const;

function validateParameters(values: Record<string, number>) {
  for (const [key, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  }
  for (const group of STRATEGY_GROUPS) {
    if (!group.every((key) => key in values)) continue;
    const sum = group.reduce((total, key) => total + values[key], 0);
    if (Math.abs(sum - 1) > 1e-8) throw new Error(`${group.join(" + ")} must sum to 1.0`);
    if (group.some((key) => values[key] < 0)) throw new Error("Strategy weights cannot be negative");
  }
  if ("min_abs_delta" in values && "target_abs_delta" in values && "max_abs_delta" in values) {
    if (!(values.min_abs_delta <= values.target_abs_delta && values.target_abs_delta <= values.max_abs_delta)) {
      throw new Error("Target delta must stay inside the configured delta band");
    }
  }
  const unitKeys = ["participation_floor","breakout_threshold","reversal_threshold","decision_margin","target_abs_delta","min_abs_delta","max_abs_delta","max_spread_pct","exit_profit_target_pct","exit_stop_loss_pct","exit_trailing_activation_pct","exit_trailing_drawdown_pct","exit_signal_flip_threshold","risk_per_trade_pct","daily_loss_limit_pct","min_signal_confidence"];
  for (const key of unitKeys) if (key in values && (values[key] < 0 || values[key] > 1)) throw new Error(`${key} must be in [0, 1]`);
}

export async function GET() {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supabase = serverSupabase();
  const [parameters, settings, risk, notifications, presets] = await Promise.all([
    supabase.from("strategy_parameters").select("key,category,value,unit,description,updated_at").order("category").order("key"),
    supabase.from("app_settings").select("key,category,value,description,updated_at").order("category").order("key"),
    supabase.from("risk_control_state").select("*").eq("id", true).maybeSingle(),
    supabase.from("notification_preferences").select("*").eq("id", true).maybeSingle(),
    supabase.from("strategy_presets").select("id,name,description,parameters,is_active,created_at,updated_at").order("updated_at", { ascending: false }),
  ]);
  const error = parameters.error ?? settings.error ?? risk.error ?? notifications.error ?? presets.error;
  if (error) return Response.json({ error: error.message }, { status: 503 });
  return Response.json({
    strategyParameters: parameters.data ?? [], appSettings: settings.data ?? [],
    riskControl: risk.data ?? null, notifications: notifications.data ?? null,
    strategyPresets: presets.data ?? [],
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as null | {
    strategyParameters?: Record<string, number>;
    appSettings?: Record<string, unknown>;
    notifications?: Record<string, unknown>;
    riskControl?: Record<string, unknown>;
  };
  if (!body) return Response.json({ error: "invalid JSON" }, { status: 400 });
  const supabase = serverSupabase();
  try {
    if (body.strategyParameters) {
      const { data: current, error } = await supabase.from("strategy_parameters").select("key,value");
      if (error) throw error;
      const merged = Object.fromEntries((current ?? []).map((row) => [row.key, Number(row.value)]));
      for (const [key, value] of Object.entries(body.strategyParameters)) merged[key] = Number(value);
      validateParameters(merged);
      const known = new Set((current ?? []).map((row) => row.key));
      const rows = Object.entries(body.strategyParameters).filter(([key]) => known.has(key)).map(([key, value]) => ({ key, value: Number(value), updated_at: new Date().toISOString() }));
      if (rows.length) {
        const result = await supabase.from("strategy_parameters").upsert(rows, { onConflict: "key" });
        if (result.error) throw result.error;
      }
    }
    if (body.appSettings) {
      const { data: current, error } = await supabase.from("app_settings").select("key");
      if (error) throw error;
      const known = new Set((current ?? []).map((row) => row.key));
      const rows = Object.entries(body.appSettings).filter(([key]) => known.has(key)).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
      if (rows.length) {
        const result = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
        if (result.error) throw result.error;
      }
    }
    if (body.notifications) {
      const allowed = ["in_app_enabled","signal_alerts","risk_blocks","system_errors","command_events","min_confidence"];
      const values = Object.fromEntries(Object.entries(body.notifications).filter(([key]) => allowed.includes(key)));
      const result = await supabase.from("notification_preferences").update({ ...values, updated_at: new Date().toISOString() }).eq("id", true);
      if (result.error) throw result.error;
    }
    if (body.riskControl) {
      const allowed = ["close_open_position_on_kill"];
      const values = Object.fromEntries(Object.entries(body.riskControl).filter(([key]) => allowed.includes(key)));
      const result = await supabase.from("risk_control_state").update({ ...values, updated_at: new Date().toISOString() }).eq("id", true);
      if (result.error) throw result.error;
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "configuration update failed" }, { status: 400 });
  }
}
