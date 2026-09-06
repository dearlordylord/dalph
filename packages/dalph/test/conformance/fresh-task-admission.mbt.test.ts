/* eslint-disable max-lines -- One adapter keeps the formal action-to-production admission map auditable. */
import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, ITFMap, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Effect, Option, Result, Schema } from "effect"
import { expect } from "vitest"
import { projectTrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { ActiveTaskClaim, UnclaimedTask } from "../../../orchestrator/src/authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../orchestrator/src/authorities/task-tracker/claim.js"
import { PlannedWorktreeReady } from "../../../orchestrator/src/authorities/git/worktree.js"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../../orchestrator/src/coordination/admission/capacity.js"
import { makeFreshTaskAdmissionBasis } from "../../../orchestrator/src/coordination/admission/fresh-task-admission.js"
import {
  projectFreshTaskAdmission,
  projectFreshTaskCommitments
} from "../../../orchestrator/src/coordination/admission/fresh-task-admission-projection.js"
import { makeIntegrationTargetResourceController } from "../../../orchestrator/src/coordination/admission/integration-target-resource.js"
import { makeApplicationExitLifecycle } from "../../../orchestrator/src/coordination/application-exit/lifecycle.js"
import {
  makeDeliveryRuntimeAdmissionController,
  type DeliveryAdmissionReservation,
  type DeliveryRuntimeAdmissionController
} from "../../../orchestrator/src/coordination/delivery/delivery-runtime-admission.js"
import {
  DeliveryProposalId,
  freshContinuationDecisionsOf,
  trackerGraphReadProposalOf
} from "../../../orchestrator/src/coordination/delivery/delivery-proposal.js"
import {
  deliveryProposalsOf,
  deliveryProposalOfAcceptedFreshTask
} from "../../../orchestrator/src/coordination/delivery/delivery-proposal-derivation.js"
import {
  deriveFreshTaskCandidateEvaluation,
  type FreshTaskCandidateFrontier
} from "../../../orchestrator/src/coordination/delivery/fresh-task-candidate.js"
import { FreshWorkflowStep } from "../../../orchestrator/src/coordination/delivery/fresh-workflow-step.js"
import { RunnableFrontierTransition } from "../../../orchestrator/src/coordination/frontier/frontier.js"
import { InitialControlPolicy, RunPolicyRevision } from "../../../orchestrator/src/control/policy.js"
import type { CurrentDeliveryFrame } from "../../../orchestrator/src/coordination/run/current-delivery-frame.js"
import { RunActivationOpportunity } from "../../../orchestrator/src/coordination/run/run-activation-opportunity.js"
import { reconstructedTaskGraphFor } from "../../../orchestrator/src/coordination/reconstruction/graph-knowledge.js"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import { requiredPlannedAttemptPositionsOf } from "../../../orchestrator/src/coordination/run/required-planned-attempt-positions.js"
import { JournalPosition, type JournalRecordKey } from "../../../orchestrator/src/workflow-journal/identity.js"
import { InRunJournal, type JournalRecord } from "../../../orchestrator/src/workflow-journal/store.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  taskWorkCapacityPolicyRecordKey
} from "../../../orchestrator/src/workflow-journal/record-key.js"
import { makeWorkflowRunBeganRecord } from "../../../orchestrator/src/workflow-journal/run-lifecycle.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskAttemptPlanOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "../../../orchestrator/src/workflow/registry/operation.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent,
  TaskWorkCapacityChangedEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TaskWorktreeReadyEvent,
  taskTrackerReadIntent
} from "../../../orchestrator/src/workflow/registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../../orchestrator/src/workflow/task-tracker-facts/observation.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import {
  PlannedAttemptProtocolController,
  makePlannedAttemptProtocolController
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { beginPlannedAttemptExecutorResponsibility } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/responsibility.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/events.js"

const taskTags = ["TaskA", "TaskB", "TaskC", "TaskD", "TaskE"] as const
type TaskTag = (typeof taskTags)[number]

const runId = RunId.make("fresh-task-admission-mbt-run")
const target = FixtureTarget.make("fresh-task-admission-mbt-target")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(3) })
const taskIds = new Map<TaskTag, TaskId>(taskTags.map((tag) => [tag, TaskId.make(tag.slice(-1))]))
const taskIdFor = (tag: TaskTag): TaskId => Option.getOrThrow(Option.fromUndefinedOr(taskIds.get(tag)))
const tagForTaskId = (taskId: TaskId): TaskTag => {
  const found = taskTags.find((tag) => taskIdFor(tag) === taskId)
  if (found === undefined) return Effect.runSync(Effect.die(`unknown MBT task ${taskId}`))
  return found
}
const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)
const taskTagOf = (value: unknown): TaskTag => {
  const tag = variantTag(value)
  if (!taskTags.includes(tag as TaskTag)) return Effect.runSync(Effect.die(`unknown model task ${tag}`))
  return tag as TaskTag
}

const graph = (() => {
  const projected = projectTrackerSnapshot({
    revision: "fresh-task-admission-mbt-graph",
    tasks: taskTags.map((tag) => ({
      id: taskIdFor(tag),
      lifecycle: { _tag: "Open" as const },
      parentTaskId: null,
      prerequisiteIds: []
    }))
  })
  return Option.getOrThrow(Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined))
})()

