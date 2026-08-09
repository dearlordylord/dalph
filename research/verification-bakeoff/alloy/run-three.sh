#!/usr/bin/env bash
# #199: exact three-task Alloy measurements. Every command has its own budget;
# pass `--induction` to run only the complete symbolic induction and its two
# directed controls.
# timeout is printed as no verdict and fails by default. Set
# ALLOW_NO_VERDICT=1 only when intentionally recording bounded measurements;
# that explicit opt-in means the exit status describes measurement completion,
# not proof success.
set -uo pipefail

cd "$(dirname "$0")"

ALLOY_JAR=${ALLOY_JAR:-$HOME/.cache/dalph-bakeoff/alloy.jar}
JAVA=${JAVA:-java}
SPEC=DeliveryThree.als
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FAIL=0
ALLOW_NO_VERDICT=${ALLOW_NO_VERDICT:-0}

run_command() { # name timeout expected-result-or-empty spec-or-default
  local name=$1 budget=$2 expected=${3:-} spec=${4:-$SPEC} start=$SECONDS output code summary
  output=$(timeout "$budget" "$JAVA" -jar "$ALLOY_JAR" exec -f -t none \
    -o "$WORK/$name" -c "$name" "$spec" 2>&1 1>/dev/null)
  code=$?
  if [[ $code == 124 ]]; then
    summary="no verdict in ${budget}s"
  elif [[ $code != 0 ]]; then
    summary="no verdict: Alloy exited $code"
  else
    summary=$(grep -E '(SAT|UNSAT)$' <<<"$output" | tail -1 | grep -oE '(UNSAT|SAT)$')
    summary=${summary:-"no verdict: Alloy emitted no result"}
  fi
  if [[ $summary == no\ verdict* && $ALLOW_NO_VERDICT != 1 ]]; then FAIL=1; fi
  if [[ -n $expected && $summary != "$expected" ]]; then FAIL=1; fi
  echo "| $name | $summary | $((SECONDS - start)) |"
}

echo "| Command | Alloy | s |"
echo "|---|---|---|"
run_command strengthenedInvIsInductiveThree 30 UNSAT DeliveryThreeStrengthened.als
run_command reversedRankMutationBreaksStrengthening 30 SAT DeliveryThreeStrengthened.als
run_command failureLeakMutationBreaksStrengthening 30 SAT DeliveryThreeStrengthened.als
if [[ ${1:-} == --induction ]]; then exit "$FAIL"; fi
run_command invAlwaysHoldsThree 60 UNSAT
run_command pauseDrainsPositionsThree 30 UNSAT
run_command everyBegunSettlesThree 30 UNSAT
run_command reachesQuiescenceThree 30 UNSAT
run_command threeTaskFairTraceExists 30 SAT

exit "$FAIL"
