import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer, Ref, SubscriptionRef } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot, type TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { TaskLifecycle } from "../../authorities/task-tracker/task.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { OperationId } from "../../workflow/identity.js"
import {
  WorkflowInterpreter,
  type WorkflowInterpreterService,
  WorkflowTrace
} from "../../workflow/interpretation/interpreter.js"
import { makeTrackerGraphObservationOperation, type TrackerGraphReadCause } from "../../workflow/registry/operation.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  OperationIdAllocator
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import {
  DeliveryActionExecutor,
  DeliverySemanticTrace,
  type DeliveryActionExecutorService
} from "../delivery/delivery-action-executor.js"
import { deliveryProposalsOf } from "../delivery/delivery-proposal.js"
import { FreshWorkflowStep } from "../delivery/fresh-workflow-step.js"
import { frontierOf } from "../delivery/ticket-delivery-projection.js"
import {
  deliveryRuntimeResourceCapabilitiesLayer,
  deliveryRuntimeResourceCapabilitiesOf,
  deliveryRuntimeResourcesLayer
} from "../delivery/delivery-runtime-resources.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "../delivery/in-memory-relations.js"
import { deliveryRuntime } from "../delivery/delivery-runtime-adapter.js"
import {
  currentSignalOf,
  currentSignalFromCurrentFirstStream,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeEvaluation,
  TrackerGraphState
} from "../delivery/relations.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../test/journaled-graph-observation.js"
import { runStabilizedDelivery } from "./run-stabilization.js"
import {
  activeWorkAuthorityRefreshForOwner,
  activeWorkAuthorityRefreshSubjectsFor
} from "./run-activation-opportunity.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { type ApplicationExitLifecycleService, makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import { makePreparedBeginFixture, preparedBeginProposalsOf } from "../../../test/support/prepared-begin-proposal.js"
const runId = RunId.make("run-stabilization")
const target = FixtureTarget.make("run-stabilization-target")
const emptyFrontier = { _tag: "DeliveryProposalsAvailable" as const, isolatedIssues: [], proposals: [] }
const capacity = TaskWorkCapacity.make(1)
const policy = RunControlPolicy.make({ revision: initialRunPolicyRevision, taskExecutionCapacity: capacity })

const snapshot = (
  revision: string,
  tasks: ReadonlyArray<{
    readonly id: TaskId
    readonly lifecycle: TaskLifecycle
    readonly parentTaskId: null
    readonly prerequisiteIds: ReadonlyArray<TaskId>
  }>,
  rootTaskId?: TaskId
): TaskDagSnapshot => {
  const projected = projectTrackerSnapshot({ revision, ...(rootTaskId === undefined ? {} : { rootTaskId }), tasks })
  if (projected._tag === "Invalid") throw new Error("stabilization fixture graph must be valid")
  return projected.snapshot
}

type EstablishedTrackerGraphState = Extract<TrackerGraphState, { readonly _tag: "GraphEstablished" }>
type TrackerGraphObservationOperation = Extract<
  Parameters<WorkflowInterpreterService["readTrackerGraph"]>[0],
  { readonly _tag: "ReadTrackerGraph" }
>

const graph = (
  operation: string,
  recordedAt: number,
  current: TaskDagSnapshot,
  cause: typeof TrackerGraphReadCause.Type = { _tag: "WorkflowEstablishment" }
): EstablishedTrackerGraphState => {
  // The shared fixture creates its own graph operation without predecessors,
  // which cannot itself encode a valid post-quiescence cause. Preserve its
  // private journal receipt brand, then publish the cause from the real
  // operation that the journaled interpreter just executed.
  const established = TrackerGraphState.cases.GraphEstablished.make({
    observation: makeTestJournaledTrackerGraphObservation({
      operationId: OperationId.make(operation),
      recordedAt: JournalPosition.make(recordedAt),
      snapshot: current,
      cause: cause._tag === "PostQuiescenceReconfirmation" ? { _tag: "WorkflowEstablishment" } : cause
    })
  })
  if (established._tag !== "GraphEstablished") throw new Error("established graph constructor must be exact")
  return cause._tag === "PostQuiescenceReconfirmation"
    ? { _tag: "GraphEstablished", observation: { ...established.observation, cause } }
    : established
}

const baseEvaluation = Effect.gen(function* () {
  const runtime = yield* deliveryRuntime.pipe(
    Effect.provide(
      makeDeliveryRelationsLayer({
        ...deterministicDeliveryRuntimeSupport(policy),
        coherent: currentSignalOf({
          actionInputs: {
            proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
            reflectionProposals: [],
            runtimeFacts: {
              acceptedAt: null,
              cancellationApplied: false,
              pauseCoverage: {
                _tag: "PauseCoverageGraphNotEstablished",
                applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
              },
              quiescence: { _tag: "TrackerReconfirmationAllowed" },
              taskWork: { capacity, held: [] }
            },
            trackerGraphProposals: []
          },
          publication: { exactEvidence: [], graph: TrackerGraphState.cases.GraphNotEstablished.make({}), policy }
        } satisfies DeliveryRelationInputBundle)
      })
    )
  )
  return yield* runtime.get
})

const evaluation = (
  base: DeliveryRuntimeEvaluation,
  trackerGraph: TrackerGraphState,
  proposedActions: DeliveryRuntimeEvaluation["proposedActions"] = emptyFrontier
): DeliveryRuntimeEvaluation => ({
  _tag: "DeliveryRuntimeEvaluation",
  acceptedAt: trackerGraph._tag === "GraphEstablished" ? trackerGraph.observation.recordedAt : null,
  current: { ...base.current, trackerGraph },
  cancellationApplied: base.cancellationApplied,
  pauseCoverage: base.pauseCoverage,
  proposedActions,
  quiescence: { _tag: "TrackerReconfirmationAllowed" },
  taskWork: { capacity, held: [] }
})

const supportWithoutResources = Layer.mergeAll(
  deterministicOperationIdAllocatorLayer("stabilization-operation"),
  deterministicPlannedTaskAttemptLayer({
    baseSha: GitCommitSha.make("1".repeat(40)),
    executor: TaskExecutorLocator.make("executor:stabilization"),
    runId,
    worktreeRoot: WorktreeLocator.make("/stabilization")
  }),
  plannedAttemptProtocolControllerLayer,
  Layer.succeed(
    InRunJournal,
    InRunJournal.of({
      append: () => Effect.die("stabilization tests do not append directly through the Run journal"),
      read: () => Effect.succeed([])
    })
  ),
  Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
)
const support = Layer.merge(
  supportWithoutResources,
  Layer.unwrap(
    makeApplicationExitLifecycle().pipe(Effect.map((lifecycle) => deliveryRuntimeResourcesLayer(lifecycle.admission)))
  )
)

const supportWithoutAllocator = Layer.mergeAll(
  deterministicPlannedTaskAttemptLayer({
    baseSha: GitCommitSha.make("1".repeat(40)),
    executor: TaskExecutorLocator.make("executor:stabilization"),
    runId,
    worktreeRoot: WorktreeLocator.make("/stabilization")
  }),
  plannedAttemptProtocolControllerLayer,
  Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
)
const supportWithResourcesWithoutAllocator = Layer.merge(
  supportWithoutAllocator,
  Layer.unwrap(
    makeApplicationExitLifecycle().pipe(Effect.map((lifecycle) => deliveryRuntimeResourcesLayer(lifecycle.admission)))
  )
)

