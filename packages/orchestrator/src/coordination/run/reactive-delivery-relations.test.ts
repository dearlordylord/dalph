import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  IntegrationTarget,
  IntegrationTargetRef,
  GitRepositoryLocator,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  makeTaskWorkSpecification,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Deferred, Effect, Exit, Fiber, Layer, Option, Ref, Scope } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import { taskTrackerReadIntent, TaskAttemptPlannedEvent } from "../../workflow/registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  TaskTrackerFactsReadFailed,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../../workflow/protocols/task-tracker-read/protocol.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { OperationId } from "../../workflow/identity.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { JournalStore, InRunJournal } from "../../workflow-journal/store.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { makeRunRecoveryProjection } from "./recovery-activation.js"
import { makeReactiveDeliveryRelationsLayer } from "../delivery/reactive-delivery-relations.js"
import { deliveryRuntime } from "../delivery/delivery-runtime-adapter.js"
import { makeJournal } from "../delivery/journal.js"
import { DeliveryAcceptedFactPublication } from "../delivery/delivery-accepted-fact-publication.js"
import { DeliveryActionExecutor, type DeliveryActionResult } from "../delivery/delivery-action-executor.js"
import { executeFreshTrackerGraphRead } from "../delivery/delivery-action-adapter-common.js"
import { runDeliveryRuntime } from "../delivery/run-delivery-runtime.js"
import {
  deliveryRuntimeResourceCapabilitiesLayer,
  deliveryRuntimeResourceCapabilitiesOf
} from "../delivery/delivery-runtime-resources.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { PlannedAttemptExecutorContinuationLimitReached } from "../../workflow/protocols/planned-attempt-executor-work/errors.js"
import { continuePlannedAttemptExecutorWork } from "../../workflow/protocols/planned-attempt-executor-work/guarded-protocol.js"
import { executePlannedAttemptTransition } from "../delivery/planned-attempt-delivery-action-adapter.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"

const runId = RunId.make("reactive-progress-runtime-acceptance")
const target = FixtureTarget.make("reactive-progress-runtime-acceptance-target")
const integrationTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/reactive-progress-runtime-acceptance.git")
})
const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(3) })
const taskIds = [TaskId.make("A"), TaskId.make("B"), TaskId.make("C")] as const
const specificationFor = (taskId: TaskId) =>
  makeTaskWorkSpecification({ body: `Reactive progress ${taskId}`, taskId, title: `Reactive progress ${taskId}` })

const attempts = new Map(
  taskIds.map((taskId) => [
    taskId,
    PlannedTaskAttempt.make({
      attemptId: AttemptId.make(`reactive-progress-${taskId}`),
      baseSha: GitCommitSha.make("1".repeat(40)),
      branch: TaskBranchRef.make(`refs/heads/dalph/reactive-progress-${taskId}`),
      executor: TaskExecutorLocator.make(`executor:reactive-progress-${taskId}`),
      runId,
      taskId,
      taskRevision: specificationFor(taskId).fingerprint,
      worktree: WorktreeLocator.make(`/worktrees/reactive-progress-${taskId}`)
    })
  ])
)

const graphSnapshotFor = Effect.fn("ReactiveProgressAcceptance.graphSnapshotFor")(function* (revision: string) {
  const projected = projectTrackerSnapshot({
    revision,
    tasks: taskIds.map((id) => ({ id, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }))
  })
  if (projected._tag === "Invalid") return yield* Effect.die(projected)
  return projected.snapshot
})

const makeJournalService = Effect.gen(function* () {
  const storage = yield* JournalStore
  yield* storage.beginRun(runId, target, policy)
  const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  return yield* makeJournal(runId, target, initial, storage)
})

const makeRestartJournalService = Effect.gen(function* () {
  const storage = yield* JournalStore
  const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  return yield* makeJournal(runId, target, initial, storage)
})

const appendGraph = Effect.fn("ReactiveProgressAcceptance.appendGraph")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  operationId: OperationId,
  revision: string
) {
  const operation = makeTrackerGraphObservationOperation(operationId, target, [], [...taskIds])
  const snapshot = yield* graphSnapshotFor(revision)
  yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
  yield* journal.append(
    runId,
    outcomeRecordKey(operation.operationId),
    taskTrackerFactsObservedEvent(operation.operationId, makeCompleteTaskTrackerFactsObserved(operation, snapshot))
  )
})

const appendResponsibility = Effect.fn("ReactiveProgressAcceptance.appendResponsibility")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  taskId: TaskId
) {
  const plannedAttempt = Option.getOrThrow(Option.fromUndefinedOr(attempts.get(taskId)))
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make(`reactive-progress-plan-${taskId}`),
    plannedAttempt,
    predecessorOperationIds: []
  })
  yield* journal.append(
    runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
})

const appendRunning = Effect.fn("ReactiveProgressAcceptance.appendRunning")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  taskId: TaskId,
  commandOrdinalValue: number,
  reportOrdinalValue: number
) {
  const plannedAttempt = Option.getOrThrow(Option.fromUndefinedOr(attempts.get(taskId)))
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(commandOrdinalValue)
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
  const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(reportOrdinalValue)
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: reportOrdinal,
      report: PlannedAttemptExecutorReport.cases.Running.make({
        correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
      }),
      version: workflowJournalEventVersion
    })
  )
})

/**
 * The acceptance runtime owns admission and scheduling, while this helper
 * keeps tracker authority controlled at the provider edge. The journaled
 * interpreter is production code: it records the read intent before this
 * provider is called and records the accepted observation afterward.
 */
