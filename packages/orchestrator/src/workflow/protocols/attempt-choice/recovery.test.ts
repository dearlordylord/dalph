import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect } from "effect"
import { expect } from "vitest"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { makeTaskWorkSpecification } from "../../../authorities/task-tracker/task-work-specification.js"
import { TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { makeJournaledFreshRunRecoveryProjection } from "../../../coordination/run/recovery-activation.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { taskTrackerGraphFactsObserved } from "../../../../test/task-tracker-facts.js"
import { legacyMemoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation
} from "../../registry/operation.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"
import {
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"
import { AttemptChoiceControl, attemptChoiceControlLayer } from "./control.js"
import { AttemptChoiceRequestId } from "./events.js"

const runId = RunId.make("attempt-choice-recovery-run")
const taskId = TaskId.make("attempt-choice-recovery-task")
const target = FixtureTarget.make("attempt-choice-recovery-target")
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/attempt-choice-recovery.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const plannedRevision = TaskRevision.make("attempt-choice-recovery-F1")
const observedSpecification = makeTaskWorkSpecification({ body: "Changed body F2", taskId, title: "Changed title F2" })
const observedRevision = observedSpecification.fingerprint
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-choice-recovery-P"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-choice-recovery-P"),
  executor: TaskExecutorLocator.make("executor:attempt-choice-recovery"),
  runId,
  taskId,
  taskRevision: plannedRevision,
  worktree: WorktreeLocator.make("/worktrees/attempt-choice-recovery-P")
})
const claimOperation = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: OperationId.make("attempt-choice-recovery-claim"),
    owner: ClaimOwner.make("dalph"),
    taskId,
    token: ClaimToken.make("attempt-choice-recovery-token")
  },
  predecessorOperationIds: []
})
const exactClaim = ActiveTaskClaim.make(claimOperation.acquisition)
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("attempt-choice-recovery-plan"),
  plannedAttempt,
  predecessorOperationIds: [claimOperation.acquisition.operationId]
})

