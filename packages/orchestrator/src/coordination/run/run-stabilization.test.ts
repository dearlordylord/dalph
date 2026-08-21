import {
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  RunId,
  TaskExecutorLocator,
  TaskId,
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
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import type { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { InRunJournal } from "../../workflow-journal/store.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { DeliveryActionExecutor, type DeliveryActionExecutorService } from "../delivery/delivery-action-executor.js"
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
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { type ApplicationExitLifecycleService, makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
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

const graph = (operation: string, recordedAt: number, current: TaskDagSnapshot) => {
  const established = TrackerGraphState.cases.GraphEstablished.make({
    observation: makeTestJournaledTrackerGraphObservation({
      operationId: OperationId.make(operation),
      recordedAt: JournalPosition.make(recordedAt),
      snapshot: current
    })
  })
  if (established._tag !== "GraphEstablished") throw new Error("established graph constructor must be exact")
  return established
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

const freshGraphReadProposal = (trackerGraph: Extract<TrackerGraphState, { readonly _tag: "GraphEstablished" }>) => {
  const task = trackerGraph.observation.snapshot.eligibleTasks()[0]
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
