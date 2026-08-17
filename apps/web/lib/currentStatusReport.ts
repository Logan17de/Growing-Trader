import { serverSupabase } from "@/lib/serverSupabase";

export type ReportMode = "paper" | "live";

type TradeRow = {
  id: string;
  order_id: string | null;
  trading_symbol: string;
  quantity: number;
  fill_price: number;
  pnl: number | null;
  raw: Record<string, unknown> | null;
  executed_at: string;
};

type OrderRow = {
  id: string;
  mode: ReportMode;
  raw: Record<string, unknown> | null;
};

export type StrategyReportRow = {
  strategy: "S/R Breakout" | "S/R Reversal" | "Other / Unattributed";
  trades: number;
  wins: number;
  winRate: number | null;
  pnl: number;
};

export type ReportSeriesPoint = { time: string; value: number };

export type CurrentStatusReport = {
  generatedAt: string;
  sessionDate: string;
  mode: ReportMode;
  modeArmed: boolean;
  summary: {
    dailyPnl: number;
    monthlyPnl: number;
    trades: number;
    wins: number;
    losses: number;
    winRate: number | null;
    bestTrade: number | null;
    averageWin: number | null;
    averageLoss: number | null;
    profitFactor: number | null;
    maxDrawdown: number;
    expectancy: number | null;
    startingBalance: number | null;
    endingBalance: number | null;
  };
  strategies: StrategyReportRow[];
  pnlSeries: ReportSeriesPoint[];
  equitySeries: ReportSeriesPoint[];
  niftySeries: ReportSeriesPoint[];
  market: {
    nifty: number | null;
    minuteVolume: number;
    sessionVolume: number;
    turnover: number;
    breadth: number | null;
    participation: number | null;
    cashPressure: number | null;
    heavyweightScore: number | null;
    syntheticVwap: number | null;
    futuresScore: number | null;
    optionScore: number | null;
    combinedScore: number | null;
  };
  marketWatch: Record<string, unknown> | null;
  safety: {
    brokerFlat: boolean | null;
    unresolvedLiveOrders: number;
    liveArmed: boolean;
    killSwitch: boolean;
    workerState: string | null;
    engineState: string | null;
    openPosition: Record<string, unknown> | null;
  };
};

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function istDateString(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function startOfDayUtc(date: string) {
  return new Date(`${date}T00:00:00+05:30`).toISOString();
}

function nextDayUtc(date: string) {
  const current = new Date(`${date}T00:00:00+05:30`);
  current.setUTCDate(current.getUTCDate() + 1);
  return current.toISOString();
}

function monthStartUtc(date: string) {
  const [year, month] = date.split("-");
  return new Date(`${year}-${month}-01T00:00:00+05:30`).toISOString();
}

function tradeMode(trade: TradeRow, order: OrderRow | undefined): ReportMode {
  const rawMode = String(record(trade.raw).mode ?? "").toLowerCase();
  if (rawMode === "live" || rawMode === "paper") return rawMode;
  return order?.mode === "live" ? "live" : "paper";
}

function strategyName(order: OrderRow | undefined): StrategyReportRow["strategy"] {
  const event = String(record(order?.raw).signal_event ?? "").toLowerCase();
  if (event === "breakout") return "S/R Breakout";
  if (event === "reversal") return "S/R Reversal";
  return "Other / Unattributed";
}

function metrics(rows: Array<{ pnl: number; executed_at: string }>) {
  const pnl = rows.map((row) => row.pnl);
  const wins = pnl.filter((value) => value > 0);
  const losses = pnl.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = losses.reduce((sum, value) => sum + value, 0);
  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of pnl) {
    running += value;
    peak = Math.max(peak, running);
    maxDrawdown = Math.min(maxDrawdown, running - peak);
  }
  return {
    pnl: pnl.reduce((sum, value) => sum + value, 0),
    trades: pnl.length,
    wins: wins.length,
    losses: losses.length,
    winRate: pnl.length ? wins.length / pnl.length : null,
    bestTrade: pnl.length ? Math.max(...pnl) : null,
    averageWin: wins.length ? grossProfit / wins.length : null,
    averageLoss: losses.length ? grossLoss / losses.length : null,
    profitFactor: grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? null : null,
    maxDrawdown,
    expectancy: pnl.length ? running / pnl.length : null,
  };
}

