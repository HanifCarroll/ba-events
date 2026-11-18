#!/bin/bash
# Tests run.sh without models, Apify, Slack, or alerts: stub pi, bun, ssh, caffeinate, and timeout go in
# $HOME/.local/bin of a temp HOME, which is first on run.sh's PATH. Works with bash 3.2 (the Pro's /bin/bash).
# Usage: bash scripts/instagram-intake-agent/test-run.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
run="$here/run.sh"
failures=0

check() { # check <description> <command...>
  if "${@:2}"; then echo "ok   $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi
}

setup() { # setup <pending> <scenario> [stuck]: fresh temp HOME with stubs. $HOME/pending lists observation IDs,
  # oldest first; the [stuck] oldest ones can't be finished (like images that failed to save).
  t=$(mktemp -d)
  mkdir -p "$t/.local/bin" "$t/checkout" "$t/state"
  : >"$t/pending"; i=0
  while [ "$i" -lt "${3:-0}" ]; do echo "stuck-$i" >>"$t/pending"; i=$((i + 1)); done
  i=0; while [ "$i" -lt "$1" ]; do echo "obs-$i" >>"$t/pending"; i=$((i + 1)); done
  echo "$2" >"$t/scenario"
  : >"$t/pi-calls"; : >"$t/ssh-calls"

  cat >"$t/.local/bin/pi" <<'EOF'
#!/bin/bash
echo "$*" >>"$HOME/pi-calls"
echo "$INTAKE_PHASE ${INTAKE_FIXES:-}" >>"$HOME/pi-env"
case "$*" in *"--exclude-tools "*'*schedule*'*) ;; *) echo "scheduler tools not excluded" >&2; exit 3 ;; esac
scenario=$(cat "$HOME/scenario")
echo "NOTHING TO REPORT" # stdout must never become the report
case "$INTAKE_PHASE" in
  review)
    case "$scenario" in *review-fails) echo "[review] crashed" >>"$INTAKE_NOTES"; exit 1 ;; esac
    if [ "$scenario" != stall ]; then
      taken=0; : >"$HOME/left"
      while read -r id; do
        if [ "$taken" -lt "$INTAKE_BATCH" ] && ! grep -qx "$id" "$INTAKE_DEFERRED"; then
          taken=$((taken + 1))
          case "$id" in stuck-*) echo "$id" >>"$INTAKE_DEFERRED"; echo "$id" >>"$HOME/left" ;; esac
        else echo "$id" >>"$HOME/left"; fi
      done <"$HOME/pending"
      mv "$HOME/left" "$HOME/pending"
      echo "[review] took $taken" >>"$INTAKE_NOTES"
    fi ;;
  report)
    echo "## Intake on test" >>"$INTAKE_MEMORY"
    case "$scenario" in
      empty) : >"$INTAKE_REPORT" ;;
      sentinel|sentinel-review-fails) echo "NOTHING TO REPORT" >"$INTAKE_REPORT" ;;
      fix-single) printf 'FIX: one tool needs a fix\n' >"$INTAKE_FIXES"; echo 'Run went fine.' >"$INTAKE_REPORT" ;;
      fixes-reordered)
        printf '  FIX: barrio of venue f98ce6e3 is Balvanera, Almagro per Nominatim\nFIX: venue rejects Gallo 238 with "geocodes outside the city ()"; blocks 3 events  \n' >"$INTAKE_FIXES"
        printf 'Run went fine.\n' >"$INTAKE_REPORT" ;;
      fixes-digit)
        printf 'FIX: venue rejects Gallo 239 with "geocodes outside the city ()"; blocks 3 events\nFIX: barrio of venue f98ce6e3 is Balvanera, Almagro per Nominatim\n' >"$INTAKE_FIXES"
        printf 'Run went fine.\n' >"$INTAKE_REPORT" ;;
      fixes*)
        printf 'FIX: venue rejects Gallo 238 with "geocodes outside the city ()"; blocks 3 events\n\nFIX: barrio of venue f98ce6e3 is Balvanera, Almagro per Nominatim\n' >"$INTAKE_FIXES"
        printf 'Run went fine.\n' >"$INTAKE_REPORT" ;;
      *) printf 'Run went fine.\n- notes: %s\n' "$(grep -c . "$INTAKE_NOTES")" >"$INTAKE_REPORT" ;;
    esac ;;
