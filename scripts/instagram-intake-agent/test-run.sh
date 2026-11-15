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
case "$*" in *"--exclude-tools "*'*schedule*'*) ;; *) echo "scheduler tools not excluded" >&2; exit 3 ;; esac
scenario=$(cat "$HOME/scenario")
echo "NOTHING TO REPORT" # stdout must never become the report
case "$INTAKE_PHASE" in
  review)
    [ "$scenario" = review-fails ] && { echo "[review] crashed" >>"$INTAKE_NOTES"; exit 1; }
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
      sentinel) echo "NOTHING TO REPORT" >"$INTAKE_REPORT" ;;
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
echo "${@: -1} <<< $input" >>"$HOME/ssh-calls"
case "$*" in *slack_api.py*) echo '{"ok": true, "ts": "1.2"}' ;; esac
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
  chmod +x "$t/.local/bin/"*
}

go() { # runs run.sh in the current temp HOME; sets $rc
  HOME="$t" INTAKE_CHECKOUT="$t/checkout" INTAKE_STATE="$t/state" INTAKE_BATCH=30 /bin/bash "$run" </dev/null >/dev/null 2>&1
  rc=$?
}

phases() { grep -o 'Automation run, [a-z]* phase' "$t/pi-calls" | awk '{print $3}' | tr '\n' ' '; }
alerted() { grep -q 'alert raise' "$t/ssh-calls" && grep -q "$1" "$t/ssh-calls"; }
posted() { grep -q 'slack_api.py' "$t/ssh-calls"; }
resolved() { grep -q 'alert resolve' "$t/ssh-calls"; }

echo "# backlog cleared over several batches"
setup 75 report; go
check "exit 0" [ "$rc" -eq 0 ]
check "collect, 3 reviews, venues, report" [ "$(phases)" = "collect review review review venues report " ]
check "backlog cleared" [ ! -s "$t/pending" ]
check "report posted, not stdout" posted
check "posted text is the report file" grep -q 'Run went fine' "$t/ssh-calls"
check "alert resolved" resolved
check "no alert raised" eval '! grep -q "alert raise" "$t/ssh-calls"'
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

echo "# a failed review still reports and alerts"
setup 40 review-fails; go
check "report still runs" [ "$(phases)" = "collect review venues report " ]
check "report posted" posted
check "alert names the phase" alerted 'review 1 (exited with code 1)'
check "no resolve" eval '! resolved'
check "exit 1" [ "$rc" -eq 1 ]
rm -rf "$t"

echo "# an empty report raises the alert"
setup 0 empty; go
check "no review when nothing pending" [ "$(phases)" = "collect venues report " ]
check "alert raised" alerted 'without a report'
check "nothing posted" eval '! posted'
check "exit 1" [ "$rc" -eq 1 ]
rm -rf "$t"

echo "# the sentinel posts nothing"
setup 10 sentinel; go
check "nothing posted" eval '! posted'
check "alert resolved" resolved
check "exit 0" [ "$rc" -eq 0 ]
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
  check "alert names $p" alerted "$p.*(no completion note)"
  check "no resolve" eval '! resolved'
  check "exit 1" [ "$rc" -eq 1 ]
  rm -rf "$t"
done

[ "$failures" -eq 0 ] && echo "all passed" || { echo "$failures failed"; exit 1; }
