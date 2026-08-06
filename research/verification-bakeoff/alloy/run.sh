#!/usr/bin/env bash
# Runs every check and witness in Delivery.als and prints a markdown table.
#
# Alloy inverts the usual reading:
#   check ... UNSAT  = no counterexample found in scope = the property holds
#   check ... SAT    = a counterexample exists = caught
#   run   ... SAT    = the witness state is reachable = the check was not vacuous
#   run   ... UNSAT  = the witness is impossible
#
# Needs alloy.jar. Set ALLOY_JAR, or let this fetch it into ~/.cache.
set -uo pipefail

cd "$(dirname "$0")"

ALLOY_JAR=${ALLOY_JAR:-$HOME/.cache/dalph-bakeoff/alloy.jar}
if [[ ! -f $ALLOY_JAR ]]; then
  mkdir -p "$(dirname "$ALLOY_JAR")"
  # -f so an error page is never cached; tempfile + rename in the same
  # directory so the jar appears atomically.
  tmp="$ALLOY_JAR.tmp.$$"
  curl -fsSL -o "$tmp" \
    https://github.com/AlloyTools/org.alloytools.alloy/releases/download/v6.2.0/org.alloytools.alloy.dist.jar \
    && mv "$tmp" "$ALLOY_JAR" || { rm -f "$tmp"; echo "alloy.jar fetch failed" >&2; exit 1; }
fi

start=$SECONDS
# Alloy writes its command summary to stderr, not stdout.
out=$(java -jar "$ALLOY_JAR" exec -f "${1:-Delivery.als}" 2>&1 1>/dev/null)
secs=$((SECONDS - start))

echo "| Command | Alloy | Reading |"
echo "|---|---|---|"

while read -r line; do
  # The name class has to include digits, or `interruptionForeverBreaksI18`
  # prints as `interruptionForeverBreaksI`.
  [[ $line =~ ^[0-9]+\.[[:space:]]+(check|run)[[:space:]]+([A-Za-z0-9]+) ]] || continue
  kind=${BASH_REMATCH[1]}
  name=${BASH_REMATCH[2]}
  if grep -q 'SAT' <<<"${line/UNSAT/}"; then result=SAT; else result=UNSAT; fi

  if [[ $kind == check ]]; then
    reading=$([[ $result == UNSAT ]] && echo "holds in scope" || echo "**counterexample found**")
  else
    reading=$([[ $result == SAT ]] && echo "witness reachable" || echo "**witness impossible**")
  fi
  echo "| $kind $name | $result | $reading |"
done <<<"$out"

echo ""
echo "Total ${secs}s for ${1:-Delivery.als}."
