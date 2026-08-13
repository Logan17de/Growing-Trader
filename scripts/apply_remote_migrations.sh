#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the Supabase Postgres connection URI}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION_DIR="${ROOT_DIR}/supabase/migrations"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required" >&2
  exit 2
fi

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
create schema if not exists private;
revoke all on schema private from public;
create table if not exists private.growing_trader_migrations (
  version text primary key,
  filename text not null,
  checksum text not null,
  applied_at timestamptz not null default now()
);
revoke all on table private.growing_trader_migrations from public, anon, authenticated;
SQL

migration_marker_sql() {
  case "$1" in
    202608120001)
      printf "%s" "select case when to_regclass('public.strategy_levels') is not null then 1 else 0 end"
      ;;
    202608120002)
      printf "%s" "select case when to_regclass('public.broker_credentials') is not null then 1 else 0 end"
      ;;
    202608120003)
      printf "%s" "select case when to_regclass('public.engine_commands_one_active_per_type_idx') is not null then 1 else 0 end"
      ;;
    202608120004)
      printf "%s" "select case when to_regclass('public.paper_engine_status') is not null then 1 else 0 end"
      ;;
    202608120005)
      printf "%s" "select case when to_regclass('public.strategy_parameters') is not null then 1 else 0 end"
      ;;
    202608120006)
      printf "%s" "select case when to_regclass('public.nifty_volume_minute') is not null then 1 else 0 end"
      ;;
    202608130007)
      printf "%s" "select case when to_regclass('public.app_settings') is not null then 1 else 0 end"
      ;;
    202608130008)
      printf "%s" "select case when exists (select 1 from pg_constraint where conname = 'engine_commands_command_check' and pg_get_constraintdef(oid) like '%RUN_REPLAY%') then 1 else 0 end"
      ;;
    202608130009)
      printf "%s" "select case when exists (select 1 from pg_trigger where tgname = 'compact_market_snapshot_options_before_insert' and not tgisinternal) then 1 else 0 end"
      ;;
    202608130010)
      printf "%s" "select case when to_regclass('public.execution_control_state') is not null and to_regclass('public.orders_one_active_live_position_uidx') is not null and exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='order_reference_id') then 1 else 0 end"
      ;;
    *)
      printf "%s" "select 0"
      ;;
  esac
}

mapfile -t migration_files < <(find "$MIGRATION_DIR" -maxdepth 1 -type f -name '*.sql' | sort)

for file in "${migration_files[@]}"; do
  filename="$(basename "$file")"
  version="${filename%%_*}"
  checksum="$(sha256sum "$file" | awk '{print $1}')"

  existing="$(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -Atc \
    "select checksum from private.growing_trader_migrations where version = '${version}'")"

  if [[ -n "$existing" ]]; then
    if [[ "$existing" != "$checksum" ]]; then
      echo "Migration ${filename} was already applied with a different checksum; refusing to continue." >&2
      exit 3
    fi
    echo "skip ${filename} (already applied)"
    continue
  fi

  # This project had several migrations applied manually before the automated
  # ledger existed. Every migration is transactional, so a durable marker from
  # that migration is sufficient to prove the transaction committed. Seed the
  # ledger instead of replaying old production SQL.
  marker_sql="$(migration_marker_sql "$version")"
  marker_present="$(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -Atc "$marker_sql")"
  if [[ "$marker_present" == "1" ]]; then
    echo "baseline ${filename} (schema marker already present)"
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c \
      "insert into private.growing_trader_migrations(version, filename, checksum) values ('${version}', '${filename}', '${checksum}')"
    continue
  fi

  echo "apply ${filename}"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$file"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c \
    "insert into private.growing_trader_migrations(version, filename, checksum) values ('${version}', '${filename}', '${checksum}')"
done

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema';"
echo "Supabase migrations are up to date."
