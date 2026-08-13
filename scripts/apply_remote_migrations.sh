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

  echo "apply ${filename}"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$file"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c \
    "insert into private.growing_trader_migrations(version, filename, checksum) values ('${version}', '${filename}', '${checksum}')"
done

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema';"
echo "Supabase migrations are up to date."
