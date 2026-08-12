# Application Exit model, decision-kernel, and test mapping

Issue 203 implements the decision layer for the chronology accepted in
[`issue-169-graceful-application-exit.md`](issue-169-graceful-application-exit.md).
The concrete shared admission gate, clock, fibers, boundary interruption, and
process termination remain the runtime work of issues 204-210. The kernel does
not perform those effects and is not a second runtime or authority.

## Scenario names

The tables use these short names for the accepted chronological scenarios:

- **Idle** — Alice exits while no boundary call, live action owner, or unfinished
  executor-work responsibility is active.
- **Outside call** — a supervisor exits during a tracker or Git call.
- **Executor** — Alice exits while executor work is running.
- **Atomic** — Exit arrives during a non-interruptible atomic boundary.
- **Death** — Dalph dies before the requested Exit has a successful result.
- **Timeout** — the original drain reaches five seconds.
- **Failure** — a quick drain operation fails conclusively.
- **Restart** — startup after success and ambiguous interruption is identical.
- **Races** — Exit races with Pause, Unpause, termination, or another Exit.
- **Several Runs** — startup rejects several unfinished Runs before activation.

## Every canonical action mapped to a scenario

| Scenario | Exact `applicationExit` actions | Why the action is present |
| --- | --- | --- |
| Idle, Restart | `init` | Construct process-local serving state with no restored Exit lifecycle. |
| Outside call | `acknowledgeOwnerAIntent`, `acknowledgeOwnerBIntent`, `prepareInterruptibleOwnerA`, `prepareInterruptibleOwnerB`, `registerOwnerA`, `registerOwnerB`, `observeOwnerAKnownResult`, `observeOwnerBKnownResult`, `interruptOwnerAWithRecoverableAmbiguity`, `interruptOwnerBWithRecoverableAmbiguity` | Admit an exact outside call before cutoff, then record its already-known result or release only behind acknowledged intent. |
| Atomic | `prepareAtomicOwnerA`, `registerOwnerA`, `finishAtomicOwnerA` | A pre-cutoff atomic owner either returns inside the original drain or remains live until timeout. |
| Races | `prepareTerminationAppendOwnerA`, `registerOwnerA`, `finishAuthorizedTerminationAppendA`, `applyPauseBeforeCutoff` | Only the Run-termination append already authorized before cutoff may finish; an earlier Pause stays durable. |
| Executor | `startAttemptA`, `startAttemptB`, `recordAttemptASuspensionIntent`, `recordAttemptBSuspensionIntent`, `callFastSuspensionA`, `callFastSuspensionB`, `reportAttemptASafelySuspended`, `reportAttemptBSafelySuspended`, `reportAttemptATerminal`, `reportAttemptBTerminal`, `failFastSuspensionA` | Preserve exact attempt correlation and release a task-work position only for its safe-or-terminal evidence. |
| Idle, Failure | `produceJournalWrite`, `acknowledgeProducedWrite`, `failProducedWrite`, `holdReservation`, `releaseReservation`, `openFiber`, `closeFiber`, `releaseCoordinatorLock` | Settle only already-produced writes and release process-local resources; no new workflow work begins. |
| Idle, Outside call, Executor, Atomic, Death, Timeout, Failure, Races | `acceptExit` | Linearize the first request with the process-wide admission cutoff. |
| Failure, Races | `joinExit` | A later caller joins the same tick and result instead of starting another drain. |
| Idle, Executor, Atomic | `reportSuccess`, `stopAfterSuccess` | Report the recoverable result before requesting graceful status zero. |
| Failure | `reportFailure`, `forceAfterFailure` | Wait for useful independent quick work, retain diagnostics, then request forced nonzero termination. |
| Atomic, Death, Timeout, Failure, Races | `advanceTick` | Advance the one monotonic five-tick drain; the fifth transition atomically times out and forces termination. |
| Death | `unexpectedDeath` | Distinguish disappearance before a result from graceful success, failure, and timeout. |
| Restart | `restartApplication` | Re-enter through fresh serving lifecycle state while ordinary durable workflow facts remain. |
| All enterable model scenarios except Several Runs | `step` | Close the canonical transition relation over exactly the actions above. |
| Several Runs | no `applicationExit` action | V1 rejects this starting situation in `runActivation` before an application Exit lifecycle can begin. |

`registerOwnerA` intentionally appears in three rows because its prepared owner
kind is the typed input. No action after `acceptExit` can prepare or register a
new owner.

