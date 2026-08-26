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

  -- A running request cannot be continued safely after its worker disappears:
  -- part of the response may already have been streamed to the client. Fail it
  -- promptly instead of leaving Harness waiting forever. The client's retry or
  -- next request can then be routed to another healthy worker.
  update public.qwen_relay_jobs j
  set status = 'error',
      error = 'Assigned Colab worker disconnected during inference. Retry the request.',
      updated_at = now()
  where j.relay_id = p_relay_id
    and j.status = 'running'
    and j.worker_id is not null
    and not exists (
      select 1
      from public.qwen_relay_workers owner
      where owner.relay_id = p_relay_id
        and owner.worker_id = j.worker_id
        and owner.status = 'online'
        and owner.model = 'qwen3.8-27b'
        and owner.updated_at >= now() - interval '45 seconds'
    );

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
