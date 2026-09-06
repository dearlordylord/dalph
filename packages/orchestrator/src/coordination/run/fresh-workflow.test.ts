import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
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
import { Effect, Layer, Option, Result } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import {
  ActiveTaskClaim,
  TaskClaimAcquisition,
  type TaskClaimAcquisition as TaskClaimAcquisitionType,
  UnclaimedTask
} from "../../authorities/task-tracker/claim-mutation.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import {
  makeFreshTaskAdmissionBasis,
  projectFreshTaskAdmission,
  TaskAdmissionOccupancy
} from "../admission/fresh-task-admission.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import type { CurrentDeliveryFrame } from "./current-delivery-frame.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import {
  TaskClaimAcquisitionAuthority,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskAttemptPlanOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import { attemptPlanRecordKey, intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { OperationId } from "../../workflow/identity.js"
import { deriveFreshWorkflowDecisions, responsibilityStillOwnsTask } from "./fresh-workflow.js"
import { JournalStore } from "../../workflow-journal/store.js"
import { memoryJournalTestLayer } from "../../workflow-journal/adapters/memory-store.js"
import { appendReplacementProvenance } from "../../workflow/protocols/disposition-cleanup/provenance-fixtures.js"
import {
  attempt as replacementPriorAttempt,
  runId as replacementRunId,
  successor as replacementSuccessorAttempt
} from "../../workflow/protocols/disposition-cleanup/fixtures.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { reconstructedTaskGraphFor } from "../reconstruction/graph-knowledge.js"
import { freshContinuationDecisionsOf } from "../delivery/delivery-action-proposal.js"
import { deliveryProposalsOf } from "../delivery/delivery-proposal-derivation.js"
import { FreshWorkflowStep } from "../delivery/fresh-workflow-step.js"
import { makeDeliveryRuntimeAdmissionController } from "../delivery/delivery-runtime-admission.js"
import {
  authorizeReplacementContinuationStep,
  replacementContinuationAuthorityFrom
} from "../delivery/replacement-continuation-authority.js"
import { rejectedFreshTaskClaimDisposition } from "./rejected-fresh-task-claim.js"
import { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"

const runId = RunId.make("fresh-workflow-no-successor-run")
const taskId = TaskId.make("fresh-workflow-no-successor-task")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("fresh-workflow-no-successor-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/fresh-workflow-no-successor"),
  executor: TaskExecutorLocator.make("executor:fresh-workflow-no-successor"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("fresh-workflow-no-successor-revision"),
  worktree: WorktreeLocator.make("/worktrees/fresh-workflow-no-successor")
})

it.effect("continues a valid restarted replacement successor without resurrecting its original fresh commitment", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("fresh-workflow-replacement-successor")
    const journal = yield* JournalStore
    yield* journal.beginRun(
      replacementRunId,
      target,
      RunControlPolicy.make({ revision: initialRunPolicyRevision, taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const originalSpecification = makeTaskWorkSpecification({
      body: "original replacement implementation",
      taskId: replacementPriorAttempt.taskId,
      title: "original replacement implementation"
    })
    const priorAttempt = PlannedTaskAttempt.make({
      ...replacementPriorAttempt,
      taskRevision: originalSpecification.fingerprint
    })
    yield* appendReplacementProvenance(priorAttempt, replacementSuccessorAttempt, "StartupValid")
    const fixtureRecords = yield* journal.read(replacementRunId)
    const originalPlanIndex = fixtureRecords.findIndex(({ event }) => event._tag === "TaskAttemptPlanned")
    const originalPlanRecord = fixtureRecords[originalPlanIndex]
    if (originalPlanRecord?.event._tag !== "TaskAttemptPlanned") {
      return yield* Effect.die("replacement fixture did not record its original attempt plan")
    }
    const originalGraphProjection = projectTrackerSnapshot({
      revision: "fresh-workflow-replacement-original-graph",
      tasks: [
        { id: priorAttempt.taskId, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }
      ]
    })
    if (originalGraphProjection._tag === "Invalid") return yield* Effect.die(originalGraphProjection.issues)
    const originalGraph = originalGraphProjection.snapshot
    const originalGraphOperation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make("fresh-workflow-replacement-original-graph"),
      target,
      [originalPlanRecord.event.operation.predecessorOperationIds[0] ?? OperationId.make("missing-claim")],
      [priorAttempt.taskId]
    )
    const originalSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("fresh-workflow-replacement-original-specification"),
      target,
      priorAttempt.taskId,
      [originalGraphOperation.operationId]
    )
    const correctedOriginalPlan = {
      ...originalPlanRecord,
      event: TaskAttemptPlannedEvent.make({
        operation: {
          ...originalPlanRecord.event.operation,
          predecessorOperationIds: [originalSpecificationOperation.operationId]
        },
        version: workflowJournalEventVersion
      })
    }
    const originalWorktreeOperation = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make("fresh-workflow-replacement-original-worktree"),
      plannedAttempt: priorAttempt,
      predecessorOperationIds: [originalPlanRecord.event.operation.operationId]
    })
    const inserted = [
      {
        event: taskTrackerReadIntent(originalGraphOperation),
        key: intentRecordKey(originalGraphOperation.operationId)
      },
      {
        event: taskTrackerFactsObservedEvent(
          originalGraphOperation.operationId,
          makeCompleteTaskTrackerFactsObserved(originalGraphOperation, originalGraph)
        ),
        key: outcomeRecordKey(originalGraphOperation.operationId)
      },
      {
        event: taskTrackerReadIntent(originalSpecificationOperation),
        key: intentRecordKey(originalSpecificationOperation.operationId)
      },
      {
        event: taskTrackerFactsObservedEvent(
          originalSpecificationOperation.operationId,
          makeFocusedTaskWorkSpecificationFactsObserved(originalSpecificationOperation, originalSpecification)
        ),
        key: outcomeRecordKey(originalSpecificationOperation.operationId)
      },
      correctedOriginalPlan,
      {
        event: TaskWorktreeReconciliationIntendedEvent.make({
          operation: originalWorktreeOperation,
          version: workflowJournalEventVersion
        }),
        key: intentRecordKey(originalWorktreeOperation.operationId)
      },
      {
        event: TaskWorktreeReadyEvent.make({
          operationId: originalWorktreeOperation.operationId,
          proof: PlannedWorktreeReady.make({
            baseSha: priorAttempt.baseSha,
            branch: priorAttempt.branch,
            headSha: priorAttempt.baseSha,
            worktree: priorAttempt.worktree
          }),
          version: workflowJournalEventVersion
        }),
        key: outcomeRecordKey(originalWorktreeOperation.operationId)
      }
    ]
    const records = [
      ...fixtureRecords.slice(0, originalPlanIndex),
      ...inserted,
      ...fixtureRecords.slice(originalPlanIndex + 1)
    ].map((record, index) => ({ ...record, position: JournalPosition.make(index + 1), runId: replacementRunId }))
    const reduction = reduceWorkflowJournalHistory(replacementRunId, records)
    if (reduction._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(reduction)
    if (reduction.runState.appliedThrough === null) return yield* Effect.die("replacement history was empty")
    const currentGraph = Option.getOrThrow(reconstructedTaskGraphFor(reduction.runState.graphKnowledge, target))
    const decisions = deriveFreshWorkflowDecisions(
      {
        acceptedAt: reduction.runState.appliedThrough,
        currentGraph,
        currentGraphOperationId: Option.getOrThrow(
          Option.fromUndefinedOr(
            reduction.runState.graphKnowledge.taskTrackerFacts.findLast(
              (fact) => fact._tag === "CompleteTaskTrackerFacts"
            )?.operationId
          )
        ),
        pause: reduction.runState.pause,
        responsibility: reduction.runState.responsibility,
        runControlPolicy: Option.getOrThrow(reduction.runState.controlPolicy),
        runId: replacementRunId,
        workflowHistory: reduction.runState.workflowHistory
      },
      new Set(),
      target
    )

    expect(decisions).toContainEqual(
      expect.objectContaining({
        step: expect.objectContaining({ _tag: "ReconcileTaskWorktree", plannedAttempt: replacementSuccessorAttempt })
      })
    )
    const continuations = freshContinuationDecisionsOf(decisions, [])
    expect(Result.isSuccess(continuations)).toBe(true)
    if (Result.isFailure(continuations)) return yield* Effect.die(continuations.failure)
    expect(continuations.success).toHaveLength(1)
    const continuation = continuations.success[0]
    if (continuation === undefined) return yield* Effect.die("replacement continuation was absent")
    if (continuation.step._tag !== "ReconcileTaskWorktree") {
      return yield* Effect.die(`expected replacement worktree reconciliation, received ${continuation.step._tag}`)
    }
    expect(
      Result.isFailure(freshContinuationDecisionsOf([{ ...continuation, step: { ...continuation.step } }], []))
    ).toBe(true)

    const successorWorktreeOperation = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make("fresh-workflow-replacement-successor-worktree"),
      plannedAttempt: replacementSuccessorAttempt,
      predecessorOperationIds: [continuation.step.predecessorOperationId]
    })
    const successorRecords: ReadonlyArray<JournalRecord> = [
      ...records,
      {
        event: TaskWorktreeReconciliationIntendedEvent.make({
          operation: successorWorktreeOperation,
          version: workflowJournalEventVersion
        }),
        key: intentRecordKey(successorWorktreeOperation.operationId),
        position: JournalPosition.make(records.length + 1),
        runId: replacementRunId
      },
      {
        event: TaskWorktreeReadyEvent.make({
          operationId: successorWorktreeOperation.operationId,
          proof: PlannedWorktreeReady.make({
            baseSha: replacementSuccessorAttempt.baseSha,
            branch: replacementSuccessorAttempt.branch,
            headSha: replacementSuccessorAttempt.baseSha,
            worktree: replacementSuccessorAttempt.worktree
          }),
          version: workflowJournalEventVersion
        }),
        key: outcomeRecordKey(successorWorktreeOperation.operationId),
        position: JournalPosition.make(records.length + 2),
        runId: replacementRunId
      }
    ]
    const incompleteRestartChronology = successorRecords.filter(
      ({ event }) => event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan"
    )
    expect(reduceWorkflowJournalHistory(replacementRunId, incompleteRestartChronology)._tag).toBe(
      "InvalidWorkflowJournalHistory"
    )
    expect(
      replacementContinuationAuthorityFrom(
        incompleteRestartChronology,
        replacementRunId,
        replacementSuccessorAttempt,
        continuation.step.predecessorOperationId
      )
    ).toBeUndefined()
    const cachedThenCorrupted = [...successorRecords]
    expect(
      replacementContinuationAuthorityFrom(
        cachedThenCorrupted,
        replacementRunId,
        replacementSuccessorAttempt,
        continuation.step.predecessorOperationId
      )
    ).toBeDefined()
    const responsibilityIndex = cachedThenCorrupted.findIndex(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
    )
    if (responsibilityIndex < 0) return yield* Effect.die("replacement responsibility evidence was absent")
    cachedThenCorrupted.splice(responsibilityIndex, 1)
    expect(
      replacementContinuationAuthorityFrom(
        cachedThenCorrupted,
        replacementRunId,
        replacementSuccessorAttempt,
        continuation.step.predecessorOperationId
      )
    ).toBeUndefined()
    const replacementAuthority = replacementContinuationAuthorityFrom(
      successorRecords,
      replacementRunId,
      replacementSuccessorAttempt,
      continuation.step.predecessorOperationId
    )
    if (replacementAuthority === undefined) return yield* Effect.die("replacement authority was absent")
    const causalClaimMissingRecords = successorRecords.map((record): JournalRecord => {
      if (record.event._tag !== "PlannedAttemptReplaced") return record
      const event = structuredClone(record.event)
      Reflect.set(event.successorPlan, "predecessorOperationIds", [event.witness.graphObservationOperationId])
      return { ...record, event }
    })
    expect(reduceWorkflowJournalHistory(replacementRunId, causalClaimMissingRecords)._tag).toBe(
      "ValidWorkflowJournalHistory"
    )
    expect(
      replacementContinuationAuthorityFrom(
        causalClaimMissingRecords,
        replacementRunId,
        replacementSuccessorAttempt,
        continuation.step.predecessorOperationId
      )
    ).toBeUndefined()
    const specificationIntent = successorRecords.find(
      ({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadTaskWorkSpecification" &&
        event.operation.operationId === replacementAuthority.specificationObservationOperationId
    )?.event
    if (
      specificationIntent?._tag !== "TaskTrackerReadIntentRecorded" ||
      specificationIntent.operation._tag !== "ReadTaskWorkSpecification"
    ) {
      return yield* Effect.die("replacement F2 intent was absent")
    }
    const exactSpecificationOperation = specificationIntent.operation
    const unrelatedSpecification = makeTaskWorkSpecification({
      body: "unrelated replacement specification",
      taskId: replacementSuccessorAttempt.taskId,
      title: "unrelated replacement specification"
    })
    const hostileRecords = successorRecords.map((record) =>
      record.event._tag === "TaskTrackerFactsObserved" &&
      record.event.operationId === replacementAuthority.specificationObservationOperationId
        ? {
            ...record,
            event: taskTrackerFactsObservedEvent(
              exactSpecificationOperation.operationId,
              makeFocusedTaskWorkSpecificationFactsObserved(exactSpecificationOperation, unrelatedSpecification)
            )
          }
        : record
    )
    expect(
      replacementContinuationAuthorityFrom(
        hostileRecords,
        replacementRunId,
        replacementSuccessorAttempt,
        continuation.step.predecessorOperationId
      )
    ).toBeUndefined()
    const malformedSpecificationRecords = successorRecords.map((record): JournalRecord => {
      if (
        record.event._tag !== "TaskTrackerFactsObserved" ||
        record.event.operationId !== replacementAuthority.specificationObservationOperationId ||
        record.event.observation._tag !== "FocusedTaskWorkSpecificationFacts"
      ) {
        return record
      }
      const event = structuredClone(record.event)
      if (event.observation._tag !== "FocusedTaskWorkSpecificationFacts") return record
      Reflect.set(event.observation.factFamily, "body", "malformed body")
      return { ...record, event }
    })
    expect(reduceWorkflowJournalHistory(replacementRunId, malformedSpecificationRecords)._tag).toBe(
      "ValidWorkflowJournalHistory"
    )
    expect(
      replacementContinuationAuthorityFrom(
        malformedSpecificationRecords,
        replacementRunId,
        replacementSuccessorAttempt,
        continuation.step.predecessorOperationId
      )
    ).toBeUndefined()

    expect(
      authorizeReplacementContinuationStep(
        replacementAuthority,
        FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
          claimOperationId: replacementAuthority.claim.operationId,
          plannedAttempt: replacementSuccessorAttempt,
          specification: unrelatedSpecification,
          task: continuation.step.task
        })
      )
    ).toBeUndefined()
    const successorReduction = reduceWorkflowJournalHistory(replacementRunId, successorRecords)
    if (successorReduction._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(successorReduction)
    if (successorReduction.runState.appliedThrough === null) return yield* Effect.die("successor history was empty")
    const beginDecisions = deriveFreshWorkflowDecisions(
      {
        acceptedAt: successorReduction.runState.appliedThrough,
        currentGraph: Option.getOrThrow(reconstructedTaskGraphFor(successorReduction.runState.graphKnowledge, target)),
        currentGraphOperationId: Option.getOrThrow(
          Option.fromUndefinedOr(
            successorReduction.runState.graphKnowledge.taskTrackerFacts.findLast(
              (fact) => fact._tag === "CompleteTaskTrackerFacts"
            )?.operationId
          )
        ),
        pause: successorReduction.runState.pause,
        responsibility: successorReduction.runState.responsibility,
        runControlPolicy: Option.getOrThrow(successorReduction.runState.controlPolicy),
        runId: replacementRunId,
        workflowHistory: successorReduction.runState.workflowHistory
      },
      new Set(),
      target
    )
    expect(beginDecisions).toContainEqual(
      expect.objectContaining({
        step: expect.objectContaining({
          _tag: "BeginPlannedAttemptExecutorWork",
          plannedAttempt: replacementSuccessorAttempt
        })
      })
    )
    const beginContinuations = freshContinuationDecisionsOf(beginDecisions, [])
    expect(Result.isSuccess(beginContinuations)).toBe(true)
    if (Result.isFailure(beginContinuations)) return yield* Effect.die(beginContinuations.failure)
    expect(beginContinuations.success).toHaveLength(1)
    const beginProposal = deliveryProposalsOf({
      acceptedAt: successorReduction.runState.appliedThrough,
      acceptedOperationIds: new Set(),
      fresh: beginContinuations.success,
      runId: replacementRunId,
      transitions: beginDecisions.map(({ transition }) => transition)
    }).ticketDelivery[0]
    if (beginProposal === undefined) return yield* Effect.die("replacement Begin proposal was absent")

    const blockerTaskId = TaskId.make("fresh-workflow-replacement-blocker")
    const blockerAttempt = PlannedTaskAttempt.make({
      ...replacementSuccessorAttempt,
      attemptId: AttemptId.make("fresh-workflow-replacement-blocker-attempt"),
      branch: TaskBranchRef.make("refs/heads/task/fresh-workflow-replacement-blocker"),
      taskId: blockerTaskId,
      worktree: WorktreeLocator.make("/tmp/fresh-workflow-replacement-blocker")
    })
    const blockedBasis = yield* makeFreshTaskAdmissionBasis({
      acceptedAt: successorReduction.runState.appliedThrough,
      capacity: TaskWorkCapacity.make(1),
      entries: [TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: blockerAttempt })],
      runId: replacementRunId
    })
    const admission = yield* makeDeliveryRuntimeAdmissionController(
      blockedBasis,
      yield* makeIntegrationTargetResourceController(),
      (yield* makeApplicationExitLifecycle()).admission
    )
    expect(yield* admission.tryReserve(beginProposal)).toEqual({
      _tag: "Deferred",
      reason: "TaskWorkPositionUnavailable"
    })

    const successorProjection = projectFreshTaskAdmission(replacementRunId, successorRecords)
    if (successorProjection._tag !== "FreshTaskAdmissionProjection") {
      return yield* Effect.die(successorProjection)
    }
    const availableBasis = yield* makeFreshTaskAdmissionBasis({
      acceptedAt: successorProjection.acceptedAt,
      capacity: TaskWorkCapacity.make(1),
      entries: [],
      projection: successorProjection,
      runId: replacementRunId
    })
    yield* admission.synchronize(availableBasis)
    const admitted = yield* admission.tryReserve(beginProposal)
    if (admitted._tag !== "Admitted") return yield* Effect.die("replacement Begin was not admitted")
    yield* admission.bindPlannedAttemptPosition(admitted.reservation, replacementSuccessorAttempt)
    expect((yield* admission.snapshot).positions.get(replacementSuccessorAttempt.taskId)).toEqual({
      _tag: "LocallyAcceptedAttemptPosition",
      handoff: { _tag: "ExistingAttemptHandoff" },
      plannedAttempt: replacementSuccessorAttempt,
      responsibilityAcceptedAt: availableBasis.acceptedAt
    })
    yield* admission.complete(admitted.reservation)
  }).pipe(Effect.provide(memoryJournalTestLayer), Effect.provide(Layer.fresh(plannedAttemptProtocolControllerLayer)))
)