const appendableJournalFor = (records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  InRunJournal.of({
    append: (requestedRunId, key, event) =>
      Ref.modify(records, (current) => {
        const existing = current.find((candidate) => candidate.key === key)
        if (existing !== undefined) return [Effect.succeed(existing), current] as const
        const position = JournalPosition.make(Number(current.at(-1)?.position ?? 0) + 1)
        const appended: JournalRecord = { event, key, position, runId: requestedRunId }
        return [Effect.succeed(appended), [...current, appended]] as const
      }).pipe(Effect.flatten),
    read: () => Ref.get(records)
  })

const freshGraphReadProposal = (
  trackerGraph: Extract<TrackerGraphState, { readonly _tag: "GraphEstablished" }>,
  taskId?: TaskId
) => {
  const task = trackerGraph.observation.snapshot.eligibleTasks().find(({ id }) => taskId === undefined || id === taskId)
  if (task === undefined) throw new Error("fixture graph must contain one eligible task")
  const transition = RunnableFrontierTransition.ContinueFreshWorkflowOperation({
    operationId: trackerGraph.observation.operationId,
    taskId: task.id
  })
  const proposal = deliveryProposalsOf({
    acceptedAt: trackerGraph.observation.recordedAt,
    acceptedOperationIds: new Set(),
    fresh: [
      {
        step: FreshWorkflowStep.ReadCurrentTaskGraph({
          predecessorOperationId: trackerGraph.observation.operationId,
          task
        }),
        transition
      }
    ],
    runId,
    transitions: [transition]
  }).ticketDelivery[0]
  if (proposal === undefined) throw new Error("fixture transition must derive one graph-read proposal")
  return proposal
}

const activeVerticalTaskA = TaskId.make("active-vertical-A")
const activeVerticalTaskB = TaskId.make("active-vertical-B")
const activeVerticalAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("active-vertical-attempt-A"),
  baseSha: GitCommitSha.make("2".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/active-vertical-A"),
  executor: TaskExecutorLocator.make("executor:active-vertical-A"),
  runId,
  taskId: activeVerticalTaskA,
  taskRevision: TaskRevision.make("active-vertical-A-revision"),
  worktree: WorktreeLocator.make("/stabilization/active-vertical-A")
})

const activeVerticalSuspensionProposal = () => {
  const transition = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({
    plannedAttempt: activeVerticalAttempt
  })
  const proposal = deliveryProposalsOf({
    acceptedAt: JournalPosition.make(1),
    acceptedOperationIds: new Set(),
    fresh: [],
    responsibilities: [
      {
        _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
        beganAt: JournalPosition.make(1),
        plannedAttempt: activeVerticalAttempt
      }
    ],
    runId,
    transitions: [transition]
  }).ticketDelivery[0]
  if (proposal === undefined) return expect.fail("fixture transition must derive one active suspension proposal")
  return proposal
}

const signalOf = (state: SubscriptionRef.SubscriptionRef<DeliveryRuntimeEvaluation>) =>
  currentSignalFromCurrentFirstStream(SubscriptionRef.changes(state))

const withRunFacts = (current: DeliveryRuntimeEvaluation, cancellationApplied: boolean): DeliveryRuntimeEvaluation => ({
  ...current,
  cancellationApplied,
  current: { ...current.current, cancellationApplied, runId }
})

const runtimeResourcesFor = Effect.fn("RunStabilizationTest.runtimeResourcesFor")(function* (
  lifecycle: ApplicationExitLifecycleService
) {
  const integrationTargets = yield* makeIntegrationTargetResourceController()
  return deliveryRuntimeResourceCapabilitiesLayer(
    yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets, lifecycle.admission)
  )
})

it.effect("starts no tracker stabilization read after the application Exit cutoff", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const g1 = graph("cutoff-before-G2", 1, snapshot("cutoff-before-G2", []))
      const state = yield* SubscriptionRef.make(evaluation(base, g1))
      const lifecycle = yield* makeApplicationExitLifecycle()
      const resources = yield* runtimeResourcesFor(lifecycle)
      const reads = yield* Ref.make(0)
      yield* lifecycle.requestExit

      const proof = yield* runStabilizedDelivery(target, signalOf(state)).pipe(
        Effect.provide(supportWithoutResources),
        Effect.provide(resources),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("cutoff G1 has no executable action") })
        ),
        Effect.provide(
          Layer.mock(WorkflowInterpreter, {
            readTrackerGraph: () => Ref.update(reads, (count) => count + 1).pipe(Effect.andThen(Effect.die("no G2")))
          })
        )
      )

      expect(yield* Ref.get(reads)).toBe(0)
      expect(proof.acceptedAt).toBe(g1.observation.recordedAt)
    })
  )
)

it.effect("returns RunMustRemainActive without G2 when task-work admission is stalled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const [a, b, c, d, e] = ["A", "B", "C", "D", "E"].map((name) =>
        makePreparedBeginFixture(activeVerticalAttempt, "stabilization-admission-stalled", name)
      )
      if (a === undefined || b === undefined || c === undefined || d === undefined || e === undefined) {
        return yield* Effect.die("five exact stabilization fixtures must be present")
      }
      const g1 = graph(
        "stabilization-admission-stalled-G1",
        1,
        snapshot("stabilization-admission-stalled-G1", [d.task, e.task])
      )
      const blocked = preparedBeginProposalsOf(runId, [d, e])
      expect(blocked).toMatchObject([
        {
          admission: {
            plannedAttemptProtocol: {
              _tag: "PlannedAttemptProtocolRequired",
              correlation: plannedAttemptExecutorCorrelation(d.attempt)
            },
            taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId: d.attempt.taskId }
          },
          order: { _tag: "FreshWorkflowOrder", frontierOrdinal: 0 },
          route: { _tag: "FreshExecutorWorkflowRoute", step: { plannedAttempt: d.attempt } }
        },
        {
          admission: {
            plannedAttemptProtocol: {
              _tag: "PlannedAttemptProtocolRequired",
              correlation: plannedAttemptExecutorCorrelation(e.attempt)
            },
            taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId: e.attempt.taskId }
          },
          order: { _tag: "FreshWorkflowOrder", frontierOrdinal: 1 },
          route: { _tag: "FreshExecutorWorkflowRoute", step: { plannedAttempt: e.attempt } }
        }
      ])
      const state = yield* SubscriptionRef.make<DeliveryRuntimeEvaluation>({
        ...withRunFacts(evaluation(base, g1, { ...emptyFrontier, proposals: blocked }), false),
        taskWork: {
          capacity: TaskWorkCapacity.make(3),
          held: [a, b, c].map(({ attempt }) => ({
            taskId: attempt.taskId,
            correlation: plannedAttemptExecutorCorrelation(attempt)
          }))
        }
      })
      const reads = yield* Ref.make(0)

      const proof = yield* runStabilizedDelivery(target, signalOf(state)).pipe(
        Effect.provide(support),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("full capacity must not execute D or E") })
        ),
        Effect.provide(
          Layer.mock(WorkflowInterpreter, {
            readTrackerGraph: () => Ref.update(reads, (count) => count + 1).pipe(Effect.andThen(Effect.die("no G2")))
          })
        )
      )

      expect(yield* Ref.get(reads)).toBe(0)
      expect(proof).toEqual({
        acceptedAt: g1.observation.recordedAt,
        decision: { _tag: "RunMustRemainActive", reason: "RunnableTransition" }
      })
    })
  )
)

