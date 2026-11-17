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
# When the VPS can't be reached, alerts and the report are retried for about 20 minutes and then queued in
# $state/outbox for the next run (see `send`).
# Overrides: INTAKE_CHECKOUT, INTAKE_STATE, INTAKE_NO_POST=1 (log instead of posting or alerting; for tests and
# dry runs), INTAKE_MODEL, INTAKE_THINKING, INTAKE_POST_BUDGET_SECONDS, INTAKE_POST_BACKOFF_SECONDS, and the budgets below.
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

# Delivery to the VPS (alerts and Slack) goes through `send`, which puts every message in $outbox first and then drains
# the outbox strictly oldest first, so nothing newer goes out while an older message waits. Each ssh attempt is cut off
# after INTAKE_SSH_SECONDS (120); an attempt that can't reach the VPS (exit 255) or is cut off is retried with backoff
# until about 20 minutes of wall time (INTAKE_POST_BUDGET_SECONDS, shared by the whole run) have gone to delivery.
# Whatever is still queued goes out at the start of the next run, oldest first, with a line saying it was delayed and
# from which run. A remote refusal (Slack's ok:false, a failed alert command) is not retried: it moves to
# $outbox/refused. A retry after an ambiguous failure can post a message twice; a duplicate beats a lost report.
# Posting problems never fail the run; only a refused report does, as before.
outbox="$state/outbox"
post_budget="${INTAKE_POST_BUDGET_SECONDS:-1200}"
post_delay="${INTAKE_POST_BACKOFF_SECONDS:-30}"
ssh_limit="${INTAKE_SSH_SECONDS:-120}"
post_spent=0 # seconds of wall time spent delivering, attempts and sleeps
queued=0
slack_cmd='f=$(mktemp); cat >"$f"; python3 -I ~/.hermes/skills/productivity/slack-workspace/scripts/slack_api.py chat.postMessage "@file=$f"; rm -f "$f"'

