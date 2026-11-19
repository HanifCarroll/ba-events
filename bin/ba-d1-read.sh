#!/usr/bin/env bash
# Read-only query against a BA Eventos D1 over the Cloudflare API (copied from Casamo's prod-d1-read.sh).
# Usage: bin/ba-d1-read.sh [--staging] "SELECT ..." ['["bound value"]']
# Refuses anything that could write: production data is only ever read from here. Writes are reviewed .sql files run
# with `wrangler d1 execute baeventos-production --remote --file` (docs/ops/d1-cutover.md).
# Token: $BA_D1_TOKEN_FILE (default ~/.config/ba-events/cloudflare-deploy-token, mode 600; needs D1 Read). Never printed.
set -euo pipefail
db=baeventos-production
[ "${1:-}" = --staging ] && { db=baeventos-staging; shift; }
sql=${1:?usage: ba-d1-read.sh [--staging] \"SELECT ...\"}
if grep -qiE '\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex|pragma)\b' <<<"$sql"; then
  echo "refused: only read-only SELECT statements are allowed" >&2; exit 2
fi
grep -qiE '^\s*(select|with|explain)\b' <<<"$sql" || { echo "refused: statement must start with SELECT, WITH, or EXPLAIN" >&2; exit 2; }
account=38d9d25d890a220fb7cf6dd92f8a322a
token_file=${BA_D1_TOKEN_FILE:-$HOME/.config/ba-events/cloudflare-deploy-token}
api=https://api.cloudflare.com/client/v4/accounts/$account/d1/database
# The Authorization header reaches curl on stdin (`-K -`), never in argv, where `ps` and health snapshots would see it.
auth() { printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '\r\n' < "$token_file")"; }
id=$(auth | curl -sS --max-time 30 -K - -G --data-urlencode "name=$db" "$api" |
  python3 -I -c 'import json,sys; d=json.load(sys.stdin); r=[x["uuid"] for x in d.get("result") or [] if x["name"]==sys.argv[1]]; print(r[0] if r else "")' "$db")
[ -n "$id" ] || { echo "no D1 named $db (or the token can't read D1)" >&2; exit 1; }
body=$(mktemp); trap 'rm -f "$body"' EXIT
python3 -I -c 'import json,sys; p=json.loads(sys.argv[2]); assert isinstance(p,list); print(json.dumps({"sql": sys.argv[1], "params": p}))' "$sql" "${2:-[]}" > "$body"
auth | curl -sS --max-time 60 -K - -X POST -H 'Content-Type: application/json' --data @"$body" "$api/$id/query" |
  python3 -I -c 'import json,sys; d=json.load(sys.stdin); r=d.get("result") or [];
if not d.get("success") or len(r) != 1 or not r[0].get("success"): sys.exit("D1 query failed")
print(json.dumps(r[0]["results"], indent=1))'
