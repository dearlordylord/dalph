import { it } from "@effect/vitest"
import { appendAcceptedSafeExecutorHistory } from "../../../../test/support/planned-attempt-executor-history.js"
import { taskTrackerGraphFactsObserved } from "../../../../test/task-tracker-facts.js"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Deferred, Effect, Fiber, Layer, Option, Ref, Stream } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import {
  ActiveTaskClaim,
  TaskClaimReleaseFailure,
  UnclaimedTask
} from "../../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import {
  deriveJournalResponsibilityFacts,
  hasUnfinishedRunResponsibility,
  makeRunRecoveryProjection
} from "../../../coordination/run/recovery-activation.js"
import { acceptedOperationIdsOf } from "../../../coordination/delivery/delivery-evidence.js"
import {
  acceptedWorkflowTransitionOperationId,
  deliveryProposalsOf
} from "../../../coordination/delivery/delivery-proposal.js"
import { Journal, makeJournal } from "../../../coordination/delivery/journal.js"
import { executeAcceptedWorkflowAction } from "../../../coordination/delivery/recovered-delivery-action-adapter.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { memoryJournalStoreLayer, memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import {
  attemptPlanRecordKey,
  attemptChoiceAppliedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  stoppedAttemptClaimNoReleaseRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { InRunJournal, type JournalRecord, JournalStore } from "../../../workflow-journal/store.js"
import { journaledWorkflowInterpreterLayer } from "../../../workflow-journal/journaled-interpreter.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimReleaseIntendedEvent,
  TaskClaimReleasedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  taskTrackerReadIntent
} from "../../registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  TaskClaimReleaseAuthority
} from "../../registry/operation.js"
import {
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskClaimFactsUnreadable,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { completedRunFinalityFixture } from "../../../../test/run-finality.js"
import { terminationPreconditionIssues } from "../../../workflow-journal/termination-preconditions.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent
} from "../planned-attempt-executor-work/events.js"
import { AttemptChoiceControl, attemptChoiceControlLayer } from "./control.js"
import {
  AttemptChoiceAppliedEvent,
  AttemptChoiceRequestId,
  AttemptImplementationAbandonedEvent,
  AttemptQuiescenceProof,
  AttemptStoppageIntendedEvent,
  StoppedAttemptClaimNoReleaseObservedEvent
} from "./events.js"
import {
  AuthoritativeTaskClaimObserved,
  type InterruptibleWorkflowBoundaryExecution,
  WorkflowInterpreter,
  WorkflowTrace
} from "../../interpretation/interpreter.js"
import { AuthoritativeTaskClaimReleased } from "../task-claim-release/protocol.js"
import { advanceAttemptStoppage, observeAttemptStoppageExecutor, recordStoppedAttemptClaimNoRelease } from "./stop.js"
import {
  advanceAttemptStoppage as advanceAttemptStoppageAtPublicSeam,
  resumePlannedAttemptExecutorWork as resumePlannedAttemptExecutorWorkAtPublicSeam,
  PlannedAttemptProtocolController,
  plannedAttemptProtocolControllerLayer
} from "../../../index.js"

const uninterruptedBoundary: InterruptibleWorkflowBoundaryExecution = {
  run: (_intent, call, recordResult) => Effect.flatMap(call, recordResult)
}
const inertBoundaryLease = {
  forwardBoundary: { _tag: "InterruptibleBoundary" as const, execution: uninterruptedBoundary },
  recordIntent: () => Effect.void
}

const runId = RunId.make("attempt-stop-run")
const taskId = TaskId.make("attempt-stop-task")
const target = FixtureTarget.make("attempt-stop-target")
const plannedSpecification = makeTaskWorkSpecification({ body: "Original F1", taskId, title: "Original F1" })
const changedSpecification = makeTaskWorkSpecification({ body: "Changed F2", taskId, title: "Changed F2" })
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-stop-P"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-stop-P"),
  executor: TaskExecutorLocator.make("executor:attempt-stop"),
  runId,
  taskId,
  taskRevision: plannedSpecification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/attempt-stop-P")
})
const correlation = { attemptId: plannedAttempt.attemptId, runId }
const claimOperation = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: OperationId.make("attempt-stop-claim"),
    owner: ClaimOwner.make("dalph"),
    taskId,
    token: ClaimToken.make("attempt-stop-token")
  },
  predecessorOperationIds: []
})
const exactClaim = ActiveTaskClaim.make(claimOperation.acquisition)
const unusedPlannedAttemptExecutor = PlannedAttemptExecutor.of({
  observe: () => Effect.die("executor must not be called before Stop authority is established"),
  requestSuspension: () => Effect.die("executor must not be called before Stop authority is established"),
  begin: () => Effect.die("unused begin"),
  resume: () => Effect.die("unused resume")
})
const plannedGraphOperation = makeTrackerGraphObservationOperation(
  { _tag: "WorkflowEstablishment" },
  OperationId.make("attempt-stop-planned-post-claim-graph"),
  target,
  [exactClaim.operationId],
  [taskId]
)
const plannedSpecificationRead = makeTaskWorkSpecificationObservationOperation(
  OperationId.make("attempt-stop-planned-F1"),
  target,
  taskId,
  [plannedGraphOperation.operationId]
)
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("attempt-stop-plan"),
  plannedAttempt,
  predecessorOperationIds: [
    exactClaim.operationId,
    plannedGraphOperation.operationId,
    plannedSpecificationRead.operationId
  ]
})
const plannedWorktreeOperation = makeTaskWorktreeReconciliationOperation({
  operationId: OperationId.make("attempt-stop-planned-worktree-P"),
  plannedAttempt,
  predecessorOperationIds: [planOperation.operationId]
})
const requestId = AttemptChoiceRequestId.make({ nonce: "attempt-stop-D2", runId })
const subject = { observedTaskRevision: changedSpecification.fingerprint, plannedAttempt }
const unusedBoundary = () => Effect.die("unused boundary")

const appendExposedStop = Effect.fn("AttemptStopTest.appendExposed")(function* (
  includeClaim = true,
  includeRunBeginning = true,
  includeChoice = true
) {
  const journal = yield* JournalStore
  if (!includeChoice) return
  if (includeRunBeginning) {
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
  }
  if (includeClaim) {
    yield* journal.append(
      runId,
      intentRecordKey(exactClaim.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(exactClaim.operationId),
      TaskClaimAcquiredEvent.make({ claim: exactClaim, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      intentRecordKey(plannedGraphOperation.operationId),
      taskTrackerReadIntent(plannedGraphOperation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(plannedGraphOperation.operationId),
      taskTrackerGraphFactsObserved(plannedGraphOperation, {
        revision: TrackerRevision.make("attempt-stop-planned-graph"),
        taskIds: [taskId]
      })
    )
    yield* journal.append(
      runId,
      intentRecordKey(plannedSpecificationRead.operationId),
      taskTrackerReadIntent(plannedSpecificationRead)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(plannedSpecificationRead.operationId),
      taskTrackerFactsObservedEvent(
        plannedSpecificationRead.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(plannedSpecificationRead, plannedSpecification)
      )
    )
  }
  yield* journal.append(
    runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
  )
  if (includeClaim) {
    yield* journal.append(
      runId,
      intentRecordKey(plannedWorktreeOperation.operationId),
      TaskWorktreeReconciliationIntendedEvent.make({
        operation: plannedWorktreeOperation,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(plannedWorktreeOperation.operationId),
      TaskWorktreeReadyEvent.make({
        operationId: plannedWorktreeOperation.operationId,
        proof: PlannedWorktreeReady.make({
          baseSha: plannedAttempt.baseSha,
          branch: plannedAttempt.branch,
          headSha: plannedAttempt.baseSha,
          worktree: plannedAttempt.worktree
        }),
        version: workflowJournalEventVersion
      })
    )
  }
  yield* appendAcceptedSafeExecutorHistory(plannedAttempt)
  const specificationRead = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("attempt-stop-observe-F2"),
    target,
    taskId
  )
  yield* journal.append(runId, intentRecordKey(specificationRead.operationId), taskTrackerReadIntent(specificationRead))
  yield* journal.append(
    runId,
    outcomeRecordKey(specificationRead.operationId),
    taskTrackerFactsObservedEvent(
      specificationRead.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(specificationRead, changedSpecification)
    )
  )
  if (includeRunBeginning) {
    yield* (yield* AttemptChoiceControl).apply({ choice: "StopTaskImplementation", requestId, subject })
  } else {
    yield* journal.append(
      runId,
      attemptChoiceAppliedRecordKey(requestId),
      AttemptChoiceAppliedEvent.make({
        choice: "StopTaskImplementation",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId,
        subject,
        version: workflowJournalEventVersion
      })
    )
  }
})

/** Seeds the exact target-A prefix before a separate published Journal owns later appends. */
const appendExposedPrefix = Effect.fn("AttemptStopTest.appendExposedPrefix")(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
  yield* journal.append(
    runId,
    intentRecordKey(exactClaim.operationId),
    TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(exactClaim.operationId),
    TaskClaimAcquiredEvent.make({ claim: exactClaim, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    intentRecordKey(plannedGraphOperation.operationId),
    taskTrackerReadIntent(plannedGraphOperation)
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(plannedGraphOperation.operationId),
    taskTrackerGraphFactsObserved(plannedGraphOperation, {
      revision: TrackerRevision.make("attempt-stop-published-prefix-graph"),
      taskIds: [taskId]
    })
  )
  yield* journal.append(
    runId,
    intentRecordKey(plannedSpecificationRead.operationId),
    taskTrackerReadIntent(plannedSpecificationRead)
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(plannedSpecificationRead.operationId),
    taskTrackerFactsObservedEvent(
      plannedSpecificationRead.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(plannedSpecificationRead, plannedSpecification)
    )
  )
  yield* journal.append(
    runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    intentRecordKey(plannedWorktreeOperation.operationId),
    TaskWorktreeReconciliationIntendedEvent.make({
      operation: plannedWorktreeOperation,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(plannedWorktreeOperation.operationId),
    TaskWorktreeReadyEvent.make({
      operationId: plannedWorktreeOperation.operationId,
      proof: PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      }),
      version: workflowJournalEventVersion
    })
  )
  yield* appendAcceptedSafeExecutorHistory(plannedAttempt)
  const specificationRead = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("attempt-stop-published-prefix-specification"),
    target,
    taskId
  )
  yield* journal.append(runId, intentRecordKey(specificationRead.operationId), taskTrackerReadIntent(specificationRead))
  yield* journal.append(
    runId,
    outcomeRecordKey(specificationRead.operationId),
    taskTrackerFactsObservedEvent(
      specificationRead.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(specificationRead, changedSpecification)
    )
  )
})

const appendResumedExecuting = Effect.fn("AttemptStopTest.appendResumedExecuting")(function* () {
  const journal = yield* JournalStore
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(3)
  const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
  yield* journal.append(
    runId,
    plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Resume",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandResponseObservedEvent.make({
      commandOrdinal,
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      report,
      version: workflowJournalEventVersion
    })
  )
  const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(3)
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: reportOrdinal,
      report,
      version: workflowJournalEventVersion
    })
  )
})

