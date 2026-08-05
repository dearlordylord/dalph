#!/usr/bin/env bash
# Runs every mutant of MUTANTS.md through both Quint engines and prints a
# markdown row per mutant: random simulation versus Apalache symbolic checking.
#
#   ./run.sh              simulation only (seconds)
#   ./run.sh --verify     simulation and Apalache (minutes)
set -uo pipefail

cd "$(dirname "$0")"
SPEC=deliveryCore.qnt
INV=allInvariants
STEPS=25
SAMPLES=50000
VERIFY_STEPS=12

verdict() { grep -qE '^\[violation\]' <<<"$1" && echo caught || { grep -qE '^\[ok\]' <<<"$1" && echo missed || echo error; }; }

echo "| Mutant | simulate ($SAMPLES samples) | s | verify (Apalache, $VERIFY_STEPS steps) | s |"
echo "|---|---|---|---|---|"

for main in delivery deliveryM1 deliveryM2 deliveryM4 deliveryM5 deliveryM6; do
  label=${main#delivery}; label=${label:-M0}

  start=$SECONDS
  out=$(quint run "$SPEC" --main "$main" --invariant "$INV" \
        --max-steps "$STEPS" --max-samples "$SAMPLES" --verbosity 1 2>&1)
  sim=$(verdict "$out"); simSec=$((SECONDS - start))

  ver="skipped"; verSec="-"
  if [[ ${1:-} == --verify ]]; then
    start=$SECONDS
    out=$(quint verify "$SPEC" --main "$main" --invariant "$INV" \
          --max-steps "$VERIFY_STEPS" 2>&1)
    ver=$(verdict "$out"); verSec=$((SECONDS - start))
  fi

  [[ $label == M0 ]] && { sim=${sim/missed/clean}; ver=${ver/missed/clean}; }
  echo "| $label | $sim | $simSec | $ver | $verSec |"
done
