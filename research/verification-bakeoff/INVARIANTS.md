# Delivery invariant catalog

The fixed specification for the verification bake-off. Every tool under
`./<tool>/` encodes these and nothing else, so results are comparable.

Vocabulary is `docs/CONTEXT.md`. Levels split the catalog because the level is
the axis on which the tools differ.

- **L1 — pure projection.** `frontier → boundedParallelTickets → ticketDeliveries`.
  A total function of one graph publication and the exact evidence set. No time.
  Source of truth: `packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.ts`.
- **L2 — delivery protocol.** The lifecycle from graph observation through claim,
  planned attempt, executor work, accepted result, integration, promotion, and
  settlement, under capacity, pause, and process loss. Source of truth:
  `research/delivery-composition-implementation-preparation.md` and
  `docs/OPERATIONAL-SCENARIOS.md`.

## L1 — pure projection

**I1 Bound.** `|Selected| = min(|Eligible|, taskExecutionCapacity)`. Selection
reads graph order and configured policy only; live positions are not an input.

**I2 Order independence.** Selection is invariant under permutation of the
tracker task input. Ordering is graph-owned, deterministic, and total.

**I3 Exhaustive classification.** Every task in the observed graph is either
`Eligible` or `Excluded` with at least one graph-owned reason. There is no
third outcome and no silently dropped task.

**I4 Retention.** A task carrying an exact outstanding obligation appears in
the ticket-delivery relation under every placement: `Selected`,
`EligibleOutsideBound`, `GraphExcluded`, and `AbsentFromCurrentGraph`. Absence
from the current positive selection never erases it.

**I5 Settlement drop.** `Settled` and `TaskExternalSuccessSettled` evidence
yields no obligation and no delivery.

**I6 No invention.** Obligations are a function of exact evidence. Placement
alone never creates one.

## L2 — safety

**I7 Position discipline.** A task-work position is held exactly while the
phase is one of responsibility-began, running, or suspension-requested. Safe
suspension and terminal both release it; requesting suspension does not.

**I8 Admission ceiling — and the trap.** New admissions respect the current
ceiling. This is a property of the admission *transition*, not of the state:
a capacity contraction lets existing holders continue, so
`|positions| ≤ capacity` is a **wrong** specification of it. Encoding I8 as a
state predicate is the seeded specification error every tool is asked to
reproduce.

**I9 Exact correlation.** Every executor interaction carries the exact
`(RunId, AttemptId)`. No operation, session, or process identity substitutes.

**I10 One attempt in flight.** At most one planned attempt per task is
unsettled, including across crash and recovery. Process loss is not executor
completion and authorizes no replacement attempt.

**I11 Claim exclusivity.** At most one active claim per task. A release or
replacement names the exact current owner and token; a token from an earlier
claim authorizes nothing.

**I12 Candidate shape.** An integration candidate has exactly two ordered
direct parents: the fixed expected target head first, the immutable accepted
result second.

**I13 Promotion.** A verified candidate is offered only by compare-and-set
against its exact expected target head. A stale head selects reconciliation,
an ambiguous head requires a reread, neither authorizes a force update.

**I14 Authority separation.** Derived frontiers, placements, positions, and
integration-target ownership are process-local and never persisted. The journal
holds accepted workflow history only. Process loss clears every process-local
resource and no durable one.

**I15 Journal.** Append-only. Reduction is a pure fold, total over
contradictory histories, and idempotent under replay.

## L2 — temporal

**I16 Recovery.** After process loss, restart reconstructs the existing
responsibility and continues that exact attempt. It plans no replacement
attempt, creates no second claim, and creates no second worktree.

**I17 Pause.** After an applied pause, no admission occurs; existing holders
eventually reach safe suspension.

**I18 No silent drop.** Every begun responsibility eventually settles or is
retained together with an exact stated reason.

