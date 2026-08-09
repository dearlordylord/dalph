#!/usr/bin/env bash
# Checks I17-I19 of ../INVARIANTS.md with TLC.
#
#   ./run-liveness.sh          two tasks, the same size the safety run uses
#   ./run-liveness.sh --small  one task, which is the only size that finishes
#                              EveryBegunSettles in a usable time
#   ./run-liveness.sh --three  three tasks, for #199 scaling measurements
#   ./run-liveness.sh --three-safety  only the exact three-task safety run
#   ./run-liveness.sh --lasso  the suspend/resume experiment, one task: is the
#                              lasso a fairness defect or a missing hypothesis?
#   ./run-liveness.sh --arrival  I19 over a model where new work keeps arriving.
#                              Both rows are unsound; that is the finding.
#
# Liveness is a different cost class from safety here, which is the point of
# keeping this separate from ./run.sh. Same model, same size, same machine:
# safety is seconds, EveryBegunSettles at two tasks is not.
#
# TIMEOUT bounds each property. A `no verdict` result is reported rather than
# converted to a pass and fails by default. Set ALLOW_NO_VERDICT=1 only to
# record an intentionally bounded measurement.
set -uo pipefail

cd "$(dirname "$0")"

TLA_TOOLS=${TLA_TOOLS:-$HOME/.cache/dalph-bakeoff/tla2tools.jar}
JAVA=${JAVA:-java}
if [[ ! -f $TLA_TOOLS ]]; then
  mkdir -p "$(dirname "$TLA_TOOLS")"
  # Same pinned-tag, atomic fetch as ./run.sh (v1.7.4 when pinned; see NOTES.md).
  TLA_TAG=${TLA_TAG:-$(latest=$(curl -fsSL https://api.github.com/repos/tlaplus/tlaplus/releases/latest) \
        && grep -m1 '"tag_name"' <<<"$latest" | cut -d'"' -f4)}
  tmp="$TLA_TOOLS.tmp.$$"
  curl -fsSL -o "$tmp" \
    "https://github.com/tlaplus/tlaplus/releases/download/$TLA_TAG/tla2tools.jar" \
    && mv "$tmp" "$TLA_TOOLS" || { rm -f "$tmp"; echo "tla2tools.jar fetch failed" >&2; exit 1; }
fi

TIMEOUT=${TIMEOUT:-1800}
ALLOW_NO_VERDICT=${ALLOW_NO_VERDICT:-0}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FAIL=0

# One parser owns TLC's process/output contract for every mode below. A
# violation marker outranks TLC's nonzero counterexample exit; a clean marker
# is accepted only with exit zero. Everything else is inconclusive.
classify_tlc() { # exit-code output
  local code=$1 output=$2
  if [[ $code == 124 ]]; then echo timeout
  elif grep -q 'Invariant .* is violated\|Temporal properties were violated' <<<"$output"; then echo violated
  elif [[ $code != 0 ]]; then echo no-verdict
  elif grep -q 'Model checking completed. No error has been found\|No error has been found' <<<"$output"; then echo holds
  else echo no-verdict; fi
}

record_no_verdict() {
  [[ $ALLOW_NO_VERDICT == 1 ]] || FAIL=1
}

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
    out=$(timeout "${TIMEOUT:-900}" "$JAVA" -XX:+UseParallelGC -cp "$TLA_TOOLS" tlc2.TLC \
          -config "$WORK/a.cfg" -metadir "$WORK/a$1" -workers auto DeliveryArrival 2>&1)
    code=$?
    case $(classify_tlc "$code" "$out") in
      holds) v="holds" ;;
      violated) v="violated" ;;
      timeout|no-verdict) v="**no verdict**"; record_no_verdict ;;
    esac
    echo "| $1 | $2 | $v |"
  }
  arrival ReachesQuiescenceUnderArrival "eventually sealed"
  arrival ReachesQuiescenceUnsealed "none -- should be false"
  exit "$FAIL"
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
  lasso() { # $1 spec, $2 property, $3 expected rendered verdict
    cat > "$WORK/l.cfg" <<EOF
SPECIFICATION $1
CONSTANT MUTANT = 0
CONSTANT Tasks <- OneTask
CONSTRAINT StateConstraint
PROPERTY $2
EOF
    out=$(timeout "${TIMEOUT:-600}" "$JAVA" -XX:+UseParallelGC -cp "$TLA_TOOLS" tlc2.TLC \
          -config "$WORK/l.cfg" -metadir "$WORK/l$2$1" -workers auto DeliveryLiveness 2>&1)
    code=$?
    case $(classify_tlc "$code" "$out") in
      holds) v="holds" ;;
      violated) v="**violated**" ;;
      timeout|no-verdict) v="no verdict"; record_no_verdict ;;
    esac
    [[ $v == "$3" ]] || FAIL=1
    echo "| $1 | $2 | $v |"
  }
  lasso DisjunctionSpec EveryBegunSettles "**violated**"
  lasso DisjunctionSpec EveryBegunSettlesUninterrupted holds
  lasso LiveSpec EveryBegunSettles holds
  echo ""
  echo "Row 1 is the artifact: atomic work makes a preserved-progress cycle look"
  echo "like no progress. Row 2 shows assuming the operator away also removes it,"
  echo "at the cost of a hypothesis the domain does not need. Row 3 is the"
  echo "primary form: per-action SF on ReportAccepted abstracts preservation"
  echo "plus finite work plus fair scheduling, which is what the domain says."
  exit "$FAIL"
