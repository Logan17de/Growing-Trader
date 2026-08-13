begin;

create table if not exists public.app_settings (
  key text primary key,
  category text not null,
  value jsonb not null,
  description text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.strategy_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  parameters jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists strategy_presets_one_active_idx
  on public.strategy_presets ((is_active)) where is_active;

create table if not exists public.risk_control_state (
  id boolean primary key default true check (id),
  kill_switch boolean not null default false,
  block_new_entries boolean not null default false,
  close_open_position_on_kill boolean not null default true,
  reason text,
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  id boolean primary key default true check (id),
  in_app_enabled boolean not null default true,
  signal_alerts boolean not null default true,
  risk_blocks boolean not null default true,
  system_errors boolean not null default true,
  command_events boolean not null default true,
  min_confidence double precision not null default 0.68 check (min_confidence between 0 and 1),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_events (
  id bigint generated always as identity primary key,
  observed_at timestamptz not null default now(),
  severity text not null check (severity in ('info','success','warning','critical')),
  component text not null,
  event_type text not null,
  title text not null,
  detail text not null default '',
  instrument text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists activity_events_observed_at_idx
  on public.activity_events (observed_at desc);

alter table public.nifty_constituent_config
  add column if not exists sector text;

create table if not exists public.market_constituent_series (
  id bigint generated always as identity primary key,
  observed_at timestamptz not null,
  symbol text not null,
  sector text,
  price double precision not null,
  previous_price double precision not null,
  move_pct double precision not null,
  cumulative_volume bigint not null,
  volume_delta bigint not null,
  volume_rate double precision not null,
  relative_volume double precision not null,
  index_weight double precision not null default 1,
  is_heavyweight boolean not null default false
);

create index if not exists market_constituent_series_lookup_idx
  on public.market_constituent_series (observed_at desc, symbol);

create table if not exists public.option_chain_series (
  id bigint generated always as identity primary key,
  observed_at timestamptz not null,
  expiry text not null,
  underlying_ltp double precision,
  strike double precision not null,
  option_type text not null check (option_type in ('CE','PE')),
  trading_symbol text not null,
  ltp double precision not null,
  open_interest bigint not null,
  volume bigint not null,
  delta double precision,
  gamma double precision,
  theta double precision,
  vega double precision,
  rho double precision,
  iv double precision,
  bid_price double precision,
  ask_price double precision
);

create index if not exists option_chain_series_lookup_idx
  on public.option_chain_series (observed_at desc, strike, option_type);

create table if not exists public.market_snapshot_history (
  id bigint generated always as identity primary key,
  observed_at timestamptz not null,
  snapshot jsonb not null,
  levels jsonb not null default '[]'::jsonb,
  data_age_seconds double precision not null default 0,
  strategy_parameters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists market_snapshot_history_observed_at_idx
  on public.market_snapshot_history (observed_at desc);

create table if not exists public.replay_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  request jsonb not null,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

insert into public.app_settings (key, category, value, description) values
('paper_account_equity','execution','2000000'::jsonb,'Paper account equity used by risk sizing'),
('quote_scan_seconds','market_data','20'::jsonb,'Constituent/futures REST quote scan cadence'),
('option_refresh_seconds','market_data','20'::jsonb,'Option-chain refresh cadence'),
('feed_poll_seconds','market_data','1'::jsonb,'Live-feed state poll cadence'),
('signal_persist_seconds','execution','30'::jsonb,'Non-actionable signal persistence cadence'),
('dashboard_refresh_ms','application','3000'::jsonb,'Terminal status refresh interval'),
('default_instrument','execution','"NIFTY"'::jsonb,'Default research instrument'),
('timezone','application','"Asia/Kolkata"'::jsonb,'Trading timezone')
on conflict (key) do nothing;

insert into public.risk_control_state (id) values (true)
on conflict (id) do nothing;

insert into public.notification_preferences (id) values (true)
on conflict (id) do nothing;

insert into public.strategy_presets (name, description, parameters, is_active)
select 'Current', 'Active DB-backed strategy parameters', coalesce(jsonb_object_agg(key, value), '{}'::jsonb), true
from public.strategy_parameters
where not exists (select 1 from public.strategy_presets);

update public.nifty_constituent_config set sector = case symbol
when 'HDFCBANK' then 'Financial Services' when 'ICICIBANK' then 'Financial Services' when 'SBIN' then 'Financial Services' when 'AXISBANK' then 'Financial Services' when 'KOTAKBANK' then 'Financial Services' when 'BAJFINANCE' then 'Financial Services' when 'BAJAJFINSV' then 'Financial Services' when 'JIOFIN' then 'Financial Services' when 'SHRIRAMFIN' then 'Financial Services' when 'HDFCLIFE' then 'Financial Services' when 'SBILIFE' then 'Financial Services'
when 'RELIANCE' then 'Oil Gas & Consumable Fuels' when 'ONGC' then 'Oil Gas & Consumable Fuels' when 'COALINDIA' then 'Oil Gas & Consumable Fuels'
when 'INFY' then 'Information Technology' when 'TCS' then 'Information Technology' when 'HCLTECH' then 'Information Technology' when 'TECHM' then 'Information Technology' when 'WIPRO' then 'Information Technology'
when 'BHARTIARTL' then 'Telecommunication'
when 'LT' then 'Construction'
when 'ITC' then 'FMCG' when 'HINDUNILVR' then 'FMCG' when 'NESTLEIND' then 'FMCG' when 'TATACONSUM' then 'FMCG'
when 'MARUTI' then 'Automobile' when 'M&M' then 'Automobile' when 'BAJAJ-AUTO' then 'Automobile' when 'EICHERMOT' then 'Automobile' when 'TMPV' then 'Automobile'
when 'SUNPHARMA' then 'Healthcare' when 'CIPLA' then 'Healthcare' when 'DRREDDY' then 'Healthcare' when 'APOLLOHOSP' then 'Healthcare' when 'MAXHEALTH' then 'Healthcare'
when 'TATASTEEL' then 'Metals & Mining' when 'HINDALCO' then 'Metals & Mining' when 'JSWSTEEL' then 'Metals & Mining'
when 'POWERGRID' then 'Power' when 'NTPC' then 'Power'
when 'ADANIPORTS' then 'Services' when 'INDIGO' then 'Services'
when 'ASIANPAINT' then 'Consumer Durables' when 'TITAN' then 'Consumer Durables'
when 'ULTRACEMCO' then 'Construction Materials' when 'GRASIM' then 'Construction Materials'
when 'TRENT' then 'Consumer Services' when 'ETERNAL' then 'Consumer Services'
when 'ADANIENT' then 'Diversified' when 'BEL' then 'Capital Goods'
else coalesce(sector, 'Other') end;

alter table public.app_settings enable row level security;
alter table public.strategy_presets enable row level security;
alter table public.risk_control_state enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.activity_events enable row level security;
alter table public.market_constituent_series enable row level security;
alter table public.option_chain_series enable row level security;
alter table public.market_snapshot_history enable row level security;
alter table public.replay_runs enable row level security;

revoke all on table public.app_settings from anon, authenticated;
revoke all on table public.strategy_presets from anon, authenticated;
revoke all on table public.risk_control_state from anon, authenticated;
revoke all on table public.notification_preferences from anon, authenticated;
revoke all on table public.activity_events from anon, authenticated;
revoke all on table public.market_constituent_series from anon, authenticated;
revoke all on table public.option_chain_series from anon, authenticated;
revoke all on table public.market_snapshot_history from anon, authenticated;
revoke all on table public.replay_runs from anon, authenticated;

commit;
