# Delivery invariant benchmark

**This is a benchmark, not the specification.** `docs/DELIVERY-INVARIANTS.md`
holds the specification, numbered `D1`–`D37`. Each entry here is a projection of
one or more `D` entries, chosen so that seven very different tools could all
encode it at a size where they all finish. Several projections are weakened, and
the weakening is what the study is about.

| Benchmark | Projects | Weakened |
|---|---|---|
| I1 bound | D6 | upper bound only in Quint; graph order unstated |
| I2 order independence | D7 | |
| I4 retention | D10 | |
| I5 settlement drop | D24 | settlement drop only, not the general no-inferred-completion rule |
| I6 no invention | D11 | |
| I7 position discipline | D12 | no correlation on the report |
| I8 admission ceiling | D13 | unevenly: a history flag in three tools, a bare guard in four |
| I9 exact correlation | D1 | correlation only, and only in the fast-check journal arm |
| I10 one attempt | D3 | |
| I11 claim exclusivity | D4 | |
| I12 candidate shape | D26 | |
| I13 promotion | D27 | no reconciliation branch |
| I14 authority separation | D29 | |
| I15 journal | D32 | reduction only; record admission is D32a |
| I16 recovery | D31 | no identity outside the journal arm, so "the same attempt" is unstateable |
| I17 pause | D20, D47 | run-wide pause only, no subject scoping, and no receipt step |
| I18 no silent drop | D33 | the no-new-facts hypothesis is inexpressible where the task set is constant |
| I19 quiescence | D34 | |

Thirty-two specification entries project to nothing here. That is the study's
main finding, not a gap in this table: no encoding carries a worktree, an intent
record, observation quality, an actor, an integration session, a queue, an
Operator request, or more than one Run.

This catalog is temporary; it survives because the mutant catalog, the seven
tool encodings, the scoreboard, and the coverage index all reference its numbers.
`docs/DELIVERY-INVARIANTS.md` is the authority when the two disagree.

The fixed benchmark for the verification bake-off. Every tool under
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

Production encodes I8 correctly. The ceiling is consulted only at the moment of
admission, in `reserveReusableTaskPosition`
(`packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.ts`),
and `synchronize` adopts a new capacity while retaining every existing position.
No production predicate asserts `|positions| ≤ capacity`.

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

**I18 No silent drop.** Once the run stops crashing, is not paused, has
capacity, and receives no further tracker facts, every begun responsibility
eventually settles or is retained together with an exact stated reason.

The antecedent is load-bearing. Against an environment that keeps supplying new
tickets forever there is nothing to prove, so the property is meaningless
without it. The encodings supply the first three hypotheses —
`eventuallyStable`, `eventuallyRunning` and `eventuallyRoomy` at
`quint/deliveryCore.qnt:592-594`, and the same triple in `alloy/` and
`tlaplus/`. None of those three supplies the fourth: `TASKS` is a fixed
two-element set in each, so a ticket arriving mid-run cannot be written down
there.

Arrival is not unwriteable in general. `tlaplus/DeliveryArrival.tla` models it
directly, with `NewTaskArrives`, `SealGraph`, and a quiescence property over an
unsealed graph. What it establishes is that arrival is undecidable at this
size rather than inexpressible: TLC returns no verdict on the uncapped run, and
the capped run is unsound for a liveness claim. So "tickets added to the graph
mid-run" is outside the reach of every liveness *result* here, which is a
statement about tractability, not about expressiveness.

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
| I4 retention | checked | checked | definitional | checked | checked | checked | checked |
| I5 settlement drop | definitional | definitional | definitional | definitional | not modelled | not modelled | definitional |
| I6 no invention | typed away | typed away | typed away | typed away | typed away | typed away | typed away |
| I7 position discipline | checked | checked | assumed (L1), checked (L2) | checked | checked | checked | checked |
| I8 admission ceiling | history flag | history flag | guard (L2) | loop invariant | guard + **dead flag** | guard | history flag |
| I9 exact correlation | **not modelled** | **not modelled** | **not modelled** | **not modelled** | **not modelled** | **not modelled** | checked (journal arm) |
| I10 one attempt | checked | checked | checked | checked | checked | checked | checked |
| I11 claim exclusivity | **not modelled** | **not modelled** | **checked** | **not modelled** | **not modelled** | **not modelled** | **not modelled** |
| I12 candidate shape | **not modelled** | **not modelled** | **checked** | **not modelled** | **not modelled** | **not modelled** | **not modelled** |
| I13 promotion | history flag | history flag | guard (L2) | guard | guard + **dead flag** | guard | history flag |
| I14 authority separation | checked | checked | assumed (L1), checked (L2) | checked | checked | checked | checked |
| I15 journal | **not modelled** | **not modelled** | **not modelled** | **not modelled** | **not modelled** | **not modelled** | checked |
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

