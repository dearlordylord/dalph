import { Effect, Option } from "effect"
import {
  type PlannedTaskAttempt,
  type TaskWorkSpecification,
  IntegrationTarget,
  IntegrationTargetRef,
  GitRepositoryLocator
} from "@dalph/contracts"
import {
  type InRunJournalService,
  type JournalAppendError,
  type JournalReadError,
  type JournalRecord
} from "../../../orchestrator/src/workflow-journal/store.js"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import { ActiveTaskClaim } from "../../../orchestrator/src/authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../orchestrator/src/authorities/task-tracker/claim.js"
import { PlannedWorktreeReady } from "../../../orchestrator/src/authorities/git/worktree.js"
import { TargetLineageObservation } from "../../../orchestrator/src/authorities/git/target-lineage.js"
import { projectTrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import { describeJournalEvent } from "../../../orchestrator/src/workflow/registry/event-descriptor.js"
import {
  makeTrackerGraphObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTargetLineageObservationOperation
} from "../../../orchestrator/src/workflow/registry/operation.js"
import {
  taskTrackerReadIntent,
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent
} from "../../../orchestrator/src/workflow/registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../../orchestrator/src/workflow/task-tracker-facts/observation.js"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import { deriveJournalResponsibilityFacts } from "../../../orchestrator/src/coordination/run/recovery-activation.js"
import type { SafeContinuationRevalidationEligibility } from "../../../orchestrator/src/coordination/frontier/safe-continuation-revalidation-eligibility.js"

interface ExecutorResumeWitnesses {
  readonly activeTaskContinuationRead: {
    readonly graphObservationOperationId: OperationId
    readonly taskClaimObservationOperationId: OperationId
    readonly taskWorkSpecificationObservationOperationId: OperationId
  }
  readonly worktreeObservationOperationId: OperationId
  readonly targetLineageObservationOperationId: OperationId
}

interface ExecutorResumeModelFixture {
  readonly graph: (
    lifecycle: "Open" | "TerminalWithoutSuccess"
  ) => Effect.Effect<OperationId, JournalAppendError | JournalReadError>
  readonly readWitnesses: () => Effect.Effect<ExecutorResumeWitnesses, JournalAppendError | JournalReadError>
  readonly eligibility: () => Effect.Effect<SafeContinuationRevalidationEligibility, JournalReadError>
}

/** Actual tracker/Git observation history behind the executor model's abstract five-witness action. */
export const makeExecutorResumeModelFixture = (
  journal: InRunJournalService,
  plannedAttempt: PlannedTaskAttempt,
  specification: TaskWorkSpecification
): ExecutorResumeModelFixture => {
  const target = FixtureTarget.make("planned-attempt-executor-model")
  const planId = OperationId.make("planned-attempt-executor-model-plan")
  const integrationTarget = IntegrationTarget.make({
    repository: GitRepositoryLocator.make("/model/.git"),
    ref: IntegrationTargetRef.make("refs/heads/main")
  })
  const append = (
    event: Exclude<JournalRecord["event"], { readonly _tag: "WorkflowRunBegan" | "WorkflowRunTerminated" }>
  ) => journal.append(plannedAttempt.runId, describeJournalEvent(event).expectedKey, event)
  const graph = Effect.fn("ExecutorResumeModel.readLifecycle")(function* (
    lifecycle: "Open" | "TerminalWithoutSuccess"
  ) {
    const records = yield* journal.read(plannedAttempt.runId)
    const operation = makeTrackerGraphObservationOperation(
      { _tag: "AttemptContinuation" },
      OperationId.make(`executor-resume-graph-${records.length}`),
      target,
      [planId],
      [plannedAttempt.taskId]
    )
    const snapshot = projectTrackerSnapshot({
      revision: `executor-resume-graph-${records.length}`,
      tasks: [{ id: plannedAttempt.taskId, lifecycle: { _tag: lifecycle }, parentTaskId: null, prerequisiteIds: [] }]
    })
    if (snapshot._tag !== "Valid") return yield* Effect.die("executor model lifecycle graph is invalid")
    yield* append(taskTrackerReadIntent(operation))
    yield* append(
      taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(operation, snapshot.snapshot)
      )
    )
    return operation.operationId
  })
  const readWitnesses = Effect.fn("ExecutorResumeModel.readWitnesses")(function* () {
    const graphId = yield* graph("Open")
    const prefix = `executor-resume-${(yield* journal.read(plannedAttempt.runId)).length}`
    const specificationRead = makeTaskWorkSpecificationObservationOperation(
      OperationId.make(`${prefix}-specification`),
      target,
      plannedAttempt.taskId,
      [planId, graphId]
    )
    const claimRead = makeTaskClaimObservationOperation(
      OperationId.make(`${prefix}-claim`),
      target,
      plannedAttempt.taskId,
      [planId, graphId, specificationRead.operationId]
    )
    const worktree = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make(`${prefix}-worktree`),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const lineage = makeTargetLineageObservationOperation({
      operationId: OperationId.make(`${prefix}-lineage`),
      plannedAttempt,
      integrationTarget,
      predecessorOperationIds: []
    })
    yield* append(taskTrackerReadIntent(specificationRead))
    yield* append(
      taskTrackerFactsObservedEvent(
        specificationRead.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationRead, specification)
      )
    )
    yield* append(taskTrackerReadIntent(claimRead))
    yield* append(
      taskTrackerFactsObservedEvent(
        claimRead.operationId,
        makeFocusedTaskClaimFactsObserved(
          claimRead,
          ActiveTaskClaim.make({
            operationId: OperationId.make("planned-attempt-executor-model-claim"),
            owner: ClaimOwner.make("dalph"),
            taskId: plannedAttempt.taskId,
            token: ClaimToken.make("planned-attempt-executor-model-claim-token")
          })
        )
      )
    )
    yield* append(
      GitReadIntentRecordedEvent.make({
        operation: worktree,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    yield* append(
      PlannedAttemptWorktreeObservedEvent.make({
        operationId: worktree.operationId,
        observation: PlannedWorktreeReady.make({
          baseSha: plannedAttempt.baseSha,
          headSha: plannedAttempt.baseSha,
          branch: plannedAttempt.branch,
          worktree: plannedAttempt.worktree
        }),
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      })
    )
    yield* append(
      GitReadIntentRecordedEvent.make({
        operation: lineage,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    yield* append(
      TargetLineageObservedEvent.make({
        operationId: lineage.operationId,
        plannedAttempt,
        observation: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: plannedAttempt.baseSha,
          targetHeadSha: plannedAttempt.baseSha
        }),
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      })
    )
    return {
      activeTaskContinuationRead: {
        graphObservationOperationId: graphId,
        taskClaimObservationOperationId: claimRead.operationId,
        taskWorkSpecificationObservationOperationId: specificationRead.operationId
      },
      worktreeObservationOperationId: worktree.operationId,
      targetLineageObservationOperationId: lineage.operationId
    }
  })
  const eligibility = Effect.fn("ExecutorResumeModel.eligibility")(function* () {
    const records = yield* journal.read(plannedAttempt.runId)
    const reduction = reduceWorkflowJournalHistory(plannedAttempt.runId, records)
    if (reduction._tag === "InvalidWorkflowJournalHistory")
      return yield* Effect.die("executor model retry history is invalid")
    const facts = deriveJournalResponsibilityFacts(reduction.runState, Option.none(), Option.some(integrationTarget))
    const token = facts.find((fact) => fact._tag === "PlannedAttemptExecutorFreshFacts")
    if (
      token?._tag !== "PlannedAttemptExecutorFreshFacts" ||
      token.safeContinuationRevalidationEligibility === undefined
    )
      return yield* Effect.die("executor model exact retry history did not establish eligibility")
    return token.safeContinuationRevalidationEligibility
  })
  return { graph, readWitnesses, eligibility }
}