const appendChangedSafelySuspendedAttempt = Effect.fn("AttemptChoiceRecoveryTest.appendChangedSafelySuspendedAttempt")(
  function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* journal.append(
      runId,
      intentRecordKey(claimOperation.acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(claimOperation.acquisition.operationId),
      TaskClaimAcquiredEvent.make({ claim: exactClaim, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: reportOrdinal,
        report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    )
    const changedRead = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("attempt-choice-recovery-observe-F2"),
      target,
      taskId
    )
    yield* journal.append(runId, intentRecordKey(changedRead.operationId), taskTrackerReadIntent(changedRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(changedRead.operationId),
      taskTrackerFactsObservedEvent(
        changedRead.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(changedRead, observedSpecification)
      )
    )
    yield* (yield* AttemptChoiceControl).apply({
      choice: "ContinueExistingAttempt",
      requestId: AttemptChoiceRequestId.make({ nonce: "attempt-choice-recovery-continue", runId }),
      subject: { observedTaskRevision: observedRevision, plannedAttempt }
    })
  }
)

it.effect("never claims the executor incorporated changed instructions", () =>
  Effect.gen(function* () {
    yield* appendChangedSafelySuspendedAttempt()
    const journal = yield* JournalStore
    const recovery = yield* makeJournaledFreshRunRecoveryProjection(runId, integrationTarget)

    const first = (yield* recovery.readDeliveryProjection).frontier
    const graph = first.transitions.find(({ _tag }) => _tag === "ObservePlannedAttemptContinuationGraph")
    expect(graph).toMatchObject({ _tag: "ObservePlannedAttemptContinuationGraph", plannedAttempt })
    expect(first.transitions.some(({ _tag }) => _tag === "ContinuePlannedAttemptExecutorWork")).toBe(false)
    if (graph?._tag !== "ObservePlannedAttemptContinuationGraph") return yield* Effect.die("missing graph read")
    yield* journal.append(runId, intentRecordKey(graph.operation.operationId), taskTrackerReadIntent(graph.operation))
    yield* journal.append(
      runId,
      outcomeRecordKey(graph.operation.operationId),
      taskTrackerGraphFactsObserved(graph.operation, {
        revision: TrackerRevision.make("attempt-choice-recovery-graph-F2"),
        taskIds: [taskId]
      })
    )

    const specification = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "ObservePlannedAttemptContinuationSpecification"
    )
    if (specification?._tag !== "ObservePlannedAttemptContinuationSpecification") {
      return yield* Effect.die("missing specification read")
    }
    yield* journal.append(
      runId,
      intentRecordKey(specification.operation.operationId),
      taskTrackerReadIntent(specification.operation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(specification.operation.operationId),
      taskTrackerFactsObservedEvent(
        specification.operation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specification.operation, observedSpecification)
      )
    )

    const claim = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "ObservePlannedAttemptContinuationClaim"
    )
    if (claim?._tag !== "ObservePlannedAttemptContinuationClaim") return yield* Effect.die("missing claim read")
    yield* journal.append(runId, intentRecordKey(claim.operation.operationId), taskTrackerReadIntent(claim.operation))
    yield* journal.append(
      runId,
      outcomeRecordKey(claim.operation.operationId),
      taskTrackerFactsObservedEvent(
        claim.operation.operationId,
        makeFocusedTaskClaimFactsObserved(claim.operation, exactClaim)
      )
    )

    const worktree = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "ObservePlannedAttemptContinuationWorktree"
    )
    if (worktree?._tag !== "ObservePlannedAttemptContinuationWorktree") {
      return yield* Effect.die("missing worktree read")
    }
    yield* journal.append(
      runId,
      intentRecordKey(worktree.operation.operationId),
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: worktree.operation,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(worktree.operation.operationId),
      PlannedAttemptWorktreeObservedEvent.make({
        observation: PlannedWorktreeReady.make({
          baseSha: plannedAttempt.baseSha,
          branch: plannedAttempt.branch,
          headSha: plannedAttempt.baseSha,
          worktree: plannedAttempt.worktree
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: worktree.operation.operationId,
        version: workflowJournalEventVersion
      })
    )

    const targetLineage = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
    )
    if (targetLineage?._tag !== "ObservePlannedAttemptContinuationTargetLineage") {
      return yield* Effect.die("missing target-lineage read")
    }
    yield* journal.append(
      runId,
      intentRecordKey(targetLineage.operation.operationId),
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: targetLineage.operation,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(targetLineage.operation.operationId),
      TargetLineageObservedEvent.make({
        observation: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: plannedAttempt.baseSha,
          targetHeadSha: GitCommitSha.make("2".repeat(40))
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: targetLineage.operation.operationId,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )

    expect((yield* recovery.readDeliveryProjection).frontier.transitions).toContainEqual({
      _tag: "ObservePlannedAttemptContinuationExecutor",
      plannedAttempt
    })
    const executorObservationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
    const executorObservation = yield* journal.append(
      runId,
      plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, executorObservationOrdinal),
      PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
          report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
            correlation: { attemptId: plannedAttempt.attemptId, runId }
          })
        }),
        occurrenceClassification: "NonActionOccurrence",
        ordinal: executorObservationOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )

    expect((yield* recovery.readDeliveryProjection).frontier.transitions).toEqual(
      expect.arrayContaining([
        {
          _tag: "ContinuePlannedAttemptExecutorWork",
          acceptedProgress: { _tag: "ExecutorProjectionAccepted", observedAt: executorObservation.position },
          plannedAttempt
        }
      ])
    )
    expect(plannedAttempt.taskRevision).toBe(plannedRevision)
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("requires a new choice when instructions change again before continuation", () =>
  Effect.gen(function* () {
    yield* appendChangedSafelySuspendedAttempt()
    const journal = yield* JournalStore
    const recovery = yield* makeJournaledFreshRunRecoveryProjection(runId)
    const graph = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "ObservePlannedAttemptContinuationGraph"
    )
    if (graph?._tag !== "ObservePlannedAttemptContinuationGraph") return yield* Effect.die("missing graph read")
    yield* journal.append(runId, intentRecordKey(graph.operation.operationId), taskTrackerReadIntent(graph.operation))
    yield* journal.append(
      runId,
      outcomeRecordKey(graph.operation.operationId),
      taskTrackerGraphFactsObserved(graph.operation, {
        revision: TrackerRevision.make("attempt-choice-recovery-graph-F3"),
        taskIds: [taskId]
      })
    )
    const specification = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "ObservePlannedAttemptContinuationSpecification"
    )
    if (specification?._tag !== "ObservePlannedAttemptContinuationSpecification") {
      return yield* Effect.die("missing specification read")
    }
    const third = makeTaskWorkSpecification({ body: "Third body F3", taskId, title: "Third title F3" })
    const thirdRevision = third.fingerprint
    yield* journal.append(
      runId,
      intentRecordKey(specification.operation.operationId),
      taskTrackerReadIntent(specification.operation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(specification.operation.operationId),
      taskTrackerFactsObservedEvent(
        specification.operation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specification.operation, third)
      )
    )

    expect((yield* recovery.readDeliveryProjection).frontier).toMatchObject({
      explanations: [
        expect.objectContaining({
          _tag: "PlannedAttemptTaskSpecificationChangeConstraint",
          observedFingerprint: thirdRevision,
          plannedFingerprint: plannedRevision
        })
      ],
      transitions: []
    })
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)
