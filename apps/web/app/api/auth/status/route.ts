import { isDashboardAuthorized } from "@/lib/dashboardAuth";

export async function GET() {
  return Response.json({ authenticated: await isDashboardAuthorized() }, { headers: { "Cache-Control": "no-store" } });
}
