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
