#!/usr/bin/env bash
# Checks I17-I19 of ../INVARIANTS.md with TLC.
#
#   ./run-liveness.sh          two tasks, the same size the safety run uses
#   ./run-liveness.sh --small  one task, which is the only size that finishes
#                              EveryBegunSettles in a usable time
#   ./run-liveness.sh --lasso  the suspend/resume experiment, one task: is the
#                              lasso a fairness defect or a missing hypothesis?
#   ./run-liveness.sh --arrival  I19 over a model where new work keeps arriving.
#                              Both rows are unsound; that is the finding.
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

if [[ ${1:-} == --arrival ]]; then
  echo "One task, ArrivalSpec: finished tickets recycle, so work keeps arriving."
  echo ""
  echo "Unconstrained, TLC gives no verdict -- every completed responsibility"
  echo "advances targetHead, so an endless arrival stream is an endless state"
  echo "space. Under CONSTRAINT both rows below come back clean, and the second"
  echo "one is WRONG: an endless arrival stream is a legitimate behaviour under"
  echo "which the run never goes quiet. The constraint truncates the recycling"
  echo "loop before it can close. This is the state-constraint-plus-liveness"
  echo "hazard TLC warns about, in the concrete."
  echo ""
  echo "| Property | hypothesis | TLC (constrained) |"
  echo "|---|---|---|"
  arrival() { # $1 property, $2 label
    cat > "$WORK/a.cfg" <<EOF
SPECIFICATION ArrivalSpec
CONSTANT MUTANT = 0
CONSTANT Tasks <- OneTask
CONSTRAINT StateConstraint
PROPERTY $1
EOF
    out=$(timeout "${TIMEOUT:-900}" java -XX:+UseParallelGC -cp "$TLA_TOOLS" tlc2.TLC \
          -config "$WORK/a.cfg" -metadir "$WORK/a$1" -workers auto DeliveryArrival 2>&1)
    if grep -q 'No error has been found' <<<"$out"; then v="holds"
    elif grep -q 'Temporal properties were violated' <<<"$out"; then v="violated"
    else v="**no verdict**"; fi
    echo "| $1 | $2 | $v |"
  }
  arrival ReachesQuiescenceUnderArrival "eventually sealed"
  arrival ReachesQuiescenceUnsealed "none -- should be false"
  exit 0
fi

if [[ ${1:-} == --lasso ]]; then
  echo "One task. Is the suspend/resume lasso a domain behaviour or a modelling"
  echo "artifact? docs/CONTEXT.md settles it: safe suspension preserves what is"
  echo "needed to resume, so progress survives the cycle. The lasso is an"
  echo "artifact of atomic work in this model, and per-action SF is the correct"
  echo "encoding of the preservation guarantee -- not a way to dodge the issue."
  echo ""
  echo "| Spec | Property | TLC |"
  echo "|---|---|---|"
  lasso() { # $1 spec, $2 property
    cat > "$WORK/l.cfg" <<EOF
SPECIFICATION $1
CONSTANT MUTANT = 0
CONSTANT Tasks <- OneTask
CONSTRAINT StateConstraint
PROPERTY $2
EOF
    out=$(timeout "${TIMEOUT:-600}" java -XX:+UseParallelGC -cp "$TLA_TOOLS" tlc2.TLC \
          -config "$WORK/l.cfg" -metadir "$WORK/l$2$1" -workers auto DeliveryLiveness 2>&1)
    if grep -q 'No error has been found' <<<"$out"; then v="holds"
    elif grep -q 'Temporal properties were violated' <<<"$out"; then v="**violated**"
    else v="error"; fi
    echo "| $1 | $2 | $v |"
  }
  lasso DisjunctionSpec EveryBegunSettles
  lasso DisjunctionSpec EveryBegunSettlesUninterrupted
  lasso LiveSpec EveryBegunSettles
  echo ""
  echo "Row 1 is the artifact: atomic work makes a preserved-progress cycle look"
  echo "like no progress. Row 2 shows assuming the operator away also removes it,"
  echo "at the cost of a hypothesis the domain does not need. Row 3 is the"
  echo "primary form: per-action SF on ReportAccepted abstracts preservation"
  echo "plus finite work plus fair scheduling, which is what the domain says."
  exit 0
fi

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