const selectionRunId = RunId.make("fresh-workflow-selection-run")
const selectionTaskId = TaskId.make("fresh-workflow-selection-task")
const selectionTarget = FixtureTarget.make("fresh-workflow-selection-target")
const selectionGraphOperation = makeTrackerGraphObservationOperation(
  { _tag: "WorkflowEstablishment" },
  OperationId.make("fresh-workflow-selection-graph"),
  selectionTarget
)

const selectionGraphSnapshot = (() => {
  const projected = projectTrackerSnapshot({
    revision: "fresh-workflow-selection-revision",
    tasks: [{ id: selectionTaskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  return Option.getOrThrow(Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined))
})()

const selectionAcquisition = (suffix: string): TaskClaimAcquisitionType =>
  TaskClaimAcquisition.make({
    operationId: OperationId.make(`fresh-workflow-selection-claim-${suffix}`),
    owner: ClaimOwner.make(`fresh-workflow-selection-owner-${suffix}`),
    taskId: selectionTaskId,
    token: ClaimToken.make(`fresh-workflow-selection-token-${suffix}`)
  })

const selectionOperation = (suffix: string) =>
  makeTaskClaimAcquisitionOperation({
    acquisition: selectionAcquisition(suffix),
    predecessorOperationIds: [selectionGraphOperation.operationId]
  })

const selectionClaimIntentRecord = (
  operation: ReturnType<typeof selectionOperation>,
  position: number,
  runId: RunId = selectionRunId,
  key = intentRecordKey(operation.acquisition.operationId)
): JournalRecord => ({
  event: TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion }),
  key,
  position: JournalPosition.make(position),
  runId
})

const selectionClaimAcquiredRecord = (
  claim: ActiveTaskClaim,
  position: number,
  runId: RunId = selectionRunId,
  key = outcomeRecordKey(claim.operationId)
): JournalRecord => ({
  event: TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion }),
  key,
  position: JournalPosition.make(position),
  runId
})

