# Count one task once when provider correlation disagrees

Issue: [Derive the runnable frontier and bounded admission](https://github.com/dearlordylord/dalph/issues/131)

## Starting situation

No person directly triggers this behavior. The running Dalph coordinator has
configured two task-work positions. Task A has an outstanding workflow
operation, `expected-A`, so Dalph holds one position for task A while it checks
the task-work provider. Task B is independently runnable. The journal contains
the task-A intent and responsibility, but it does not persist the capacity
position.

Dalph asks the task-work provider for the current lifecycle of task A's exact
outer invocation. The provider returns a fresh active report for task A, but it
names `reported-A` instead of `expected-A`. An `OperationId` is Dalph's
identity for one exact workflow action. It connects the recorded intent,
provider request, fresh report, retry, and outcome. It is not the task ID or
provider session ID. The mismatch matters because Dalph cannot safely treat the
report as proof about `expected-A`. For example, stopping `reported-A` does not
prove that `expected-A` never started.

No GitHub task, Git ref, worktree, or executor session is changed merely by
applying this report.

## Dalph action and visible result

The activation code passes the normalized report to the capacity controller.
In order, the controller:

1. changes task A's one position to `CorrelationConflict`, recording expected
   `expected-A` and observed `reported-A`;
2. counts task A once, not twice;
3. explains the conflict for task A; and
4. admits task B into the second configured position.

For example, the capacity snapshot is `{ A: CorrelationConflict, B: Reserved }`
and its usage is two. It is never `{ expected-A: Reserved, reported-A:
Working, B: Waiting }`, because capacity belongs to tasks rather than
operations.

If configured capacity were one, task B would receive `CapacityWait` because
task A's unresolved position remains unavailable. The maintainer sees the two
operation identities in task A's explanation. Dalph must not discard the
provider report, invent a second position for task A, silently release task A,
or stop unrelated task B when another position exists.

## Crash and repeated observations

If Dalph crashes before or after applying the report, it loses the
process-local position state. Startup reconstructs task A's
`AwaitingProviderEvidence` state from the one current journal operation and
asks the provider again. Receiving the same mismatched active report recreates
the same one-position conflict.

A later matching active report for `expected-A` changes task A to `Working`.
A later matching terminal or absent report for `expected-A` changes task A to
`NotUsing`. A terminal report only for `reported-A` removes that observed
mismatch but does not prove the expected operation absent, so task A returns
to `AwaitingProviderEvidence` and still counts once. For example, Dalph must
ask again about `expected-A` before making task A's position available.

An unknown report preserves an existing `CorrelationConflict`, including both
operation identities. It cannot attach to a temporary `Reserved` position,
because Dalph has not recorded an `OperationId` at that point. For example,
unknown evidence after the mismatch keeps
`CorrelationConflict(expected-A, reported-A)`, while unknown evidence before
the task-A start intent cannot turn its temporary reservation into
`AwaitingProviderEvidence`.

There is no state-changing external request in this scenario, so request
acknowledgement loss and request retry do not apply. The repeated action is a
provider read. For example, repeating the same `reported-A` observation must
recreate one conflict rather than increasing capacity usage.

## Invalid journal history is different

Before frontier derivation, reconstruction validates that one task has at most
one current capacity-holding operation. If the journal itself contains two
unclosed current operations for task A, reconstruction fails with invalid
managed history. For example, current intents `expected-A-1` and
`expected-A-2` are not turned into two positions and are not described as an
ordinary provider mismatch. Unrelated work is not derived from invalid
managed-run history.

## Acceptance-test mapping

- `counts a mismatched provider operation once and admits another task at
  capacity two` must prove task A uses one position and task B uses the second;
  Quint test
  `mismatchedProviderOperationCountsTaskOnceAndAdmitsAnotherTaskTest` proves
  the model behavior.
- `keeps another task waiting behind one unresolved task at capacity one` must
  prove task A remains unavailable without being double-counted; Quint test
  `unresolvedTaskUsesTheOnlyPositionOnceTest` proves the model behavior.
- `requires a matching fresh report before making a conflicted task available`
  must prove that a terminal report for only `reported-A` does not release
  `expected-A`; Quint test
  `differentlyCorrelatedTerminalReportKeepsExpectedOperationHeldTest` proves
  the model behavior.
- `repeated mismatched reports do not increase capacity usage` must prove two
  identical task-A reads still count once; Quint test
  `repeatedMismatchedReportsKeepOneTaskPositionTest` proves the model behavior.
- `restart recreates the exact task-local correlation conflict` must prove
  Dalph discards the pre-crash observation, reads the provider again, and
  recreates the expected and observed identities; Quint test
  `restartRecreatesExactCorrelationConflictTest` proves the model behavior.
- `unknown provider evidence holds one position while matching absence
  releases it` must prove that an unreadable lookup cannot free task A and an
  exact absent report can; Quint tests
  `unknownProviderReportKeepsExpectedTaskPositionTest` and
  `absentProviderReportReleasesExpectedTaskPositionTest` prove the model
  behavior.
- `unknown evidence does not erase a correlation conflict` must prove that
  both task-A operation identities remain visible; Quint test
  `unknownReportDoesNotEraseDifferentlyCorrelatedActiveEvidenceTest` proves the
  model behavior.
- `provider evidence requires a recorded operation identity` must prove an
  unknown report cannot attach to task A's temporary pre-intent reservation;
  the `observeCapacityUnknown` model action enforces that boundary.
- `a matching interrupted report releases the expected task position` must
  prove that a provider-confirmed interruption makes task A not using
  capacity; Quint test
  `interruptedProviderReportReleasesExpectedTaskPositionTest` proves the model
  behavior.
- `rejects two current capacity operations for one task during reconstruction`
  must prove invalid journal history fails before frontier derivation; Quint
  test `rejectsTwoCurrentCapacityOperationsForOneTaskTest` proves the
  pre-validation rule.
- Quint tests with the same plain-language outcomes must pass before the
  TypeScript controller is changed.
