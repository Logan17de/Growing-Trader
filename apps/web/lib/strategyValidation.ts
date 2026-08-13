export type StrategyParameterRow = {
  key: string;
  category: string;
  value: number;
  unit: string;
  description: string;
  updated_at?: string;
};

const WEIGHT_GROUPS = [
  ["cash_pressure_weight", "breadth_weight", "heavyweight_weight"],
  ["futures_price_weight", "futures_oi_weight", "futures_basis_weight"],
  ["option_direction_volume_weight", "option_direction_oi_weight", "option_direction_iv_weight"],
  ["combined_cash_weight", "combined_futures_weight", "combined_options_weight", "combined_vwap_weight"],
  ["level_direction_weight", "level_distance_weight", "level_persistence_weight", "level_participation_weight", "level_acceleration_weight"],
  ["option_volume_liquidity_weight", "option_oi_liquidity_weight"],
  ["option_delta_weight", "option_liquidity_weight", "option_theta_weight", "option_iv_weight", "option_gamma_weight"],
] as const;

const UNIT_INTERVAL = new Set([
  "participation_floor", "breakout_threshold", "reversal_threshold", "decision_margin",
  "target_abs_delta", "min_abs_delta", "max_abs_delta", "max_spread_pct",
  "exit_profit_target_pct", "exit_stop_loss_pct", "exit_trailing_activation_pct",
  "exit_trailing_drawdown_pct", "exit_signal_flip_threshold", "risk_per_trade_pct",
  "daily_loss_limit_pct", "daily_profit_lock_pct", "min_signal_confidence", "entry_cutoff_enabled",
]);

const NON_NEGATIVE = new Set([
  "opening_no_entry_minutes", "entry_cutoff_minutes_before_close", "exit_min_hold_seconds",
  "cooldown_seconds", "max_data_age_seconds", "max_quantity", "max_premium_per_trade",
]);

const POSITIVE = new Set([
  "direction_scale_bps", "rvol_cap", "min_constituents", "futures_direction_scale_bps",
  "futures_oi_scale_pct", "futures_basis_scale_bps", "option_iv_skew_scale_pct",
  "option_near_atm_strikes", "vwap_direction_scale_bps", "level_watch_distance_bps",
  "level_touch_tolerance_bps", "breakout_penetration_bps", "rejection_depth_bps",
  "persistence_target_seconds", "level_touch_memory_seconds", "exit_level_failure_bps",
  "exit_max_hold_seconds", "max_trades_per_day", "max_consecutive_losses",
]);

export function validateStrategyValues(values: Record<string, number>) {
  for (const [key, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) throw new Error(`${key} must be finite`);
    if (UNIT_INTERVAL.has(key) && (value < 0 || value > 1)) throw new Error(`${key} must be between 0 and 1`);
    if (key === "entry_cutoff_enabled" && value !== 0 && value !== 1) throw new Error("entry_cutoff_enabled must be 0 or 1");
    if (NON_NEGATIVE.has(key) && value < 0) throw new Error(`${key} cannot be negative`);
    if (POSITIVE.has(key) && value <= 0) throw new Error(`${key} must be positive`);
    if (key.endsWith("_weight") && value < 0) throw new Error(`${key} cannot be negative`);
  }
  if ((values.rvol_cap ?? 2) <= 1) throw new Error("rvol_cap must be greater than 1");
  if ((values.entry_cutoff_minutes_before_close ?? 0) >= 375) throw new Error("entry cutoff must leave some market session time available");
  if ((values.min_abs_delta ?? 0) > (values.target_abs_delta ?? 0)) throw new Error("target delta must be above minimum delta");
  if ((values.target_abs_delta ?? 0) > (values.max_abs_delta ?? 1)) throw new Error("target delta must be below maximum delta");
  if ((values.exit_min_hold_seconds ?? 0) >= (values.exit_max_hold_seconds ?? Number.MAX_SAFE_INTEGER)) throw new Error("minimum hold must be below maximum hold");
  for (const group of WEIGHT_GROUPS) {
    if (!group.every((key) => key in values)) continue;
    const total = group.reduce((sum, key) => sum + values[key], 0);
    if (Math.abs(total - 1) > 1e-8) throw new Error(`${group.join(" + ")} must sum to 1.0`);
  }
}
