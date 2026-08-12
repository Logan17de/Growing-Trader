import { cookies } from "next/headers";
import { DASHBOARD_COOKIE, dashboardPasswordMatches, expectedSessionValue } from "@/lib/dashboardAuth";

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
  store.set(DASHBOARD_COOKIE, expectedSessionValue(), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return Response.json({ ok: true });
}
