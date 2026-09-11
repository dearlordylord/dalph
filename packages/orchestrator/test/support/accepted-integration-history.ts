import { makeTaskWorkSpecification, PlannedAttemptExecutorReport } from "@dalph/contracts"
import type {
  AcceptedResult,
  GitCommitSha,
  IntegrationTarget,
  PlannedTaskAttempt,
  RunId,
  TaskWorkSpecification
} from "@dalph/contracts"
import { Effect, Option } from "effect"
import { PlannedWorktreeReady } from "../../src/authorities/git/worktree.js"
import { projectTrackerSnapshot } from "../../src/authorities/task-tracker/graph.js"
import { TaskClaimAcquisition } from "../../src/authorities/task-tracker/claim-mutation.js"
import type { ActiveTaskClaim } from "../../src/authorities/task-tracker/claim-mutation.js"
import { TaskLifecycle, TrackerRevision } from "../../src/authorities/task-tracker/task.js"
import type { TrackerTarget } from "../../src/authorities/task-tracker/target.js"
import { InitialControlPolicy } from "../../src/control/policy.js"
import { TaskWorkCapacity } from "../../src/coordination/admission/capacity.js"
import { reduceWorkflowJournalHistory } from "../../src/coordination/reconstruction/history.js"
import { makeCompleteTaskTrackerFactsObserved, makeFocusedTaskWorkSpecificationFactsObserved, taskTrackerFactsObservedEvent } from "../../src/workflow/task-tracker-facts/observation.js"
import { OperationId } from "../../src/workflow/identity.js"
import { workflowJournalEventVersion } from "../../src/workflow/kernel/event.js"
import { describeJournalEvent } from "../../src/workflow/registry/event-descriptor.js"
import {
  GitReadIntentRecordedEvent,
  TargetLineageObservedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../src/workflow/registry/event.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../src/workflow/protocols/planned-attempt-executor-work/events.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTargetLineageObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../src/workflow/registry/operation.js"
import { JournalPosition } from "../../src/workflow-journal/identity.js"
import { makeWorkflowRunBeganRecord } from "../../src/workflow-journal/run-lifecycle.js"
import type { JournalRecord } from "../../src/workflow-journal/store.js"
import { TargetLineageObservation } from "../../src/authorities/git/target-lineage.js"
import { IntegrationResponsibilityBeganEvent, IntegrationStartedEvent } from "../../src/workflow/protocols/integration-admission/events.js"
import { StartedIntegrationResponsibility } from "../../src/workflow/protocols/integration-admission/responsibility.js"

const acceptedExecutorReportOrdinalValue = 2

export interface AcceptedIntegrationHistoryInput {
  readonly acceptedResult: AcceptedResult
  readonly activeClaim: ActiveTaskClaim
  readonly integrationTarget: IntegrationTarget
  readonly initialControlPolicy?: InitialControlPolicy
  readonly plannedAttempt: PlannedTaskAttempt
  readonly runId: RunId
  readonly targetHeadSha: GitCommitSha
  readonly taskSpecification?: TaskWorkSpecification
  readonly trackerTarget: TrackerTarget
}

export interface AcceptedIntegrationHistory {
  readonly acceptedResult: AcceptedResult
  readonly activeClaim: ActiveTaskClaim
  readonly graphOperation: ReturnType<typeof makeTrackerGraphObservationOperation>
  readonly integrationTarget: IntegrationTarget
  readonly planOperation: ReturnType<typeof makeTaskAttemptPlanOperation>
  readonly plannedAttempt: PlannedTaskAttempt
  readonly records: ReadonlyArray<JournalRecord>
  readonly responsibility: StartedIntegrationResponsibility
  readonly runId: RunId
  readonly specification: TaskWorkSpecification
  readonly specificationOperation: ReturnType<typeof makeTaskWorkSpecificationObservationOperation>
  readonly targetLineage: TargetLineageObservation
  readonly targetLineageObservedAt: JournalPosition
  readonly targetLineageOperation: ReturnType<typeof makeTargetLineageObservationOperation>
  readonly trackerTarget: TrackerTarget
  readonly worktreeOperation: ReturnType<typeof makeTaskWorktreeReconciliationOperation>
}

const defaultSpecification = (plannedAttempt: PlannedTaskAttempt): TaskWorkSpecification =>
  makeTaskWorkSpecification({
    body: `Accepted integration fixture for ${plannedAttempt.taskId}`,
    taskId: plannedAttempt.taskId,
    title: `Accepted integration fixture for ${plannedAttempt.taskId}`
  })

const appendRecord = (runId: RunId, records: ReadonlyArray<JournalRecord>, event: JournalRecord["event"]) => {
  const appended: JournalRecord = {
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(records.length + 1),
    runId
  }
  return { appended, records: [...records, appended] }
}

const requireValidHistory = (runId: RunId, records: ReadonlyArray<JournalRecord>): void => {
  const reduction = reduceWorkflowJournalHistory(runId, records)
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    Effect.runSync(Effect.die(`invalid accepted integration fixture: ${JSON.stringify(reduction.issues)}`))
  }
}