## Every canonical invariant and witness mapped to a scenario

| Scenario | Exact invariant properties | Independent negative controls |
| --- | --- | --- |
| Idle, Atomic, Races | `cutoffClosesAtMostOncePerApplicationIncarnation`, `preparingAdmissionNeverSurvivesTheCutoff`, `forwardOwnerRegistrationRequiresServing` | `secondCutoffIsDetectedTest`, `preparationStraddlingCutoffIsDetectedTest`, `postCutoffRegistrationIsDetectedTest` |
| Failure, Races | `joinedRequestNeverResetsTheDrain`, `joinedRequestsReceiveOneSharedResult` | `joinedRequestTimerResetIsDetectedTest`, `joinedRequestResultDivergenceIsDetectedTest` |
| All drain scenarios | `onlyEnumeratedQuickDrainActionsBeginAfterCutoff` | `forbiddenDrainActionsAreDetectedTest` starts every forbidden family. |
| Outside call | `recoverableAmbiguityRequiresAcknowledgedExactIntent`, `knownBoundaryObservationRequiresItsAcknowledgedIntent` | `unacknowledgedAmbiguityIsDetectedTest`, `unacknowledgedKnownObservationIsDetectedTest` |
| Executor | `exactSafeOrTerminalEvidenceControlsPositionRelease`, `fastSuspensionRequiresAcknowledgedCommandIntent` | `foreignExecutorReleaseIsDetectedTest`, `unsafePositionReleaseIsDetectedTest`, `fastCallWithoutIntentIsDetectedTest` |
| Idle, Outside call, Executor, Atomic | `successfulExitRequiresRecoverableBoundary` | `unsafeSuccessIsDetectedTest` |
| Failure | `conclusiveFailureWaitsForUsefulQuickWork` | `earlyConclusiveFailureIsDetectedTest` |
| Atomic, Timeout | `fifthTickAtomicallyForcesTimedOutTermination` | `timeoutBeforeFifthTickIsDetectedTest`, `fifthTickWithoutForceIsDetectedTest` |
| Failure, Timeout | `failureAndTimeoutRequestNonzeroForcedTermination` | `zeroStatusFailureIsDetectedTest`, `fifthTickWithoutForceIsDetectedTest` |
| Idle | `successReportsBeforeGracefulProcessEnd` | `gracefulStopWithoutReportIsDetectedTest` |
| Death | `unexpectedDeathNeverReportsGracefulSuccess` | `unexpectedDeathSuccessIsDetectedTest` |
| Races | `runTerminationRequiresPreCutoffAuthorization` | `unauthorizedRunTerminationIsDetectedTest` |
| All outcomes | `applicationLifecycleNeverEntersWorkflowHistory`, `exitNeverDisposesDurableWorkflowResources` | `workflowExitRecordIsDetectedTest`, `durableResourceDisposalIsDetectedTest` |
| Restart | `restartRestoresNoApplicationLifecycleState` | `restoredLifecycleModeIsDetectedTest` |
| All bounded scenarios | `modelStateIsFiniteAndBounded` | The proof projections independently mutate the fifth-tick bound in `sixthTickIsDetectedTest`; the canonical mutation registry perturbs the bounded model. |

Every enterable canonical phase has an explicit witness:

- Idle and active drain: `servingReached`, `drainingReached`.
- Reported outcomes: `successReportedReached`, `failureReportedReached`.
- Process endings: `gracefulProcessGoneReached`, `failedProcessGoneReached`,
  `timedOutProcessGoneReached`, `unexpectedProcessGoneReached`.
- Restart: `restartedServingReached`.
- Owner admission and kinds: `ownerPreparingReached`,
  `interruptibleOwnerRegisteredReached`, `atomicOwnerRegisteredReached`,
  `terminationAppendOwnerRegisteredReached`.
- Joined/ambiguous boundary states: `joinedRequestReached`,
  `recoverableAmbiguityReached`.
- Executor evidence states: `runningAttemptReached`,
  `suspensionIntentReached`, `fastSuspensionCalledReached`,
  `safelySuspendedReached`, `terminalAttemptReached`,
  `suspensionFailureReached`.
- Produced-write evidence: `producedWriteReached`,
  `acknowledgedWriteReached`, `failedWriteReached`.
- Durable facts that may predate the cutoff: `pausePreservedReached`,
  `authorizedTerminationFinishedReached`.
