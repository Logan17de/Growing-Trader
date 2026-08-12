begin;

create or replace view public.nifty_volume_minute
with (security_invoker = true)
as
select
  date_trunc('minute', observed_at) as observed_at,
  avg(nifty_ltp)::double precision as nifty_ltp,
  avg(synthetic_vwap)::double precision as synthetic_vwap,
  sum(constituent_volume_delta)::bigint as constituent_volume_delta,
  sum(constituent_turnover)::double precision as constituent_turnover,
  avg(cash_pressure)::double precision as cash_pressure,
  avg(breadth)::double precision as breadth,
  avg(participation)::double precision as participation,
  avg(heavyweight_score)::double precision as heavyweight_score,
  avg(futures_score)::double precision as futures_score,
  avg(option_score)::double precision as option_score,
  avg(vwap_score)::double precision as vwap_score,
  avg(combined_score)::double precision as combined_score
from public.nifty_volume_series
group by date_trunc('minute', observed_at);

revoke all on table public.nifty_volume_minute from anon, authenticated;

grant select on table public.nifty_volume_minute to service_role;

commit;