bounded_ssh() { # bounded_ssh <input file> <remote command>: ssh's output, cut off after $ssh_limit seconds (then 255)
  # launchd's PATH has no `timeout` on macOS, so a background watcher kills the attempt. Output goes through a file, so
  # nothing the killed attempt left running can hold the caller's $(...) open.
  local pid watcher rc out
  out=$(mktemp)
  ssh -o BatchMode=yes -o ConnectTimeout=20 hetzner "$2" <"$1" >"$out" & pid=$!
  ( trap 'kill $sleeper 2>/dev/null; exit 0' TERM
    sleep "$ssh_limit" & sleeper=$!; wait "$sleeper"
    pkill -TERM -P "$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null && echo "ssh cut off after ${ssh_limit}s" >>"$log" ) </dev/null >/dev/null 2>&1 & watcher=$!
  wait "$pid"; rc=$?
  kill -TERM "$watcher" 2>/dev/null; wait "$watcher" 2>/dev/null
  cat "$out"; rm -f "$out"
  [ "$rc" -ge 128 ] && rc=255 # killed by a signal: treat as unreachable
  return "$rc"
}

deliver() { # deliver <item> [delayed]: one attempt; returns 255 when the VPS wasn't reached and 1 when it refused
  local kind from cmd body input out rc
  kind=$(sed -n 1p "$1"); from=$(sed -n 2p "$1"); cmd=$(sed -n 3p "$1"); body=$(tail -n +4 "$1")
  if [ -n "${2:-}" ] && [ -n "$body" ]; then
    body="⏳ Delayed: this is from the BA Eventos intake run of ${from%% *}, which couldn't reach the VPS to send it.
$body"
  fi
  input=$(mktemp)
  if [ "$kind" = slack ]; then
    python3 -I -c 'import json,sys; print(json.dumps({"channel": sys.argv[1], "text": sys.argv[2], "unfurl_links": False}))' "$channel" "$body" >"$input"
  elif [ -n "$body" ]; then printf '%s\n' "$body" >"$input"; fi
  out=$(bounded_ssh "$input" "$cmd" 2>>"$log"); rc=$?
  rm -f "$input"
  [ -n "$out" ] && printf '%s\n' "$out" >>"$log"
  [ "$rc" -eq 255 ] && return 255
  if [ "$kind" = slack ]; then
    printf '%s' "$out" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print("slack", d.get("ok"), d.get("error") or d.get("ts")); sys.exit(0 if d.get("ok") else 1)' >>"$log" 2>&1 || return 1
  fi
  return "$rc"
}

enqueue() { # enqueue <kind> <remote command> [text]: add a message to the outbox; sets $enqueued to its path
  local tmp item
  enqueued=""
  mkdir -p "$outbox" || return 1
  tmp=$(mktemp "$outbox/.new.XXXXXX") || return 1
  printf '%s\n%s\n%s\n' "$1" "$day $started" "$2" >"$tmp" # line 2: the run's day and start, to tell later runs' messages apart
  [ -n "${3:-}" ] && printf '%s\n' "$3" >>"$tmp"
  queued=$(( queued + 1 ))
  item="$outbox/$(date -u +%Y%m%dT%H%M%SZ)-$$-$(printf %04d "$queued")"
  mv "$tmp" "$item" && enqueued="$item"
}

drain() { # drain [mine]: deliver queued messages strictly oldest first. Returns 1 when `mine` (the caller's item) was
  # refused, 2 when the VPS stopped taking messages before it, and 0 otherwise.
  local item rc delay="$post_delay" t0 mark
  for item in "$outbox"/*; do
    [ -f "$item" ] || continue
    while :; do
      # Budget spent: leave everything queued for the next run rather than spend up to $ssh_limit more per message.
      if [ "$post_spent" -ge "$post_budget" ]; then echo "delivery budget spent; $(ls "$outbox" | grep -vc '^refused$') message(s) stay queued" >>"$log"; return 2; fi
      t0=$(date +%s)
      mark=""; [ "$(sed -n 2p "$item")" != "$day $started" ] && mark=delayed
      deliver "$item" $mark; rc=$?
      post_spent=$(( post_spent + $(date +%s) - t0 ))
      [ "$rc" -eq 255 ] || break
      if [ "$delay" -le 0 ] || [ $(( post_spent + delay )) -gt "$post_budget" ]; then
        echo "VPS unreachable; $(ls "$outbox" | grep -vc '^refused$') message(s) stay queued in $outbox" >>"$log"
        return 2
      fi
      echo "VPS unreachable; retrying in ${delay}s" >>"$log"
      sleep "$delay"; post_spent=$(( post_spent + delay ))
      delay=$(( delay * 2 > 300 ? 300 : delay * 2 ))
    done
    if [ "$rc" -eq 0 ]; then echo "delivered $(basename "$item")" >>"$log"; rm -f "$item"
    else
      mkdir -p "$outbox/refused"; mv "$item" "$outbox/refused/"; echo "message $(basename "$item") refused; kept in $outbox/refused" >>"$log"
      [ "$item" = "${1:-}" ] && return 1
    fi
  done
  return 0
}

send() { # send slack|ssh <remote command> [text]: queue the message, then drain; 1 only when this message was refused
  local rc
  enqueue "$@" || { echo "could not queue a message in $outbox" >>"$log"; return 0; }
  drain "$enqueued"; rc=$?
  [ "$rc" -eq 1 ] && return 1
  return 0
}

vps_alert() { # vps_alert raise|resolve [text]
  if [ "${INTAKE_NO_POST:-}" = 1 ]; then echo "no-post: alert $1 ${2:-}" >>"$log"; return 0; fi
  if [ "$1" = raise ]; then
    send ssh "~/.local/bin/alert raise $alert_key --title 'BA Eventos intake' --text-file /dev/stdin --workdir /home/hanif/projects/ba-events" "$2"
  else
    send ssh "~/.local/bin/alert resolve $alert_key" || true
  fi
}

fix_alert() { # raise pro/ba-events-intake/fixes with the fix list, or resolve it quietly; never fails the run.
  # A raise on a key that is still open only replies in its thread, so a changed list ("updated") queues triage again
  # with --auto, which respects triage's rate limits. The fingerprint hashes the sorted, trimmed items, so the same list
  # stays quiet across days and a change in any digit (a street number, an error code) still counts as a change.
  local key="$alert_key/fixes" text fp
  if [ -z "$(tr -d '[:space:]' <"$fixes" 2>/dev/null)" ]; then
    if [ "${INTAKE_NO_POST:-}" = 1 ]; then echo "no-post: alert resolve $key" >>"$log"; return 0; fi
    send ssh "~/.local/bin/alert resolve $key --quiet" || true
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
  send ssh "out=\$(~/.local/bin/alert raise $key --title 'BA Eventos intake fixes' --text-file /dev/stdin --workdir /home/hanif/projects/ba-events${fp:+ --fingerprint $fp}) && echo \"\$out\" && case \"\$out\" in *'\"action\": \"updated\"'*) ~/.local/bin/alert triage $key --auto ;; esac" "$text" ||
    echo "fix alert failed" >>"$log"
  return 0
}

slack_post() { # slack_post <file>: post the file's text to #ba-eventos as the Chipa bot; 1 only when Slack refused it
  if [ "${INTAKE_NO_POST:-}" = 1 ]; then echo "no-post: slack $(wc -c <"$1" | tr -d ' ') bytes" >>"$log"; return 0; fi
  send slack "$slack_cmd" "$(cat "$1")"
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

# Messages an earlier run couldn't deliver go first, oldest first; an interrupted run's half-written messages join them.
if [ "${INTAKE_NO_POST:-}" != 1 ]; then
  # Named by when they were written, so they take their place in the order.
  mkdir -p "$outbox"
  for tmp in "$outbox"/.new.* "$state"/runs/.send.*; do
    [ -f "$tmp" ] || continue
    if [ -s "$tmp" ]; then
      mv "$tmp" "$outbox/$(python3 -I -c 'import os,sys,time; print(time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(os.path.getmtime(sys.argv[1]))))' "$tmp")-replayed-$(basename "$tmp")"
    else rm -f "$tmp"; fi
  done
  drain
fi
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