it.effect("records a stabilization read admitted before Exit but starts no phase-two action", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const open = snapshot("cutoff-during-G2", [
        { id: TaskId.make("A"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
      ])
      const g1 = graph("cutoff-during-G2-G1", 1, open)
      const state = yield* SubscriptionRef.make(evaluation(base, g1))
      const lifecycle = yield* makeApplicationExitLifecycle()
      const resources = yield* runtimeResourcesFor(lifecycle)
      const readStarted = yield* Deferred.make<void>()
      const finishRead = yield* Deferred.make<void>()
      const executions = yield* Ref.make(0)
      const interpreter = Layer.mock(WorkflowInterpreter, {
        readTrackerGraph: (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) =>
          Deferred.succeed(readStarted, undefined).pipe(
            Effect.andThen(Deferred.await(finishRead)),
            Effect.flatMap(() => {
              const g2 = graph(operation.operationId, 4, open)
              return SubscriptionRef.set(
                state,
                evaluation(base, g2, { ...emptyFrontier, proposals: [freshGraphReadProposal(g2)] })
              ).pipe(Effect.as(open))
            })
          )
      })
      const running = yield* runStabilizedDelivery(target, signalOf(state)).pipe(
        Effect.provide(supportWithoutResources),
        Effect.provide(resources),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({
            execute: ({ proposal }) =>
              Ref.update(executions, (count) => count + 1).pipe(
                Effect.as({ _tag: "ActionCompleted", proposalId: proposal.id } as const)
              )
          })
        ),
        Effect.provide(interpreter),
        Effect.forkChild
      )

      yield* Deferred.await(readStarted)
      yield* lifecycle.requestExit
      yield* Deferred.succeed(finishRead, undefined)

      expect(yield* Fiber.join(running)).toEqual({
        acceptedAt: JournalPosition.make(4),
        decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
      })
      expect(yield* Ref.get(executions)).toBe(0)
    })
  )
)

it.effect("requests accepted G2 only after G1 becomes quiescent", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const g1 = graph(
        "G1-live-owner",
        1,
        snapshot("G1-live-owner", [
          { id: TaskId.make("A"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
        ])
      )
      const action = freshGraphReadProposal(g1)
      const state = yield* SubscriptionRef.make(evaluation(base, g1, { ...emptyFrontier, proposals: [action] }))
      const actionStarted = yield* Deferred.make<void>()
      const finishAction = yield* Deferred.make<void>()
      const reads = yield* Ref.make(0)
      const executor: DeliveryActionExecutorService = {
        execute: ({ proposal }) =>
          Deferred.succeed(actionStarted, undefined).pipe(
            Effect.andThen(Deferred.await(finishAction)),
            Effect.as({ _tag: "ActionCompleted", proposalId: proposal.id } as const)
          )
      }
      const interpreter = Layer.mock(WorkflowInterpreter, {
        readTrackerGraph: (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) =>
          Ref.update(reads, (count) => count + 1).pipe(
            Effect.andThen(
              SubscriptionRef.set(
                state,
                evaluation(base, graph(operation.operationId, 4, g1.observation.snapshot), emptyFrontier)
              )
            ),
            Effect.as(g1.observation.snapshot)
          )
      })
      const running = yield* runStabilizedDelivery(target, signalOf(state)).pipe(
        Effect.provide(support),
        Effect.provideService(DeliveryActionExecutor, DeliveryActionExecutor.of(executor)),
        Effect.provide(interpreter),
        Effect.forkChild
      )

      yield* Deferred.await(actionStarted)
      yield* SubscriptionRef.set(state, evaluation(base, g1, emptyFrontier))
      yield* Effect.yieldNow
      expect(yield* Ref.get(reads)).toBe(0)
      yield* Deferred.succeed(finishAction, undefined)
      expect((yield* Fiber.join(running)).decision).toEqual({
        _tag: "RunMustRemainActive",
        reason: "TrackerTargetUnsettled"
      })
      expect(yield* Ref.get(reads)).toBe(1)
    })
  )
)

it.effect("active-work refresh and post-quiescence finality perform cause-ordered separate complete graph reads", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const currentSnapshot = snapshot("active-boundary", [
        { id: TaskId.make("A"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
      ])
      const g1Operation = makeTrackerGraphObservationOperation(
        { _tag: "ExecutingWorkAuthorityCheck" },
        OperationId.make("active-boundary-G1"),
        target
      )
      const attemptId = AttemptId.make("active-boundary-attempt")
      const boundary: NonNullable<DeliveryRuntimeEvaluation["activeRefreshBoundary"]> = {
        _tag: "ActiveRefreshRuntimeBoundary" as const,
        runId,
        reconciledAttempts: [{ runId, attemptId }]
      }
      const state = yield* SubscriptionRef.make<DeliveryRuntimeEvaluation>(
        withRunFacts(evaluation(base, TrackerGraphState.cases.GraphNotEstablished.make({})), false)
      )
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
      const journal = appendableJournalFor(records)
      const providerOperations = yield* Ref.make<ReadonlyArray<TrackerGraphObservationOperation>>([])
      const provider = Layer.mock(WorkflowInterpreter, {
        readTrackerGraph: (operation: TrackerGraphObservationOperation) =>
          Ref.update(providerOperations, (current) => [...current, operation]).pipe(Effect.as(currentSnapshot))
      })
      const journaledInterpreter = yield* WorkflowInterpreter.pipe(
        Effect.provide(
          journaledWorkflowInterpreterLayer(runId, provider).pipe(Layer.provide(Layer.succeed(InRunJournal, journal)))
        )
      )
      const observingInterpreter = WorkflowInterpreter.of({
        ...journaledInterpreter,
        readTrackerGraph: (operation, onIntentRecorded, interruptibleBoundary) =>
          journaledInterpreter.readTrackerGraph(operation, onIntentRecorded, interruptibleBoundary).pipe(
            Effect.tap(() =>
              Effect.gen(function* () {
                const outcome = (yield* Ref.get(records)).find(
                  ({ event }) =>
                    event._tag === "TaskTrackerFactsObserved" && event.operationId === operation.operationId
                )
                if (outcome === undefined) return yield* Effect.die("ordinary graph read must append its outcome")
                yield* SubscriptionRef.set(state, {
                  ...withRunFacts(
                    evaluation(base, graph(operation.operationId, outcome.position, currentSnapshot, operation.cause)),
                    false
                  ),
                  activeRefreshBoundary: boundary
                })
              })
            )
          )
      })

      yield* observingInterpreter.readTrackerGraph(g1Operation)
      const proof = yield* runStabilizedDelivery(
        target,
        signalOf(state),
        activeWorkAuthorityRefreshForOwner("Timer", activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId }]))
      ).pipe(
        Effect.provide(support),
        Effect.provideService(InRunJournal, journal),
        Effect.provideService(WorkflowInterpreter, observingInterpreter),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("separate graph reads require no delivery action") })
        )
      )

      const operations = yield* Ref.get(providerOperations)
      expect(operations).toHaveLength(2)
      expect(operations[0]).toEqual(g1Operation)
      expect(operations[1]?.operationId).not.toBe(g1Operation.operationId)
      expect(operations.map(({ cause }) => cause._tag)).toEqual([
        "ExecutingWorkAuthorityCheck",
        "PostQuiescenceReconfirmation"
      ])
      const g2Operation = operations[1]
      if (g2Operation?.cause._tag !== "PostQuiescenceReconfirmation") {
        return yield* Effect.die("the second ordinary graph read must be post-quiescence finality")
      }
      expect(g2Operation.cause.quiescentGraphOperationId).toBe(g1Operation.operationId)
      expect(g2Operation.predecessorOperationIds).toContain(g1Operation.operationId)
      expect(
        (yield* Ref.get(records)).map(({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTrackerGraph"
            ? [event._tag, event.operation.operationId, event.operation.cause._tag]
            : event._tag === "TaskTrackerFactsObserved"
              ? [event._tag, event.operationId]
              : [event._tag]
        )
      ).toEqual([
        ["TaskTrackerReadIntentRecorded", g1Operation.operationId, "ExecutingWorkAuthorityCheck"],
        ["TaskTrackerFactsObserved", g1Operation.operationId],
        ["TaskTrackerReadIntentRecorded", g2Operation.operationId, "PostQuiescenceReconfirmation"],
        ["TaskTrackerFactsObserved", g2Operation.operationId]
      ])
      expect(proof.acceptedAt).toBe(JournalPosition.make(4))
    })
  )
)