const recordsWithRows = (
  records: ReadonlyArray<JournalRecord>,
  rows: ReadonlyArray<Pick<JournalRecord, "event" | "key">>
): ReadonlyArray<JournalRecord> =>
  [...records, ...rows].map((row, index) => ({ ...row, position: JournalPosition.make(index + 1), runId }))

const forgedRow = (name: string, event: JournalRecord["event"]): Pick<JournalRecord, "event" | "key"> => ({
  event,
  key: JournalRecordKey.make(`attempt-stop-forged:${name}`)
})

const invalidHistoryDetails = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<string> => {
  const reduction = reduceWorkflowJournalHistory(runId, records)
  return reduction._tag === "InvalidWorkflowJournalHistory"
    ? reduction.issues.flatMap((issue) => ("detail" in issue ? [issue.detail] : []))
    : []
}

it.effect("proves the exact executor stopped before abandoning implementation responsibility", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const result = yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("retained safe proof must avoid projection"),
          requestSuspension: () => Effect.die("retained safe proof must avoid suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    const records = yield* (yield* JournalStore).read(runId)

    expect(result._tag).toBe("AttemptImplementationAbandoned")
    expect(records.filter(({ event }) => event._tag === "AttemptStoppageIntended")).toHaveLength(0)
    expect(records.filter(({ event }) => event._tag === "AttemptImplementationAbandoned")).toHaveLength(1)
    const reduction = reduceWorkflowJournalHistory(runId, records)
    expect(reduction._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("invalidates Stop when no accepted executor evidence exists", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* journal.append(
      runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      attemptChoiceAppliedRecordKey(requestId),
      AttemptChoiceAppliedEvent.make({
        choice: "StopTaskImplementation",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId,
        subject,
        version: workflowJournalEventVersion
      })
    )

    expect(yield* advanceAttemptStoppage(requestId, subject)).toEqual({
      _tag: "AttemptStoppageChoiceInvalidated",
      reason: "LaterCommandRecorded"
    })
  }).pipe(
    Effect.provideService(PlannedAttemptExecutor, unusedPlannedAttemptExecutor),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("invalidates Stop when a later executor command breaks its safe evidence", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const journal = yield* JournalStore
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(3)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Resume",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )

    expect(yield* advanceAttemptStoppage(requestId, subject)).toEqual({
      _tag: "AttemptStoppageChoiceInvalidated",
      reason: "LaterCommandRecorded"
    })
  }).pipe(
    Effect.provideService(PlannedAttemptExecutor, unusedPlannedAttemptExecutor),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("waits for accepted lifecycle authority when an unaccepted Executing projection is latest", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const journal = yield* JournalStore
    const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(3)
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    yield* journal.append(
      runId,
      plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal),
      PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: executing }),
        occurrenceClassification: "NonActionOccurrence",
        ordinal: observationOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )

    expect(yield* advanceAttemptStoppage(requestId, subject)).toEqual({
      _tag: "AttemptStoppageAwaitingLifecycleAcceptance"
    })
  }).pipe(
    Effect.provideService(PlannedAttemptExecutor, unusedPlannedAttemptExecutor),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("coalesces a second Stop advancement after its exact abandonment is durable", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const first = yield* advanceAttemptStoppage(requestId, subject)
    const second = yield* advanceAttemptStoppage(requestId, subject)

    expect(first).toEqual({ _tag: "AttemptImplementationAbandoned" })
    expect(second).toEqual({ _tag: "AttemptImplementationAbandoned" })
    expect(
      (yield* (yield* JournalStore).read(runId)).filter(({ event }) => event._tag === "AttemptImplementationAbandoned")
    ).toHaveLength(1)
  }).pipe(
    Effect.provideService(PlannedAttemptExecutor, unusedPlannedAttemptExecutor),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("treats an accepted terminal report after Stop as absorbing without abandonment or executor contact", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const journal = yield* JournalStore
    const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
    const terminalOrdinal = PlannedAttemptExecutorReportOrdinal.make(3)
    const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Failed" }
    })
    yield* journal.append(
      runId,
      plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal),
      PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: terminal }),
        occurrenceClassification: "NonActionOccurrence",
        ordinal: observationOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, terminalOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: terminalOrdinal,
        report: terminal,
        version: workflowJournalEventVersion
      })
    )

    const result = yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("terminal Stop must not observe the executor"),
          requestSuspension: () => Effect.die("terminal Stop must not suspend the executor"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("terminal Stop must not resume the executor")
        })
      )
    )
    const records = yield* journal.read(runId)
    expect(result).toEqual({ _tag: "AttemptStoppageSupersededByTerminal" })
    expect(records.some(({ event }) => event._tag === "AttemptImplementationAbandoned")).toBe(false)
    const reduction = reduceWorkflowJournalHistory(runId, records)
    expect(reduction._tag).toBe("ValidWorkflowJournalHistory")
    if (reduction._tag !== "ValidWorkflowJournalHistory") return
    expect(deriveJournalResponsibilityFacts(reduction.runState)).toContainEqual(
      expect.objectContaining({
        disposition: expect.objectContaining({ _tag: "PlannedAttemptExecutorWorkTerminal", report: terminal })
      })
    )
    expect(hasUnfinishedRunResponsibility(reduction.runState)).toBe(false)
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects Resume after applied Stop before recording intent or contacting the executor", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const resumeCalls = yield* Ref.make(0)
    const rejected = yield* resumePlannedAttemptExecutorWorkAtPublicSeam(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("terminal choice must not observe the executor"),
          requestSuspension: () => Effect.die("terminal choice must not suspend the executor"),
          begin: () => Effect.die("unused begin"),
          resume: () =>
            Ref.update(resumeCalls, (count) => count + 1).pipe(
              Effect.as(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
            )
        })
      ),
      Effect.flip
    )
    const records = yield* (yield* JournalStore).read(runId)

    expect(rejected).toMatchObject({
      _tag: "PlannedAttemptExecutorResumeInvalidatedByTerminalChoice",
      choice: "StopTaskImplementation",
      correlation
    })
    expect(yield* Ref.get(resumeCalls)).toBe(0)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(2)
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("serializes a public Resume against exact Stop abandonment without poisoning the journal", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const journal = yield* InRunJournal
    const protocolController = yield* PlannedAttemptProtocolController
    const protocolEntries = yield* Ref.make(0)
    const resumeEnteredPublicGuard = yield* Deferred.make<void>()
    const controlledProtocolController = PlannedAttemptProtocolController.of({
      reserve: protocolController.reserve,
      withPermit: (exactCorrelation, use) =>
        Ref.updateAndGet(protocolEntries, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            (count === 2 ? Deferred.succeed(resumeEnteredPublicGuard, undefined) : Effect.void).pipe(
              Effect.andThen(protocolController.withPermit(exactCorrelation, use))
            )
          )
        ),
      withTerminalPermit: protocolController.withTerminalPermit
    })
    const stopReadEntered = yield* Deferred.make<void>()
    const allowStopRead = yield* Deferred.make<void>()
    const interceptNextRead = yield* Ref.make(true)
    const controlledJournal = InRunJournal.of({
      append: journal.append,
      read: (requestedRunId) =>
        Ref.getAndSet(interceptNextRead, false).pipe(
          Effect.flatMap((intercept) =>
            intercept
              ? Deferred.succeed(stopReadEntered, undefined).pipe(
                  Effect.andThen(Deferred.await(allowStopRead)),
                  Effect.andThen(journal.read(requestedRunId))
                )
              : journal.read(requestedRunId)
          )
        )
    })
    const executor = PlannedAttemptExecutor.of({
      observe: () => Effect.die("retained proof and abandoned resume must not observe the executor"),
      requestSuspension: () => Effect.die("retained proof must not request suspension"),
      begin: () => Effect.die("an abandoned resume must not begin executor work"),
      resume: () => Effect.die("an abandoned resume must not reach the executor")
    })
    const provideProtocol = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(InRunJournal, controlledJournal),
        Effect.provideService(PlannedAttemptExecutor, executor),
        Effect.provideService(PlannedAttemptProtocolController, controlledProtocolController)
      )

    const stopFiber = yield* provideProtocol(advanceAttemptStoppageAtPublicSeam(requestId, subject)).pipe(
      Effect.forkScoped
    )
    yield* Deferred.await(stopReadEntered)
    const resumeFiber = yield* provideProtocol(
      resumePlannedAttemptExecutorWorkAtPublicSeam(plannedAttempt).pipe(Effect.result)
    ).pipe(Effect.forkScoped)
    yield* Deferred.await(resumeEnteredPublicGuard)
    expect(resumeFiber.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(allowStopRead, undefined)

    expect(yield* Fiber.join(stopFiber)).toEqual({ _tag: "AttemptImplementationAbandoned" })
    expect(yield* Fiber.join(resumeFiber)).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "PlannedAttemptExecutorResponsibilityAbandoned" }
    })
    const records = yield* (yield* JournalStore).read(runId)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(2)
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("restarts without treating a prior process protocol permit as durable ownership", () =>
  Effect.gen(function* () {
    const reserveFromFreshProcess = Effect.flatMap(PlannedAttemptProtocolController, (controller) =>
      controller.reserve(correlation)
    ).pipe(Effect.provide(Layer.fresh(plannedAttemptProtocolControllerLayer)))

    const priorProcessPermit = yield* reserveFromFreshProcess
    const restartedProcessPermit = yield* reserveFromFreshProcess

    expect(Option.isSome(priorProcessPermit)).toBe(true)
    expect(Option.isSome(restartedProcessPermit)).toBe(true)
  })
)

