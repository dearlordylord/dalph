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

## Coverage expectations per tool

`—` means the tool cannot state the invariant at all, which is itself a result
worth recording in `SCOREBOARD.md`.

| Invariant | Quint/Apalache | TLA+/TLC | Alloy 6 | Dafny | Lean 4 | Agda | fast-check |
|---|---|---|---|---|---|---|---|
| I1–I3 | yes | yes | yes | yes | yes | yes | yes |
| I4–I6 | yes | yes | yes | yes | yes | typed away | yes |
| I7–I15 | yes | yes | yes | partial | costly | costly | stateful PBT |
| I16–I19 | I16–I17 | yes | yes | — | — | — | — |
