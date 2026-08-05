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

## Not exercised

`Spec` includes `WF_vars(Next)`, so the temporal invariants I17–I19 are
statable, but only the safety invariants were run. Liveness checking is where
TLC gets expensive and is the obvious next experiment.