**I19 Quiescence.** With no new tracker facts the run reaches quiescence.
Quiescence proves no currently executable action, not completion, not an empty
target, and not permission to terminate the run.

## Coverage per tool

One row per invariant, because grouping them hid which cells were results and
which were assumptions. The distinction each cell makes:

| | |
|---|---|
| **checked** | a property that could fail, discharged by the tool |
| **definitional** | stated, discharged, and true by unfolding the definitions — it cannot fail |
| **guard** | enforced by an action precondition; the transition cannot violate it, and nothing checks that |
| **history flag** | a variable the actions maintain and an invariant reads — the standard encoding of a transition property |
| **assumed** | constrained rather than checked; the tool is told it, not asked |
| **typed away** | the defect is unwriteable in the encoding, so no property is needed |
| **dead flag** | a history variable that is declared, initialised, and then never updated or read |
| **not modelled** | the shared benchmark omits the phenomenon — a scope decision, not a tool limit |
| **—** | the tool cannot state it at all |

Only **checked** and **history flag** are evidence on their own. **guard** says
the encoding respects the rule and nothing tests that it must: a guard cell is
worth something only where a mutant removes the guard, which here is true for
M4/M5/M6 in Quint, TLA+, fast-check and Dafny — and for none of the cells
labelled `guard`.

**definitional** is the trap this table exists to expose. Three tools state I5
as `phase = Settled ⇒ ¬hasObligation(t)` while defining `hasObligation` as
`phase ∉ {NoObligation, Settled}`. Substituting gives `⊤`. It is discharged
instantly by every engine, no mutant can break it, and it looks exactly like a
result.

| Invariant | Quint | TLA+/TLC | Alloy 6 | Dafny | Lean 4 | Agda | fast-check |
|---|---|---|---|---|---|---|---|
| I1 bound | checked | checked | assumed | checked | checked | checked | checked |
| I2 order independence | typed away | typed away | typed away | statable, not stated | length half only | not stated | typed away |
| I3 classification | definitional | typed away | typed away | asserted on one witness | typed away | typed away | typed away |
| I4 retention | checked | checked | definitional | checked | checked | checked | checked |
| I5 settlement drop | definitional | definitional | definitional | definitional | not modelled | not modelled | definitional |
| I6 no invention | typed away | typed away | typed away | typed away | typed away | typed away | typed away |
| I7 position discipline | checked | checked | assumed (L1), checked (L2) | checked | checked | checked | checked |
| I8 admission ceiling | history flag | history flag | guard (L2) | loop invariant | guard + **dead flag** | guard | history flag |
| I9 exact correlation | **not modelled** | **not modelled** | **not modelled** | **not modelled** | **not modelled** | **not modelled** | **not modelled** |
| I10 one attempt | checked | checked | checked | checked | checked | checked | checked |
| I11 claim exclusivity | **not modelled** | **not modelled** | **checked** | **not modelled** | **not modelled** | **not modelled** | **not modelled** |
| I12 candidate shape | **not modelled** | **not modelled** | **checked** | **not modelled** | **not modelled** | **not modelled** | **not modelled** |
| I13 promotion | history flag | history flag | guard (L2) | guard | guard + **dead flag** | guard | history flag |
| I14 authority separation | checked | checked | assumed (L1), checked (L2) | checked | checked | checked | checked |
| I15 journal | **not modelled** | **not modelled** | **not modelled** | **not modelled** | **not modelled** | **not modelled** | **not modelled** |
| I16 recovery | checked | checked | checked | checked | checked | checked | checked |
| I17–I19 | statable, no backend | I17 at 2 tasks, I18–I19 at 1 | checked | **—** | statable, not attempted | statable, not attempted | bounded surrogate |

**dead flag** is the sharpest cell in the table. `lean/L2.lean:63-64` declares
`admissionOk` and `promotedExact`, `init` sets both `true`, no `Step`
constructor updates either, and no clause of `Inv` reads either. Nothing in
Lean complains: an unused structure field is not an error, and the proof of
`Inv` is no harder for carrying two constants.

