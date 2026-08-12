import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

const ALLOWED = new Set(["TEST_AUTH", "TEST_MARKET_DATA", "STOP"]);

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { command?: string; payload?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const command = body.command ?? "";
  if (!ALLOWED.has(command)) return Response.json({ error: "unsupported command" }, { status: 400 });

  const supabase = serverSupabase();
  const { data, error } = await supabase.from("engine_commands")
    .insert({ command, payload: body.payload ?? {} })
    .select("id, command, status, created_at")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 202 });
}
