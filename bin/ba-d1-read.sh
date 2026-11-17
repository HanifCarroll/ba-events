#!/usr/bin/env bash
# Read-only query against a BA Eventos D1 over the Cloudflare API (copied from Casamo's prod-d1-read.sh).
# Usage: bin/ba-d1-read.sh [--staging] "SELECT ..."
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
token=$(cat "${BA_D1_TOKEN_FILE:-$HOME/.config/ba-events/cloudflare-deploy-token}")
api=https://api.cloudflare.com/client/v4/accounts/$account/d1/database
id=$(curl -sS --max-time 30 -G -H "Authorization: Bearer $token" --data-urlencode "name=$db" "$api" |
  python3 -I -c 'import json,sys; d=json.load(sys.stdin); r=[x["uuid"] for x in d.get("result") or [] if x["name"]==sys.argv[1]]; print(r[0] if r else "")' "$db")
[ -n "$id" ] || { echo "no D1 named $db (or the token can't read D1)" >&2; exit 1; }
python3 -I -c 'import json,sys; print(json.dumps({"sql": sys.argv[1]}))' "$sql" |
  curl -sS --max-time 60 -X POST -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data @- "$api/$id/query" |
  python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d["result"][0]["results"] if d.get("success") else d.get("errors"), indent=1))'