- The last non-terminal timer phase: `fourthTickReached`.

The invariant and witness names live in
`scripts/application-exit-model-registry.mjs`. The same file owns the check and
canonical mutation profiles, so a rename cannot silently disappear from one
gate.

## Scenario-to-test mapping for issue 203

| Scenario | Canonical model tests | Production decision-kernel evidence | Deferred integration evidence |
| --- | --- | --- | --- |
| Idle | `idleExitClosesCutoffBeforeSuccessTest`, `everyExitOutcomeLeavesWorkflowExitRecordCountZeroTest` | admission close, success guard, and process-end unit tests; production-backed MBT | #204 application-shell lock/clock test |
| Outside call | `acknowledgedInterruptibleIntentMayRemainAmbiguousTest`, `immediatelyAvailableBoundaryResultIsRecordedBeforeReleaseTest`; paired unacknowledged negative controls | interruptible-owner release unit test; production-backed MBT | #206 runtime cut-point and reopening tests |
| Executor | `exactSafeSuspensionReleasesOnlyAttemptAPositionTest`, `exactTerminalReportReleasesItsCorrelatedPositionTest`, `runningAttemptMustConfirmSafetyBeforeSuccessTest`, `unsafeRunningAttemptBlocksSuccessTest`; foreign and unsafe negative controls | exact-correlated executor-position unit test; production-backed MBT | #205 controlled-executor boundary test |
| Atomic | `cutoffPreservesAnEarlierRegisteredOwnerTest`, `admittedAtomicBoundaryFinishesInsideTheOriginalDrainTest`, `fifthTickForceTerminatesAStuckAtomicBoundaryTest` | cutoff and drain-decision unit tests; production-backed MBT | #207 runtime return/stuck cut points |
| Death | `deathBeforeResultRestartsWithoutLifecycleStateTest`; `unexpectedDeathSuccessIsDetectedTest` | fresh-start and result distinction unit tests; production-backed MBT | #209 authored cassette death cut points |
| Timeout | `fifthTickForceTerminatesAStuckAtomicBoundaryTest`, `timeoutRetainsAnEarlierConclusiveFailureDiagnosticTest`; early/fifth-without-force negative controls | monotonic tick, fifth-tick precedence, and forced process-end unit tests; production-backed MBT | #204 injected five-second clock and process adapter |
| Failure | `conclusiveFailureWaitsForIndependentQuickDrainWorkTest`, `usefulQuickWorkBlocksConclusiveFailureTest`; early-failure and zero-status negative controls | failure guard and forced process-end unit tests; production-backed MBT | #208 concurrent runtime drain test |
| Restart | `deathBeforeResultRestartsWithoutLifecycleStateTest`, `pauseAppliedBeforeCutoffRemainsDurableTest`; restored-mode negative control | fresh-start unit test; production-backed MBT | #209 one ordinary Run-entry path for both histories |
| Races | `joinedExitUsesTheOriginalTickAndSharedResultTest`, `onlyPreauthorizedRunTerminationAppendMayFinishTest`, `postCutoffForwardWorkCannotBeginTest`, `postCutoffControlCannotApplyTest`, `postCutoffOwnerPreparationCannotBeginTest`; joined/cutoff/authorization negative controls | cutoff, typed rejection, and join unit tests; production-backed MBT | #204 shared admission and deterministic race tests |
| Several Runs | no Exit transition | no Exit decision is made | Existing `runActivation` rejection remains authoritative; #204 consumes only an activated V1 Run. |

The MBT registers every canonical `step` action. Setup actions establish
controlled scenario facts; cutoff, registration, joined requests, ambiguity,
enumerated drain actions, exact executor evidence, result selection, ticks,
process-end selection, and fresh restart invoke the production
`lifecycle-decision` kernel. It compares the full canonical state projection
after every generated step.

## Exhaustive proof boundary

The canonical product is sampled and replayed through production code. It is
not reported as exhaustively enumerated: its resettable restart plus independent
owner, executor, resource, and timer products exceed the repository gate
budget. As permitted by ADR 0010, `applicationExit_proof.qnt` retains four
acyclic projections—admission, owner intent, executor evidence, and lifecycle
result. Each projection has positive tests, independent negative controls,
sampled witnesses, and a complete TLC traversal with no depth token.

This proof split does not authorize the #204 shared cutoff/drain runtime. It
only constrains the typed decisions that runtime must consume.
