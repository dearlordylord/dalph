import { Effect } from "effect"
import {
  makeTaskWorkSpecification,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  type TaskWorkSpecification
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  InitialControlPolicy,
  GitReadIntentRecordedEvent,
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent,
  JournalPosition,
  JournalRecord,
  OperationId,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedWorktreeReady,
  StartedIntegrationResponsibility,
  TaskClaimAcquisition,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskAttemptPlannedEvent,
  TaskLifecycle,
  TaskWorkCapacity,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TargetLineageObservedEvent,
  TrackerRevision,
  WorkflowActor,
  WorkflowRunBeganEvent,
  describeJournalEvent,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  projectTrackerSnapshot,
  taskTrackerFactsObservedEvent,
  taskTrackerReadIntent,
  makeTargetLineageObservationOperation,
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  reduceWorkflowJournalHistory,
  workflowJournalEventVersion,
  type TrackerTarget,
  type WorkflowJournalEvent
} from "@dalph/orchestrator"
import {
  integratorPreparationInputFor,
  type AuthoredIntegratorCassette,
  type IntegratorCassetteInput
} from "./integrator-cassette-domain.js"

export interface CoherentIntegratorHistory {
  readonly input: IntegratorCassetteInput
  readonly records: ReadonlyArray<JournalRecord>
  readonly startingFacts: AuthoredIntegratorCassette["startingFacts"]
  readonly target: TrackerTarget
}

export interface CoherentIntegratorHistoryOptions {
  readonly claimOwner?: ClaimOwner
  readonly specification?: TaskWorkSpecification
  readonly target?: TrackerTarget
}

const journalRecordFor = (
  runId: IntegratorCassetteInput["responsibility"]["plannedAttempt"]["runId"],
  position: number,
  event: WorkflowJournalEvent
): JournalRecord =>
  JournalRecord.make({
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(position),
    runId
  })