**I9 and I15 exist only in the fast-check journal arm.** The six L1/L2 models
carry no `RunId`, no `AttemptId`, and no journal; `oneAttemptPerTask` counts
attempts and never names one. `fastcheck/journal.mjs` is the exception: it
carries the 23-event alphabet of `JOURNAL-EVENTS.md`, correlates attempt-scoped
events on `(runId, attemptId)`, and enforces Run-scoping as fold guards — an
event after `WorkflowRunTerminated` and an attempt planned under a foreign
`runId` are both rejected. `fastcheck/journal-run.mjs` checks the four
propositions and `fastcheck/journal-mutants.mjs` the negative controls.

So the comparison says nothing about exact correlation or the journal, because
six of seven tools do not reach them — not because nothing is built.

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

## Coverage per production surface

The table above answers "which tool states this invariant". It cannot answer
"does anything check the shipped code", because six of the seven tools touch no
production code at all. This section answers the second question, one surface at
a time.

A surface is a named production function. The binding kind says how evidence
reaches it:

| | |
|---|---|
| **types** | the defect is unrepresentable, so nothing needs to run |
| **property** | generated inputs, production function, assertion on its output |
| **example** | fixed inputs, production function |
| **MBT** | a model's traces replayed into production through a driver |
| **model only** | a tool encodes the invariant and reaches no production code |
| **none** | nothing |

Only **MBT** and **property** scale with the input space. **model only** is the
cell to read carefully: it is exactly as strong as the claim that the model
resembles the code, and nothing discharges that claim.

### `frontierOf` — arrow 1 of `delivery.ts`

`packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.ts:53`.
Pure, `DeliveryGraphPublication → DeliveryFrontier`. Classifies every task in an
established graph as `Eligible` or `Excluded` with at least one graph-owned
reason. No policy, no bound, no evidence.

| Property | Binding | Artifact | What it reaches |
|---|---|---|---|
| exclusion-reason totality | types | `DeliveryFrontierStanding` in `relations.ts:113` | `reasons` is `readonly [X, ...X[]]`, so a reason-free exclusion is unwriteable |
| exhaustive classification | example | `ticket-delivery-projection.test.ts:162` | one graph of five tasks covering `Eligible` and all three exclusion reasons |
| prerequisite order | example | `:182` | two unsatisfied prerequisites, asserted sorted |
| publication coherence | example | `:148` | `frontier.source` and `frontier.publication` are asserted with `toBe`, so the accepted observation is carried, not rebuilt |
| I2 order independence | property, transitive | `ticket-delivery-projection.property.test.ts:46` | the `toSorted` at `ticket-delivery-projection.ts:67` is the mechanism; the assertion is on arrow 2's output |
| empty graph | example | `:225` | `GraphNotEstablished` yields no standings |

**Gap — the two-reason case is unreachable in every test.** `exclusionsFor`
(`:32`) returns `[...lifecycle, PrerequisitesIncomplete]`, so a task that is
closed *and* has an unsatisfied prerequisite carries two reasons. Nothing
constructs one. `:162` gives each task a single cause; the property test's
`prerequisitesIncomplete` case forces `Open` and its two closed cases force
empty `prerequisiteIds`. The type admits the state, a tracker can produce it,
and no test or model has ever evaluated it.

**Gap — the inner sort has no generated coverage.** `prerequisiteTaskIds` is
sorted at `:46` and asserted once, at two elements. The outer sort over tasks is
covered by generation; this one is not.

**Note on I3.** The catalog no longer carries an exhaustive-classification
invariant, because the Quint form restated the definition of eligibility and
every other tool made the defect unwriteable. That is a statement about the
models. Production classification is still checked here, by example, on real
reason content — the removal took away a vacuous model cell, not a test.

**No MBT cell, and none is possible.** Pure function, no transition system.

### `boundedParallelTicketsOf` — arrow 2 of `delivery.ts`

`packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.ts:72`.
Pure, `DeliveryFrontier → BoundedParallelTickets`. Applies deterministic graph
order and configured capacity; live positions are not an input.

| Invariant | Binding | Artifact | What it reaches |
|---|---|---|---|
| I1 bound | property | `ticket-delivery-projection.property.test.ts:46` | exact output, not a weaker invariant: `selectedTicketIds(...)` is pinned to `ids.toSorted().slice(0, capacity)` |
| I2 order independence | property | same test | the task array is shuffled per sample and the expected output is unchanged |
| placement totality | types | `BoundedTicketPlacement` in `relations.ts:137` | a task with no placement, or a `GraphExcluded` with no reason, is unwriteable |
| rank domain | types | `BoundedTicketRank`, branded non-negative | a negative or unbranded rank cannot enter |
| I1, I2 | model only | the seven L1 encodings under `research/verification-bakeoff/` | no production code |

