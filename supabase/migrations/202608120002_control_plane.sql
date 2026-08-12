begin;

create table if not exists public.broker_credentials (
  broker text primary key check (broker in ('groww')),
  api_key_ciphertext text not null,
  api_secret_ciphertext text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.engine_status (
  worker_id text primary key,
  state text not null default 'idle',
  execution_mode text not null default 'paper' check (execution_mode = 'paper'),
  last_heartbeat timestamptz not null default now(),
  groww_authenticated boolean not null default false,
  market_data_status text not null default 'unknown',
  market_data jsonb,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.engine_commands (
  id uuid primary key default gen_random_uuid(),
  command text not null check (command in ('TEST_AUTH', 'TEST_MARKET_DATA', 'STOP')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  result jsonb,
  error text,
  claimed_by text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz
);
create index if not exists engine_commands_queue_idx
  on public.engine_commands (status, created_at);

alter table public.broker_credentials enable row level security;
alter table public.engine_status enable row level security;
alter table public.engine_commands enable row level security;

-- These tables intentionally have no anon/authenticated policies.
-- Only the service-role clients on Vercel and Oracle may access them.

create or replace function public.claim_engine_command(p_worker_id text)
returns setof public.engine_commands
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.engine_commands
  where status = 'queued'
  order by created_at
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  update public.engine_commands
  set status = 'running',
      claimed_by = p_worker_id,
      claimed_at = now()
  where id = v_id;

  return query
  select * from public.engine_commands where id = v_id;
end;
$$;

revoke all on function public.claim_engine_command(text) from public, anon, authenticated;
grant execute on function public.claim_engine_command(text) to service_role;

commit;