const selectionClaimRejectedRecord = (
  operation: ReturnType<typeof selectionOperation>,
  observed: ActiveTaskClaim,
  position: number
): JournalRecord => ({
  event: TaskClaimAcquisitionRejectedEvent.make({
    observed,
    operationId: operation.acquisition.operationId,
    reason: "ForeignClaim",
    version: workflowJournalEventVersion
  }),
  key: outcomeRecordKey(operation.acquisition.operationId),
  position: JournalPosition.make(position),
  runId: selectionRunId
})

const selectionGraphRecords = (
  operation: ReturnType<typeof makeTrackerGraphObservationOperation>,
  intentPosition: number
): ReadonlyArray<JournalRecord> => [
  {
    event: taskTrackerReadIntent(operation),
    key: intentRecordKey(operation.operationId),
    position: JournalPosition.make(intentPosition),
    runId: selectionRunId
  },
  {
    event: taskTrackerFactsObservedEvent(
      operation.operationId,
      makeCompleteTaskTrackerFactsObserved(operation, selectionGraphSnapshot)
    ),
    key: outcomeRecordKey(operation.operationId),
    position: JournalPosition.make(intentPosition + 1),
    runId: selectionRunId
  }
]

const selectionClaimReadRecords = (
  operation: ReturnType<typeof makeTaskClaimObservationOperation>,
  observation: ActiveTaskClaim | UnclaimedTask,
  intentPosition: number
): ReadonlyArray<JournalRecord> => [
  {
    event: taskTrackerReadIntent(operation),
    key: intentRecordKey(operation.operationId),
    position: JournalPosition.make(intentPosition),
    runId: selectionRunId
  },
  {
    event: taskTrackerFactsObservedEvent(
      operation.operationId,
      makeFocusedTaskClaimFactsObserved(operation, observation)
    ),
    key: outcomeRecordKey(operation.operationId),
    position: JournalPosition.make(intentPosition + 1),
    runId: selectionRunId
  }
]

