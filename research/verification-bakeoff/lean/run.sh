#!/usr/bin/env bash
# Checks the faithful L1 development, then confirms every seeded defect is
# rejected. As with Dafny, both halves matter.
#
# Needs Lean 4. Set LEAN, or install elan:
#   curl -sSf https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh | sh -s -- -y
set -uo pipefail

cd "$(dirname "$0")"

LEAN=${LEAN:-$HOME/.elan/bin/lean}
if [[ ! -x $LEAN ]]; then
  echo "Lean not found at $LEAN. Install elan, or set LEAN." >&2
  exit 1
fi

echo "| File | Expected | Lean | s |"
echo "|---|---|---|---|"

start=$SECONDS
out=$("$LEAN" L1.lean 2>&1)
secs=$((SECONDS - start))
verdict=$([[ -z $out ]] && echo "all proofs check" || echo "**unexpected errors**")
echo "| L1.lean | checks | $verdict | $secs |"

start=$SECONDS
out=$("$LEAN" L1Mutants.lean 2>&1)
secs=$((SECONDS - start))
errors=$(grep -cE '^L1Mutants\.lean:[0-9]+:[0-9]+: error' <<<"$out")
verdict=$([[ ${errors:-0} -ge 3 ]] && echo "$errors rejected" || echo "**only ${errors:-0} rejected**")
echo "| L1Mutants.lean | 3 rejections | $verdict | $secs |"

echo ""
grep -E '^L1Mutants\.lean:[0-9]+:[0-9]+: error' <<<"$out" | cut -c1-110 | sed 's/^/    /'
