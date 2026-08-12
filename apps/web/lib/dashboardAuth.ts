import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const DASHBOARD_COOKIE = "growing_trader_session";
export const DASHBOARD_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

function sessionSecret(): string {
  const value = process.env.DASHBOARD_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("DASHBOARD_SESSION_SECRET must be at least 32 characters");
  }
  return value;
}

function configuredPassword(): string {
  const value = process.env.DASHBOARD_PASSWORD;
  if (!value) throw new Error("DASHBOARD_PASSWORD is required");
  return value;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signature(payload: string): string {
  return createHmac("sha256", sessionSecret())
    .update("growing-trader-dashboard-v3\0")
    .update(configuredPassword())
    .update("\0")
    .update(payload)
    .digest("base64url");
}

export function createSessionValue(nowMs = Date.now()): string {
  const expiresAt = nowMs + DASHBOARD_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `v3.${expiresAt}`;
  return `${payload}.${signature(payload)}`;
}

export function dashboardPasswordMatches(candidate: string): boolean {
  if (!candidate) return false;
  try {
    return safeEqual(candidate, configuredPassword());
  } catch {
    return false;
  }
}

export function sessionValueIsValid(value: string, nowMs = Date.now()): boolean {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v3") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return false;
  if (expiresAt > nowMs + DASHBOARD_SESSION_MAX_AGE_SECONDS * 1000 + 60_000) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  try {
    return safeEqual(parts[2], signature(payload));
  } catch {
    return false;
  }
}

export async function isDashboardAuthorized(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(DASHBOARD_COOKIE)?.value;
  return value ? sessionValueIsValid(value) : false;
}