const selectionFrameWith = (claimRecords: ReadonlyArray<JournalRecord>): CurrentDeliveryFrame => {
  const graphRecords: ReadonlyArray<JournalRecord> = [
    {
      event: taskTrackerReadIntent(selectionGraphOperation),
      key: intentRecordKey(selectionGraphOperation.operationId),
      position: JournalPosition.make(1),
      runId: selectionRunId
    },
    {
      event: taskTrackerFactsObservedEvent(
        selectionGraphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(selectionGraphOperation, selectionGraphSnapshot)
      ),
      key: outcomeRecordKey(selectionGraphOperation.operationId),
      position: JournalPosition.make(2),
      runId: selectionRunId
    }
  ]
  const records = [...graphRecords, ...claimRecords]
  return {
    acceptedAt: JournalPosition.make(Math.max(...records.map(({ position }) => position))),
    currentGraph: selectionGraphSnapshot,
    currentGraphOperationId: selectionGraphOperation.operationId,
    pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
    responsibility: { entries: [] },
    runId: selectionRunId,
    runControlPolicy: RunControlPolicy.make({
      revision: initialRunPolicyRevision,
      taskExecutionCapacity: TaskWorkCapacity.make(1)
    }),
    workflowHistory: { records }
  }
}

it.each([
  ["NoCurrentReport", PlannedAttemptExecutorStateObservation.cases.ExecutorStateNoCurrentReport.make({})],
  ["TemporarilyUnavailable", PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({})],
  ["Unreadable", PlannedAttemptExecutorStateObservation.cases.ExecutorStateUnreadable.make({})],
  [
    "CorrelationContradiction",
    PlannedAttemptExecutorStateObservation.cases.ExecutorReportContradiction.make({
      observed: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: { runId, attemptId: AttemptId.make("foreign-projection-attempt") }
      })
    })
  ]
] as const)("retains the exact task responsibility after a %s executor projection", (_reason, observation) => {
  const responsibility = WorkflowResponsibilityEntry.cases.PlannedAttemptExecutorWorkResponsibility.make({
    beganAt: JournalPosition.make(1),
    plannedAttempt
  })
  const projection = PlannedAttemptExecutorStateObservedEvent.make({
    observation,
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
    plannedAttempt,
    version: workflowJournalEventVersion
  })

  expect(responsibilityStillOwnsTask(responsibility, [], new Set())).toBe(false)
  expect(
    responsibilityStillOwnsTask(
      responsibility,
      [
        {
          event: projection,
          key: JournalRecordKey.make("fresh-workflow-projection"),
          position: JournalPosition.make(2),
          runId
        }
      ],
      new Set()
    )
  ).toBe(true)
})

