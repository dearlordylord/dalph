#!/usr/bin/env bash
# Runs every mutant of ../MUTANTS.md through TLC's exhaustive breadth-first
# state enumeration, and prints one markdown row per mutant.
#
#   ./run.sh          check invariants
#   ./run.sh --witness  refute the witnesses instead, as the vacuity check
#
# Needs tla2tools.jar. Set TLA_TOOLS, or let this fetch it into ~/.cache.
set -uo pipefail

cd "$(dirname "$0")"

TLA_TOOLS=${TLA_TOOLS:-$HOME/.cache/dalph-bakeoff/tla2tools.jar}
if [[ ! -f $TLA_TOOLS ]]; then
  mkdir -p "$(dirname "$TLA_TOOLS")"
  curl -sSL -o "$TLA_TOOLS" \
    https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

emit_cfg() { # $1 mutant, $2 property block
  cat > "$WORK/M$1.cfg" <<EOF
SPECIFICATION Spec
CONSTANT MUTANT = $1
CONSTRAINT StateConstraint
$2
EOF
}

# Listed individually rather than as AllInvariants, so TLC names the exact one.
INVARIANT_BLOCK='INVARIANT TypeOK
INVARIANT BoundRespected
INVARIANT RetentionHolds
INVARIANT SettlementDropped
INVARIANT PositionDiscipline
INVARIANT AdmissionRule
INVARIANT OneAttemptPerTask
INVARIANT TargetResourceExclusive
INVARIANT PromotionUsedExactHead
INVARIANT ProcessLocalLostOnCrash'
WITNESS_BLOCK='INVARIANT NoSettledReached
INVARIANT NoStaleHeadReached'

if [[ ${1:-} == --witness ]]; then
  BLOCK=$WITNESS_BLOCK
  echo "Refuting witnesses: a reported violation means the state IS reachable."
  echo ""
  echo "| Mutant | witness refuted | states | s |"
elif [[ ${1:-} == --m8 ]]; then
  BLOCK='INVARIANT CeilingOverHeldPositions'
  echo "M8: I8 replaced by the seeded specification error. A violation on M0"
  echo "means the specification is wrong, not the model."
  echo ""
  echo "| Mutant | TLC | states | s |"
else
  BLOCK=$INVARIANT_BLOCK
  echo "| Mutant | TLC | states | s |"
fi
echo "|---|---|---|---|"

for m in 0 1 2 4 5 6; do
  emit_cfg "$m" "$BLOCK"
  start=$SECONDS
  out=$(java -XX:+UseParallelGC -cp "$TLA_TOOLS" tlc2.TLC \
        -config "$WORK/M$m.cfg" -metadir "$WORK/states$m" -workers auto \
        Delivery 2>&1)
  secs=$((SECONDS - start))
  states=$(grep -oE '[0-9]+ distinct states found' <<<"$out" | head -1 | grep -oE '^[0-9]+')

  if grep -q 'Invariant .* is violated' <<<"$out"; then
    which=$(grep -oE 'Invariant [A-Za-z]+ is violated' <<<"$out" | head -1 | awk '{print $2}')
    verdict="caught ($which)"
  elif grep -q 'Model checking completed. No error has been found' <<<"$out"; then
    verdict=$([[ $m == 0 ]] && echo clean || echo missed)
  else
    verdict="error: $(grep -m1 -E '^Error|Parsing or semantic' <<<"$out")"
  fi
  echo "| M$m | $verdict | ${states:--} | $secs |"
done
