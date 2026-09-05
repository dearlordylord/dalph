import { it } from "@effect/vitest"
import {
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  RunId,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Cause, Context, Deferred, Effect, Fiber, Layer, Option, Queue, Ref, Stream } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import {
  ActiveTaskClaim,
  TaskClaimRequestFailure,
  UnclaimedTask,
  type TaskClaimAcquisition
} from "../../authorities/task-tracker/claim-mutation.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  AuthoritativeTaskClaimAcquired,
  AuthoritativeTaskClaimAcquisitionRejected,
  AuthoritativeTaskClaimObserved,
  WorkflowInterpreter,
  WorkflowTrace,
  type TaskClaimAcquisitionResult
} from "../../workflow/interpretation/interpreter.js"
import {
  deterministicTaskClaimAcquisitionPlannerLayer,
  TaskClaimAcquisitionPlanner
} from "../../workflow/protocols/task-claim-acquisition/plan.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  OperationIdAllocator,
  PlannedTaskAttemptPlanner
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { AuthoritativeTaskWorktreeReady } from "../../workflow/protocols/worktree-reconciliation/protocol.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import {
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey
} from "../../workflow-journal/record-key.js"
import { InRunJournal, JournalStore } from "../../workflow-journal/store.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { projectFreshTaskCommitments } from "../admission/fresh-task-admission-projection.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { type JournalState, makeJournal } from "./journal.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { DeliveryActionExecutor, type MaterializedDeliveryAction } from "./delivery-action-executor.js"
import { makeLiveDeliveryActionExecutor } from "./live-delivery-action-executor.js"
import { makeReactiveDeliveryRelationsLayer } from "./reactive-delivery-relations.js"
import {
  deliveryRuntimeResourceCapabilitiesLayer,
  deliveryRuntimeResourceCapabilitiesOf
} from "./delivery-runtime-resources.js"
import { runDeliveryRuntimePhase } from "./run-delivery-runtime.js"
import {
  PassivePlannedAttemptObserver,
  PassivePlannedAttemptProjectionPublication
} from "../run/passive-planned-attempt-observer.js"

const runId = RunId.make("fresh-admission-production-acceptance")
const target = FixtureTarget.make("fresh-admission-production-target")
const capacity = TaskWorkCapacity.make(3)
const policy = InitialControlPolicy.make({ taskExecutionCapacity: capacity })
const taskIds = ["A", "B", "C", "D", "E"].map((value) => TaskId.make(value))
const taskA = Option.getOrThrowWith(Option.fromUndefinedOr(taskIds[0]), () => new Error("missing A fixture"))
const selectedTaskIds = taskIds.slice(0, 3)

type ControlledFreshStage =
  | "ReadPostClaimGraph"
  | "ReadTaskWorkSpecification"
  | "RecordTaskAttemptPlan"
  | "ReconcileTaskWorktree"
  | "BeginPlannedAttemptExecutorWork"

const controlledFreshStages: ReadonlyArray<ControlledFreshStage> = [
  "ReadPostClaimGraph",
  "ReadTaskWorkSpecification",
  "RecordTaskAttemptPlan",
  "ReconcileTaskWorktree",
  "BeginPlannedAttemptExecutorWork"
]

interface ControlledFreshStageControl {
  readonly ready: Deferred.Deferred<void, never>
  readonly release: Deferred.Deferred<void, never>
  readonly completed: Deferred.Deferred<void, never>
}

interface ControlledFreshStageCall {
  readonly taskId: TaskId
  readonly stage: ControlledFreshStage
}

const controlledFreshStageKey = (taskId: TaskId, stage: ControlledFreshStage): string => `${taskId}:${stage}`

const makeControlledFreshStages = Effect.gen(function* () {
  const controls = new Map<string, ControlledFreshStageControl>()
  for (const taskId of taskIds) {
    for (const stage of controlledFreshStages) {
      controls.set(controlledFreshStageKey(taskId, stage), {
        ready: yield* Deferred.make<void>(),
        release: yield* Deferred.make<void>(),
        completed: yield* Deferred.make<void>()
      })
    }
  }
  return controls
})

const controlledFreshStageFor = (
  controls: ReadonlyMap<string, ControlledFreshStageControl>,
  taskId: TaskId,
  stage: ControlledFreshStage
): ControlledFreshStageControl =>
  Option.getOrThrowWith(
    Option.fromUndefinedOr(controls.get(controlledFreshStageKey(taskId, stage))),
    () => new Error(`missing controlled fresh stage ${taskId}:${stage}`)
  )

const controlledFreshStageOf = (action: MaterializedDeliveryAction): ControlledFreshStageCall | undefined => {
  const route = action.proposal.route
  if (route._tag === "FreshExecutorWorkflowRoute") {
    return { taskId: route.step.task.id, stage: "BeginPlannedAttemptExecutorWork" }
  }
  if (route._tag !== "FreshWorkflowRoute") return undefined
  return route.step._tag === "ReadPostClaimGraph" ||
    route.step._tag === "ReadTaskWorkSpecification" ||
    route.step._tag === "RecordTaskAttemptPlan" ||
    route.step._tag === "ReconcileTaskWorktree"
    ? { taskId: route.step.task.id, stage: route.step._tag }
    : undefined
}

const releaseFreshStageInOrder = Effect.fn("FreshAdmissionProductionTest.releaseStageInOrder")(function* (
  controls: ReadonlyMap<string, ControlledFreshStageControl>,
  stage: ControlledFreshStage,
  order: ReadonlyArray<number>
) {
  yield* Effect.all(
    selectedTaskIds.map((taskId) => Deferred.await(controlledFreshStageFor(controls, taskId, stage).ready)),
    { concurrency: "unbounded", discard: true }
  )
  for (const index of order) {
    const taskId = selectedTaskIds[index]
    if (taskId === undefined) return yield* Effect.die(`missing selected task at index ${index}`)
    const control = controlledFreshStageFor(controls, taskId, stage)
    yield* Deferred.succeed(control.release, undefined)
    yield* Deferred.await(control.completed)
  }
})

