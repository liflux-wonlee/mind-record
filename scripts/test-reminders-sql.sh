#!/bin/bash
# Runs supabase/tests/reminders_test.sql against a scratch local Postgres:
# Supabase stand-ins (supabase/tests/supabase_stubs.sql), then every
# migration in order, then the tests. Needs a local Postgres you can reach
# with psql as a superuser (PGUSER/PGHOST/... or `sudo -u postgres`).
#
#   scripts/test-reminders-sql.sh            # uses psql as-is
#   PSQL="sudo -u postgres psql" scripts/test-reminders-sql.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${REMINDERS_TEST_DB:-joaassistant_reminders_test}"
PSQL="${PSQL:-psql}"

$PSQL -q -d postgres -c "drop database if exists $DB" >/dev/null
# roles are cluster-wide; the stubs create them only if missing
$PSQL -q -d postgres -c "create database $DB" >/dev/null
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/tests/supabase_stubs.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null
done
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/tests/reminders_test.sql"
