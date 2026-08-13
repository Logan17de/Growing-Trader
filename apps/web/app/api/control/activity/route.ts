import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

type EventRow = {
  id: number; observed_at: string; severity: string; component: string; event_type: string;
  title: string; detail: string; instrument: string | null; metadata: Record<string, unknown> | null;
};

export async function GET(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 200), 1), 500);
  const supabase = serverSupabase();
  const [eventsResult, preferencesResult] = await Promise.all([
    supabase.from("activity_events").select("id,observed_at,severity,component,event_type,title,detail,instrument,metadata").order("observed_at", { ascending: false }).limit(limit),
    supabase.from("notification_preferences").select("in_app_enabled,signal_alerts,risk_blocks,system_errors,command_events,min_confidence").eq("id", true).maybeSingle(),
  ]);
  const error = eventsResult.error ?? preferencesResult.error;
  if (error) return Response.json({ error: error.message }, { status: 503 });
  const prefs = preferencesResult.data;
  if (prefs && !prefs.in_app_enabled) return Response.json({ events: [] }, { headers: { "Cache-Control": "private, no-store" } });
  const events = ((eventsResult.data ?? []) as EventRow[]).filter((event) => {
    if (!prefs) return true;
    const type = event.event_type.toLowerCase();
    const component = event.component.toLowerCase();
    if ((type.includes("signal") || component === "signal-engine") && !prefs.signal_alerts) return false;
    if ((type.includes("risk") || type.includes("kill") || component === "risk") && !prefs.risk_blocks) return false;
    if ((event.severity === "critical" || type.includes("error") || type.includes("failed")) && !prefs.system_errors) return false;
    if ((type.includes("command") || component === "control-plane") && !prefs.command_events) return false;
    const confidence = Number(event.metadata?.confidence);
    if ((type.includes("signal") || component === "signal-engine") && Number.isFinite(confidence) && confidence < Number(prefs.min_confidence ?? 0)) return false;
    return true;
  });
  return Response.json({ events }, { headers: { "Cache-Control": "private, no-store" } });
}
