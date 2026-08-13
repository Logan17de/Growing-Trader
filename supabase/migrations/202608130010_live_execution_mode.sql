begin;

alter table public.orders drop constraint if exists orders_mode_check;
alter table public.orders add constraint orders_mode_check check (mode in ('paper','live'));
alter table public.orders add column if not exists order_reference_id text;
alter table public.orders add column if not exists filled_quantity integer not null default 0 check (filled_quantity >= 0);
alter table public.orders add column if not exists average_fill_price numeric check (average_fill_price is null or average_fill_price >= 0);
alter table public.orders add column if not exists updated_at timestamptz not null default now();
create unique index if not exists orders_order_reference_id_uidx on public.orders(order_reference_id) where order_reference_id is not null;

create table if not exists public.execution_control_state (
  id boolean primary key default true check (id),
  mode text not null default 'paper' check (mode in ('paper','live')),
  live_armed boolean not null default false,
  max_order_premium numeric not null default 0 check (max_order_premium >= 0),
  product text not null default 'MIS' check (product in ('MIS','NRML')),
  order_type text not null default 'MARKET' check (order_type = 'MARKET'),
  armed_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.execution_control_state (id) values (true)
on conflict (id) do nothing;

alter table public.execution_control_state enable row level security;
revoke all on table public.execution_control_state from anon, authenticated;

alter table public.engine_commands drop constraint if exists engine_commands_command_check;
alter table public.engine_commands add constraint engine_commands_command_check check (
  command in (
    'TEST_AUTH','TEST_MARKET_DATA','START_PAPER_ENGINE','STOP_PAPER_ENGINE','START_ENGINE','STOP_ENGINE','STOP',
    'EXIT_PAPER_POSITION','UPDATE_PAPER_POSITION','KILL_SWITCH','RESET_KILL_SWITCH','RUN_REPLAY'
  )
);

commit;