esac
# Every phase but report confirms it finished, unless this scenario's phase stops early.
[ "$INTAKE_PHASE" = report ] || [ "$scenario" = "no-done-$INTAKE_PHASE" ] || echo "$INTAKE_PHASE done" >"$INTAKE_DONE"
exit 0
EOF
  cat >"$t/.local/bin/bun" <<'EOF'
#!/bin/bash
[ "$*" = "run instagram:intake pending" ] || { echo "unexpected bun $*" >&2; exit 2; }
[ "$(cat "$HOME/scenario")" = count-fails ] && { echo "db down" >&2; exit 1; }
printf '['; sep=''
while read -r id; do printf '%s{"id":"%s"}' "$sep" "$id"; sep=','; done <"$HOME/pending"
echo ']'
EOF
  cat >"$t/.local/bin/ssh" <<'EOF'
#!/bin/bash
input=$(cat)
if [ -f "$HOME/vps-down" ] || { [ -f "$HOME/vps-down-for" ] && case "${@: -1}" in *"$(cat "$HOME/vps-down-for")"*) true ;; *) false ;; esac; }; then
  echo "x" >>"$HOME/ssh-failed"; echo "ssh: connect to host hetzner port 22: Operation timed out" >&2; exit 255
fi
if [ -f "$HOME/ssh-sleep" ] && [ ! -f "$HOME/ssh-slept" ]; then touch "$HOME/ssh-slept"; sleep "$(cat "$HOME/ssh-sleep")"; fi
echo "${@: -1} <<< $input" >>"$HOME/ssh-calls"
case "$*" in *slack_api.py*) echo '{"ok": true, "ts": "1.2"}' ;; esac
case "$*" in *"alert raise"*) echo '{"action": "opened"}' ;; esac
exit 0
EOF
  cat >"$t/.local/bin/caffeinate" <<'EOF'
#!/bin/bash
[ "$1" = -i ] && shift
exec "$@"
EOF
  cat >"$t/.local/bin/timeout" <<'EOF'
#!/bin/bash
shift 2 # --kill-after=120 <limit>
exec "$@"
EOF
  cat >"$t/.local/bin/date" <<'EOF'
#!/bin/bash
if [ "$*" = '+%H:%M' ] && [ "${TZ:-}" = America/Argentina/Buenos_Aires ]; then echo 14:07; else exec /bin/date "$@"; fi
EOF
  chmod +x "$t/.local/bin/"*
}

go() { # runs run.sh in the current temp HOME; sets $rc
  HOME="$t" INTAKE_CHECKOUT="$t/checkout" INTAKE_STATE="$t/state" INTAKE_BATCH=30 /bin/bash "$run" </dev/null >/dev/null 2>&1
  rc=$?
}

phases() { grep -o 'Automation run, [a-z]* phase' "$t/pi-calls" | awk '{print $3}' | tr '\n' ' '; }
# The failure key is pro/ba-events-intake; the fix list's key is pro/ba-events-intake/fixes.
alerted() { grep -q 'alert raise pro/ba-events-intake ' "$t/ssh-calls" && grep -q "$1" "$t/ssh-calls"; }
posted() { grep -q 'slack_api.py' "$t/ssh-calls"; }
resolved() { grep -q 'alert resolve pro/ba-events-intake <<<' "$t/ssh-calls"; }
fixes_raised() { grep -q "alert raise pro/ba-events-intake/fixes --title 'BA Eventos intake fixes'" "$t/ssh-calls"; }
fixes_resolved_quietly() { grep -q 'alert resolve pro/ba-events-intake/fixes --quiet' "$t/ssh-calls"; }