**Gap.** The property generates only `Open` tasks with empty `prerequisiteIds`,
so `|Eligible| = |tasks|` in every sample and the `min` in I1 is never exercised
against a graph that excludes anything. Exclusion is covered by example in
`ticket-delivery-projection.test.ts`, not by generation. Widening the generator
to emit lifecycles and prerequisites would put I1 and I2 on the same footing.

**No MBT cell, and none is possible.** The function is pure, so there is no
transition system for a trace to drive. Every arrow of `delivery.ts` has this
shape. The state machines that do want MBT — `runDeliveryRuntime`,
`makeDeliveryRuntimeAdmissionController`, and the journal fold — are not arrows
in that composition, which is why this index is organised by surface rather than
by arrow.

### `ticketDeliveriesOf` — arrow 3 of `delivery.ts`

`packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.ts:243`.
Pure, `(BoundedParallelTickets, evidence[]) → TicketDeliveries`. Joins desired
placement to exact retained evidence: a task appears iff it is selected now or
lower evidence still gives Dalph work to settle. The densest function in L1 and
the only one carrying three invariants at once.

| Property | Binding | Artifact | What it reaches |
|---|---|---|---|
| I4 retention | property | `ticket-delivery-projection.property.test.ts:85` | the obligation is asserted retained across `Selected`, `EligibleOutsideBound`, all three `GraphExcluded` reasons, and `AbsentFromCurrentGraph` |
| I4 retention | example | `ticket-delivery-projection.test.ts:268`, `:285`, `:359` | three responsibility kinds, and retention across a capacity contraction |
| I6 no invention | types | `obligationFrom` at `:168` | it switches on the evidence tag and never takes `placement` as a parameter, so placement cannot mint an obligation |
| evidence conflict | example | `:463`, `:476` | duplicate identity isolated per task, each distinct identity reported once |
| disposition totality | example | `:304`, `:441` | ten executor and four workflow dispositions, each asserted to produce one standing and invent no label |
| terminal knowledge | example | `:373`, `:400` | retained until the graph establishes success, then dropped |
| absent placement | example | `:225`, `:268` | `GraphNotEstablished` and `AbsentFromCurrentGraph` |
| I5 settlement drop | example, half | `:418` | `Settled` only |
| I4, I5, I6 | model only | the seven L1 encodings | no production code |

**Gap — the five integration evidence tags reach the function only indirectly,
on one path.** Production constructs all five: `AcceptedAwaitingIntegration`,
`QueuedIntegration`, `StartedIntegration` and `IntegrationCandidate` in
`journaledIntegrationEvidenceOf` (`delivery-evidence.ts:45-56`), and
`IntegrationWait` in `reactive-delivery-relations.ts:69`. No test that calls
`ticketDeliveriesOf` directly supplies any of them; every direct call passes
`ResponsibilityFacts` or `SyntheticExecutorFacts`. Four of the five arrive only
through one recovery test — `recovered-settlement-relation.test.ts:243`, which
builds the full reactive relation and so reaches the function through
`in-memory-relations.ts:153` — and only on its happy path.

The consequence for I4 is narrower than the tag count suggests but still real:
the three tags for which `obligationFrom` returns an obligation are exercised
on one trajectory, chosen for a different purpose, with no generated coverage
and no failure cases.

**Gap — two of `candidateStandingFrom`'s three branches are unreached.** Its
branches at `:185` distinguish `CandidateConstructed`, the two limit-reached
states, and active work. The `CandidateConstructed` branch is exercised by the
recovery test above, which asserts that state before building the relation. The
limit-reached branch — `IntegrationNonConvergencePreserved`, which classifies
non-convergent integration as retained rather than settled — is not, and that
is I18's second disjunct. Neither is the `CandidateWorkActive` fall-through.

**Gap — I5 is half-tested.** `evidenceStillDescribesDelivery` at `:158` drops
`Settled` and `TaskExternalSuccessSettled`. Only `Settled` has a test. The
external-success path appears in `frontier.test.ts` and the task-fact
conformance spec, never as evidence dropped here.

**No MBT cell, and none is possible.** Pure function, no transition system.

### `deliverySettlements` — arrow 4 of `delivery.ts`

