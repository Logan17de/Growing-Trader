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
  best_price?: number;
  entry_direction?: string;
  entry_level_name?: string | null;
  entry_level_price?: number | null;
  opened_at?: string;
  marks_recorded?: number[];
};

export type OptionGreeksView = {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
  iv?: number;
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
  latest_snapshot_at?: string;
  data_age_seconds?: number;
  synthetic_vwap?: number | null;
  whole_nifty_volume_delta?: number;
  whole_nifty_turnover?: number;
  heavyweight_score?: number;
  cash_pressure?: number;
  breadth?: number;
  participation?: number;
  option_direction_score?: number;
  option_direction_ready?: boolean;
  vwap_score?: number;
  combined_direction_score?: number;
  thresholds_updated_at?: string | null;
  opening_no_entry_minutes?: number;
  last_exit_reason?: string | null;
  last_error?: string | null;
  strategy_enabled?: boolean;
  strategy_version?: number;
  kill_switch_enabled?: boolean;
  kill_switch_reason?: string | null;
  account_equity?: number;
  available_capital?: number;
  current_option_ltp?: number | null;
  unrealized_pnl?: number | null;
  stop_price?: number | null;
  stop_source?: "manual" | "strategy" | string;
  target_price?: number | null;
  trailing_enabled?: boolean;
  trailing_activation_pct?: number;
  trailing_drawdown_pct?: number;
  current_greeks?: OptionGreeksView | null;
  paper_slippage_bps?: number;
  paper_fee_rate_pct?: number;
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
  payload?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  created_at: string;
  claimed_at?: string | null;
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
  requested_price?: number | null;
  average_fill?: number | null;
  entry_nifty: number | null;
  signal_event: string | null;
  signal_direction: string | null;
  confidence: number | null;
  exit_policy: string | null;
  exit_reason?: string | null;
  exit_price?: number | null;
  closed_at?: string | null;
  strategy_id?: string | null;
  strategy_version?: number | null;
  option_type?: string | null;
  strike?: number | null;
  lot_size?: number | null;
  slippage_bps?: number | null;
  fee_rate_pct?: number | null;
  manual_stop_price?: number | null;
  trailing_enabled?: boolean | null;
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
  requested_exit_price?: number | null;
  slippage_points?: number | null;
  fees?: number | null;
  hold_seconds?: number | null;
  exit_policy: string | null;
  exit_reason?: string | null;
  strategy_id?: string | null;
  strategy_version?: number | null;
  option_type?: string | null;
  strike?: number | null;
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

export type StrategyState = {
  strategy_id: string;
  name: string;
  enabled: boolean;
  version: number;
  active_preset_id: string | null;
  updated_at: string;
};

export type RiskControl = {
  worker_id: string;
  kill_switch_enabled: boolean;
  reason: string | null;
  updated_at: string;
};

export type TerminalPreferences = {
  preference_id: string;
  refresh_interval_ms: number;
  timezone: string;
  number_locale: string;
  alert_preferences: Record<string, boolean>;
  updated_at: string;
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
  strategyState?: StrategyState | null;
  riskControl?: RiskControl | null;
  engineSettings?: Record<string, number>;
  terminalPreferences?: TerminalPreferences | null;
};

export type TradingDataSnapshot = Pick<ControlStatus, "recentSignals" | "paperOrders" | "paperTrades" | "paperOutcomes">;

export type ControlCommand =
  | "TEST_AUTH"
  | "TEST_MARKET_DATA"
  | "START_PAPER_ENGINE"
  | "STOP_PAPER_ENGINE"
  | "EXIT_PAPER_POSITION"
  | "PARTIAL_EXIT_PAPER_POSITION"
  | "SET_PAPER_STOP"
  | "SET_PAPER_TRAILING"
  | "KILL_SWITCH"
  | "RUN_REPLAY"
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
  frames?: number;
  tradesGenerated: number;
  winRate: number | null;
  pnl: number | null;
  maximumDrawdown: number | null;
  signalIds: string[];
  eventCounts?: Record<string, number>;
  message?: string;
};

export type StrategyParameter = {
  key: string;
  category: string;
  value: number;
  unit: string;
  description: string;
  updated_at?: string;
};

export type EngineSetting = StrategyParameter;

export type StrategyPreset = {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, number>;
  created_at: string;
  updated_at: string;
};

export type TerminalConfig = {
  strategyParameters: StrategyParameter[];
  engineSettings: EngineSetting[];
  strategyState: StrategyState | null;
  strategyPresets: StrategyPreset[];
  riskControl: RiskControl | null;
  terminalPreferences: TerminalPreferences | null;
};

export type RuntimeEvent = {
  id: string;
  observed_at: string;
  severity: "info" | "success" | "warning" | "critical";
  component: string;
  event_type: string;
  message: string;
  detail: string;
  instrument?: string | null;
  metadata?: Record<string, unknown>;
};

export type MarketConstituent = {
  symbol: string;
  price: number | null;
  previousPrice: number | null;
  movePct: number | null;
  volumeDelta: number | null;
  indexWeight: number;
  weightedContribution: number | null;
  isHeavyweight: boolean;
  sector: string;
};

export type MarketOption = {
  tradingSymbol: string;
  optionType: string;
  strike: number | null;
  expiry: string;
  ltp: number | null;
  openInterest: number | null;
  volume: number | null;
  lotSize: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  iv: number | null;
};

export type MarketDetail = {
  observedAt: string | null;
  spot: number | null;
  syntheticVwap?: number | null;
  future: { symbol: string; price: number | null; previousPrice: number | null; volume: number | null; previousVolume: number | null; openInterest: number | null; previousOpenInterest: number | null } | null;
  constituents: MarketConstituent[];
  options: MarketOption[];
  optionSummary: { putCallOiRatio: number | null; putCallVolumeRatio: number | null; callOi: number; putOi: number; callVolume: number; putVolume: number; averageIv: number | null; contracts: number } | null;
};
