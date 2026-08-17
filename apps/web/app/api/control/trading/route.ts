import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function numeric(value: unknown): number | null { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : null; }
function textValue(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }

function sanitizeOrder(value: unknown) {
  const row = record(value); const raw = record(row.raw);
  return { id: row.id, signal_id: row.signal_id ?? null, broker_order_id: row.broker_order_id ?? null,
    order_reference_id: row.order_reference_id ?? null, mode: row.mode, execution_source: row.execution_source ?? "algo",
    trading_symbol: row.trading_symbol, side: row.side, quantity: numeric(row.quantity), filled_quantity: numeric(row.filled_quantity),
    average_fill_price: numeric(row.average_fill_price), status: row.status, created_at: row.created_at,
    entry_price: numeric(raw.entry_price ?? row.average_fill_price), paper_fill_price: row.mode === "paper" ? numeric(raw.paper_fill_price ?? raw.entry_price) : null,
    paper_slippage: row.mode === "paper" ? numeric(raw.paper_slippage) : null,
    entry_nifty: numeric(raw.entry_nifty), signal_event: textValue(raw.signal_event), signal_direction: textValue(raw.signal_direction),
    confidence: numeric(raw.confidence), exit_policy: textValue(raw.exit_policy) };
}
function sanitizeTrade(value: unknown) {
  const row = record(value); const raw = record(row.raw);
  return { id: row.id, order_id: row.order_id ?? null, trading_symbol: row.trading_symbol, quantity: numeric(row.quantity), fill_price: numeric(row.fill_price),
    pnl: numeric(row.pnl), executed_at: row.executed_at, entry_price: numeric(raw.entry_price), exit_policy: textValue(raw.exit_policy),
    exit_reason: textValue(raw.exit_reason), paper_slippage: raw.mode === "paper" ? numeric(raw.paper_slippage) : null,
    mode: textValue(raw.mode) ?? "paper", execution_source: row.execution_source ?? "algo",
    broker_order_id: textValue(raw.broker_order_id), order_reference_id: textValue(raw.order_reference_id) };
}

export async function GET() {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const supabase = serverSupabase();
    const [signalsResult, ordersResult, tradesResult, outcomesResult] = await Promise.all([
      supabase.from("signals").select("payload,observed_at").order("observed_at", { ascending: false }).limit(24),
      supabase.from("orders").select("id,signal_id,broker_order_id,order_reference_id,mode,execution_source,trading_symbol,side,quantity,filled_quantity,average_fill_price,status,raw,created_at").order("created_at", { ascending: false }).limit(500),
      supabase.from("trades").select("id,order_id,trading_symbol,quantity,fill_price,pnl,execution_source,raw,executed_at").order("executed_at", { ascending: false }).limit(500),
      supabase.from("paper_signal_outcomes").select("id,signal_id,order_id,horizon_seconds,observed_at,option_ltp,nifty_ltp,option_return_pct,underlying_move_points").order("observed_at", { ascending: false }).limit(500),
    ]);
    const error = signalsResult.error ?? ordersResult.error ?? tradesResult.error ?? outcomesResult.error;
    if (error) return Response.json({ error: error.message }, { status: 503 });
    return Response.json({ recentSignals: signalsResult.data ?? [], paperOrders: (ordersResult.data ?? []).map(sanitizeOrder), paperTrades: (tradesResult.data ?? []).map(sanitizeTrade), paperOutcomes: outcomesResult.data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "trading history failed" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
