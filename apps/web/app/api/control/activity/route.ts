import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

export async function GET(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const severity = url.searchParams.get("severity");
  const component = url.searchParams.get("component");
  const search = url.searchParams.get("search")?.trim().slice(0, 100) ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 250), 1), 1000);

  let query = serverSupabase().from("runtime_events")
    .select("id,observed_at,severity,component,event_type,message,detail,instrument,metadata")
    .order("observed_at", { ascending: false }).limit(limit);
  if (severity && severity !== "all") query = query.eq("severity", severity);
  if (component && component !== "all") query = query.eq("component", component);
  if (search) query = query.or(`message.ilike.%${search.replaceAll(",", "")}%,detail.ilike.%${search.replaceAll(",", "")}%,instrument.ilike.%${search.replaceAll(",", "")}%`);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 503 });
  return Response.json({ events: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}