it("lets later exact executor evidence supersede an earlier unreadable projection", () => {
  const responsibility = WorkflowResponsibilityEntry.cases.PlannedAttemptExecutorWorkResponsibility.make({
    beganAt: JournalPosition.make(1),
    plannedAttempt
  })
  const unreadable = PlannedAttemptExecutorStateObservedEvent.make({
    observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateUnreadable.make({}),
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const exact = PlannedAttemptExecutorStateObservedEvent.make({
    observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
      report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId }
      })
    }),
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(2),
    plannedAttempt,
    version: workflowJournalEventVersion
  })

  expect(
    responsibilityStillOwnsTask(
      responsibility,
      [
        {
          event: unreadable,
          key: JournalRecordKey.make("fresh-workflow-unreadable-projection"),
          position: JournalPosition.make(2),
          runId
        },
        {
          event: exact,
          key: JournalRecordKey.make("fresh-workflow-exact-projection"),
          position: JournalPosition.make(3),
          runId
        }
      ],
      new Set()
    )
  ).toBe(false)
})

it("advances only after the exact task-selection claim acquisition is recorded", () => {
  const operation = selectionOperation("exact")
  const intent = selectionClaimIntentRecord(operation, 3)
  const acquired = selectionClaimAcquiredRecord(ActiveTaskClaim.make(operation.acquisition), 4)

  expect(
    deriveFreshWorkflowDecisions(selectionFrameWith([intent, acquired]), new Set(), selectionTarget)
  ).toMatchObject([
    {
      step: {
        _tag: "ReadPostClaimGraph",
        claimOperation: operation,
        predecessorOperationId: operation.acquisition.operationId,
        task: { id: selectionTaskId }
      },
      transition: {
        _tag: "ContinueFreshWorkflowOperation",
        operationId: operation.acquisition.operationId,
        taskId: selectionTaskId
      }
    }
  ])
})

it("authorizes no plan-stage boundary when the plan lacks its exact causal claim", () => {
  const claim = selectionOperation("missing-causal-acquisition")
  const specification = makeTaskWorkSpecification({
    body: "missing causal claim",
    taskId: selectionTaskId,
    title: "missing causal claim"
  })
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("fresh-workflow-missing-causal-claim-attempt"),
    baseSha: GitCommitSha.make("2".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/fresh-workflow-missing-causal-claim"),
    executor: TaskExecutorLocator.make("executor:fresh-workflow-missing-causal-claim"),
    runId: selectionRunId,
    taskId: selectionTaskId,
    taskRevision: specification.fingerprint,
    worktree: WorktreeLocator.make("/worktrees/fresh-workflow-missing-causal-claim")
  })
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("fresh-workflow-missing-causal-claim-specification"),
    selectionTarget,
    selectionTaskId,
    [claim.acquisition.operationId]
  )
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("fresh-workflow-missing-causal-claim-plan"),
    plannedAttempt,
    predecessorOperationIds: [specificationOperation.operationId]
  })
  const worktree = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("fresh-workflow-missing-causal-claim-worktree"),
    plannedAttempt,
    predecessorOperationIds: [plan.operationId]
  })
  const records: ReadonlyArray<JournalRecord> = [
    selectionClaimIntentRecord(claim, 3),
    {
      event: taskTrackerReadIntent(specificationOperation),
      key: intentRecordKey(specificationOperation.operationId),
      position: JournalPosition.make(4),
      runId: selectionRunId
    },
    {
      event: taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
      ),
      key: outcomeRecordKey(specificationOperation.operationId),
      position: JournalPosition.make(5),
      runId: selectionRunId
    },
    {
      event: TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion }),
      key: attemptPlanRecordKey(plannedAttempt.attemptId),
      position: JournalPosition.make(6),
      runId: selectionRunId
    },
    {
      event: TaskWorktreeReconciliationIntendedEvent.make({
        operation: worktree,
        version: workflowJournalEventVersion
      }),
      key: intentRecordKey(worktree.operationId),
      position: JournalPosition.make(7),
      runId: selectionRunId
    },
    {
      event: TaskWorktreeReadyEvent.make({
        operationId: worktree.operationId,
        proof: PlannedWorktreeReady.make({
          baseSha: plannedAttempt.baseSha,
          branch: plannedAttempt.branch,
          headSha: plannedAttempt.baseSha,
          worktree: plannedAttempt.worktree
        }),
        version: workflowJournalEventVersion
      }),
      key: outcomeRecordKey(worktree.operationId),
      position: JournalPosition.make(8),
      runId: selectionRunId
    }
  ]

  for (const prefix of [records.slice(0, 4), records.slice(0, 5), records]) {
    expect(deriveFreshWorkflowDecisions(selectionFrameWith(prefix), new Set(), selectionTarget)).toEqual([])
  }
})