`DeliverySettlementProjection`, declared in `relations.ts:653` and implemented
once, at `in-memory-relations.ts:161`. `TicketDeliveries → DeliverySettlements`.
The projection's `current` is `makeDeliverySettlements(deliveries, [])` — the
settlement list is a literal empty array, and the journaled, synthetic, and
recovered modes all build on this layer, so it is empty in every mode.

| Property | Binding | Artifact | What it reaches |
|---|---|---|---|
| settlement set is empty | example | `delivery.test.ts:152`, `:526`, `delivery-consequences.test.ts:160` | asserted `[]`, including after a relation is reconstructed on restart |
| source-chain identity | example | `delivery-consequences.test.ts:212` | `settlements.source === ticketDeliveries` and `trackerConsequences.source === settlements`, compared by reference |
| settlement partition is empty under a fixture | example | `delivery.test.ts:333` | the stream is exposed without performing an action; `:350` asserts the partition is `[[]]` |
| `DeliverySettlement` construction | none | — | no production code constructs one |
| I18 first disjunct | none | — | see below |

**This is deliberate scope, and the code says so.** `relations.ts:246` reads
"Established settlements only; current production honestly supplies none", and
the test is named "assembles the literal delivery relation with honestly empty
settlements". The emptiness is pinned by assertion rather than left to drift.

**The arrow is inert as a value and live as a router.** Its `current` is always
empty, but its `proposedActions` selects the `deliverySettlement` partition of
`deliveryProposalContributions`, and that partition is non-empty whenever
`isSettlementTransition` holds (`delivery-proposal-derivation.ts:411`). So
settlement *actions* are proposed and executed while the settlement *relation*
stays empty. Those are two different notions of settlement sharing one name.

**Nothing reads the value.** `run-delivery-runtime.ts` never mentions
`settlements` or `reflection`. `deliveryFinalityOf` (`relations.ts:514`) derives
from `ticketDeliveries.deliveries`, `proposedActions`, `quiescence` and
`trackerGraph`, and never from settlements. A settlement, if one were ever
constructed, would change no decision today.

**Consequence for the study.** I18 is "every begun responsibility eventually
settles or is retained with a stated reason". Production has no path to the
first disjunct at this arrow, so retention is the only outcome the delivery
relation can express. The L2 models carry a `Settled` phase that terminates a
ticket; this arrow has no counterpart to it.
`ResponsibilityDisposition.Settled` is a different concept at a different level,
consumed by arrow 3 through `evidenceStillDescribesDelivery`. The bake-off's
`definitional` verdict on I5 and the temporal claims about I18 should be read
against that: the tools agree with each other about settlement, and production
does not implement the thing they agree about.

### `reflectDeliverySettlements` — arrow 5 of `delivery.ts`

`DeliveryReflectionProjection`, declared in `relations.ts:664` and implemented
once, at `in-memory-relations.ts:174`. `DeliverySettlements → DeliveryReflection`,
then `makeDeliveryConsequences` (`relations.ts:297`), applied by
`reflectDeliverySettlements` at `relations.ts:711`.

The projection is `mapCurrentSignal(relation.current, makeDeliveryReflection)`,
and `makeDeliveryReflection` (`relations.ts:275`) stores its argument in a
branded wrapper and computes nothing. Its `proposedActions` is
`reflectionProposals`, which is `[]` in the journaled mode
(`reactive-delivery-relations.ts:198`), `[]` in the synthetic mode
(`synthetic-delivery-relations.ts:137`), and defaults to `noActions` in memory.

| Property | Binding | Artifact | What it reaches |
|---|---|---|---|
| chain reconstruction | example | `delivery-consequences.test.ts:212` | `makeDeliveryConsequences` (`relations.ts:297`) rebuilds all five values by walking `.source`, asserted by reference identity |
| reflection emits no actions | example | `delivery-consequences.test.ts:292` | `proposedActions` collected and empty |
| tracker reflection | none | — | no production code writes a tracker consequence |

**The one thing this arrow establishes is causal coherence, and it does it by
construction.** `makeDeliveryConsequences` takes only the reflection and
recovers frontier, tickets, deliveries and settlements by following `.source`
backwards. The chain is a linked list, so every field of a `DeliveryConsequences`
provably descends from one accepted tracker observation. A value assembled from
two different observations is not merely untested — it is unconstructible. That
is the strongest form of `typed away` in the study, and no invariant number
covers it.

**Everything else here is empty.** Its input is the always-empty settlement set
of arrow 4, so reflection has nothing to reflect; and it proposes no actions in
any mode. Tracker reflection — writing delivery outcomes back to the tracker —
is designed, typed, wired, and unimplemented.

**No MBT cell, and none is possible.** Pure projection, no transition system.

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