const makeTrackerGraphActionExecutor = Effect.fn("ReactiveProgressAcceptance.makeTrackerGraphActionExecutor")(
  function* (
    journal: Effect.Success<typeof makeJournalService>,
    publication: DeliveryAcceptedFactPublication["Service"],
    readTrackerGraph: WorkflowInterpreter["Service"]["readTrackerGraph"]
  ) {
    const interpreter = yield* WorkflowInterpreter.pipe(
      Effect.provide(
        journaledWorkflowInterpreterLayer(
          runId,
          Layer.succeed(
            WorkflowInterpreter,
            WorkflowInterpreter.of({
              acquireTaskClaim: () => Effect.die("reactive progress acceptance does not read claims"),
              readTaskClaim: () => Effect.die("reactive progress acceptance does not read claims"),
              readTaskWorktree: () => Effect.die("reactive progress acceptance does not read worktrees"),
              readTargetLineage: () => Effect.die("reactive progress acceptance does not read target lineage"),
              readTrackerGraph,
              readTaskWorkSpecification: () => Effect.die("reactive progress acceptance does not read specifications"),
              reconcileTaskWorktree: () => Effect.die("reactive progress acceptance does not reconcile worktrees"),
              recordTaskAttemptPlan: () => Effect.die("reactive progress acceptance does not record plans"),
              releaseTaskClaim: () => Effect.die("reactive progress acceptance does not release claims")
            })
          )
        ).pipe(Layer.provide(Layer.succeed(InRunJournal, journal)))
      )
    )
    const trace = WorkflowTrace.of({ emit: () => Effect.void })
    return DeliveryActionExecutor.of({
      execute: (action, lease) => {
        const route = action.proposal.route
        if (action._tag === "FreshOperationAction" && route._tag === "TrackerGraphReadRoute") {
          return executeFreshTrackerGraphRead(action, route, lease).pipe(
            Effect.provideService(WorkflowInterpreter, interpreter),
            Effect.provideService(WorkflowTrace, trace),
            Effect.provideService(DeliveryAcceptedFactPublication, publication),
            Effect.tap(() => publication.awaitCurrent)
          )
        }
        return Effect.succeed({
          _tag: "ActionDeferred" as const,
          proposalId: action.proposal.id,
          reason: "TrackerGraphReadUnavailable" as const
        })
      }
    })
  }
)

const progressProposal = (value: Effect.Success<typeof deliveryRuntime>) => {
  if (value.proposedActions._tag !== "DeliveryProposalsAvailable") return undefined
  return value.proposedActions.proposals.find(
    ({ route }) => route._tag === "TrackerGraphReadRoute" && route.purpose === "CheckExecutorProgress"
  )
}