echo "# backlog cleared over several batches"
setup 75 report; go
check "exit 0" [ "$rc" -eq 0 ]
check "collect, 3 reviews, venues, report" [ "$(phases)" = "collect review review review venues report " ]
check "backlog cleared" [ ! -s "$t/pending" ]
check "report posted, not stdout" posted
check "posted text is the report file" grep -q 'Run went fine' "$t/ssh-calls"
check "alert resolved" resolved
check "no alert raised" eval '! grep -q "alert raise" "$t/ssh-calls"'
check "no fixes: fixes key resolved quietly" fixes_resolved_quietly
check "log has pending counts" grep -q '^pending 0 deferred 0$' "$t"/state/runs/*.log
check "every pi call excludes the scheduler tools" [ "$(grep -c -- "--exclude-tools .*\*schedule\*" "$t/pi-calls")" -eq "$(wc -l <"$t/pi-calls")" ]
check "memory appended once" [ "$(grep -c '^## Intake on' "$t/state/memory.md")" -eq 1 ]
rm -rf "$t"

echo "# a batch without progress stops the loop"
setup 40 stall; go
check "one review, then venues and report" [ "$(phases)" = "collect review venues report " ]
check "stop is noted" grep -q 'left 40 observations pending' "$t"/state/runs/*.notes.md
check "backlog is noted for the report" grep -q 'After review: 40 observations pending and not deferred, 0 deferred, in 1 batches' "$t"/state/runs/*.notes.md
check "a batch that took nothing still exits 0 with its note" [ "$rc" -eq 0 ]
rm -rf "$t"

echo "# missing checkout tells Hanif the run didn't start"
setup 0 report; rmdir "$t/checkout"; go
check "exit 1" [ "$rc" -eq 1 ]
check "missing-checkout headline" alerted "🚨 \\*BA Eventos intake didn't run\\* at 14:07: its checkout is missing on the Pro\\. {triage}$"
check "checkout path last" grep -Fxq "$t/checkout" "$t/ssh-calls"
rm -rf "$t"

echo "# a failed review still reports and alerts"
setup 40 review-fails; go
check "report still runs" [ "$(phases)" = "collect review venues report " ]
check "report posted" posted
check "failed-step headline" alerted '⚠️ \*BA Eventos intake had a failed step\*: reviewing posts\. {triage}$'
check "raw phase and log path last" grep -q '^review 1 (exited with code 1) · log .* on the Pro$' "$t/ssh-calls"
check "no resolve" eval '! resolved'
check "exit 1" [ "$rc" -eq 1 ]
rm -rf "$t"

echo "# an empty report raises the alert"
setup 0 empty; go
check "no review when nothing pending" [ "$(phases)" = "collect venues report " ]
check "missing-report headline" alerted '🚨 \*BA Eventos intake ended without a report\* at 14:07\. {triage}$'
check "log path last" grep -q '^log .* on the Pro$' "$t/ssh-calls"
check "nothing posted" eval '! posted'
check "exit 1" [ "$rc" -eq 1 ]
rm -rf "$t"

echo "# the sentinel posts nothing"
setup 10 sentinel; go
check "nothing posted" eval '! posted'
check "alert resolved" resolved
check "exit 0" [ "$rc" -eq 0 ]
rm -rf "$t"

echo "# a failed step with the sentinel does not claim a report was posted"
setup 10 sentinel-review-fails; go
check "no Slack report" eval '! posted'
check "headline still names reviewing" alerted '⚠️ \*BA Eventos intake had a failed step\*: reviewing posts\. {triage}$'
check "no updates, with retry guidance" grep -Fxq "It had no updates to post. Posts it didn't finish stay pending, and tomorrow's 09:00 run picks them up." "$t/ssh-calls"
rm -rf "$t"

echo "# a failed pending count is a failure, not zero"
setup 10 count-fails; go
check "no review, still venues and report" [ "$(phases)" = "collect venues report " ]
check "alert names the count" alerted 'pending count'
check "exit 1" [ "$rc" -eq 1 ]
rm -rf "$t"

echo "# the batch cap stops the loop"
setup 500 report; HOME="$t" INTAKE_CHECKOUT="$t/checkout" INTAKE_STATE="$t/state" INTAKE_BATCH=30 INTAKE_MAX_BATCHES=2 /bin/bash "$run" </dev/null >/dev/null 2>&1
check "two reviews" [ "$(phases)" = "collect review review venues report " ]
check "cap is noted" grep -q '2-batch cap with 440' "$t"/state/runs/*.notes.md
rm -rf "$t"

echo "# no time left for review"
setup 50 report; HOME="$t" INTAKE_CHECKOUT="$t/checkout" INTAKE_STATE="$t/state" INTAKE_TOTAL_MINUTES=60 /bin/bash "$run" </dev/null >/dev/null 2>&1
check "no review when time is short" [ "$(phases)" = "collect venues report " ]
rm -rf "$t"

echo "# stuck observations are deferred, and later batches review newer ones"
setup 50 report 35; go
check "batches 1 and 2 defer the 35 stuck ones, then 2 and 3 clear the rest" [ "$(phases)" = "collect review review review venues report " ]
check "only stuck observations remain" eval '[ "$(grep -c . "$t/pending")" -eq 35 ] && ! grep -q obs- "$t/pending"'
check "each stuck one deferred once" eval '[ "$(sort -u "$t"/state/runs/*.deferred | grep -c .)" -eq 35 ] && [ "$(grep -c . "$t"/state/runs/*.deferred)" -eq 35 ]'
check "deferrals noted for the report" grep -q '35 observations were deferred' "$t"/state/runs/*.notes.md
check "no alert, resolved" eval '! grep -q "alert raise" "$t/ssh-calls" && resolved'
check "exit 0" [ "$rc" -eq 0 ]
rm -rf "$t"

echo "# a new run starts with an empty deferral file"
setup 0 report 5
mkdir -p "$t/state/runs"; for i in 0 1 2 3 4; do echo "stuck-$i"; done >"$t/state/runs/$(TZ=America/Argentina/Buenos_Aires date +%F).deferred"
go
check "stuck observations get a fresh attempt" [ "$(phases)" = "collect review venues report " ]
rm -rf "$t"

for p in collect review venues; do
  echo "# $p exits 0 without its completion note"
  setup 10 "no-done-$p"; go
  check "report still posted" posted
  case "$p" in collect) label='collecting posts' ;; review) label='reviewing posts' ;; venues) label='the held-venue step' ;; esac
  check "headline names $p in plain words" alerted "failed step\\*: $label\\. {triage}$"
  check "alert keeps the raw reason" alerted "$p.*(no completion note)"
  check "no resolve" eval '! resolved'
  check "exit 1" [ "$rc" -eq 1 ]
  rm -rf "$t"
done

echo "# fixes for Hermes raise their own key and leave the failure key alone"
setup 10 fixes; go
check "exit 0" [ "$rc" -eq 0 ]
check "report posted" posted
check "fixes key raised" fixes_raised
check "alert lists both items as bullets" eval 'grep -q "^• FIX: venue rejects Gallo 238" "$t/ssh-calls" && grep -q "^• FIX: barrio of venue f98ce6e3" "$t/ssh-calls"'
check "blank lines dropped" eval '! grep -q "^• *$" "$t/ssh-calls"'
check "fix-list headline" grep -q '⚠️ \*BA Eventos intake queued 2 fixes for Hermes\*\. {triage}$' "$t/ssh-calls"
check "fixes file is last" grep -q '^Fixes file: .*fixes.md on the Pro$' "$t/ssh-calls"
check "every phase gets INTAKE_FIXES" [ "$(grep -c ' /.*/runs/.*\.fixes\.md$' "$t/pi-env")" -eq 4 ]
check "failure key not raised, and resolved" eval '! alerted . && resolved'
check "fixes key not resolved" eval '! fixes_resolved_quietly'
check "fingerprint passed, and re-triage uses --auto" eval 'grep -q -- "--fingerprint [0-9a-f]\{16\})" "$t/ssh-calls" && grep -q "alert triage pro/ba-events-intake/fixes --auto" "$t/ssh-calls"'
fp1=$(grep -o -- '--fingerprint [0-9a-f]*' "$t/ssh-calls")
rm -rf "$t"

