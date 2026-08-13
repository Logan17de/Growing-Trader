import type { SignalPayload } from "@/lib/types";

export type WorkerStatus = {
  online?: boolean; stale?: boolean; state?: string; execution_mode?: "paper";
  last_heartbeat?: string; groww_authenticated?: boolean; market_data_status?: string;
  market_data?: Record<string, unknown> | null; last_error?: string | null;
};

export type PaperPosition = {
  trading_symbol?: string; quantity?: number; original_quantity?: number;
  entry_price?: number; current_price?: number | null; unrealized_pnl?: number | null; best_price?: number;
  entry_direction?: string; entry_level_name?: string | null; entry_level_price?: number | null;
  opened_at?: string; marks_recorded?: number[];
  stop_loss_pct?: number | null; profit_target_pct?: number | null;
  trailing_activation_pct?: number | null; trailing_drawdown_pct?: number | null;
  stop_price?: number | null; target_price?: number | null;
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number; rho?: number; iv?: number } | null;
};

export type PaperEngineStatus = {
  running?: boolean; state?: string; feed_connected?: boolean; started_at?: string; updated_at?: string;
  statusUpdatedAt?: string; universe_as_of?: string; weighting?: string; constituents_total?: number;
  constituents_resolved?: number; constituents_fresh?: number; quote_successes?: number; quote_errors?: string[];
  future_symbol?: string; future_ltp?: number | null; nifty_ltp?: number | null; option_expiry?: string;
  option_contract_count?: number; last_quote_scan?: string; last_option_refresh?: string; data_age_seconds?: number;
  synthetic_vwap?: number | null; whole_nifty_volume_delta?: number; whole_nifty_turnover?: number;
  heavyweight_score?: number; cash_pressure?: number; breadth?: number; participation?: number;
  option_direction_score?: number; option_direction_ready?: boolean; vwap_score?: number; combined_direction_score?: number;
  thresholds_updated_at?: string | null; opening_no_entry_minutes?: number; last_exit_reason?: string | null;
  last_error?: string | null; account_equity?: number; current_exposure?: number; available_capital?: number;
  kill_switch?: boolean; block_new_entries?: boolean; runtime_settings?: Record<string, number>;
  last_signal?: { event?: string; direction?: string; confidence?: number; risk_allowed?: boolean; paper_entry?: boolean; reason?: string } | null;
  open_paper_position?: PaperPosition | null;
};

export type CommandStatus = { id: string; command: string; status: string; result?: Record<string, unknown> | null; error?: string | null; created_at: string; completed_at?: string | null };
export type StrategyLevel = { id: string; name: string; kind: "support" | "resistance"; price: number; source: string; enabled: boolean };

export type PaperOrder = {
  id: string; signal_id: string | null; broker_order_id: string | null; mode: "paper"; trading_symbol: string;
  side: "BUY" | "SELL"; quantity: number; status: string; created_at: string; entry_price: number | null;
  paper_fill_price?: number | null; paper_slippage?: number | null; entry_nifty: number | null;
  signal_event: string | null; signal_direction: string | null; confidence: number | null; exit_policy: string | null;
};

export type PaperTrade = {
  id: string; order_id: string | null; trading_symbol: string; quantity: number; fill_price: number; pnl: number | null;
  executed_at: string; entry_price: number | null; exit_policy: string | null; exit_reason?: string | null; paper_slippage?: number | null;
};

export type PaperOutcome = { id: string; signal_id: string; order_id: string | null; horizon_seconds: number; observed_at: string; option_ltp: number; nifty_ltp: number; option_return_pct: number | null; underlying_move_points: number | null };
export type RecentSignal = { payload: SignalPayload; observed_at: string };

export type ControlStatus = {
  controlPlane: { healthy: boolean; errors: Record<string, string> }; worker: WorkerStatus; paperEngine: PaperEngineStatus;
  latestCommand: CommandStatus | null; credentials: { configured: boolean; updatedAt: string | null };
  latestSignal: RecentSignal | null; recentSignals: RecentSignal[]; levels: StrategyLevel[];
  paperOrders: PaperOrder[]; paperTrades: PaperTrade[]; paperOutcomes: PaperOutcome[];
};

export type TradingDataSnapshot = Pick<ControlStatus, "recentSignals" | "paperOrders" | "paperTrades" | "paperOutcomes">;

export type ControlCommand =
  | "TEST_AUTH" | "TEST_MARKET_DATA" | "START_PAPER_ENGINE" | "STOP_PAPER_ENGINE" | "STOP"
  | "EXIT_PAPER_POSITION" | "UPDATE_PAPER_POSITION" | "KILL_SWITCH" | "RESET_KILL_SWITCH" | "RUN_REPLAY";

export type TerminalRoute = "dashboard" | "market" | "strategies" | "positions" | "orders" | "analytics" | "replay" | "risk" | "activity" | "settings";

export type BacktestRequest = {
  instrument: string; date: string; startTime: string; endTime: string; strategyId: string; strategyVersion: string;
  startingCapital: number; confirmations: Array<"volume" | "futures" | "oi" | "options">;
};

export type BacktestResult = {
  frames?: number; breakouts?: number; reversals?: number; uncertain?: number; noLevel?: number; riskApproved?: number;
  tradesGenerated?: number; winRate?: number | null; pnl?: number | null; maximumDrawdown?: number | null; signalIds?: string[];
  message?: string;
};