it("does not begin executor work from a worktree-ready outcome whose proof does not match the exact plan", () => {
  const claim = selectionOperation("mismatched-ready-proof")
  const postClaimGraph = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("fresh-workflow-mismatched-ready-post-claim-graph"),
    selectionTarget,
    [claim.acquisition.operationId],
    [selectionTaskId]
  )
  const specification = makeTaskWorkSpecification({
    body: "mismatched ready proof",
    taskId: selectionTaskId,
    title: "mismatched ready proof"
  })
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("fresh-workflow-mismatched-ready-specification"),
    selectionTarget,
    selectionTaskId,
    [postClaimGraph.operationId]
  )
  const attempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("fresh-workflow-mismatched-ready-attempt"),
    baseSha: GitCommitSha.make("2".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/fresh-workflow-mismatched-ready"),
    executor: TaskExecutorLocator.make("executor:fresh-workflow-mismatched-ready"),
    runId: selectionRunId,
    taskId: selectionTaskId,
    taskRevision: specification.fingerprint,
    worktree: WorktreeLocator.make("/worktrees/fresh-workflow-mismatched-ready")
  })
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("fresh-workflow-mismatched-ready-plan"),
    plannedAttempt: attempt,
    predecessorOperationIds: [specificationOperation.operationId]
  })
  const worktree = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("fresh-workflow-mismatched-ready-worktree"),
    plannedAttempt: attempt,
    predecessorOperationIds: [plan.operationId]
  })
  const records: ReadonlyArray<JournalRecord> = [
    selectionClaimIntentRecord(claim, 3),
    selectionClaimAcquiredRecord(ActiveTaskClaim.make(claim.acquisition), 4),
    ...selectionGraphRecords(postClaimGraph, 5),
    {
      event: taskTrackerReadIntent(specificationOperation),
      key: intentRecordKey(specificationOperation.operationId),
      position: JournalPosition.make(7),
      runId: selectionRunId
    },
    {
      event: taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
      ),
      key: outcomeRecordKey(specificationOperation.operationId),
      position: JournalPosition.make(8),
      runId: selectionRunId
    },
    {
      event: TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion }),
      key: attemptPlanRecordKey(attempt.attemptId),
      position: JournalPosition.make(9),
      runId: selectionRunId
    },
    {
      event: TaskWorktreeReconciliationIntendedEvent.make({
        operation: worktree,
        version: workflowJournalEventVersion
      }),
      key: intentRecordKey(worktree.operationId),
      position: JournalPosition.make(10),
      runId: selectionRunId
    },
    {
      event: TaskWorktreeReadyEvent.make({
        operationId: worktree.operationId,
        proof: PlannedWorktreeReady.make({
          baseSha: attempt.baseSha,
          branch: attempt.branch,
          headSha: attempt.baseSha,
          worktree: WorktreeLocator.make("/worktrees/foreign-ready-proof")
        }),
        version: workflowJournalEventVersion
      }),
      key: outcomeRecordKey(worktree.operationId),
      position: JournalPosition.make(11),
      runId: selectionRunId
    }
  ]

  expect(deriveFreshWorkflowDecisions(selectionFrameWith(records), new Set(), selectionTarget)).toEqual([])
})

it("does not advance on an older same-task acquisition after the latest intent", () => {
  const olderOperation = selectionOperation("older")
  const operation = selectionOperation("latest")
  const records = [
    selectionClaimIntentRecord(olderOperation, 3),
    selectionClaimIntentRecord(operation, 5),
    selectionClaimAcquiredRecord(ActiveTaskClaim.make(olderOperation.acquisition), 6)
  ]

  expect(deriveFreshWorkflowDecisions(selectionFrameWith(records), new Set(), selectionTarget)).toMatchObject([
    {
      step: {
        _tag: "ReadCurrentTaskGraph",
        predecessorOperationId: selectionGraphOperation.operationId,
        task: { id: selectionTaskId }
      },
      transition: {
        _tag: "ContinueFreshWorkflowOperation",
        operationId: selectionGraphOperation.operationId,
        taskId: selectionTaskId
      }
    }
  ])
})

it("does not advance on a foreign owner and token for the latest intent", () => {
  const operation = selectionOperation("latest-foreign")
  const foreignClaim = ActiveTaskClaim.make({
    ...operation.acquisition,
    owner: ClaimOwner.make("fresh-workflow-selection-foreign-owner"),
    token: ClaimToken.make("fresh-workflow-selection-foreign-token")
  })
  const records = [selectionClaimIntentRecord(operation, 3), selectionClaimAcquiredRecord(foreignClaim, 4)]

  expect(deriveFreshWorkflowDecisions(selectionFrameWith(records), new Set(), selectionTarget)).toMatchObject([
    {
      step: {
        _tag: "ReadCurrentTaskGraph",
        predecessorOperationId: selectionGraphOperation.operationId,
        task: { id: selectionTaskId }
      },
      transition: {
        _tag: "ContinueFreshWorkflowOperation",
        operationId: selectionGraphOperation.operationId,
        taskId: selectionTaskId
      }
    }
  ])
})