/** Builds the complete accepted prefix required by the live Integrator protocol. */
export const coherentHistoryFor = Effect.fn("IntegratorCassette.coherentHistoryFor")(function* (
  cassette: AuthoredIntegratorCassette,
  options: CoherentIntegratorHistoryOptions = {}
) {
  const source = cassette.startingFacts
  const sourceAttempt = source.responsibility.plannedAttempt
  const runId = sourceAttempt.runId
  const target = options.target ?? FixtureTarget.make(`integrator-cassette-target:${runId}`)
  const specification: TaskWorkSpecification =
    options.specification ??
    makeTaskWorkSpecification({
      body: `Maintained Integrator cassette for ${sourceAttempt.taskId}`,
      taskId: sourceAttempt.taskId,
      title: `Maintained Integrator cassette for ${sourceAttempt.taskId}`
    })
  const plannedAttempt: PlannedTaskAttempt = PlannedTaskAttempt.make({
    ...sourceAttempt,
    taskRevision: specification.fingerprint
  })
  const activeClaim = ActiveTaskClaim.make({
    operationId: OperationId.make(`integrator-cassette-claim:${sourceAttempt.taskId}`),
    owner: options.claimOwner ?? ClaimOwner.make("integrator-cassette"),
    taskId: sourceAttempt.taskId,
    token: ClaimToken.make(`integrator-cassette-token:${sourceAttempt.taskId}`)
  })
  const claimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: TaskClaimAcquisition.make({
      operationId: activeClaim.operationId,
      owner: activeClaim.owner,
      taskId: activeClaim.taskId,
      token: activeClaim.token
    }),
    predecessorOperationIds: []
  })
  const graphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make(`${activeClaim.operationId}:graph`),
    target,
    [claimOperation.acquisition.operationId],
    [plannedAttempt.taskId]
  )
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make(`${activeClaim.operationId}:specification`),
    target,
    plannedAttempt.taskId,
    [graphOperation.operationId]
  )
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make(`${activeClaim.operationId}:plan`),
    plannedAttempt,
    predecessorOperationIds: [specificationOperation.operationId]
  })
  const worktreeOperation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make(`${activeClaim.operationId}:worktree`),
    plannedAttempt,
    predecessorOperationIds: [planOperation.operationId]
  })
  const projection = projectTrackerSnapshot({
    revision: TrackerRevision.make(`${runId}:integrator-cassette-graph`),
    tasks: [
      {
        id: plannedAttempt.taskId,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
    ]
  })
  if (projection._tag !== "Valid") {
    return yield* Effect.die(`integrator cassette graph fixture is invalid: ${JSON.stringify(projection.issues)}`)
  }
  const graphSnapshot = projection.snapshot
  const worktreeProof = PlannedWorktreeReady.make({
    baseSha: plannedAttempt.baseSha,
    branch: plannedAttempt.branch,
    headSha: plannedAttempt.baseSha,
    worktree: plannedAttempt.worktree
  })
  const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  let records: ReadonlyArray<JournalRecord> = []
  const append = (event: WorkflowJournalEvent): JournalRecord => {
    const record = journalRecordFor(runId, records.length + 1, event)
    records = [...records, record]
    return record
  }
  append(
    WorkflowRunBeganEvent.make({
      initialControlPolicy: policy,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      target,
      version: workflowJournalEventVersion
    })
  )
  append(TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion }))
  append(TaskClaimAcquiredEvent.make({ claim: activeClaim, version: workflowJournalEventVersion }))
  append(taskTrackerReadIntent(graphOperation))
  append(
    taskTrackerFactsObservedEvent(
      graphOperation.operationId,
      makeCompleteTaskTrackerFactsObserved(graphOperation, graphSnapshot)
    )
  )
  append(taskTrackerReadIntent(specificationOperation))
  append(
    taskTrackerFactsObservedEvent(
      specificationOperation.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
    )
  )
  append(TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion }))
  append(
    TaskWorktreeReconciliationIntendedEvent.make({ operation: worktreeOperation, version: workflowJournalEventVersion })
  )
  append(
    TaskWorktreeReadyEvent.make({
      operationId: worktreeOperation.operationId,
      proof: worktreeProof,
      version: workflowJournalEventVersion
    })
  )
  append(
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
  const beginOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  const executingReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
    correlation: { attemptId: plannedAttempt.attemptId, runId }
  })
  append(
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Begin",
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      ordinal: beginOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  append(
    PlannedAttemptExecutorCommandResponseObservedEvent.make({
      commandOrdinal: beginOrdinal,
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      report: executingReport,
      version: workflowJournalEventVersion
    })
  )
  append(
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report: executingReport,
      version: workflowJournalEventVersion
    })
  )
  const acceptedReport = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
    correlation: { attemptId: plannedAttempt.attemptId, runId },
    result: { _tag: "Accepted", acceptedResult: source.responsibility.acceptedResult }
  })
  append(
    PlannedAttemptExecutorStateObservedEvent.make({
      observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: acceptedReport }),
      occurrenceClassification: "NonActionOccurrence",
      ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  append(
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1 + 1),
      report: acceptedReport,
      version: workflowJournalEventVersion
    })
  )
  const responsibilityRecord = append(
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult: source.responsibility.acceptedResult,
      integrationTarget: source.responsibility.integrationTarget,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const startedRecord = append(
    IntegrationStartedEvent.make({
      acceptedResult: source.responsibility.acceptedResult,
      integrationTarget: source.responsibility.integrationTarget,
      plannedAttempt,
      responsibilityBeganAt: responsibilityRecord.position,
      version: workflowJournalEventVersion
    })
  )
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget: source.responsibility.integrationTarget,
    operationId: OperationId.make(`integrator-cassette-lineage:${plannedAttempt.attemptId}`),
    plannedAttempt,
    predecessorOperationIds: [worktreeOperation.operationId]
  })
  append(
    GitReadIntentRecordedEvent.make({
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      operation: lineageOperation,
      version: workflowJournalEventVersion
    })
  )
  const lineage = TargetLineageObservedEvent.make({
    observation: source.targetLineage,
    occurrenceClassification: "NonActionOccurrence",
    operationId: lineageOperation.operationId,
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const lineageRecord = append(lineage)
  const reduction = reduceWorkflowJournalHistory(runId, records)
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    return yield* Effect.die(`integrator cassette history is invalid: ${JSON.stringify(reduction.issues)}`)
  }
  const input = integratorPreparationInputFor({
    responsibility: source.responsibility,
    targetLineage: source.targetLineage,
    targetLineageObservedAt: lineageRecord.position
  })
  const coherentResponsibility = StartedIntegrationResponsibility.make({
    acceptedResult: input.responsibility.acceptedResult,
    integrationTarget: input.responsibility.integrationTarget,
    plannedAttempt,
    queuedAt: responsibilityRecord.position,
    startedAt: startedRecord.position
  })
  const startingFacts = {
    responsibility: coherentResponsibility,
    targetLineage: source.targetLineage,
    targetLineageObservedAt: lineageRecord.position
  }
  return {
    input: integratorPreparationInputFor(startingFacts),
    records,
    startingFacts,
    target
  } satisfies CoherentIntegratorHistory
})