it.effect("keeps a new active-refresh G2 nonterminal when its accepted publication is incomplete", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const cases = ["MissingAcceptedPosition", "Passive", "OwnershipConflict"] as const
      yield* Effect.forEach(cases, (kind) =>
        Effect.gen(function* () {
          const base = yield* baseEvaluation
          const currentSnapshot = snapshot(`active-G2-contract-${kind}`, [
            { id: TaskId.make("A"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
          ])
          const g1 = graph(`active-G2-contract-${kind}-G1`, 1, currentSnapshot, { _tag: "ExecutingWorkAuthorityCheck" })
          const attemptId = AttemptId.make(`active-G2-contract-${kind}-attempt`)
          const boundary: NonNullable<DeliveryRuntimeEvaluation["activeRefreshBoundary"]> = {
            _tag: "ActiveRefreshRuntimeBoundary",
            runId,
            reconciledAttempts: [{ runId, attemptId }]
          }
          const state = yield* SubscriptionRef.make<DeliveryRuntimeEvaluation>({
            ...withRunFacts(evaluation(base, g1), false),
            activeRefreshBoundary: boundary
          })
          const interpreter = Layer.mock(WorkflowInterpreter, {
            readTrackerGraph: (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) => {
              const g2 = graph(operation.operationId, 4, currentSnapshot)
              const proposal = freshGraphReadProposal(g2)
              const accepted = { ...withRunFacts(evaluation(base, g2), false), activeRefreshBoundary: boundary }
              const next: DeliveryRuntimeEvaluation =
                kind === "MissingAcceptedPosition"
                  ? { ...accepted, acceptedAt: null }
                  : kind === "Passive"
                    ? { ...accepted, quiescence: { _tag: "QuiescencePassive", reason: "RunPaused" } }
                    : {
                        ...accepted,
                        proposedActions: {
                          _tag: "DeliveryProposalOwnershipConflict",
                          conflicts: [
                            { id: proposal.id, order: proposal.order, owners: ["TrackerGraph", "TicketDelivery"] }
                          ]
                        }
                      }
              return SubscriptionRef.set(state, next).pipe(Effect.as(currentSnapshot))
            }
          })

          const proof = yield* runStabilizedDelivery(
            target,
            signalOf(state),
            activeWorkAuthorityRefreshForOwner("Timer", activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId }]))
          ).pipe(
            Effect.provide(support),
            Effect.provideService(
              DeliveryActionExecutor,
              DeliveryActionExecutor.of({ execute: () => Effect.die("incomplete G2 must not execute an action") })
            ),
            Effect.provide(interpreter)
          )

          expect(proof).toEqual({
            acceptedAt: kind === "MissingAcceptedPosition" ? null : JournalPosition.make(4),
            decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
          })
        })
      )
    })
  )
)

it.effect("replays an intent-only G2 after a crash without allocating a second identity", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const contents = snapshot("g2-crash-replay", [
        { id: activeVerticalTaskA, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
      ])
      const g1Operation = makeTrackerGraphObservationOperation(
        { _tag: "ExecutingWorkAuthorityCheck" },
        OperationId.make("g2-crash-G1"),
        target
      )
      const g1 = graph(g1Operation.operationId, 2, contents, g1Operation.cause)
      const g1Records: ReadonlyArray<JournalRecord> = [
        {
          event: taskTrackerReadIntent(g1Operation),
          key: intentRecordKey(g1Operation.operationId),
          position: JournalPosition.make(1),
          runId
        },
        {
          event: taskTrackerFactsObservedEvent(
            g1Operation.operationId,
            makeCompleteTaskTrackerFactsObserved(g1Operation, contents)
          ),
          key: outcomeRecordKey(g1Operation.operationId),
          position: JournalPosition.make(3),
          runId
        }
      ]
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>(g1Records)
      const journal = appendableJournalFor(records)
      const boundary: NonNullable<DeliveryRuntimeEvaluation["activeRefreshBoundary"]> = {
        _tag: "ActiveRefreshRuntimeBoundary",
        runId,
        reconciledAttempts: [{ runId, attemptId: activeVerticalAttempt.attemptId }]
      }
      const state = yield* SubscriptionRef.make<DeliveryRuntimeEvaluation>({
        ...withRunFacts(evaluation(base, g1), false),
        activeRefreshBoundary: boundary
      })
      const allocated = yield* Ref.make<ReadonlyArray<OperationId>>([])
      const reads = yield* Ref.make<ReadonlyArray<OperationId>>([])
      const allocator = OperationIdAllocator.of({
        allocate: () =>
          Ref.modify(allocated, (current) => {
            const operationId = OperationId.make(`g2-crash-fresh-${current.length}`)
            return [operationId, [...current, operationId]] as const
          })
      })
      const interpreter = Layer.mock(WorkflowInterpreter, {
        readTrackerGraph: (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) =>
          Effect.gen(function* () {
            const readNumber = yield* Ref.getAndUpdate(reads, (current) => [...current, operation.operationId])
            const call = readNumber.length
            yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
            if (call === 0) return yield* Effect.die("crash after G2 intent")
            const nextGraph = graph(operation.operationId, call === 1 ? 4 : 6, contents)
            yield* journal.append(
              runId,
              outcomeRecordKey(operation.operationId),
              taskTrackerFactsObservedEvent(
                operation.operationId,
                makeCompleteTaskTrackerFactsObserved(operation, contents)
              )
            )
            yield* SubscriptionRef.set(state, {
              ...withRunFacts(evaluation(base, nextGraph), false),
              activeRefreshBoundary: boundary
            })
            return contents
          })
      })
      const opportunity = activeWorkAuthorityRefreshForOwner(
        "Timer",
        activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId: activeVerticalAttempt.attemptId }])
      )
      const firstAttempt = yield* runStabilizedDelivery(target, signalOf(state), opportunity).pipe(
        Effect.provide(supportWithResourcesWithoutAllocator),
        Effect.provideService(InRunJournal, journal),
        Effect.provideService(OperationIdAllocator, allocator),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("G2 replay fixture has no action") })
        ),
        Effect.provide(interpreter),
        Effect.exit
      )

      expect(firstAttempt._tag).toBe("Failure")
      expect(yield* Ref.get(allocated)).toEqual([OperationId.make("g2-crash-fresh-0")])
      const afterCrash = yield* Ref.get(records)
      const replayableActiveIntent = afterCrash.find(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.operationId === OperationId.make("g2-crash-fresh-0")
      )
      expect(replayableActiveIntent).toBeDefined()
      expect(
        afterCrash
          .filter(({ event }) => event._tag === "TaskTrackerReadIntentRecorded")
          .map(({ event }) =>
            event._tag === "TaskTrackerReadIntentRecorded" ? event.operation.operationId : undefined
          )
      ).toEqual([g1Operation.operationId, OperationId.make("g2-crash-fresh-0")])
      expect(
        afterCrash.some(
          ({ event }) =>
            event._tag === "TaskTrackerFactsObserved" && event.operationId === OperationId.make("g2-crash-fresh-0")
        )
      ).toBe(false)

      yield* runStabilizedDelivery(target, signalOf(state), opportunity).pipe(
        Effect.provide(supportWithResourcesWithoutAllocator),
        Effect.provideService(InRunJournal, journal),
        Effect.provideService(OperationIdAllocator, allocator),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("G2 replay fixture has no action") })
        ),
        Effect.provide(interpreter)
      )
      expect(yield* Ref.get(reads)).toEqual([
        OperationId.make("g2-crash-fresh-0"),
        OperationId.make("g2-crash-fresh-0")
      ])
      expect(yield* Ref.get(allocated)).toEqual([OperationId.make("g2-crash-fresh-0")])

      const finalRecords = yield* Ref.get(records)
      expect(
        finalRecords
          .filter(({ event }) => event._tag === "TaskTrackerFactsObserved")
          .map(({ event }) => (event._tag === "TaskTrackerFactsObserved" ? event.operationId : undefined))
      ).toEqual([g1Operation.operationId, OperationId.make("g2-crash-fresh-0")])
    })
  )
)

