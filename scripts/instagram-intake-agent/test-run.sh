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

setup() { # setup <pending> <scenario>: fresh temp HOME with stubs
  t=$(mktemp -d)
  mkdir -p "$t/.local/bin" "$t/checkout" "$t/state"
  echo "$1" >"$t/pending"
  echo "$2" >"$t/scenario"
  : >"$t/pi-calls"; : >"$t/ssh-calls"

  cat >"$t/.local/bin/pi" <<'EOF'
#!/bin/bash
echo "$*" >>"$HOME/pi-calls"
case "$*" in *"--exclude-tools "*'*schedule*'*) ;; *) echo "scheduler tools not excluded" >&2; exit 3 ;; esac
scenario=$(cat "$HOME/scenario"); n=$(cat "$HOME/pending")
echo "NOTHING TO REPORT" # stdout must never become the report
case "$INTAKE_PHASE" in
  review)
    [ "$scenario" = review-fails ] && { echo "[review] crashed" >>"$INTAKE_NOTES"; exit 1; }
    [ "$scenario" = stall ] && exit 0
    take=$INTAKE_BATCH; [ "$take" -gt "$n" ] && take=$n
    echo $((n - take)) >"$HOME/pending"
    echo "[review] reviewed $take" >>"$INTAKE_NOTES" ;;
  report)
    echo "## Intake on test" >>"$INTAKE_MEMORY"
    case "$scenario" in
      empty) : >"$INTAKE_REPORT" ;;
      sentinel) echo "NOTHING TO REPORT" >"$INTAKE_REPORT" ;;
      *) printf 'Run went fine.\n- notes: %s\n' "$(grep -c . "$INTAKE_NOTES")" >"$INTAKE_REPORT" ;;
    esac ;;
esac
exit 0
EOF
  cat >"$t/.local/bin/bun" <<'EOF'
#!/bin/bash
[ "$*" = "run instagram:intake pending" ] || { echo "unexpected bun $*" >&2; exit 2; }
[ "$(cat "$HOME/scenario")" = count-fails ] && { echo "db down" >&2; exit 1; }
n=$(cat "$HOME/pending"); printf '['; i=0
while [ "$i" -lt "$n" ]; do [ "$i" -gt 0 ] && printf ','; printf '{"id":"%s"}' "$i"; i=$((i + 1)); done
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
check "backlog cleared" [ "$(cat "$t/pending")" -eq 0 ]
check "report posted, not stdout" posted
check "posted text is the report file" grep -q 'Run went fine' "$t/ssh-calls"
check "alert resolved" resolved
check "no alert raised" eval '! grep -q "alert raise" "$t/ssh-calls"'
check "log has pending counts" grep -q '^pending 0$' "$t"/state/runs/*.log
check "every pi call excludes the scheduler tools" [ "$(grep -c -- "--exclude-tools .*\*schedule\*" "$t/pi-calls")" -eq "$(wc -l <"$t/pi-calls")" ]
check "memory appended once" [ "$(grep -c '^## Intake on' "$t/state/memory.md")" -eq 1 ]
rm -rf "$t"

echo "# a batch without progress stops the loop"
setup 40 stall; go
check "one review, then venues and report" [ "$(phases)" = "collect review venues report " ]
check "stop is noted" grep -q 'left the pending count at 40' "$t"/state/runs/*.notes.md
check "exit 0" [ "$rc" -eq 0 ]
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

[ "$failures" -eq 0 ] && echo "all passed" || { echo "$failures failed"; exit 1; }