What the flags do *not* mean is that Lean encodes less than Agda. Both carry
the same two premises — `heldCount s < s.capacity` on `beginWork` and
`expectedHead = s.head` on `promote` — so both stand at `guard`. Lean simply
also carries two variables that look like the TLA+ and Quint history flags and
do none of their work. The failure mode is *decoration*, not absence, which is
why nothing reports it.

Every **checked** cell in the Quint column is discharged twice over, and the
second way is stronger: `quint/run.sh --inductive` proves the same conjunction
is preserved by every step from every state satisfying its bounds, with no step
limit. That removes the step bound, not the data bound — `stateBounds` still
fixes two tasks and finite ranges, and the ranges then have to be proved closed
under the step relation, which is a conjunct the reachability runs never needed.

### What the columns of `not modelled` mean

**I9 and I15 are in no encoding at all.** No model here carries a `RunId`, an
`AttemptId`, or a journal; `oneAttemptPerTask` counts attempts and never names
one. So the bake-off says nothing about exact correlation or about the journal
being an append-only pure fold — and those are two of the four invariants the
production system rests on hardest. `JOURNAL-EVENTS.md` is the design I15
starts from; nothing is built.

**I11 and I12 exist only in Alloy**, and that is the whole reason Alloy is in
the lineup. They are not "booleans a mutant flips" in the other tools; they are
absent, because a state-machine language makes a claim-with-a-token and a
two-parent candidate expensive enough that the shared model omits them. M3, the
misordered-parent mutant, therefore has no counterpart outside `alloy/`.

### What `assumed` means, and where it bit

Most of `alloy/Delivery.als` has no transition relation, so its checks read
`wellFormed implies P`. When `P` is also a conjunct of `wellFormed` the check
is `P implies P` — UNSAT for a reason with nothing to do with the model. I11
was written that way and reported "holds in scope" while proving nothing. It
now derives exclusivity, token uniqueness, and non-return of released tokens
from the guards on acquisition, over a small step relation of its own, and both
mutants are caught.

I1, I7 and I14 are still assumptions in that file. They are checked by TLC,
Quint and fast-check, so nothing is lost, but the Alloy column is not evidence
for them.

The same shape appears three more times, all found by review rather than by any
tool:

- `alloy/DeliveryL2.als` had a `strengtheningExcludesTheCTI` check whose
  consequent was a strict weakening of its antecedent. `invIsInductive` was
  always the statement that wanted making.
- `dafny/Delivery.dfy` stated I5 over the free field `obligated` as
  `!d.obligated ==> !d.obligated`, mentioning settlement nowhere. `obligated`
  is now computed from an `Evidence` value, so a mutated `ObligatedFrom` breaks
  the lemma. It is still *definitional* rather than checked, which is the most
  the shape allows.
- Quint's `pauseBlocksAdmission` — added during this very audit, as I17's
  safety half — cannot fail either. `positionDiscipline` already pins
  `positions` to the tasks in a holding phase, and `Planned` is not one, so the
  predicate is true whether or not a pause is applied and `paused` is never
  consulted. It has been removed rather than left in `allInvariants`.

None of these reported anything. UNSAT, verified, UNSAT, and clean.

That last one is the honest summary of this whole exercise: the pass that went
looking for invariants which cannot fail added one, and it took another review
to notice.

### The temporal row

Quint states I17–I19 most cleanly of anything here and cannot check them —
Apalache stops at `Handling fairness is not supported yet!`. TLC discharges I17
at the benchmark size of two tasks in 28 seconds, but I18 and I19 only at one:
at two, I18 does not return a verdict in half an hour. Alloy answers all three
in about 131 seconds, reversing the ordering the safety results establish.
Dafny's `—`
is a genuine capability gap rather than a scope decision, and fast-check's pass
is vacuous: its witness counters show it never reaches the state I18
constrains.