type ControlledFreshStageOrders = { readonly [stage in ControlledFreshStage]: ReadonlyArray<number> }

interface CausalReversalSchedule {
  readonly name: string
  readonly claimReadyOrder: ReadonlyArray<number>
  readonly stageCompletionOrders: ControlledFreshStageOrders
}

const causalReversalSchedules = [
  {
    name: "claim-CBA-graph-CAB-spec-BCA-plan-ACB-worktree-CBA-begin-BAC",
    claimReadyOrder: [2, 1, 0],
    stageCompletionOrders: {
      ReadPostClaimGraph: [2, 0, 1],
      ReadTaskWorkSpecification: [1, 2, 0],
      RecordTaskAttemptPlan: [0, 2, 1],
      ReconcileTaskWorktree: [2, 1, 0],
      BeginPlannedAttemptExecutorWork: [1, 0, 2]
    }
  },
  {
    name: "claim-BAC-graph-ACB-spec-CAB-plan-BCA-worktree-ABC-begin-CBA",
    claimReadyOrder: [1, 0, 2],
    stageCompletionOrders: {
      ReadPostClaimGraph: [0, 2, 1],
      ReadTaskWorkSpecification: [2, 0, 1],
      RecordTaskAttemptPlan: [1, 2, 0],
      ReconcileTaskWorktree: [0, 1, 2],
      BeginPlannedAttemptExecutorWork: [2, 1, 0]
    }
  },
  {
    name: "claim-ACB-graph-BAC-spec-ABC-plan-CAB-worktree-BCA-begin-ACB",
    claimReadyOrder: [0, 2, 1],
    stageCompletionOrders: {
      ReadPostClaimGraph: [1, 0, 2],
      ReadTaskWorkSpecification: [0, 1, 2],
      RecordTaskAttemptPlan: [2, 0, 1],
      ReconcileTaskWorktree: [1, 2, 0],
      BeginPlannedAttemptExecutorWork: [0, 2, 1]
    }
  }
] satisfies ReadonlyArray<CausalReversalSchedule>

const graph = (() => {
  const projection = projectTrackerSnapshot({
    revision: "fresh-admission-production-graph",
    tasks: taskIds.map((id) => ({ id, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }))
  })
  return Option.getOrThrowWith(
    Option.fromUndefinedOr(projection._tag === "Invalid" ? undefined : projection.snapshot),
    () => new Error("fresh-admission production graph fixture must be valid")
  )
})()

const currentProjection = (stateGet: Effect.Effect<JournalState>) => ({
  readDeliveryProjection: stateGet.pipe(
    Effect.map((journalState) => ({
      evidence: {
        _tag: "AvailableDeliveryProjectionEvidence" as const,
        acceptedAt: journalState.position,
        facts: [],
        integrationWaits: []
      },
      frontier: { explanations: [], transitions: [] }
    }))
  ),
  reconstructedPlannedAttemptPositions: []
})

const makeJournalService = () =>
  Effect.gen(function* () {
    const storage = yield* JournalStore
    yield* storage.beginRun(runId, target, policy)
    const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
    if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
    const journal = yield* makeJournal(runId, target, initial, storage)
    const operation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      yield* (yield* OperationIdAllocator).allocate(),
      target
    )
    yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      taskTrackerFactsObservedEvent(operation.operationId, makeCompleteTaskTrackerFactsObserved(operation, graph))
    )
    return journal
  })

type ClaimGate = Deferred.Deferred<TaskClaimAcquisitionResult, TaskClaimRequestFailure>

interface ControlledClaims {
  readonly calls: Queue.Queue<TaskClaimAcquisition>
  readonly called: Ref.Ref<ReadonlyArray<TaskClaimAcquisition>>
  readonly claimReads: Ref.Ref<ReadonlyArray<TaskId>>
  readonly gates: ReadonlyMap<TaskId, ClaimGate>
  readonly observedClaims: Ref.Ref<ReadonlyMap<TaskId, ActiveTaskClaim>>
}

const makeControlledClaims = Effect.gen(function* () {
  const calls = yield* Queue.unbounded<TaskClaimAcquisition>()
  const called = yield* Ref.make<ReadonlyArray<TaskClaimAcquisition>>([])
  const claimReads = yield* Ref.make<ReadonlyArray<TaskId>>([])
  const observedClaims = yield* Ref.make<ReadonlyMap<TaskId, ActiveTaskClaim>>(new Map())
  const gates = new Map<TaskId, ClaimGate>()
  for (const taskId of taskIds)
    gates.set(taskId, yield* Deferred.make<TaskClaimAcquisitionResult, TaskClaimRequestFailure>())
  return { calls, called, claimReads, gates, observedClaims } satisfies ControlledClaims
})

const gateFor = (claims: ControlledClaims, taskId: TaskId): ClaimGate => {
  return Option.getOrThrowWith(
    Option.fromUndefinedOr(claims.gates.get(taskId)),
    () => new Error(`missing controlled claim gate for ${taskId}`)
  )
}