/** Builds a reducer-accepted pre-session history with positions derived from append order. */
export const makeAcceptedIntegrationHistory = (input: AcceptedIntegrationHistoryInput): AcceptedIntegrationHistory => {
  const specification = input.taskSpecification ?? defaultSpecification(input.plannedAttempt)
  if (specification.fingerprint !== input.plannedAttempt.taskRevision) {
    Effect.runSync(Effect.die("accepted integration fixture specification must match the planned task revision"))
  }

  const claimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: TaskClaimAcquisition.make({
      operationId: input.activeClaim.operationId,
      owner: input.activeClaim.owner,
      taskId: input.activeClaim.taskId,
      token: input.activeClaim.token
    }),
    predecessorOperationIds: []
  })
  const graphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make(`${input.activeClaim.operationId}:graph`),
    input.trackerTarget,
    [claimOperation.acquisition.operationId],
    [input.plannedAttempt.taskId]
  )
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make(`${input.activeClaim.operationId}:specification`),
    input.trackerTarget,
    input.plannedAttempt.taskId,
    [graphOperation.operationId]
  )
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make(`${input.activeClaim.operationId}:plan`),
    plannedAttempt: input.plannedAttempt,
    predecessorOperationIds: [specificationOperation.operationId]
  })
  const worktreeOperation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make(`${input.activeClaim.operationId}:worktree`),
    plannedAttempt: input.plannedAttempt,
    predecessorOperationIds: [planOperation.operationId]
  })
  const targetLineageOperation = makeTargetLineageObservationOperation({
    integrationTarget: input.integrationTarget,
    operationId: OperationId.make(`${input.activeClaim.operationId}:target-lineage`),
    plannedAttempt: input.plannedAttempt,
    predecessorOperationIds: [worktreeOperation.operationId]
  })
  const projected = projectTrackerSnapshot({
    revision: TrackerRevision.make(`${input.runId}:accepted-integration-graph`),
    tasks: [
      {
        id: input.plannedAttempt.taskId,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
    ]
  })
  const graphSnapshot = Option.getOrThrow(
    projected._tag === "Valid" ? Option.some(projected.snapshot) : Option.none()
  )
  const worktreeProof = PlannedWorktreeReady.make({
    baseSha: input.plannedAttempt.baseSha,
    branch: input.plannedAttempt.branch,
    headSha: input.plannedAttempt.baseSha,
    worktree: input.plannedAttempt.worktree
  })
  const executorReport = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
    correlation: { attemptId: input.plannedAttempt.attemptId, runId: input.runId },
    result: { _tag: "Accepted", acceptedResult: input.acceptedResult }
  })
  const policy =
    input.initialControlPolicy ??
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  let records: ReadonlyArray<JournalRecord> = [makeWorkflowRunBeganRecord(input.runId, input.trackerTarget, policy)]
  const append = (event: JournalRecord["event"]): JournalRecord => {
    const next = appendRecord(input.runId, records, event)
    records = next.records
    return next.appended
  }

  append(TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion }))
  append(TaskClaimAcquiredEvent.make({ claim: input.activeClaim, version: workflowJournalEventVersion }))
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
    TaskWorktreeReconciliationIntendedEvent.make({
      operation: worktreeOperation,
      version: workflowJournalEventVersion
    })
  )
  append(
    TaskWorktreeReadyEvent.make({
      operationId: worktreeOperation.operationId,
      proof: worktreeProof,
      version: workflowJournalEventVersion
    })
  )
  const beginOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  const executingReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
    correlation: { attemptId: input.plannedAttempt.attemptId, runId: input.runId }
  })
  const stateOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
  append(
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt: input.plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  append(
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Begin",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: beginOrdinal,
      plannedAttempt: input.plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  append(
    PlannedAttemptExecutorCommandResponseObservedEvent.make({
      commandOrdinal: beginOrdinal,
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt: input.plannedAttempt,
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
  append(
    PlannedAttemptExecutorStateObservedEvent.make({
      observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: executorReport }),
      occurrenceClassification: "NonActionOccurrence",
      ordinal: stateOrdinal,
      plannedAttempt: input.plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  append(
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(acceptedExecutorReportOrdinalValue),
      report: executorReport,
      version: workflowJournalEventVersion
    })
  )
  const queued = append(
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult: input.acceptedResult,
      integrationTarget: input.integrationTarget,
      plannedAttempt: input.plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const started = append(
    IntegrationStartedEvent.make({
      acceptedResult: input.acceptedResult,
      integrationTarget: input.integrationTarget,
      plannedAttempt: input.plannedAttempt,
      responsibilityBeganAt: queued.position,
      version: workflowJournalEventVersion
    })
  )
  append(GitReadIntentRecordedEvent.make({
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    operation: targetLineageOperation,
    version: workflowJournalEventVersion
  }))
  const targetLineage = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: input.plannedAttempt.baseSha,
    targetHeadSha: input.targetHeadSha
  })
  const targetLineageRecord = append(
    TargetLineageObservedEvent.make({
      observation: targetLineage,
      occurrenceClassification: "NonActionOccurrence",
      operationId: targetLineageOperation.operationId,
      plannedAttempt: input.plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  requireValidHistory(input.runId, records)
  return {
    acceptedResult: input.acceptedResult,
    activeClaim: input.activeClaim,
    graphOperation,
    integrationTarget: input.integrationTarget,
    planOperation,
    plannedAttempt: input.plannedAttempt,
    records,
    responsibility: StartedIntegrationResponsibility.make({
      acceptedResult: input.acceptedResult,
      integrationTarget: input.integrationTarget,
      plannedAttempt: input.plannedAttempt,
      queuedAt: queued.position,
      startedAt: started.position
    }),
    runId: input.runId,
    specification,
    specificationOperation,
    targetLineage,
    targetLineageObservedAt: targetLineageRecord.position,
    targetLineageOperation,
    trackerTarget: input.trackerTarget,
    worktreeOperation
  }
}
