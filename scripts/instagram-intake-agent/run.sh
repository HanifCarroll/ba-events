#!/bin/bash
# Daily BA Eventos Instagram intake on the MacBook Pro, run by the LaunchAgent com.hanif.ba-events-intake at 09:00.
# A headless Pi session follows prompt.md (the runbook's daily procedure) in the dedicated intake checkout.
# Its final message is the report: it goes to Slack #ba-eventos unless it is exactly NOTHING TO REPORT.
# A failed or timed-out run raises pro/ba-events-intake on the VPS's shared alert list; a good run clears it.
# State lives in ~/agents/ba-events-intake: memory.md (the agent's notes between runs), runs/ (logs and
# reports, disposable) and sessions/ (Pi session files, which are kept).
set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

checkout="$HOME/projects/ba-events-instagram-intake"
prompt="$checkout/scripts/instagram-intake-agent/prompt.md"
state="$HOME/agents/ba-events-intake"
channel="C0CHBCSEV3R" # #ba-eventos
alert_key="pro/ba-events-intake"
model="${INTAKE_MODEL:-openai/gpt-6.1-sol}"
thinking="${INTAKE_THINKING:-high}"
limit="${INTAKE_TIME_LIMIT:-4h}"

day=$(TZ=America/Argentina/Buenos_Aires date +%F)
mkdir -p "$state/runs" "$state/sessions"
log="$state/runs/$day.log"
report="$state/runs/$day.report.md"
touch "$state/memory.md"

# No lock file: launchd never starts a job while its previous run is still going, and manual runs go through
# `launchctl kickstart`. A lock left behind by a killed run would silently stop every later run.

vps_alert() { # vps_alert raise|resolve [text]
  if [ "$1" = raise ]; then
    printf '%s\n' "$2" | ssh -o BatchMode=yes -o ConnectTimeout=20 hetzner \
      "~/.local/bin/alert raise $alert_key --title 'BA Eventos intake' --text-file /dev/stdin --workdir /home/hanif/projects/ba-events" >>"$log" 2>&1
  else
    ssh -o BatchMode=yes -o ConnectTimeout=20 hetzner "~/.local/bin/alert resolve $alert_key" >>"$log" 2>&1 || true
  fi
}

slack_post() { # slack_post <file>: post the file's text to #ba-eventos as the Chipa bot
  python3 -I -c 'import json,sys; print(json.dumps({"channel": sys.argv[1], "text": open(sys.argv[2]).read(), "unfurl_links": False}))' "$channel" "$1" |
    ssh -o BatchMode=yes -o ConnectTimeout=20 hetzner \
      'f=$(mktemp); cat >"$f"; python3 -I ~/.hermes/skills/productivity/slack-workspace/scripts/slack_api.py chat.postMessage "@file=$f"; rm -f "$f"' |
    python3 -I -c 'import json,sys; d=json.load(sys.stdin); print("slack", d.get("ok"), d.get("error") or d.get("ts")); sys.exit(0 if d.get("ok") else 1)' >>"$log" 2>&1
}

echo "start $(date -u +%FT%TZ) model=$model thinking=$thinking limit=$limit" >>"$log"
cd "$checkout" || { vps_alert raise "BA Eventos intake didn't run: the checkout $checkout is missing on the Pro. Next run tomorrow at 09:00."; exit 1; }

set +e
INTAKE_MEMORY="$state/memory.md" caffeinate -i timeout --kill-after=120 "$limit" \
  pi -p --approve --model "$model" --thinking "$thinking" --session-dir "$state/sessions" \
  --exclude-tools 'ask_user_question,herdr_*,computer_use_*,mcp__cua_repl__*' \
  "Automation run: follow the instructions in $prompt exactly. Read that file first." \
  >"$report.raw" 2>>"$log"
rc=$?
set -e  # only after the Pi exit code is captured
grep -v -E '^Warning: Extension package' "$report.raw" >"$report" || true
rm -f "$report.raw"
echo "end $(date -u +%FT%TZ) rc=$rc report_bytes=$(wc -c <"$report" | tr -d ' ')" >>"$log"

if [ "$rc" -ne 0 ]; then
  why="it exited with code $rc"
  [ "$rc" -eq 124 ] && why="it hit the $limit time limit"
  vps_alert raise "BA Eventos intake on the Pro failed: $why. Unfinished posts stay pending for tomorrow's 09:00 run. Log: $log on the Pro."
  exit 1
fi

# Only the explicit sentinel means "quiet day". Pi can exit 0 with no final text (e.g. a failed context
# compaction), so an empty report is a failure. The alert clears only after the report was handled.
body=$(tr -d '[:space:]' <"$report")
if [ -z "$body" ]; then
  vps_alert raise "BA Eventos intake on the Pro ended without a report, so it may not have finished. Unfinished posts stay pending for tomorrow's 09:00 run. Log: $log on the Pro."
  exit 1
elif [ "$body" = "NOTHINGTOREPORT" ]; then
  echo "nothing to report" >>"$log"
elif ! slack_post "$report"; then
  vps_alert raise "BA Eventos intake ran, but its report couldn't be posted to #ba-eventos. Report: $report on the Pro."
  exit 1
fi
vps_alert resolve
exit 0
