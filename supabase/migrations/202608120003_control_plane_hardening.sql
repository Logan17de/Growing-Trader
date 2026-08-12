begin;

drop policy if exists "dashboard can read signals" on public.signals;
drop policy if exists "dashboard can read levels" on public.strategy_levels;

revoke all on table public.strategy_levels from anon, authenticated;
revoke all on table public.signals from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.trades from anon, authenticated;
revoke all on table public.broker_credentials from anon, authenticated;
revoke all on table public.engine_status from anon, authenticated;
revoke all on table public.engine_commands from anon, authenticated;

with ranked as (
  select id,
         row_number() over (partition by command order by created_at, id) as rn
  from public.engine_commands
  where status in ('queued', 'running')
)
update public.engine_commands
set status = 'failed',
    error = coalesce(error, 'Superseded during control-plane hardening'),
    completed_at = coalesce(completed_at, now())
where id in (select id from ranked where rn > 1);

create unique index if not exists engine_commands_one_active_per_type_idx
  on public.engine_commands (command)
  where status in ('queued', 'running');

create or replace function public.claim_engine_command(p_worker_id text)
returns setof public.engine_commands
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.engine_commands
  set status = 'failed',
      completed_at = now(),
      error = coalesce(error, 'Worker lease expired before command completion')
  where status = 'running'
    and claimed_at < now() - interval '2 minutes';

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
