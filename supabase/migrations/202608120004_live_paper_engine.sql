begin;

alter table public.engine_commands
  drop constraint if exists engine_commands_command_check;

alter table public.engine_commands
  add constraint engine_commands_command_check
  check (command in ('TEST_AUTH', 'TEST_MARKET_DATA', 'START_PAPER_ENGINE', 'STOP_PAPER_ENGINE', 'STOP'));

create table if not exists public.paper_engine_status (
  worker_id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.paper_signal_outcomes (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.signals(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  horizon_seconds integer not null check (horizon_seconds in (60, 180, 300, 600, 900)),
  observed_at timestamptz not null,
  option_ltp numeric not null check (option_ltp >= 0),
  nifty_ltp numeric not null check (nifty_ltp > 0),
  option_return_pct double precision,
  underlying_move_points double precision,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (signal_id, horizon_seconds)
);

create index if not exists paper_signal_outcomes_observed_at_idx
  on public.paper_signal_outcomes (observed_at desc);

alter table public.paper_engine_status enable row level security;
alter table public.paper_signal_outcomes enable row level security;

revoke all on table public.paper_engine_status from anon, authenticated;
revoke all on table public.paper_signal_outcomes from anon, authenticated;

commit;
