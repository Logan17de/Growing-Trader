begin;

create table if not exists public.strategy_parameters (
  key text primary key,
  category text not null,
  value double precision not null,
  unit text not null default '',
  description text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.nifty_constituent_config (
  symbol text primary key,
  index_weight double precision check (index_weight is null or index_weight > 0),
  is_heavyweight boolean not null default false,
  source text not null default 'bootstrap',
  as_of date,
  updated_at timestamptz not null default now()
);

create table if not exists public.nifty_volume_series (
  id bigint generated always as identity primary key,
  observed_at timestamptz not null,
  nifty_ltp double precision not null check (nifty_ltp > 0),
  synthetic_vwap double precision,
  constituent_volume_delta bigint not null check (constituent_volume_delta >= 0),
  constituent_turnover double precision not null check (constituent_turnover >= 0),
  cash_pressure double precision not null,
  breadth double precision not null,
  participation double precision not null,
  heavyweight_score double precision not null,
  futures_score double precision not null,
  option_score double precision not null,
  vwap_score double precision not null,
  combined_score double precision not null,
  created_at timestamptz not null default now()
);

create index if not exists nifty_volume_series_observed_at_idx
  on public.nifty_volume_series (observed_at desc);

insert into public.strategy_parameters (key, category, value, unit, description) values
('direction_scale_bps','cash',8,'bps','Constituent price move scale'),
('rvol_cap','cash',4,'x','Relative-volume cap'),
('cash_pressure_weight','cash',0.65,'weight','Cash pressure contribution'),
('breadth_weight','cash',0.20,'weight','Breadth contribution'),
('heavyweight_weight','cash',0.15,'weight','Explicit heavyweight contribution'),
('participation_floor','cash',0.55,'ratio','Minimum participation multiplier'),
('min_constituents','data_quality',45,'count','Minimum fresh NIFTY constituents'),
('futures_price_weight','futures',0.45,'weight','Futures price/activity contribution'),
('futures_oi_weight','futures',0.30,'weight','Futures OI confirmation contribution'),
('futures_basis_weight','futures',0.25,'weight','Futures basis contribution'),
('futures_direction_scale_bps','futures',8,'bps','Futures direction scale'),
('futures_oi_scale_pct','futures',0.35,'pct','Futures OI-change scale'),
('futures_basis_scale_bps','futures',4,'bps','Basis-change scale'),
('option_direction_volume_weight','option_direction',0.45,'weight','Near-ATM option volume imbalance contribution'),
('option_direction_oi_weight','option_direction',0.40,'weight','Near-ATM OI-change imbalance contribution'),
('option_direction_iv_weight','option_direction',0.15,'weight','Near-ATM IV skew contribution'),
('option_iv_skew_scale_pct','option_direction',2,'iv_points','IV skew squash scale'),
('option_near_atm_strikes','option_direction',5,'count','Nearest strikes used for option activity'),
('vwap_direction_scale_bps','vwap',8,'bps','Synthetic NIFTY VWAP distance scale'),
('combined_cash_weight','direction',0.50,'weight','Cash score contribution'),
('combined_futures_weight','direction',0.30,'weight','Futures score contribution'),
('combined_options_weight','direction',0.10,'weight','Option activity contribution'),
('combined_vwap_weight','direction',0.10,'weight','Synthetic VWAP contribution'),
('level_watch_distance_bps','levels',35,'bps','Distance at which a level becomes watchable'),
('level_touch_tolerance_bps','levels',8,'bps','Level touch tolerance'),
('breakout_penetration_bps','levels',12,'bps','Penetration required to saturate breakout distance'),
('rejection_depth_bps','levels',10,'bps','Rejection depth scale'),
('persistence_target_seconds','levels',30,'seconds','Breakout persistence target'),
('breakout_threshold','levels',0.68,'score','Minimum breakout score'),
('reversal_threshold','levels',0.68,'score','Minimum reversal score'),
('decision_margin','levels',0.08,'score','Winner margin over competing level state'),
('level_touch_memory_seconds','levels',180,'seconds','How long a recent touch remains relevant'),
('level_direction_weight','level_formula',0.40,'weight','Directional alignment contribution'),
('level_distance_weight','level_formula',0.20,'weight','Penetration/rejection contribution'),
('level_persistence_weight','level_formula',0.15,'weight','Persistence contribution'),
('level_participation_weight','level_formula',0.15,'weight','Participation contribution'),
('level_acceleration_weight','level_formula',0.10,'weight','Pressure/volume acceleration contribution'),
('target_abs_delta','option_selection',0.58,'delta','Target absolute option delta'),
('min_abs_delta','option_selection',0.48,'delta','Minimum absolute option delta'),
('max_abs_delta','option_selection',0.68,'delta','Maximum absolute option delta'),
('option_delta_weight','option_selection',0.35,'weight','Delta-fit contribution'),
('option_liquidity_weight','option_selection',0.30,'weight','Liquidity contribution'),
('option_volume_liquidity_weight','option_selection',0.55,'weight','Volume share of liquidity score'),
('option_oi_liquidity_weight','option_selection',0.45,'weight','OI share of liquidity score'),
('option_theta_weight','option_selection',0.15,'weight','Low-theta-cost contribution'),
('option_iv_weight','option_selection',0.10,'weight','Relative-IV contribution'),
('option_gamma_weight','option_selection',0.10,'weight','Gamma contribution'),
('max_spread_pct','option_selection',0.02,'ratio','Maximum bid/ask spread ratio when available'),
('opening_no_entry_minutes','entry',10,'minutes','No-entry warm-up after 09:15 IST'),
('exit_min_hold_seconds','exit',60,'seconds','Minimum hold before non-emergency signal exits'),
('exit_profit_target_pct','exit',0.15,'ratio','Option premium profit target'),
('exit_stop_loss_pct','exit',0.08,'ratio','Option premium stop loss'),
('exit_trailing_activation_pct','exit',0.10,'ratio','Return needed to arm trailing exit'),
('exit_trailing_drawdown_pct','exit',0.05,'ratio','Drawdown from best premium after trailing is armed'),
('exit_signal_flip_threshold','exit',0.20,'score','Opposite combined-score threshold for pressure-flip exit'),
('exit_level_failure_bps','exit',8,'bps','Adverse move through entry level that invalidates structure'),
('exit_max_hold_seconds','exit',900,'seconds','Maximum scalp holding time'),
('risk_per_trade_pct','risk',0.005,'ratio','Maximum premium budget per trade'),
('daily_loss_limit_pct','risk',0.02,'ratio','Daily realized-loss circuit breaker'),
('max_trades_per_day','risk',6,'count','Maximum paper entries per day'),
('max_consecutive_losses','risk',3,'count','Consecutive-loss circuit breaker'),
('cooldown_seconds','risk',180,'seconds','Cooldown after an entry'),
('min_signal_confidence','risk',0.68,'score','Minimum actionable signal confidence'),
('max_data_age_seconds','data_quality',30,'seconds','Maximum market-data age')
on conflict (key) do nothing;

insert into public.nifty_constituent_config (symbol, is_heavyweight, source, as_of) values
('ADANIENT',false,'bootstrap','2026-07-08'),('ADANIPORTS',false,'bootstrap','2026-07-08'),
('APOLLOHOSP',false,'bootstrap','2026-07-08'),('ASIANPAINT',false,'bootstrap','2026-07-08'),
('AXISBANK',true,'NIFTY top-10 snapshot','2026-04-30'),('BAJAJ-AUTO',false,'bootstrap','2026-07-08'),
('BAJAJFINSV',false,'bootstrap','2026-07-08'),('BAJFINANCE',false,'bootstrap','2026-07-08'),
('BEL',false,'bootstrap','2026-07-08'),('BHARTIARTL',true,'NIFTY top-10 snapshot','2026-04-30'),
('CIPLA',false,'bootstrap','2026-07-08'),('COALINDIA',false,'bootstrap','2026-07-08'),
('DRREDDY',false,'bootstrap','2026-07-08'),('EICHERMOT',false,'bootstrap','2026-07-08'),
('ETERNAL',false,'bootstrap','2026-07-08'),('GRASIM',false,'bootstrap','2026-07-08'),
('HCLTECH',false,'bootstrap','2026-07-08'),('HDFCBANK',true,'NIFTY top-10 snapshot','2026-04-30'),
('HDFCLIFE',false,'bootstrap','2026-07-08'),('HINDALCO',false,'bootstrap','2026-07-08'),
('HINDUNILVR',false,'bootstrap','2026-07-08'),('ICICIBANK',true,'NIFTY top-10 snapshot','2026-04-30'),
('INDIGO',false,'bootstrap','2026-07-08'),('INFY',true,'NIFTY top-10 snapshot','2026-04-30'),
('ITC',true,'NIFTY top-10 snapshot','2026-04-30'),('JIOFIN',false,'bootstrap','2026-07-08'),
('JSWSTEEL',false,'bootstrap','2026-07-08'),('KOTAKBANK',true,'NIFTY top-10 snapshot','2026-04-30'),
('LT',true,'NIFTY top-10 snapshot','2026-04-30'),('M&M',false,'bootstrap','2026-07-08'),
('MARUTI',false,'bootstrap','2026-07-08'),('MAXHEALTH',false,'bootstrap','2026-07-08'),
('NESTLEIND',false,'bootstrap','2026-07-08'),('NTPC',false,'bootstrap','2026-07-08'),
('ONGC',false,'bootstrap','2026-07-08'),('POWERGRID',false,'bootstrap','2026-07-08'),
('RELIANCE',true,'NIFTY top-10 snapshot','2026-04-30'),('SBILIFE',false,'bootstrap','2026-07-08'),
('SBIN',true,'NIFTY top-10 snapshot','2026-04-30'),('SHRIRAMFIN',false,'bootstrap','2026-07-08'),
('SUNPHARMA',false,'bootstrap','2026-07-08'),('TATACONSUM',false,'bootstrap','2026-07-08'),
('TATASTEEL',false,'bootstrap','2026-07-08'),('TCS',false,'bootstrap','2026-07-08'),
('TECHM',false,'bootstrap','2026-07-08'),('TITAN',false,'bootstrap','2026-07-08'),
('TMPV',false,'bootstrap','2026-07-08'),('TRENT',false,'bootstrap','2026-07-08'),
('ULTRACEMCO',false,'bootstrap','2026-07-08'),('WIPRO',false,'bootstrap','2026-07-08')
on conflict (symbol) do nothing;

alter table public.strategy_parameters enable row level security;
alter table public.nifty_constituent_config enable row level security;
alter table public.nifty_volume_series enable row level security;

revoke all on table public.strategy_parameters from anon, authenticated;
revoke all on table public.nifty_constituent_config from anon, authenticated;
revoke all on table public.nifty_volume_series from anon, authenticated;

commit;
