import { encryptCredential } from "@/lib/credentialCrypto";
import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { apiKey?: string; apiSecret?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim() ?? "";
  const apiSecret = body.apiSecret ?? "";
  if (apiKey.length < 8 || apiSecret.length < 8) {
    return Response.json({ error: "API key and secret are required" }, { status: 400 });
  }
  if (apiKey.length > 512 || apiSecret.length > 512) {
    return Response.json({ error: "credential value is too long" }, { status: 400 });
  }

  const supabase = serverSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase.from("broker_credentials").upsert({
    broker: "groww",
    api_key_ciphertext: encryptCredential(apiKey),
    api_secret_ciphertext: encryptCredential(apiSecret),
    updated_at: now,
  }, { onConflict: "broker" });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  await supabase.from("engine_status").update({
    groww_authenticated: false,
    market_data_status: "unknown",
    market_data: null,
    last_error: null,
    updated_at: now,
  }).eq("worker_id", "oracle-primary");

  return Response.json({ ok: true, configured: true });
}
