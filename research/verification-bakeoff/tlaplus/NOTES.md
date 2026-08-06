# TLA+ and TLC

## Two modules, on purpose

`Delivery.tla` is hand-authored. `DeliveryTranspiled.tla` is
`quint compile --target tlaplus` output from the same model: 793 lines of
Apalache-flavoured TLA+ with `@type` annotations, generated identifiers, and no
comments. Reading them side by side is the clearest available answer to "what
is Quint, exactly" — it is surface syntax and an effect system over this.

The transpiled module targets Apalache, not TLC. It is an artifact to read, not
to run.

## Friction met while encoding

`UNCHANGED << ... >>` is the feature Quint lacks, and it removes most of the
bulk: an action names only what it changes.

`admissionRespectedCeiling' = admissionRespectedCeiling /\ ...` refers to
`positions'` in the natural phrasing, which TLC rejects inside a primed
assignment on the right of another. Spelling `positions \cup {t}` instead of
`positions'` avoids it.

Infinite state must be bounded explicitly. `targetHead` grows without limit, so
`CONSTRAINT StateConstraint` is not optional — without it TLC never terminates.

List invariants individually in the `.cfg`. A single `AllInvariants` conjunction
type-checks and runs, but every violation then reports `AllInvariants` and you
lose the name of the actual failure for free.

## Character

Exhaustive breadth-first enumeration, and at this size it is simply the best
tool in the lineup: 81 792 distinct states in 2 seconds, all five defects
caught, plus the M8 specification error that random search missed.

Counterexamples are full behaviours — every state from `Init` to the violation,
with the action names. That is markedly more legible than a single violating
state vector, and it is the reason the M6 trace was readable enough to confirm
the stale head came from `ExternalTargetAdvance` rather than from a modelling
slip.

Setup is one 2 MB jar and no installation. Of everything here it has the lowest
setup cost per unit of result.

## Liveness

`DeliveryLiveness.tla` extends this module with I17–I19 and `./run-liveness.sh`
runs them. The file is separate because liveness needs a **different spec**,
not just extra properties.

### `WF_vars(Next)` was decoration

The safety spec's `WF_vars(Next)` says only that *some* step keeps happening.
It is satisfied by a machine that observes the graph forever and never touches
a ticket, so it is worth nothing for liveness. Replacing it took two corrections
that TLC found for me, in order:

**Strong, not weak.** With two tasks Accepted, the integration resource is
exclusive, so each task's `StartIntegration` is repeatedly enabled and
repeatedly disabled. `WF` permits starving one forever.

**Per action, not per disjunction.** `SF_vars(Progress(t))` over a disjunction
of the ten lifecycle actions looks right and is far too weak: fairness on a
disjunction is discharged by taking *any* disjunct infinitely often. TLC
returned a lasso cycling
`Executing → SuspensionRequested → Suspended → Executing` in which
`ReportAccepted` is enabled at every pass and simply never chosen. Naming all
ten actions separately is what forces the cycle to be left.

### Liveness found a real gap in the model that safety could not

The first run of I18 stated as `phase = "Executing" ~> phase = "Settled"`
returned a ticket parked in `Integrating` with `expectedHead = 1` against
`targetHead = 2`, then `State 11: Stuttering`. The compare-and-set guard on
`Promote` was permanently unsatisfiable and the only escape in the model was a
crash.

Two things were wrong, and only one of them was the model:

1. The property dropped half of I18. The invariant reads "settles **or is
   retained together with an exact stated reason**", and only the first
   disjunct had been written down.
2. The model had no state for the second disjunct. Production does:
   `CorrectionRequired` bounded by `CORRECTION_LIMIT`, terminating in
   `CorrectionLimitReached` — see `specs/acceptedResultIntegration.qnt`.

Hence the `Abandoned` phase and `AbandonIntegration` action, the only additions
liveness demanded. Note that `HasObligation` stays true for `Abandoned`, so a
retained ticket is still delivered — which is exactly what distinguishes it
from `Settled`. Adding the action left every safety verdict unchanged and moved
the state count from 81 792 to 96 000.

**A run stuck forever violates no safety property.** That sentence is the whole
argument for checking liveness at all, and it took one property to demonstrate.

### Cost

The measurement, same model, same size, same machine:

| Check | Result | s |
|---|---|---|
| all nine safety invariants | clean, 96 000 states | 3 |
| `PauseDrainsPositions` | holds | 28 |
| `EveryBegunSettles`, 1 task | holds, 1 824 states | 6 |
| `EveryBegunSettles`, 2 tasks | no verdict within the budget | — |

Safety is seconds; the same state space with a liveness tableau over 21 strong
fairness conjuncts is a different cost class entirely. The property is true —
one task settles it in 6 seconds — but the two-task check does not finish.

Two footnotes worth carrying:

`CONSTRAINT StateConstraint` plus liveness draws a warning from TLC, and it is
a genuine soundness caveat rather than noise: a state constraint truncates
behaviours, and a behaviour truncated by the constraint is not a
counterexample. These verdicts are therefore about behaviours that stay inside
the constraint.

Every property here is an implication with an environment hypothesis
(`<>[]~crashed`, `<>[]~paused`, `<>[](capacity > 0)`). None of the safety
invariants needed one. Perpetual crashing, perpetual pause and a capacity
pinned at zero are all harmless for safety and each independently falsifies
every liveness property in the catalog.

