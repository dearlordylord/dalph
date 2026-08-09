#!/usr/bin/env bash
# #199: exact three-task Alloy measurements. Every command has its own budget;
# timeout is printed as no verdict and is never converted to a pass.
set -uo pipefail

cd "$(dirname "$0")"

ALLOY_JAR=${ALLOY_JAR:-$HOME/.cache/dalph-bakeoff/alloy.jar}
SPEC=DeliveryThree.als
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FAIL=0

run_command() { # name timeout expected-result-or-empty spec-or-default
  local name=$1 budget=$2 expected=${3:-} spec=${4:-$SPEC} start=$SECONDS output code summary
  output=$(timeout "$budget" java -jar "$ALLOY_JAR" exec -f -t none \
    -o "$WORK/$name" -c "$name" "$spec" 2>&1 1>/dev/null)
  code=$?
  if [[ $code == 124 ]]; then
    summary="no verdict in ${budget}s"
  else
    summary=$(grep -E '(SAT|UNSAT)$' <<<"$output" | tail -1 | grep -oE '(UNSAT|SAT)$')
    summary=${summary:-"no verdict: Alloy emitted no result"}
  fi
  if [[ -n $expected && $summary != "$expected" ]]; then FAIL=1; fi
  echo "| $name | $summary | $((SECONDS - start)) |"
}

echo "| Command | Alloy | s |"
echo "|---|---|---|"
run_command strengthenedInvIsInductiveThree 30 UNSAT DeliveryThreeStrengthened.als
run_command reversedRankMutationBreaksStrengthening 30 SAT DeliveryThreeStrengthened.als
run_command failureLeakMutationBreaksStrengthening 30 SAT DeliveryThreeStrengthened.als
run_command invAlwaysHoldsThree 60
run_command pauseDrainsPositionsThree 30
run_command everyBegunSettlesThree 30
run_command reachesQuiescenceThree 30
run_command threeTaskFairTraceExists 30

exit "$FAIL"
