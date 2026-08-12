import { cookies } from "next/headers";
import { DASHBOARD_COOKIE } from "@/lib/dashboardAuth";

export async function POST() {
  const store = await cookies();
  store.set(DASHBOARD_COOKIE, "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
  return Response.json({ ok: true });
}
