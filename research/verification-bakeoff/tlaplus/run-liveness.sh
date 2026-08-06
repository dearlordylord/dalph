#!/usr/bin/env bash
# Checks I17-I19 of ../INVARIANTS.md with TLC.
#
#   ./run-liveness.sh          two tasks, the same size the safety run uses
#   ./run-liveness.sh --small  one task, which is the only size that finishes
#                              EveryBegunSettles in a usable time
#
# Liveness is a different cost class from safety here, which is the point of
# keeping this separate from ./run.sh. Same model, same size, same machine:
# safety is seconds, EveryBegunSettles at two tasks is not.
#
# TIMEOUT bounds each property. A `timeout` verdict is a real result and is
# reported as one rather than retried at a larger budget.
set -uo pipefail

cd "$(dirname "$0")"

TLA_TOOLS=${TLA_TOOLS:-$HOME/.cache/dalph-bakeoff/tla2tools.jar}
if [[ ! -f $TLA_TOOLS ]]; then
  mkdir -p "$(dirname "$TLA_TOOLS")"
  curl -sSL -o "$TLA_TOOLS" \
    https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar
fi

TIMEOUT=${TIMEOUT:-1800}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

SIZE_LINE=""
LABEL="2 tasks"
if [[ ${1:-} == --small ]]; then
  SIZE_LINE="CONSTANT Tasks <- OneTask"
  LABEL="1 task"
fi

echo "Liveness, $LABEL, ${TIMEOUT}s budget per property."
echo ""
echo "| Property | TLC | states | s |"
echo "|---|---|---|---|"

for P in PauseDrainsPositions EveryBegunSettles ReachesQuiescence; do
  cat > "$WORK/$P.cfg" <<EOF
SPECIFICATION LiveSpec
CONSTANT MUTANT = 0
$SIZE_LINE
CONSTRAINT StateConstraint
PROPERTY $P
EOF
  start=$SECONDS
  out=$(timeout "$TIMEOUT" java -XX:+UseParallelGC -cp "$TLA_TOOLS" tlc2.TLC \
        -config "$WORK/$P.cfg" -metadir "$WORK/s$P" -workers auto \
        DeliveryLiveness 2>&1)
  code=$?
  secs=$((SECONDS - start))
  states=$(grep -oE '[0-9]+ distinct states found' <<<"$out" | tail -1 | grep -oE '^[0-9]+')

  if [[ $code == 124 ]]; then
    verdict="**no verdict in ${TIMEOUT}s**"
  elif grep -q 'No error has been found' <<<"$out"; then
    verdict="holds"
  elif grep -q 'Temporal properties were violated' <<<"$out"; then
    verdict="**violated**"
  else
    verdict="error: $(grep -m1 -E '^Error' <<<"$out")"
  fi
  echo "| $P | $verdict | ${states:--} | $secs |"
done