export async function buildCurrentStatusReport(): Promise<CurrentStatusReport> {
  const supabase = serverSupabase();
  const generatedAt = new Date();
  const sessionDate = istDateString(generatedAt);
  const dayStart = startOfDayUtc(sessionDate);
  const dayEnd = nextDayUtc(sessionDate);
  const monthStart = monthStartUtc(sessionDate);

  const [executionResult, tradeResult, orderResult, minuteResult, watchResult, riskResult, workerResult, engineResult, auditResult, equityResult] = await Promise.all([
    supabase.from("execution_control_state").select("mode,live_armed").eq("id", true).maybeSingle(),
    supabase.from("trades").select("id,order_id,trading_symbol,quantity,fill_price,pnl,raw,executed_at").gte("executed_at", monthStart).lt("executed_at", dayEnd).order("executed_at"),
    supabase.from("orders").select("id,mode,raw").gte("created_at", monthStart).lt("created_at", dayEnd).limit(1000),
    supabase.from("nifty_volume_minute").select("observed_at,nifty_ltp,synthetic_vwap,constituent_volume_delta,constituent_turnover,cash_pressure,breadth,participation,heavyweight_score,futures_score,option_score,combined_score").gte("observed_at", dayStart).lt("observed_at", dayEnd).order("observed_at"),
    supabase.from("market_watch_labeled").select("*").eq("session_date", sessionDate).order("observed_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("risk_control_state").select("kill_switch").eq("id", true).maybeSingle(),
    supabase.from("engine_status").select("state").eq("worker_id", "oracle-primary").maybeSingle(),
    supabase.from("paper_engine_status").select("payload").eq("worker_id", "oracle-primary").maybeSingle(),
    supabase.from("engine_commands").select("result").eq("command", "CHECK_LIVE_POSITIONS").eq("status", "completed").gte("created_at", dayStart).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", "paper_account_equity").maybeSingle(),
  ]);

  const firstError = [executionResult, tradeResult, orderResult, minuteResult, riskResult, workerResult, engineResult, auditResult, equityResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const execution = record(executionResult.data);
  const mode: ReportMode = execution.mode === "live" ? "live" : "paper";
  const orders = (orderResult.data ?? []) as OrderRow[];
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const allTrades = ((tradeResult.data ?? []) as TradeRow[]).flatMap((trade) => {
    const pnl = numberValue(trade.pnl);
    if (pnl === null) return [];
    const order = trade.order_id ? orderById.get(trade.order_id) : undefined;
    return [{ ...trade, pnl, mode: tradeMode(trade, order), strategy: strategyName(order) }];
  });
  const monthTrades = allTrades.filter((trade) => trade.mode === mode);
  const dayTrades = monthTrades.filter((trade) => trade.executed_at >= dayStart && trade.executed_at < dayEnd);
  const dailyMetrics = metrics(dayTrades);
  const monthlyMetrics = metrics(monthTrades);

  const strategyGroups = new Map<StrategyReportRow["strategy"], typeof dayTrades>();
  for (const trade of dayTrades) {
    const group = strategyGroups.get(trade.strategy) ?? [];
    group.push(trade);
    strategyGroups.set(trade.strategy, group);
  }
  const strategies = (["S/R Breakout", "S/R Reversal", "Other / Unattributed"] as const).map((strategy) => {
    const rows = strategyGroups.get(strategy) ?? [];
    const result = metrics(rows);
    return { strategy, trades: result.trades, wins: result.wins, winRate: result.winRate, pnl: result.pnl };
  });

  let cumulative = 0;
  const pnlSeries = dayTrades.map((trade) => ({ time: trade.executed_at, value: cumulative += trade.pnl }));
  const paperEquity = numberValue(record(equityResult.data).value);
  const startingBalance = mode === "paper" ? paperEquity : null;
  const endingBalance = startingBalance === null ? null : startingBalance + dailyMetrics.pnl;
  const equitySeries = pnlSeries.map((point) => ({ time: point.time, value: (startingBalance ?? 0) + point.value }));

  const minuteRows = (minuteResult.data ?? []).map((value) => record(value));
  const latestMinute = minuteRows.at(-1) ?? {};
  const niftySeries = minuteRows.flatMap((row) => {
    const value = numberValue(row.nifty_ltp);
    return value === null ? [] : [{ time: String(row.observed_at), value }];
  });
  const sessionVolume = minuteRows.reduce((sum, row) => sum + (numberValue(row.constituent_volume_delta) ?? 0), 0);
  const turnover = minuteRows.reduce((sum, row) => sum + (numberValue(row.constituent_turnover) ?? 0), 0);
  const engine = record(record(engineResult.data).payload);
  const audit = record(record(auditResult.data).result);
  const brokerFlat = typeof audit.flat === "boolean" ? audit.flat : null;
  const unresolved = await supabase.from("orders").select("id", { count: "exact", head: true }).eq("mode", "live").in("status", ["OPEN", "SUBMITTING"]);
  if (unresolved.error) throw new Error(unresolved.error.message);

  return {
    generatedAt: generatedAt.toISOString(),
    sessionDate,
    mode,
    modeArmed: Boolean(execution.live_armed),
    summary: {
      dailyPnl: dailyMetrics.pnl,
      monthlyPnl: monthlyMetrics.pnl,
      trades: dailyMetrics.trades,
      wins: dailyMetrics.wins,
      losses: dailyMetrics.losses,
      winRate: dailyMetrics.winRate,
      bestTrade: dailyMetrics.bestTrade,
      averageWin: dailyMetrics.averageWin,
      averageLoss: dailyMetrics.averageLoss,
      profitFactor: dailyMetrics.profitFactor,
      maxDrawdown: dailyMetrics.maxDrawdown,
      expectancy: dailyMetrics.expectancy,
      startingBalance,
      endingBalance,
    },
    strategies,
    pnlSeries,
    equitySeries,
    niftySeries,
    market: {
      nifty: numberValue(latestMinute.nifty_ltp) ?? numberValue(engine.nifty_ltp),
      minuteVolume: numberValue(latestMinute.constituent_volume_delta) ?? 0,
      sessionVolume,
      turnover,
      breadth: numberValue(latestMinute.breadth) ?? numberValue(engine.breadth),
      participation: numberValue(latestMinute.participation) ?? numberValue(engine.participation),
      cashPressure: numberValue(latestMinute.cash_pressure) ?? numberValue(engine.cash_pressure),
      heavyweightScore: numberValue(latestMinute.heavyweight_score) ?? numberValue(engine.heavyweight_score),
      syntheticVwap: numberValue(latestMinute.synthetic_vwap) ?? numberValue(engine.synthetic_vwap),
      futuresScore: numberValue(latestMinute.futures_score),
      optionScore: numberValue(latestMinute.option_score) ?? numberValue(engine.option_direction_score),
      combinedScore: numberValue(latestMinute.combined_score) ?? numberValue(engine.combined_direction_score),
    },
    marketWatch: watchResult.error ? null : record(watchResult.data),
    safety: {
      brokerFlat,
      unresolvedLiveOrders: unresolved.count ?? 0,
      liveArmed: Boolean(execution.live_armed),
      killSwitch: Boolean(record(riskResult.data).kill_switch),
      workerState: String(record(workerResult.data).state ?? "") || null,
      engineState: String(engine.state ?? "") || null,
      openPosition: record(engine.open_position ?? engine.open_paper_position),
    },
  };
}
