import { randomInt, randomUUID } from "node:crypto";
import {
  DASHBOARD_OTP_RESEND_SECONDS,
  DASHBOARD_OTP_TTL_SECONDS,
  dashboardLoginEmail,
  loginCodeHash,
  loginRequestFingerprint,
  maskEmail,
} from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.TRADING_REPORT_FROM?.trim();
  if (!apiKey || !from) {
    return Response.json(
      { error: "Email login is not configured on the server" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let to: string;
  let fingerprint: string;
  try {
    to = dashboardLoginEmail();
    fingerprint = loginRequestFingerprint(request);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Email login is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const supabase = serverSupabase();
  const now = Date.now();
  const resendCutoff = new Date(now - DASHBOARD_OTP_RESEND_SECONDS * 1000).toISOString();
  const { data: recent, error: recentError } = await supabase
    .from("dashboard_login_challenges")
    .select("created_at")
    .eq("request_fingerprint", fingerprint)
    .gte("created_at", resendCutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentError) {
    return Response.json({ error: recentError.message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (recent?.created_at) {
    const retryAfter = Math.max(
      1,
      DASHBOARD_OTP_RESEND_SECONDS - Math.floor((now - Date.parse(recent.created_at)) / 1000),
    );
    return Response.json(
      { error: `A login code was already sent. Try again in ${retryAfter}s.` },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) } },
    );
  }

  const challengeId = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(now + DASHBOARD_OTP_TTL_SECONDS * 1000).toISOString();

  const { error: insertError } = await supabase.from("dashboard_login_challenges").insert({
    id: challengeId,
    request_fingerprint: fingerprint,
    code_hash: loginCodeHash(challengeId, code),
    expires_at: expiresAt,
    attempts: 0,
  });
  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const html = `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#172033"><div style="max-width:560px;margin:28px auto;background:#fff;border:1px solid #e4e9f1;border-radius:14px;padding:28px"><div style="font-size:22px;font-weight:800">Growing Trader</div><h1 style="font-size:23px;margin:24px 0 8px">Your access code</h1><p style="color:#667085">Use this one-time code to open your private trading terminal.</p><div style="font-size:38px;font-weight:800;letter-spacing:10px;margin:26px 0;padding:18px;text-align:center;background:#f5f7fa;border-radius:12px">${code}</div><p style="font-size:13px;color:#667085">This code expires in 10 minutes and can be tried up to 5 times. If you did not open Growing Trader, you can ignore this email.</p></div></body></html>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `growing-trader-login-${challengeId}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Your Growing Trader access code",
      html,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    await supabase.from("dashboard_login_challenges").delete().eq("id", challengeId);
    return Response.json(
      { error: "Could not send the login code. Check the dashboard email configuration." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  void supabase
    .from("dashboard_login_challenges")
    .delete()
    .lt("expires_at", new Date(now - 24 * 60 * 60 * 1000).toISOString());

  return Response.json(
    {
      ok: true,
      challengeId,
      maskedEmail: maskEmail(to),
      expiresInSeconds: DASHBOARD_OTP_TTL_SECONDS,
      resendAfterSeconds: DASHBOARD_OTP_RESEND_SECONDS,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
