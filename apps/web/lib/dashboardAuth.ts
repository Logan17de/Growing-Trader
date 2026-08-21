import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const DASHBOARD_COOKIE = "growing_trader_session";
export const DASHBOARD_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
export const DASHBOARD_OTP_TTL_SECONDS = 10 * 60;
export const DASHBOARD_OTP_RESEND_SECONDS = 60;
export const DASHBOARD_OTP_MAX_ATTEMPTS = 5;

function sessionSecret(): string {
  const value = process.env.DASHBOARD_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("DASHBOARD_SESSION_SECRET must be at least 32 characters");
  }
  return value;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionSignature(payload: string): string {
  return createHmac("sha256", sessionSecret())
    .update("growing-trader-dashboard-v4\0")
    .update(payload)
    .digest("base64url");
}

export function createSessionValue(nowMs = Date.now()): string {
  const expiresAt = nowMs + DASHBOARD_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `v4.${expiresAt}`;
  return `${payload}.${sessionSignature(payload)}`;
}

export function sessionValueIsValid(value: string, nowMs = Date.now()): boolean {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v4") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return false;
  if (expiresAt > nowMs + DASHBOARD_SESSION_MAX_AGE_SECONDS * 1000 + 60_000) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  try {
    return safeEqual(parts[2], sessionSignature(payload));
  } catch {
    return false;
  }
}

export function dashboardLoginEmail(): string {
  const email = (process.env.DASHBOARD_LOGIN_EMAIL || process.env.TRADING_REPORT_TO || "").trim();
  if (!email || !email.includes("@")) {
    throw new Error("DASHBOARD_LOGIN_EMAIL or TRADING_REPORT_TO must be configured");
  }
  return email;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "your configured email";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function loginCodeHash(challengeId: string, code: string): string {
  return createHmac("sha256", sessionSecret())
    .update("growing-trader-login-code-v1\0")
    .update(challengeId)
    .update("\0")
    .update(code)
    .digest("base64url");
}

export function loginCodeMatches(challengeId: string, code: string, expectedHash: string): boolean {
  try {
    return safeEqual(loginCodeHash(challengeId, code), expectedHash);
  } catch {
    return false;
  }
}

export function loginRequestFingerprint(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const realIp = request.headers.get("x-real-ip")?.trim() ?? "unknown";
  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? "unknown";
  return createHmac("sha256", sessionSecret())
    .update("growing-trader-login-rate-limit-v1\0")
    .update(forwardedFor)
    .update("\0")
    .update(realIp)
    .update("\0")
    .update(userAgent)
    .digest("base64url");
}

export async function isDashboardAuthorized(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(DASHBOARD_COOKIE)?.value;
  return value ? sessionValueIsValid(value) : false;
}
