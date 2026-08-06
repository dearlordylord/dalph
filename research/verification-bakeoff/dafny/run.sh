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
  # The release publishes one asset per platform; select by host.
  case "$(uname -sm)" in
    "Darwin arm64") asset=dafny-4.11.0-arm64-macos-13.zip ;;
    "Linux x86_64") asset=dafny-4.11.0-x64-ubuntu-22.04.zip ;;
    *)
      echo "No prebuilt Dafny 4.11.0 for $(uname -sm)." >&2
      echo "On Linux aarch64 see NOTES.md, \"Linux aarch64 workaround\", then set DAFNY." >&2
      exit 1
      ;;
  esac
  url=https://github.com/dafny-lang/dafny/releases/download/v4.11.0/$asset
  # -f so an error page is never cached; tempfile + rename in the same
  # directory so the zip appears atomically.
  tmp="$HOME/.cache/dalph-bakeoff/dafny.zip.tmp.$$"
  curl -fsSL -o "$tmp" "$url" \
    && mv "$tmp" "$HOME/.cache/dalph-bakeoff/dafny.zip" \
    || { rm -f "$tmp"; echo "Dafny fetch failed: $url" >&2; exit 1; }
  unzip -qo "$HOME/.cache/dalph-bakeoff/dafny.zip" -d "$HOME/.cache/dalph-bakeoff"
fi

echo "| File | Expected | Dafny | s |"
echo "|---|---|---|---|"

faithful() { # $1 file
  local start=$SECONDS out count errors verdict
  out=$("$DAFNY" verify "$1" 2>&1)
  count=$(grep -oE '[0-9]+ verified' <<<"$out" | grep -oE '^[0-9]+')
  errors=$(grep -oE '[0-9]+ errors?' <<<"$out" | grep -oE '^[0-9]+')
  verdict=$([[ ${errors:-1} == 0 ]] && echo "${count:-?} verified" || echo "**unexpected ${errors} errors**")
  echo "| $1 | verifies | $verdict | $((SECONDS - start)) |"
}

mutants() { # $1 file, $2 expected count
  local start=$SECONDS out errors verdict
  out=$("$DAFNY" verify "$1" 2>&1)
  errors=$(grep -oE '[0-9]+ errors?' <<<"$out" | grep -oE '^[0-9]+')
  # Exactly the expected rejections: more or fewer both mean the file drifted.
  verdict=$([[ ${errors:-0} == "$2" ]] && echo "$errors rejected" || echo "**${errors:-0} rejected, expected $2**")
  echo "| $1 | $2 rejections | $verdict | $((SECONDS - start)) |"
  LAST_OUT=$out
}

faithful Delivery.dfy
mutants DeliveryMutants.dfy 3
faithful DeliveryL2.dfy
mutants DeliveryL2Mutants.dfy 3

echo ""
grep -E 'Error: a (postcondition|precondition)' <<<"$LAST_OUT" | sed 's/^/    /'
