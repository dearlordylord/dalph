import { PlannedAttemptExecutorReport } from "@dalph/contracts"
import type {
  AcceptedResult,
  GitCommitSha,
  IntegrationTarget,
  PlannedTaskAttempt,
  RunId,
  TaskWorkSpecification
} from "@dalph/contracts"
import { Effect } from "effect"
import type { ActiveTaskClaim } from "../../src/authorities/task-tracker/claim-mutation.js"
import type { TrackerTarget } from "../../src/authorities/task-tracker/target.js"
import type { InitialControlPolicy } from "../../src/control/policy.js"
import { reduceWorkflowJournalHistory } from "../../src/coordination/reconstruction/history.js"
import { OperationId } from "../../src/workflow/identity.js"
import { workflowJournalEventVersion } from "../../src/workflow/kernel/event.js"
import { describeJournalEvent } from "../../src/workflow/registry/event-descriptor.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../src/workflow/registry/event.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorWorkReportedEvent
} from "../../src/workflow/protocols/planned-attempt-executor-work/events.js"
import { makeTargetLineageObservationOperation } from "../../src/workflow/registry/operation.js"
import type {
  makeTrackerGraphObservationOperation,
  makeTaskAttemptPlanOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation
} from "../../src/workflow/registry/operation.js"
import { JournalPosition } from "../../src/workflow-journal/identity.js"
import type { JournalRecord } from "../../src/workflow-journal/store.js"
import { TargetLineageObservation } from "../../src/authorities/git/target-lineage.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../../src/workflow/protocols/integration-admission/events.js"
import { StartedIntegrationResponsibility } from "../../src/workflow/protocols/integration-admission/responsibility.js"
import { makeExecutingAttemptHistory } from "./executing-attempt-history.js"

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
  const executing = makeExecutingAttemptHistory(input)
  const { graphOperation, planOperation, specification, specificationOperation, worktreeOperation } = executing
  let records = executing.records
  const append = (event: JournalRecord["event"]): JournalRecord => {
    const next = appendRecord(input.runId, records, event)
    records = next.records
    return next.appended
  }
  const targetLineageOperation = makeTargetLineageObservationOperation({
    integrationTarget: input.integrationTarget,
    operationId: OperationId.make(`${input.activeClaim.operationId}:target-lineage`),
    plannedAttempt: input.plannedAttempt,
    predecessorOperationIds: [worktreeOperation.operationId]
  })
  const executorReport = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
    correlation: { attemptId: input.plannedAttempt.attemptId, runId: input.runId },
    result: { _tag: "Accepted", acceptedResult: input.acceptedResult }
  })
  const stateOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
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
  append(
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: targetLineageOperation,
      version: workflowJournalEventVersion
    })
  )
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
