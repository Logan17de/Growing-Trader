import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function numeric(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function textValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sanitizeOrder(value: unknown) {
  const row = record(value);
  const raw = record(row.raw);
  const requested = numeric(raw.requested_price);
  const fill = numeric(raw.entry_price);
  return {
    id: row.id,
    signal_id: row.signal_id ?? null,
    broker_order_id: row.broker_order_id ?? null,
    mode: row.mode,
    trading_symbol: row.trading_symbol,
    side: row.side,
    quantity: numeric(row.quantity),
    status: row.status,
    created_at: row.created_at,
    entry_price: fill,
    requested_price: requested ?? fill,
    average_fill: fill,
    entry_nifty: numeric(raw.entry_nifty),
    signal_event: textValue(raw.signal_event),
    signal_direction: textValue(raw.signal_direction),
    confidence: numeric(raw.confidence),
    exit_policy: textValue(raw.exit_policy),
    exit_reason: textValue(raw.exit_reason),
    exit_price: numeric(raw.exit_price),
    closed_at: textValue(raw.closed_at),
    strategy_id: textValue(raw.strategy_id) ?? "level-event",
    strategy_version: numeric(raw.strategy_version),
    option_type: textValue(raw.option_type),
    strike: numeric(raw.strike),
    lot_size: numeric(raw.lot_size),
    slippage_bps: numeric(raw.paper_slippage_bps),
    fee_rate_pct: numeric(raw.paper_fee_rate_pct),
    manual_stop_price: numeric(raw.manual_stop_price),
    trailing_enabled: typeof raw.trailing_enabled === "boolean" ? raw.trailing_enabled : null,
  };
}

function sanitizeTrade(value: unknown) {
  const row = record(value);
  const raw = record(row.raw);
  const requestedExit = numeric(raw.requested_exit_price);
  const fill = numeric(row.fill_price);
  const slippagePoints = requestedExit !== null && fill !== null ? fill - requestedExit : null;
  return {
    id: row.id,
    order_id: row.order_id ?? null,
    trading_symbol: row.trading_symbol,
    quantity: numeric(row.quantity),
    fill_price: fill,
    pnl: numeric(row.pnl),
    executed_at: row.executed_at,
    entry_price: numeric(raw.entry_price),
    requested_exit_price: requestedExit,
    slippage_points: slippagePoints,
    fees: numeric(raw.fees),
    hold_seconds: numeric(raw.hold_seconds),
    exit_policy: textValue(raw.exit_policy),
    exit_reason: textValue(raw.exit_reason),
    strategy_id: textValue(raw.strategy_id) ?? "level-event",
    strategy_version: numeric(raw.strategy_version),
    option_type: textValue(raw.option_type),
    strike: numeric(raw.strike),
  };
}

export async function GET() {
  if (!(await isDashboardAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const supabase = serverSupabase();
    const [signalsResult, ordersResult, tradesResult, outcomesResult] = await Promise.all([
      supabase.from("signals").select("payload,observed_at").order("observed_at", { ascending: false }).limit(50),
      supabase.from("orders").select("id,signal_id,broker_order_id,mode,trading_symbol,side,quantity,status,raw,created_at").eq("mode", "paper").order("created_at", { ascending: false }).limit(1000),
      supabase.from("trades").select("id,order_id,trading_symbol,quantity,fill_price,pnl,raw,executed_at").order("executed_at", { ascending: false }).limit(1000),
      supabase.from("paper_signal_outcomes").select("id,signal_id,order_id,horizon_seconds,observed_at,option_ltp,nifty_ltp,option_return_pct,underlying_move_points").order("observed_at", { ascending: false }).limit(1000),
    ]);
    const error = signalsResult.error ?? ordersResult.error ?? tradesResult.error ?? outcomesResult.error;
    if (error) return Response.json({ error: error.message }, { status: 503 });

    return Response.json({
      recentSignals: signalsResult.data ?? [],
      paperOrders: (ordersResult.data ?? []).map(sanitizeOrder),
      paperTrades: (tradesResult.data ?? []).map(sanitizeTrade),
      paperOutcomes: outcomesResult.data ?? [],
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "trading history failed" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
