create or replace function public.qwen_relay_create_job(
  p_relay_id text,
  p_secret text,
  p_job_id uuid,
  p_request_payload text
)
returns setof public.qwen_relay_jobs
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_worker text;
begin
  perform public.qwen_relay_assert_secret(p_relay_id, p_secret);

  -- Serialize placement so simultaneous requests observe each other's assigned
  -- work instead of racing onto the same healthy worker.
  perform pg_advisory_xact_lock(hashtextextended('qwen-relay-balance:' || p_relay_id, 0));

  select w.worker_id
    into v_worker
  from public.qwen_relay_workers w
  left join lateral (
    select count(*)::bigint as active_jobs
    from public.qwen_relay_jobs j
    where j.relay_id = p_relay_id
      and j.status in ('queued', 'running')
      and coalesce(j.worker_id, j.preferred_worker_id) = w.worker_id
  ) load on true
  where w.relay_id = p_relay_id
    and w.status = 'online'
    and w.model = 'qwen3.8-27b'
    and w.updated_at >= now() - interval '30 seconds'
  order by load.active_jobs asc,
           md5(p_job_id::text || ':' || w.worker_id) asc
  limit 1;

  return query
    insert into public.qwen_relay_jobs(
      id,
      relay_id,
      request_path,
      request_payload,
      status,
      preferred_worker_id
    )
    values (
      p_job_id,
      p_relay_id,
      null,
      p_request_payload,
      'queued',
      v_worker
    )
    returning *;
end;
$function$;

revoke all on function public.qwen_relay_create_job(text, text, uuid, text) from public;
grant execute on function public.qwen_relay_create_job(text, text, uuid, text) to anon, authenticated, service_role;

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

  if v_key is null then
    return query
      select * from public.qwen_relay_create_job(
        p_relay_id,
        p_secret,
        p_job_id,
        p_request_payload
      );
    return;
  end if;

  if length(v_key) > 128 then
    raise exception 'affinity key too long';
  end if;

  -- Serialize new affinity assignment per relay. Two new clients arriving
  -- together therefore spread across healthy workers instead of both observing
  -- the same empty placement state.
  perform pg_advisory_xact_lock(hashtextextended('qwen-relay-balance:' || p_relay_id, 0));

  select a.worker_id
    into v_worker
  from public.qwen_relay_affinity a
  where a.relay_id = p_relay_id
    and a.affinity_key = v_key;

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
    left join lateral (
      select count(*)::bigint as active_jobs
      from public.qwen_relay_jobs j
      where j.relay_id = p_relay_id
        and j.status in ('queued', 'running')
        and coalesce(j.worker_id, j.preferred_worker_id) = w.worker_id
    ) load on true
    left join lateral (
      select count(*)::bigint as active_affinities
      from public.qwen_relay_affinity a
      where a.relay_id = p_relay_id
        and a.worker_id = w.worker_id
        and a.updated_at >= now() - interval '30 minutes'
    ) affinity_load on true
    where w.relay_id = p_relay_id
      and w.status = 'online'
      and w.model = 'qwen3.8-27b'
      and w.updated_at >= now() - interval '30 seconds'
    order by load.active_jobs asc,
             affinity_load.active_affinities asc,
             md5(v_key || ':' || w.worker_id) asc
    limit 1;
  end if;

  if v_worker is not null then
    insert into public.qwen_relay_affinity(relay_id, affinity_key, worker_id, created_at, updated_at)
    values (p_relay_id, v_key, v_worker, now(), now())
    on conflict (relay_id, affinity_key) do update
    set worker_id = excluded.worker_id,
        updated_at = now();
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
