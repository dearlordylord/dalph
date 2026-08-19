# Interrupt tracker and Git waits during application Exit

Issue: [#206 Preserve interruptible tracker and Git calls during application Exit](https://github.com/dearlordylord/dalph/issues/206)

This file maps issue #206 to the accepted chronology in
[`issue-169-graceful-application-exit.md`](issue-169-graceful-application-exit.md).
It does not add an Exit-specific reconciliation path or change the
`applicationExit` model vocabulary.

## A supervisor exits while Dalph is waiting for the task tracker

Run R has one admitted delivery action. Dalph has appended the exact tracker
intent and sent its request. The tracker might have answered, but the local
fiber has no normalized result. A supervisor submits Exit. The shared cutoff
closes, the runtime interrupts only this local wait, and the owner records its
state as a recoverable ambiguity tied to the tracker family and exact
`OperationId`. The owner and process-local reservations disappear. The Run
journal retains the intent and no invented observation.

No fresh tracker read, duplicate request, rollback, cleanup, or successor
delivery action begins during the drain. If the process dies, ordinary Run
entry later presents the same operation to the existing journaled tracker
protocol. That protocol finds the intent without an outcome and checks the
tracker before any retry. The resulting normalized observation is recorded
under the same operation identity.

Acceptance evidence:

- `interrupts an admitted tracker owner under Exit and starts no successor action`
- `rebuilds the tracker application from its recovery projection and records the available response`
- `records the authored tracker interruption and ordinary replay cassette`
- `leaves an interrupted tracker request behind its exact acknowledged intent`

The cassette test replays the maintained supervisor-visible authored cassette
and compares its recorded Run cassette: intent only at the death cut, then the
same intent plus one observation after ordinary reopening.

## Exit arrives after Git has returned but before Dalph records the result

Run R has one admitted delivery action with an exact acknowledged Git intent.
Git returns a normalized result. Before the journal append finishes, Exit
closes the shared cutoff. Dalph marks the result as already produced, protects
only its recording step from interruption, records it, and releases the owner.
The action then stops instead of entering another Git or workflow phase.

Acceptance evidence:

- `records a produced Git result under Exit and starts no later protocol phase`
- `records immediately available tracker and Git results before releasing their owners under Exit`
- `rebuilds the Git application from its recovery projection and records the available response`

## Exit interrupts a Git wait and a later process reopens the Run

Dalph has appended an exact Git-read intent and is waiting for Git. Exit wins
the local wait, leaving only that intent in the Run journal. A later application
incarnation begins in `Serving`, enters the Run normally, and invokes the same
journaled Git protocol. Git is read before the outcome is recorded; the
operation identity is reused and no duplicate intent or alternate Exit recovery
mode appears.

Acceptance evidence:

- `records the authored Git interruption and ordinary replay cassette`

Its authored cassette records the supervisor Exit, local Git interruption,
process death, ordinary Run entry, and Git check before retry. Its journal tag
sequence is the recorded cassette: `GitReadIntentRecorded` at the interruption
cut, then `PlannedAttemptWorktreeObserved` after reopening.

The tracker and Git rebuild tests close the first application scope, cross the
raw journal's ordinary `readRunForRecovery` boundary, assert the exact pending
responsibility, and construct a fresh lifecycle and journaled interpreter over
the same durable journal before recording the available outside response.

## Cutoff reaches an acknowledged intent before its outside call starts

An admitted owner appends its exact intent, but the shared cutoff has already
closed when that owner tries to enter the local tracker/Git call state. Dalph
interrupts the owner without sending the call. The durable intent remains for
ordinary later reconciliation. This race does not authorize outcome inference
or a new drain action.

Acceptance evidence:

- `starts no tracker or Git call whose acknowledged intent reaches the owner after cutoff`

## Formal-model mapping

The production state uses the existing `applicationExit` actions
`acknowledgeOwnerAIntent`, `observeOwnerAKnownResult`, and
`interruptOwnerAWithRecoverableAmbiguity`. The decision-kernel test
`releases an ambiguous interruptible owner only behind acknowledged intent`
and the production-backed application Exit MBT retain these properties:

- `recoverableAmbiguityRequiresAcknowledgedExactIntent`;
- `knownBoundaryObservationRequiresItsAcknowledgedIntent`;
- `onlyEnumeratedQuickDrainActionsBeginAfterCutoff`; and
- `successfulExitRequiresRecoverableBoundary`.

Issue #206 changes the governed production adapter, not the Quint state or
transition relation. The final relevant `pnpm check:quint` therefore verifies
the unchanged specification and its negative controls after the adapter change.

## Deliberately deferred behavior

Executor fast suspension remains #205. Integration verification/evidence work
remains #207. Cleanup disposition preservation remains #208. Failure and the
fixed five-second forced-termination composition remain #209. This slice does
not classify those owners as tracker or Git calls and does not start their
policies during Exit.