fi

SIZE_LINE=""
LABEL="2 tasks"
if [[ ${1:-} == --small ]]; then
  SIZE_LINE="CONSTANT Tasks <- OneTask"
  LABEL="1 task"
elif [[ ${1:-} == --three || ${1:-} == --three-safety ]]; then
  SIZE_LINE="CONSTANT Tasks <- ThreeTasks"
  LABEL="3 tasks"
fi

if [[ ${1:-} == --three-safety ]]; then
  echo "Safety, $LABEL, ${TIMEOUT}s budget."
else
  echo "Liveness, $LABEL, ${TIMEOUT}s budget per property."
fi
echo ""
echo "| Property | TLC | states | s |"
echo "|---|---|---|---|"

if [[ ${1:-} == --three-safety ]]; then
  cat > "$WORK/Safety.cfg" <<EOF
SPECIFICATION Spec
CONSTANT MUTANT = 0
$SIZE_LINE
CONSTRAINT StateConstraint
INVARIANT TypeOK
INVARIANT BoundRespected
INVARIANT RetentionHolds
INVARIANT SettlementDropped
INVARIANT PositionDiscipline
INVARIANT AdmissionRule
INVARIANT OneAttemptPerTask
INVARIANT TargetResourceExclusive
INVARIANT PromotionUsedExactHead
INVARIANT ProcessLocalLostOnCrash
EOF
  start=$SECONDS
  out=$(timeout "$TIMEOUT" "$JAVA" -XX:+UseParallelGC -cp "$TLA_TOOLS" tlc2.TLC \
        -config "$WORK/Safety.cfg" -metadir "$WORK/sSafety" -workers auto \
        DeliveryLiveness 2>&1)
  code=$?
  secs=$((SECONDS - start))
  states=$(grep -oE '[0-9]+ distinct states found' <<<"$out" | tail -1 | grep -oE '^[0-9]+')
  case $(classify_tlc "$code" "$out") in
    holds) verdict="holds" ;;
    violated) verdict="**violated**"; FAIL=1 ;;
    timeout) verdict="**no verdict in ${TIMEOUT}s**"; record_no_verdict ;;
    no-verdict) verdict="**no verdict: TLC exited $code**"; record_no_verdict ;;
  esac
  echo "| AllInvariants safety | $verdict | ${states:--} | $secs |"
  exit "$FAIL"
fi

for P in PauseDrainsPositions EveryBegunSettles ReachesQuiescence; do
  cat > "$WORK/$P.cfg" <<EOF
SPECIFICATION LiveSpec
CONSTANT MUTANT = 0
$SIZE_LINE
CONSTRAINT StateConstraint
PROPERTY $P
EOF
  start=$SECONDS
  out=$(timeout "$TIMEOUT" "$JAVA" -XX:+UseParallelGC -cp "$TLA_TOOLS" tlc2.TLC \
        -config "$WORK/$P.cfg" -metadir "$WORK/s$P" -workers auto \
        DeliveryLiveness 2>&1)
  code=$?
  secs=$((SECONDS - start))
  states=$(grep -oE '[0-9]+ distinct states found' <<<"$out" | tail -1 | grep -oE '^[0-9]+')

  case $(classify_tlc "$code" "$out") in
    holds) verdict="holds" ;;
    violated) verdict="**violated**"; FAIL=1 ;;
    timeout) verdict="**no verdict in ${TIMEOUT}s**"; record_no_verdict ;;
    no-verdict) verdict="**no verdict: TLC exited $code**"; record_no_verdict ;;
  esac
  echo "| $P | $verdict | ${states:--} | $secs |"
done

# The hypothesis witness. PauseDrainsPositions is `<>[]paused => ...`, which
# holds over no behaviours at all if `<>[]paused` is unsatisfiable -- the exact
# vacuity that the earlier `[]paused` form had. TLC is asked to REFUTE
# `[]<>(~paused)`, so a violation here means a permanently paused behaviour
# exists and the hypothesis is satisfiable.
cat > "$WORK/w.cfg" <<EOF
SPECIFICATION LiveSpec
CONSTANT MUTANT = 0
$SIZE_LINE
CONSTRAINT StateConstraint
PROPERTY PauseIsSustainable
EOF
start=$SECONDS
out=$(timeout "$TIMEOUT" "$JAVA" -XX:+UseParallelGC -cp "$TLA_TOOLS" tlc2.TLC \
      -config "$WORK/w.cfg" -metadir "$WORK/wPause" -workers auto \
      DeliveryLiveness 2>&1)
code=$?
case $(classify_tlc "$code" "$out") in
  violated) w="satisfiable" ;;
  holds) w="**UNSATISFIABLE -- I17 is vacuous**"; FAIL=1 ;;
  timeout|no-verdict) w="no verdict"; record_no_verdict ;;
esac
echo "| PauseIsSustainable (refuted: hypothesis of I17) | $w | - | $((SECONDS - start)) |"

exit "$FAIL"
