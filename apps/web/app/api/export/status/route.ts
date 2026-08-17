import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { buildCurrentStatusReport } from "@/lib/currentStatusReport";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const report = await buildCurrentStatusReport();
    return Response.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "current status export failed" }, { status: 503 });
  }
}