const baseInterpreterLayer = (
  claims: ControlledClaims,
  completePreBegin: boolean,
  controlledStages?: ReadonlyMap<string, ControlledFreshStageControl>
) =>
  Layer.mock(WorkflowInterpreter, {
    acquireTaskClaim: (operation) =>
      Ref.update(claims.called, (current) => [...current, operation.acquisition]).pipe(
        Effect.andThen(Queue.offer(claims.calls, operation.acquisition)),
        Effect.andThen(Deferred.await(gateFor(claims, operation.acquisition.taskId)))
      ),
    readTaskClaim: (operation) =>
      Ref.update(claims.claimReads, (current) => [...current, operation.taskId]).pipe(
        Effect.andThen(Ref.get(claims.observedClaims)),
        Effect.map((current) =>
          AuthoritativeTaskClaimObserved.make({
            observation: current.get(operation.taskId) ?? UnclaimedTask.make({ taskId: operation.taskId })
          })
        )
      ),
    readTrackerGraph: (operation) => {
      const stage = operation.predecessorOperationIds.length > 0 ? "ReadPostClaimGraph" : undefined
      if (controlledStages === undefined || stage === undefined) return Effect.succeed(graph)
      const taskId = operation.readShape.explicitlyCoveredTaskIds[0]
      if (taskId === undefined) return Effect.die("post-claim graph read must name its selected task")
      const control = controlledFreshStageFor(controlledStages, taskId, stage)
      return Deferred.succeed(control.ready, undefined).pipe(
        Effect.andThen(Deferred.await(control.release)),
        Effect.as(graph)
      )
    },
    readTaskWorkSpecification: (operation) => {
      const specification = makeTaskWorkSpecification({
        body: `Implement ${operation.taskId}`,
        taskId: operation.taskId,
        title: operation.taskId
      })
      if (controlledStages === undefined) return Effect.succeed(specification)
      const control = controlledFreshStageFor(controlledStages, operation.taskId, "ReadTaskWorkSpecification")
      return Deferred.succeed(control.ready, undefined).pipe(
        Effect.andThen(Deferred.await(control.release)),
        Effect.as(specification)
      )
    },
    reconcileTaskWorktree: (operation) => {
      if (!completePreBegin)
        return Effect.die("the claim-boundary production scenario must not reach Git worktree reconciliation")
      const result = AuthoritativeTaskWorktreeReady.make({
        proof: PlannedWorktreeReady.make({
          baseSha: operation.plannedAttempt.baseSha,
          branch: operation.plannedAttempt.branch,
          headSha: operation.plannedAttempt.baseSha,
          worktree: operation.plannedAttempt.worktree
        })
      })
      if (controlledStages === undefined) return Effect.succeed(result)
      const control = controlledFreshStageFor(
        controlledStages,
        operation.plannedAttempt.taskId,
        "ReconcileTaskWorktree"
      )
      return Deferred.succeed(control.ready, undefined).pipe(
        Effect.andThen(Deferred.await(control.release)),
        Effect.as(result)
      )
    }
  })

const inertExecutor = PlannedAttemptExecutor.of({
  begin: () => Effect.die("the claim-boundary production scenario must not reach executor Begin"),
  observe: () => Effect.die("the claim-boundary production scenario must not observe an executor"),
  requestSuspension: () => Effect.die("the claim-boundary production scenario must not suspend an executor"),
  resume: () => Effect.die("the claim-boundary production scenario must not resume an executor")
})

const inertPassiveObserver = PassivePlannedAttemptObserver.of({
  attach: () => Effect.die("the claim-boundary production scenario must not attach a passive executor")
})

const inertPassivePublication = PassivePlannedAttemptProjectionPublication.of({
  publish: () => Effect.die("the claim-boundary production scenario must not publish a passive executor report"),
  publishWithPermit: () =>
    Effect.die("the claim-boundary production scenario must not publish a passive executor report")
})

