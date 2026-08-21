alter table public.engine_commands
  drop constraint if exists engine_commands_command_check;

alter table public.engine_commands
  add constraint engine_commands_command_check
  check (command in (
    'TEST_AUTH',
    'TEST_MARKET_DATA',
    'START_PAPER_ENGINE',
    'STOP_PAPER_ENGINE',
    'START_ENGINE',
    'STOP_ENGINE',
    'STOP',
    'EXIT_PAPER_POSITION',
    'UPDATE_PAPER_POSITION',
    'KILL_SWITCH',
    'RESET_KILL_SWITCH',
    'CHECK_LIVE_POSITIONS',
    'RUN_REPLAY',
    'MANUAL_LIVE_ENTRY',
    'RUN_PAPER'
  ));
