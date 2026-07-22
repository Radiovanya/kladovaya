#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PG_URL="${DATABASE_URL%%\?*}"

psql "$PG_URL" <<'SQL'
CREATE TABLE IF NOT EXISTS deployment_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

for migration in /opt/kladovaya/migrations/*/migration.sql; do
  name="$(basename "$(dirname "$migration")")"
  applied="$(psql "$PG_URL" -tAc "SELECT 1 FROM deployment_migrations WHERE name = '$name'")"
  if [[ "$applied" == "1" ]]; then
    continue
  fi
  psql -v ON_ERROR_STOP=1 "$PG_URL" -f "$migration"
  psql -v ON_ERROR_STOP=1 "$PG_URL" -c "INSERT INTO deployment_migrations(name) VALUES ('$name')"
done
