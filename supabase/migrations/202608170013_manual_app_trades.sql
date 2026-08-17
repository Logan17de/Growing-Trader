begin;

alter table public.orders add column if not exists execution_source text not null default 'algo';
alter table public.orders drop constraint if exists orders_execution_source_check;
alter table public.orders add constraint orders_execution_source_check check (execution_source in ('algo','manual'));

alter table public.trades add column if not exists execution_source text not null default 'algo';
alter table public.trades drop constraint if exists trades_execution_source_check;
alter table public.trades add constraint trades_execution_source_check check (execution_source in ('algo','manual'));

-- Existing rows predate explicit attribution and therefore remain algorithm rows.
update public.orders set execution_source = 'algo' where execution_source is null;
update public.trades set execution_source = 'algo' where execution_source is null;

create index if not exists orders_execution_source_created_idx
  on public.orders(execution_source, created_at desc);
create index if not exists trades_execution_source_executed_idx
  on public.trades(execution_source, executed_at desc);

alter table public.engine_commands drop constraint if exists engine_commands_command_check;
alter table public.engine_commands add constraint engine_commands_command_check check (
  command in (
    'TEST_AUTH','TEST_MARKET_DATA','START_PAPER_ENGINE','STOP_PAPER_ENGINE','START_ENGINE','STOP_ENGINE','STOP',
    'EXIT_PAPER_POSITION','UPDATE_PAPER_POSITION','KILL_SWITCH','RESET_KILL_SWITCH','CHECK_LIVE_POSITIONS','RUN_REPLAY',
    'MANUAL_LIVE_ENTRY'
  )
);

commit;