it.effect("reopens ordinary delivery only from exact settled executor lifecycle evidence", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const correlation = plannedAttemptExecutorCorrelation(activeVerticalAttempt)
      const responsibility = PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: activeVerticalAttempt,
        version: workflowJournalEventVersion
      })
      const reportRecord = (
        report: PlannedAttemptExecutorReport,
        position = JournalPosition.make(2),
        ordinal = PlannedAttemptExecutorReportOrdinal.make(1)
      ): JournalRecord => ({
        event: PlannedAttemptExecutorWorkReportedEvent.make({ ordinal, report, version: workflowJournalEventVersion }),
        key: JournalRecordKey.make(`lifecycle-${report._tag}-${ordinal}`),
        position,
        runId
      })
      const responsibilityRecord: JournalRecord = {
        event: responsibility,
        key: JournalRecordKey.make("lifecycle-responsibility"),
        position: JournalPosition.make(1),
        runId
      }
      const executing = reportRecord(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
      const safe = reportRecord(
        PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation }),
        JournalPosition.make(4),
        PlannedAttemptExecutorReportOrdinal.make(2)
      )
      const terminal = reportRecord(
        PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Completed" } }),
        JournalPosition.make(5),
        PlannedAttemptExecutorReportOrdinal.make(2)
      )
      const laterNonExact: JournalRecord = {
        event: PlannedAttemptExecutorStateObservedEvent.make({
          observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({}),
          occurrenceClassification: "NonActionOccurrence",
          ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
          plannedAttempt: activeVerticalAttempt,
          version: workflowJournalEventVersion
        }),
        key: JournalRecordKey.make("lifecycle-later-non-exact"),
        position: JournalPosition.make(5),
        runId
      }
      const unacceptedSafe: JournalRecord = {
        event: PlannedAttemptExecutorStateObservedEvent.make({
          observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
          }),
          occurrenceClassification: "NonActionOccurrence",
          ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
          plannedAttempt: activeVerticalAttempt,
          version: workflowJournalEventVersion
        }),
        key: JournalRecordKey.make("lifecycle-unaccepted-safe"),
        position: JournalPosition.make(3),
        runId
      }
      const terminalCommandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
      const terminalCommandIntent: JournalRecord = {
        event: PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "Suspend",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: terminalCommandOrdinal,
          plannedAttempt: activeVerticalAttempt,
          version: workflowJournalEventVersion
        }),
        key: JournalRecordKey.make("lifecycle-terminal-command"),
        position: JournalPosition.make(3),
        runId
      }
      const unacceptedTerminal: JournalRecord = {
        event: PlannedAttemptExecutorCommandResponseObservedEvent.make({
          commandOrdinal: terminalCommandOrdinal,
          occurrenceClassification: "NonActionOccurrence",
          plannedAttempt: activeVerticalAttempt,
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
            correlation,
            result: { _tag: "Completed" }
          }),
          version: workflowJournalEventVersion
        }),
        key: JournalRecordKey.make("lifecycle-unaccepted-terminal"),
        position: JournalPosition.make(4),
        runId
      }
      const cases = [
        { expectedExecutions: 0, name: "missing responsibility", records: [] },
        { expectedExecutions: 0, name: "exact Executing", records: [responsibilityRecord, executing] },
        {
          expectedExecutions: 0,
          name: "exact Safe observation awaiting lifecycle acceptance",
          records: [responsibilityRecord, executing, unacceptedSafe]
        },
        {
          expectedExecutions: 0,
          name: "exact Terminal command response awaiting lifecycle acceptance",
          records: [responsibilityRecord, executing, terminalCommandIntent, unacceptedTerminal]
        },
        {
          expectedExecutions: 1,
          name: "accepted Safe after its exact observation",
          records: [responsibilityRecord, executing, unacceptedSafe, safe]
        },
        {
          expectedExecutions: 1,
          name: "accepted Terminal after its exact command response",
          records: [responsibilityRecord, executing, terminalCommandIntent, unacceptedTerminal, terminal]
        },
        {
          expectedExecutions: 0,
          name: "later non-exact projection",
          records: [responsibilityRecord, executing, unacceptedSafe, safe, laterNonExact]
        }
      ] as const

      for (const lifecycleCase of cases) {
        const base = yield* baseEvaluation
        const currentGraph = graph(
          `lifecycle-reopen-${lifecycleCase.name}`,
          4,
          snapshot(`lifecycle-reopen-${lifecycleCase.name}`, [
            { id: activeVerticalTaskA, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
            { id: activeVerticalTaskB, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
          ])
        )
        const independentProposal = freshGraphReadProposal(currentGraph, activeVerticalTaskB)
        const state = yield* SubscriptionRef.make<DeliveryRuntimeEvaluation>({
          ...withRunFacts(
            evaluation(base, currentGraph, { ...emptyFrontier, proposals: [independentProposal] }),
            false
          ),
          activeRefreshBoundary: { _tag: "ActiveRefreshRuntimeBoundary", reconciledAttempts: [correlation], runId }
        })
        const executions = yield* Ref.make(0)
        const journal = InRunJournal.of({
          append: () => Effect.die("lifecycle reopening reads but never appends executor evidence"),
          read: () => Effect.succeed(lifecycleCase.records)
        })

        yield* runStabilizedDelivery(
          target,
          signalOf(state),
          activeWorkAuthorityRefreshForOwner("Timer", activeWorkAuthorityRefreshSubjectsFor([correlation]))
        ).pipe(
          Effect.provide(
            Layer.merge(
              supportWithResourcesWithoutAllocator,
              deterministicOperationIdAllocatorLayer(`lifecycle-reopen-${lifecycleCase.name}`)
            )
          ),
          Effect.provideService(InRunJournal, journal),
          Effect.provideService(
            DeliveryActionExecutor,
            DeliveryActionExecutor.of({
              execute: ({ proposal }) =>
                Ref.update(executions, (count) => count + 1).pipe(
                  Effect.andThen(
                    SubscriptionRef.update(state, (current) => ({ ...current, proposedActions: emptyFrontier }))
                  ),
                  Effect.as({ _tag: "ActionCompleted", proposalId: proposal.id } as const)
                )
            })
          ),
          Effect.provide(
            Layer.mock(WorkflowInterpreter, {
              readTrackerGraph: () => Effect.die("lifecycle reopening does not perform another tracker read")
            })
          )
        )

        expect(yield* Ref.get(executions), lifecycleCase.name).toBe(lifecycleCase.expectedExecutions)
      }
    })
  )
)

