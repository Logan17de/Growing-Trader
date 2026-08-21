import { cookies } from "next/headers";
import {
  createSessionValue,
  DASHBOARD_COOKIE,
  DASHBOARD_OTP_MAX_ATTEMPTS,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
  loginCodeMatches,
} from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

export async function POST(request: Request) {
  let body: { challengeId?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const challengeId = (body.challengeId ?? "").trim();
  const code = (body.code ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) {
    return Response.json({ error: "Enter the 6-digit code from your email" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const supabase = serverSupabase();
  const { data: challenge, error } = await supabase
    .from("dashboard_login_challenges")
    .select("id,code_hash,expires_at,attempts,consumed_at")
    .eq("id", challengeId)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!challenge || challenge.consumed_at || Date.parse(challenge.expires_at) <= Date.now()) {
    return Response.json({ error: "This login code has expired. Request a new code." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const attempts = Number(challenge.attempts ?? 0);
  if (attempts >= DASHBOARD_OTP_MAX_ATTEMPTS) {
    return Response.json({ error: "Too many incorrect attempts. Request a new code." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  if (!loginCodeMatches(challengeId, code, String(challenge.code_hash))) {
    const nextAttempts = attempts + 1;
    await supabase
      .from("dashboard_login_challenges")
      .update({
        attempts: nextAttempts,
        consumed_at: nextAttempts >= DASHBOARD_OTP_MAX_ATTEMPTS ? new Date().toISOString() : null,
      })
      .eq("id", challengeId);
    const remaining = Math.max(0, DASHBOARD_OTP_MAX_ATTEMPTS - nextAttempts);
    return Response.json(
      { error: remaining ? `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.` : "Too many incorrect attempts. Request a new code." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  await supabase
    .from("dashboard_login_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", challengeId);

  const store = await cookies();
  store.set(DASHBOARD_COOKIE, createSessionValue(), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: DASHBOARD_SESSION_MAX_AGE_SECONDS,
  });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
