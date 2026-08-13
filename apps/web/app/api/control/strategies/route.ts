import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

export async function GET() {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supabase = serverSupabase();
  const { data, error } = await supabase.from("strategy_presets").select("*").order("updated_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 503 });
  return Response.json({ presets: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as null | { action?: string; id?: string; name?: string; description?: string };
  if (!body?.action) return Response.json({ error: "action is required" }, { status: 400 });
  const supabase = serverSupabase();
  try {
    if (body.action === "duplicate") {
      const { data: rows, error } = await supabase.from("strategy_parameters").select("key,value");
      if (error) throw error;
      const parameters = Object.fromEntries((rows ?? []).map((row) => [row.key, Number(row.value)]));
      const name = (body.name ?? `Strategy copy ${new Date().toLocaleDateString("en-CA")}`).trim().slice(0, 80);
      if (!name) return Response.json({ error: "name is required" }, { status: 400 });
      const result = await supabase.from("strategy_presets").insert({ name, description: body.description ?? "Duplicated from active strategy", parameters, is_active: false }).select("*").single();
      if (result.error) throw result.error;
      return Response.json({ preset: result.data }, { status: 201 });
    }
    if (body.action === "activate") {
      if (!body.id) return Response.json({ error: "preset id is required" }, { status: 400 });
      const { data: preset, error } = await supabase.from("strategy_presets").select("id,parameters").eq("id", body.id).single();
      if (error) throw error;
      const parameters = preset.parameters && typeof preset.parameters === "object" ? preset.parameters as Record<string, unknown> : {};
      const { data: knownRows, error: knownError } = await supabase.from("strategy_parameters").select("key");
      if (knownError) throw knownError;
      const known = new Set((knownRows ?? []).map((row) => row.key));
      const updates = Object.entries(parameters).filter(([key, value]) => known.has(key) && Number.isFinite(Number(value))).map(([key, value]) => ({ key, value: Number(value), updated_at: new Date().toISOString() }));
      if (!updates.length) return Response.json({ error: "preset has no valid strategy parameters" }, { status: 400 });
      const updateParams = await supabase.from("strategy_parameters").upsert(updates, { onConflict: "key" });
      if (updateParams.error) throw updateParams.error;
      const clear = await supabase.from("strategy_presets").update({ is_active: false }).neq("id", body.id);
      if (clear.error) throw clear.error;
      const activate = await supabase.from("strategy_presets").update({ is_active: true, updated_at: new Date().toISOString() }).eq("id", body.id);
      if (activate.error) throw activate.error;
      return Response.json({ ok: true });
    }
    if (body.action === "rename") {
      if (!body.id || !body.name?.trim()) return Response.json({ error: "preset id and name are required" }, { status: 400 });
      const result = await supabase.from("strategy_presets").update({ name: body.name.trim().slice(0, 80), description: body.description ?? "", updated_at: new Date().toISOString() }).eq("id", body.id);
      if (result.error) throw result.error;
      return Response.json({ ok: true });
    }
    return Response.json({ error: "unsupported action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "strategy preset operation failed" }, { status: 400 });
  }
}