it.effect("holds an actual independent fresh route until G2 after direct safe or terminal A settlement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const reports = [
        PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
          correlation: { attemptId: activeVerticalAttempt.attemptId, runId }
        }),
        PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation: { attemptId: activeVerticalAttempt.attemptId, runId },
          result: { _tag: "Completed" }
        })
      ] as const

      for (const report of reports) {
        const base = yield* baseEvaluation
        const g1 = graph(
          `active-vertical-${report._tag}-G1`,
          1,
          snapshot(`active-vertical-${report._tag}-G1`, [
            { id: activeVerticalTaskA, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
            { id: activeVerticalTaskB, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
          ]),
          { _tag: "ExecutingWorkAuthorityCheck" }
        )
        const activeProposal = activeVerticalSuspensionProposal()
        const preG2Independent = freshGraphReadProposal(g1, activeVerticalTaskB)
        expect(preG2Independent.route._tag).toBe("FreshWorkflowRoute")
        const boundary: NonNullable<DeliveryRuntimeEvaluation["activeRefreshBoundary"]> = {
          _tag: "ActiveRefreshRuntimeBoundary" as const,
          runId,
          reconciledAttempts: [{ runId, attemptId: activeVerticalAttempt.attemptId }]
        }
        const capacityTwo = TaskWorkCapacity.make(2)
        const initial = {
          ...withRunFacts(
            evaluation(base, g1, { ...emptyFrontier, proposals: [activeProposal, preG2Independent] }),
            false
          ),
          taskWork: {
            capacity: capacityTwo,
            held: [
              {
                taskId: activeVerticalAttempt.taskId,
                correlation: { attemptId: activeVerticalAttempt.attemptId, runId }
              }
            ]
          }
        } satisfies DeliveryRuntimeEvaluation
        const opportunity = activeWorkAuthorityRefreshForOwner(
          "Timer",
          activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId: activeVerticalAttempt.attemptId }])
        )
        const state = yield* SubscriptionRef.make<DeliveryRuntimeEvaluation>(initial)
        const graphReads = yield* Ref.make(0)
        const admitted = yield* Ref.make<ReadonlyArray<string>>([])
        const executed = yield* Ref.make<ReadonlyArray<string>>([])
        const preG2IndependentWasAdmitted = yield* Ref.make(false)
        const activeCompleted = yield* Deferred.make<void>()
        const interpreter = Layer.mock(WorkflowInterpreter, {
          readTrackerGraph: (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) =>
            Effect.gen(function* () {
              yield* Ref.update(graphReads, (count) => count + 1)
              const g2 = graph(
                operation.operationId,
                4,
                snapshot(`active-vertical-${report._tag}-G2`, [
                  { id: activeVerticalTaskA, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
                  { id: activeVerticalTaskB, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
                ])
              )
              const postG2Independent = freshGraphReadProposal(g2, activeVerticalTaskB)
              expect(postG2Independent.route._tag).toBe("FreshWorkflowRoute")
              yield* SubscriptionRef.set(state, {
                ...withRunFacts(evaluation(base, g2, { ...emptyFrontier, proposals: [postG2Independent] }), false),
                activeRefreshBoundary: boundary,
                taskWork: { capacity: capacityTwo, held: [] }
              })
              return g2.observation.snapshot
            })
        })
        const executor: DeliveryActionExecutorService = {
          execute: ({ proposal }) =>
            Effect.gen(function* () {
              yield* Ref.update(executed, (ids) => [...ids, proposal.id])
              if (proposal.id === activeProposal.id) {
                expect(proposal.route).toMatchObject({
                  _tag: "IdentityFreeWorkflowRoute",
                  transition: { _tag: "SuspendPlannedAttemptExecutorWork" }
                })
                expect(yield* Ref.get(graphReads)).toBe(0)
                // The active report establishes the typed completion boundary. Removing both
                // proposals makes the pre-G2 quiescent point explicit. If the pre-G2 filter is
                // removed, B may already have a live owner; it waits for this completion and
                // the final assertion records that ordering violation.
                yield* SubscriptionRef.update(state, (current) => ({
                  ...current,
                  activeRefreshBoundary: boundary,
                  proposedActions: emptyFrontier
                }))
                yield* Deferred.succeed(activeCompleted, undefined)
                return {
                  _tag: "ExecutorReportPublished",
                  acceptedFacts: "Changed",
                  plannedAttempt: activeVerticalAttempt,
                  proposalId: activeProposal.id,
                  report
                } as const
              }
              if (proposal.route._tag !== "FreshWorkflowRoute") {
                return yield* Effect.die("the independent post-G2 action must retain its fresh workflow route")
              }
              expect(proposal.route.step.task.id).toBe(activeVerticalTaskB)
              if ((yield* Ref.get(graphReads)) === 0) {
                yield* Ref.set(preG2IndependentWasAdmitted, true)
                yield* Deferred.await(activeCompleted)
              }
              yield* SubscriptionRef.update(state, (current) => ({ ...current, proposedActions: emptyFrontier }))
              return { _tag: "ActionCompleted", proposalId: proposal.id } as const
            })
        }
        const trace = DeliverySemanticTrace.of({
          emit: (event) =>
            event._tag === "ProposalAdmitted" ? Ref.update(admitted, (ids) => [...ids, event.proposalId]) : Effect.void
        })

        const proof = yield* runStabilizedDelivery(target, signalOf(state), opportunity).pipe(
          Effect.provide(support),
          Effect.provideService(DeliveryActionExecutor, DeliveryActionExecutor.of(executor)),
          Effect.provideService(DeliverySemanticTrace, trace),
          Effect.provide(interpreter)
        )

        expect(yield* Ref.get(graphReads)).toBe(1)
        expect(yield* Ref.get(preG2IndependentWasAdmitted)).toBe(false)
        expect(yield* Ref.get(executed)).toHaveLength(2)
        expect(yield* Ref.get(admitted)).toHaveLength(2)
        const executedIds = yield* Ref.get(executed)
        const admittedIds = yield* Ref.get(admitted)
        expect(executedIds[0]).toBe(activeProposal.id)
        expect(admittedIds[0]).toBe(activeProposal.id)
        expect(executedIds[1]).not.toBe(preG2Independent.id)
        expect(admittedIds[1]).not.toBe(preG2Independent.id)
        expect(proof.decision).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
      }
    })
  )
)

it.effect("runs independent work revealed by G2 while the active subject remains held", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const taskA = TaskId.make("A")
      const taskB = TaskId.make("B")
      const g1 = graph(
        "active-boundary-independent-G1",
        1,
        snapshot("active-boundary-independent-G1", [
          { id: taskA, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
        ]),
        { _tag: "ExecutingWorkAuthorityCheck" }
      )
      const g2 = graph(
        "active-boundary-independent-G2",
        4,
        snapshot("active-boundary-independent-G2", [
          { id: taskA, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
          { id: taskB, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
        ])
      )
      const attemptId = activeVerticalAttempt.attemptId
      const boundary: NonNullable<DeliveryRuntimeEvaluation["activeRefreshBoundary"]> = {
        _tag: "ActiveRefreshRuntimeBoundary" as const,
        runId,
        reconciledAttempts: [{ runId, attemptId }]
      }
      const independentProposal = freshGraphReadProposal(g2, taskB)
      const activePostG2Proposal = activeVerticalSuspensionProposal()
      const state = yield* SubscriptionRef.make<DeliveryRuntimeEvaluation>({
        ...withRunFacts(evaluation(base, g1, { ...emptyFrontier, proposals: [independentProposal] }), false),
        activeRefreshBoundary: boundary
      })
      const reads = yield* Ref.make(0)
      const executions = yield* Ref.make<ReadonlyArray<string>>([])
      const executionBeforeG2 = yield* Ref.make(false)
      const interpreter = Layer.mock(WorkflowInterpreter, {
        readTrackerGraph: (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) =>
          Ref.update(reads, (count) => count + 1).pipe(
            Effect.andThen(
              SubscriptionRef.set(state, {
                ...withRunFacts(
                  evaluation(base, graph(operation.operationId, 4, g2.observation.snapshot), {
                    ...emptyFrontier,
                    // G2 may leave the captured subject in the descriptive
                    // frontier. The post-G2 phase must suppress that stale
                    // active chain while retaining independent fresh work.
                    proposals: [activePostG2Proposal, independentProposal]
                  }),
                  false
                ),
                activeRefreshBoundary: boundary,
                taskWork: {
                  capacity: TaskWorkCapacity.make(2),
                  held: [{ taskId: taskA, correlation: { runId, attemptId } }]
                }
              })
            ),
            Effect.as(g2.observation.snapshot)
          )
      })
      const proof = yield* runStabilizedDelivery(
        target,
        signalOf(state),
        activeWorkAuthorityRefreshForOwner("Timer", activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId }]))
      ).pipe(
        Effect.provide(support),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({
            execute: ({ proposal }) =>
              Effect.gen(function* () {
                if ((yield* Ref.get(reads)) === 0) yield* Ref.set(executionBeforeG2, true)
                yield* Ref.update(executions, (ids) => [...ids, proposal.id])
                yield* SubscriptionRef.update(state, (current) => ({ ...current, proposedActions: emptyFrontier }))
                return { _tag: "ActionCompleted", proposalId: proposal.id } as const
              })
          })
        ),
        Effect.provide(interpreter)
      )

      expect(yield* Ref.get(reads)).toBe(1)
      expect(yield* Ref.get(executions)).toEqual([independentProposal.id])
      expect(yield* Ref.get(executionBeforeG2)).toBe(false)
      expect(proof.decision).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
    })
  )
)

