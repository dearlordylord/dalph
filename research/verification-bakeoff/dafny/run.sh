#!/usr/bin/env bash
# Verifies the faithful L1 encoding, then confirms every seeded defect is
# rejected. Both halves matter: a verifier that accepts the mutants has proved
# nothing about the faithful file.
#
# Needs the Dafny binary. Set DAFNY, or let this fetch it into ~/.cache.
set -uo pipefail

cd "$(dirname "$0")"

DAFNY=${DAFNY:-$HOME/.cache/dalph-bakeoff/dafny/dafny}
if [[ ! -x $DAFNY ]]; then
  mkdir -p "$HOME/.cache/dalph-bakeoff"
  url=https://github.com/dafny-lang/dafny/releases/download/v4.11.0/dafny-4.11.0-arm64-macos-13.zip
  curl -sSL -o "$HOME/.cache/dalph-bakeoff/dafny.zip" "$url"
  unzip -qo "$HOME/.cache/dalph-bakeoff/dafny.zip" -d "$HOME/.cache/dalph-bakeoff"
fi

echo "| File | Expected | Dafny | s |"
echo "|---|---|---|---|"

start=$SECONDS
out=$("$DAFNY" verify Delivery.dfy 2>&1)
secs=$((SECONDS - start))
count=$(grep -oE '[0-9]+ verified' <<<"$out" | grep -oE '^[0-9]+')
errors=$(grep -oE '[0-9]+ errors?' <<<"$out" | grep -oE '^[0-9]+')
verdict=$([[ ${errors:-1} == 0 ]] && echo "${count:-?} verified" || echo "**unexpected ${errors} errors**")
echo "| Delivery.dfy | verifies | $verdict | $secs |"

start=$SECONDS
out=$("$DAFNY" verify DeliveryMutants.dfy 2>&1)
secs=$((SECONDS - start))
errors=$(grep -oE '[0-9]+ errors?' <<<"$out" | grep -oE '^[0-9]+')
verdict=$([[ ${errors:-0} -ge 3 ]] && echo "$errors rejected" || echo "**only ${errors:-0} rejected**")
echo "| DeliveryMutants.dfy | 3 rejections | $verdict | $secs |"

echo ""
grep -E 'Error: a (postcondition|precondition)' <<<"$out" | sed 's/^/    /'
