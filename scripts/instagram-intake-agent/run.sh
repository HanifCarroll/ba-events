#!/bin/bash
# Daily BA Eventos Instagram intake on the MacBook Pro, run by the LaunchAgent com.hanif.ba-events-intake at 09:00.
# One run is several short, fresh headless Pi sessions in the dedicated intake checkout, each following one phase
# of prompt.md (the runbook's daily procedure): collect, then review batches while posts are pending and each batch
# makes progress, then venues, then report. Phases share a per-day notes file; the report phase writes the Slack
# report to a file, which goes to #ba-eventos unless it is exactly NOTHING TO REPORT. A model's stdout is never
# the report. Review sessions list the observations they leave pending in a per-run deferral file, and later
# batches skip them. Every collect, review, and venues session writes a completion note to its own .done file.
# A failed phase, a missing completion note, a failed pending count, or a missing report raises pro/ba-events-intake on the VPS's
# shared alert list, naming what failed; a good run clears it.
# The report phase also writes the fixes for Hermes (tool bugs and verified catalog errors the operator can't fix)
# to a per-run fixes file. When it isn't empty, run.sh raises the separate key pro/ba-events-intake/fixes, whose
# Hermes triage fixes them; otherwise it resolves that key quietly. The fixes key never fails the run, and a run
# without a report leaves it alone.
# State lives in ~/agents/ba-events-intake: memory.md (the agent's notes between runs), runs/ (logs, notes and
# reports, disposable) and sessions/ (Pi session files, which are kept).
# Overrides: INTAKE_CHECKOUT, INTAKE_STATE, INTAKE_NO_POST=1 (log instead of posting or alerting; for tests and
# dry runs), INTAKE_MODEL, INTAKE_THINKING, and the budgets below.
set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

checkout="${INTAKE_CHECKOUT:-$HOME/projects/ba-events-instagram-intake}"
prompt="$checkout/scripts/instagram-intake-agent/prompt.md"
state="${INTAKE_STATE:-$HOME/agents/ba-events-intake}"
channel="C0CHBCSEV3R" # #ba-eventos
alert_key="pro/ba-events-intake"
model="${INTAKE_MODEL:-openai/gpt-6.1-sol}"
thinking="${INTAKE_THINKING:-high}"
total_min="${INTAKE_TOTAL_MINUTES:-300}"     # the whole run
session_min="${INTAKE_SESSION_MINUTES:-45}"  # each collect, review and venues session
report_min="${INTAKE_REPORT_MINUTES:-20}"    # the report session
batch="${INTAKE_BATCH:-30}"                  # observations per review session
max_batches="${INTAKE_MAX_BATCHES:-15}"
# Pi's scheduler tools (schedule_task, list_/cancel_/manage_scheduled_task) are excluded: a reminder that fired
# after the summary once replaced the report.
exclude='ask_user_question,herdr_*,computer_use_*,mcp__cua_repl__*,*schedule*'

day=$(TZ=America/Argentina/Buenos_Aires date +%F)
mkdir -p "$state/runs" "$state/sessions"
log="$state/runs/$day.log"
notes="$state/runs/$day.notes.md"
report="$state/runs/$day.report.md"
fixes="$state/runs/$day.fixes.md" # the report phase's fix list for Hermes, one item per line
deferred="$state/runs/$day.deferred" # observation IDs review sessions left pending this run, one per line
touch "$state/memory.md" "$notes"
: >"$deferred" # every run (and so every day) gives stuck observations one fresh attempt
started=$(date +%s)
failed="" # phases that failed, for the alert

# No lock file: launchd never starts a job while its previous run is still going, and manual runs go through
# `launchctl kickstart`. A lock left behind by a killed run would silently stop every later run.

vps_alert() { # vps_alert raise|resolve [text]
  if [ "${INTAKE_NO_POST:-}" = 1 ]; then echo "no-post: alert $1 ${2:-}" >>"$log"; return 0; fi
  if [ "$1" = raise ]; then
    printf '%s\n' "$2" | ssh -o BatchMode=yes -o ConnectTimeout=20 hetzner \
      "~/.local/bin/alert raise $alert_key --title 'BA Eventos intake' --text-file /dev/stdin --workdir /home/hanif/projects/ba-events" >>"$log" 2>&1
  else
    ssh -o BatchMode=yes -o ConnectTimeout=20 hetzner "~/.local/bin/alert resolve $alert_key" >>"$log" 2>&1 || true
  fi
}

