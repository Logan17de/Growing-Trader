begin;

insert into public.app_settings (key, category, value, description) values
  ('research_big_move_1m_bps', 'research', '15'::jsonb, 'Research-only threshold used to flag a notable absolute 1-minute NIFTY move'),
  ('research_big_move_5m_bps', 'research', '30'::jsonb, 'Research-only threshold used to flag a notable absolute 5-minute NIFTY move'),
  ('research_big_move_15m_bps', 'research', '50'::jsonb, 'Research-only threshold used to flag a notable absolute 15-minute NIFTY move')
on conflict (key) do nothing;

-- Analysis-ready feature log built entirely from data that Oracle already persists.
-- The raw market_snapshot_history remains the loss-minimizing source of truth; this
-- view turns it into one machine-readable row per persisted signal observation.
create or replace view public.market_watch_log
with (security_invoker = true)
as
select
  s.id as signal_id,
  s.observed_at,
  (s.observed_at at time zone 'Asia/Kolkata')::date as session_date,
  (s.observed_at at time zone 'Asia/Kolkata')::time as session_time,

  -- Spot / whole-index participation.
  v.nifty_ltp as nifty_ltp,
  v.synthetic_vwap,
  case when v.synthetic_vwap is not null and v.synthetic_vwap > 0
    then (v.nifty_ltp / v.synthetic_vwap - 1.0) * 10000.0 end as vwap_distance_bps,
  v.constituent_volume_delta,
  v.constituent_turnover,
  v.cash_pressure,
  v.breadth,
  v.participation,
  v.heavyweight_score,
  nullif(s.payload #>> '{cash,signed_volume_acceleration}', '')::double precision as volume_acceleration,
  nullif(s.payload #>> '{cash,active_count}', '')::integer as active_constituents,
  nullif(s.payload #>> '{cash,advancers}', '')::integer as advancers,
  nullif(s.payload #>> '{cash,decliners}', '')::integer as decliners,
  nullif(s.payload #>> '{cash,score}', '')::double precision as cash_score,

  -- Futures raw state + calculated confirmation.
  ms.snapshot #>> '{futures,symbol}' as futures_symbol,
  nullif(ms.snapshot #>> '{futures,price}', '')::double precision as futures_price,
  nullif(ms.snapshot #>> '{futures,previous_price}', '')::double precision as futures_previous_price,
  case when nullif(ms.snapshot #>> '{futures,previous_price}', '')::double precision > 0
    then (
      nullif(ms.snapshot #>> '{futures,price}', '')::double precision /
      nullif(ms.snapshot #>> '{futures,previous_price}', '')::double precision - 1.0
    ) * 10000.0 end as futures_move_bps,
  nullif(ms.snapshot #>> '{futures,volume}', '')::bigint as futures_volume,
  nullif(ms.snapshot #>> '{futures,previous_volume}', '')::bigint as futures_previous_volume,
  greatest(
    coalesce(nullif(ms.snapshot #>> '{futures,volume}', '')::bigint, 0) -
    coalesce(nullif(ms.snapshot #>> '{futures,previous_volume}', '')::bigint, 0),
    0
  ) as futures_volume_delta,
  nullif(ms.snapshot #>> '{futures,open_interest}', '')::double precision as futures_oi,
  nullif(ms.snapshot #>> '{futures,previous_open_interest}', '')::double precision as futures_previous_oi,
  case when nullif(ms.snapshot #>> '{futures,previous_open_interest}', '')::double precision > 0
    then (
      nullif(ms.snapshot #>> '{futures,open_interest}', '')::double precision /
      nullif(ms.snapshot #>> '{futures,previous_open_interest}', '')::double precision - 1.0
    ) * 100.0 end as futures_oi_change_pct,
  case when v.nifty_ltp > 0 and nullif(ms.snapshot #>> '{futures,price}', '')::double precision is not null
    then nullif(ms.snapshot #>> '{futures,price}', '')::double precision - v.nifty_ltp end as futures_basis_points,
  nullif(s.payload #>> '{futures,price_direction}', '')::double precision as futures_price_direction,
  nullif(s.payload #>> '{futures,volume_activity}', '')::double precision as futures_volume_activity,
  nullif(s.payload #>> '{futures,oi_confirmation}', '')::double precision as futures_oi_confirmation,
  nullif(s.payload #>> '{futures,basis_change}', '')::double precision as futures_basis_change,
  nullif(s.payload #>> '{futures,score}', '')::double precision as futures_score,

  -- Near-ATM option positioning / flow proxies.
  nullif(s.payload #>> '{option_market,score}', '')::double precision as option_score,
  nullif(s.payload #>> '{option_market,volume_imbalance}', '')::double precision as option_volume_imbalance,
  nullif(s.payload #>> '{option_market,oi_change_imbalance}', '')::double precision as option_oi_change_imbalance,
  nullif(s.payload #>> '{option_market,iv_skew}', '')::double precision as option_iv_skew,
  nullif(s.payload #>> '{option_market,call_volume_delta}', '')::bigint as call_volume_delta,
  nullif(s.payload #>> '{option_market,put_volume_delta}', '')::bigint as put_volume_delta,
  nullif(s.payload #>> '{option_market,call_oi_delta}', '')::bigint as call_oi_delta,
  nullif(s.payload #>> '{option_market,put_oi_delta}', '')::bigint as put_oi_delta,
  nullif(s.payload #>> '{option_market,contracts_used}', '')::integer as option_contracts_used,
  coalesce((s.payload #>> '{option_market,ready}')::boolean, false) as option_direction_ready,

  -- Current decision state. This is observational even when there is no level.
  s.event,
  s.direction,
  s.confidence,
  s.combined_direction_score,
  nullif(s.payload #>> '{vwap,score}', '')::double precision as vwap_score,
  nullif(s.payload #>> '{level,event_score}', '')::double precision as level_event_score,
  nullif(s.payload #>> '{level,breakout_score}', '')::double precision as breakout_score,
  nullif(s.payload #>> '{level,reversal_score}', '')::double precision as reversal_score,
  nullif(s.payload #>> '{level,distance_bps}', '')::double precision as level_distance_bps,
  s.payload #>> '{level,level_name}' as level_name,
  coalesce((s.payload #>> '{risk,allowed}')::boolean, false) as risk_allowed,
  nullif(s.payload #>> '{risk,quantity}', '')::integer as risk_quantity,
  s.payload #>> '{risk,reason}' as risk_reason,
  s.payload #>> '{contract,contract,trading_symbol}' as selected_contract,
  nullif(s.payload #>> '{contract,contract,strike}', '')::double precision as selected_strike,
  s.payload #>> '{contract,contract,option_type}' as selected_option_type,
  nullif(s.payload #>> '{contract,contract,ltp}', '')::double precision as selected_option_ltp,
  nullif(s.payload #>> '{contract,contract,open_interest}', '')::bigint as selected_option_oi,
  nullif(s.payload #>> '{contract,contract,volume}', '')::bigint as selected_option_volume,
  nullif(s.payload #>> '{contract,contract,greeks,delta}', '')::double precision as selected_delta,
  nullif(s.payload #>> '{contract,contract,greeks,gamma}', '')::double precision as selected_gamma,
  nullif(s.payload #>> '{contract,contract,greeks,theta}', '')::double precision as selected_theta,
  nullif(s.payload #>> '{contract,contract,greeks,iv}', '')::double precision as selected_iv,

  ms.data_age_seconds,
  ms.strategy_parameters,
  s.payload as signal_payload,

  -- Future labels. These are observations, never trading rules.
  case when f1.nifty_ltp is not null and v.nifty_ltp > 0 then (f1.nifty_ltp / v.nifty_ltp - 1.0) * 10000.0 end as nifty_move_1m_bps,
  case when f3.nifty_ltp is not null and v.nifty_ltp > 0 then (f3.nifty_ltp / v.nifty_ltp - 1.0) * 10000.0 end as nifty_move_3m_bps,
  case when f5.nifty_ltp is not null and v.nifty_ltp > 0 then (f5.nifty_ltp / v.nifty_ltp - 1.0) * 10000.0 end as nifty_move_5m_bps,
  case when f10.nifty_ltp is not null and v.nifty_ltp > 0 then (f10.nifty_ltp / v.nifty_ltp - 1.0) * 10000.0 end as nifty_move_10m_bps,
  case when f15.nifty_ltp is not null and v.nifty_ltp > 0 then (f15.nifty_ltp / v.nifty_ltp - 1.0) * 10000.0 end as nifty_move_15m_bps,
  case when future_range.max_ltp is not null and v.nifty_ltp > 0 then (future_range.max_ltp / v.nifty_ltp - 1.0) * 10000.0 end as max_up_15m_bps,
  case when future_range.min_ltp is not null and v.nifty_ltp > 0 then (future_range.min_ltp / v.nifty_ltp - 1.0) * 10000.0 end as max_down_15m_bps
from public.signals s
left join lateral (
  select row_v.*
  from public.nifty_volume_series row_v
  where row_v.observed_at between s.observed_at - interval '2 seconds' and s.observed_at + interval '2 seconds'
  order by abs(extract(epoch from (row_v.observed_at - s.observed_at)))
  limit 1
) v on true
left join lateral (
  select row_ms.*
  from public.market_snapshot_history row_ms
  where row_ms.observed_at between s.observed_at - interval '2 seconds' and s.observed_at + interval '2 seconds'
  order by abs(extract(epoch from (row_ms.observed_at - s.observed_at)))
  limit 1
) ms on true
left join lateral (
  select row_v.nifty_ltp
  from public.nifty_volume_series row_v
  where row_v.observed_at >= s.observed_at + interval '1 minute'
    and row_v.observed_at <= s.observed_at + interval '1 minute 45 seconds'
  order by row_v.observed_at
  limit 1
) f1 on true
left join lateral (
  select row_v.nifty_ltp
  from public.nifty_volume_series row_v
  where row_v.observed_at >= s.observed_at + interval '3 minutes'
    and row_v.observed_at <= s.observed_at + interval '3 minutes 45 seconds'
  order by row_v.observed_at
  limit 1
) f3 on true
left join lateral (
  select row_v.nifty_ltp
  from public.nifty_volume_series row_v
  where row_v.observed_at >= s.observed_at + interval '5 minutes'
    and row_v.observed_at <= s.observed_at + interval '5 minutes 45 seconds'
  order by row_v.observed_at
  limit 1
) f5 on true
left join lateral (
  select row_v.nifty_ltp
  from public.nifty_volume_series row_v
  where row_v.observed_at >= s.observed_at + interval '10 minutes'
    and row_v.observed_at <= s.observed_at + interval '10 minutes 45 seconds'
  order by row_v.observed_at
  limit 1
) f10 on true
left join lateral (
  select row_v.nifty_ltp
  from public.nifty_volume_series row_v
  where row_v.observed_at >= s.observed_at + interval '15 minutes'
    and row_v.observed_at <= s.observed_at + interval '15 minutes 45 seconds'
  order by row_v.observed_at
  limit 1
) f15 on true
left join lateral (
  select max(row_v.nifty_ltp) as max_ltp, min(row_v.nifty_ltp) as min_ltp
  from public.nifty_volume_series row_v
  where row_v.observed_at > s.observed_at
    and row_v.observed_at <= s.observed_at + interval '15 minutes'
) future_range on true;

create or replace view public.market_watch_labeled
with (security_invoker = true)
as
with thresholds as (
  select
    coalesce(max((value::text)::double precision) filter (where key = 'research_big_move_1m_bps'), 15.0) as move_1m_bps,
    coalesce(max((value::text)::double precision) filter (where key = 'research_big_move_5m_bps'), 30.0) as move_5m_bps,
    coalesce(max((value::text)::double precision) filter (where key = 'research_big_move_15m_bps'), 50.0) as move_15m_bps
  from public.app_settings
)
select
  log.*,
  t.move_1m_bps as big_move_1m_threshold_bps,
  t.move_5m_bps as big_move_5m_threshold_bps,
  t.move_15m_bps as big_move_15m_threshold_bps,
  coalesce(abs(log.nifty_move_1m_bps) >= t.move_1m_bps, false) as big_move_1m,
  coalesce(abs(log.nifty_move_5m_bps) >= t.move_5m_bps, false) as big_move_5m,
  coalesce(abs(log.nifty_move_15m_bps) >= t.move_15m_bps, false) as big_move_15m
from public.market_watch_log log
cross join thresholds t;

create or replace view public.market_watch_big_moves
with (security_invoker = true)
as
select *
from public.market_watch_labeled
where big_move_1m or big_move_5m or big_move_15m;

revoke all on public.market_watch_log from anon, authenticated;
revoke all on public.market_watch_labeled from anon, authenticated;
revoke all on public.market_watch_big_moves from anon, authenticated;

commit;