echo "# a single fix uses the singular"
setup 0 fix-single; go
check "single-fix headline" grep -q '⚠️ \*BA Eventos intake queued 1 fix for Hermes\*\. {triage}$' "$t/ssh-calls"
check "singular explanation" grep -Fxq "It's a tool bug or a catalog fact it couldn't change itself, and the events it blocks stay held until it's fixed." "$t/ssh-calls"
rm -rf "$t"

echo "# the fingerprint follows the items: same list in another order matches, a changed digit doesn't"
setup 10 fixes-reordered; go
check "same items reordered, with stray spaces: same fingerprint" [ "$(grep -o -- '--fingerprint [0-9a-f]*' "$t/ssh-calls")" = "$fp1" ]
rm -rf "$t"
setup 10 fixes-digit; go
check "one digit changed: new fingerprint" eval '[ -n "$(grep -o -- "--fingerprint [0-9a-f]*" "$t/ssh-calls")" ] && [ "$(grep -o -- "--fingerprint [0-9a-f]*" "$t/ssh-calls")" != "$fp1" ]'
rm -rf "$t"

echo "# an earlier run's fixes file is cleared, so a run with none resolves the key"
setup 0 report
mkdir -p "$t/state/runs"; echo "FIX: stale" >"$t/state/runs/$(TZ=America/Argentina/Buenos_Aires date +%F).fixes.md"
go
check "fixes key resolved quietly" fixes_resolved_quietly
check "fixes key not raised" eval '! fixes_raised'
rm -rf "$t"