it.effect("rejects Stop advancement and observation without Alice's exact applied choice", () =>
  Effect.gen(function* () {
    expect(yield* advanceAttemptStoppage(requestId, subject).pipe(Effect.flip)).toMatchObject({
      _tag: "AttemptStopChoiceContradiction"
    })
    expect(yield* observeAttemptStoppageExecutor(requestId, subject).pipe(Effect.flip)).toMatchObject({
      _tag: "AttemptStopChoiceContradiction"
    })
    expect(
      yield* recordStoppedAttemptClaimNoRelease(
        requestId,
        subject,
        OperationId.make("no-applied-stop-observation")
      ).pipe(Effect.flip)
    ).toMatchObject({ _tag: "AttemptStopChoiceContradiction" })
  }).pipe(
    Effect.provideService(PlannedAttemptExecutor, unusedPlannedAttemptExecutor),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("requires the exact claim that authorized the attempt before abandoning implementation", () =>
  Effect.gen(function* () {
    yield* appendExposedStop(false)
    const failure = yield* advanceAttemptStoppage(requestId, subject).pipe(Effect.flip)

    expect(failure).toMatchObject({ _tag: "AttemptStopClaimAuthorityMissing", requestId, subject })
  }).pipe(
    Effect.provideService(PlannedAttemptExecutor, unusedPlannedAttemptExecutor),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("fails closed when an active attempt has no immutable Run beginning", () =>
  Effect.gen(function* () {
    yield* appendExposedStop(true, false, false)

    const recovery = yield* makeRunRecoveryProjection(runId)
    const projection = yield* recovery.readDeliveryProjection
    expect(projection.frontier.transitions).toEqual([])
    expect(projection.frontier.explanations).toEqual([])
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects attempt choices that are not exposed by the exact Run plan safe report and latest fingerprint", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const records = yield* (yield* JournalStore).read(runId)
    const withoutChoice = records.filter(({ event }) => event._tag !== "AttemptChoiceApplied")
    const makeChoice = (
      nonce: string,
      choiceSubject = subject,
      choice: "ContinueExistingAttempt" | "StopTaskImplementation" = "ContinueExistingAttempt",
      choiceRunId = runId
    ) =>
      AttemptChoiceAppliedEvent.make({
        choice,
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId: AttemptChoiceRequestId.make({ nonce, runId: choiceRunId }),
        subject: choiceSubject,
        version: workflowJournalEventVersion
      })
    const foreignAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("attempt-stop-foreign-plan")
    })
    const cases = [
      {
        detail: "binds run",
        records: recordsWithRows(withoutChoice, [
          forgedRow(
            "choice-foreign-run",
            makeChoice("choice-foreign-run", subject, "ContinueExistingAttempt", RunId.make("foreign-choice-run"))
          )
        ])
      },
      {
        detail: "has no prior matching planned attempt",
        records: recordsWithRows(withoutChoice, [
          forgedRow(
            "choice-foreign-plan",
            makeChoice("choice-foreign-plan", {
              observedTaskRevision: changedSpecification.fingerprint,
              plannedAttempt: foreignAttempt
            })
          )
        ])
      },
      {
        detail: "requires the latest accepted safely-suspended executor report",
        records: recordsWithRows(
          withoutChoice.filter(
            ({ event }) =>
              !(
                (event._tag === "PlannedAttemptExecutorWorkReported" ||
                  event._tag === "PlannedAttemptExecutorCommandResponseObserved") &&
                event.report._tag === "ExecutorWorkSafelySuspended"
              )
          ),
          [forgedRow("choice-without-safe", makeChoice("choice-without-safe"))]
        )
      },
      {
        detail: "does not name the latest observed task fingerprint",
        records: recordsWithRows(withoutChoice, [
          forgedRow(
            "choice-stale-fingerprint",
            makeChoice("choice-stale-fingerprint", {
              observedTaskRevision: TaskRevision.make("attempt-stop-F3"),
              plannedAttempt
            })
          )
        ])
      },
      {
        detail: "follows the terminal Stop direction",
        records: recordsWithRows(records, [forgedRow("choice-after-stop", makeChoice("choice-after-stop"))])
      },
      {
        detail: "follows the winning direction",
        records: recordsWithRows(records, [
          forgedRow("choice-duplicate-subject", makeChoice("choice-duplicate-subject"))
        ])
      }
    ]

    for (const scenario of cases) {
      expect(invalidHistoryDetails(scenario.records)).toEqual(
        expect.arrayContaining([expect.stringContaining(scenario.detail)])
      )
    }
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("coalesces concurrent abandonment and treats later Stop observation as already complete", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const executor = PlannedAttemptExecutor.of({
      observe: () => Effect.die("retained proof needs no projection"),
      requestSuspension: () => Effect.die("retained proof needs no suspension"),
      begin: () => Effect.die("unused begin"),
      resume: () => Effect.die("unused resume")
    })
    const outcomes = yield* Effect.all(
      [advanceAttemptStoppage(requestId, subject), advanceAttemptStoppage(requestId, subject)],
      { concurrency: "unbounded" }
    ).pipe(Effect.provideService(PlannedAttemptExecutor, executor))

    expect(outcomes).toEqual([{ _tag: "AttemptImplementationAbandoned" }, { _tag: "AttemptImplementationAbandoned" }])
    expect(
      yield* advanceAttemptStoppage(requestId, subject).pipe(Effect.provideService(PlannedAttemptExecutor, executor))
    ).toEqual({ _tag: "AttemptImplementationAbandoned" })
    expect(
      yield* observeAttemptStoppageExecutor(requestId, subject).pipe(
        Effect.provideService(PlannedAttemptExecutor, executor)
      )
    ).toEqual({ _tag: "AttemptImplementationAbandoned" })
    expect(
      (yield* (yield* JournalStore).read(runId)).filter(({ event }) => event._tag === "AttemptImplementationAbandoned")
    ).toHaveLength(1)
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects stopped-attempt events without their exact choice quiescence proof and claim", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const records = yield* (yield* JournalStore).read(runId)
    const foreignRequestId = AttemptChoiceRequestId.make({
      nonce: "attempt-stop-foreign-event",
      runId: RunId.make("attempt-stop-foreign-event-run")
    })
    const foreignClaim = ActiveTaskClaim.make({
      ...exactClaim,
      operationId: OperationId.make("attempt-stop-foreign-authority"),
      token: ClaimToken.make("attempt-stop-foreign-authority-token")
    })
    const abandonment = (
      proof: AttemptQuiescenceProof = AttemptQuiescenceProof.cases.AcceptedReport.make({
        reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2)
      }),
      expectedClaim = exactClaim
    ) =>
      AttemptImplementationAbandonedEvent.make({
        expectedClaim,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        proof,
        requestId,
        subject,
        version: workflowJournalEventVersion
      })
    const laterCommandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(3)
    const laterCommand = PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Resume",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: laterCommandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
    const cases = [
      {
        detail: "requires its exact prior applied Stop choice",
        records: recordsWithRows(records, [
          forgedRow(
            "stoppage-without-choice",
            AttemptStoppageIntendedEvent.make({
              initiatedBy: { _tag: "DalphCoordinator" },
              occurrenceClassification: "InitiatedAction",
              requestId: foreignRequestId,
              subject,
              version: workflowJournalEventVersion
            })
          )
        ])
      },
      {
        detail: "requires its exact accepted Safe executor proof",
        records: recordsWithRows(records, [
          forgedRow(
            "abandonment-without-proof",
            abandonment(
              AttemptQuiescenceProof.cases.AcceptedReport.make({
                reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(99)
              })
            )
          )
        ])
      },
      {
        detail: "requires its exact accepted Safe executor proof",
        records: recordsWithRows(records, [
          forgedRow(
            "newer-untrusted-executor-state",
            PlannedAttemptExecutorStateObservedEvent.make({
              observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateUnreadable.make({}),
              occurrenceClassification: "NonActionOccurrence",
              ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          ),
          forgedRow("abandonment-after-untrusted-state", abandonment())
        ])
      },
      {
        detail: "follows terminal choice",
        records: recordsWithRows(records, [
          forgedRow("later-executor-command", laterCommand),
          forgedRow("abandonment-after-command", abandonment())
        ])
      },
      {
        detail: "requires its exact authorized claim",
        records: recordsWithRows(records, [
          forgedRow("abandonment-foreign-claim", abandonment(undefined, foreignClaim))
        ])
      },
      {
        detail: "no-release requires its exact prior abandonment",
        records: recordsWithRows(records, [
          forgedRow(
            "no-release-without-abandonment",
            StoppedAttemptClaimNoReleaseObservedEvent.make({
              expectedClaim: exactClaim,
              observation: UnclaimedTask.make({ taskId }),
              observationOperationId: OperationId.make("attempt-stop-unowned-no-release-read"),
              occurrenceClassification: "NonActionOccurrence",
              requestId,
              subject,
              version: workflowJournalEventVersion
            })
          )
        ])
      }
    ]

    for (const scenario of cases) {
      expect(invalidHistoryDetails(scenario.records)).toEqual(
        expect.arrayContaining([expect.stringContaining(scenario.detail)])
      )
    }
    const terminalOrdinal = PlannedAttemptExecutorReportOrdinal.make(3)
    const terminalProofHistory = recordsWithRows(records, [
      forgedRow("terminal-proof-command", laterCommand),
      forgedRow(
        "terminal-proof-report",
        PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: terminalOrdinal,
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
            correlation,
            result: { _tag: "Failed" }
          }),
          version: workflowJournalEventVersion
        })
      ),
      forgedRow(
        "terminal-proof-abandonment",
        abandonment(AttemptQuiescenceProof.cases.AcceptedReport.make({ reportOrdinal: terminalOrdinal }))
      )
    ])
    expect(invalidHistoryDetails(terminalProofHistory)).toEqual(
      expect.arrayContaining([expect.stringContaining("requires its exact accepted Safe executor proof")])
    )
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("invalidates Stop when accepted resumed work follows its safe report without contacting the executor", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* appendResumedExecuting()

    expect(
      yield* observeAttemptStoppageExecutor(requestId, subject).pipe(
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            observe: () => Effect.die("accepted lifecycle evidence must not trigger an executor observation"),
            requestSuspension: () => Effect.die("Stop must not suspend after accepted Executing evidence"),
            begin: () => Effect.die("unused begin"),
            resume: () => Effect.die("unused resume")
          })
        )
      )
    ).toEqual({ _tag: "AttemptStoppageChoiceInvalidated", reason: "ExecutingAccepted" })
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects executor work that reopens an abandoned attempt", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("unused observation"),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    const records = yield* (yield* JournalStore).read(runId)
    const ordinal = PlannedAttemptExecutorCommandOrdinal.make(3)
    const forged = recordsWithRows(records, [
      {
        event: PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "Begin",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, ordinal)
      }
    ])

    expect(reduceWorkflowJournalHistory(runId, forged)).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("follows abandonment") })
      ])
    })
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("derives a no-release result only from the exact journaled focused claim observation", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("unused observation"),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    const journal = yield* JournalStore
    const missingOperationId = OperationId.make("attempt-stop-missing-claim-read")
    const missing = yield* recordStoppedAttemptClaimNoRelease(requestId, subject, missingOperationId).pipe(Effect.flip)
    expect(missing._tag).toBe("StoppedAttemptClaimObservationMissing")
    const withoutObservation = recordsWithRows(yield* journal.read(runId), [
      forgedRow(
        "no-release-without-focused-observation",
        StoppedAttemptClaimNoReleaseObservedEvent.make({
          expectedClaim: exactClaim,
          observation: UnclaimedTask.make({ taskId }),
          observationOperationId: missingOperationId,
          occurrenceClassification: "NonActionOccurrence",
          requestId,
          subject,
          version: workflowJournalEventVersion
        })
      )
    ])
    expect(invalidHistoryDetails(withoutObservation)).toEqual(
      expect.arrayContaining([expect.stringContaining("latest exact post-baseline claim read")])
    )

    const claimRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-current-claim"),
      target,
      taskId,
      [exactClaim.operationId]
    )
    yield* journal.append(runId, intentRecordKey(claimRead.operationId), taskTrackerReadIntent(claimRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(claimRead.operationId),
      taskTrackerFactsObservedEvent(
        claimRead.operationId,
        makeFocusedTaskClaimFactsObserved(claimRead, UnclaimedTask.make({ taskId }))
      )
    )
    yield* recordStoppedAttemptClaimNoRelease(requestId, subject, claimRead.operationId)
    const records = yield* journal.read(runId)
    const noRelease = records.findLast(({ event }) => event._tag === "StoppedAttemptClaimNoReleaseObserved")?.event

    expect(noRelease).toMatchObject({
      _tag: "StoppedAttemptClaimNoReleaseObserved",
      expectedClaim: exactClaim,
      observation: { _tag: "UnclaimedTask", taskId },
      observationOperationId: claimRead.operationId
    })
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
    const duplicateNoRelease = recordsWithRows(records, [
      forgedRow(
        "duplicate-no-release",
        StoppedAttemptClaimNoReleaseObservedEvent.make({
          expectedClaim: exactClaim,
          observation: UnclaimedTask.make({ taskId }),
          observationOperationId: claimRead.operationId,
          occurrenceClassification: "NonActionOccurrence",
          requestId,
          subject,
          version: workflowJournalEventVersion
        })
      )
    ])
    expect(invalidHistoryDetails(duplicateNoRelease)).toEqual(
      expect.arrayContaining([expect.stringContaining("claim disposition is already terminal")])
    )
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("does not settle a stopped claim from a foreign-target observation", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("unused observation"),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    const journal = yield* JournalStore
    const foreignTarget = FixtureTarget.make("attempt-stop-foreign-target")
    const foreignRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-foreign-claim-read"),
      foreignTarget,
      taskId,
      [exactClaim.operationId]
    )
    yield* journal.append(runId, intentRecordKey(foreignRead.operationId), taskTrackerReadIntent(foreignRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(foreignRead.operationId),
      taskTrackerFactsObservedEvent(
        foreignRead.operationId,
        makeFocusedTaskClaimFactsObserved(foreignRead, UnclaimedTask.make({ taskId }))
      )
    )
    const contradiction = yield* recordStoppedAttemptClaimNoRelease(requestId, subject, foreignRead.operationId).pipe(
      Effect.flip
    )
    expect(contradiction).toMatchObject({ _tag: "StoppedAttemptClaimObservationMissing" })
    const recovery = yield* makeRunRecoveryProjection(runId)
    const projection = yield* recovery.readDeliveryProjection
    expect(projection.frontier.explanations).not.toContainEqual(
      expect.objectContaining({ _tag: "StoppedAttemptSettled", claimDisposition: "NoRelease" })
    )
    expect(projection.frontier.transitions).not.toContainEqual(
      expect.objectContaining({ _tag: "ReleaseStoppedAttemptClaim" })
    )
    expect(yield* (yield* AttemptChoiceControl).read(requestId)).toMatchObject({
      _tag: "StopApplied",
      status: { _tag: "ImplementationAbandonedClaimDispositionPending" }
    })
    const termination = terminationPreconditionIssues(
      yield* journal.read(runId),
      runId,
      completedRunFinalityFixture({ runId, target }).evidence
    )
    expect(termination).toContain("termination requires every journal responsibility to be settled")
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("settles Stop from the exact target observation after a later foreign observation", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(PlannedAttemptExecutor, unusedPlannedAttemptExecutor)
    )
    const journal = yield* JournalStore
    const exactRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-interleaved-exact-claim-read"),
      target,
      taskId,
      [exactClaim.operationId]
    )
    const foreignRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-interleaved-foreign-claim-read"),
      FixtureTarget.make("attempt-stop-interleaved-foreign-target"),
      taskId,
      [exactClaim.operationId]
    )
    for (const read of [exactRead, foreignRead]) {
      yield* journal.append(runId, intentRecordKey(read.operationId), taskTrackerReadIntent(read))
      yield* journal.append(
        runId,
        outcomeRecordKey(read.operationId),
        taskTrackerFactsObservedEvent(
          read.operationId,
          makeFocusedTaskClaimFactsObserved(read, UnclaimedTask.make({ taskId }))
        )
      )
    }

    yield* recordStoppedAttemptClaimNoRelease(requestId, subject, exactRead.operationId)
    const records = yield* journal.read(runId)
    const reduction = reduceWorkflowJournalHistory(runId, records)
    expect(reduction._tag).toBe("ValidWorkflowJournalHistory")
    if (reduction._tag !== "ValidWorkflowJournalHistory") return
    expect(hasUnfinishedRunResponsibility(reduction.runState)).toBe(false)
    const recovery = yield* makeRunRecoveryProjection(runId)
    expect(yield* recovery.readDeliveryProjection).toMatchObject({
      frontier: {
        explanations: expect.arrayContaining([
          expect.objectContaining({ _tag: "StoppedAttemptSettled", claimDisposition: "NoRelease" })
        ])
      }
    })
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects a no-release after a later same-target unreadable claim observation", () =>
  Effect.gen(function* () {
    yield* appendExposedPrefix()
    const storage = yield* JournalStore
    const initialReduction = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
    if (initialReduction._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initialReduction)
    const published = yield* makeJournal(runId, target, initialReduction, storage)
    const publishedControlLayer = attemptChoiceControlLayer.pipe(Layer.provide(Layer.succeed(InRunJournal, published)))
    yield* Effect.gen(function* () {
      const journal = yield* Journal
      const stop = yield* (yield* AttemptChoiceControl).apply({ choice: "StopTaskImplementation", requestId, subject })
      expect(stop._tag).toBe("StopApplied")
      yield* advanceAttemptStoppage(requestId, subject).pipe(
        Effect.provideService(PlannedAttemptExecutor, unusedPlannedAttemptExecutor)
      )
      const readable = makeTaskClaimObservationOperation(
        OperationId.make("attempt-stop-unreadable-freshness-readable"),
        target,
        taskId,
        [exactClaim.operationId]
      )
      const unreadable = makeTaskClaimObservationOperation(
        OperationId.make("attempt-stop-unreadable-freshness-unreadable"),
        target,
        taskId,
        [exactClaim.operationId, readable.operationId]
      )
      yield* journal.append(runId, intentRecordKey(readable.operationId), taskTrackerReadIntent(readable))
      yield* journal.append(
        runId,
        outcomeRecordKey(readable.operationId),
        taskTrackerFactsObservedEvent(
          readable.operationId,
          makeFocusedTaskClaimFactsObserved(readable, UnclaimedTask.make({ taskId }))
        )
      )
      yield* journal.append(runId, intentRecordKey(unreadable.operationId), taskTrackerReadIntent(unreadable))
      yield* journal.append(
        runId,
        outcomeRecordKey(unreadable.operationId),
        taskTrackerFactsObservedEvent(unreadable.operationId, makeFocusedTaskClaimFactsUnreadable(unreadable))
      )

      const beforeAttempt = yield* journal.state.get
      const rejected = yield* recordStoppedAttemptClaimNoRelease(requestId, subject, readable.operationId).pipe(
        Effect.flip
      )
      expect(rejected).toMatchObject({ _tag: "StoppedAttemptClaimObservationMissing" })
      expect((yield* journal.state.get).position).toBe(beforeAttempt.position)
      const records = yield* journal.read(runId)
      expect(records.some(({ event }) => event._tag === "StoppedAttemptClaimNoReleaseObserved")).toBe(false)
      const reduction = reduceWorkflowJournalHistory(runId, records)
      expect(reduction._tag).toBe("ValidWorkflowJournalHistory")
      if (reduction._tag !== "ValidWorkflowJournalHistory") return
      const forgedNoRelease = recordsWithRows(records, [
        {
          event: StoppedAttemptClaimNoReleaseObservedEvent.make({
            expectedClaim: exactClaim,
            observation: UnclaimedTask.make({ taskId }),
            observationOperationId: readable.operationId,
            occurrenceClassification: "NonActionOccurrence",
            requestId,
            subject,
            version: workflowJournalEventVersion
          }),
          key: stoppedAttemptClaimNoReleaseRecordKey(requestId)
        }
      ])
      expect(invalidHistoryDetails(forgedNoRelease)).toEqual(
        expect.arrayContaining([expect.stringContaining("latest exact post-baseline claim read")])
      )
      expect(hasUnfinishedRunResponsibility(reduction.runState)).toBe(true)
      const recovery = yield* makeRunRecoveryProjection(runId)
      const projection = yield* recovery.readDeliveryProjection
      expect(projection.frontier.explanations).not.toContainEqual(
        expect.objectContaining({ _tag: "StoppedAttemptSettled", claimDisposition: "NoRelease" })
      )
      expect(projection.frontier.transitions).not.toContainEqual(
        expect.objectContaining({ _tag: "ReleaseStoppedAttemptClaim" })
      )
      expect(yield* (yield* AttemptChoiceControl).read(requestId)).toMatchObject({
        _tag: "StopApplied",
        status: { _tag: "ImplementationAbandonedClaimDispositionPending" }
      })
      expect(
        terminationPreconditionIssues(records, runId, completedRunFinalityFixture({ runId, target }).evidence)
      ).not.toEqual([])
    }).pipe(
      Effect.provide(
        Layer.mergeAll(Layer.succeed(Journal, published), Layer.succeed(InRunJournal, published), publishedControlLayer)
      )
    )
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("keeps a published target-A Stop valid through advancement, reduction, and recovery", () =>
  Effect.gen(function* () {
    yield* appendExposedPrefix()
    const storage = yield* JournalStore
    const initialReduction = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
    if (initialReduction._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initialReduction)
    const published = yield* makeJournal(runId, target, initialReduction, storage)
    const publishedControlLayer = attemptChoiceControlLayer.pipe(Layer.provide(Layer.succeed(InRunJournal, published)))
    yield* Effect.gen(function* () {
      const journal = yield* Journal
      const attached = yield* Deferred.make<void>()
      const publications = yield* journal.state.changes.pipe(
        Stream.tap(() => Deferred.succeed(attached, undefined)),
        Stream.take(4),
        Stream.runCollect,
        Effect.forkChild
      )
      yield* Deferred.await(attached)
      const beforeForeign = yield* journal.state.get
      const foreignTarget = FixtureTarget.make("attempt-stop-published-foreign-target")
      const foreignOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("attempt-stop-published-foreign-specification"),
        foreignTarget,
        taskId
      )
      yield* journal.append(
        runId,
        intentRecordKey(foreignOperation.operationId),
        taskTrackerReadIntent(foreignOperation)
      )
      const afterForeignIntent = yield* journal.state.get
      expect(afterForeignIntent.position).toBe(beforeForeign.position + 1)
      yield* journal.append(
        runId,
        outcomeRecordKey(foreignOperation.operationId),
        taskTrackerFactsObservedEvent(
          foreignOperation.operationId,
          makeFocusedTaskWorkSpecificationFactsObserved(
            foreignOperation,
            makeTaskWorkSpecification({ body: "Foreign published body", taskId, title: "Foreign published title" })
          )
        )
      )
      const afterForeign = yield* journal.state.get
      expect(afterForeign.position).toBe(beforeForeign.position + 2)
      const taskOnlyLatest = afterForeign.records.findLast(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
      )
      if (taskOnlyLatest?.event._tag !== "TaskTrackerFactsObserved")
        return yield* Effect.die("missing latest specification")
      expect(taskOnlyLatest.event.observation._tag).toBe("FocusedTaskWorkSpecificationFacts")
      if (taskOnlyLatest.event.observation._tag !== "FocusedTaskWorkSpecificationFacts") {
        return yield* Effect.die("missing latest focused specification")
      }
      expect(taskOnlyLatest.event.observation.factFamily.fingerprint).toBe(
        makeTaskWorkSpecification({ body: "Foreign published body", taskId, title: "Foreign published title" })
          .fingerprint
      )
      expect(taskOnlyLatest.event.observation.factFamily.fingerprint).not.toBe(subject.observedTaskRevision)

      const stop = yield* (yield* AttemptChoiceControl).apply({ choice: "StopTaskImplementation", requestId, subject })
      expect(stop._tag).toBe("StopApplied")
      if (stop._tag !== "StopApplied") return yield* Effect.die("published Stop was not applied")
      expect(stop.application.event.subject.observedTaskRevision).toBe(subject.observedTaskRevision)
      expect((yield* journal.state.get).position).toBe(beforeForeign.position + 3)
      const observedPublications = Array.from(yield* Fiber.join(publications))
      expect(observedPublications.map(({ position }) => position)).toEqual([
        beforeForeign.position,
        beforeForeign.position + 1,
        beforeForeign.position + 2,
        beforeForeign.position + 3
      ])

      expect(
        yield* advanceAttemptStoppage(requestId, subject).pipe(
          Effect.provideService(
            PlannedAttemptExecutor,
            PlannedAttemptExecutor.of({
              observe: () => Effect.die("published Stop must use retained safe evidence"),
              requestSuspension: () => Effect.die("published Stop must use retained safe evidence"),
              begin: () => Effect.die("unused begin"),
              resume: () => Effect.die("unused resume")
            })
          )
        )
      ).toEqual({ _tag: "AttemptImplementationAbandoned" })
      const advancedRecords = yield* journal.read(runId)
      expect((yield* journal.state.get).position).toBe(beforeForeign.position + 4)
      expect(reduceWorkflowJournalHistory(runId, advancedRecords)._tag).toBe("ValidWorkflowJournalHistory")
    }).pipe(
      Effect.provide(
        Layer.mergeAll(Layer.succeed(Journal, published), Layer.succeed(InRunJournal, published), publishedControlLayer)
      )
    )

    const finalRecords = yield* storage.read(runId)
    const finalReduction = reduceWorkflowJournalHistory(runId, finalRecords)
    if (finalReduction._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(finalReduction)
    const restartedJournal = yield* makeJournal(runId, target, finalReduction, storage)
    const restartedControlLayer = attemptChoiceControlLayer.pipe(
      Layer.provide(Layer.succeed(InRunJournal, restartedJournal))
    )
    yield* Effect.gen(function* () {
      const restartedChoice = yield* (yield* AttemptChoiceControl).read(requestId)
      expect(restartedChoice._tag).toBe("StopApplied")
      if (restartedChoice._tag !== "StopApplied") return yield* Effect.die("restarted Stop was not reconstructed")
      expect(restartedChoice.application.event.subject.plannedAttempt.runId).toBe(runId)
      const restarted = yield* makeRunRecoveryProjection(runId)
      expect((yield* restarted.readDeliveryProjection).frontier.transitions).not.toContainEqual(
        expect.objectContaining({ _tag: "ResumePlannedAttemptExecutorWorkAfterCurrentFacts" })
      )
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Journal, restartedJournal),
          Layer.succeed(InRunJournal, restartedJournal),
          restartedControlLayer
        )
      )
    )
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("rejects a stale no-release observation after a newer exact claim read", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("unused observation"),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    const journal = yield* JournalStore
    const staleRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-stale-no-release"),
      target,
      taskId,
      [exactClaim.operationId]
    )
    yield* journal.append(runId, intentRecordKey(staleRead.operationId), taskTrackerReadIntent(staleRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(staleRead.operationId),
      taskTrackerFactsObservedEvent(
        staleRead.operationId,
        makeFocusedTaskClaimFactsObserved(staleRead, UnclaimedTask.make({ taskId }))
      )
    )
    const currentRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-newer-exact-claim"),
      target,
      taskId,
      [exactClaim.operationId, staleRead.operationId]
    )
    yield* journal.append(runId, intentRecordKey(currentRead.operationId), taskTrackerReadIntent(currentRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(currentRead.operationId),
      taskTrackerFactsObservedEvent(currentRead.operationId, makeFocusedTaskClaimFactsObserved(currentRead, exactClaim))
    )

    const contradiction = yield* recordStoppedAttemptClaimNoRelease(requestId, subject, staleRead.operationId).pipe(
      Effect.flip
    )
    expect(contradiction._tag).toBe("StoppedAttemptClaimObservationContradiction")
    const records = yield* journal.read(runId)
    expect(records.some(({ event }) => event._tag === "StoppedAttemptClaimNoReleaseObserved")).toBe(false)
    const forged = recordsWithRows(records, [
      {
        event: StoppedAttemptClaimNoReleaseObservedEvent.make({
          expectedClaim: exactClaim,
          observation: UnclaimedTask.make({ taskId }),
          observationOperationId: staleRead.operationId,
          occurrenceClassification: "NonActionOccurrence",
          requestId,
          subject,
          version: workflowJournalEventVersion
        }),
        key: stoppedAttemptClaimNoReleaseRecordKey(requestId)
      }
    ])
    expect(reduceWorkflowJournalHistory(runId, forged)).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("latest exact post-baseline claim read") })
      ])
    })
    const forgedExactClaimNoRelease = recordsWithRows(records, [
      {
        event: StoppedAttemptClaimNoReleaseObservedEvent.make({
          expectedClaim: exactClaim,
          observation: exactClaim,
          observationOperationId: currentRead.operationId,
          occurrenceClassification: "NonActionOccurrence",
          requestId,
          subject,
          version: workflowJournalEventVersion
        }),
        key: stoppedAttemptClaimNoReleaseRecordKey(requestId)
      }
    ])
    expect(invalidHistoryDetails(forgedExactClaimNoRelease)).toEqual(
      expect.arrayContaining([expect.stringContaining("cannot preserve the exact owned claim")])
    )
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("requires one exact stopped-claim release operation after its current claim read", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("unused observation"),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    const journal = yield* JournalStore
    const exactRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-release-authority-read"),
      target,
      taskId,
      [exactClaim.operationId]
    )
    yield* journal.append(runId, intentRecordKey(exactRead.operationId), taskTrackerReadIntent(exactRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(exactRead.operationId),
      taskTrackerFactsObservedEvent(exactRead.operationId, makeFocusedTaskClaimFactsObserved(exactRead, exactClaim))
    )
    const records = yield* journal.read(runId)
    const releaseOperation = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.StoppedAttemptClaimReleaseAuthority.make({
        observationOperationId: exactRead.operationId,
        requestId
      }),
      predecessorOperationIds: [exactClaim.operationId, exactRead.operationId],
      release: { claim: exactClaim, operationId: OperationId.make("attempt-stop-authorized-release") }
    })
    const releaseIntentRow = {
      event: TaskClaimReleaseIntendedEvent.make({ operation: releaseOperation, version: workflowJournalEventVersion }),
      key: intentRecordKey(releaseOperation.release.operationId)
    }
    const intended = recordsWithRows(records, [releaseIntentRow])
    expect(reduceWorkflowJournalHistory(runId, intended)._tag).toBe("ValidWorkflowJournalHistory")

    const noAppliedStopOperation = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.StoppedAttemptClaimReleaseAuthority.make({
        observationOperationId: exactRead.operationId,
        requestId: AttemptChoiceRequestId.make({ nonce: "attempt-stop-unapplied-release", runId })
      }),
      predecessorOperationIds: [exactClaim.operationId, exactRead.operationId],
      release: { claim: exactClaim, operationId: OperationId.make("attempt-stop-unapplied-release") }
    })
    expect(
      invalidHistoryDetails(
        recordsWithRows(records, [
          forgedRow(
            "unapplied-release-intent",
            TaskClaimReleaseIntendedEvent.make({
              operation: noAppliedStopOperation,
              version: workflowJournalEventVersion
            })
          )
        ])
      )
    ).toEqual(expect.arrayContaining([expect.stringContaining("requires its exact applied Stop")]))

    const beforeAbandonment = records.filter(({ event }) => event._tag !== "AttemptImplementationAbandoned")
    expect(invalidHistoryDetails(recordsWithRows(beforeAbandonment, [releaseIntentRow]))).toEqual(
      expect.arrayContaining([expect.stringContaining("precedes implementation abandonment")])
    )

    const foreignClaim = ActiveTaskClaim.make({
      operationId: OperationId.make("attempt-stop-release-foreign-claim"),
      owner: exactClaim.owner,
      taskId,
      token: ClaimToken.make("attempt-stop-release-foreign-token")
    })
    const foreignClaimRelease = makeTaskClaimReleaseOperation({
      authority: releaseOperation.authority,
      predecessorOperationIds: [foreignClaim.operationId, exactRead.operationId],
      release: { claim: foreignClaim, operationId: OperationId.make("attempt-stop-release-foreign") }
    })
    expect(
      invalidHistoryDetails(
        recordsWithRows(records, [
          forgedRow(
            "foreign-claim-release-intent",
            TaskClaimReleaseIntendedEvent.make({ operation: foreignClaimRelease, version: workflowJournalEventVersion })
          )
        ])
      )
    ).toEqual(expect.arrayContaining([expect.stringContaining("contradicts its authorized claim")]))

    const workflowRelease = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
      predecessorOperationIds: [exactClaim.operationId],
      release: { claim: exactClaim, operationId: OperationId.make("attempt-stop-workflow-release") }
    })
    expect(
      invalidHistoryDetails(
        recordsWithRows(records, [
          forgedRow(
            "workflow-release-intent",
            TaskClaimReleaseIntendedEvent.make({ operation: workflowRelease, version: workflowJournalEventVersion })
          )
        ])
      )
    ).toEqual(expect.arrayContaining([expect.stringContaining("requires explicit stopped-attempt authority")]))
    const workflowReleaseIntentRow = forgedRow(
      "workflow-release-intent-for-outcome",
      TaskClaimReleaseIntendedEvent.make({ operation: workflowRelease, version: workflowJournalEventVersion })
    )
    const workflowReleasedRow = forgedRow(
      "workflow-release-outcome",
      TaskClaimReleasedEvent.make({ release: workflowRelease.release, version: workflowJournalEventVersion })
    )
    expect(
      invalidHistoryDetails(recordsWithRows(records, [workflowReleaseIntentRow, workflowReleasedRow, releaseIntentRow]))
    ).toEqual(expect.arrayContaining([expect.stringContaining("requires explicit stopped-attempt authority")]))

    const withoutPostAbandonmentClaimRead = records.filter(
      ({ event }) =>
        !(
          (event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === exactRead.operationId) ||
          (event._tag === "TaskTrackerFactsObserved" && event.operationId === exactRead.operationId)
        )
    )
    expect(invalidHistoryDetails(recordsWithRows(withoutPostAbandonmentClaimRead, [releaseIntentRow]))).toEqual(
      expect.arrayContaining([expect.stringContaining("requires its latest exact post-abandonment claim read")])
    )

    expect(
      invalidHistoryDetails(
        recordsWithRows(records, [
          forgedRow(
            "unapplied-release-intent-for-outcome",
            TaskClaimReleaseIntendedEvent.make({
              operation: noAppliedStopOperation,
              version: workflowJournalEventVersion
            })
          ),
          forgedRow(
            "unapplied-release-outcome",
            TaskClaimReleasedEvent.make({
              release: noAppliedStopOperation.release,
              version: workflowJournalEventVersion
            })
          )
        ])
      )
    ).toEqual(expect.arrayContaining([expect.stringContaining("has no exact prior abandonment")]))

    const duplicateOperation = makeTaskClaimReleaseOperation({
      authority: releaseOperation.authority,
      predecessorOperationIds: releaseOperation.predecessorOperationIds,
      release: { claim: exactClaim, operationId: OperationId.make("attempt-stop-duplicate-release") }
    })
    const releasedRow = {
      event: TaskClaimReleasedEvent.make({ release: releaseOperation.release, version: workflowJournalEventVersion }),
      key: outcomeRecordKey(releaseOperation.release.operationId)
    }
    const duplicateIntentRow = {
      event: TaskClaimReleaseIntendedEvent.make({
        operation: duplicateOperation,
        version: workflowJournalEventVersion
      }),
      key: intentRecordKey(duplicateOperation.release.operationId)
    }
    const duplicateReleasedRow = {
      event: TaskClaimReleasedEvent.make({ release: duplicateOperation.release, version: workflowJournalEventVersion }),
      key: outcomeRecordKey(duplicateOperation.release.operationId)
    }
    const duplicate = recordsWithRows(intended, [duplicateIntentRow])
    expect(reduceWorkflowJournalHistory(runId, duplicate)).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("already has one durable intent") })
      ])
    })

    expect(invalidHistoryDetails(recordsWithRows(intended, [releasedRow, duplicateIntentRow]))).toEqual(
      expect.arrayContaining([expect.stringContaining("claim disposition is already terminal")])
    )
    expect(
      invalidHistoryDetails(recordsWithRows(intended, [releasedRow, duplicateIntentRow, duplicateReleasedRow]))
    ).toEqual(expect.arrayContaining([expect.stringContaining("claim disposition is already terminal")]))

    expect(
      invalidHistoryDetails(
        recordsWithRows(beforeAbandonment, [
          releaseIntentRow,
          {
            event: TaskClaimReleasedEvent.make({
              release: releaseOperation.release,
              version: workflowJournalEventVersion
            }),
            key: outcomeRecordKey(releaseOperation.release.operationId)
          }
        ])
      )
    ).toEqual(expect.arrayContaining([expect.stringContaining("has no exact prior abandonment")]))

    const wrongOutcomeOperationId = OperationId.make("attempt-stop-wrong-release-outcome")
    const wrongOutcome = recordsWithRows(intended, [
      {
        event: TaskClaimReleasedEvent.make({
          release: { ...releaseOperation.release, operationId: wrongOutcomeOperationId },
          version: workflowJournalEventVersion
        }),
        key: outcomeRecordKey(wrongOutcomeOperationId)
      }
    ])
    expect(reduceWorkflowJournalHistory(runId, wrongOutcome)).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("contradicts operation") })
      ])
    })

    const predatedRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-predated-release-read"),
      target,
      taskId,
      [exactClaim.operationId]
    )
    const abandonmentIndex = records.findIndex(({ event }) => event._tag === "AttemptImplementationAbandoned")
    const predatedRows: Array<Pick<JournalRecord, "event" | "key">> = records.map(({ event, key }) => ({ event, key }))
    predatedRows.splice(abandonmentIndex, 0, {
      event: taskTrackerReadIntent(predatedRead),
      key: intentRecordKey(predatedRead.operationId)
    })
    const predatedPrefix = recordsWithRows([], predatedRows)
    const predatedObservation = {
      event: taskTrackerFactsObservedEvent(
        predatedRead.operationId,
        makeFocusedTaskClaimFactsObserved(predatedRead, exactClaim)
      ),
      key: outcomeRecordKey(predatedRead.operationId)
    }
    const predatedRelease = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.StoppedAttemptClaimReleaseAuthority.make({
        observationOperationId: predatedRead.operationId,
        requestId
      }),
      predecessorOperationIds: [exactClaim.operationId, predatedRead.operationId],
      release: { claim: exactClaim, operationId: OperationId.make("attempt-stop-predated-release") }
    })
    const predated = recordsWithRows(predatedPrefix, [
      predatedObservation,
      {
        event: TaskClaimReleaseIntendedEvent.make({ operation: predatedRelease, version: workflowJournalEventVersion }),
        key: intentRecordKey(predatedRelease.release.operationId)
      }
    ])
    expect(reduceWorkflowJournalHistory(runId, predated)).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("latest exact post-abandonment claim read") })
      ])
    })
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("makes released and no-release stopped-claim dispositions mutually exclusive", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("unused observation"),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    const journal = yield* JournalStore
    const exactRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-terminal-exact-read"),
      target,
      taskId,
      [exactClaim.operationId]
    )
    yield* journal.append(runId, intentRecordKey(exactRead.operationId), taskTrackerReadIntent(exactRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(exactRead.operationId),
      taskTrackerFactsObservedEvent(exactRead.operationId, makeFocusedTaskClaimFactsObserved(exactRead, exactClaim))
    )
    const releaseOperation = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.StoppedAttemptClaimReleaseAuthority.make({
        observationOperationId: exactRead.operationId,
        requestId
      }),
      predecessorOperationIds: [exactClaim.operationId, exactRead.operationId],
      release: { claim: exactClaim, operationId: OperationId.make("attempt-stop-terminal-release") }
    })
    yield* journal.append(
      runId,
      intentRecordKey(releaseOperation.release.operationId),
      TaskClaimReleaseIntendedEvent.make({ operation: releaseOperation, version: workflowJournalEventVersion })
    )
    const intended = yield* journal.read(runId)
    const missingRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-terminal-missing-read"),
      target,
      taskId,
      [exactClaim.operationId, releaseOperation.release.operationId]
    )
    const missingObservation = UnclaimedTask.make({ taskId })
    const readRows = [
      { event: taskTrackerReadIntent(missingRead), key: intentRecordKey(missingRead.operationId) },
      {
        event: taskTrackerFactsObservedEvent(
          missingRead.operationId,
          makeFocusedTaskClaimFactsObserved(missingRead, missingObservation)
        ),
        key: outcomeRecordKey(missingRead.operationId)
      }
    ] as const
    const releasedRow = {
      event: TaskClaimReleasedEvent.make({ release: releaseOperation.release, version: workflowJournalEventVersion }),
      key: outcomeRecordKey(releaseOperation.release.operationId)
    }
    const noReleaseRow = {
      event: StoppedAttemptClaimNoReleaseObservedEvent.make({
        expectedClaim: exactClaim,
        observation: missingObservation,
        observationOperationId: missingRead.operationId,
        occurrenceClassification: "NonActionOccurrence",
        requestId,
        subject,
        version: workflowJournalEventVersion
      }),
      key: stoppedAttemptClaimNoReleaseRecordKey(requestId)
    }

    for (const forged of [
      recordsWithRows(intended, [releasedRow, ...readRows, noReleaseRow]),
      recordsWithRows(intended, [...readRows, noReleaseRow, releasedRow])
    ]) {
      expect(reduceWorkflowJournalHistory(runId, forged)).toMatchObject({
        _tag: "InvalidWorkflowJournalHistory",
        issues: expect.arrayContaining([
          expect.objectContaining({ detail: "stopped-attempt claim disposition is already terminal" })
        ])
      })
    }
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("releases only the freshly confirmed exact claim after Stop", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("unused observation"),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    const recovery = yield* makeRunRecoveryProjection(runId)
    const claimReads = yield* Ref.make(0)
    const releases = yield* Ref.make(0)
    const base = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unusedBoundary,
        readTaskClaim: () =>
          Ref.update(claimReads, (count) => count + 1).pipe(
            Effect.as(AuthoritativeTaskClaimObserved.make({ observation: exactClaim }))
          ),
        readTaskWorktree: unusedBoundary,
        readTargetLineage: unusedBoundary,
        readTrackerGraph: unusedBoundary,
        readTaskWorkSpecification: unusedBoundary,
        reconcileTaskWorktree: unusedBoundary,
        recordTaskAttemptPlan: unusedBoundary,
        releaseTaskClaim: (operation) =>
          Ref.update(releases, (count) => count + 1).pipe(
            Effect.as(AuthoritativeTaskClaimReleased.make({ release: operation.release }))
          )
      })
    )
    const journaled = journaledWorkflowInterpreterLayer(runId, base)
    yield* Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const observe = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "ObserveStoppedAttemptClaim"
      )
      if (observe?._tag !== "ObserveStoppedAttemptClaim") return yield* Effect.die("missing stopped claim read")
      yield* interpreter.readTaskClaim(observe.operation)

      const release = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "ReleaseStoppedAttemptClaim"
      )
      if (release?._tag !== "ReleaseStoppedAttemptClaim") return yield* Effect.die("missing stopped claim release")
      yield* interpreter.releaseTaskClaim(release.operation)
      yield* interpreter.releaseTaskClaim(release.operation)
    }).pipe(Effect.provide(journaled))

    const projection = yield* recovery.readDeliveryProjection
    const records = yield* (yield* JournalStore).read(runId)
    expect(yield* Ref.get(claimReads)).toBe(1)
    expect(yield* Ref.get(releases)).toBe(1)
    expect(records.filter(({ event }) => event._tag === "TaskClaimReleaseIntended")).toHaveLength(1)
    expect(records.filter(({ event }) => event._tag === "TaskClaimReleased")).toHaveLength(1)
    expect(projection.frontier.transitions.some(({ _tag }) => _tag === "ReconcileTaskClaimRelease")).toBe(false)
    expect(projection.frontier.explanations).toContainEqual(
      expect.objectContaining({ _tag: "StoppedAttemptSettled", claimDisposition: "Released" })
    )
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("retries the same stopped-claim release after reconstruction confirms the exact claim remains", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("unused observation"),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    const recovery = yield* makeRunRecoveryProjection(runId)
    const releases = yield* Ref.make<ReadonlyArray<OperationId>>([])
    const base = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unusedBoundary,
        readTaskClaim: () => Effect.succeed(AuthoritativeTaskClaimObserved.make({ observation: exactClaim })),
        readTaskWorktree: unusedBoundary,
        readTargetLineage: unusedBoundary,
        readTrackerGraph: unusedBoundary,
        readTaskWorkSpecification: unusedBoundary,
        reconcileTaskWorktree: unusedBoundary,
        recordTaskAttemptPlan: unusedBoundary,
        releaseTaskClaim: (operation) =>
          Effect.gen(function* () {
            const attempted = yield* Ref.updateAndGet(releases, (current) => [
              ...current,
              operation.release.operationId
            ])
            if (attempted.length === 1) {
              return yield* new TaskClaimReleaseFailure({
                detail: "response lost while the exact claim remained current",
                release: operation.release
              })
            }
            return AuthoritativeTaskClaimReleased.make({ release: operation.release })
          })
      })
    )

    yield* Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const firstRead = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "ObserveStoppedAttemptClaim"
      )
      if (firstRead?._tag !== "ObserveStoppedAttemptClaim") return yield* Effect.die("missing first claim read")
      yield* interpreter.readTaskClaim(firstRead.operation)

      const release = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "ReleaseStoppedAttemptClaim"
      )
      if (release?._tag !== "ReleaseStoppedAttemptClaim") return yield* Effect.die("missing claim release")
      expect((yield* Effect.result(interpreter.releaseTaskClaim(release.operation)))._tag).toBe("Failure")

      const reconcileRead = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "ObserveStoppedAttemptClaim"
      )
      if (reconcileRead?._tag !== "ObserveStoppedAttemptClaim") {
        return yield* Effect.die("missing claim release reconciliation read")
      }
      yield* interpreter.readTaskClaim(reconcileRead.operation)

      const retry = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "RetryStoppedAttemptClaimRelease"
      )
      if (retry?._tag !== "RetryStoppedAttemptClaimRelease") {
        return yield* Effect.die("missing exact stopped-claim release retry")
      }
      expect(retry.operation.release.operationId).toBe(release.operation.release.operationId)
      const records = yield* (yield* JournalStore).read(runId)
      const contributions = deliveryProposalsOf({
        acceptedOperationIds: acceptedOperationIdsOf(records),
        fresh: [],
        runId,
        transitions: [retry]
      })
      expect(contributions.issues).toEqual([])
      const proposal = contributions.ticketDelivery[0]
      if (proposal?.actionIdentity._tag !== "ExistingOperationId" || proposal.route._tag !== "AcceptedWorkflowRoute") {
        return yield* Effect.die("exact retry did not use the accepted-operation route")
      }
      expect(acceptedWorkflowTransitionOperationId(proposal.route.transition)).toBe(
        release.operation.release.operationId
      )
      yield* executeAcceptedWorkflowAction(runId, proposal.route.transition, inertBoundaryLease).pipe(
        Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
      )
    }).pipe(Effect.provide(journaledWorkflowInterpreterLayer(runId, base)))

    const records = yield* (yield* JournalStore).read(runId)
    const [firstAttempt, retryAttempt] = yield* Ref.get(releases)
    expect(firstAttempt).toBeDefined()
    expect(retryAttempt).toBe(firstAttempt)
    expect(records.filter(({ event }) => event._tag === "TaskClaimReleaseIntended")).toHaveLength(1)
    expect(records.filter(({ event }) => event._tag === "TaskClaimReleased")).toHaveLength(1)
    expect((yield* recovery.readDeliveryProjection).frontier.explanations).toContainEqual(
      expect.objectContaining({ _tag: "StoppedAttemptSettled", claimDisposition: "Released" })
    )
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("stops implementation without mutating an absent or foreign claim", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("unused observation"),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    const recovery = yield* makeRunRecoveryProjection(runId)
    const reads = yield* Ref.make(0)
    const releases = yield* Ref.make(0)
    const foreignClaim = ActiveTaskClaim.make({
      operationId: OperationId.make("attempt-stop-foreign-claim"),
      owner: ClaimOwner.make("foreign-owner"),
      taskId,
      token: ClaimToken.make("attempt-stop-foreign-token")
    })
    const base = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unusedBoundary,
        readTaskClaim: () =>
          Ref.updateAndGet(reads, (count) => count + 1).pipe(
            Effect.map((count) =>
              AuthoritativeTaskClaimObserved.make({ observation: count === 1 ? exactClaim : foreignClaim })
            )
          ),
        readTaskWorktree: unusedBoundary,
        readTargetLineage: unusedBoundary,
        readTrackerGraph: unusedBoundary,
        readTaskWorkSpecification: unusedBoundary,
        reconcileTaskWorktree: unusedBoundary,
        recordTaskAttemptPlan: unusedBoundary,
        releaseTaskClaim: (operation) =>
          Ref.update(releases, (count) => count + 1).pipe(
            Effect.andThen(
              Effect.fail(new TaskClaimReleaseFailure({ detail: "response lost", release: operation.release }))
            )
          )
      })
    )
    const journaled = journaledWorkflowInterpreterLayer(runId, base)
    yield* Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const firstRead = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "ObserveStoppedAttemptClaim"
      )
      if (firstRead?._tag !== "ObserveStoppedAttemptClaim") return yield* Effect.die("missing first claim read")
      yield* interpreter.readTaskClaim(firstRead.operation)
      const release = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "ReleaseStoppedAttemptClaim"
      )
      if (release?._tag !== "ReleaseStoppedAttemptClaim") return yield* Effect.die("missing claim release")
      expect((yield* Effect.result(interpreter.releaseTaskClaim(release.operation)))._tag).toBe("Failure")
      const pending = yield* (yield* AttemptChoiceControl).apply({
        choice: "StopTaskImplementation",
        requestId,
        subject
      })
      expect(pending).toMatchObject({
        _tag: "StopApplied",
        status: {
          _tag: "ImplementationAbandonedClaimReleasePending",
          operationId: release.operation.release.operationId
        }
      })

      const reconcileRead = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "ObserveStoppedAttemptClaim"
      )
      if (reconcileRead?._tag !== "ObserveStoppedAttemptClaim") {
        return yield* Effect.die("missing claim release reconciliation read")
      }
      yield* interpreter.readTaskClaim(reconcileRead.operation)
    }).pipe(Effect.provide(journaled))

    const noRelease = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "RecordStoppedAttemptClaimNoRelease"
    )
    if (noRelease?._tag !== "RecordStoppedAttemptClaimNoRelease") {
      return yield* Effect.die("missing stopped no-release transition")
    }
    expect(
      (yield* recovery.readDeliveryProjection).frontier.transitions.some(
        ({ _tag }) => _tag === "ReconcileTaskClaimRelease"
      )
    ).toBe(false)
    yield* recordStoppedAttemptClaimNoRelease(requestId, subject, noRelease.observationOperationId)

    const laterRecovery = yield* makeRunRecoveryProjection(runId)
    const laterProjection = yield* laterRecovery.readDeliveryProjection
    const records = yield* (yield* JournalStore).read(runId)
    expect(yield* Ref.get(reads)).toBe(2)
    expect(yield* Ref.get(releases)).toBe(1)
    expect(laterProjection.frontier.transitions.some(({ _tag }) => _tag === "ReconcileTaskClaimRelease")).toBe(false)
    expect(laterProjection.frontier.explanations).toContainEqual(
      expect.objectContaining({ _tag: "StoppedAttemptSettled", claimDisposition: "NoRelease" })
    )
    expect(yield* (yield* AttemptChoiceControl).read(requestId)).toMatchObject({
      _tag: "StopApplied",
      status: { _tag: "SettledNoRelease", observation: foreignClaim }
    })
    expect(records.findLast(({ event }) => event._tag === "StoppedAttemptClaimNoReleaseObserved")?.event).toMatchObject(
      { observation: foreignClaim }
    )
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)
