import { isDashboardAuthorized } from "@/lib/dashboardAuth";
import { serverSupabase } from "@/lib/serverSupabase";

type QueryResult = { data: unknown; error: { message?: string } | null };

function collectError(
  errors: Record<string, string>,
  name: string,
  result: QueryResult,
) {
  if (result.error) errors[name] = result.error.message ?? "unknown Supabase error";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
    entry_price: numeric(raw.entry_price),
    entry_nifty: numeric(raw.entry_nifty),
    signal_event: textValue(raw.signal_event),
    signal_direction: textValue(raw.signal_direction),
    confidence: numeric(raw.confidence),
    exit_policy: textValue(raw.exit_policy),
  };
}

function sanitizeTrade(value: unknown) {
  const row = record(value);
  const raw = record(row.raw);
  return {
    id: row.id,
    order_id: row.order_id ?? null,
    trading_symbol: row.trading_symbol,
    quantity: numeric(row.quantity),
    fill_price: numeric(row.fill_price),
    pnl: numeric(row.pnl),
    executed_at: row.executed_at,
    entry_price: numeric(raw.entry_price),
    exit_policy: textValue(raw.exit_policy),
  };
}

export async function GET() {
  if (!(await isDashboardAuthorized())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = serverSupabase();
    const [
      workerResult,
      commandResult,
      credentialResult,
      signalResult,
      signalsResult,
      levelsResult,
      paperResult,
      ordersResult,
      tradesResult,
      outcomesResult,
    ] = await Promise.all([
      supabase.from("engine_status").select("*").eq("worker_id", "oracle-primary").maybeSingle(),
      supabase.from("engine_commands")
        .select("id,command,status,result,error,created_at,claimed_at,completed_at")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("broker_credentials").select("broker,updated_at").eq("broker", "groww").maybeSingle(),
      supabase.from("signals").select("payload,observed_at")
        .order("observed_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("signals").select("payload,observed_at")
        .order("observed_at", { ascending: false }).limit(24),
      supabase.from("strategy_levels")
        .select("id,name,kind,price,source,enabled,updated_at")
        .order("price", { ascending: true }),
      supabase.from("paper_engine_status")
        .select("payload,updated_at").eq("worker_id", "oracle-primary").maybeSingle(),
      supabase.from("orders")
        .select("id,signal_id,broker_order_id,mode,trading_symbol,side,quantity,status,raw,created_at")
        .eq("mode", "paper").order("created_at", { ascending: false }).limit(500),
      supabase.from("trades")
        .select("id,order_id,trading_symbol,quantity,fill_price,pnl,raw,executed_at")
        .order("executed_at", { ascending: false }).limit(500),
      supabase.from("paper_signal_outcomes")
        .select("id,signal_id,order_id,horizon_seconds,observed_at,option_ltp,nifty_ltp,option_return_pct,underlying_move_points")
        .order("observed_at", { ascending: false }).limit(500),
    ]);

    const backendErrors: Record<string, string> = {};
    collectError(backendErrors, "worker", workerResult);
    collectError(backendErrors, "commands", commandResult);
    collectError(backendErrors, "credentials", credentialResult);
    collectError(backendErrors, "signals", signalResult);
    collectError(backendErrors, "recentSignals", signalsResult);
    collectError(backendErrors, "levels", levelsResult);
    collectError(backendErrors, "paperEngine", paperResult);
    collectError(backendErrors, "orders", ordersResult);
    collectError(backendErrors, "trades", tradesResult);
    collectError(backendErrors, "paperOutcomes", outcomesResult);

    const worker = workerResult.error ? null : workerResult.data;
    const heartbeat = worker?.last_heartbeat ? Date.parse(worker.last_heartbeat) : 0;
    const heartbeatFresh = heartbeat > 0 && Date.now() - heartbeat < 20_000;
    const stopped = worker?.state === "stopped";
    const workerOnline = heartbeatFresh && !stopped;
    const workerStale = heartbeat > 0 && !heartbeatFresh && !stopped;

    return Response.json({
      controlPlane: {
        healthy: Object.keys(backendErrors).length === 0,
        errors: backendErrors,
      },
      worker: worker ? {
        ...worker,
        online: workerOnline,
        stale: workerStale,
      } : { online: false, stale: false, state: "offline" },
      latestCommand: commandResult.error ? null : commandResult.data ?? null,
      credentials: credentialResult.error ? {
        configured: false,
        updatedAt: null,
      } : {
        configured: Boolean(credentialResult.data),
        updatedAt: credentialResult.data?.updated_at ?? null,
      },
      latestSignal: signalResult.error ? null : signalResult.data ?? null,
      recentSignals: signalsResult.error ? [] : signalsResult.data ?? [],
      levels: levelsResult.error ? [] : levelsResult.data ?? [],
      paperOrders: ordersResult.error ? [] : (ordersResult.data ?? []).map(sanitizeOrder),
      paperTrades: tradesResult.error ? [] : (tradesResult.data ?? []).map(sanitizeTrade),
      paperOutcomes: outcomesResult.error ? [] : outcomesResult.data ?? [],
      paperEngine: paperResult.error ? {
        running: false,
        state: "unknown",
      } : {
        ...(paperResult.data?.payload ?? { running: false, state: "stopped" }),
        statusUpdatedAt: paperResult.data?.updated_at ?? null,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "control-plane status failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
