begin;

alter table public.engine_commands
  drop constraint if exists engine_commands_command_check;

alter table public.engine_commands
  add constraint engine_commands_command_check
  check (command in (
    'TEST_AUTH',
    'TEST_MARKET_DATA',
    'START_PAPER_ENGINE',
    'STOP_PAPER_ENGINE',
    'EXIT_PAPER_POSITION',
    'PARTIAL_EXIT_PAPER_POSITION',
    'SET_PAPER_STOP',
    'SET_PAPER_TRAILING',
    'KILL_SWITCH',
    'RUN_REPLAY',
    'STOP'
  ));

create table if not exists public.engine_settings (
  key text primary key,
  category text not null,
  value double precision not null,
  unit text not null default '',
  description text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.engine_settings (key, category, value, unit, description) values
  ('account_equity', 'capital', 2000000, 'INR', 'Paper account equity used for risk sizing'),
  ('quote_scan_seconds', 'market_data', 20, 'seconds', 'Delay after a completed 50-stock quote scan'),
  ('option_refresh_seconds', 'market_data', 20, 'seconds', 'NIFTY option-chain refresh interval'),
  ('feed_poll_seconds', 'market_data', 1, 'seconds', 'Runtime loop/feed polling interval'),
  ('signal_persist_seconds', 'research', 30, 'seconds', 'Maximum interval between non-actionable persisted signals'),
  ('paper_slippage_bps', 'paper_execution', 0, 'bps', 'Paper fill slippage applied against the simulated trade'),
  ('paper_fee_rate_pct', 'paper_execution', 0, 'ratio', 'Paper fee/tax model applied to entry plus exit notional')
on conflict (key) do nothing;

create table if not exists public.strategy_runtime_state (
  strategy_id text primary key,
  name text not null,
  enabled boolean not null default true,
  version integer not null default 1 check (version > 0),
  active_preset_id uuid,
  updated_at timestamptz not null default now()
);

insert into public.strategy_runtime_state (strategy_id, name, enabled)
values ('level-event', 'NIFTY level-event engine', true)
on conflict (strategy_id) do nothing;

create table if not exists public.strategy_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  parameters jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.strategy_runtime_state
  drop constraint if exists strategy_runtime_state_active_preset_id_fkey;

alter table public.strategy_runtime_state
  add constraint strategy_runtime_state_active_preset_id_fkey
  foreign key (active_preset_id) references public.strategy_presets(id) on delete set null;

create table if not exists public.risk_control_state (
  worker_id text primary key,
  kill_switch_enabled boolean not null default false,
  reason text,
  updated_at timestamptz not null default now()
);

insert into public.risk_control_state (worker_id, kill_switch_enabled)
values ('oracle-primary', false)
on conflict (worker_id) do nothing;

create table if not exists public.market_snapshots (
  id bigint generated always as identity primary key,
  observed_at timestamptz not null,
  session_date date not null,
  payload jsonb not null,
  levels jsonb not null default '[]'::jsonb,
  strategy_parameters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists market_snapshots_session_time_idx
  on public.market_snapshots (session_date, observed_at);

create index if not exists market_snapshots_observed_at_idx
  on public.market_snapshots (observed_at desc);

create table if not exists public.runtime_events (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null default now(),
  severity text not null check (severity in ('info', 'success', 'warning', 'critical')),
  component text not null,
  event_type text not null,
  message text not null,
  detail text not null default '',
  instrument text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists runtime_events_observed_at_idx
  on public.runtime_events (observed_at desc);

create index if not exists runtime_events_component_idx
  on public.runtime_events (component, observed_at desc);

create table if not exists public.terminal_preferences (
  preference_id text primary key,
  refresh_interval_ms integer not null default 3000 check (refresh_interval_ms between 1000 and 60000),
  timezone text not null default 'Asia/Kolkata',
  number_locale text not null default 'en-IN',
  alert_preferences jsonb not null default '{"info":true,"success":true,"warning":true,"critical":true}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.terminal_preferences (preference_id)
values ('default')
on conflict (preference_id) do nothing;

alter table public.nifty_constituent_config
  add column if not exists sector text;

update public.nifty_constituent_config set sector = case symbol
  when 'ADANIENT' then 'Diversified'
  when 'ADANIPORTS' then 'Infrastructure'
  when 'APOLLOHOSP' then 'Healthcare'
  when 'ASIANPAINT' then 'Consumer'
  when 'AXISBANK' then 'Financials'
  when 'BAJAJ-AUTO' then 'Automobile'
  when 'BAJAJFINSV' then 'Financials'
  when 'BAJFINANCE' then 'Financials'
  when 'BEL' then 'Industrials'
  when 'BHARTIARTL' then 'Telecom'
  when 'CIPLA' then 'Healthcare'
  when 'COALINDIA' then 'Energy'
  when 'DRREDDY' then 'Healthcare'
  when 'EICHERMOT' then 'Automobile'
  when 'ETERNAL' then 'Consumer Services'
  when 'GRASIM' then 'Materials'
  when 'HCLTECH' then 'Technology'
  when 'HDFCBANK' then 'Financials'
  when 'HDFCLIFE' then 'Financials'
  when 'HINDALCO' then 'Materials'
  when 'HINDUNILVR' then 'Consumer'
  when 'ICICIBANK' then 'Financials'
  when 'INDIGO' then 'Transport'
  when 'INFY' then 'Technology'
  when 'ITC' then 'Consumer'
  when 'JIOFIN' then 'Financials'
  when 'JSWSTEEL' then 'Materials'
  when 'KOTAKBANK' then 'Financials'
  when 'LT' then 'Industrials'
  when 'M&M' then 'Automobile'
  when 'MARUTI' then 'Automobile'
  when 'MAXHEALTH' then 'Healthcare'
  when 'NESTLEIND' then 'Consumer'
  when 'NTPC' then 'Utilities'
  when 'ONGC' then 'Energy'
  when 'POWERGRID' then 'Utilities'
  when 'RELIANCE' then 'Energy'
  when 'SBILIFE' then 'Financials'
  when 'SBIN' then 'Financials'
  when 'SHRIRAMFIN' then 'Financials'
  when 'SUNPHARMA' then 'Healthcare'
  when 'TATACONSUM' then 'Consumer'
  when 'TATASTEEL' then 'Materials'
  when 'TCS' then 'Technology'
  when 'TECHM' then 'Technology'
  when 'TITAN' then 'Consumer'
  when 'TMPV' then 'Automobile'
  when 'TRENT' then 'Consumer'
  when 'ULTRACEMCO' then 'Materials'
  when 'WIPRO' then 'Technology'
  else coalesce(sector, 'Unclassified')
end
where sector is null;

alter table public.engine_settings enable row level security;
alter table public.strategy_runtime_state enable row level security;
alter table public.strategy_presets enable row level security;
alter table public.risk_control_state enable row level security;
alter table public.market_snapshots enable row level security;
alter table public.runtime_events enable row level security;
alter table public.terminal_preferences enable row level security;

revoke all on table public.engine_settings from anon, authenticated;
revoke all on table public.strategy_runtime_state from anon, authenticated;
revoke all on table public.strategy_presets from anon, authenticated;
revoke all on table public.risk_control_state from anon, authenticated;
revoke all on table public.market_snapshots from anon, authenticated;
revoke all on table public.runtime_events from anon, authenticated;
revoke all on table public.terminal_preferences from anon, authenticated;

commit;
