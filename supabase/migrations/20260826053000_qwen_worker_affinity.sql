alter table public.qwen_relay_jobs
  add column if not exists affinity_key text,
  add column if not exists preferred_worker_id text;

create table if not exists public.qwen_relay_affinity (
  relay_id text not null,
  affinity_key text not null,
  worker_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (relay_id, affinity_key)
);

alter table public.qwen_relay_affinity enable row level security;
revoke all on table public.qwen_relay_affinity from public, anon, authenticated;

create index if not exists qwen_relay_jobs_affinity_claim_idx
  on public.qwen_relay_jobs (relay_id, status, preferred_worker_id, created_at);

create index if not exists qwen_relay_affinity_updated_idx
  on public.qwen_relay_affinity (updated_at);

create or replace function public.qwen_relay_create_affinity_job(
  p_relay_id text,
  p_secret text,
  p_job_id uuid,
  p_request_payload text,
  p_affinity_key text
)
returns setof public.qwen_relay_jobs
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_key text := nullif(btrim(p_affinity_key), '');
  v_worker text;
begin
  perform public.qwen_relay_assert_secret(p_relay_id, p_secret);

  if v_key is not null then
    if length(v_key) > 128 then
      raise exception 'affinity key too long';
    end if;

    select a.worker_id
      into v_worker
    from public.qwen_relay_affinity a
    where a.relay_id = p_relay_id
      and a.affinity_key = v_key
    for update;

    if v_worker is not null and not exists (
      select 1
      from public.qwen_relay_workers w
      where w.relay_id = p_relay_id
        and w.worker_id = v_worker
        and w.status = 'online'
        and w.model = 'qwen3.8-27b'
        and w.updated_at >= now() - interval '30 seconds'
    ) then
      v_worker := null;
    end if;

    if v_worker is null then
      select w.worker_id
        into v_worker
      from public.qwen_relay_workers w
      where w.relay_id = p_relay_id
        and w.status = 'online'
        and w.model = 'qwen3.8-27b'
        and w.updated_at >= now() - interval '30 seconds'
      order by md5(v_key || ':' || w.worker_id) asc
      limit 1;
    end if;

    if v_worker is not null then
      insert into public.qwen_relay_affinity(relay_id, affinity_key, worker_id, created_at, updated_at)
      values (p_relay_id, v_key, v_worker, now(), now())
      on conflict (relay_id, affinity_key) do update
      set worker_id = excluded.worker_id,
          updated_at = now();
    end if;
  end if;

  return query
    insert into public.qwen_relay_jobs(
      id,
      relay_id,
      request_path,
      request_payload,
      status,
      affinity_key,
      preferred_worker_id
    )
    values (
      p_job_id,
      p_relay_id,
      null,
      p_request_payload,
      'queued',
      v_key,
      v_worker
    )
    returning *;
end;
$function$;

revoke all on function public.qwen_relay_create_affinity_job(text, text, uuid, text, text) from public;
grant execute on function public.qwen_relay_create_affinity_job(text, text, uuid, text, text) to anon, authenticated, service_role;

-- Remove the legacy unauthenticated claim overload so it cannot bypass affinity routing.
drop function if exists public.qwen_relay_claim_job(text, text);

create or replace function public.qwen_relay_claim_job(
  p_relay_id text,
  p_secret text,
  p_worker_id text
)
returns setof public.qwen_relay_jobs
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_id uuid;
  v_affinity text;
begin
  perform public.qwen_relay_assert_secret(p_relay_id, p_secret);

  if not exists (
    select 1
    from public.qwen_relay_workers w
    where w.relay_id = p_relay_id
      and w.worker_id = p_worker_id
      and w.status = 'online'
      and w.model = 'qwen3.8-27b'
      and w.updated_at >= now() - interval '30 seconds'
  ) then
    return;
  end if;

  select j.id, j.affinity_key
    into v_id, v_affinity
  from public.qwen_relay_jobs j
  where j.relay_id = p_relay_id
    and j.status = 'queued'
    and (
      j.preferred_worker_id is null
      or j.preferred_worker_id = p_worker_id
      or not exists (
        select 1
        from public.qwen_relay_workers preferred
        where preferred.relay_id = p_relay_id
          and preferred.worker_id = j.preferred_worker_id
          and preferred.status = 'online'
          and preferred.model = 'qwen3.8-27b'
          and preferred.updated_at >= now() - interval '30 seconds'
      )
    )
  order by j.created_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  if v_affinity is not null then
    insert into public.qwen_relay_affinity(relay_id, affinity_key, worker_id, created_at, updated_at)
    values (p_relay_id, v_affinity, p_worker_id, now(), now())
    on conflict (relay_id, affinity_key) do update
    set worker_id = excluded.worker_id,
        updated_at = now();
  end if;

  return query
    update public.qwen_relay_jobs
    set status = 'running',
        worker_id = p_worker_id,
        preferred_worker_id = case
          when affinity_key is null then preferred_worker_id
          else p_worker_id
        end,
        claimed_at = now(),
        updated_at = now()
    where id = v_id
    returning *;
end;
$function$;

revoke all on function public.qwen_relay_claim_job(text, text, text) from public;
grant execute on function public.qwen_relay_claim_job(text, text, text) to anon, authenticated, service_role;
