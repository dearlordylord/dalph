# Issue #131 task-scoped capacity implementation handoff

Issue: [#131](https://github.com/dearlordylord/dalph/issues/131)

## Non-negotiable executor boundary

Generic Dalph sees one opaque executor outer invocation for a task. The
review-loop executor alone interprets implementation, evidence capture,
reviewer invocation, findings handback, retry, restoration, and convergence
operations.

The two identity domains are deliberately distinct:

- `ExecutorOuterInvocationId` crosses the executor boundary and may appear in
  generic responsibility, frontier, admission, activation, wait,
  interruption, and outcome code.
- `OperationId` identifies an executor-internal action or another concrete
  Dalph workflow action. An executor-internal `OperationId` must not appear in
  generic capacity state or masquerade as an outer invocation identity.

Physical colocation in `packages/orchestrator` and shared journal storage do
not relax this boundary. Generic code gives opaque executor-owned history to
the injected executor bundle and consumes only its normalized outer
projection.

## Accepted behavior

1. Dalph owns configured task-work capacity. The executor does not request,
   declare, acquire, or release positions.
2. One read-only map keyed by `TaskId` is the sole process-local capacity
   representation. Absence means the task uses no position.
3. A map entry is `Reserved`, `AwaitingExecutorReport`, `Working`, or
   `ExecutorInvocationMismatch`.
4. Recording an outer invocation identity changes the temporary reservation
   to `AwaitingExecutorReport`.
5. A matching active outer report changes the same entry to `Working`.
6. A matching terminal, interrupted, or absent outer report removes the entry.
7. A report naming another outer invocation changes the same entry to
   `ExecutorInvocationMismatch`; it never creates another task entry.
8. Ending only the reported invocation returns the entry to
   `AwaitingExecutorReport` for the expected invocation.
9. An unknown report preserves an existing mismatch.
10. Two unfinished generic outer invocation responsibilities for one task are
    invalid history. Multiple executor-internal operations are not generic
    capacity holders and are validated only by the executor.
11. An executor report cannot attach before the outer invocation identity is
    recorded.

## Production correction

Replace every capacity-controller `OperationId` correlation with
`ExecutorOuterInvocationId`. Rename provider-oriented controller inputs to
executor outer reports: the executor may query providers internally, while
generic admission receives only the normalized outer result.

Remove the generic activity-to-capacity mapping containing
`TaskExecution`, `ImplementationEvidenceSealing`, `ImplementationReview`,
`ReviewFindingsHandback`, or `ImplementationDisposition`. Those names describe
the review-loop executor's internal algorithm. Generic Dalph decides only
whether starting or continuing the opaque executor invocation requires one
position.

Remove `occupied`, `reservedPositions`, and `reservedTaskIds`. They are
unreleased compatibility projections and are not greenfield requirements.
Expose only:

```text
ReadonlyMap<TaskId, TaskWorkPosition>
```

Update the executor boundary so generic modules cannot accept an internal
`OperationId` where an outer invocation identity is required. Until issue #158
finishes the physical module extraction, every remaining source-level
violation must carry an explicit #158 boundary warning and must not be copied
into new generic code.

## Required tests

- `counts a mismatched executor invocation once and admits another task at
  capacity two`
- `keeps another task waiting behind one unresolved executor invocation at
  capacity one`
- `requires a matching executor report before making a mismatched task
  available`
- `repeated mismatched executor reports keep one task position`
- `restart asks the executor again and recreates the outer invocation
  mismatch`
- `unknown executor evidence holds one position while matching absence
  releases it`
- `matching interrupted executor evidence releases the task position`
- `rejects two unfinished outer executor invocations for one task before
  frontier derivation`
- `executor cannot declare task-work capacity`
- `executor report requires a recorded outer invocation identity`
- `generic capacity code contains no review-loop stage vocabulary`
- `generic orchestration uses a stage-name-free executor bundle`

The test executor's private payload and stage name must not contain
implementation, evidence, review, findings, handback, retry, or convergence
vocabulary. Existing review-loop tests continue proving the internal algorithm
beside, not through, generic admission tests.

## Quint and executable projection

The frontier model represents task-keyed positions correlated by
`ExecutorOuterInvocationId`. Rename correlation-conflict variants and fields to
outer-invocation mismatch terminology. The executable projection must compare
the exact read-only map, including expected and reported outer identities.

No Quint state, action, test, decoder, or TypeScript projection may describe an
implementer, evidence, reviewer, findings-handback, or convergence operation
as a generic capacity holder.

## Tracker reconciliation

- #131 owns task-keyed capacity using only opaque outer invocation reports.
- #158 owns the enforced review-loop executor module and injected bundle. #131
  must not encode internal stages while waiting for that extraction.
- #133 remains closed as historical boundary work; its executor-declared
  capacity wording is superseded.
- #127 owns future multiple/configurable executors, not the v1 identity
  boundary.
- #54 counts tasks and outer invocation mismatches, never internal operations.
- #159 owns the measured timeout increase needed for `pnpm check:all`.

## Scenario-to-test handoff requirement

The final implementation handoff must enumerate every scenario in
`docs/scenarios/issue-131-conflicting-capacity-observation.md`, its passing
TypeScript test, its Quint proof, and any behavior deferred to #158. Aggregate
test totals do not replace this mapping.

## Proposed project memory

Publish from the root agent in `master` after merge:

> Generic Dalph admits and observes only opaque executor outer invocations;
> implementation, evidence, review, findings-handback, retry, restoration, and
> convergence operations and identities remain private to the executor even
> when their history shares Dalph journal storage.