it.effect("runs work published after G2 before phase two subscribes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const openA = snapshot("post-G2-work", [
        { id: TaskId.make("A"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
      ])
      const g1 = graph("post-G2-G1", 1, openA)
      const state = yield* SubscriptionRef.make(evaluation(base, g1))
      const attachmentCount = yield* Ref.make(0)
      const executions = yield* Ref.make(0)
      const underlying = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(state))
      const signal = {
        ...underlying,
        attach: Ref.updateAndGet(attachmentCount, (count) => count + 1).pipe(
          Effect.flatMap((count) => {
            if (count !== 3) return underlying.attach
            return SubscriptionRef.get(state).pipe(
              Effect.flatMap((current) => {
                if (current.current.trackerGraph._tag !== "GraphEstablished") return underlying.attach
                return SubscriptionRef.set(
                  state,
                  evaluation(base, current.current.trackerGraph, {
                    ...emptyFrontier,
                    proposals: [freshGraphReadProposal(current.current.trackerGraph)]
                  })
                ).pipe(Effect.andThen(underlying.attach))
              })
            )
          })
        )
      }
      const interpreter = Layer.mock(WorkflowInterpreter, {
        readTrackerGraph: (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) => {
          const g2 = graph(operation.operationId, 4, openA)
          return SubscriptionRef.set(state, evaluation(base, g2)).pipe(Effect.as(openA))
        }
      })
      const executor: DeliveryActionExecutorService = {
        execute: ({ proposal }) =>
          Ref.update(executions, (count) => count + 1).pipe(
            Effect.andThen(
              SubscriptionRef.update(state, (current) => ({ ...current, proposedActions: emptyFrontier }))
            ),
            Effect.as({ _tag: "ActionCompleted", proposalId: proposal.id } as const)
          )
      }

      yield* runStabilizedDelivery(target, signal).pipe(
        Effect.provide(support),
        Effect.provideService(DeliveryActionExecutor, DeliveryActionExecutor.of(executor)),
        Effect.provide(interpreter)
      )

      expect(yield* Ref.get(executions)).toBe(1)
    })
  )
)

it.effect("retains accepted integration ownership through G2 and releases it once after phase two", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const g1 = graph("resource-G1", 1, snapshot("resource-G1", []))
      const state = yield* SubscriptionRef.make(evaluation(base, g1))
      const controller = yield* makeIntegrationTargetResourceController()
      const responsibility = {
        integrationTarget: IntegrationTarget.make({
          repository: GitRepositoryLocator.make("/resource-retention.git"),
          ref: IntegrationTargetRef.make("refs/heads/master")
        }),
        queuedAt: JournalPosition.make(2)
      }
      yield* controller.acquire(responsibility)
      yield* controller.publishAcceptedOwnership(responsibility)
      const releases = yield* Ref.make(0)
      const observedAfterG2 = yield* Ref.make(false)
      const attachmentCount = yield* Ref.make(0)
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(
        {
          ...controller,
          releaseAll: Ref.update(releases, (count) => count + 1).pipe(Effect.andThen(controller.releaseAll))
        },
        (yield* makeApplicationExitLifecycle()).admission
      )
      const underlying = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(state))
      const signal = {
        ...underlying,
        attach: Ref.updateAndGet(attachmentCount, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count === 3
              ? controller.snapshot.pipe(
                  Effect.tap(({ heldResponsibilityPositions }) =>
                    Ref.set(observedAfterG2, heldResponsibilityPositions.has(responsibility.queuedAt))
                  ),
                  Effect.andThen(underlying.attach)
                )
              : underlying.attach
          )
        )
      }
      const interpreter = Layer.mock(WorkflowInterpreter, {
        readTrackerGraph: (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) =>
          Effect.gen(function* () {
            expect((yield* controller.snapshot).heldResponsibilityPositions).toContain(responsibility.queuedAt)
            expect(yield* Ref.get(releases)).toBe(0)
            const g2 = graph(operation.operationId, 4, g1.observation.snapshot)
            yield* SubscriptionRef.set(state, evaluation(base, g2))
            return g1.observation.snapshot
          })
      })

      yield* runStabilizedDelivery(target, signal).pipe(
        Effect.provide(supportWithoutResources),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("resource fixture has no executable action") })
        ),
        Effect.provide(interpreter)
      )

      expect(yield* Ref.get(observedAfterG2)).toBe(true)
      expect(yield* Ref.get(releases)).toBe(1)
      expect((yield* controller.snapshot).heldResponsibilityPositions).toEqual(new Set())
    })
  )
)

it.effect("returns without terminating after equal G2 leaves the Run incomplete", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const sameContents = snapshot("equal-contents", [
        {
          id: TaskId.make("A"),
          lifecycle: { _tag: "TerminalWithoutSuccess" },
          parentTaskId: null,
          prerequisiteIds: []
        },
        { id: TaskId.make("B"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [TaskId.make("A")] }
      ])
      const g1 = graph("equal-G1", 1, sameContents)
      const state = yield* SubscriptionRef.make(evaluation(base, g1))
      const acceptedOperation = yield* Ref.make<OperationId | null>(null)
      const interpreter = Layer.mock(WorkflowInterpreter, {
        readTrackerGraph: (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) => {
          const g2 = graph(operation.operationId, 4, sameContents)
          return Ref.set(acceptedOperation, operation.operationId).pipe(
            Effect.andThen(SubscriptionRef.set(state, evaluation(base, g2))),
            Effect.as(sameContents)
          )
        }
      })
      const proof = yield* runStabilizedDelivery(target, signalOf(state)).pipe(
        Effect.provide(support),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("equal G2 has no executable action") })
        ),
        Effect.provide(interpreter)
      )
      const g2 = (yield* SubscriptionRef.get(state)).current.trackerGraph
      expect(g2._tag).toBe("GraphEstablished")
      if (g2._tag !== "GraphEstablished") return
      expect(g2.observation.operationId).toBe(yield* Ref.get(acceptedOperation))
      expect(g2.observation.operationId).not.toBe(g1.observation.operationId)
      expect(g2.observation.recordedAt).toBeGreaterThan(g1.observation.recordedAt)
      expect(g2.observation.contentIdentity).toBe(g1.observation.contentIdentity)
      expect(frontierOf({ exactEvidence: [], graph: g2, policy }).standings).toEqual([
        { _tag: "Excluded", reasons: [{ _tag: "TerminalWithoutSuccess" }], taskId: TaskId.make("A") },
        {
          _tag: "Excluded",
          reasons: [{ _tag: "PrerequisitesIncomplete", prerequisiteTaskIds: [TaskId.make("A")] }],
          taskId: TaskId.make("B")
        }
      ])
      expect(proof).toEqual({
        acceptedAt: JournalPosition.make(4),
        decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
      })
    })
  )
)

