import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

const ALLOWED_DAYS = new Set([1, 7, 30, 90]);
const ALLOWED_FORMATS = new Set(["csv", "jsonl"]);
const PAGE_SIZE = 1000;
const MAX_ROWS = 100_000;

type ExportFormat = "csv" | "jsonl";
type ExportRow = Record<string, unknown>;

function csvCell(value: unknown) {
  if (value == null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function toCsv(rows: ExportRow[]) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(","));
  return `${lines.join("\n")}\n`;
}

async function loadRows(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const supabase = serverSupabase();
  const rows: ExportRow[] = [];

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const result = await supabase
      .from("market_watch_labeled")
      .select("*")
      .gte("observed_at", since)
      .order("observed_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (result.error) throw new Error(result.error.message);
    const page = (result.data ?? []) as ExportRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }

  throw new Error(`Market Watch export exceeds the ${MAX_ROWS.toLocaleString("en-IN")} row safety limit; choose a shorter window.`);
}

export async function GET(request: Request) {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const requestedDays = Number(url.searchParams.get("days") ?? 30);
    const days = ALLOWED_DAYS.has(requestedDays) ? requestedDays : 30;
    const requestedFormat = (url.searchParams.get("format") ?? "csv").toLowerCase();
    const format: ExportFormat = ALLOWED_FORMATS.has(requestedFormat) ? requestedFormat as ExportFormat : "csv";
    const rows = await loadRows(days);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `market-watch-${days}d-${date}.${format}`;
    const body = format === "jsonl" ? `${rows.map((row) => JSON.stringify(row)).join("\n")}${rows.length ? "\n" : ""}` : toCsv(rows);

    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": format === "jsonl" ? "application/x-ndjson; charset=utf-8" : "text/csv; charset=utf-8",
        "X-Market-Watch-Rows": String(rows.length),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market Watch export failed";
    const status = message.includes("row safety limit") ? 413 : 503;
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
