import type { PlannedTaskAttempt, TaskWorkSpecification } from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  InitialControlPolicy,
  JournalHistoryInvalid,
  JournalPosition,
  JournalStore,
  OperationId,
  PlannedWorktreeReady,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisition,
  TaskClaimAcquisitionIntendedEvent,
  TaskLifecycle,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TaskWorkCapacity,
  TrackerRevision,
  describeJournalEvent,
  intentRecordKey,
  journalLayer,
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  outcomeRecordKey,
  projectTrackerSnapshot,
  reduceWorkflowJournalHistory,
  sqliteJournalTestLayer,
  taskTrackerFactsObservedEvent,
  taskTrackerReadIntent,
  workflowJournalEventVersion,
  type JournalDatabaseLocator
} from "@dalph/orchestrator"
import { Effect, Layer, Option } from "effect"

const seedQualificationPlannedAttempt = Effect.fn("QualificationJournal.seedPlannedAttempt")(function* (options: {
  readonly attempt: PlannedTaskAttempt
  readonly specification: TaskWorkSpecification
}) {
  const journal = yield* JournalStore
  const target = FixtureTarget.make("qualification")
  const claim = ActiveTaskClaim.make({
    operationId: OperationId.make("qualification-claim"),
    owner: ClaimOwner.make("dalph:qualification"),
    taskId: options.attempt.taskId,
    token: ClaimToken.make("qualification-claim-token")
  })
  const claimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: TaskClaimAcquisition.make(claim),
    predecessorOperationIds: []
  })
  const graphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("qualification-post-claim-graph"),
    target,
    [claim.operationId],
    [options.attempt.taskId]
  )
  const graph = projectTrackerSnapshot({
    revision: TrackerRevision.make("qualification-graph"),
    tasks: [
      {
        id: options.attempt.taskId,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
    ]
  })
  const snapshot = Option.getOrThrow(graph._tag === "Valid" ? Option.some(graph.snapshot) : Option.none())
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("qualification-original-specification"),
    target,
    options.attempt.taskId,
    [graphOperation.operationId]
  )
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("qualification-plan"),
    plannedAttempt: options.attempt,
    predecessorOperationIds: [specificationOperation.operationId]
  })
  const worktreeOperation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("qualification-worktree"),
    plannedAttempt: options.attempt,
    predecessorOperationIds: [planOperation.operationId]
  })

  yield* journal.beginRun(
    options.attempt.runId,
    target,
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  yield* journal.append(
    options.attempt.runId,
    intentRecordKey(claim.operationId),
    TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    options.attempt.runId,
    outcomeRecordKey(claim.operationId),
    TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    options.attempt.runId,
    intentRecordKey(graphOperation.operationId),
    taskTrackerReadIntent(graphOperation)
  )
  yield* journal.append(
    options.attempt.runId,
    outcomeRecordKey(graphOperation.operationId),
    taskTrackerFactsObservedEvent(
      graphOperation.operationId,
      makeCompleteTaskTrackerFactsObserved(graphOperation, snapshot)
    )
  )
  yield* journal.append(
    options.attempt.runId,
    intentRecordKey(specificationOperation.operationId),
    taskTrackerReadIntent(specificationOperation)
  )
  yield* journal.append(
    options.attempt.runId,
    outcomeRecordKey(specificationOperation.operationId),
    taskTrackerFactsObservedEvent(
      specificationOperation.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, options.specification)
    )
  )
  const planned = TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
  yield* journal.append(options.attempt.runId, describeJournalEvent(planned).expectedKey, planned)
  yield* journal.append(
    options.attempt.runId,
    intentRecordKey(worktreeOperation.operationId),
    TaskWorktreeReconciliationIntendedEvent.make({ operation: worktreeOperation, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    options.attempt.runId,
    outcomeRecordKey(worktreeOperation.operationId),
    TaskWorktreeReadyEvent.make({
      operationId: worktreeOperation.operationId,
      proof: PlannedWorktreeReady.make({
        baseSha: options.attempt.baseSha,
        branch: options.attempt.branch,
        headSha: options.attempt.baseSha,
        worktree: options.attempt.worktree
      }),
      version: workflowJournalEventVersion
    })
  )
})

/**
 * Opens the qualification cassette's durable journal as one accepted live lifecycle.
 * An empty database is established before ownership; every later process cold-imports
 * the persisted chronology exactly once before crossing executor boundaries.
 */
export const qualificationWorkflowJournalLayer = (options: {
  readonly attempt: PlannedTaskAttempt
  readonly filename: JournalDatabaseLocator
  readonly specification: TaskWorkSpecification
}) => {
  const target = FixtureTarget.make("qualification")
  const storage = sqliteJournalTestLayer({ filename: options.filename })
  return Layer.unwrap(
    Effect.gen(function* () {
      const journal = yield* JournalStore
      let records = yield* journal.read(options.attempt.runId)
      if (records.length === 0) {
        yield* seedQualificationPlannedAttempt(options)
        records = yield* journal.read(options.attempt.runId)
      }
      const initial = reduceWorkflowJournalHistory(options.attempt.runId, records)
      if (initial._tag === "InvalidWorkflowJournalHistory") {
        const issue = initial.issues[0]
        return yield* new JournalHistoryInvalid({
          detail: JSON.stringify(initial.issues),
          position: issue !== undefined && "position" in issue ? issue.position : JournalPosition.make(1),
          runId: options.attempt.runId
        })
      }
      return journalLayer(options.attempt.runId, target, initial, journal)
    })
  ).pipe(Layer.provideMerge(storage))
}
