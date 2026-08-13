import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";
import { validateStrategyValues } from "@/lib/strategyValidation";

function numericRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const number = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(number)) throw new Error(`${key} must be numeric`);
    output[key] = number;
  }
  return output;
}

function validateEngineSettings(values: Record<string, number>) {
  const rules: Record<string, [number, number]> = {
    account_equity: [1, 1_000_000_000],
    quote_scan_seconds: [5, 600],
    option_refresh_seconds: [5, 600],
    feed_poll_seconds: [0.25, 60],
    signal_persist_seconds: [5, 3600],
    paper_slippage_bps: [0, 100],
    paper_fee_rate_pct: [0, 0.10],
  };
  for (const [key, value] of Object.entries(values)) {
    const rule = rules[key];
    if (!rule) throw new Error(`unsupported engine setting: ${key}`);
    if (value < rule[0] || value > rule[1]) throw new Error(`${key} must be between ${rule[0]} and ${rule[1]}`);
  }
}

async function loadConfig() {
  const supabase = serverSupabase();
  const [parameters, settings, strategy, presets, risk, preferences] = await Promise.all([
    supabase.from("strategy_parameters").select("key,category,value,unit,description,updated_at").order("category").order("key"),
    supabase.from("engine_settings").select("key,category,value,unit,description,updated_at").order("category").order("key"),
    supabase.from("strategy_runtime_state").select("strategy_id,name,enabled,version,active_preset_id,updated_at").eq("strategy_id", "level-event").maybeSingle(),
    supabase.from("strategy_presets").select("id,name,description,parameters,created_at,updated_at").order("created_at", { ascending: false }),
    supabase.from("risk_control_state").select("worker_id,kill_switch_enabled,reason,updated_at").eq("worker_id", "oracle-primary").maybeSingle(),
    supabase.from("terminal_preferences").select("preference_id,refresh_interval_ms,timezone,number_locale,alert_preferences,updated_at").eq("preference_id", "default").maybeSingle(),
  ]);
  const error = parameters.error ?? settings.error ?? strategy.error ?? presets.error ?? risk.error ?? preferences.error;
  if (error) throw new Error(error.message);
  return {
    strategyParameters: parameters.data ?? [],
    engineSettings: settings.data ?? [],
    strategyState: strategy.data ?? null,
    strategyPresets: presets.data ?? [],
    riskControl: risk.data ?? null,
    terminalPreferences: preferences.data ?? null,
  };
}

