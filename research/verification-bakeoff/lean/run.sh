#!/usr/bin/env bash
# Checks the faithful L1 and L2 developments, then confirms every seeded
# defect is rejected. As with Dafny, both halves matter.
#
# Needs Lean 4. Set LEAN, or install elan:
#   curl -sSf https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh | sh -s -- -y
# elan resolves the pinned toolchain from ./lean-toolchain.
set -uo pipefail

cd "$(dirname "$0")"

LEAN=${LEAN:-$HOME/.elan/bin/lean}
if [[ ! -x $LEAN ]]; then
  echo "Lean not found at $LEAN. Install elan, or set LEAN." >&2
  exit 1
fi

echo "| File | Expected | Lean | s |"
echo "|---|---|---|---|"

# Exit codes, not empty output: a silent crash must not read as a pass, and a
# warning on stderr must not read as an error.
start=$SECONDS
out_l1=$("$LEAN" L1.lean 2>&1); code_l1=$?
out_l2=$("$LEAN" L2.lean 2>&1); code_l2=$?
secs=$((SECONDS - start))
if [[ $code_l1 == 0 && $code_l2 == 0 ]]; then
  verdict="all proofs check"
else
  verdict="**unexpected errors (exit $code_l1/$code_l2)**"
fi
echo "| L1.lean + L2.lean | check | $verdict | $secs |"
[[ -n $out_l1$out_l2 ]] && grep -E 'error|warning' <<<"$out_l1$out_l2" | sed 's/^/    /'

# Each of the three mutants must fail *individually*: attribute every error
# line to the mutant theorem whose line range contains it, rather than
# counting error lines in aggregate.
start=$SECONDS
out=$("$LEAN" L1Mutants.lean 2>&1)
secs=$((SECONDS - start))

rejected=0
detail=""
for theorem in selectM1_bounded retentionM2 selectReversed_prefix; do
  first=$(grep -n "^theorem $theorem" L1Mutants.lean | cut -d: -f1)
  # The mutant's range ends at the next doc comment (the next mutant) or `end`.
  last=$(awk -v s="$first" 'NR > s && (/^\/--/ || /^end /) { print NR; exit }' L1Mutants.lean)
  last=${last:-$(wc -l < L1Mutants.lean)}
  hits=$(grep -E '^L1Mutants\.lean:[0-9]+:[0-9]+: error' <<<"$out" \
         | cut -d: -f2 | awk -v lo="$first" -v hi="$last" '$1 >= lo && $1 < hi' | wc -l)
  if [[ $hits -gt 0 ]]; then
    rejected=$((rejected + 1))
  else
    detail="$detail **$theorem not rejected**"
  fi
done
verdict=$([[ $rejected == 3 ]] && echo "3 rejected" || echo "**only $rejected/3 rejected:$detail**")
echo "| L1Mutants.lean | 3 rejections | $verdict | $secs |"

echo ""
grep -E '^L1Mutants\.lean:[0-9]+:[0-9]+: error' <<<"$out" | cut -c1-110 | sed 's/^/    /'
