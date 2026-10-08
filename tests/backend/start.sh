#!/usr/bin/env bash
# Starts a local Supabase-compatible backend for the automated tests:
# Postgres 16 + Supabase Auth (GoTrue) + PostgREST + the real Edge Functions (Deno) + fake external APIs.
# Expects the binaries downloaded to $SB (default /tmp/sb): auth, postgrest, deno, migrations/.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SB="${SB:-/tmp/sb}"
PGDATA="${PGDATA:-/tmp/pgdata-test}"
PGBIN=/usr/lib/postgresql/16/bin
JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long"
LOGS="${LOGS:-/tmp/momenty-backend-logs}"
mkdir -p "$LOGS"

"$HERE/stop.sh" >/dev/null 2>&1 || true

# ---- Postgres (fresh database every run)
rm -rf "$PGDATA"; mkdir -p "$PGDATA"; chown postgres "$PGDATA"
su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust >/dev/null"
sed -i 's/^host\(.*\)127.0.0.1\/32\(.*\)trust/host\1127.0.0.1\/32\2md5/' "$PGDATA/pg_hba.conf"
su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-p 54322 -k /tmp' -l $PGDATA.log start -w >/dev/null"
PSQL="psql -h /tmp -p 54322 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL <<'SQL'
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login password 'authpass' noinherit;
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login password 'authpass' createrole noinherit;
create schema auth authorization supabase_auth_admin;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant create on database postgres to supabase_auth_admin;
SQL

# ---- Supabase Auth
export API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 GOTRUE_API_HOST=127.0.0.1 PORT=9999
export GOTRUE_DB_DRIVER=postgres GOTRUE_DB_MIGRATIONS_PATH="$SB/migrations"
export DATABASE_URL="postgres://supabase_auth_admin:authpass@127.0.0.1:54322/postgres?search_path=auth&sslmode=disable"
export GOTRUE_SITE_URL=http://localhost:8080 GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated
export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_DISABLE_SIGNUP=false
export GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_LOG_LEVEL=warn GOTRUE_RATE_LIMIT_EMAIL_SENT=1000
export GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true GOTRUE_RATE_LIMIT_TOKEN_REFRESH=10000 GOTRUE_RATE_LIMIT_VERIFY=10000
"$SB/auth" migrate >"$LOGS/auth-migrate.log" 2>&1
nohup "$SB/auth" serve >"$LOGS/auth.log" 2>&1 &
echo $! > "$LOGS/auth.pid"

# ---- Schema (storage stub for tests, then the real schema, then test-only storage RPCs)
# Supabase lets the API roles call auth.uid()/auth.role() – mirror that here.
$PSQL -c "grant usage on schema auth to anon, authenticated, service_role; grant execute on all functions in schema auth to anon, authenticated, service_role;"
$PSQL -f "$HERE/storage-stub.sql"
$PSQL -f "$ROOT/supabase/schema.sql" 2>&1 | grep -v NOTICE || true
$PSQL -f "$HERE/storage-test-rpc.sql"

# ---- PostgREST
cat > "$LOGS/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authpass@127.0.0.1:54322/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = 3000
log-level = "warn"
CONF
nohup "$SB/postgrest" "$LOGS/postgrest.conf" >"$LOGS/postgrest.log" 2>&1 &
echo $! > "$LOGS/postgrest.pid"

# ---- keys (same format as Supabase's legacy anon / service_role JWT keys)
KEYS=$(node "$HERE/keys.js" "$JWT_SECRET")
ANON_KEY=$(echo "$KEYS" | sed -n 1p); SERVICE_KEY=$(echo "$KEYS" | sed -n 2p)
echo "$ANON_KEY" > "$LOGS/anon.key"; echo "$SERVICE_KEY" > "$LOGS/service.key"

# ---- fake external APIs
nohup node "$HERE/mocks.js" >"$LOGS/mocks.log" 2>&1 &
echo $! > "$LOGS/mocks.pid"

# ---- Edge Functions (real handlers) with test configuration
M=http://127.0.0.1:54340
env SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY" SUPABASE_ANON_KEY="$ANON_KEY" \
  ANTHROPIC_API_KEY=test-anthropic-key ANTHROPIC_BASE_URL=$M AI_DAILY_LIMIT=500 \
  GOOGLE_CLIENT_ID=gclient GOOGLE_CLIENT_SECRET=gsecret GOOGLE_AUTH_URL=$M/google/auth GOOGLE_TOKEN_URL=$M/google/token \
  GOOGLE_REVOKE_URL=$M/google/revoke GOOGLE_CALENDAR_API=$M/calendar \
  CANVA_CLIENT_ID=cid CANVA_CLIENT_SECRET=csecret CANVA_AUTH_URL=$M/canva/authorize CANVA_API=$M/canva/api \
  FUNCTIONS_PORT=54330 \
  nohup "$SB/deno" run --config "$ROOT/supabase/functions/deno.json" --allow-net --allow-env --allow-read "$HERE/functions-server.ts" >"$LOGS/functions.log" 2>&1 &
echo $! > "$LOGS/functions.pid"

# ---- gateway
nohup node "$HERE/gateway.js" >"$LOGS/gateway.log" 2>&1 &
echo $! > "$LOGS/gateway.pid"

for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:9999/health >/dev/null && curl -sf http://127.0.0.1:3000/ >/dev/null \
     && curl -s -o /dev/null http://127.0.0.1:54330/functions/v1/ai && curl -s -o /dev/null http://127.0.0.1:54321/; then
    echo "backend ready (anon key in $LOGS/anon.key)"; exit 0
  fi
  sleep 1
done
echo "backend failed to start – see $LOGS"; exit 1
