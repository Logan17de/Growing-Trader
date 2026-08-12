import type { SignalPayload } from "@/lib/types";

export type WorkerStatus = {
  online?: boolean;
  stale?: boolean;
  state?: string;
  execution_mode?: "paper";
  last_heartbeat?: string;
  groww_authenticated?: boolean;
  market_data_status?: string;
  market_data?: Record<string, unknown> | null;
  last_error?: string | null;
};

export type PaperPosition = {
  trading_symbol?: string;
  quantity?: number;
  entry_price?: number;
  opened_at?: string;
  marks_recorded?: number[];
};

export type PaperEngineStatus = {
  running?: boolean;
  state?: string;
  feed_connected?: boolean;
  started_at?: string;
  updated_at?: string;
  statusUpdatedAt?: string;
  universe_as_of?: string;
  weighting?: string;
  constituents_total?: number;
  constituents_resolved?: number;
  constituents_fresh?: number;
  quote_successes?: number;
  quote_errors?: string[];
  future_symbol?: string;
  future_ltp?: number | null;
  nifty_ltp?: number | null;
  option_expiry?: string;
  option_contract_count?: number;
  last_quote_scan?: string;
  last_option_refresh?: string;
  data_age_seconds?: number;
  last_error?: string | null;
  last_signal?: {
    event?: string;
    direction?: string;
    confidence?: number;
    risk_allowed?: boolean;
    paper_entry?: boolean;
    reason?: string;
  } | null;
  open_paper_position?: PaperPosition | null;
};

export type CommandStatus = {
  id: string;
  command: string;
  status: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
};

export type StrategyLevel = {
  id: string;
  name: string;
  kind: "support" | "resistance";
  price: number;
  source: string;
  enabled: boolean;
};

export type PaperOrder = {
  id: string;
  signal_id: string | null;
  broker_order_id: string | null;
  mode: "paper";
  trading_symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  status: string;
  created_at: string;
  entry_price: number | null;
  entry_nifty: number | null;
  signal_event: string | null;
  signal_direction: string | null;
  confidence: number | null;
  exit_policy: string | null;
};

export type PaperTrade = {
  id: string;
  order_id: string | null;
  trading_symbol: string;
  quantity: number;
  fill_price: number;
  pnl: number | null;
  executed_at: string;
  entry_price: number | null;
  exit_policy: string | null;
};

export type PaperOutcome = {
  id: string;
  signal_id: string;
  order_id: string | null;
  horizon_seconds: number;
  observed_at: string;
  option_ltp: number;
  nifty_ltp: number;
  option_return_pct: number | null;
  underlying_move_points: number | null;
};

export type RecentSignal = {
  payload: SignalPayload;
  observed_at: string;
};

export type ControlStatus = {
  controlPlane: { healthy: boolean; errors: Record<string, string> };
  worker: WorkerStatus;
  paperEngine: PaperEngineStatus;
  latestCommand: CommandStatus | null;
  credentials: { configured: boolean; updatedAt: string | null };
  latestSignal: RecentSignal | null;
  recentSignals: RecentSignal[];
  levels: StrategyLevel[];
  paperOrders: PaperOrder[];
  paperTrades: PaperTrade[];
  paperOutcomes: PaperOutcome[];
};

export type ControlCommand =
  | "TEST_AUTH"
  | "TEST_MARKET_DATA"
  | "START_PAPER_ENGINE"
  | "STOP_PAPER_ENGINE"
  | "STOP";

export type TerminalRoute =
  | "dashboard"
  | "market"
  | "strategies"
  | "positions"
  | "orders"
  | "analytics"
  | "replay"
  | "risk"
  | "activity"
  | "settings";

export type BacktestRequest = {
  instrument: string;
  date: string;
  startTime: string;
  endTime: string;
  strategyId: string;
  strategyVersion: string;
  startingCapital: number;
  confirmations: Array<"volume" | "futures" | "oi" | "options">;
};

export type BacktestResult = {
  tradesGenerated: number;
  winRate: number | null;
  pnl: number | null;
  maximumDrawdown: number | null;
  signalIds: string[];
};