fix_alert() { # raise pro/ba-events-intake/fixes with the fix list, or resolve it quietly; never fails the run.
  # A raise on a key that is still open only replies in its thread, so a changed list ("updated") queues triage again
  # with --auto, which respects triage's rate limits. The fingerprint hashes the sorted, trimmed items, so the same list
  # stays quiet across days and a change in any digit (a street number, an error code) still counts as a change.
  local key="$alert_key/fixes" text fp
  if [ -z "$(tr -d '[:space:]' <"$fixes" 2>/dev/null)" ]; then
    if [ "${INTAKE_NO_POST:-}" = 1 ]; then echo "no-post: alert resolve $key" >>"$log"; return 0; fi
    ssh -o BatchMode=yes -o ConnectTimeout=20 hetzner "~/.local/bin/alert resolve $key --quiet" >>"$log" 2>&1 || true
    return 0
  fi
  text="BA Eventos intake on the Pro hit problems it could not fix itself: tool bugs, or catalog facts it verified that its CLI can not change. The events they block stay held until they are fixed.
$(sed -e '/^[[:space:]]*$/d' -e 's/^[[:space:]]*[-*][[:space:]]*//' -e 's/^/• /' "$fixes")
Fixes file: $fixes on the Pro. {triage}"
  fp=$(python3 -I -c '
import hashlib, sys
items = sorted({l.strip() for l in open(sys.argv[1]) if l.strip()})
print(hashlib.sha256("\n".join(items).encode()).hexdigest()[:16])' "$fixes") || fp=""
  if [ "${INTAKE_NO_POST:-}" = 1 ]; then echo "no-post: alert raise $key fingerprint=$fp $text" >>"$log"; return 0; fi
  printf '%s\n' "$text" | ssh -o BatchMode=yes -o ConnectTimeout=20 hetzner \
    "out=\$(~/.local/bin/alert raise $key --title 'BA Eventos intake fixes' --text-file /dev/stdin --workdir /home/hanif/projects/ba-events${fp:+ --fingerprint $fp}) && echo \"\$out\" && case \"\$out\" in *'\"action\": \"updated\"'*) ~/.local/bin/alert triage $key --auto ;; esac" >>"$log" 2>&1 ||
    echo "fix alert failed" >>"$log"
  return 0
}

slack_post() { # slack_post <file>: post the file's text to #ba-eventos as the Chipa bot
  if [ "${INTAKE_NO_POST:-}" = 1 ]; then echo "no-post: slack $(wc -c <"$1" | tr -d ' ') bytes" >>"$log"; return 0; fi
  python3 -I -c 'import json,sys; print(json.dumps({"channel": sys.argv[1], "text": open(sys.argv[2]).read(), "unfurl_links": False}))' "$channel" "$1" |
    ssh -o BatchMode=yes -o ConnectTimeout=20 hetzner \
      'f=$(mktemp); cat >"$f"; python3 -I ~/.hermes/skills/productivity/slack-workspace/scripts/slack_api.py chat.postMessage "@file=$f"; rm -f "$f"' |
    python3 -I -c 'import json,sys; d=json.load(sys.stdin); print("slack", d.get("ok"), d.get("error") or d.get("ts")); sys.exit(0 if d.get("ok") else 1)' >>"$log" 2>&1
}

minutes_left() { echo $(( total_min - ($(date +%s) - started) / 60 )); }

note() { printf '[run.sh %s] %s\n' "$(date -u +%FT%TZ)" "$1" >>"$notes"; }

fail() { # fail <phase> <why>: record a failure for the alert and for the report
  failed="${failed:+$failed; }$1 ($2)"
  note "$1 failed: $2."
}

phase() { # phase <name> <minutes> [batch number]: one fresh Pi session; returns its exit code
  local name="$1" minutes="$2" label="$1${3:+ $3}" rc
  local done_file="$state/runs/$day.$name${3:+-$3}.done"
  rm -f "$done_file"
  echo "phase $label start $(date -u +%FT%TZ) limit=${minutes}m" >>"$log"
  INTAKE_PHASE="$name" INTAKE_DAY="$day" INTAKE_BATCH="$batch" INTAKE_MEMORY="$state/memory.md" \
    INTAKE_NOTES="$notes" INTAKE_REPORT="$report" INTAKE_FIXES="$fixes" INTAKE_DEFERRED="$deferred" INTAKE_DONE="$done_file" \
    caffeinate -i timeout --kill-after=120 "${minutes}m" \
    pi -p --approve --model "$model" --thinking "$thinking" --session-dir "$state/sessions" --exclude-tools "$exclude" \
    "Automation run, $name phase: follow the instructions in $prompt for the $name phase exactly. Read that file first." \
    >>"$log" 2>&1
  rc=$?
  echo "phase $label end $(date -u +%FT%TZ) rc=$rc" >>"$log"
  if [ "$rc" -eq 124 ]; then fail "$label" "hit the ${minutes}-minute limit"
  elif [ "$rc" -ne 0 ]; then fail "$label" "exited with code $rc"
  # Pi can exit 0 without finishing (an early stop or a failed context recovery). The report phase is checked
  # through its report file instead.
  elif [ "$name" != report ] && [ -z "$(tr -d '[:space:]' <"$done_file" 2>/dev/null)" ]; then
    fail "$label" "no completion note"; rc=1
  fi
  return "$rc"
}

pending_count() { # prints "<eligible> <deferred>": unreviewed observations not deferred this run, and deferred
  # ones still pending. Fails if the CLI or its output fails.
  local out
  out=$(bun run instagram:intake pending 2>>"$log") || return 1
  printf '%s' "$out" | python3 -I -c '
import json, sys
d = json.load(sys.stdin)
assert isinstance(d, list)
deferred = {line.strip() for line in open(sys.argv[1]) if line.strip()}
ids = [o["id"] for o in d]
held = sum(1 for i in ids if i in deferred)
print(len(ids) - held, held)' "$deferred" 2>>"$log"
}

echo "start $(date -u +%FT%TZ) model=$model thinking=$thinking total=${total_min}m session=${session_min}m batch=$batch max_batches=$max_batches" >>"$log"
cd "$checkout" || { vps_alert raise "BA Eventos intake didn't run: the checkout $checkout is missing on the Pro. Next run tomorrow at 09:00."; exit 1; }
printf '\n## run.sh: run started at %s\n' "$(date -u +%FT%TZ)" >>"$notes"
rm -f "$fixes" # only this run's fixes are queued

phase collect "$session_min"

# Review in fresh sessions while posts are pending, each batch makes progress, and enough time is left for one
# more review plus venues and report.
# Progress is measured on pending minus deferred: posts a batch deliberately leaves pending don't block newer ones.
batches=0
if counts=$(pending_count); then
  set -- $counts; count=$1; held=$2
  echo "pending $count deferred $held" >>"$log"
  while [ "$count" -gt 0 ]; do
    if [ "$batches" -ge "$max_batches" ]; then note "Review stopped at the $max_batches-batch cap with $count observations pending."; break; fi
    if [ "$(minutes_left)" -lt $(( 2 * session_min + report_min )) ]; then note "Review stopped for time with $count observations pending."; break; fi
    batches=$(( batches + 1 ))
    phase review "$session_min" "$batches"
    before=$count
    if ! counts=$(pending_count); then fail "pending count" "bun run instagram:intake pending failed after review $batches"; break; fi
    set -- $counts; count=$1; held=$2
    echo "pending $count deferred $held" >>"$log"
    if [ "$count" -ge "$before" ]; then note "Review stopped: batch $batches left $count observations pending that weren't deferred."; break; fi
  done
  [ "$held" -gt 0 ] && note "$held observations were deferred this run and stay pending (IDs in $deferred)."
  note "After review: $count observations pending and not deferred, $held deferred, in $batches batches."
else
  fail "pending count" "bun run instagram:intake pending failed after collect, so no review ran"
fi

left=$(minutes_left)
if [ $(( left - report_min )) -ge 10 ]; then
  venues_min=$(( left - report_min < session_min ? left - report_min : session_min ))
  phase venues "$venues_min"
else
  note "Venues skipped: only $left minutes left."
fi

rm -f "$report"
phase report "$report_min"

# Only the explicit sentinel means "quiet day". A missing or empty report is a failure.
if [ -f "$report" ]; then body=$(tr -d '[:space:]' <"$report"); else body=""; fi
echo "end $(date -u +%FT%TZ) batches=$batches report_bytes=$(wc -c <"$report" 2>/dev/null | tr -d ' ') failed=${failed:-none}" >>"$log"
rc=0
if [ -z "$body" ]; then
  vps_alert raise "BA Eventos intake on the Pro ended without a report.${failed:+ Failed: $failed.} Unfinished posts stay pending for tomorrow's 09:00 run. Log: $log on the Pro."
  rc=1
elif [ "$body" = "NOTHINGTOREPORT" ]; then
  echo "nothing to report" >>"$log"
elif ! slack_post "$report"; then
  vps_alert raise "BA Eventos intake ran, but its report couldn't be posted to #ba-eventos.${failed:+ Failed: $failed.} Report: $report on the Pro."
  rc=1
fi
[ -n "$body" ] && fix_alert # without a report the fix list is unknown, so the fixes key is left as it is
if [ "$rc" -eq 0 ] && [ -n "$failed" ]; then
  vps_alert raise "BA Eventos intake on the Pro had a failed phase: $failed. The report was handled; unfinished posts stay pending for tomorrow's 09:00 run. Log: $log on the Pro."
  rc=1
fi
[ "$rc" -eq 0 ] && vps_alert resolve
exit "$rc"
