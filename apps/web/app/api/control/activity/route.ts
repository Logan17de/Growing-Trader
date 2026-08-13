import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

export async function GET(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 200), 1), 500);
  const supabase = serverSupabase();
  const { data, error } = await supabase.from("activity_events")
    .select("id,observed_at,severity,component,event_type,title,detail,instrument,metadata")
    .order("observed_at", { ascending: false }).limit(limit);
  if (error) return Response.json({ error: error.message }, { status: 503 });
  return Response.json({ events: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}
