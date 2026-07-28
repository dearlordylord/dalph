# Issue #131 task-scoped capacity implementation handoff

Issue: [#131](https://github.com/dearlordylord/dalph/issues/131)

This handoff prepares a fresh `/implement` session. It changes the accepted
specification and model, but deliberately does not repair the production
controller.

## Accepted behavior

1. Dalph owns capacity. The executor does not request, declare, acquire, or
   release it. For example, Dalph says that continuing task A through the
   executor requires one position, while a GitHub-only read requires none.
2. Capacity is keyed by `TaskId`. One task uses zero or one position. For
   example, task A cannot use one position for `expected-A` and another for
   `reported-A`.
3. A task normally moves through `NotUsing`, `Reserved`,
   `AwaitingProviderEvidence`, `Working`, then `NotUsing`. For example,
   recording intent changes task A's temporary reservation into a position
   retained under its durable `OperationId`.
4. A matching active provider report changes the task to `Working`. For
   example, an active report for `expected-A` confirms the position already
   held for `expected-A`; it does not add a position.
5. A matching terminal, interrupted, or absent report changes the task to
   `NotUsing`. For example, an absent report for `expected-A` makes task A's
   position available.
6. A report for a different operation creates one `CorrelationConflict`. For
   example, expected `expected-A` plus active `reported-A` keeps one task-A
   position unavailable and exposes both identities.
7. A terminal report only for the differently correlated operation does not
   release the expected operation. For example, after `reported-A` stops, task
   A returns to `AwaitingProviderEvidence` for `expected-A`.
8. An unknown report does not erase a correlation conflict. For example,
   expected `expected-A`, observed active `reported-A`, then unknown still
   keeps both identities in `CorrelationConflict`. After `reported-A` ends,
   Dalph must get a fresh active, terminal, interrupted, or absent report for
   `expected-A` before changing the task to `Working` or `NotUsing`.
9. Two current capacity-holding operations for one task in the journal are
   invalid managed history. For example, two unclosed current task-A intents
   fail reconstruction before Dalph derives a frontier.
10. Provider evidence cannot attach to a temporary `Reserved` position because
    Dalph has not recorded an `OperationId` yet. For example, an unknown
    provider result received before task A's start intent cannot change its
    reservation to `AwaitingProviderEvidence`.

## Why `OperationId` matters

An `OperationId` names one exact Dalph workflow action. It links the intent,
request, provider result, retry, and outcome. It is not the task ID, attempt ID,
or provider session ID.

For example, task A can have operation `start-A-7` and later operation
`review-A-8`. A provider report for `review-A-8` says nothing conclusive about
whether `start-A-7` started. Dalph therefore keeps task A unavailable and
reports the mismatch instead of silently releasing it.

## Production gap to implement

The current controller separately counts `occupied.length` and
`reservations.length`. A provider report with another `OperationId` can
therefore count task A twice. The implementation must replace those two
independent collections with one task-keyed state.

The current executor boundary also exposes executor-owned resource use. The
implementation must replace that source with Dalph's task-work capacity
requirement. For example, the generic transition or orchestration policy says
whether the next task-A action needs a position; the executor only reports its
external invocation lifecycle.

Do not edit the reducer prototype at
`/workspace/typescript/dalph-worktrees/issue-131-reducer-lab`. It is preserved
research, not the implementation base.

## Required TypeScript tests

- `counts a mismatched provider operation once and admits another task at
  capacity two`: task A is conflicted and task B receives the second position.
- `keeps another task waiting behind one unresolved task at capacity one`:
  task A counts once and task B waits.
- `requires a matching fresh report before making a conflicted task available`:
  stopping only the differently correlated operation keeps task A retained.
- `repeated mismatched reports do not increase capacity usage`: applying the
  same task-A provider report twice still reports one used position.
- `restart rereads the provider and recreates the exact correlation conflict`:
  a pre-crash report is discarded, then a fresh mismatched report recreates
  expected and observed identities.
- `unknown evidence holds one position while absence releases it`: an
  unreadable task-A lookup cannot make capacity available, while a fresh
  matching absent report can.
- `matching interrupted evidence releases the task position`: a provider
  report that the expected task-A invocation stopped makes the position
  available.
- `rejects two current capacity operations for one task during reconstruction`:
  invalid journal history fails before frontier derivation.
- `executor cannot declare task-work capacity`: the outer executor interface
  has no capacity acquisition, declaration, or release field.
- `provider evidence requires a recorded operation identity`: an unknown
  provider result cannot attach to task A's temporary pre-intent reservation.

Write the controller tests first so the first four demonstrate the current
bug before production code changes. Keep failing tests local until the repair
lands in the same implementation commit; master must remain green.

## Quint evidence already present

- `mismatchedProviderOperationCountsTaskOnceAndAdmitsAnotherTaskTest`
- `differentlyCorrelatedTerminalReportKeepsExpectedOperationHeldTest`
- `repeatedMismatchedReportsKeepOneTaskPositionTest`
- `restartRecreatesExactCorrelationConflictTest`
- `unknownProviderReportKeepsExpectedTaskPositionTest`
- `unknownReportDoesNotEraseDifferentlyCorrelatedActiveEvidenceTest`
- `absentProviderReportReleasesExpectedTaskPositionTest`
- `interruptedProviderReportReleasesExpectedTaskPositionTest`
- `rejectsTwoCurrentCapacityOperationsForOneTaskTest`
- `unresolvedTaskUsesTheOnlyPositionOnceTest`
- `capacityUsageCountsTasksNotOperationCorrelations`
- `correlationConflictRetainsOneTaskPosition`
- `currentCapacityHistoryIsValid`

For example, the capacity-two Quint test starts with task A in one correlation
conflict, proves usage is one, reserves task B, and proves total usage is two.

## Delivery order for the fresh `/implement` session

1. Pull current `master` and read the issue, canonical specification, scenario,
   ADR, architecture section, and this handoff. For example, confirm the issue
   still names task-scoped capacity before editing code.
2. Add every TypeScript test above. For example, the capacity-two test must
   fail because the old controller counts task A's reservation and report
   separately.
3. Introduce branded task-keyed capacity states and typed correlation conflict.
   For example, one `Map<TaskId, TaskCapacityState>` entry contains both
   expected and observed operation identities.
4. Move capacity requirement ownership out of the executor boundary. For
   example, a transition requiring provider work carries Dalph's requirement,
   while a tracker-only transition requires zero.
5. Update reconstruction and activation together. For example, reconstruction
   rejects two current task-A capacity operations before the controller sees
   them.
6. Update Quint-connect decoding only where production projections changed.
   For example, decode the conflict variant without adding an
   operation-keyed occupancy collection.
7. Run focused tests, model gates, `pnpm check:all`, and the three required
   review passes. For example, reject any review suggestion that restores two
   independent capacity collections because it violates the task-keyed model.
8. Close #131 only after the issue's scenario-to-test mapping names passing
   TypeScript and Quint evidence. For example, a green capacity-two test must
   be linked before closure.

## Related tickets

- #132 remains closed. Its activation identity work is reused; for example,
  post-intent capacity stays correlated by the durable `OperationId`.
- #133 remains closed, but its executor-declared capacity clause is superseded.
  For example, source-boundary work remains useful while capacity ownership
  moves back to orchestration.
- #158 is blocked by #131 because its executor source boundary must expose
  lifecycle reports without capacity declarations.
- #54 depends on the task-scoped state because resizing must count tasks, not
  operation correlations.
- #159 separately owns hosted-CI model timing. It does not change capacity
  semantics; for example, increasing a timeout is not a fix for double-counting
  task A.
