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
tool in the lineup: 96 000 distinct states in 2 seconds, all five defects
caught, plus the M8 specification error that random search missed.

Counterexamples are full behaviours — every state from `Init` to the violation,
with the action names. That is markedly more legible than a single violating
state vector, and it is the reason the M6 trace was readable enough to confirm
the stale head came from `ExternalTargetAdvance` rather than from a modelling
slip.

Setup is one 2 MB jar and no installation. The fetch is pinned to release tag
`v1.7.4` (resolved from the releases API at fetch time, `TLA_TAG` overridable)
rather than `releases/latest`, so the jar cannot move silently between runs.
Of everything here it has the lowest setup cost per unit of result.

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
repeatedly disabled. `WF` permits starving one forever. This is the sound
argument for SF here.

**And a lasso that is a modelling artifact.** `SF_vars(Progress(t))` over a
disjunction of the ten lifecycle actions is discharged by taking *any* disjunct
infinitely often, and TLC returns a lasso cycling
`Executing → SuspensionRequested → Suspended → Executing` with `ReportAccepted`
enabled at every pass and never chosen.

Two readings compete, and **neither the tool nor the model can settle it — only
the domain can.** `docs/CONTEXT.md` defines planned-attempt executor-work
suspension as the executor's proof that its work

> is safely stopped, **has preserved what it needs to resume the same attempt**,
> and has no executor-owned activity for that attempt still running

and adds that a session or worker-process interruption alone does *not* prove
suspension. So progress survives the cycle, and an operator suspending forever
does not prevent completion. The lasso is an artifact of work being atomic in
this model: with no accumulator, a cycle that preserves progress is
indistinguishable from one that makes none.

That makes per-action `SF_vars(ReportAccepted(t))` the faithful encoding rather
than a dodge. It abstracts *preservation + finite work + fair scheduling*, which
is exactly what the domain guarantees. An `EventuallyUninterrupted` hypothesis
would also remove the lasso, and would weaken I18 below what the system actually
provides.

`./run-liveness.sh --lasso` shows all three, one task:

| Spec | Property | TLC |
|---|---|---|
| `DisjunctionSpec` | `EveryBegunSettles` | violated — the artifact |
| `DisjunctionSpec` | `EveryBegunSettlesUninterrupted` | holds, by assuming the operator away |
| `LiveSpec` | `EveryBegunSettles` | holds — the primary form |

The general lesson: **when a liveness counterexample appears, the question is
whether the domain permits that behaviour, and the model is not the place to
look it up.** Both available fixes here — strengthen fairness, or add a
hypothesis — remove the counterexample, and only one of them matches the
domain.

A progress counter (`work : TaskId -> 0..N`, `reportAccepted` requiring
`work = N`) would let this be *derived* rather than encoded: fairness would sit
on `doWork`, and completion across infinitely many interruptions would follow
from preservation instead of being asserted by SF. That is the principled fix
and it is not in this model.

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

Every property here is an implication with environment hypotheses —
`<>[]~crashed`, `<>[]~paused`, `<>[](capacity > 0)`. None of the safety
invariants needed one. Perpetual crashing, perpetual pause and a capacity pinned
at zero are all harmless for safety, all legitimate, and each independently
falsifies every liveness property in the catalog. Enumerating them *is* most of
the work of stating a liveness property — and so is establishing that a
candidate hypothesis is **not** needed, which is a domain question every time.

## Arrival, and where bounded checking gives out

I19 reads "**with no new tracker facts** the run reaches quiescence". That
hypothesis is absent from `ReachesQuiescence` because the base model cannot
express new facts: `Tasks` is fixed and no phase returns to `NoObligation`, so
work is exhaustible by construction and the hypothesis holds silently. A clean
I19 verdict is weaker than it looks.

`ArrivalSpec` adds it — finished tickets recycle, and `SealGraph` is the
tracker falling quiet. `./run-liveness.sh --arrival`:

| | verdict |
|---|---|
| no `CONSTRAINT` | no verdict in 7 minutes |
| `CONSTRAINT StateConstraint` | both properties hold, 5 472 states |

Neither row is usable, and that is the finding. Every completed responsibility
advances `targetHead`, so an endless arrival stream is an endless state space.
Adding the constraint makes it finite and makes the verdict *wrong*:
`ReachesQuiescenceUnsealed` should be false, since an endless arrival stream is
a legitimate behaviour under which the run never goes quiet, and it comes back
clean only because the constraint truncates the recycling loop before it can
close.

This is the state-constraint-plus-liveness hazard TLC warns about, in the
concrete, and it is worth more than the answer would have been. The practical
consequence: **cap arrivals, and not for realism** — an uncapped stream is not
checkable here by either route. The cap belongs in the hypothesis, which is
what I19 already said.

