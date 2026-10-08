#!/usr/bin/env bash
# Usage: PGHOST=... PGPORT=... PGUSER=postgres ./run.sh   (needs a scratch Postgres 15+; never run against production)
set -euo pipefail
cd "$(dirname "$0")"
DB=looper_test
psql -v ON_ERROR_STOP=1 -qc "drop database if exists $DB" -d postgres
psql -v ON_ERROR_STOP=1 -qc "create database $DB" -d postgres
psql -v ON_ERROR_STOP=1 -q -d $DB -f 00_bootstrap.sql
for m in ../migrations/*.sql; do
  echo "applying $m"
  psql -v ON_ERROR_STOP=1 -q -d $DB -f "$m"
done
psql -v ON_ERROR_STOP=1 -q -d $DB -f 02_tests.sql
psql -v ON_ERROR_STOP=1 -q -d $DB -f 03_tests_org_network_biometric.sql
psql -v ON_ERROR_STOP=1 -q -d $DB -f 04_tests_developer.sql

# First-developer script: promotes a normal login, refuses to consume the only CEO
psql -v ON_ERROR_STOP=1 -q -d $DB -c "insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f9','first.dev@x.test')"
sed "s/you@example.com/first.dev@x.test/; s/'Your'/'First'/; s/'Name'/'Dev'/; s/'DEV001'/'DEV777'/" ../tools/create_first_developer.sql | psql -v ON_ERROR_STOP=1 -q -d $DB
test "$(psql -d $DB -Atc "select role from public.employees where email='first.dev@x.test'")" = developer
if sed "s/you@example.com/ceo@x.test/" ../tools/create_first_developer.sql | psql -v ON_ERROR_STOP=1 -q -d $DB 2>/dev/null; then
  echo "first-developer script consumed the only CEO" >&2; exit 1
fi
if sed "s/you@example.com/nobody@x.test/" ../tools/create_first_developer.sql | psql -v ON_ERROR_STOP=1 -q -d $DB 2>/dev/null; then
  echo "first-developer script accepted a missing login" >&2; exit 1
fi
echo "FIRST DEVELOPER SCRIPT OK"
