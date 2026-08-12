import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const DASHBOARD_COOKIE = "growing_trader_session";

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

export function expectedSessionValue(): string {
  return createHmac("sha256", sessionSecret())
    .update("growing-trader-dashboard-v2\0")
    .update(configuredPassword())
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function dashboardPasswordMatches(candidate: string): boolean {
  if (!candidate) return false;
  try {
    return safeEqual(candidate, configuredPassword());
  } catch {
    return false;
  }
}

export async function isDashboardAuthorized(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(DASHBOARD_COOKIE)?.value;
  if (!value) return false;
  try {
    return safeEqual(value, expectedSessionValue());
  } catch {
    return false;
  }
}
