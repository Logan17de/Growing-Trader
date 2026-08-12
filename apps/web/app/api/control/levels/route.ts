import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: { name?:string; kind?:string; price?:number; enabled?:boolean };
  try { body = await request.json(); }
  catch { return Response.json({ error:"invalid JSON" }, { status:400 }); }

  const name = body.name?.trim().slice(0, 40) ?? "";
  const kind = body.kind;
  const price = Number(body.price);
  if (!name || !["support","resistance"].includes(kind ?? "") || !Number.isFinite(price) || price <= 0) {
    return Response.json({ error:"valid name, kind and positive price are required" }, { status:400 });
  }

  const supabase = serverSupabase();
  const { data, error } = await supabase.from("strategy_levels").upsert({
    name, kind, price, source:"dashboard", enabled:body.enabled ?? true, updated_at:new Date().toISOString(),
  }, { onConflict:"name" }).select("id,name,kind,price,source,enabled,updated_at").single();
  if (error) return Response.json({ error:error.message }, { status:500 });
  return Response.json(data);
}

export async function DELETE(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: { id?:string };
  try { body = await request.json(); }
  catch { return Response.json({ error:"invalid JSON" }, { status:400 }); }
  if (!body.id) return Response.json({ error:"level id is required" }, { status:400 });
  const { error } = await serverSupabase().from("strategy_levels").delete().eq("id", body.id);
  if (error) return Response.json({ error:error.message }, { status:500 });
  return Response.json({ ok:true });
}