const specificationFor = (tag: TaskTag) => makeTaskWorkSpecification({ body: tag, taskId: taskIdFor(tag), title: tag })

const attemptFor = (tag: TaskTag): PlannedTaskAttempt =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`fresh-task-admission-${tag}`),
    baseSha: GitCommitSha.make(String(taskTags.indexOf(tag) + 1).repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/fresh-task-admission-${tag}`),
    executor: TaskExecutorLocator.make("executor:fresh-task-admission-mbt"),
    runId,
    taskId: taskIdFor(tag),
    taskRevision: specificationFor(tag).fingerprint,
    worktree: WorktreeLocator.make(`/worktrees/fresh-task-admission-${tag}`)
  })

const Variant = Schema.Struct({ tag: Schema.String, value: Schema.Unknown })
const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    admission: ITFMap(Variant, Variant),
    capacity: ITFBigInt,
    claimCycle: ITFMap(Variant, Variant),
    process: Variant
  })
})

interface AdmissionProjection {
  readonly capacity: bigint
  readonly occupied: ReadonlyArray<{
    readonly attemptId?: PlannedTaskAttempt["attemptId"]
    readonly claimOperationId?: OperationId
    readonly runId?: RunId
    readonly state: string
    readonly task: TaskTag
  }>
  readonly process: string
}

const projectionOfSpec = (raw: unknown): Effect.Effect<AdmissionProjection> =>
  Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
    Effect.map(({ state }) => {
      const claimCycles = new Map([...state.claimCycle].map(([task, cycle]) => [taskTagOf(task), variantTag(cycle)]))
      return {
        capacity: state.capacity,
        occupied: [...state.admission]
          .filter(([, admission]) => variantTag(admission) !== "Unoccupied")
          .map(([task, admission]) => {
            const taskTag = taskTagOf(task)
            const stateTag = variantTag(admission)
            if (stateTag === "FreshTaskCommitted") {
              const cycle = claimCycles.get(taskTag) === "NextClaimCycle" ? 2 : 1
              return {
                claimOperationId: OperationId.make(`fresh-task-admission-${taskTag}-claim-${cycle}`),
                state: stateTag,
                task: taskTag
              }
            }
            return stateTag === "ExactAttemptHeld" || stateTag === "ExistingResponsibilityReserved"
              ? { attemptId: attemptFor(taskTag).attemptId, runId, state: stateTag, task: taskTag }
              : { state: stateTag, task: taskTag }
          })
          .toSorted((left, right) => left.task.localeCompare(right.task)),
        process: variantTag(state.process)
      }
    }),
    Effect.orDie
  )

const actionNames = {
  contractCapacity: {},
  crash: {},
  expandCapacity: {},
  handoffReadyResponsibilityFor: { task: Schema.Unknown },
  handoffToExecutorResponsibilityFor: { task: Schema.Unknown },
  init: {},
  loseExecutorResponsibilityAppendResponseFor: { task: Schema.Unknown },
  loseAcceptedClaimIntentAppendResponseFor: { task: Schema.Unknown },
  loseAcceptedExecutorResponsibilityAppendResponseFor: { task: Schema.Unknown },
  observeClaimIntentPresentFor: { task: Schema.Unknown },
  observeExecutorResponsibilityAppendAbsentFor: { task: Schema.Unknown },
  observeExecutorResponsibilityAppendPresentFor: { task: Schema.Unknown },
  observeForeignClaimClearedFor: { task: Schema.Unknown },
  recordClaimIntentFor: { task: Schema.Unknown },
  projectAcceptedWorktreeReadyFor: { task: Schema.Unknown },
  projectForeignClaimRejectionFor: { task: Schema.Unknown },
  probeFreshEntryDeferredFor: { task: Schema.Unknown },
  recover: {},
  releaseHeldPositionNotReadyFor: { task: Schema.Unknown },
  releaseHeldPositionReadyFor: { task: Schema.Unknown },
  reserveFreshEntryFor: { task: Schema.Unknown },
  reserveReadyResponsibilityFor: { task: Schema.Unknown }
} as const

/**
 * Scenario-to-test mapping:
 * - A–C enter from A–E while D/E remain incapable: reserveFreshEntryFor + production candidate evaluation/controller.
 * - Foreign rejection is task-local and ambiguity retains occupancy: rejection/ambiguous append actions + journal projector.
 * - Handoff has no gap and B release admits D: handoff/release actions + atomic controller synchronization.
 * - Contraction/expansion and ready-existing priority: policy actions and ready-responsibility controller reservation.
 * - Process loss reconstructs durable occupancy only: crash/recover + a new controller projected from Journal facts.
 */
const freshTaskAdmissionDriver = defineDriver(actionNames, () => {
  let process: "ProcessDown" | "ProcessUp" = "ProcessUp"
  let records: ReadonlyArray<JournalRecord> = [makeWorkflowRunBeganRecord(runId, target, initialPolicy)]
  let controller: DeliveryRuntimeAdmissionController | undefined
  let sequence = 1
  let visiblePrefixLength = 1
  let graphSequence = 0
  let acceptedFrontier: FreshTaskCandidateFrontier | undefined
  const reservations = new Map<TaskTag, DeliveryAdmissionReservation>()
  const claimCycles = new Map<TaskTag, number>()
  const ambiguousResponsibilityTags = new Set<TaskTag>()
  const visibleRecords = () => records.slice(0, visiblePrefixLength)
  const validReduction = (candidate: ReadonlyArray<JournalRecord>) => {
    const reduction = reduceWorkflowJournalHistory(runId, candidate)
    if (reduction._tag === "InvalidWorkflowJournalHistory") {
      return Effect.runSync(
        Effect.die(`fresh-task admission MBT constructed invalid history: ${JSON.stringify(reduction.issues)}`)
      )
    }
    return reduction
  }
  const currentReduction = () => validReduction(visibleRecords())
  const revealAcceptedSuffix = () => {
    visiblePrefixLength = records.length
    validReduction(visibleRecords())
  }

  const append = (
    event: JournalRecord["event"],
    key: JournalRecordKey,
    visibility: "AcceptedUnobserved" | "Visible" = "Visible"
  ): JournalRecord => {
    if (visibility === "Visible" && visiblePrefixLength !== records.length) {
      return Effect.runSync(Effect.die("cannot append after a process-unobserved accepted Journal suffix"))
    }
    const record = { event, key, position: JournalPosition.make(++sequence), runId } satisfies JournalRecord
    records = [...records, record]
    validReduction(records)
    if (visibility === "Visible") visiblePrefixLength = records.length
    validReduction(visibleRecords())
    return record
  }
  /**
   * The conformance driver owns one reducer-validated Journal history.
   * Production responsibility admission must use that history instead of
   * manually manufacturing its private acceptance proof.
   */
  const reducerValidInMemoryJournalFor = (visibility: "AcceptedUnobserved" | "Visible") =>
    InRunJournal.of({
      append: (eventRunId, key, event) => {
        if (eventRunId !== runId) return Effect.die(`unexpected responsibility Run ${eventRunId}`)
        return Effect.sync(() => append(event, key, visibility))
      },
      read: (eventRunId) => Effect.succeed(records.filter(({ runId: recordedRunId }) => recordedRunId === eventRunId))
    })
  const appendGraph = (suffix: string, explicitlyCoveredTaskIds: ReadonlyArray<TaskId> = []) => {
    const operation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make(`fresh-task-admission-graph-${suffix}-${++graphSequence}`),
      target,
      [],
      explicitlyCoveredTaskIds
    )
    append(taskTrackerReadIntent(operation), intentRecordKey(operation.operationId))
    append(
      taskTrackerFactsObservedEvent(operation.operationId, makeCompleteTaskTrackerFactsObserved(operation, graph)),
      outcomeRecordKey(operation.operationId)
    )
    return operation
  }
  let currentGraphOperation = appendGraph("initial", [...taskIds.values()])

  const frame = (): CurrentDeliveryFrame => {
    const { runState } = currentReduction()
    const currentGraph = Option.getOrUndefined(reconstructedTaskGraphFor(runState.graphKnowledge, target))
    const currentGraphOperationId = runState.graphKnowledge.taskTrackerFacts.findLast(
      (observation) =>
        observation._tag === "CompleteTaskTrackerFacts" || observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
    )?.operationId
    const runControlPolicy = Option.getOrUndefined(runState.controlPolicy)
    if (
      currentGraph === undefined ||
      currentGraphOperationId === undefined ||
      runControlPolicy === undefined ||
      runState.appliedThrough === null
    ) {
      return Effect.runSync(Effect.die("fresh-task admission MBT frame is not reconstructable"))
    }
    return {
      acceptedAt: runState.appliedThrough,
      currentGraph,
      currentGraphOperationId,
      pause: runState.pause,
      responsibility: runState.responsibility,
      runId,
      runControlPolicy,
      workflowHistory: runState.workflowHistory
    }
  }
  const frontier = () =>
    Effect.gen(function* () {
      const currentFrame = frame()
      const required = requiredPlannedAttemptPositionsOf(currentReduction().runState)
      return yield* deriveFreshTaskCandidateEvaluation({
        acceptedAt: currentFrame.acceptedAt,
        activeRefreshBoundaryReached: false,
        frame: currentFrame,
        opportunity: RunActivationOpportunity.OrdinaryRunEntry(),
        recoveredAttemptIds: new Set(required.map(({ attemptId }) => attemptId)),
        runId,
        target
      }).pipe(Effect.map(({ frontier }) => frontier))
    })
  const basis = () => {
    const { runState } = currentReduction()
    const policy = Option.getOrUndefined(runState.controlPolicy)
    if (policy === undefined) return Effect.die("fresh-task admission MBT policy is not reconstructable")
    const freshAdmission = projectFreshTaskAdmission(runId, runState.workflowHistory.records)
    if (freshAdmission._tag === "FreshTaskAdmissionProjectionInvalid") return Effect.die(freshAdmission)
    return makeFreshTaskAdmissionBasis({
      acceptedAt: runState.appliedThrough,
      capacity: policy.taskExecutionCapacity,
      entries: [],
      projection: freshAdmission,
      runId
    })
  }
  const makeController = Effect.fn("FreshTaskAdmissionMBT.makeController")(function* () {
    const protocol = yield* makePlannedAttemptProtocolController()
    return yield* makeDeliveryRuntimeAdmissionController(
      yield* basis(),
      yield* makeIntegrationTargetResourceController(),
      (yield* makeApplicationExitLifecycle()).admission
    ).pipe(Effect.provideService(PlannedAttemptProtocolController, protocol))
  })
  const requireController = () =>
    controller === undefined
      ? Effect.die("fresh-task admission MBT controller is not initialized")
      : Effect.succeed(controller)
  const assertNoOutsideFreshAdmissionWhenSelectedCommitmentsAreRetained = Effect.fn(
    "FreshTaskAdmissionMBT.assertNoOutsideFreshAdmissionWhenSelectedCommitmentsAreRetained"
  )(function* () {
    const snapshot = yield* (yield* requireController()).snapshot
    const selectedCommitmentsRetained = taskTags.slice(0, 3).every((tag) => snapshot.positions.has(taskIdFor(tag)))
    const outsideTaskAdmitted = taskTags.slice(3).some((tag) => snapshot.positions.has(taskIdFor(tag)))
    if (selectedCommitmentsRetained && outsideTaskAdmitted) {
      return yield* Effect.die("D/E fresh admission occurred while A-C commitments remained occupied")
    }
  })
  const synchronize = Effect.fn("FreshTaskAdmissionMBT.synchronize")(function* () {
    const admission = yield* requireController()
    const nextFrontier = yield* frontier()
    yield* admission.synchronize(yield* basis(), nextFrontier)
    acceptedFrontier = nextFrontier
    yield* assertNoOutsideFreshAdmissionWhenSelectedCommitmentsAreRetained()
  })
  const operationFor = (tag: TaskTag) => {
    const cycle = (claimCycles.get(tag) ?? 0) + 1
    claimCycles.set(tag, cycle)
    return makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make(`fresh-task-admission-${tag}-claim-${cycle}`),
        owner: ClaimOwner.make("dalph"),
        taskId: taskIdFor(tag),
        token: ClaimToken.make(`fresh-task-admission-${tag}-token-${cycle}`)
      },
      predecessorOperationIds: [currentGraphOperation.operationId]
    })
  }
  const latestClaimOperationFor = (tag: TaskTag) => {
    const found = records.findLast(
      ({ event }) =>
        event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.taskId === taskIdFor(tag)
    )?.event
    return found?._tag === "TaskClaimAcquisitionIntended" ? found.operation : undefined
  }
  const acceptClaimIntent = (
    operation: ReturnType<typeof operationFor>,
    visibility: "AcceptedUnobserved" | "Visible" = "Visible"
  ) => {
    append(
      TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion }),
      intentRecordKey(operation.acquisition.operationId),
      visibility
    )
    const rejectedResurrections = projectFreshTaskCommitments(runId, records).filter(({ commitment }) =>
      records.some(
        ({ event }) =>
          event._tag === "TaskClaimAcquisitionRejected" &&
          event.operationId === commitment.operation.acquisition.operationId
      )
    )
    if (rejectedResurrections.length > 0) {
      return Effect.runSync(
        Effect.die(
          `commitment projector resurrected rejected operations ${rejectedResurrections
            .map(({ commitment }) => commitment.operation.acquisition.operationId)
            .join(",")}`
        )
      )
    }
    return operation
  }
  const completeReservation = Effect.fn("FreshTaskAdmissionMBT.completeReservation")(function* (tag: TaskTag) {
    const reservation = reservations.get(tag)
    if (reservation !== undefined) {
      yield* (yield* requireController()).complete(reservation)
      reservations.delete(tag)
    }
  })
  const appendAcceptedWorktreeReadyPrefix = (tag: TaskTag, operation: ReturnType<typeof operationFor>) => {
    const plannedAttempt = attemptFor(tag)
    const specification = specificationFor(tag)
    append(
      TaskClaimAcquiredEvent.make({
        claim: ActiveTaskClaim.make(operation.acquisition),
        version: workflowJournalEventVersion
      }),
      outcomeRecordKey(operation.acquisition.operationId)
    )
    const postClaimGraphOperation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make(`fresh-task-admission-${tag}-post-claim-graph`),
      target,
      [operation.acquisition.operationId],
      [taskIdFor(tag)]
    )
    append(taskTrackerReadIntent(postClaimGraphOperation), intentRecordKey(postClaimGraphOperation.operationId))
    append(
      taskTrackerFactsObservedEvent(
        postClaimGraphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(postClaimGraphOperation, graph)
      ),
      outcomeRecordKey(postClaimGraphOperation.operationId)
    )
    currentGraphOperation = postClaimGraphOperation
    const specificationOperation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make(`fresh-task-admission-${tag}-specification`),
      target,
      taskIdFor(tag),
      [postClaimGraphOperation.operationId]
    )
    append(taskTrackerReadIntent(specificationOperation), intentRecordKey(specificationOperation.operationId))
    append(
      taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
      ),
      outcomeRecordKey(specificationOperation.operationId)
    )
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make(`fresh-task-admission-${tag}-plan`),
      plannedAttempt,
      predecessorOperationIds: [specificationOperation.operationId]
    })
    append(
      TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion }),
      attemptPlanRecordKey(plannedAttempt.attemptId)
    )
    const worktree = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make(`fresh-task-admission-${tag}-worktree`),
      plannedAttempt,
      predecessorOperationIds: [plan.operationId]
    })
    append(
      TaskWorktreeReconciliationIntendedEvent.make({ operation: worktree, version: workflowJournalEventVersion }),
      intentRecordKey(worktree.operationId)
    )
    append(
      TaskWorktreeReadyEvent.make({
        operationId: worktree.operationId,
        proof: PlannedWorktreeReady.make({
          baseSha: plannedAttempt.baseSha,
          branch: plannedAttempt.branch,
          headSha: plannedAttempt.baseSha,
          worktree: plannedAttempt.worktree
        }),
        version: workflowJournalEventVersion
      }),
      outcomeRecordKey(worktree.operationId)
    )
  }
  const appendAcceptedResponsibility = Effect.fn("FreshTaskAdmissionMBT.appendAcceptedResponsibility")(function* (
    tag: TaskTag,
    visibility: "AcceptedUnobserved" | "Visible" = "Visible"
  ) {
    const plannedAttempt = attemptFor(tag)
    const acceptedResponsibility = yield* beginPlannedAttemptExecutorResponsibility(plannedAttempt).pipe(
      Effect.provideService(InRunJournal, reducerValidInMemoryJournalFor(visibility))
    )
    const operation = latestClaimOperationFor(tag)
    if (operation === undefined) return Effect.runSync(Effect.die(`missing accepted handoff claim for ${tag}`))
    if (
      projectFreshTaskCommitments(runId, visibility === "Visible" ? visibleRecords() : records).some(
        ({ commitment }) => commitment.operation.acquisition.operationId === operation.acquisition.operationId
      )
    ) {
      return Effect.runSync(
        Effect.die(`accepted handoff did not dispose commitment ${operation.acquisition.operationId}`)
      )
    }
    return acceptedResponsibility
  })
  const handoffFreshAttempt = Effect.fn("FreshTaskAdmissionMBT.handoffFreshAttempt")(function* (tag: TaskTag) {
    const admission = yield* requireController()
    const operation = latestClaimOperationFor(tag)
    if (operation === undefined) return yield* Effect.die(`missing handoff claim operation for ${tag}`)
    const plannedAttempt = attemptFor(tag)
    const task = Option.getOrThrow(
      Option.fromUndefinedOr(graph.eligibleTasks().find(({ id }) => id === taskIdFor(tag)))
    )
    const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
      claimOperationId: operation.acquisition.operationId,
      plannedAttempt,
      specification: makeTaskWorkSpecification({ body: tag, taskId: task.id, title: tag }),
      task
    })
    const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
    const proposal = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: Result.getOrThrow(
        freshContinuationDecisionsOf(
          [{ step, transition }],
          projectFreshTaskCommitments(runId, visibleRecords()).map(({ commitment }) => commitment)
        )
      ),
      runId,
      transitions: [transition]
    }).ticketDelivery[0]
    if (proposal === undefined) return yield* Effect.die(`missing exact handoff proposal for ${tag}`)
    const result = yield* admission.tryReserve(proposal)
    if (result._tag !== "Admitted") return yield* Effect.die(`exact handoff proposal for ${tag} was deferred`)
    const acceptedResponsibility = yield* appendAcceptedResponsibility(tag)
    yield* admission.bindPlannedAttemptPosition(result.reservation, plannedAttempt, acceptedResponsibility)
    yield* admission.complete(result.reservation)
    yield* synchronize()
  })
  const commandIntentsFor = (tag: TaskTag) =>
    visibleRecords().flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.attemptId === attemptFor(tag).attemptId
        ? [event]
        : []
    )
  const commandResponsesFor = (tag: TaskTag) =>
    visibleRecords().flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
      event.plannedAttempt.attemptId === attemptFor(tag).attemptId
        ? [event]
        : []
    )
  const workReportsFor = (tag: TaskTag) =>
    visibleRecords().flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report.correlation.attemptId === attemptFor(tag).attemptId
        ? [event]
        : []
    )
  const appendCommandIntent = (tag: TaskTag, command: "Begin" | "Resume" | "Suspend") => {
    const plannedAttempt = attemptFor(tag)
    const ordinal = PlannedAttemptExecutorCommandOrdinal.make(commandIntentsFor(tag).length + 1)
    append(
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, ordinal)
    )
    return ordinal
  }
  const appendCommandResponse = (
    tag: TaskTag,
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal,
    report: PlannedAttemptExecutorReport
  ) => {
    const plannedAttempt = attemptFor(tag)
    append(
      PlannedAttemptExecutorCommandResponseObservedEvent.make({
        commandOrdinal,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        report,
        version: workflowJournalEventVersion
      }),
      plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, commandOrdinal)
    )
    const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(workReportsFor(tag).length + 1)
    append(
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: reportOrdinal,
        report,
        version: workflowJournalEventVersion
      }),
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal)
    )
  }
  const appendSafeReleaseEvidence = (tag: TaskTag) => {
    const plannedAttempt = attemptFor(tag)
    const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
    const latestIntent = commandIntentsFor(tag).at(-1)
    if (
      latestIntent === undefined ||
      commandResponsesFor(tag).some(({ commandOrdinal }) => commandOrdinal === latestIntent.ordinal)
    ) {
      const begin = appendCommandIntent(tag, "Begin")
      appendCommandResponse(tag, begin, PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
    } else {
      appendCommandResponse(
        tag,
        latestIntent.ordinal,
        PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      )
    }
    const suspend = appendCommandIntent(tag, "Suspend")
    appendCommandResponse(
      tag,
      suspend,
      PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    )
  }
  const releaseHeld = Effect.fn("FreshTaskAdmissionMBT.releaseHeld")(function* (tag: TaskTag) {
    const admission = yield* requireController()
    appendSafeReleaseEvidence(tag)
    yield* admission.releasePlannedAttemptPosition(plannedAttemptExecutorCorrelation(attemptFor(tag)))
    yield* synchronize()
  })
  const tagged = ({ task }: { readonly task: unknown }) => taskTagOf(task)
  const appendCapacityChange = (delta: -1 | 1) => {
    const policy = Option.getOrUndefined(currentReduction().runState.controlPolicy)
    if (policy === undefined) return Effect.runSync(Effect.die("cannot change an unreconstructed capacity"))
    const revision = RunPolicyRevision.make(policy.revision + 1)
    append(
      TaskWorkCapacityChangedEvent.make({
        capacity: TaskWorkCapacity.make(policy.taskExecutionCapacity + delta),
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        previousRevision: policy.revision,
        revision,
        version: workflowJournalEventVersion
      }),
      taskWorkCapacityPolicyRecordKey(revision)
    )
  }

  return {
    init: () =>
      Effect.gen(function* () {
        process = "ProcessUp"
        records = [makeWorkflowRunBeganRecord(runId, target, initialPolicy)]
        sequence = 1
        visiblePrefixLength = 1
        graphSequence = 0
        reservations.clear()
        claimCycles.clear()
        ambiguousResponsibilityTags.clear()
        currentGraphOperation = appendGraph("initial", [...taskIds.values()])
        controller = yield* makeController()
        yield* synchronize()
      }),
    reserveFreshEntryFor: (input) =>
      Effect.gen(function* () {
        const expected = tagged(input)
        if (acceptedFrontier === undefined) return yield* Effect.die("fresh candidate frontier is not synchronized")
        const result = yield* (yield* requireController()).tryReserveFresh(
          acceptedFrontier,
          deliveryProposalOfAcceptedFreshTask
        )
        if (result._tag !== "Admitted") return yield* Effect.die(`model admitted ${expected}, production deferred it`)
        const candidate = result.reservation.freshTaskCandidate
        if (candidate === null) return yield* Effect.die(`production admission for ${expected} lost its candidate`)
        const actual = tagForTaskId(candidate.taskId)
        if (actual !== expected) return yield* Effect.die(`model admitted ${expected}, production admitted ${actual}`)
        reservations.set(expected, result.reservation)
      }),
    probeFreshEntryDeferredFor: (input) =>
      Effect.gen(function* () {
        const expected = tagged(input)
        if (acceptedFrontier === undefined) return yield* Effect.die("fresh candidate frontier is not synchronized")
        const result = yield* (yield* requireController()).tryReserveFresh(
          acceptedFrontier,
          deliveryProposalOfAcceptedFreshTask
        )
        if (result._tag !== "Deferred") {
          return yield* Effect.die(`production admitted ${expected}; expected a deferred fresh-entry attempt`)
        }
        if (reservations.has(expected)) {
          return yield* Effect.die(`deferred fresh-entry attempt for ${expected} left a reservation`)
        }
        yield* assertNoOutsideFreshAdmissionWhenSelectedCommitmentsAreRetained()
      }),
    recordClaimIntentFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const reservation = reservations.get(tag)
        if (reservation === undefined) return yield* Effect.die(`missing fresh reservation for ${tag}`)
        const operation = operationFor(tag)
        yield* (yield* requireController()).bindFreshTaskClaimOperation(reservation, operation.acquisition.operationId)
        acceptClaimIntent(operation)
        yield* completeReservation(tag)
        yield* synchronize()
      }),
    loseAcceptedClaimIntentAppendResponseFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const reservation = reservations.get(tag)
        if (reservation === undefined) return yield* Effect.die(`missing fresh reservation for ${tag}`)
        const operation = operationFor(tag)
        yield* (yield* requireController()).bindFreshTaskClaimOperation(reservation, operation.acquisition.operationId)
        acceptClaimIntent(operation, "AcceptedUnobserved")
      }),
    observeClaimIntentPresentFor: (input) => {
      const tag = tagged(input)
      const operation = latestClaimOperationFor(tag)
      if (operation === undefined) return Effect.die(`missing accepted claim intent for ${tag}`)
      revealAcceptedSuffix()
      return completeReservation(tag).pipe(Effect.andThen(synchronize()))
    },
    projectAcceptedWorktreeReadyFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const operation = latestClaimOperationFor(tag)
        if (operation === undefined) return yield* Effect.die(`missing accepted claim intent for ${tag}`)
        appendAcceptedWorktreeReadyPrefix(tag, operation)
        yield* synchronize()
      }),
    projectForeignClaimRejectionFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const operation = latestClaimOperationFor(tag)
        if (operation === undefined) return yield* Effect.die(`missing claim operation for ${tag}`)
        const observed = ActiveTaskClaim.make({
          operationId: OperationId.make(`fresh-task-admission-${tag}-foreign`),
          owner: ClaimOwner.make("foreign"),
          taskId: taskIdFor(tag),
          token: ClaimToken.make(`fresh-task-admission-${tag}-foreign-token`)
        })
        append(
          TaskClaimAcquisitionRejectedEvent.make({
            observed,
            operationId: operation.acquisition.operationId,
            reason: "ForeignClaim",
            version: workflowJournalEventVersion
          }),
          outcomeRecordKey(operation.acquisition.operationId)
        )
        yield* synchronize()
        const remaining = (yield* (yield* requireController()).snapshot).positions.get(taskIdFor(tag))
        if (remaining !== undefined) {
          return yield* Effect.die(`rejected ${tag} retained production position ${remaining._tag}`)
        }
      }),
    observeForeignClaimClearedFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const rejected = latestClaimOperationFor(tag)
        if (rejected === undefined) return yield* Effect.die(`missing rejected operation for ${tag}`)
        currentGraphOperation = appendGraph(`foreign-clear-${tag}`)
        const read = makeTaskClaimObservationOperation(
          OperationId.make(`fresh-task-admission-${tag}-unclaimed-read`),
          target,
          taskIdFor(tag),
          [rejected.acquisition.operationId, currentGraphOperation.operationId]
        )
        append(taskTrackerReadIntent(read), intentRecordKey(read.operationId))
        append(
          taskTrackerFactsObservedEvent(
            read.operationId,
            makeFocusedTaskClaimFactsObserved(read, UnclaimedTask.make({ taskId: taskIdFor(tag) }))
          ),
          outcomeRecordKey(read.operationId)
        )
        yield* synchronize()
      }),
    loseAcceptedExecutorResponsibilityAppendResponseFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const operation = latestClaimOperationFor(tag)
        if (operation === undefined) return Effect.runSync(Effect.die(`missing accepted handoff claim for ${tag}`))
        yield* appendAcceptedResponsibility(tag, "AcceptedUnobserved")
      }),
    loseExecutorResponsibilityAppendResponseFor: (input) =>
      Effect.sync(() => {
        const tag = tagged(input)
        const operation = latestClaimOperationFor(tag)
        if (operation === undefined) return Effect.runSync(Effect.die(`missing accepted handoff claim for ${tag}`))
        if (
          records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
              event.plannedAttempt.taskId === taskIdFor(tag)
          )
        ) {
          return Effect.runSync(Effect.die(`responsibility append for ${tag} was not absent`))
        }
        ambiguousResponsibilityTags.add(tag)
      }),
    observeExecutorResponsibilityAppendAbsentFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        if (!ambiguousResponsibilityTags.has(tag)) {
          return yield* Effect.die(`missing ambiguous responsibility append for ${tag}`)
        }
        if (
          records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
              event.plannedAttempt.taskId === taskIdFor(tag)
          )
        ) {
          return yield* Effect.die(`responsibility append for ${tag} became present before absent observation`)
        }
        ambiguousResponsibilityTags.delete(tag)
        yield* synchronize()
      }),
    observeExecutorResponsibilityAppendPresentFor: (input) => {
      tagged(input)
      revealAcceptedSuffix()
      return synchronize()
    },
    handoffToExecutorResponsibilityFor: (input) => handoffFreshAttempt(tagged(input)),
    releaseHeldPositionNotReadyFor: (input) => releaseHeld(tagged(input)),
    releaseHeldPositionReadyFor: (input) => releaseHeld(tagged(input)),
    reserveReadyResponsibilityFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const plannedAttempt = attemptFor(tag)
        const proposal = {
          ...trackerGraphReadProposalOf({
            acceptedAt: JournalPosition.make(Math.max(sequence, 1)),
            purpose: "EstablishCurrentGraph",
            runId,
            target
          }),
          admission: {
            integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
            plannedAttemptProtocol: {
              _tag: "PlannedAttemptProtocolRequired" as const,
              correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
            },
            taskWorkPosition: {
              _tag: "TaskWorkPositionRequired" as const,
              mode: "ReserveOrReuse" as const,
              taskId: plannedAttempt.taskId
            }
          },
          id: DeliveryProposalId.make(`fresh-task-admission-ready-${tag}-${sequence}`)
        }
        const result = yield* (yield* requireController()).tryReserve(proposal)
        if (result._tag !== "Admitted") return yield* Effect.die(`ready responsibility ${tag} was deferred`)
        reservations.set(tag, result.reservation)
      }),
    handoffReadyResponsibilityFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const reservation = reservations.get(tag)
        if (reservation === undefined) return yield* Effect.die(`missing ready responsibility reservation for ${tag}`)
        const admission = yield* requireController()
        appendCommandIntent(tag, "Resume")
        yield* admission.bindPlannedAttemptPosition(reservation, attemptFor(tag))
        yield* admission.complete(reservation)
        reservations.delete(tag)
        yield* synchronize()
      }),
    contractCapacity: () => {
      appendCapacityChange(-1)
      return synchronize()
    },
    expandCapacity: () => {
      appendCapacityChange(1)
      return synchronize()
    },
    crash: () => Effect.sync(() => void (process = "ProcessDown")),
    recover: () =>
      Effect.gen(function* () {
        revealAcceptedSuffix()
        controller = yield* makeController()
        reservations.clear()
        ambiguousResponsibilityTags.clear()
        process = "ProcessUp"
        yield* synchronize()
      }),
    getState: () =>
      Effect.gen(function* () {
        const snapshot = yield* (yield* requireController()).snapshot
        return {
          capacity: BigInt(snapshot.capacity),
          occupied: [...snapshot.positions]
            .map(([taskId, position]) => {
              const task = tagForTaskId(taskId)
              const state =
                position._tag === "FreshEntryRuntimePosition"
                  ? "FreshEntryReserved"
                  : position._tag === "LocallyAcceptedAttemptPosition"
                    ? "ExactAttemptHeld"
                    : position._tag === "BoundRuntimePosition"
                      ? "ExistingResponsibilityReserved"
                      : position._tag
              if (position._tag === "BoundRuntimePosition") {
                return { attemptId: position.correlation.attemptId, runId: position.correlation.runId, state, task }
              }
              if (position._tag === "FreshTaskCommitted") {
                return { claimOperationId: position.commitment.operation.acquisition.operationId, state, task }
              }
              return position._tag === "ExistingResponsibilityReserved" ||
                position._tag === "ExactAttemptHeld" ||
                position._tag === "LocallyAcceptedAttemptPosition"
                ? { attemptId: position.plannedAttempt.attemptId, runId: position.plannedAttempt.runId, state, task }
                : { state, task }
            })
            .toSorted((left, right) => left.task.localeCompare(right.task)),
          process
        } satisfies AdmissionProjection
      })
  }
})

const freshTaskAdmissionStateCheck = stateCheck(
  projectionOfSpec,
  (spec, implementation) =>
    JSON.stringify(spec, (_, value) => (typeof value === "bigint" ? value.toString() : value)) ===
    JSON.stringify(implementation, (_, value) => (typeof value === "bigint" ? value.toString() : value))
)

const focusedConformance = (step: string, maxSteps: number) => ({
  backend: "typescript" as const,
  driverFactory: freshTaskAdmissionDriver,
  maxSamples: 1,
  maxSteps,
  nTraces: 1,
  seed: "315",
  spec: "specs/freshTaskAdmission.qnt",
  stateCheck: freshTaskAdmissionStateCheck,
  step
})

quintIt(
  it.effect,
  "reconstructs an accepted claim intent whose append response was lost",
  focusedConformance("acceptedClaimRecoveryMbtStep", 4)
)

quintIt(
  it.effect,
  "reconstructs accepted executor responsibility whose append response was lost",
  focusedConformance("acceptedResponsibilityRecoveryMbtStep", 6)
)

quintIt(
  it.effect,
  "retains the worktree commitment when an absent responsibility append is observed",
  focusedConformance("absentResponsibilityRecoveryMbtStep", 5)
)

it.effect("does not admit D or E while A-C commitments survive absent responsibility observation", () =>
  Effect.gen(function* () {
    const driver = yield* freshTaskAdmissionDriver.create()
    const action = <Name extends keyof typeof actionNames>(name: Name) =>
      Option.getOrThrowWith(Option.fromUndefinedOr(driver.actions[name]), () => new Error(`missing action ${name}`))
        .handler
    const task = (tag: TaskTag) => ({ task: tag })

    yield* action("init")({})
    for (const tag of taskTags.slice(0, 3)) {
      yield* action("reserveFreshEntryFor")(task(tag))
      yield* action("recordClaimIntentFor")(task(tag))
      yield* action("projectAcceptedWorktreeReadyFor")(task(tag))
    }
    yield* action("loseExecutorResponsibilityAppendResponseFor")(task("TaskA"))
    yield* action("observeExecutorResponsibilityAppendAbsentFor")(task("TaskA"))
    yield* action("probeFreshEntryDeferredFor")(task("TaskD"))
    yield* action("probeFreshEntryDeferredFor")(task("TaskE"))

    const getState = driver.getState
    if (getState === undefined) return yield* Effect.die("fresh admission driver must expose state")
    const state = yield* getState()
    const occupied = new Set(state.occupied.map(({ task: occupiedTask }) => occupiedTask))
    expect(occupied).toEqual(new Set(taskTags.slice(0, 3)))
    expect([...occupied].some((occupiedTask) => taskTags.slice(3).includes(occupiedTask))).toBe(false)
  })
)

quintIt(
  it.effect,
  "releases a held position from accepted safe executor evidence",
  focusedConformance("notReadyReleaseMbtStep", 6)
)

quintIt(
  it.effect,
  "rebinds a ready retained responsibility without an admission gap",
  focusedConformance("readyResponsibilityHandoffMbtStep", 8)
)

quintIt(
  it.effect,
  "keeps production admission and controller occupancy aligned with the canonical model",
  {
    backend: "typescript",
    driverFactory: freshTaskAdmissionDriver,
    maxSamples: 120,
    maxSteps: 45,
    nTraces: 120,
    seed: "315",
    spec: "specs/freshTaskAdmission.qnt",
    step: "mbtStep",
    stateCheck: freshTaskAdmissionStateCheck
  },
  180_000
)
