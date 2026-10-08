#!/usr/bin/env bash
LOGS="${LOGS:-/tmp/momenty-backend-logs}"
for p in gateway functions mocks postgrest auth; do [ -f "$LOGS/$p.pid" ] && kill "$(cat "$LOGS/$p.pid")" 2>/dev/null; rm -f "$LOGS/$p.pid"; done
# anything still bound to the test ports
for port in 9999 3000 54330 54321 54340; do fuser -k -TERM "$port/tcp" >/dev/null 2>&1; done
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D ${PGDATA:-/tmp/pgdata-test} stop -m fast" >/dev/null 2>&1 || true
exit 0
