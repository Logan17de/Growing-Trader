import { cookies } from "next/headers";
import {
  createSessionValue,
  DASHBOARD_COOKIE,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
  dashboardPasswordMatches,
} from "@/lib/dashboardAuth";

export async function POST(request: Request) {
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!dashboardPasswordMatches(body.password ?? "")) {
    return Response.json({ error: "invalid password" }, { status: 401 });
  }
  const store = await cookies();
  store.set(DASHBOARD_COOKIE, createSessionValue(), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: DASHBOARD_SESSION_MAX_AGE_SECONDS,
  });
  return Response.json({ ok: true });
}
