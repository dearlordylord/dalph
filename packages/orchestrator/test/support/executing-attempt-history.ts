import { makeTaskWorkSpecification, PlannedAttemptExecutorReport } from "@dalph/contracts"
import type { PlannedTaskAttempt, RunId, TaskWorkSpecification } from "@dalph/contracts"
import { Effect, Option } from "effect"
import { PlannedWorktreeReady } from "../../src/authorities/git/worktree.js"
import { projectTrackerSnapshot } from "../../src/authorities/task-tracker/graph.js"
import { TaskClaimAcquisition, type ActiveTaskClaim } from "../../src/authorities/task-tracker/claim-mutation.js"
import { TaskLifecycle, TrackerRevision } from "../../src/authorities/task-tracker/task.js"
import type { TrackerTarget } from "../../src/authorities/task-tracker/target.js"
import { InitialControlPolicy } from "../../src/control/policy.js"
import { TaskWorkCapacity } from "../../src/coordination/admission/capacity.js"
import { reduceWorkflowJournalHistory } from "../../src/coordination/reconstruction/history.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../src/workflow/task-tracker-facts/observation.js"
import { OperationId } from "../../src/workflow/identity.js"
import { workflowJournalEventVersion } from "../../src/workflow/kernel/event.js"
import { describeJournalEvent } from "../../src/workflow/registry/event-descriptor.js"
import {
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
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../src/workflow/protocols/planned-attempt-executor-work/events.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "../../src/workflow/registry/operation.js"
import { JournalPosition } from "../../src/workflow-journal/identity.js"
import { makeWorkflowRunBeganRecord } from "../../src/workflow-journal/run-lifecycle.js"
import type { JournalRecord } from "../../src/workflow-journal/store.js"

export interface ExecutingAttemptHistoryInput {
  readonly activeClaim: ActiveTaskClaim
  readonly initialControlPolicy?: InitialControlPolicy
  readonly plannedAttempt: PlannedTaskAttempt
  readonly runId: RunId
  readonly taskSpecification?: TaskWorkSpecification
  readonly trackerTarget: TrackerTarget
  readonly priorRecords?: ReadonlyArray<JournalRecord>
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

/** Constructs actual claim, Git, and executor chronology; an optional prior Run is continued, never reseeded. */
export const makeExecutingAttemptHistory = (input: ExecutingAttemptHistoryInput) => {
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
  const graphSnapshot = Option.getOrThrow(projected._tag === "Valid" ? Option.some(projected.snapshot) : Option.none())
  const worktreeProof = PlannedWorktreeReady.make({
    baseSha: input.plannedAttempt.baseSha,
    branch: input.plannedAttempt.branch,
    headSha: input.plannedAttempt.baseSha,
    worktree: input.plannedAttempt.worktree
  })
  const policy =
    input.initialControlPolicy ?? InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  let records: ReadonlyArray<JournalRecord> = input.priorRecords ?? [
    makeWorkflowRunBeganRecord(input.runId, input.trackerTarget, policy)
  ]
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
    TaskWorktreeReconciliationIntendedEvent.make({ operation: worktreeOperation, version: workflowJournalEventVersion })
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
  requireValidHistory(input.runId, records)
  return {
    records,
    plannedAttempt: input.plannedAttempt,
    activeClaim: input.activeClaim,
    specification,
    graphOperation,
    specificationOperation,
    planOperation,
    worktreeOperation,
    runId: input.runId,
    trackerTarget: input.trackerTarget
  }
}