const buildProductionHarness = Effect.fn("FreshAdmissionProductionTest.buildHarness")(function* (
  options: {
    readonly completePreBegin?: boolean
    readonly controlLaterStages?: boolean
    readonly failBeforeStage?: string
    readonly failTaskId?: TaskId
    readonly beginReturnsExecuting?: boolean
  } = {}
) {
  const claims = yield* makeControlledClaims
  const controlledStages = yield* makeControlledFreshStages
  const completedStages = yield* Ref.make<ReadonlyArray<ControlledFreshStageCall>>([])
  const beginCalls = yield* Queue.unbounded<TaskId>()
  const finishBegins = yield* Deferred.make<void>()
  const journal = yield* makeJournalService()
  const integrationTargets = yield* makeIntegrationTargetResourceController()
  const lifecycle = yield* makeApplicationExitLifecycle()
  const resources = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets, lifecycle.admission)
  const relationLayer = yield* makeReactiveDeliveryRelationsLayer(
    runId,
    target,
    journal,
    currentProjection(journal.state.get.pipe(Effect.orDie)),
    integrationTargets
  )
  const relationContext = yield* Layer.build(relationLayer)
  const relation = yield* deliveryRuntime.pipe(Effect.provide(relationContext))
  const journaledContext = yield* Layer.build(
    journaledWorkflowInterpreterLayer(
      runId,
      baseInterpreterLayer(
        claims,
        options.completePreBegin === true,
        options.controlLaterStages === true ? controlledStages : undefined
      )
    ).pipe(Layer.provide(Layer.succeed(InRunJournal, journal)))
  )
  const workflowInterpreter = Context.get(journaledContext, WorkflowInterpreter)
  const identityContext = yield* Layer.build(
    Layer.mergeAll(
      deterministicOperationIdAllocatorLayer("fresh-admission-production"),
      deterministicPlannedTaskAttemptLayer({
        baseSha: GitCommitSha.make("1".repeat(40)),
        executor: TaskExecutorLocator.make("executor:fresh-admission-production"),
        runId,
        worktreeRoot: WorktreeLocator.make("/fresh-admission-production")
      }),
      deterministicTaskClaimAcquisitionPlannerLayer({
        owner: ClaimOwner.make("fresh-admission-production-owner"),
        tokenPrefix: "fresh-admission-production-token"
      })
    )
  )
  const actionContext = Context.empty().pipe(
    Context.add(InRunJournal, journal),
    Context.add(OperationIdAllocator, Context.get(identityContext, OperationIdAllocator)),
    Context.add(PlannedTaskAttemptPlanner, Context.get(identityContext, PlannedTaskAttemptPlanner)),
    Context.add(TaskClaimAcquisitionPlanner, Context.get(identityContext, TaskClaimAcquisitionPlanner)),
    Context.add(WorkflowInterpreter, workflowInterpreter),
    Context.add(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Context.add(
      PlannedAttemptExecutor,
      options.completePreBegin === true
        ? PlannedAttemptExecutor.of({
            begin: ({ plannedAttempt }) =>
              Effect.gen(function* () {
                yield* Queue.offer(beginCalls, plannedAttempt.taskId)
                if (options.controlLaterStages === true) {
                  const control = controlledFreshStageFor(
                    controlledStages,
                    plannedAttempt.taskId,
                    "BeginPlannedAttemptExecutorWork"
                  )
                  yield* Deferred.succeed(control.ready, undefined)
                  yield* Deferred.await(control.release)
                }
                if (options.beginReturnsExecuting === true) {
                  return PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
                    correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
                  })
                }
                return yield* Deferred.await(finishBegins).pipe(
                  Effect.andThen(Effect.die("controlled stop after every admitted task reached Begin"))
                )
              }),
            observe: () => Effect.die("the pre-Begin production scenario does not observe an executor"),
            requestSuspension: () => Effect.die("the pre-Begin production scenario does not suspend an executor"),
            resume: () => Effect.die("the pre-Begin production scenario does not resume an executor")
          })
        : inertExecutor
    ),
    Context.add(
      PassivePlannedAttemptObserver,
      options.completePreBegin === true
        ? PassivePlannedAttemptObserver.of({
            attach: ({ plannedAttempt }) => {
              const correlation = { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
              return Effect.succeed({
                acceptedFacts: "UnchangedPassiveObservation" as const,
                report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
              })
            }
          })
        : inertPassiveObserver
    ),
    Context.add(PassivePlannedAttemptProjectionPublication, inertPassivePublication)
  )
  const liveExecutor = yield* makeLiveDeliveryActionExecutor(runId, target).pipe(Effect.provide(actionContext))
  const crossed = yield* Ref.make<ReadonlyArray<MaterializedDeliveryAction>>([])
  const crossedQueue = yield* Queue.unbounded<MaterializedDeliveryAction>()
  const outsideBoundary = yield* Queue.unbounded<TaskId>()
  const executor = DeliveryActionExecutor.of({
    execute: (action, lease) =>
      Effect.gen(function* () {
        yield* Ref.update(crossed, (current) => [...current, action])
        yield* Queue.offer(crossedQueue, action)
        const taskWork = action.proposal.admission.taskWorkPosition
        const taskId = "step" in action.proposal.route ? action.proposal.route.step.task.id : undefined
        const outsideTaskId =
          taskId === taskIds[3] || taskId === taskIds[4]
            ? taskId
            : taskWork._tag === "TaskWorkPositionRequired" &&
                (taskWork.taskId === taskIds[3] || taskWork.taskId === taskIds[4])
              ? taskWork.taskId
              : undefined
        if (outsideTaskId !== undefined) yield* Queue.offer(outsideBoundary, outsideTaskId)
        if (
          "step" in action.proposal.route &&
          action.proposal.route.step._tag === options.failBeforeStage &&
          action.proposal.route.step.task.id === (options.failTaskId ?? taskA)
        ) {
          return yield* Effect.die(`controlled failure before ${options.failBeforeStage}`)
        }
        const result = yield* liveExecutor.execute(action, lease)
        const stage = options.controlLaterStages === true ? controlledFreshStageOf(action) : undefined
        if (stage !== undefined) {
          const control = controlledFreshStageFor(controlledStages, stage.taskId, stage.stage)
          yield* Deferred.succeed(control.ready, undefined)
          yield* Deferred.await(control.release)
          yield* Ref.update(completedStages, (current) => [...current, stage])
          yield* Deferred.succeed(control.completed, undefined)
        }
        return result
      })
  })
  const runtime = runDeliveryRuntimePhase(runId, relation).pipe(
    Effect.provide(relationContext),
    Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(resources)),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provideService(OperationIdAllocator, Context.get(identityContext, OperationIdAllocator)),
    Effect.provideService(PlannedTaskAttemptPlanner, Context.get(identityContext, PlannedTaskAttemptPlanner)),
    Effect.provideService(DeliveryActionExecutor, executor)
  )
  return {
    beginCalls,
    claims,
    completedStages,
    controlledStages,
    crossed,
    crossedQueue,
    finishBegins,
    journal,
    outsideBoundary,
    relation,
    runtime
  }
})

const takeClaimCalls = Effect.fn("FreshAdmissionProductionTest.takeClaimCalls")(function* (
  claims: ControlledClaims,
  count: number
) {
  return yield* Effect.forEach(Array.from({ length: count }), () => Queue.take(claims.calls))
})

const acquiredResult = (acquisition: TaskClaimAcquisition): TaskClaimAcquisitionResult =>
  AuthoritativeTaskClaimAcquired.make({ claim: ActiveTaskClaim.make(acquisition) })

const awaitClaimAcquired = Effect.fn("FreshAdmissionProductionTest.awaitClaimAcquired")(function* (
  journal: Effect.Success<ReturnType<typeof makeJournalService>>,
  operationId: TaskClaimAcquisition["operationId"]
) {
  const accepted = (state: JournalState) =>
    state.records.some(({ event }) => event._tag === "TaskClaimAcquired" && event.claim.operationId === operationId)
  const current = yield* journal.state.get
  if (accepted(current)) return
  const observed = yield* journal.state.changes.pipe(Stream.filter(accepted), Stream.runHead)
  if (Option.isNone(observed)) return yield* Effect.die(`Journal closed before accepting claim ${operationId}`)
})