export async function GET() {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json(await loadConfig(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "configuration unavailable" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: {
    parameters?: Record<string, unknown>;
    engineSettings?: Record<string, unknown>;
    strategyEnabled?: boolean;
    preferences?: { refresh_interval_ms?: number; alert_preferences?: Record<string, boolean> };
  };
  try { body = await request.json(); }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  try {
    const supabase = serverSupabase();
    if (body.parameters) {
      const patch = numericRecord(body.parameters);
      const { data: rows, error } = await supabase.from("strategy_parameters").select("key,value,category,unit,description");
      if (error) throw new Error(error.message);
      const known = new Map((rows ?? []).map((row) => [String(row.key), row]));
      for (const key of Object.keys(patch)) if (!known.has(key)) throw new Error(`unknown strategy parameter: ${key}`);
      const merged = Object.fromEntries((rows ?? []).map((row) => [String(row.key), Number(row.value)]));
      Object.assign(merged, patch);
      validateStrategyValues(merged);
      const now = new Date().toISOString();
      const updates = Object.entries(patch).map(([key, value]) => {
        const row = known.get(key)!;
        return { key, value, category: row.category, unit: row.unit, description: row.description, updated_at: now };
      });
      if (updates.length) {
        const { error: updateError } = await supabase.from("strategy_parameters").upsert(updates, { onConflict: "key" });
        if (updateError) throw new Error(updateError.message);
        const { data: state } = await supabase.from("strategy_runtime_state").select("version").eq("strategy_id", "level-event").maybeSingle();
        await supabase.from("strategy_runtime_state").update({ version: Number(state?.version ?? 1) + 1, active_preset_id: null, updated_at: now }).eq("strategy_id", "level-event");
      }
    }

    if (body.engineSettings) {
      const patch = numericRecord(body.engineSettings);
      validateEngineSettings(patch);
      const { data: existing, error } = await supabase.from("engine_settings").select("key,category,unit,description");
      if (error) throw new Error(error.message);
      const known = new Map((existing ?? []).map((row) => [String(row.key), row]));
      for (const key of Object.keys(patch)) if (!known.has(key)) throw new Error(`unknown engine setting: ${key}`);
      const now = new Date().toISOString();
      const updates = Object.entries(patch).map(([key, value]) => {
        const row = known.get(key)!;
        return { key, value, category: row.category, unit: row.unit, description: row.description, updated_at: now };
      });
      if (updates.length) {
        const { error: updateError } = await supabase.from("engine_settings").upsert(updates, { onConflict: "key" });
        if (updateError) throw new Error(updateError.message);
      }
    }

    if (typeof body.strategyEnabled === "boolean") {
      const { error } = await supabase.from("strategy_runtime_state").update({ enabled: body.strategyEnabled, updated_at: new Date().toISOString() }).eq("strategy_id", "level-event");
      if (error) throw new Error(error.message);
      await supabase.from("runtime_events").insert({
        severity: body.strategyEnabled ? "success" : "warning",
        component: "strategy",
        event_type: body.strategyEnabled ? "strategy_activated" : "strategy_deactivated",
        message: body.strategyEnabled ? "Level-event strategy activated" : "Level-event strategy deactivated",
        detail: body.strategyEnabled ? "New paper entries are enabled when all other risk checks pass." : "Market collection continues, but new paper entries are blocked.",
      });
    }

    if (body.preferences) {
      const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.preferences.refresh_interval_ms !== undefined) {
        const refresh = Number(body.preferences.refresh_interval_ms);
        if (!Number.isInteger(refresh) || refresh < 1000 || refresh > 60000) throw new Error("refresh interval must be 1000–60000 ms");
        values.refresh_interval_ms = refresh;
      }
      if (body.preferences.alert_preferences !== undefined) values.alert_preferences = body.preferences.alert_preferences;
      const { error } = await supabase.from("terminal_preferences").update(values).eq("preference_id", "default");
      if (error) throw new Error(error.message);
    }

    return Response.json(await loadConfig());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "configuration update failed" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: { action?: string; name?: string; description?: string; presetId?: string };
  try { body = await request.json(); }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  try {
    const supabase = serverSupabase();
    if (body.action === "duplicate_strategy") {
      const name = body.name?.trim().slice(0, 80) ?? "";
      if (!name) throw new Error("preset name is required");
      const { data: rows, error } = await supabase.from("strategy_parameters").select("key,value");
      if (error) throw new Error(error.message);
      const parameters = Object.fromEntries((rows ?? []).map((row) => [String(row.key), Number(row.value)]));
      validateStrategyValues(parameters);
      const { error: insertError } = await supabase.from("strategy_presets").insert({ name, description: body.description?.trim().slice(0, 300) ?? "", parameters });
      if (insertError) throw new Error(insertError.message);
    } else if (body.action === "apply_preset") {
      if (!body.presetId) throw new Error("preset id is required");
      const { data: preset, error } = await supabase.from("strategy_presets").select("id,parameters").eq("id", body.presetId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!preset) throw new Error("preset not found");
      const values = numericRecord(preset.parameters);
      validateStrategyValues(values);
      const { data: rows, error: rowError } = await supabase.from("strategy_parameters").select("key,category,unit,description");
      if (rowError) throw new Error(rowError.message);
      const known = new Map((rows ?? []).map((row) => [String(row.key), row]));
      const missing = [...known.keys()].filter((key) => !(key in values));
      if (missing.length) throw new Error(`preset is missing parameters: ${missing.join(", ")}`);
      const now = new Date().toISOString();
      const updates = [...known.entries()].map(([key, row]) => ({ key, value: values[key], category: row.category, unit: row.unit, description: row.description, updated_at: now }));
      const { error: updateError } = await supabase.from("strategy_parameters").upsert(updates, { onConflict: "key" });
      if (updateError) throw new Error(updateError.message);
      const { data: state } = await supabase.from("strategy_runtime_state").select("version").eq("strategy_id", "level-event").maybeSingle();
      await supabase.from("strategy_runtime_state").update({ active_preset_id: preset.id, version: Number(state?.version ?? 1) + 1, updated_at: now }).eq("strategy_id", "level-event");
    } else {
      throw new Error("unsupported configuration action");
    }
    return Response.json(await loadConfig());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "configuration action failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: { presetId?: string };
  try { body = await request.json(); }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.presetId) return Response.json({ error: "preset id is required" }, { status: 400 });
  const { error } = await serverSupabase().from("strategy_presets").delete().eq("id", body.presetId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
