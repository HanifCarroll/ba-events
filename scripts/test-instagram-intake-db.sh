#!/bin/sh
set -eu
# This script never reads .env or connects to the hosted database.
intake_test_container="ba-events-intake-test-$$"
trap 'docker rm -f "$intake_test_container" >/dev/null 2>&1 || true' EXIT INT TERM
docker run --detach --rm --name "$intake_test_container" -e POSTGRES_PASSWORD=synthetic-local-only pgvector/pgvector:pg16 >/dev/null
intake_attempt=0
until docker exec "$intake_test_container" pg_isready -U postgres >/dev/null 2>&1; do
  intake_attempt=$((intake_attempt + 1))
  test "$intake_attempt" -lt 30
  sleep 1
done
docker exec -i "$intake_test_container" psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/fixtures/intake-schema.sql
docker exec -i "$intake_test_container" psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/20261025205334_instagram_intake.sql
docker exec -i "$intake_test_container" psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/instagram-intake.sql