const awaitInitialClaims = Effect.fn("FreshAdmissionProductionTest.awaitInitialClaims")(function* (
  harness: Effect.Success<ReturnType<typeof buildProductionHarness>>
) {
  const admission = yield* Effect.race(
    takeClaimCalls(harness.claims, 3).pipe(Effect.map((calls) => ({ _tag: "ThreeClaims" as const, calls }))),
    Queue.take(harness.outsideBoundary).pipe(Effect.map((taskId) => ({ _tag: "OutsideBoundary" as const, taskId })))
  )
  if (admission._tag === "OutsideBoundary") {
    return yield* Effect.die(`outside task ${admission.taskId} crossed an operation boundary before A-C claimed`)
  }
  expect(new Set(admission.calls.map(({ taskId }) => taskId))).toEqual(new Set(selectedTaskIds))
  return admission.calls
})

it.effect("admits only A, B, and C from the complete A-E production frontier across response permutations", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* buildProductionHarness()
      const initial = yield* harness.relation.get
      if (initial.proposedActions._tag === "DeliveryProposalsAvailable") {
        expect(initial.proposedActions.freshTaskCandidates.map(({ taskId }) => taskId)).toEqual(taskIds)
      }
      const runtime = yield* harness.runtime.pipe(Effect.forkChild)
      const firstActions = yield* Effect.forEach(Array.from({ length: 3 }), () => Queue.take(harness.crossedQueue))
      expect(firstActions.map(({ proposal }) => proposal.admission.taskWorkPosition)).toMatchObject(
        taskIds.slice(0, 3).map((taskId) => ({ _tag: "TaskWorkPositionRequired", taskId }))
      )
      const calls = yield* awaitInitialClaims(harness)

      for (const taskId of [taskIds[2], taskIds[0], taskIds[1]]) {
        if (taskId === undefined) return yield* Effect.die("A-C fixture must be present")
        const acquisition = calls.find((candidate) => candidate.taskId === taskId)
        if (acquisition === undefined) return yield* Effect.die(`missing acquisition for ${taskId}`)
        yield* Deferred.succeed(gateFor(harness.claims, taskId), acquiredResult(acquisition))
        yield* awaitClaimAcquired(harness.journal, acquisition.operationId)
      }

      yield* Effect.yieldNow
      const records = yield* harness.journal.read(runId)
      const acquired = records.flatMap(({ event }) => (event._tag === "TaskClaimAcquired" ? [event.claim] : []))
      expect(acquired.map(({ taskId }) => taskId)).toEqual([taskIds[2], taskIds[0], taskIds[1]])
      expect(
        acquired.every((claim) => calls.some((call) => ActiveTaskClaim.make(call).operationId === claim.operationId))
      ).toBe(true)
      expect((yield* Ref.get(harness.claims.called)).map(({ taskId }) => taskId)).toEqual(taskIds.slice(0, 3))
      const crossedTasks = (yield* Ref.get(harness.crossed)).flatMap(({ proposal }) =>
        proposal.admission.taskWorkPosition._tag === "TaskWorkPositionRequired"
          ? [proposal.admission.taskWorkPosition.taskId]
          : []
      )
      expect(crossedTasks).not.toContain(taskIds[3])
      expect(crossedTasks).not.toContain(taskIds[4])
      yield* Fiber.interrupt(runtime)
    }).pipe(
      Effect.provide(deterministicOperationIdAllocatorLayer("fresh-admission-production-bootstrap")),
      Effect.provide(memoryJournalStoreLayer)
    )
  )
)

it.effect("preserves the admitted A-C set across every claim-response readiness order", () =>
  Effect.gen(function* () {
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0]
    ] as const
    for (const order of permutations) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* buildProductionHarness()
          const runtime = yield* harness.runtime.pipe(Effect.forkChild)
          const calls = yield* awaitInitialClaims(harness)
          for (const index of order) {
            const acquisition = calls.find(({ taskId }) => taskId === taskIds[index])
            if (acquisition === undefined) return yield* Effect.die(`missing acquisition at index ${index}`)
            yield* Deferred.succeed(gateFor(harness.claims, acquisition.taskId), acquiredResult(acquisition))
            yield* awaitClaimAcquired(harness.journal, acquisition.operationId)
          }
          expect(new Set((yield* Ref.get(harness.claims.called)).map(({ taskId }) => taskId))).toEqual(
            new Set(taskIds.slice(0, 3))
          )
          expect(yield* Queue.size(harness.outsideBoundary)).toBe(0)
          yield* Fiber.interrupt(runtime)
        }).pipe(
          Effect.provide(deterministicOperationIdAllocatorLayer(`fresh-admission-permutation-${order.join("")}`)),
          Effect.provide(memoryJournalStoreLayer)
        )
      )
    }
  })
)

