#!/usr/bin/env bash
# Typechecks the faithful L1, L2, and journal-law developments under --safe,
# then requires the checker to reject each journal-law mutant.
set -uo pipefail

cd "$(dirname "$0")"

AGDA=${AGDA:-$HOME/.cache/dalph-bakeoff/agda/agda}
if [[ ! -x $AGDA ]]; then
  echo "Agda not found at $AGDA. Install Agda 2.8.0, or set AGDA." >&2
  exit 1
fi

echo "| File | Expected | Agda | s |"
echo "|---|---|---|---|"

FAIL=0
node ../generate-journal-events.mjs --check || FAIL=1
for file in L1.agda L2.agda Journal.agda JournalEventsGenerated.agda; do
  start=$SECONDS
  output=$("$AGDA" --safe "$file" 2>&1); code=$?
  if [[ $code == 0 ]]; then
    verdict="checks"
  else
    verdict="**unexpected exit $code**"
    FAIL=1
  fi
  echo "| $file | checks | $verdict | $((SECONDS - start)) |"
  [[ -n $output ]] && grep -E 'error|warning' <<<"$output" | sed 's/^/    /'
done

echo ""
AGDA="$AGDA" node ../prover-mutants.mjs agda || FAIL=1

exit $FAIL