echo "# fixes plus a failed phase: both keys, exit 1"
setup 10 fixes-review-fails; go
check "fixes key raised" fixes_raised
check "failure key names the phase" alerted 'review 1 (exited with code 1)'
check "failure key not resolved" eval '! resolved'
check "exit 1" [ "$rc" -eq 1 ]
rm -rf "$t"

echo "# no report: the fixes key is left alone"
setup 0 empty; go
check "failure key raised" alerted 'without a report'
check "fixes key untouched" eval '! grep -q "pro/ba-events-intake/fixes" "$t/ssh-calls"'
rm -rf "$t"

echo "# INTAKE_NO_POST logs the fixes alert instead of sending it"
setup 0 fixes; HOME="$t" INTAKE_CHECKOUT="$t/checkout" INTAKE_STATE="$t/state" INTAKE_NO_POST=1 /bin/bash "$run" </dev/null >/dev/null 2>&1
check "no ssh at all" [ ! -s "$t/ssh-calls" ]
check "log has the fixes alert" grep -q 'no-post: alert raise pro/ba-events-intake/fixes' "$t"/state/runs/*.log
rm -rf "$t"

echo "# an unreachable VPS: retries with backoff, then queues; the next run delivers oldest first, marked delayed"
setup 10 report; touch "$t/vps-down"
HOME="$t" INTAKE_CHECKOUT="$t/checkout" INTAKE_STATE="$t/state" INTAKE_POST_BACKOFF_SECONDS=1 INTAKE_POST_BUDGET_SECONDS=3 /bin/bash "$run" </dev/null >/dev/null 2>&1; rc=$?
check "posting problems don't fail the run" [ "$rc" -eq 0 ]
check "retried with backoff, then stopped at the budget" eval 'grep -q "retrying in 1s" "$t"/state/runs/*.log && ! grep -q "retrying in 4s" "$t"/state/runs/*.log && grep -q "delivery budget spent\|stay queued" "$t"/state/runs/*.log'
check "report, delivery alert, and fixes resolve queued; nothing delivered" eval '[ "$(ls "$t/state/outbox" | grep -c .)" -eq 3 ] && [ ! -s "$t/ssh-calls" ]'
check "queued report is the report file" eval 'grep -l "^slack$" "$t"/state/outbox/* | xargs grep -q "Run went fine"'
rm -f "$t/vps-down"; : >"$t/pending"; echo sentinel >"$t/scenario"
go
check "second run exits 0" [ "$rc" -eq 0 ]
check "queued report delivered first, marked delayed with its run" eval 'head -1 "$t/ssh-calls" | grep -q "slack_api.py.*Delayed: this is from the BA Eventos intake run of $(TZ=America/Argentina/Buenos_Aires date +%F).*Run went fine"'
check "queued alert keeps its headline on line one" eval 'grep "^~/.local/bin/alert raise pro/ba-events-intake " "$t/ssh-calls" | grep -q "<<< ⚠️ .*its report didn.t reach #ba-eventos.*{triage}$"'
check "queued message names the next attempt, not a refusal" grep -Fxq 'The run finished. It saved the report to send at the next 09:00 run.' "$t/ssh-calls"
check "delay notice stays on the last line" grep -Eq '^report .* on the Pro · Delayed from the .* intake run\.$' "$t/ssh-calls"
check "clean run clears the replayed alert" eval '[ "$(grep -c "alert resolve pro/ba-events-intake <<<" "$t/ssh-calls")" -eq 1 ] && grep -q "alert resolve pro/ba-events-intake <<<" "$t/ssh-calls"'
check "outbox empty" eval '[ -z "$(ls -A "$t/state/outbox" 2>/dev/null)" ]'
rm -rf "$t"

echo "# a message still undeliverable at the next start stays queued"
setup 0 sentinel; mkdir -p "$t/state/outbox"; printf 'slack\n2026-11-16\ncmd slack_api.py\nOld report\n' >"$t/state/outbox/20261116T120000Z-0001"; touch "$t/vps-down"
HOME="$t" INTAKE_CHECKOUT="$t/checkout" INTAKE_STATE="$t/state" INTAKE_POST_BACKOFF_SECONDS=0 /bin/bash "$run" </dev/null >/dev/null 2>&1; rc=$?
check "exit 0" [ "$rc" -eq 0 ]
check "old message still queued, and this run's messages queued behind it" eval '[ "$(ls "$t/state/outbox" | head -1)" = 20261116T120000Z-0001 ] && [ "$(ls "$t/state/outbox" | grep -c .)" -eq 3 ]'
rm -f "$t/vps-down"; go
check "delivered later with its own run date" eval 'head -1 "$t/ssh-calls" | grep -q "run of 2026-11-16.*Old report"'
rm -rf "$t"

echo "# a refused report is not retried or queued, and still fails the run"
setup 10 report
sed -i.bak 's/echo .{"ok": true, "ts": "1.2"}./echo "{\"ok\": false, \"error\": \"channel_not_found\"}"/' "$t/.local/bin/ssh"
go
check "exit 1 with the post alert" eval '[ "$rc" -eq 1 ] && alerted "report didn.t reach #ba-eventos"'
check "undelivered-report headline" alerted '⚠️ \*BA Eventos intake ran, but its report didn.t reach #ba-eventos\*\. {triage}$'
check "refusal does not promise retry" grep -Fxq "The run finished, but Slack refused the report, so it won't go out by itself." "$t/ssh-calls"
check "nothing left to send; the refusal is kept in refused/" eval '[ -z "$(ls "$t/state/outbox" | grep -v "^refused$")" ] && [ "$(ls "$t/state/outbox/refused" | grep -c .)" -eq 1 ]'
rm -rf "$t"

echo "# an older raise waits for the VPS, and a newer resolve never overtakes it"
setup 10 report; echo "alert raise pro/ba-events-intake " >"$t/vps-down-for"
mkdir -p "$t/state/outbox"; printf "ssh\n2026-11-16 1\n~/.local/bin/alert raise pro/ba-events-intake --title x\nOld failure\n" >"$t/state/outbox/20261116T120000Z-1-0001"
HOME="$t" INTAKE_CHECKOUT="$t/checkout" INTAKE_STATE="$t/state" INTAKE_POST_BACKOFF_SECONDS=0 /bin/bash "$run" </dev/null >/dev/null 2>&1; rc=$?
check "exit 0" [ "$rc" -eq 0 ]
check "nothing sent while the old raise waits" [ ! -s "$t/ssh-calls" ]
check "old raise first, then this run's report and resolves" eval '[ "$(ls "$t/state/outbox" | head -1)" = 20261116T120000Z-1-0001 ] && [ "$(ls "$t/state/outbox" | grep -c .)" -eq 4 ]'
rm -f "$t/vps-down-for"; : >"$t/pending"; echo sentinel >"$t/scenario"; go
check "the raise is delivered before any resolve" eval 'head -1 "$t/ssh-calls" | grep -q "alert raise pro/ba-events-intake .*Old failure.*Delayed" && [ "$(grep -n "alert resolve pro/ba-events-intake <<<" "$t/ssh-calls" | head -1 | cut -d: -f1)" -gt 1 ]'
check "outbox drained" eval '[ -z "$(ls -A "$t/state/outbox" 2>/dev/null)" ]'
rm -rf "$t"

echo "# a stalled ssh is cut off and retried within the budget"
setup 0 sentinel; echo 30 >"$t/ssh-sleep"
start=$(date +%s)
HOME="$t" INTAKE_CHECKOUT="$t/checkout" INTAKE_STATE="$t/state" INTAKE_SSH_SECONDS=2 INTAKE_POST_BACKOFF_SECONDS=1 /bin/bash "$run" </dev/null >/dev/null 2>&1; rc=$?
check "exit 0, well before the stalled ssh would end" eval '[ "$rc" -eq 0 ] && [ $(( $(date +%s) - start )) -lt 20 ]'
check "cut off, retried, and delivered" eval 'grep -q "ssh cut off after 2s" "$t"/state/runs/*.log && grep -q "retrying in 1s" "$t"/state/runs/*.log && grep -q "alert resolve pro/ba-events-intake <<<" "$t/ssh-calls"'
check "nothing left queued" eval '[ -z "$(ls -A "$t/state/outbox" 2>/dev/null)" ]'
rm -rf "$t"

echo "# the budget counts attempt time, not only sleeps"
setup 0 sentinel; echo 30 >"$t/ssh-sleep"
HOME="$t" INTAKE_CHECKOUT="$t/checkout" INTAKE_STATE="$t/state" INTAKE_SSH_SECONDS=3 INTAKE_POST_BACKOFF_SECONDS=1 INTAKE_POST_BUDGET_SECONDS=3 /bin/bash "$run" </dev/null >/dev/null 2>&1
check "no retry once the cut-off attempt used the budget" eval '! grep -q "retrying in" "$t"/state/runs/*.log && [ "$(ls "$t/state/outbox" | grep -c .)" -ge 1 ]'
rm -rf "$t"

echo "# an interrupted run's unsent message is replayed at the next start, in order"
setup 0 sentinel; mkdir -p "$t/state/runs"
printf "slack\n2026-11-16\ncmd slack_api.py\nInterrupted report\n" >"$t/state/runs/.send.abc123"; touch -t 202611161200 "$t/state/runs/.send.abc123"
go
check "replayed first, marked delayed" eval 'head -1 "$t/ssh-calls" | grep -q "slack_api.py.*Delayed: this is from the BA Eventos intake run of 2026-11-16.*Interrupted report"'
check "no leftover file" eval '! ls "$t"/state/runs/.send.* >/dev/null 2>&1'
rm -rf "$t"

[ "$failures" -eq 0 ] && echo "all passed" || { echo "$failures failed"; exit 1; }