it.effect("keeps D and E outside every production boundary while A, B, and C reach journal-first Begin", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* buildProductionHarness({ completePreBegin: true })
      const runtime = yield* harness.runtime.pipe(Effect.forkChild)
      const calls = yield* awaitInitialClaims(harness)

      for (const taskId of [taskIds[1], taskIds[2], taskIds[0]]) {
        if (taskId === undefined) return yield* Effect.die("A-C fixture must be present")
        const acquisition = calls.find((candidate) => candidate.taskId === taskId)
        if (acquisition === undefined) return yield* Effect.die(`missing acquisition for ${taskId}`)
        yield* Deferred.succeed(gateFor(harness.claims, taskId), acquiredResult(acquisition))
      }

      const reachedBegin = yield* Effect.race(
        Effect.forEach(Array.from({ length: 3 }), () => Queue.take(harness.beginCalls)),
        Effect.race(
          Queue.take(harness.outsideBoundary).pipe(
            Effect.flatMap((taskId) => Effect.die(`outside task ${taskId} crossed before A-C reached Begin`))
          ),
          Fiber.await(runtime).pipe(
            Effect.flatMap((exit) =>
              exit._tag === "Failure"
                ? Effect.die(`runtime failed before A-C reached Begin: ${Cause.pretty(exit.cause)}`)
                : Effect.die("runtime completed before A-C reached Begin")
            )
          )
        )
      )
      expect(new Set(reachedBegin)).toEqual(new Set(taskIds.slice(0, 3)))

      const crossed = yield* Ref.get(harness.crossed)
      const expectedStages = [
        "ReadCurrentTaskGraph",
        "AcquireTaskClaim",
        "ReadPostClaimGraph",
        "ReadTaskWorkSpecification",
        "RecordTaskAttemptPlan",
        "ReconcileTaskWorktree",
        "BeginPlannedAttemptExecutorWork"
      ]
      for (const taskId of taskIds.slice(0, 3)) {
        const stages = crossed.flatMap(({ proposal }) => {
          const route = proposal.route
          return "step" in route && route.step.task.id === taskId ? [route.step._tag] : []
        })
        expect(stages).toEqual(expectedStages)
      }
      for (const taskId of taskIds.slice(3)) {
        expect(crossed.some(({ proposal }) => "step" in proposal.route && proposal.route.step.task.id === taskId)).toBe(
          false
        )
      }

      const records = yield* harness.journal.read(runId)
      for (const taskId of taskIds.slice(0, 3)) {
        expect(
          records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === taskId
          )
        ).toBe(true)
      }
      expect(
        records.some(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
            taskIds.slice(3).includes(event.plannedAttempt.taskId)
        )
      ).toBe(false)
      yield* Deferred.succeed(harness.finishBegins, undefined)
      expect((yield* Fiber.await(runtime))._tag).toBe("Failure")
    }).pipe(
      Effect.provide(deterministicOperationIdAllocatorLayer("fresh-admission-pre-begin-bootstrap")),
      Effect.provide(memoryJournalStoreLayer)
    )
  )
)

it.effect("retains A-C through independently reversed post-claim production stages", () =>
  Effect.gen(function* () {
    for (const schedule of causalReversalSchedules) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* buildProductionHarness({
            completePreBegin: true,
            controlLaterStages: true,
            beginReturnsExecuting: true
          })
          const runtime = yield* harness.runtime.pipe(Effect.forkChild)
          const calls = yield* awaitInitialClaims(harness)
          const stageDriver = yield* Effect.all(
            controlledFreshStages.map((stage) =>
              releaseFreshStageInOrder(harness.controlledStages, stage, schedule.stageCompletionOrders[stage])
            ),
            { concurrency: "unbounded" }
          ).pipe(Effect.forkChild)

          for (const index of schedule.claimReadyOrder) {
            const taskId = selectedTaskIds[index]
            if (taskId === undefined) return yield* Effect.die(`missing selected claim task at index ${index}`)
            const acquisition = calls.find((candidate) => candidate.taskId === taskId)
            if (acquisition === undefined) return yield* Effect.die(`missing acquisition for ${taskId}`)
            yield* Deferred.succeed(gateFor(harness.claims, taskId), acquiredResult(acquisition))
            yield* awaitClaimAcquired(harness.journal, acquisition.operationId)
          }

          const stageExit = yield* Fiber.await(stageDriver)
          expect(stageExit._tag, `${schedule.name}: every controlled stage must complete`).toBe("Success")
          if (stageExit._tag !== "Success") return yield* Effect.die(`schedule failed: ${schedule.name}`)

          const completed = yield* Ref.get(harness.completedStages)
          for (const stage of controlledFreshStages) {
            const completedTaskIds = completed
              .filter(({ stage: completedStage }) => completedStage === stage)
              .map(({ taskId }) => taskId)
            const expectedTaskIds = schedule.stageCompletionOrders[stage].flatMap((index) => {
              const taskId = selectedTaskIds[index]
              return taskId === undefined ? [] : [taskId]
            })
            expect(completedTaskIds, `${schedule.name}: ${stage} completion reversal`).toEqual(expectedTaskIds)
            expect(new Set(completedTaskIds), `${schedule.name}: ${stage} identities`).toEqual(new Set(selectedTaskIds))
          }

          const called = yield* Ref.get(harness.claims.called)
          const calledTaskIds = called.map(({ taskId }) => taskId)
          expect(new Set(calledTaskIds), `${schedule.name}: claim identities`).toEqual(new Set(selectedTaskIds))
          for (const taskId of selectedTaskIds) {
            expect(calledTaskIds.filter((calledTaskId) => calledTaskId === taskId)).toHaveLength(1)
          }
          expect(yield* Queue.size(harness.outsideBoundary), `${schedule.name}: outside boundary count`).toBe(0)
          expect(new Set(yield* Queue.takeAll(harness.beginCalls)), `${schedule.name}: Begin identities`).toEqual(
            new Set(selectedTaskIds)
          )

          const records = yield* harness.journal.read(runId)
          const plans = records.flatMap(({ event }) =>
            event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt.taskId] : []
          )
          expect(new Set(plans), `${schedule.name}: planned task identities`).toEqual(new Set(selectedTaskIds))
          const worktreeIntents = records.flatMap(({ event }) =>
            event._tag === "TaskWorktreeReconciliationIntended" ? [event.operation.plannedAttempt.taskId] : []
          )
          expect(new Set(worktreeIntents), `${schedule.name}: worktree task identities`).toEqual(
            new Set(selectedTaskIds)
          )
          const readyOperationIds = new Set(
            records.flatMap(({ event }) => (event._tag === "TaskWorktreeReady" ? [event.operationId] : []))
          )
          for (const taskId of selectedTaskIds) {
            const worktreeIntent = records.find(
              ({ event }) =>
                event._tag === "TaskWorktreeReconciliationIntended" && event.operation.plannedAttempt.taskId === taskId
            )
            if (worktreeIntent?.event._tag !== "TaskWorktreeReconciliationIntended") {
              return yield* Effect.die(`worktree intent must exist for ${taskId}`)
            }
            expect(readyOperationIds.has(worktreeIntent.event.operation.operationId)).toBe(true)
          }
          const responsibilities = records.flatMap(({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ? [event.plannedAttempt.taskId] : []
          )
          expect(new Set(responsibilities), `${schedule.name}: responsibility identities`).toEqual(
            new Set(selectedTaskIds)
          )
          for (const taskId of selectedTaskIds) {
            const responsibility = records.find(
              ({ event }) =>
                event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === taskId
            )
            const beginIntent = records.find(
              ({ event }) =>
                event._tag === "PlannedAttemptExecutorCommandIntended" &&
                event.command === "Begin" &&
                event.plannedAttempt.taskId === taskId
            )
            if (responsibility === undefined || beginIntent === undefined) {
              return yield* Effect.die(`responsibility and Begin must exist for ${taskId}`)
            }
            expect(responsibility.position).toBeLessThan(beginIntent.position)
          }

          const crossedTasks = (yield* Ref.get(harness.crossed)).flatMap(({ proposal }) => {
            const route = proposal.route
            if (route._tag === "FreshWorkflowRoute") return [route.step.task.id]
            if (route._tag === "FreshExecutorWorkflowRoute") return [route.step.task.id]
            return []
          })
          expect(crossedTasks.every((taskId) => selectedTaskIds.includes(taskId))).toBe(true)
          yield* Fiber.interrupt(runtime)
        }).pipe(
          Effect.provide(deterministicOperationIdAllocatorLayer(`fresh-admission-causal-${schedule.name}`)),
          Effect.provide(memoryJournalStoreLayer)
        )
      )
    }
  })
)