it.effect("does not request G2 while the Run is paused", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const g1 = graph("paused-G1", 1, snapshot("paused-G1", []))
      const paused = {
        ...evaluation(base, g1),
        quiescence: { _tag: "QuiescencePassive" as const, reason: "RunPaused" as const }
      }
      const reads = yield* Ref.make(0)
      const proof = yield* runStabilizedDelivery(target, currentSignalOf(paused)).pipe(
        Effect.provide(support),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("paused Run has no executable action") })
        ),
        Effect.provide(
          Layer.mock(WorkflowInterpreter, {
            readTrackerGraph: () => Ref.update(reads, (count) => count + 1).pipe(Effect.andThen(Effect.die("no G2")))
          })
        )
      )

      expect(yield* Ref.get(reads)).toBe(0)
      expect(proof).toEqual({
        acceptedAt: g1.observation.recordedAt,
        decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
      })
    })
  )
)

it.effect("does not request G2 when a cancelled passive Run has no accepted G1", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const g1 = graph(
        "cancelled-without-G1",
        1,
        snapshot(
          "cancelled-without-G1",
          [{ id: TaskId.make("root"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }],
          TaskId.make("root")
        )
      )
      const current = withRunFacts(evaluation(base, g1), true)
      const reads = yield* Ref.make(0)
      const proof = yield* runStabilizedDelivery(
        target,
        currentSignalOf({
          ...current,
          acceptedAt: null,
          quiescence: { _tag: "QuiescencePassive" as const, reason: "RunPaused" as const }
        })
      ).pipe(
        Effect.provide(support),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("cancelled Run has no executable action") })
        ),
        Effect.provide(
          Layer.mock(WorkflowInterpreter, {
            readTrackerGraph: () => Ref.update(reads, (count) => count + 1).pipe(Effect.andThen(Effect.die("no G2")))
          })
        )
      )

      expect(yield* Ref.get(reads)).toBe(0)
      expect(proof).toEqual({
        acceptedAt: null,
        decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
      })
    })
  )
)

it.effect("performs a fresh graph read before classifying a paused cancelled Run", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const notAllSucceeded = snapshot(
        "paused-cancelled-G2",
        [{ id: TaskId.make("root"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }],
        TaskId.make("root")
      )
      const g1 = graph("paused-cancelled-G1", 1, notAllSucceeded)
      const state = yield* SubscriptionRef.make<DeliveryRuntimeEvaluation>({
        ...withRunFacts(evaluation(base, g1), true),
        quiescence: { _tag: "QuiescencePassive" as const, reason: "RunPaused" as const }
      })
      const reads = yield* Ref.make(0)
      const interpreter = Layer.mock(WorkflowInterpreter, {
        readTrackerGraph: (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) => {
          const g2 = graph(operation.operationId, 4, notAllSucceeded)
          return Ref.update(reads, (count) => count + 1).pipe(
            Effect.andThen(
              SubscriptionRef.set(state, {
                ...withRunFacts(evaluation(base, g2), true),
                quiescence: { _tag: "QuiescencePassive" as const, reason: "RunPaused" as const }
              })
            ),
            Effect.as(notAllSucceeded)
          )
        }
      })

      const proof = yield* runStabilizedDelivery(target, signalOf(state)).pipe(
        Effect.provide(support),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("paused cancellation has no executable action") })
        ),
        Effect.provide(interpreter)
      )

      expect(yield* Ref.get(reads)).toBe(1)
      expect(proof).toMatchObject({
        decision: { _tag: "RunMayTerminate" },
        disposition: "Cancelled",
        evidence: { graphOutcome: "Unsettled", runId, target }
      })
    })
  )
)

it.effect("classifies an applied cancellation only after a fresh non-success graph read", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const notAllSucceeded = snapshot(
        "cancelled-G2",
        [{ id: TaskId.make("root"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }],
        TaskId.make("root")
      )
      const g1 = graph("cancelled-G1", 1, notAllSucceeded)
      const state = yield* SubscriptionRef.make(withRunFacts(evaluation(base, g1), true))
      const interpreter = Layer.mock(WorkflowInterpreter, {
        readTrackerGraph: (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) => {
          const g2 = graph(operation.operationId, 4, notAllSucceeded)
          return SubscriptionRef.set(state, withRunFacts(evaluation(base, g2), true)).pipe(Effect.as(notAllSucceeded))
        }
      })

      const proof = yield* runStabilizedDelivery(target, signalOf(state)).pipe(
        Effect.provide(support),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("cancelled fixture has no executable action") })
        ),
        Effect.provide(interpreter)
      )

      expect(proof).toMatchObject({
        decision: { _tag: "RunMayTerminate" },
        disposition: "Cancelled",
        evidence: { graphOutcome: "Unsettled", runId, target }
      })
    })
  )
)

it.effect("keeps Completed precedence when every task succeeded after cancellation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const succeeded = snapshot(
        "cancelled-but-completed-G2",
        [
          {
            id: TaskId.make("root"),
            lifecycle: { _tag: "CompletedSuccessfully" },
            parentTaskId: null,
            prerequisiteIds: []
          }
        ],
        TaskId.make("root")
      )
      const g1 = graph("cancelled-but-completed-G1", 1, succeeded)
      const state = yield* SubscriptionRef.make(withRunFacts(evaluation(base, g1), true))
      const interpreter = Layer.mock(WorkflowInterpreter, {
        readTrackerGraph: (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) => {
          const g2 = graph(operation.operationId, 4, succeeded)
          return SubscriptionRef.set(state, withRunFacts(evaluation(base, g2), true)).pipe(Effect.as(succeeded))
        }
      })

      const proof = yield* runStabilizedDelivery(target, signalOf(state)).pipe(
        Effect.provide(support),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("completed fixture has no executable action") })
        ),
        Effect.provide(interpreter)
      )

      expect(proof).toMatchObject({
        decision: { _tag: "RunMayTerminate" },
        disposition: "Completed",
        evidence: { graphOutcome: "AllTasksSucceeded", runId, target }
      })
    })
  )
)

it.effect("classifies conclusive tracker dependency impossibility as Blocked", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const blocked = snapshot(
        "blocked-G2",
        [
          {
            id: TaskId.make("failed"),
            lifecycle: { _tag: "TerminalWithoutSuccess" },
            parentTaskId: null,
            prerequisiteIds: []
          },
          {
            id: TaskId.make("dependent"),
            lifecycle: { _tag: "Open" },
            parentTaskId: null,
            prerequisiteIds: [TaskId.make("failed")]
          }
        ],
        TaskId.make("failed")
      )
      const g1 = graph("blocked-G1", 1, blocked)
      const state = yield* SubscriptionRef.make(withRunFacts(evaluation(base, g1), false))
      const interpreter = Layer.mock(WorkflowInterpreter, {
        readTrackerGraph: (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) => {
          const g2 = graph(operation.operationId, 4, blocked)
          return SubscriptionRef.set(state, withRunFacts(evaluation(base, g2), false)).pipe(Effect.as(blocked))
        }
      })

      const proof = yield* runStabilizedDelivery(target, signalOf(state)).pipe(
        Effect.provide(support),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("blocked fixture has no executable action") })
        ),
        Effect.provide(interpreter)
      )

      expect(proof).toMatchObject({
        decision: { _tag: "RunMayTerminate" },
        disposition: "Blocked",
        evidence: {
          blockedTaskIds: [TaskId.make("dependent"), TaskId.make("failed")],
          graphOutcome: "Blocked",
          terminalTaskIds: [TaskId.make("failed")]
        }
      })
    })
  )
)