it("keeps a rejected fresh task blocked and wakes one focused claim read per later complete graph", () => {
  const operation = selectionOperation("rejected")
  const foreign = ActiveTaskClaim.make({
    operationId: OperationId.make("fresh-workflow-selection-foreign-operation"),
    owner: ClaimOwner.make("fresh-workflow-selection-foreign-owner"),
    taskId: selectionTaskId,
    token: ClaimToken.make("fresh-workflow-selection-foreign-token")
  })
  const rejected = [selectionClaimIntentRecord(operation, 3), selectionClaimRejectedRecord(operation, foreign, 4)]

  expect(deriveFreshWorkflowDecisions(selectionFrameWith(rejected), new Set(), selectionTarget)).toEqual([])

  const wakeGraph = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("fresh-workflow-selection-rejection-wake"),
    selectionTarget
  )
  const afterWake = [...rejected, ...selectionGraphRecords(wakeGraph, 5)]
  expect(deriveFreshWorkflowDecisions(selectionFrameWith(afterWake), new Set(), selectionTarget)).toMatchObject([
    {
      step: {
        _tag: "ReadRejectedTaskClaim",
        predecessorOperationId: wakeGraph.operationId,
        rejectedClaimOperationId: operation.acquisition.operationId,
        task: { id: selectionTaskId }
      },
      transition: {
        _tag: "ContinueFreshWorkflowOperation",
        operationId: wakeGraph.operationId,
        taskId: selectionTaskId
      }
    }
  ])

  const unrelatedRead = makeTaskClaimObservationOperation(
    OperationId.make("fresh-workflow-selection-unrelated-unclaimed-read"),
    selectionTarget,
    selectionTaskId,
    [operation.acquisition.operationId]
  )
  const unrelatedUnclaimed = [
    ...afterWake,
    ...selectionClaimReadRecords(unrelatedRead, UnclaimedTask.make({ taskId: selectionTaskId }), 7)
  ]
  expect(
    deriveFreshWorkflowDecisions(selectionFrameWith(unrelatedUnclaimed), new Set(), selectionTarget)
  ).toMatchObject([{ step: { _tag: "ReadRejectedTaskClaim", predecessorOperationId: wakeGraph.operationId } }])

  const foreignRead = makeTaskClaimObservationOperation(
    OperationId.make("fresh-workflow-selection-foreign-reread"),
    selectionTarget,
    selectionTaskId,
    [operation.acquisition.operationId, wakeGraph.operationId]
  )
  const stillForeign = [...afterWake, ...selectionClaimReadRecords(foreignRead, foreign, 7)]
  expect(deriveFreshWorkflowDecisions(selectionFrameWith(stillForeign), new Set(), selectionTarget)).toEqual([])

  const secondWake = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("fresh-workflow-selection-second-rejection-wake"),
    selectionTarget
  )
  const afterSecondWake = [...stillForeign, ...selectionGraphRecords(secondWake, 9)]
  expect(deriveFreshWorkflowDecisions(selectionFrameWith(afterSecondWake), new Set(), selectionTarget)).toMatchObject([
    { step: { _tag: "ReadRejectedTaskClaim", predecessorOperationId: secondWake.operationId } }
  ])

  const secondForeignRead = makeTaskClaimObservationOperation(
    OperationId.make("fresh-workflow-selection-second-foreign-reread"),
    selectionTarget,
    selectionTaskId,
    [operation.acquisition.operationId, secondWake.operationId]
  )
  const twiceForeign = [...afterSecondWake, ...selectionClaimReadRecords(secondForeignRead, foreign, 11)]
  expect(deriveFreshWorkflowDecisions(selectionFrameWith(twiceForeign), new Set(), selectionTarget)).toEqual([])

  const thirdWake = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("fresh-workflow-selection-third-rejection-wake"),
    selectionTarget
  )
  expect(
    deriveFreshWorkflowDecisions(
      selectionFrameWith([...twiceForeign, ...selectionGraphRecords(thirdWake, 13)]),
      new Set(),
      selectionTarget
    )
  ).toMatchObject([{ step: { _tag: "ReadRejectedTaskClaim", predecessorOperationId: thirdWake.operationId } }])
})

it("retains a rejected claim while its focused reread has no outcome and rejects non-selection intents", () => {
  const operation = selectionOperation("disposition-retained")
  const foreign = ActiveTaskClaim.make({
    operationId: OperationId.make("fresh-workflow-selection-disposition-foreign-operation"),
    owner: ClaimOwner.make("fresh-workflow-selection-disposition-foreign-owner"),
    taskId: selectionTaskId,
    token: ClaimToken.make("fresh-workflow-selection-disposition-foreign-token")
  })
  const rejected = selectionClaimRejectedRecord(operation, foreign, 4)
  const wakeGraph = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("fresh-workflow-selection-disposition-wake"),
    selectionTarget
  )
  const focusedRead = makeTaskClaimObservationOperation(
    OperationId.make("fresh-workflow-selection-disposition-read"),
    selectionTarget,
    selectionTaskId,
    [operation.acquisition.operationId, wakeGraph.operationId]
  )
  const claimIntent = selectionClaimIntentRecord(operation, 3)
  const records: ReadonlyArray<JournalRecord> = [
    claimIntent,
    rejected,
    ...selectionGraphRecords(wakeGraph, 5),
    {
      event: taskTrackerReadIntent(focusedRead),
      key: intentRecordKey(focusedRead.operationId),
      position: JournalPosition.make(7),
      runId: selectionRunId
    }
  ]
  const task = { id: selectionTaskId, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }

  expect(
    rejectedFreshTaskClaimDisposition(
      records,
      task,
      claimIntent,
      new Set([wakeGraph.operationId]),
      taskTrackerTargetKey(selectionTarget)
    )
  ).toEqual({ _tag: "ConstraintRetained" })

  const nonSelectionOperation = makeTaskClaimAcquisitionOperation({
    acquisition: selectionAcquisition("disposition-non-selection"),
    authority: TaskClaimAcquisitionAuthority.cases.ExplicitTaskClaimReacquisitionAuthority.make({
      requestId: TaskClaimReacquisitionRequestId.make("fresh-workflow-disposition-reacquisition")
    }),
    predecessorOperationIds: [selectionGraphOperation.operationId]
  })
  const nonSelectionIntent: JournalRecord = {
    event: TaskClaimAcquisitionIntendedEvent.make({
      operation: nonSelectionOperation,
      version: workflowJournalEventVersion
    }),
    key: intentRecordKey(nonSelectionOperation.acquisition.operationId),
    position: JournalPosition.make(3),
    runId: selectionRunId
  }
  expect(
    rejectedFreshTaskClaimDisposition([], task, nonSelectionIntent, new Set(), taskTrackerTargetKey(selectionTarget))
  ).toEqual({ _tag: "ConstraintAbsent" })
  expect(
    rejectedFreshTaskClaimDisposition([], task, rejected, new Set(), taskTrackerTargetKey(selectionTarget))
  ).toEqual({ _tag: "ConstraintAbsent" })
})