it.effect("retains A-C admission when a later pre-Begin production stage fails", () =>
  Effect.gen(function* () {
    for (const stage of [
      "ReadPostClaimGraph",
      "ReadTaskWorkSpecification",
      "RecordTaskAttemptPlan",
      "ReconcileTaskWorktree"
    ]) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* buildProductionHarness({
            completePreBegin: true,
            failBeforeStage: stage,
            failTaskId: taskA
          })
          const runtime = yield* harness.runtime.pipe(Effect.forkChild)
          const calls = yield* awaitInitialClaims(harness)
          for (const acquisition of calls) {
            yield* Deferred.succeed(gateFor(harness.claims, acquisition.taskId), acquiredResult(acquisition))
          }

          expect((yield* Fiber.await(runtime))._tag).toBe("Failure")
          expect(yield* Queue.size(harness.outsideBoundary)).toBe(0)
          const records = yield* harness.journal.read(runId)
          expect(
            projectFreshTaskCommitments(runId, records)
              .map(({ commitment }) => commitment.operation.acquisition.taskId)
              .toSorted()
          ).toEqual(taskIds.slice(0, 3))
          expect(
            (yield* Ref.get(harness.crossed)).some(
              ({ proposal }) => "step" in proposal.route && taskIds.slice(3).includes(proposal.route.step.task.id)
            )
          ).toBe(false)
        }).pipe(
          Effect.provide(deterministicOperationIdAllocatorLayer(`fresh-admission-failure-${stage}`)),
          Effect.provide(memoryJournalStoreLayer)
        )
      )
    }
  })
)

it.effect("admits D alone after B returns Safe or Terminal while A and C remain occupied", () =>
  Effect.gen(function* () {
    const b = taskIds[1]
    const d = taskIds[3]
    if (b === undefined || d === undefined) return yield* Effect.die("B and D fixtures must be present")
    for (const reportTag of ["Safe", "Terminal"] as const) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* buildProductionHarness({ completePreBegin: true, beginReturnsExecuting: true })
          const runtime = yield* harness.runtime.pipe(Effect.forkChild)
          const calls = yield* awaitInitialClaims(harness)
          for (const acquisition of calls) {
            yield* Deferred.succeed(gateFor(harness.claims, acquisition.taskId), acquiredResult(acquisition))
          }

          const initialBegins = yield* Effect.forEach(Array.from({ length: 3 }), () => Queue.take(harness.beginCalls))
          expect(new Set(initialBegins)).toEqual(new Set(taskIds.slice(0, 3)))
          const records = yield* harness.journal.read(runId)
          const responsibility = records.find(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === b
          )?.event
          if (responsibility?._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan") {
            return yield* Effect.die("B responsibility must precede its release evidence")
          }
          const plannedAttempt = responsibility.plannedAttempt
          const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
          const report =
            reportTag === "Safe"
              ? PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
              : PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                  correlation,
                  result: { _tag: "Completed" }
                })
          if (reportTag === "Safe") {
            const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
            yield* harness.journal.append(
              runId,
              plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
              PlannedAttemptExecutorCommandIntendedEvent.make({
                command: "Suspend",
                initiatedBy: { _tag: "DalphCoordinator" },
                occurrenceClassification: "InitiatedAction",
                ordinal: commandOrdinal,
                plannedAttempt,
                version: workflowJournalEventVersion
              })
            )
            yield* harness.journal.append(
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
          } else {
            const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
            yield* harness.journal.append(
              runId,
              plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal),
              PlannedAttemptExecutorStateObservedEvent.make({
                observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report }),
                occurrenceClassification: "NonActionOccurrence",
                ordinal: observationOrdinal,
                plannedAttempt,
                version: workflowJournalEventVersion
              })
            )
          }
          const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
          yield* harness.journal.append(
            runId,
            plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
            PlannedAttemptExecutorWorkReportedEvent.make({
              ordinal: reportOrdinal,
              report,
              version: workflowJournalEventVersion
            })
          )

          const admittedAfterRelease = yield* Effect.race(
            Queue.take(harness.outsideBoundary),
            Fiber.await(runtime).pipe(
              Effect.flatMap((exit) =>
                exit._tag === "Failure"
                  ? Effect.die(`runtime failed before D entered: ${Cause.pretty(exit.cause)}`)
                  : Effect.die(`runtime returned ${exit.value._tag} before D entered`)
              )
            )
          )
          expect(admittedAfterRelease).toBe(d)
          const dAcquisition = yield* Queue.take(harness.claims.calls)
          expect(dAcquisition.taskId).toBe(d)
          yield* Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, { discard: true })
          expect(Array.from(yield* Queue.takeAll(harness.outsideBoundary)).every((taskId) => taskId === d)).toBe(true)
          expect((yield* Ref.get(harness.claims.called)).map(({ taskId }) => taskId)).toEqual([
            ...taskIds.slice(0, 3),
            d
          ])

          yield* Deferred.fail(
            gateFor(harness.claims, d),
            new TaskClaimRequestFailure({
              acquisition: dAcquisition,
              detail: "controlled stop after proving D admission",
              outcome: "Unknown"
            })
          )
          yield* Deferred.succeed(harness.finishBegins, undefined)
          expect((yield* Fiber.await(runtime))._tag).toBe("Failure")
        }).pipe(
          Effect.provide(deterministicOperationIdAllocatorLayer(`fresh-admission-release-${reportTag}`)),
          Effect.provide(memoryJournalStoreLayer)
        )
      )
    }
  })
)

