begin;

insert into public.strategy_parameters (key, category, value, unit, description) values
  ('daily_profit_lock_pct', 'risk', 0, 'ratio', 'Optional realized-profit threshold that blocks new paper entries; zero disables it'),
  ('max_quantity', 'risk', 0, 'units', 'Optional maximum paper option quantity after lot rounding; zero disables it'),
  ('max_premium_per_trade', 'risk', 0, 'INR', 'Optional absolute premium budget per paper entry; zero disables it'),
  ('entry_cutoff_minutes_before_close', 'entry', 15, 'minutes', 'Block new paper entries this many minutes before the 15:30 IST close')
on conflict (key) do nothing;

commit;