it("fails closed when an accepted fresh plan is evaluated for a different tracker target", () => {
  const claim = selectionOperation("target-mismatch-plan")
  const postClaimGraph = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("fresh-workflow-target-mismatch-post-claim-graph"),
    selectionTarget,
    [claim.acquisition.operationId],
    [selectionTaskId]
  )
  const specification = makeTaskWorkSpecification({
    body: "target mismatch plan",
    taskId: selectionTaskId,
    title: "target mismatch plan"
  })
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("fresh-workflow-target-mismatch-specification"),
    selectionTarget,
    selectionTaskId,
    [postClaimGraph.operationId]
  )
  const attempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("fresh-workflow-target-mismatch-attempt"),
    baseSha: GitCommitSha.make("3".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/fresh-workflow-target-mismatch"),
    executor: TaskExecutorLocator.make("executor:fresh-workflow-target-mismatch"),
    runId: selectionRunId,
    taskId: selectionTaskId,
    taskRevision: TaskRevision.make(specification.fingerprint),
    worktree: WorktreeLocator.make("/worktrees/fresh-workflow-target-mismatch")
  })
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("fresh-workflow-target-mismatch-plan"),
    plannedAttempt: attempt,
    predecessorOperationIds: [specificationOperation.operationId]
  })
  const records: ReadonlyArray<JournalRecord> = [
    selectionClaimIntentRecord(claim, 3),
    selectionClaimAcquiredRecord(ActiveTaskClaim.make(claim.acquisition), 4),
    ...selectionGraphRecords(postClaimGraph, 5),
    {
      event: taskTrackerReadIntent(specificationOperation),
      key: intentRecordKey(specificationOperation.operationId),
      position: JournalPosition.make(7),
      runId: selectionRunId
    },
    {
      event: taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
      ),
      key: outcomeRecordKey(specificationOperation.operationId),
      position: JournalPosition.make(8),
      runId: selectionRunId
    },
    {
      event: TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion }),
      key: attemptPlanRecordKey(attempt.attemptId),
      position: JournalPosition.make(9),
      runId: selectionRunId
    }
  ]

  expect(
    deriveFreshWorkflowDecisions(selectionFrameWith(records), new Set(), FixtureTarget.make("other-target"))
  ).toEqual([])
})

it("does not continue a focused specification observation without a durable task claim", () => {
  const specification = makeTaskWorkSpecification({
    body: "specification without claim",
    taskId: selectionTaskId,
    title: "specification without claim"
  })
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("fresh-workflow-specification-without-claim"),
    selectionTarget,
    selectionTaskId,
    []
  )
  const records: ReadonlyArray<JournalRecord> = [
    {
      event: taskTrackerReadIntent(specificationOperation),
      key: intentRecordKey(specificationOperation.operationId),
      position: JournalPosition.make(3),
      runId: selectionRunId
    },
    {
      event: taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
      ),
      key: outcomeRecordKey(specificationOperation.operationId),
      position: JournalPosition.make(4),
      runId: selectionRunId
    }
  ]

  expect(deriveFreshWorkflowDecisions(selectionFrameWith(records), new Set(), selectionTarget)).toEqual([])
})

it("does not plan from a focused specification whose read omits its claim predecessor", () => {
  const claim = selectionOperation("specification-missing-predecessor")
  const specification = makeTaskWorkSpecification({
    body: "specification missing predecessor",
    taskId: selectionTaskId,
    title: "specification missing predecessor"
  })
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("fresh-workflow-specification-missing-predecessor"),
    selectionTarget,
    selectionTaskId,
    []
  )
  const records: ReadonlyArray<JournalRecord> = [
    selectionClaimIntentRecord(claim, 3),
    selectionClaimAcquiredRecord(ActiveTaskClaim.make(claim.acquisition), 4),
    {
      event: taskTrackerReadIntent(specificationOperation),
      key: intentRecordKey(specificationOperation.operationId),
      position: JournalPosition.make(5),
      runId: selectionRunId
    },
    {
      event: taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
      ),
      key: outcomeRecordKey(specificationOperation.operationId),
      position: JournalPosition.make(6),
      runId: selectionRunId
    }
  ]

  expect(deriveFreshWorkflowDecisions(selectionFrameWith(records), new Set(), selectionTarget)).toEqual([])
})

it("makes a rejected fresh task entry-capable only after a focused unclaimed observation", () => {
  const operation = selectionOperation("cleared")
  const foreign = ActiveTaskClaim.make({
    operationId: OperationId.make("fresh-workflow-selection-cleared-foreign-operation"),
    owner: ClaimOwner.make("fresh-workflow-selection-cleared-foreign-owner"),
    taskId: selectionTaskId,
    token: ClaimToken.make("fresh-workflow-selection-cleared-foreign-token")
  })
  const wakeGraph = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("fresh-workflow-selection-cleared-wake"),
    selectionTarget
  )
  const focusedRead = makeTaskClaimObservationOperation(
    OperationId.make("fresh-workflow-selection-cleared-read"),
    selectionTarget,
    selectionTaskId,
    [operation.acquisition.operationId, wakeGraph.operationId]
  )
  const records = [
    selectionClaimIntentRecord(operation, 3),
    selectionClaimRejectedRecord(operation, foreign, 4),
    ...selectionGraphRecords(wakeGraph, 5),
    ...selectionClaimReadRecords(focusedRead, UnclaimedTask.make({ taskId: selectionTaskId }), 7)
  ]

  expect(deriveFreshWorkflowDecisions(selectionFrameWith(records), new Set(), selectionTarget)).toMatchObject([
    {
      step: { _tag: "ReadCurrentTaskGraph", predecessorOperationId: wakeGraph.operationId },
      transition: { _tag: "ContinueFreshWorkflowOperation", taskId: selectionTaskId }
    }
  ])
})