it.effect("coalesces three pending executor-progress requirements into one complete graph read", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      yield* appendGraph(journal, OperationId.make("reactive-progress-G0"), "reactive-progress-G0")
      yield* Effect.forEach(taskIds, (taskId) => appendResponsibility(journal, taskId), { discard: true })
      const resources = yield* makeIntegrationTargetResourceController()
      const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget, resources).pipe(
        Effect.provideService(InRunJournal, journal)
      )
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))
      const providerCalls = yield* Ref.make<ReadonlyArray<OperationId>>([])
      const providerCoverage = yield* Ref.make<ReadonlyArray<TaskId>>([])
      const providerSawJournalIntent = yield* Ref.make<ReadonlyArray<OperationId>>([])
      const executorWorkCalls = yield* Ref.make<ReadonlyArray<string>>([])
      const readAccepted = yield* Deferred.make<void>()

      yield* Effect.forEach(taskIds, (taskId) => appendRunning(journal, taskId, 1, 1), { discard: true })
      yield* publication.awaitCurrent
      const value = yield* relation.get
      const proposal = Option.getOrThrow(Option.fromUndefinedOr(progressProposal(value)))
      if (proposal.route._tag !== "TrackerGraphReadRoute" || proposal.route.purpose !== "CheckExecutorProgress") {
        return yield* Effect.die("expected a progress graph read route")
      }
      expect(proposal.route.pendingReports.map(({ taskId }) => taskId)).toEqual(
        [...taskIds].toSorted((left, right) => left.localeCompare(right))
      )
      expect(proposal.route.pendingReports).toHaveLength(3)
      expect(value.proposedActions).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        proposals: [{ route: { _tag: "TrackerGraphReadRoute", purpose: "CheckExecutorProgress" } }]
      })
      const provider = (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) =>
        Effect.gen(function* () {
          const records = yield* journal.read(runId)
          if (
            records.some(
              ({ event }) =>
                event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === operation.operationId
            )
          ) {
            yield* Ref.update(providerSawJournalIntent, (calls) => [...calls, operation.operationId])
          }
          yield* Ref.update(providerCalls, (calls) => [...calls, operation.operationId])
          yield* Ref.set(providerCoverage, [...operation.readShape.explicitlyCoveredTaskIds])
          return yield* graphSnapshotFor("reactive-progress-coalesced-G1")
        })
      const productionExecutor = yield* makeTrackerGraphActionExecutor(journal, publication, provider)
      const executor = DeliveryActionExecutor.of({
        execute: (action, lease) => {
          const route = action.proposal.route
          const isExecutorWork =
            route._tag === "FreshExecutorWorkflowRoute" ||
            (route._tag === "IdentityFreeWorkflowRoute" &&
              (route.transition._tag === "ContinuePlannedAttemptExecutorWork" ||
                route.transition._tag === "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts" ||
                route.transition._tag === "StartPlannedAttemptExecutorWork"))
          return (isExecutorWork ? Ref.update(executorWorkCalls, (calls) => [...calls, route._tag]) : Effect.void).pipe(
            Effect.andThen(productionExecutor.execute(action, lease)),
            Effect.tap(() => Deferred.succeed(readAccepted, undefined))
          )
        }
      })
      const lifecycle = yield* makeApplicationExitLifecycle()
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(resources, lifecycle.admission)
      const runtime = yield* runDeliveryRuntime(relation).pipe(
        Effect.provide(deterministicOperationIdAllocatorLayer("reactive-progress-coalesced-read")),
        Effect.provide(
          deterministicPlannedTaskAttemptLayer({
            baseSha: GitCommitSha.make("1".repeat(40)),
            executor: TaskExecutorLocator.make("executor:reactive-progress-coalesced"),
            runId,
            worktreeRoot: WorktreeLocator.make("/worktrees/reactive-progress-coalesced")
          })
        ),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.forkChild
      )
      yield* Deferred.await(readAccepted)
      yield* Fiber.interrupt(runtime)
      expect(yield* Ref.get(providerCalls)).toHaveLength(1)
      expect(yield* Ref.get(providerCoverage)).toEqual(
        [...taskIds].toSorted((left, right) => left.localeCompare(right))
      )
      expect(yield* Ref.get(providerSawJournalIntent)).toEqual(yield* Ref.get(providerCalls))
      expect(yield* Ref.get(executorWorkCalls)).toEqual([])
      const records = yield* journal.read(runId)
      const operationId = Option.getOrThrow(Option.fromUndefinedOr((yield* Ref.get(providerCalls))[0]))
      const intent = records.find(
        ({ event }) => event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === operationId
      )
      expect(intent?.event._tag).toBe("TaskTrackerReadIntentRecorded")
      if (intent?.event._tag === "TaskTrackerReadIntentRecorded") {
        expect(intent.event.operation.readShape.explicitlyCoveredTaskIds).toEqual(
          [...taskIds].toSorted((left, right) => left.localeCompare(right))
        )
      }
    })
  ).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect(
  "does not read again after an unchanged executor-progress graph check until another Running report is accepted",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const journal = yield* makeJournalService
        yield* appendGraph(
          journal,
          OperationId.make("reactive-progress-unchanged-G0"),
          "reactive-progress-unchanged-G0"
        )
        yield* appendResponsibility(journal, taskIds[0])
        yield* appendResponsibility(journal, taskIds[1])
        const resources = yield* makeIntegrationTargetResourceController()
        const recovery = yield* makeRunRecoveryProjection(runId, target, resources).pipe(
          Effect.provideService(InRunJournal, journal)
        )
        const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources)
        const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
        const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))
        const providerCalls = yield* Ref.make<ReadonlyArray<OperationId>>([])
        const providerCoverage = yield* Ref.make<ReadonlyArray<ReadonlyArray<TaskId>>>([])
        const providerSawJournalIntent = yield* Ref.make<ReadonlyArray<OperationId>>([])
        const executorWorkCalls = yield* Ref.make<ReadonlyArray<string>>([])
        const firstReadAccepted = yield* Deferred.make<void>()
        const releaseFirstRead = yield* Deferred.make<void>()
        const secondReadAccepted = yield* Deferred.make<void>()
        const lifecycle = yield* makeApplicationExitLifecycle()
        const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(resources, lifecycle.admission)
        const provider = (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) =>
          Effect.gen(function* () {
            const records = yield* journal.read(runId)
            if (
              records.some(
                ({ event }) =>
                  event._tag === "TaskTrackerReadIntentRecorded" &&
                  event.operation.operationId === operation.operationId
              )
            ) {
              yield* Ref.update(providerSawJournalIntent, (calls) => [...calls, operation.operationId])
            }
            const callCount = yield* Ref.updateAndGet(providerCalls, (calls) => [...calls, operation.operationId])
            yield* Ref.update(providerCoverage, (coverage) => [
              ...coverage,
              [...operation.readShape.explicitlyCoveredTaskIds]
            ])
            if (callCount.length > 2) {
              return yield* Effect.die("unchanged acceptance made an unexpected third provider call")
            }
            const revision =
              callCount.length === 1 ? "reactive-progress-unchanged-G0" : "reactive-progress-unchanged-G1"
            return yield* graphSnapshotFor(revision)
          })
        const productionExecutor = yield* makeTrackerGraphActionExecutor(journal, publication, provider)
        const executor = DeliveryActionExecutor.of({
          execute: (action, lease) => {
            const route = action.proposal.route
            const isExecutorWork =
              route._tag === "FreshExecutorWorkflowRoute" ||
              (route._tag === "IdentityFreeWorkflowRoute" &&
                (route.transition._tag === "ContinuePlannedAttemptExecutorWork" ||
                  route.transition._tag === "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts" ||
                  route.transition._tag === "StartPlannedAttemptExecutorWork"))
            const accepted =
              action._tag === "FreshOperationAction" && route._tag === "TrackerGraphReadRoute"
                ? productionExecutor
                    .execute(action, lease)
                    .pipe(
                      Effect.tap(() =>
                        Ref.get(providerCalls).pipe(
                          Effect.flatMap((calls) =>
                            calls.length === 1
                              ? Deferred.succeed(firstReadAccepted, undefined).pipe(
                                  Effect.andThen(Deferred.await(releaseFirstRead))
                                )
                              : calls.length === 2
                                ? Deferred.succeed(secondReadAccepted, undefined)
                                : Effect.die("unchanged acceptance made an unexpected third provider call")
                          )
                        )
                      )
                    )
                : Effect.succeed({
                    _tag: "ActionDeferred" as const,
                    proposalId: action.proposal.id,
                    reason: "TrackerGraphReadUnavailable" as const
                  })
            return (
              isExecutorWork ? Ref.update(executorWorkCalls, (calls) => [...calls, route._tag]) : Effect.void
            ).pipe(Effect.andThen(accepted))
          }
        })
        const runtime = yield* runDeliveryRuntime(relation).pipe(
          Effect.provide(deterministicOperationIdAllocatorLayer("reactive-progress-unchanged-read")),
          Effect.provide(
            deterministicPlannedTaskAttemptLayer({
              baseSha: GitCommitSha.make("1".repeat(40)),
              executor: TaskExecutorLocator.make("executor:reactive-progress-unchanged"),
              runId,
              worktreeRoot: WorktreeLocator.make("/worktrees/reactive-progress-unchanged")
            })
          ),
          Effect.provide(plannedAttemptProtocolControllerLayer),
          Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
          Effect.provideService(DeliveryActionExecutor, executor),
          Effect.forkChild
        )

        yield* appendRunning(journal, taskIds[0], 1, 1)
        yield* Deferred.await(firstReadAccepted)
        expect(yield* Ref.get(providerCalls)).toHaveLength(1)
        expect(progressProposal(yield* relation.get)).toBeUndefined()
        const firstCall = Option.getOrThrow(Option.fromUndefinedOr((yield* Ref.get(providerCalls))[0]))
        const firstRecords = yield* journal.read(runId)
        const firstObservation = firstRecords.find(
          ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === firstCall
        )
        expect(firstObservation?.event._tag).toBe("TaskTrackerFactsObserved")
        if (firstObservation?.event._tag === "TaskTrackerFactsObserved") {
          expect(firstObservation.event.observation._tag).toBe("UnchangedTaskTrackerFactsReconfirmed")
        }

        yield* appendRunning(journal, taskIds[1], 1, 1)
        yield* publication.awaitCurrent
        expect(yield* Ref.get(providerCalls)).toHaveLength(1)
        const pendingBeforeRelease = Option.getOrThrow(Option.fromUndefinedOr(progressProposal(yield* relation.get)))
        if (pendingBeforeRelease.route._tag !== "TrackerGraphReadRoute") {
          return yield* Effect.die("expected a pending progress graph route for the new Running report")
        }
        expect(pendingBeforeRelease.route.pendingReports.map(({ taskId }) => taskId)).toEqual([taskIds[1]])

        yield* Deferred.succeed(releaseFirstRead, undefined)
        yield* Deferred.await(secondReadAccepted)
        yield* Fiber.interrupt(runtime)
        expect(yield* Ref.get(providerCalls)).toHaveLength(2)
        expect(yield* Ref.get(providerCoverage)).toEqual([[taskIds[0]], [taskIds[1]]])
        expect(yield* Ref.get(providerSawJournalIntent)).toEqual(yield* Ref.get(providerCalls))
        expect(yield* Ref.get(executorWorkCalls)).toEqual([])
      })
    ).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("preserves executor continuation ordinals and the durable limit across tracker graph reads", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const plannedAttempt = Option.getOrThrow(Option.fromUndefinedOr(attempts.get(taskIds[0])))
      const graphOperationId = OperationId.make("reactive-progress-limit-G0")
      yield* appendGraph(journal, graphOperationId, "reactive-progress-limit-G0")
      const plan = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("reactive-progress-limit-plan-A"),
        plannedAttempt,
        predecessorOperationIds: []
      })
      yield* journal.append(
        runId,
        attemptPlanRecordKey(plannedAttempt.attemptId),
        TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
      )
      yield* journal.append(
        runId,
        plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
        PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      const specification = specificationFor(taskIds[0])
      const specificationOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("reactive-progress-limit-specification"),
        target,
        taskIds[0],
        [graphOperationId, plan.operationId]
      )
      yield* journal.append(
        runId,
        intentRecordKey(specificationOperation.operationId),
        taskTrackerReadIntent(specificationOperation)
      )
      yield* journal.append(
        runId,
        outcomeRecordKey(specificationOperation.operationId),
        taskTrackerFactsObservedEvent(
          specificationOperation.operationId,
          makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
        )
      )
      const resources = yield* makeIntegrationTargetResourceController()
      const recovery = {
        readDeliveryProjection: Effect.gen(function* () {
          const journalState = yield* journal.state.get
          const records = yield* journal.read(runId)
          const acceptedReport = records.findLast(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report.correlation.attemptId === plannedAttempt.attemptId &&
              event.report.correlation.runId === plannedAttempt.runId
          )?.event
          const commandCount = records.filter(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandIntended" &&
              event.command === "StartOrContinue" &&
              event.plannedAttempt.attemptId === plannedAttempt.attemptId &&
              event.plannedAttempt.runId === plannedAttempt.runId
          ).length
          const transitions =
            acceptedReport?._tag === "PlannedAttemptExecutorWorkReported" &&
            acceptedReport.report._tag === "Running" &&
            commandCount < 3
              ? [
                  RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
                    acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: acceptedReport.ordinal },
                    plannedAttempt
                  })
                ]
              : []
          return {
            evidence: {
              _tag: "AvailableDeliveryProjectionEvidence" as const,
              acceptedAt: journalState.position,
              facts: [],
              integrationWaits: []
            },
            frontier: { explanations: [], transitions }
          }
        }),
        reconstructedPlannedAttemptPositions: []
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))
      yield* appendRunning(journal, taskIds[0], 1, 1)
      yield* publication.awaitCurrent
      const initial = yield* relation.get
      const initialProposal = Option.getOrThrow(Option.fromUndefinedOr(progressProposal(initial)))
      if (initialProposal.route._tag !== "TrackerGraphReadRoute") {
        return yield* Effect.die("expected a progress graph route")
      }
      expect(initialProposal.route.pendingReports.map(({ taskId }) => taskId)).toEqual([taskIds[0]])

      const providerCalls = yield* Ref.make<ReadonlyArray<OperationId>>([])
      const providerCoverage = yield* Ref.make<ReadonlyArray<ReadonlyArray<TaskId>>>([])
      const providerSawJournalIntent = yield* Ref.make<ReadonlyArray<OperationId>>([])
      const executorCalls = yield* Ref.make<ReadonlyArray<number>>([])
      const continuationAcceptedOrdinals = yield* Ref.make<ReadonlyArray<number>>([])
      const forbiddenExecutorActions = yield* Ref.make<ReadonlyArray<string>>([])
      const limitReached = yield* Deferred.make<void>()
      const plannedExecutor = PlannedAttemptExecutor.of({
        project: () => Effect.die("ordinal acceptance must not project executor state"),
        requestSuspension: () => Effect.die("ordinal acceptance must not suspend executor work"),
        startOrContinue: (request) =>
          Effect.gen(function* () {
            const callNumber = yield* Ref.updateAndGet(executorCalls, (calls) => [...calls, calls.length + 1])
            if (callNumber > 2) return yield* Effect.die("ordinal acceptance attempted a fourth executor call")
            return PlannedAttemptExecutorReport.cases.Running.make({
              correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt)
            })
          })
      })
      const provider = (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) =>
        Effect.gen(function* () {
          const records = yield* journal.read(runId)
          if (
            records.some(
              ({ event }) =>
                event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === operation.operationId
            )
          ) {
            yield* Ref.update(providerSawJournalIntent, (calls) => [...calls, operation.operationId])
          }
          const calls = yield* Ref.updateAndGet(providerCalls, (current) => [...current, operation.operationId])
          if (calls.length > 2) return yield* Effect.die("ordinal acceptance attempted a third graph read")
          yield* Ref.update(providerCoverage, (coverage) => [
            ...coverage,
            [...operation.readShape.explicitlyCoveredTaskIds]
          ])
          return yield* graphSnapshotFor("reactive-progress-limit-G0")
        })
      const productionExecutor = yield* makeTrackerGraphActionExecutor(journal, publication, provider)
      const actionExecutor = DeliveryActionExecutor.of({
        execute: (action, lease) => {
          const route = action.proposal.route
          if (action._tag === "FreshOperationAction" && route._tag === "TrackerGraphReadRoute") {
            return productionExecutor.execute(action, lease)
          }
          if (
            action._tag === "IdentityFreeAction" &&
            route._tag === "IdentityFreeWorkflowRoute" &&
            (route.transition._tag === "ContinuePlannedAttemptExecutorWork" ||
              route.transition._tag === "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts")
          ) {
            const transition = route.transition
            if (transition.acceptedProgress._tag !== "ExecutorReportAccepted") {
              return Effect.die("ordinal acceptance expected each continuation to name its accepted report")
            }
            const acceptedOrdinal = Number(transition.acceptedProgress.ordinal)
            return Effect.gen(function* () {
              const calls = yield* Ref.get(executorCalls)
              if (acceptedOrdinal !== calls.length + 1) {
                return yield* Effect.die(
                  `ordinal acceptance expected report ${calls.length + 1}, got ${acceptedOrdinal}`
                )
              }
              yield* Ref.update(continuationAcceptedOrdinals, (ordinals) => [...ordinals, acceptedOrdinal])
              const result = yield* executePlannedAttemptTransition(action, transition, lease).pipe(
                Effect.provideService(InRunJournal, journal),
                Effect.provideService(PlannedAttemptExecutor, plannedExecutor)
              )
              if (result._tag === "ExecutorReportPublished") {
                const executorCallCount = yield* Ref.get(executorCalls)
                if (executorCallCount.length === 2) {
                  yield* publication.awaitCurrent
                  yield* Deferred.succeed(limitReached, undefined)
                }
              }
              return result
            })
          }
          const isExecutorAction =
            route._tag === "FreshExecutorWorkflowRoute" ||
            (route._tag === "IdentityFreeWorkflowRoute" &&
              (route.transition._tag === "StartPlannedAttemptExecutorWork" ||
                route.transition._tag === "ContinuePlannedAttemptExecutorWork" ||
                route.transition._tag === "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts"))
          return (
            isExecutorAction ? Ref.update(forbiddenExecutorActions, (actions) => [...actions, route._tag]) : Effect.void
          ).pipe(
            Effect.as({
              _tag: "ActionDeferred" as const,
              proposalId: action.proposal.id,
              reason: "TrackerGraphReadUnavailable" as const
            })
          )
        }
      })
      const lifecycle = yield* makeApplicationExitLifecycle()
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(resources, lifecycle.admission)
      const runtime = yield* runDeliveryRuntime(relation).pipe(
        Effect.provide(deterministicOperationIdAllocatorLayer("reactive-progress-limit-read")),
        Effect.provide(
          deterministicPlannedTaskAttemptLayer({
            baseSha: GitCommitSha.make("1".repeat(40)),
            executor: TaskExecutorLocator.make("executor:reactive-progress-limit"),
            runId,
            worktreeRoot: WorktreeLocator.make("/worktrees/reactive-progress-limit")
          })
        ),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(DeliveryActionExecutor, actionExecutor),
        Effect.forkChild
      )

      yield* Deferred.await(limitReached)
      yield* Fiber.interrupt(runtime)

      const limitFailure = yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provideService(InRunJournal, journal),
        Effect.provideService(PlannedAttemptExecutor, plannedExecutor),
        Effect.flip
      )
      expect(limitFailure).toBeInstanceOf(PlannedAttemptExecutorContinuationLimitReached)
      expect(limitFailure).toMatchObject({ _tag: "PlannedAttemptExecutorContinuationLimitReached", limit: 3 })
      expect(yield* Ref.get(providerCalls)).toHaveLength(2)
      expect(yield* Ref.get(providerCoverage)).toEqual([[taskIds[0]], [taskIds[0]]])
      expect(yield* Ref.get(providerSawJournalIntent)).toEqual(yield* Ref.get(providerCalls))
      expect(yield* Ref.get(executorCalls)).toEqual([1, 2])
      expect(yield* Ref.get(continuationAcceptedOrdinals)).toEqual([1, 2])
      expect(yield* Ref.get(forbiddenExecutorActions)).toEqual([])
      expect(progressProposal(yield* relation.get)).toBeUndefined()

      const records = yield* journal.read(runId)
      expect(
        records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "StartOrContinue"
            ? [Number(event.ordinal)]
            : []
        )
      ).toEqual([1, 2, 3])
      expect(
        records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" ? [Number(event.ordinal)] : []
        )
      ).toEqual([1, 2, 3])
    })
  ).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("repeats an unresolved executor-progress graph read and reuses an accepted observation after restart", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const storage = yield* JournalStore
      yield* storage.beginRun(runId, target, policy)
      const providerCalls = yield* Ref.make<ReadonlyArray<OperationId>>([])
      const providerCoverage = yield* Ref.make<ReadonlyArray<ReadonlyArray<TaskId>>>([])
      const providerSawJournalIntent = yield* Ref.make<ReadonlyArray<OperationId>>([])
      const firstReadPurposes = yield* Ref.make<ReadonlyArray<string>>([])
      const secondReadPurposes = yield* Ref.make<ReadonlyArray<string>>([])
      const firstReadIntent = yield* Deferred.make<void>()
      const firstProcessHold = yield* Deferred.make<void>()
      const firstScope = yield* Scope.make()
      const firstProcess = yield* Effect.gen(function* () {
        const journal = yield* makeRestartJournalService
        yield* appendGraph(journal, OperationId.make("reactive-progress-restart-G0"), "reactive-progress-restart-G0")
        yield* appendResponsibility(journal, taskIds[0])
        yield* appendRunning(journal, taskIds[0], 1, 1)
        const resources = yield* makeIntegrationTargetResourceController()
        const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget, resources).pipe(
          Effect.provideService(InRunJournal, journal)
        )
        const relations = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources)
        const relation = yield* deliveryRuntime.pipe(Effect.provide(relations))
        const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(relations))
        const lifecycle = yield* makeApplicationExitLifecycle()
        const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(resources, lifecycle.admission)
        const provider = (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) =>
          Effect.gen(function* () {
            const records = yield* journal.read(runId)
            if (
              records.some(
                ({ event }) =>
                  event._tag === "TaskTrackerReadIntentRecorded" &&
                  event.operation.operationId === operation.operationId
              )
            ) {
              yield* Ref.update(providerSawJournalIntent, (calls) => [...calls, operation.operationId])
            }
            yield* Ref.update(providerCalls, (calls) => [...calls, operation.operationId])
            yield* Ref.update(providerCoverage, (coverage) => [
              ...coverage,
              [...operation.readShape.explicitlyCoveredTaskIds]
            ])
            yield* Deferred.succeed(firstReadIntent, undefined)
            yield* Deferred.await(firstProcessHold)
            return yield* Effect.never
          })
        const productionExecutor = yield* makeTrackerGraphActionExecutor(journal, publication, provider)
        const executor = DeliveryActionExecutor.of({
          execute: (action, lease) => {
            const route = action.proposal.route
            if (action._tag === "FreshOperationAction" && route._tag === "TrackerGraphReadRoute") {
              if (route.purpose !== "CheckExecutorProgress") {
                return Effect.die("restart acceptance process 1 expected executor-progress graph read")
              }
              return Ref.update(firstReadPurposes, (purposes) => [...purposes, route.purpose]).pipe(
                Effect.andThen(productionExecutor.execute(action, lease))
              )
            }
            return Effect.succeed({
              _tag: "ActionDeferred" as const,
              proposalId: action.proposal.id,
              reason: "TrackerGraphReadUnavailable" as const
            })
          }
        })
        const runtime = yield* runDeliveryRuntime(relation).pipe(
          Effect.provide(deterministicOperationIdAllocatorLayer("reactive-progress-restart-read")),
          Effect.provide(
            deterministicPlannedTaskAttemptLayer({
              baseSha: GitCommitSha.make("1".repeat(40)),
              executor: TaskExecutorLocator.make("executor:reactive-progress-restart"),
              runId,
              worktreeRoot: WorktreeLocator.make("/worktrees/reactive-progress-restart")
            })
          ),
          Effect.provide(plannedAttemptProtocolControllerLayer),
          Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
          Effect.provideService(DeliveryActionExecutor, executor),
          Effect.forkChild
        )
        return { journal, runtime }
      }).pipe(Scope.provide(firstScope))

      yield* Deferred.await(firstReadIntent)
      const firstCalls = yield* Ref.get(providerCalls)
      expect(firstCalls).toHaveLength(1)
      expect(yield* Ref.get(firstReadPurposes)).toEqual(["CheckExecutorProgress"])
      expect(yield* Ref.get(providerCoverage)).toEqual([[taskIds[0]]])
      expect(yield* Ref.get(providerSawJournalIntent)).toEqual(firstCalls)
      yield* Fiber.interrupt(firstProcess.runtime)
      yield* Scope.close(firstScope, Exit.void)

      const secondReadAccepted = yield* Deferred.make<void>()
      const secondScope = yield* Scope.make()
      const secondProcess = yield* Effect.gen(function* () {
        const journal = yield* makeRestartJournalService
        const resources = yield* makeIntegrationTargetResourceController()
        const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget, resources).pipe(
          Effect.provideService(InRunJournal, journal)
        )
        const relations = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources)
        const relation = yield* deliveryRuntime.pipe(Effect.provide(relations))
        const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(relations))
        const lifecycle = yield* makeApplicationExitLifecycle()
        const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(resources, lifecycle.admission)
        const provider = (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) =>
          Effect.gen(function* () {
            const records = yield* journal.read(runId)
            if (
              records.some(
                ({ event }) =>
                  event._tag === "TaskTrackerReadIntentRecorded" &&
                  event.operation.operationId === operation.operationId
              )
            ) {
              yield* Ref.update(providerSawJournalIntent, (calls) => [...calls, operation.operationId])
            }
            const calls = yield* Ref.updateAndGet(providerCalls, (current) => [...current, operation.operationId])
            if (calls.length > 3) return yield* Effect.die("restart acceptance made a fourth tracker provider call")
            yield* Ref.update(providerCoverage, (coverage) => [
              ...coverage,
              [...operation.readShape.explicitlyCoveredTaskIds]
            ])
            return yield* graphSnapshotFor(
              operation.readShape.explicitlyCoveredTaskIds.length === 0
                ? "reactive-progress-restart-G1"
                : "reactive-progress-restart-G2"
            )
          })
        const productionExecutor = yield* makeTrackerGraphActionExecutor(journal, publication, provider)
        const executor = DeliveryActionExecutor.of({
          execute: (action, lease) => {
            const route = action.proposal.route
            if (action._tag === "FreshOperationAction" && route._tag === "TrackerGraphReadRoute") {
              return Ref.update(secondReadPurposes, (purposes) => [...purposes, route.purpose]).pipe(
                Effect.andThen(productionExecutor.execute(action, lease)),
                Effect.tap(() =>
                  route.purpose === "CheckExecutorProgress"
                    ? Deferred.succeed(secondReadAccepted, undefined)
                    : Effect.void
                )
              )
            }
            return Effect.succeed({
              _tag: "ActionDeferred" as const,
              proposalId: action.proposal.id,
              reason: "TrackerGraphReadUnavailable" as const
            })
          }
        })
        const runtime = yield* runDeliveryRuntime(relation).pipe(
          Effect.provide(deterministicOperationIdAllocatorLayer("reactive-progress-restart-read")),
          Effect.provide(
            deterministicPlannedTaskAttemptLayer({
              baseSha: GitCommitSha.make("1".repeat(40)),
              executor: TaskExecutorLocator.make("executor:reactive-progress-restart"),
              runId,
              worktreeRoot: WorktreeLocator.make("/worktrees/reactive-progress-restart")
            })
          ),
          Effect.provide(plannedAttemptProtocolControllerLayer),
          Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
          Effect.provideService(DeliveryActionExecutor, executor),
          Effect.forkChild
        )
        return { journal, runtime }
      }).pipe(Scope.provide(secondScope))

      yield* Deferred.await(secondReadAccepted)
      yield* Fiber.interrupt(secondProcess.runtime)
      yield* Scope.close(secondScope, Exit.void)
      const calls = yield* Ref.get(providerCalls)
      expect(calls).toHaveLength(3)
      expect(new Set(calls)).toHaveLength(3)
      expect(yield* Ref.get(secondReadPurposes)).toEqual(["EstablishCurrentGraph", "CheckExecutorProgress"])
      expect(yield* Ref.get(providerCoverage)).toEqual([[taskIds[0]], [], [taskIds[0]]])
      expect(yield* Ref.get(providerSawJournalIntent)).toEqual(calls)

      const thirdScope = yield* Scope.make()
      const thirdProcess = yield* Effect.gen(function* () {
        const journal = yield* makeRestartJournalService
        const resources = yield* makeIntegrationTargetResourceController()
        const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget, resources).pipe(
          Effect.provideService(InRunJournal, journal)
        )
        const relations = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources)
        const relation = yield* deliveryRuntime.pipe(Effect.provide(relations))
        return yield* relation.get
      }).pipe(Scope.provide(thirdScope))
      expect(progressProposal(thirdProcess)).toBeUndefined()
      expect(yield* Ref.get(providerCalls)).toHaveLength(3)
      yield* Scope.close(thirdScope, Exit.void)
    })
  ).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect(
  "continues no executor after a failed executor-progress graph read and lets later reactivation read fresh facts",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const storage = yield* JournalStore
        yield* storage.beginRun(runId, target, policy)
        const providerCalls = yield* Ref.make<ReadonlyArray<OperationId>>([])
        const executorWorkCalls = yield* Ref.make<ReadonlyArray<string>>([])
        const firstReadFailed = yield* Deferred.make<void>()
        const firstScope = yield* Scope.make()
        const firstProcess = yield* Effect.gen(function* () {
          const journal = yield* makeRestartJournalService
          yield* appendGraph(journal, OperationId.make("reactive-progress-failure-G0"), "reactive-progress-failure-G0")
          yield* appendResponsibility(journal, taskIds[0])
          yield* appendRunning(journal, taskIds[0], 1, 1)
          const resources = yield* makeIntegrationTargetResourceController()
          const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget, resources).pipe(
            Effect.provideService(InRunJournal, journal)
          )
          const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources)
          const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
          const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))
          const lifecycle = yield* makeApplicationExitLifecycle()
          const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(resources, lifecycle.admission)
          const executor = DeliveryActionExecutor.of({
            execute: (action, lease) => {
              if (action.proposal.route._tag !== "TrackerGraphReadRoute") {
                const route = action.proposal.route
                const isExecutorWork =
                  route._tag === "FreshExecutorWorkflowRoute" ||
                  (route._tag === "IdentityFreeWorkflowRoute" &&
                    (route.transition._tag === "ContinuePlannedAttemptExecutorWork" ||
                      route.transition._tag === "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts" ||
                      route.transition._tag === "StartPlannedAttemptExecutorWork"))
                return (
                  isExecutorWork
                    ? Ref.update(executorWorkCalls, (calls) => [
                        ...calls,
                        `${action._tag}:${action.proposal.route._tag}`
                      ])
                    : Effect.void
                ).pipe(
                  Effect.as({
                    _tag: "ActionDeferred" as const,
                    proposalId: action.proposal.id,
                    reason: "TrackerGraphReadUnavailable" as const
                  })
                )
              }
              if (action._tag !== "FreshOperationAction") {
                return Effect.die("failed progress acceptance expected a fresh graph read")
              }
              const route = action.proposal.route
              if (route.purpose !== "CheckExecutorProgress") {
                return Effect.die("failed progress acceptance expected an executor-progress graph read")
              }
              const operation = makeTrackerGraphObservationOperation(
                action.operationId,
                target,
                [],
                route.pendingReports.map(({ taskId }) => taskId)
              )
              return Effect.gen(function* () {
                yield* lease.recordIntent(action.operationId)
                yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
                yield* Ref.update(providerCalls, (calls) => [...calls, action.operationId])
                yield* journal.append(
                  runId,
                  outcomeRecordKey(operation.operationId),
                  taskTrackerFactsObservedEvent(
                    operation.operationId,
                    TaskTrackerFactsReadFailed.make({
                      completeness: "Unreadable",
                      failure: { _tag: "TrackerReadError", detail: "controlled graph read failure" },
                      operationId: operation.operationId,
                      target: operation.target
                    })
                  )
                )
                yield* publication.awaitCurrent
                yield* Deferred.succeed(firstReadFailed, undefined)
                return {
                  _tag: "ActionDeferred" as const,
                  proposalId: action.proposal.id,
                  reason: "TrackerGraphReadUnavailable" as const
                } satisfies DeliveryActionResult
              })
            }
          })
          const runtime = yield* runDeliveryRuntime(relation).pipe(
            Effect.provide(deterministicOperationIdAllocatorLayer("reactive-progress-failure-read")),
            Effect.provide(
              deterministicPlannedTaskAttemptLayer({
                baseSha: GitCommitSha.make("1".repeat(40)),
                executor: TaskExecutorLocator.make("executor:reactive-progress-failure"),
                runId,
                worktreeRoot: WorktreeLocator.make("/worktrees/reactive-progress-failure")
              })
            ),
            Effect.provide(plannedAttemptProtocolControllerLayer),
            Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
            Effect.provideService(DeliveryActionExecutor, executor),
            Effect.forkChild
          )
          return { runtime }
        }).pipe(Scope.provide(firstScope))

        yield* Deferred.await(firstReadFailed)
        yield* Fiber.join(firstProcess.runtime)
        expect(yield* Ref.get(providerCalls)).toHaveLength(1)
        expect(yield* Ref.get(executorWorkCalls)).toEqual([])
        yield* Scope.close(firstScope, Exit.void)

        const secondReadAccepted = yield* Deferred.make<void>()
        const secondScope = yield* Scope.make()
        const secondProcess = yield* Effect.gen(function* () {
          const journal = yield* makeRestartJournalService
          const resources = yield* makeIntegrationTargetResourceController()
          const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget, resources).pipe(
            Effect.provideService(InRunJournal, journal)
          )
          const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources)
          const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
          const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))
          const lifecycle = yield* makeApplicationExitLifecycle()
          const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(resources, lifecycle.admission)
          const executor = DeliveryActionExecutor.of({
            execute: (action, lease) => {
              if (action.proposal.route._tag !== "TrackerGraphReadRoute") {
                const route = action.proposal.route
                const isExecutorWork =
                  route._tag === "FreshExecutorWorkflowRoute" ||
                  (route._tag === "IdentityFreeWorkflowRoute" &&
                    (route.transition._tag === "ContinuePlannedAttemptExecutorWork" ||
                      route.transition._tag === "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts" ||
                      route.transition._tag === "StartPlannedAttemptExecutorWork"))
                return (
                  isExecutorWork
                    ? Ref.update(executorWorkCalls, (calls) => [
                        ...calls,
                        `${action._tag}:${action.proposal.route._tag}`
                      ])
                    : Effect.void
                ).pipe(
                  Effect.as({
                    _tag: "ActionDeferred" as const,
                    proposalId: action.proposal.id,
                    reason: "TrackerGraphReadUnavailable" as const
                  })
                )
              }
              if (action._tag !== "FreshOperationAction") {
                return Effect.die("failed progress acceptance expected a fresh graph read")
              }
              const route = action.proposal.route
              if (route.purpose !== "EstablishCurrentGraph") {
                return Effect.die("reactivation expected a fresh current-graph read")
              }
              const operation = makeTrackerGraphObservationOperation(action.operationId, target, [], [taskIds[0]])
              return Effect.gen(function* () {
                yield* lease.recordIntent(action.operationId)
                yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
                yield* Ref.update(providerCalls, (calls) => [...calls, action.operationId])
                yield* journal.append(
                  runId,
                  outcomeRecordKey(operation.operationId),
                  makeTaskTrackerFactsObservedFromRead(
                    yield* journal.read(runId),
                    operation,
                    yield* graphSnapshotFor("reactive-progress-failure-G1")
                  )
                )
                yield* publication.awaitCurrent
                yield* Deferred.succeed(secondReadAccepted, undefined)
                return {
                  _tag: "TrackerGraphObservationPublished" as const,
                  operationId: action.operationId,
                  proposalId: action.proposal.id,
                  snapshot: yield* graphSnapshotFor("reactive-progress-failure-G1")
                } satisfies DeliveryActionResult
              })
            }
          })
          const runtime = yield* runDeliveryRuntime(relation).pipe(
            Effect.provide(deterministicOperationIdAllocatorLayer("reactive-progress-failure-read")),
            Effect.provide(
              deterministicPlannedTaskAttemptLayer({
                baseSha: GitCommitSha.make("1".repeat(40)),
                executor: TaskExecutorLocator.make("executor:reactive-progress-failure"),
                runId,
                worktreeRoot: WorktreeLocator.make("/worktrees/reactive-progress-failure")
              })
            ),
            Effect.provide(plannedAttemptProtocolControllerLayer),
            Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
            Effect.provideService(DeliveryActionExecutor, executor),
            Effect.forkChild
          )
          return { runtime }
        }).pipe(Scope.provide(secondScope))

        yield* Deferred.await(secondReadAccepted)
        yield* Fiber.interrupt(secondProcess.runtime)
        yield* Scope.close(secondScope, Exit.void)
        const calls = yield* Ref.get(providerCalls)
        expect(calls).toHaveLength(2)
        expect(calls[0]).not.toBe(calls[1])
        expect(yield* Ref.get(executorWorkCalls)).toEqual([])
        const secondOperationId = Option.getOrThrow(Option.fromUndefinedOr(calls[1]))
        const records = yield* storage.read(runId)
        expect(
          records.some(
            ({ event }) =>
              event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "TaskTrackerFactsReadFailed"
          )
        ).toBe(true)
        const secondObservation = records.find(
          ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === secondOperationId
        )
        expect(secondObservation?.event._tag).toBe("TaskTrackerFactsObserved")
        if (secondObservation?.event._tag === "TaskTrackerFactsObserved") {
          expect(secondObservation.event.observation._tag).toBe("CompleteTaskTrackerFacts")
        }
      })
    ).pipe(Effect.provide(memoryJournalStoreLayer))
)
