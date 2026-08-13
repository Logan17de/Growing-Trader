import type { PaperPosition } from "@/lib/terminalTypes";

export type StrategyParameter = {
  key: string;
  category: string;
  value: number;
  unit: string;
  description: string;
  updated_at: string;
};

export type NiftyVolumePoint = {
  observed_at: string;
  nifty_ltp: number;
  synthetic_vwap: number | null;
  constituent_volume_delta: number;
  constituent_turnover: number;
  cash_pressure: number;
  breadth: number;
  participation: number;
  heavyweight_score: number;
  futures_score: number;
  option_score: number;
  vwap_score: number;
  combined_score: number;
};

export type MarketWatchObservation = {
  observed_at: string;
  session_date: string;
  nifty_ltp: number | null;
  constituent_volume_delta: number | null;
  constituent_turnover: number | null;
  cash_pressure: number | null;
  breadth: number | null;
  participation: number | null;
  heavyweight_score: number | null;
  futures_move_bps: number | null;
  futures_volume_delta: number | null;
  futures_oi_change_pct: number | null;
  futures_basis_points: number | null;
  futures_score: number | null;
  option_score: number | null;
  option_volume_imbalance: number | null;
  option_oi_change_imbalance: number | null;
  option_iv_skew: number | null;
  vwap_distance_bps: number | null;
  combined_direction_score: number | null;
  event: string;
  direction: string;
  confidence: number;
  nifty_move_1m_bps: number | null;
  nifty_move_3m_bps: number | null;
  nifty_move_5m_bps: number | null;
  nifty_move_10m_bps: number | null;
  nifty_move_15m_bps: number | null;
  max_up_15m_bps: number | null;
  max_down_15m_bps: number | null;
  big_move_1m: boolean;
  big_move_5m: boolean;
  big_move_15m: boolean;
};

export type ResearchPaperEngineStatus = {
  running?: boolean;
  state?: string;
  mode?: "paper" | "live";
  live_armed?: boolean;
  feed_connected?: boolean;
  weighting?: string;
  nifty_ltp?: number | null;
  synthetic_vwap?: number | null;
  whole_nifty_volume_delta?: number;
  whole_nifty_turnover?: number;
  heavyweight_score?: number;
  cash_pressure?: number;
  breadth?: number;
  participation?: number;
  future_ltp?: number | null;
  option_direction_score?: number;
  option_direction_ready?: boolean;
  vwap_score?: number;
  combined_direction_score?: number;
  thresholds_updated_at?: string | null;
  opening_no_entry_minutes?: number;
  last_exit_reason?: string | null;
  data_age_seconds?: number;
  kill_switch?: boolean;
  block_new_entries?: boolean;
  open_position?: PaperPosition | null;
  open_paper_position?: PaperPosition | null;
};

export type ResearchStatusPayload = {
  strategyParameters: StrategyParameter[];
  niftyVolumeSeries: NiftyVolumePoint[];
  marketWatch: MarketWatchObservation[];
  bigMoves: MarketWatchObservation[];
  paperEngine: ResearchPaperEngineStatus;
};
