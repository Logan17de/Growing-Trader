import { encryptCredential } from "@/lib/credentialCrypto";
import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { parseGrowwCredentialFile } from "@/lib/growwCredentialFile";
import { serverSupabase } from "@/lib/serverSupabase";

const MAX_FILE_BYTES = 64 * 1024;

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "upload a valid .txt credential file" }, { status: 400 });
  }

  const uploaded = form.get("credentials");
  if (!(uploaded instanceof File)) {
    return Response.json({ error: "credential .txt file is required" }, { status: 400 });
  }
  if (!uploaded.name.toLowerCase().endsWith(".txt")) {
    return Response.json({ error: "credential file must use the .txt extension" }, { status: 400 });
  }
  if (uploaded.size <= 0 || uploaded.size > MAX_FILE_BYTES) {
    return Response.json({ error: "credential file must be between 1 byte and 64 KB" }, { status: 400 });
  }

  let apiKey: string;
  let apiSecret: string;
  try {
    const parsed = parseGrowwCredentialFile(await uploaded.text());
    apiKey = parsed.apiKey;
    apiSecret = parsed.apiSecret;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid Groww credential file" }, { status: 400 });
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