it.effect("settles A's foreign claim rejection task-locally and admits D alone while B and C continue", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* buildProductionHarness()
      const runtime = yield* harness.runtime.pipe(Effect.forkChild)
      const calls = yield* awaitInitialClaims(harness)
      const a = calls.find(({ taskId }) => taskId === taskIds[0])
      if (a === undefined) return yield* Effect.die("A claim call must be present")
      const foreign = ActiveTaskClaim.make({
        operationId: a.operationId,
        owner: ClaimOwner.make("foreign-owner"),
        taskId: a.taskId,
        token: ClaimToken.make("foreign-token")
      })
      yield* Ref.set(harness.claims.observedClaims, new Map([[a.taskId, foreign]]))
      yield* Deferred.succeed(
        gateFor(harness.claims, a.taskId),
        AuthoritativeTaskClaimAcquisitionRejected.make({ observed: foreign })
      )

      expect(yield* Queue.take(harness.outsideBoundary)).toBe(taskIds[3])
      const d = yield* Queue.take(harness.claims.calls)
      expect(d.taskId).toBe(taskIds[3])
      yield* Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, { discard: true })

      const called = yield* Ref.get(harness.claims.called)
      expect(called.map(({ taskId }) => taskId)).toEqual([taskIds[0], taskIds[1], taskIds[2], taskIds[3]])
      expect(called.filter(({ taskId }) => taskId === taskIds[0])).toHaveLength(1)
      expect(yield* Ref.get(harness.claims.claimReads)).toEqual([taskIds[0]])
      const records = yield* harness.journal.read(runId)
      expect(
        records.some(
          ({ event }) =>
            event._tag === "TaskClaimAcquisitionRejected" &&
            event.operationId === a.operationId &&
            event.observed.owner === foreign.owner &&
            event.observed.token === foreign.token
        )
      ).toBe(true)
      expect(records.some(({ event }) => event._tag === "TaskClaimAcquired" && event.claim.taskId === a.taskId)).toBe(
        false
      )
      expect(records.some(({ event }) => event._tag === "TaskClaimReleaseIntended")).toBe(false)
      expect(runtime.pollUnsafe()).toBeUndefined()
      yield* Fiber.interrupt(runtime)
    }).pipe(
      Effect.provide(deterministicOperationIdAllocatorLayer("fresh-admission-foreign-bootstrap")),
      Effect.provide(memoryJournalStoreLayer)
    )
  )
)

it.effect("retains A after an ambiguous claim-provider failure and does not admit D", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* buildProductionHarness()
      const runtime = yield* harness.runtime.pipe(Effect.forkChild)
      const calls = yield* awaitInitialClaims(harness)
      const a = calls.find(({ taskId }) => taskId === taskIds[0])
      if (a === undefined) return yield* Effect.die("A claim call must be present")
      yield* Deferred.fail(
        gateFor(harness.claims, a.taskId),
        new TaskClaimRequestFailure({
          acquisition: a,
          detail: "controlled unknown provider outcome",
          outcome: "Unknown"
        })
      )

      const exit = yield* Fiber.await(runtime)
      expect(exit._tag).toBe("Failure")
      if (exit._tag !== "Failure") return yield* Effect.die("ambiguous provider failure must fail closed")
      const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause))
      expect(failure).toBeInstanceOf(TaskClaimRequestFailure)
      if (!(failure instanceof TaskClaimRequestFailure)) return yield* Effect.die("expected typed claim failure")
      expect(failure.detail).toBe("controlled unknown provider outcome")
      expect(yield* Queue.size(harness.outsideBoundary)).toBe(0)
      expect((yield* Ref.get(harness.claims.called)).map(({ taskId }) => taskId)).toEqual(taskIds.slice(0, 3))

      const records = yield* harness.journal.read(runId)
      expect(
        records.some(
          ({ event }) =>
            event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.operationId === a.operationId
        )
      ).toBe(true)
      expect(
        records.some(
          ({ event }) =>
            (event._tag === "TaskClaimAcquired" && event.claim.operationId === a.operationId) ||
            (event._tag === "TaskClaimAcquisitionRejected" && event.operationId === a.operationId)
        )
      ).toBe(false)
      expect(
        projectFreshTaskCommitments(runId, records).map(({ commitment }) => commitment.operation.acquisition.taskId)
      ).toEqual(taskIds.slice(0, 3))
    }).pipe(
      Effect.provide(deterministicOperationIdAllocatorLayer("fresh-admission-ambiguous-bootstrap")),
      Effect.provide(memoryJournalStoreLayer)
    )
  )
)
