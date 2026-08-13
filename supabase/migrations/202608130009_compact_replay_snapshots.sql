begin;

create or replace function public.compact_market_snapshot_options()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  compact_options jsonb;
  spot double precision;
begin
  spot := nullif(new.snapshot->>'spot_price', '')::double precision;
  if spot is null or jsonb_typeof(new.snapshot->'options') <> 'array' then
    return new;
  end if;

  with ranked as (
    select
      item,
      dense_rank() over (
        order by abs(coalesce(nullif(item->>'strike', '')::double precision, spot) - spot)
      ) as strike_rank
    from jsonb_array_elements(new.snapshot->'options') as item
  )
  select coalesce(jsonb_agg(item), '[]'::jsonb)
  into compact_options
  from ranked
  where strike_rank <= 11;

  new.snapshot := jsonb_set(new.snapshot, '{options}', compact_options, true);
  return new;
end;
$$;

drop trigger if exists compact_market_snapshot_options_before_insert on public.market_snapshot_history;
create trigger compact_market_snapshot_options_before_insert
before insert on public.market_snapshot_history
for each row execute function public.compact_market_snapshot_options();

revoke all on function public.compact_market_snapshot_options() from public, anon, authenticated;

commit;
