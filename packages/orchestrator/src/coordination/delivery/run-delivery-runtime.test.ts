import { it } from "@effect/vitest"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
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
import { Deferred, Effect, Fiber, Layer, Option, Ref, Stream, SubscriptionRef } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { IntegratorBoundaryUnavailable } from "./integrator-boundary.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  OperationIdAllocator
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { InterruptibleWorkflowBoundaryIntent } from "../../workflow/interpretation/interpreter.js"
import {
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTargetLineageObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  TaskClaimReleaseAuthority
} from "../../workflow/registry/operation.js"
import { AttemptChoiceRequestId } from "../../workflow/protocols/attempt-choice/events.js"
import { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import { taskClaimReacquisitionOperationId } from "../../workflow/protocols/task-claim-reacquisition/plan.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { ResponsibilityDisposition } from "../frontier/fresh-facts.js"
import {
  acceptedWorkflowTransitionOperationId,
  DeliveryProposalId,
  deliveryProposalsOf,
  trackerGraphReadProposalOf
} from "./delivery-proposal.js"
import {
  DeliveryActionExecutor,
  type DeliveryActionResult,
  DeliverySemanticTrace,
  interruptibleBoundaryOf
} from "./delivery-action-executor.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import { liveActionKeyOf, proposalIsPresent } from "./live-delivery-action.js"
import {
  currentSignalOf,
  currentSignalFromCurrentFirstStream,
  type DeliveryActionProposal,
  type DeliveryProposalFrontier,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeEvaluation,
  deliveryFinalityOf,
  TrackerGraphState
} from "./relations.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../test/journaled-graph-observation.js"
import {
  DeliveryRuntimeProposalOwnershipConflict,
  DeliveryRuntimeReconfirmationStateInvalid,
  DeliveryRuntimePhase,
  runDeliveryRuntimePhase,
  runDeliveryRuntime,
  type DeliveryRuntimeInput
} from "./run-delivery-runtime.js"
import {
  type DeliveryRuntimeResourceCapabilities,
  deliveryRuntimeResourceCapabilitiesLayer,
  deliveryRuntimeResourceCapabilitiesOf as makeCapabilitiesWithAdmission,
  deliveryRuntimeResourcesLayer
} from "./delivery-runtime-resources.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import type { DeliveryRuntimeObservationState } from "./delivery-runtime-observation.js"
import {
  makePlannedAttemptProtocolController,
  PlannedAttemptProtocolController,
  plannedAttemptProtocolControllerLayer
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import type { DeliveryRuntimeAdmissionController } from "./delivery-runtime-admission.js"

const deliveryRuntimeResourceCapabilitiesOf = Effect.fn("RunDeliveryRuntimeTest.makeCapabilities")(function* (
  integrationTargets: Parameters<typeof makeCapabilitiesWithAdmission>[0]
) {
  return yield* makeCapabilitiesWithAdmission(integrationTargets, (yield* makeApplicationExitLifecycle()).admission)
})

const testDeliveryRuntimeResourcesLayer = Layer.unwrap(
  makeApplicationExitLifecycle().pipe(Effect.map((lifecycle) => deliveryRuntimeResourcesLayer(lifecycle.admission)))
)

const runDeliveryRuntimeQuiescence = <E>(relation: DeliveryRuntimeInput<E>) => runDeliveryRuntime(relation)

const runDeliveryRuntimeDecision = <E>(relation: DeliveryRuntimeInput<E>) =>
  runDeliveryRuntimeQuiescence(relation).pipe(
    Effect.map(({ current, disposition, proposedActions }) => deliveryFinalityOf(current, proposedActions, disposition))
  )

const runId = RunId.make("runtime-test-run")
const target = FixtureTarget.make("runtime-test-target")
const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(2)
})

const plannerLayer = deterministicPlannedTaskAttemptLayer({
  baseSha: GitCommitSha.make("1".repeat(40)),
  executor: TaskExecutorLocator.make("executor:runtime-test"),
  runId,
  worktreeRoot: WorktreeLocator.make("/runtime-test")
})
const identityLayers = Layer.mergeAll(
  deterministicOperationIdAllocatorLayer("runtime-operation"),
  plannerLayer,
  testDeliveryRuntimeResourcesLayer,
  plannedAttemptProtocolControllerLayer
)

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("runtime-test-attempt"),
  baseSha: GitCommitSha.make("2".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/runtime-test"),
  executor: TaskExecutorLocator.make("executor:runtime-test"),
  runId,
  taskId: TaskId.make("runtime-recovered-task"),
  taskRevision: TaskRevision.make("runtime-test-revision"),
  worktree: WorktreeLocator.make("/runtime-test/recovered")
})

const independentPlannedAttempt = PlannedTaskAttempt.make({
  ...plannedAttempt,
  attemptId: AttemptId.make("runtime-test-independent-attempt"),
  taskId: TaskId.make("runtime-independent-task")
})

const proposal = (ordinal: number, taskId: TaskId): DeliveryActionProposal => ({
  ...trackerGraphReadProposalOf({
    acceptedAt: JournalPosition.make(ordinal + 1),
    purpose: "EstablishCurrentGraph",
    runId,
    target
  }),
  admission: {
    integrationTarget: { _tag: "NoIntegrationTargetResource" },
    plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" },
    taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId }
  },
  id: DeliveryProposalId.make(`runtime-proposal:${ordinal}:${taskId}`),
  order: { _tag: "FreshWorkflowOrder", frontierOrdinal: ordinal as never, step: "ReadCurrentTaskGraph", taskId },
  owner: "TicketDelivery"
})

const handoffCorrelation = { attemptId: AttemptId.make("runtime-admission-handoff-attempt"), runId }
const handoffIntegrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/runtime-test/admission-handoff.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const handoffProposal = (): DeliveryActionProposal => ({
  ...proposal(0, TaskId.make("runtime-admission-handoff-task")),
  admission: {
    integrationTarget: {
      _tag: "IntegrationTargetResourceRequired",
      access: "Acquire",
      integrationTarget: handoffIntegrationTarget,
      queuedAt: JournalPosition.make(42)
    },
    plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired", correlation: handoffCorrelation },
    taskWorkPosition: {
      _tag: "TaskWorkPositionRequired",
      mode: "ReserveOrReuse",
      taskId: TaskId.make("runtime-admission-handoff-task")
    }
  },
  id: DeliveryProposalId.make("runtime-admission-handoff")
})

const recoveredProposalFor = (
  transition: RunnableFrontierTransition,
  acceptedOperationIds = new Set<OperationId>(),
  attempt = plannedAttempt
) => {
  const proposals = deliveryProposalsOf({
    acceptedOperationIds,
    fresh: [],
    integrationResponsibilities: [],
    responsibilities: [
      {
        _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
        beganAt: JournalPosition.make(1),
        plannedAttempt: attempt
      }
    ],
    runId,
    transitions: [transition]
  }).ticketDelivery
  const recovered = proposals[0]
  if (recovered === undefined) throw new Error(`no recovered proposal for ${transition._tag}`)
  return recovered
}

const baseEvaluation = Effect.gen(function* () {
  const relation = yield* deliveryRuntime.pipe(
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
              quiescence: { _tag: "QuiescencePassive", reason: "RunPaused" },
              taskWork: { capacity: policy.taskExecutionCapacity, held: [] }
            },
            trackerGraphProposals: []
          },
          publication: { exactEvidence: [], graph: TrackerGraphState.cases.GraphNotEstablished.make({}), policy }
        } satisfies DeliveryRelationInputBundle)
      })
    )
  )
  return Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))
})

const dynamicEvaluationSignal = Effect.fn("Test.dynamicEvaluationSignal")(function* (
  initial: DeliveryRuntimeEvaluation,
  onPublish?: (current: DeliveryRuntimeEvaluation, next: DeliveryRuntimeEvaluation) => DeliveryRuntimeEvaluation
) {
  const state = yield* SubscriptionRef.make(initial)
  const signal = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(state))
  return {
    ...signal,
    publish: (evaluation: DeliveryRuntimeEvaluation) =>
      SubscriptionRef.modify(state, (current) => {
        const next = onPublish === undefined ? evaluation : onPublish(current, evaluation)
        return [undefined, next] as const
      })
  } satisfies DeliveryRuntimeInput<never> & {
    readonly publish: (evaluation: DeliveryRuntimeEvaluation) => Effect.Effect<void>
  }
})

const withProposals = (
  evaluation: DeliveryRuntimeEvaluation,
  proposals: ReadonlyArray<DeliveryActionProposal>,
  capacity = 2
): DeliveryRuntimeEvaluation => ({
  ...evaluation,
  proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals },
  quiescence: { _tag: "QuiescencePassive", reason: "RunPaused" },
  taskWork: { capacity: TaskWorkCapacity.make(capacity), held: [] }
})

const assertCausalRouteChangeDoesNotRepeat = Effect.fn("Test.assertCausalRouteChangeDoesNotRepeat")(function* (
  first: DeliveryActionProposal,
  superseding: DeliveryActionProposal,
  independentTaskId: TaskId,
  capabilities?: DeliveryRuntimeResourceCapabilities
) {
  const independent = proposal(1, independentTaskId)
  expect(superseding.id).not.toBe(first.id)
  const initial = withProposals(yield* baseEvaluation, [first], 2)
  const relation = yield* dynamicEvaluationSignal(initial)
  const firstStarted = yield* Deferred.make<void>()
  const supersedingAdmitted = yield* Deferred.make<void>()
  const supersedingStarted = yield* Deferred.make<void>()
  const independentStarted = yield* Deferred.make<void>()
  const finish = yield* Deferred.make<void>()
  const executor = DeliveryActionExecutor.of({
    execute: (action) =>
      Effect.gen(function* () {
        if (action.proposal.id === first.id) {
          yield* Deferred.succeed(firstStarted, undefined)
          yield* relation.publish(withProposals(initial, [superseding, independent], 2))
        } else if (action.proposal.id === superseding.id) {
          yield* Deferred.succeed(supersedingStarted, undefined)
        } else {
          yield* Deferred.succeed(independentStarted, undefined)
        }
        yield* Deferred.await(finish)
        if (action.proposal.id === first.id) yield* relation.publish(withProposals(initial, [], 2))
        return { _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult
      })
  })
  const trace = DeliverySemanticTrace.of({
    emit: (event) =>
      event._tag === "ProposalAdmitted" && event.proposalId === superseding.id
        ? Deferred.succeed(supersedingAdmitted, undefined)
        : Effect.void
  })

  const runtimeEffect = runDeliveryRuntimeDecision(relation).pipe(
    Effect.provideService(DeliveryActionExecutor, executor),
    Effect.provideService(DeliverySemanticTrace, trace)
  )
  const configuredRuntime =
    capabilities === undefined
      ? runtimeEffect.pipe(Effect.provide(identityLayers))
      : runtimeEffect.pipe(
          Effect.provide(plannerLayer),
          Effect.provide(deterministicOperationIdAllocatorLayer("runtime-causal-route-change")),
          Effect.provide(plannedAttemptProtocolControllerLayer),
          Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities))
        )
  const runtime = yield* configuredRuntime.pipe(Effect.forkChild)
  yield* Deferred.await(firstStarted)
  expect(
    yield* Effect.race(
      Deferred.await(independentStarted).pipe(Effect.as("Independent" as const)),
      Deferred.await(supersedingAdmitted).pipe(Effect.as("Superseding" as const))
    )
  ).toBe("Independent")
  expect(yield* Deferred.isDone(supersedingStarted)).toBe(false)

  yield* Deferred.succeed(finish, undefined)
  expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
})

it.effect("finds exact proposal identities in available and conflicting frontiers", () =>
  Effect.sync(() => {
    const a = proposal(0, TaskId.make("frontier-A"))
    const b = proposal(1, TaskId.make("frontier-B"))
    const available = (proposals: ReadonlyArray<DeliveryActionProposal>) => ({
      _tag: "DeliveryProposalsAvailable" as const,
      isolatedIssues: [],
      proposals
    })
    const conflicts = (
      ids: readonly [DeliveryProposalId, ...ReadonlyArray<DeliveryProposalId>]
    ): DeliveryProposalFrontier => {
      const conflict = (id: DeliveryProposalId) => ({
        id,
        order: a.order,
        owners: ["TrackerGraph", "TicketDelivery"] as const
      })
      return { _tag: "DeliveryProposalOwnershipConflict", conflicts: [conflict(ids[0]), ...ids.slice(1).map(conflict)] }
    }

    expect(proposalIsPresent(available([a]), a.id)).toBe(true)
    expect(proposalIsPresent(available([a]), b.id)).toBe(false)
    expect(proposalIsPresent(conflicts([a.id]), a.id)).toBe(true)
    expect(proposalIsPresent(conflicts([a.id]), b.id)).toBe(false)
  })
)

it.effect("publishes current-first exact live-owner observations until standalone runtime quiescence", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const admitted = proposal(0, TaskId.make("runtime-observation-task"))
      const initial = withProposals(yield* baseEvaluation, [admitted], 1)
      const relation = yield* dynamicEvaluationSignal(initial)
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
      const resources = capabilities.resources
      const observations = yield* Ref.make<ReadonlyArray<DeliveryRuntimeObservationState>>([])
      const observationStarted = yield* Deferred.make<void>()
      const actionStarted = yield* Deferred.make<void>()
      const finishAction = yield* Deferred.make<void>()

      const observer = yield* resources.runtimeObservation.changes.pipe(
        Stream.runForEach((state) =>
          Ref.update(observations, (current) => [...current, state]).pipe(
            Effect.andThen(Deferred.succeed(observationStarted, undefined))
          )
        ),
        Effect.forkChild
      )
      yield* Deferred.await(observationStarted)
      expect((yield* resources.runtimeObservation.get)._tag).toBe("NotReady")

      const executor = DeliveryActionExecutor.of({
        execute: (_action, lease) =>
          Effect.gen(function* () {
            yield* lease.recordIntent(OperationId.make("runtime-observation:0"))
            yield* Deferred.succeed(actionStarted, undefined)
            yield* Deferred.await(finishAction)
            yield* relation.publish(withProposals(initial, [], 1))
            return { _tag: "ActionCompleted", proposalId: admitted.id } satisfies DeliveryActionResult
          })
      })
      const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(deterministicOperationIdAllocatorLayer("runtime-observation")),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.forkChild
      )

      yield* Deferred.await(actionStarted)
      const active = yield* resources.runtimeObservation.get
      if (active._tag !== "Ready") return expect.fail("the admitted action must be observable")
      expect(active.liveOwners).toEqual([
        {
          _tag: "MaterializedDeliveryAction",
          intent: "IntentRecorded",
          operationId: OperationId.make("runtime-observation:0"),
          proposal: admitted
        }
      ])

      yield* Deferred.succeed(finishAction, undefined)
      yield* Fiber.join(runtime)
      yield* Fiber.join(observer)

      const published = yield* Ref.get(observations)
      const ready = published.filter(
        (state): state is Extract<DeliveryRuntimeObservationState, { readonly _tag: "Ready" }> => state._tag === "Ready"
      )
      expect(published[0]?._tag).toBe("NotReady")
      expect(ready[0]?.liveOwners).toEqual([])
      expect(
        ready.some(({ liveOwners }) =>
          liveOwners.some((owner) => owner.proposal.id === admitted.id && owner._tag === "AdmittedDeliveryAction")
        )
      ).toBe(true)
      expect(
        ready.some(({ liveOwners }) =>
          liveOwners.some(
            (owner) =>
              owner.proposal.id === admitted.id &&
              owner._tag === "MaterializedDeliveryAction" &&
              owner.intent === "IntentNotRecorded"
          )
        )
      ).toBe(true)
      expect(
        ready.some(({ liveOwners }) =>
          liveOwners.some(
            (owner) => owner.proposal.id === admitted.id && owner._tag === "SettledMaterializedDeliveryAction"
          )
        )
      ).toBe(true)
      expect(ready.at(-1)?.liveOwners).toEqual([])
      expect(ready.at(-1)?.evaluation.proposedActions).toEqual({
        _tag: "DeliveryProposalsAvailable",
        isolatedIssues: [],
        proposals: []
      })
    })
  )
)

it.effect("interrupts an admitted tracker owner under Exit and starts no successor action", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const admitted = proposal(0, TaskId.make("runtime-exit-tracker-task"))
      const successor = proposal(1, TaskId.make("runtime-exit-successor-task"))
      const initial = withProposals(yield* baseEvaluation, [admitted, successor], 1)
      const relation = yield* dynamicEvaluationSignal(initial)
      const lifecycle = yield* makeApplicationExitLifecycle()
      const capabilities = yield* makeCapabilitiesWithAdmission(
        yield* makeIntegrationTargetResourceController(),
        lifecycle.admission
      )
      const operationId = OperationId.make("runtime-exit-tracker-operation")
      const callStarted = yield* Deferred.make<void>()
      const callInterrupted = yield* Deferred.make<void>()
      const successorStarted = yield* Deferred.make<void>()
      const executor = DeliveryActionExecutor.of({
        execute: (action, lease) =>
          action.proposal.id === successor.id
            ? Deferred.succeed(successorStarted, undefined).pipe(
                Effect.andThen(Effect.die("a post-cutoff successor started"))
              )
            : Effect.gen(function* () {
                yield* lease.recordIntent(operationId)
                return yield* interruptibleBoundaryOf(lease).run(
                  InterruptibleWorkflowBoundaryIntent.AuthorityRequest({ family: "TaskTracker", operationId }),
                  Deferred.succeed(callStarted, undefined).pipe(
                    Effect.andThen(Effect.never),
                    Effect.onInterrupt(() => Deferred.succeed(callInterrupted, undefined))
                  ),
                  () => Effect.die("the interrupted tracker wait produced no result")
                )
              })
      })
      const allocator = OperationIdAllocator.of({ allocate: () => Effect.succeed(operationId) })
      const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(OperationIdAllocator, allocator),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.forkChild
      )

      yield* Deferred.await(callStarted)
      yield* lifecycle.requestExit
      yield* Deferred.await(callInterrupted)
      expect((yield* Fiber.await(runtime))._tag).toBe("Failure")
      yield* lifecycle.awaitForwardOwnersReleased
      expect(yield* lifecycle.admission.snapshot).toEqual({
        cutoffClosed: true,
        preparingOwnerCount: 0,
        registeredOwnerCount: 0
      })
      expect(yield* Deferred.isDone(successorStarted)).toBe(false)
    })
  )
)

it.effect("rejects a proposed exact claim cleanup before it acquires any owner after the Exit cutoff", () =>
  Effect.gen(function* () {
    const claimOperationId = OperationId.make("runtime-late-cleanup-claim")
    const claim = ActiveTaskClaim.make({
      operationId: claimOperationId,
      owner: ClaimOwner.make("dalph"),
      taskId: plannedAttempt.taskId,
      token: ClaimToken.make("runtime-late-cleanup-token")
    })
    const operation = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
      predecessorOperationIds: [claimOperationId],
      release: { claim, operationId: OperationId.make("runtime-late-cleanup-release") }
    })
    const proposedCleanup = recoveredProposalFor(
      RunnableFrontierTransition.ReleaseExternallyCompletedTaskClaim({ operation, plannedAttempt })
    )
    const relation = yield* dynamicEvaluationSignal(withProposals(yield* baseEvaluation, [proposedCleanup], 1))
    const lifecycle = yield* makeApplicationExitLifecycle()
    const capabilities = yield* makeCapabilitiesWithAdmission(
      yield* makeIntegrationTargetResourceController(),
      lifecycle.admission
    )
    const cleanupCalls = yield* Ref.make(0)
    const executor = DeliveryActionExecutor.of({
      execute: () =>
        Ref.update(cleanupCalls, (count) => count + 1).pipe(
          Effect.andThen(Effect.die("post-cutoff proposed cleanup acquired an owner"))
        )
    })
    yield* lifecycle.requestExit
    const result = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(plannerLayer),
      Effect.provide(plannedAttemptProtocolControllerLayer),
      Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
      Effect.provideService(
        OperationIdAllocator,
        OperationIdAllocator.of({ allocate: () => Effect.succeed(operation.release.operationId) })
      ),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.exit
    )

    expect(result._tag).toBe("Failure")
    expect(yield* Ref.get(cleanupCalls)).toBe(0)
    expect(yield* lifecycle.admission.snapshot).toEqual({
      cutoffClosed: true,
      preparingOwnerCount: 0,
      registeredOwnerCount: 0
    })
  })
)

it.effect("records a produced Git result under Exit and starts no later protocol phase", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const admitted = proposal(0, TaskId.make("runtime-exit-git-task"))
      const successor = proposal(1, TaskId.make("runtime-exit-git-successor"))
      const initial = withProposals(yield* baseEvaluation, [admitted, successor], 1)
      const relation = yield* dynamicEvaluationSignal(initial)
      const lifecycle = yield* makeApplicationExitLifecycle()
      const capabilities = yield* makeCapabilitiesWithAdmission(
        yield* makeIntegrationTargetResourceController(),
        lifecycle.admission
      )
      const operationId = OperationId.make("runtime-exit-git-operation")
      const resultProduced = yield* Deferred.make<void>()
      const recordMayFinish = yield* Deferred.make<void>()
      const recorded = yield* Ref.make<ReadonlyArray<string>>([])
      const successorStarted = yield* Deferred.make<void>()
      const executor = DeliveryActionExecutor.of({
        execute: (action, lease) =>
          action.proposal.id === successor.id
            ? Deferred.succeed(successorStarted, undefined).pipe(
                Effect.andThen(Effect.die("a later Git protocol phase started after cutoff"))
              )
            : Effect.gen(function* () {
                yield* lease.recordIntent(operationId)
                return yield* interruptibleBoundaryOf(lease).run(
                  InterruptibleWorkflowBoundaryIntent.AuthorityRequest({ family: "Git", operationId }),
                  Effect.succeed("normalized-git-result"),
                  (result) =>
                    Deferred.succeed(resultProduced, undefined).pipe(
                      Effect.andThen(Deferred.await(recordMayFinish)),
                      Effect.andThen(Ref.update(recorded, (results) => [...results, result])),
                      Effect.as({ _tag: "ActionCompleted", proposalId: admitted.id } satisfies DeliveryActionResult)
                    )
                )
              })
      })
      const allocator = OperationIdAllocator.of({ allocate: () => Effect.succeed(operationId) })
      const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(OperationIdAllocator, allocator),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.forkChild
      )

      yield* Deferred.await(resultProduced)
      yield* lifecycle.requestExit
      yield* Deferred.succeed(recordMayFinish, undefined)
      expect((yield* Fiber.await(runtime))._tag).toBe("Failure")
      yield* lifecycle.awaitForwardOwnersReleased
      expect(yield* Ref.get(recorded)).toEqual(["normalized-git-result"])
      expect(yield* Deferred.isDone(successorStarted)).toBe(false)
    })
  )
)

it("keeps exact proposal identity for routes outside semantic recovered-read ownership", () => {
  const responsibleClaim = recoveredProposalFor(
    RunnableFrontierTransition.ObserveResponsibleTaskClaim({
      operation: makeTaskClaimObservationOperation(
        OperationId.make("runtime-fallback-responsible-claim"),
        target,
        plannedAttempt.taskId
      ),
      taskId: plannedAttempt.taskId
    })
  )
  const freshOrder = proposal(8, plannedAttempt.taskId).order
  const nonRecoveredOrder = { ...responsibleClaim, order: freshOrder }
  const anotherNonRecoveredOrder = {
    ...nonRecoveredOrder,
    id: DeliveryProposalId.make("runtime-fallback-non-recovered-order")
  }

  const integrationOrder = {
    _tag: "IntegrationOrder" as const,
    frontierOrdinal: 9 as never,
    queuedAt: JournalPosition.make(90),
    startedAt: JournalPosition.make(91),
    taskId: plannedAttempt.taskId
  }
  const nonRecoveredRoute = { ...proposal(9, plannedAttempt.taskId), order: integrationOrder }
  const anotherNonRecoveredRoute = {
    ...nonRecoveredRoute,
    id: DeliveryProposalId.make("runtime-fallback-non-recovered-route")
  }
  const nonLineageIntegrationRead = { ...responsibleClaim, order: integrationOrder }
  const anotherNonLineageIntegrationRead = {
    ...nonLineageIntegrationRead,
    id: DeliveryProposalId.make("runtime-fallback-non-lineage-integration-read")
  }
  const continuationClaim = recoveredProposalFor(
    RunnableFrontierTransition.ObservePlannedAttemptContinuationClaim({
      operation: makeTaskClaimObservationOperation(
        OperationId.make("runtime-fallback-continuation-claim"),
        target,
        plannedAttempt.taskId
      ),
      plannedAttempt
    })
  )
  const mismatchedRecoveredRead = { ...responsibleClaim, order: continuationClaim.order }
  const anotherMismatchedRecoveredRead = {
    ...mismatchedRecoveredRead,
    id: DeliveryProposalId.make("runtime-fallback-mismatched-recovered-read")
  }

  expect(liveActionKeyOf(nonRecoveredOrder)).not.toBe(liveActionKeyOf(anotherNonRecoveredOrder))
  expect(liveActionKeyOf(nonRecoveredRoute)).not.toBe(liveActionKeyOf(anotherNonRecoveredRoute))
  expect(liveActionKeyOf(nonLineageIntegrationRead)).not.toBe(liveActionKeyOf(anotherNonLineageIntegrationRead))
  expect(liveActionKeyOf(mismatchedRecoveredRead)).not.toBe(liveActionKeyOf(anotherMismatchedRecoveredRead))
})

it.effect("classifies a nonempty executable frontier as runnable before finality", () =>
  Effect.gen(function* () {
    const current = (yield* baseEvaluation).current
    expect(
      deliveryFinalityOf(
        current,
        { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [proposal(0, TaskId.make("A"))] },
        { _tag: "TrackerReconfirmationAllowed" }
      )
    ).toEqual({ _tag: "RunMustRemainActive", reason: "RunnableTransition" })
  })
)

it.effect("reacts to an accepted action result through its owning fact signal", () =>
  Effect.gen(function* () {
    const a = proposal(0, TaskId.make("A"))
    const b = proposal(1, TaskId.make("B"))
    const c = proposal(2, TaskId.make("C"))
    const evaluation = withProposals(yield* baseEvaluation, [a, b, c], 2)
    const relation = yield* dynamicEvaluationSignal(evaluation)
    const started = yield* Ref.make<ReadonlyArray<string>>([])
    const active = yield* Ref.make(0)
    const maximum = yield* Ref.make(0)
    const firstWaveStarted = yield* Deferred.make<void>()
    const thirdStarted = yield* Deferred.make<void>()
    const gates = new Map([
      [a.id, yield* Deferred.make<void>()],
      [b.id, yield* Deferred.make<void>()],
      [c.id, yield* Deferred.make<void>()]
    ])
    const executor = DeliveryActionExecutor.of({
      execute: (action, lease) =>
        Effect.gen(function* () {
          const id = action.proposal.id
          const taskId = action.proposal.admission.taskWorkPosition
          const correlation = {
            attemptId: AttemptId.make(`attempt:${taskId._tag === "TaskWorkPositionRequired" ? taskId.taskId : id}`),
            runId
          }
          const startedNow = yield* Ref.updateAndGet(started, (ids) => [...ids, id])
          const now = yield* Ref.updateAndGet(active, (count) => count + 1)
          yield* Ref.update(maximum, (prior) => Math.max(prior, now))
          if (startedNow.length === 2) yield* Deferred.succeed(firstWaveStarted, undefined)
          if (startedNow.length === 3) yield* Deferred.succeed(thirdStarted, undefined)
          yield* Deferred.await(Option.getOrThrow(Option.fromUndefinedOr(gates.get(id))))
          yield* lease.bindPlannedAttemptPosition(correlation)
          yield* lease.releasePlannedAttemptPosition(correlation)
          yield* Ref.update(active, (count) => count - 1)
          const current = yield* relation.get
          yield* relation.publish(
            withProposals(
              current,
              current.proposedActions._tag === "DeliveryProposalsAvailable"
                ? current.proposedActions.proposals.filter(({ id: proposalId }) => proposalId !== id)
                : [],
              2
            )
          )
          return { _tag: "ActionCompleted", proposalId: id } satisfies DeliveryActionResult
        })
    })

    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(firstWaveStarted)
    expect(yield* Ref.get(started)).toEqual([a.id, b.id])
    expect(yield* Ref.get(maximum)).toBe(2)

    yield* Deferred.succeed(Option.getOrThrow(Option.fromUndefinedOr(gates.get(a.id))), undefined)
    yield* Deferred.await(thirdStarted)
    expect(yield* Ref.get(started)).toEqual([a.id, b.id, c.id])
    yield* Deferred.succeed(Option.getOrThrow(Option.fromUndefinedOr(gates.get(b.id))), undefined)
    yield* Deferred.succeed(Option.getOrThrow(Option.fromUndefinedOr(gates.get(c.id))), undefined)

    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
  }).pipe(Effect.scoped)
)

it.effect("does not start a causal successor before its live operation owner is acknowledged", () =>
  Effect.gen(function* () {
    const ownedOperationId = OperationId.make("owned-operation")
    const parent = proposal(0, TaskId.make("A"))
    const successor = { ...proposal(1, TaskId.make("B")), waitsForLiveOperationId: ownedOperationId }
    const initial = withProposals(yield* baseEvaluation, [parent, successor])
    const relation = yield* dynamicEvaluationSignal(initial)
    const parentStarted = yield* Deferred.make<void>()
    const successorStarted = yield* Deferred.make<void>()
    const finishParent = yield* Deferred.make<void>()
    const finishSuccessor = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        (action.proposal.id === parent.id
          ? Deferred.succeed(parentStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishParent)),
              Effect.andThen(relation.publish(withProposals(initial, [successor])))
            )
          : Deferred.succeed(successorStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishSuccessor)),
              Effect.andThen(relation.publish(withProposals(initial, [])))
            )
        ).pipe(Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult))
    })
    const allocator = OperationIdAllocator.of({ allocate: () => Effect.succeed(ownedOperationId) })

    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(plannerLayer),
      Effect.provide(testDeliveryRuntimeResourcesLayer),
      Effect.provide(plannedAttemptProtocolControllerLayer),
      Effect.provideService(OperationIdAllocator, allocator),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(parentStarted)
    yield* Effect.yieldNow
    expect(yield* Deferred.isDone(successorStarted)).toBe(false)

    yield* Deferred.succeed(finishParent, undefined)
    yield* Deferred.await(successorStarted)
    yield* Deferred.succeed(finishSuccessor, undefined)
    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
  }).pipe(Effect.scoped)
)

it.effect("does not start a causal successor before its accepted operation owner is acknowledged", () =>
  Effect.gen(function* () {
    const ownedOperationId = OperationId.make("accepted-owned-operation")
    const parent = recoveredProposalFor(
      RunnableFrontierTransition.CheckTaskClaim({ operationId: ownedOperationId, taskId: plannedAttempt.taskId }),
      new Set([ownedOperationId])
    )
    const successor = { ...proposal(1, TaskId.make("B")), waitsForLiveOperationId: ownedOperationId }
    const initial = withProposals(yield* baseEvaluation, [parent, successor])
    const relation = yield* dynamicEvaluationSignal(initial)
    const parentStarted = yield* Deferred.make<void>()
    const successorStarted = yield* Deferred.make<void>()
    const finishParent = yield* Deferred.make<void>()
    const finishSuccessor = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        (action.proposal.id === parent.id
          ? Deferred.succeed(parentStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishParent)),
              Effect.andThen(relation.publish(withProposals(initial, [successor])))
            )
          : Deferred.succeed(successorStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishSuccessor)),
              Effect.andThen(relation.publish(withProposals(initial, [])))
            )
        ).pipe(Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult))
    })

    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(parentStarted)
    yield* Effect.yieldNow
    expect(yield* Deferred.isDone(successorStarted)).toBe(false)

    yield* Deferred.succeed(finishParent, undefined)
    yield* Deferred.await(successorStarted)
    yield* Deferred.succeed(finishSuccessor, undefined)
    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
  }).pipe(Effect.scoped)
)

it.effect("admits independent fresh work while a recovered action remains live", () =>
  Effect.gen(function* () {
    const recovered = recoveredProposalFor(
      RunnableFrontierTransition.CommitTaskClaimReacquisitionIntent({
        plannedAttempt,
        requestId: TaskClaimReacquisitionRequestId.make("runtime-reconciliation-barrier"),
        taskId: plannedAttempt.taskId
      })
    )
    const fresh = proposal(1, TaskId.make("fresh-after-reconciliation"))
    const initial = withProposals(yield* baseEvaluation, [recovered, fresh], 2)
    const relation = yield* dynamicEvaluationSignal(initial)
    const recoveredStarted = yield* Deferred.make<void>()
    const finishRecovered = yield* Deferred.make<void>()
    const freshStarted = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        (action.proposal.id === recovered.id
          ? Deferred.succeed(recoveredStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishRecovered)),
              Effect.andThen(relation.publish(withProposals(initial, [])))
            )
          : Deferred.succeed(freshStarted, undefined).pipe(
              Effect.andThen(relation.publish(withProposals(initial, [recovered], 2)))
            )
        ).pipe(Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult))
    })

    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(recoveredStarted)
    yield* Deferred.await(freshStarted)

    yield* Deferred.succeed(finishRecovered, undefined)
    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
  }).pipe(Effect.scoped)
)

it.effect("does not repeat one recovered observation after only its causal route changes while it is live", () =>
  Effect.gen(function* () {
    const specificationRead = (predecessor: string) =>
      recoveredProposalFor(
        RunnableFrontierTransition.ObservePlannedAttemptContinuationSpecification({
          operation: makeTaskWorkSpecificationObservationOperation(
            OperationId.make(`runtime-specification:${predecessor}`),
            target,
            plannedAttempt.taskId,
            [OperationId.make(`runtime-graph:${predecessor}`)]
          ),
          plannedAttempt
        })
      )
    const first = specificationRead("first")
    const superseding = specificationRead("superseding")
    yield* assertCausalRouteChangeDoesNotRepeat(first, superseding, TaskId.make("independent-after-superseding-route"))
  }).pipe(Effect.scoped)
)

it.effect("does not repeat one responsible-task claim read after only its causal route changes while live", () =>
  Effect.gen(function* () {
    const taskId = TaskId.make("responsible-claim-route-change")
    const claimRead = (predecessor: string) =>
      recoveredProposalFor(
        RunnableFrontierTransition.ObserveResponsibleTaskClaim({
          operation: makeTaskClaimObservationOperation(
            OperationId.make(`runtime-responsible-claim:${predecessor}`),
            target,
            taskId,
            [OperationId.make(`runtime-responsible-graph:${predecessor}`)]
          ),
          taskId
        })
      )
    const first = claimRead("first")
    const superseding = claimRead("superseding")
    yield* assertCausalRouteChangeDoesNotRepeat(
      first,
      superseding,
      TaskId.make("independent-after-responsible-claim-route")
    )
  }).pipe(Effect.scoped)
)

it.effect("does not repeat one started-integration lineage read after only its causal route changes while live", () =>
  Effect.gen(function* () {
    const integrationTarget = IntegrationTarget.make({
      repository: GitRepositoryLocator.make("/runtime-test/integration-lineage.git"),
      ref: IntegrationTargetRef.make("refs/heads/main")
    })
    const responsibility = StartedIntegrationResponsibility.make({
      acceptedResult: acceptedResultFixture(GitCommitSha.make("3".repeat(40))),
      integrationTarget,
      plannedAttempt,
      queuedAt: JournalPosition.make(70),
      startedAt: JournalPosition.make(71)
    })
    const lineageRead = (causalForm: string) => {
      const transition = RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
        operation: makeTargetLineageObservationOperation({
          integrationTarget,
          operationId: OperationId.make(`runtime-integration-lineage:${causalForm}`),
          plannedAttempt,
          predecessorOperationIds: [OperationId.make(`runtime-integration-predecessor:${causalForm}`)]
        }),
        plannedAttempt
      })
      const proposals = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: [],
        integrationResponsibilities: [responsibility],
        runId,
        transitions: [transition]
      }).deliverySettlement
      const derived = proposals[0]
      if (derived === undefined) throw new Error("started integration must derive its target-lineage read")
      return derived
    }
    const first = lineageRead("first")
    const superseding = lineageRead("superseding")
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const held = { integrationTarget, queuedAt: responsibility.queuedAt }
    yield* integrationTargets.acquire(held)
    yield* integrationTargets.publishAcceptedOwnership(held)

    yield* assertCausalRouteChangeDoesNotRepeat(
      first,
      superseding,
      TaskId.make("independent-after-integration-lineage-route"),
      yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
    )
  }).pipe(Effect.scoped)
)

it.effect("runs a stopped-attempt claim read after the distinct continuation-claim read settles", () =>
  Effect.gen(function* () {
    const continuation = recoveredProposalFor(
      RunnableFrontierTransition.ObservePlannedAttemptContinuationClaim({
        operation: makeTaskClaimObservationOperation(
          OperationId.make("runtime-continuation-claim"),
          target,
          plannedAttempt.taskId
        ),
        plannedAttempt
      })
    )
    const stopped = recoveredProposalFor(
      RunnableFrontierTransition.ObserveStoppedAttemptClaim({
        operation: makeTaskClaimObservationOperation(
          OperationId.make("runtime-stopped-claim"),
          target,
          plannedAttempt.taskId,
          [OperationId.make("runtime-stoppage-predecessor")]
        ),
        requestId: AttemptChoiceRequestId.make({ nonce: "runtime-stopped-claim", runId }),
        subject: { observedTaskRevision: TaskRevision.make("runtime-stopped-revision"), plannedAttempt }
      })
    )
    const marker = proposal(1, TaskId.make("marker-after-distinct-claim-read"))
    expect(stopped.id).not.toBe(continuation.id)
    const initial = withProposals(yield* baseEvaluation, [continuation], 2)
    const relation = yield* dynamicEvaluationSignal(initial)
    const continuationSettled = yield* Deferred.make<void>()
    const stoppedStarted = yield* Deferred.make<void>()
    const markerStarted = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        action.proposal.id === continuation.id
          ? Effect.succeed({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult)
          : (action.proposal.id === stopped.id
              ? Deferred.succeed(stoppedStarted, undefined)
              : Deferred.succeed(markerStarted, undefined)
            ).pipe(
              Effect.andThen(Deferred.await(finish)),
              Effect.andThen(
                action.proposal.id === stopped.id ? relation.publish(withProposals(initial, [], 2)) : Effect.void
              ),
              Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult)
            )
    })
    const trace = DeliverySemanticTrace.of({
      emit: (event) =>
        event._tag === "ActionOutcome" && event.result.proposalId === continuation.id
          ? Deferred.succeed(continuationSettled, undefined)
          : Effect.void
    })

    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.provideService(DeliverySemanticTrace, trace),
      Effect.forkChild
    )
    yield* Deferred.await(continuationSettled)
    yield* relation.publish(withProposals(initial, [stopped, marker], 2))
    yield* Deferred.await(markerStarted)
    expect(yield* Deferred.isDone(stoppedStarted)).toBe(true)

    yield* Deferred.succeed(finish, undefined)
    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
  }).pipe(Effect.scoped)
)

it.effect("keeps A as an unreadable Git wait while independent B executes its proposal", () =>
  Effect.gen(function* () {
    const taskA = plannedAttempt.taskId
    const taskB = TaskId.make("independent-B")
    const projected = projectTrackerSnapshot({
      revision: "unreadable-A-independent-B",
      tasks: [taskA, taskB].map((id) => ({
        id,
        lifecycle: { _tag: "Open" as const },
        parentTaskId: null,
        prerequisiteIds: []
      }))
    })
    if (projected._tag === "Invalid") return yield* Effect.die("test graph must be valid")
    const b = proposal(0, taskB)
    const proposalContributions = yield* SubscriptionRef.make({
      deliverySettlement: [],
      issues: [],
      ticketDelivery: [b]
    })
    const coherent = yield* SubscriptionRef.make<DeliveryRelationInputBundle>({
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
          quiescence: { _tag: "QuiescencePassive" as const, reason: "RunPaused" as const },
          taskWork: {
            capacity: TaskWorkCapacity.make(2),
            held: [{ correlation: { attemptId: plannedAttempt.attemptId, runId }, taskId: taskA }]
          }
        },
        trackerGraphProposals: []
      },
      publication: {
        exactEvidence: [
          {
            _tag: "ResponsibilityFacts" as const,
            facts: {
              _tag: "PlannedAttemptExecutorFreshFacts" as const,
              disposition: ResponsibilityDisposition.PlannedAttemptGitConstraint({ gitState: "WorktreeLost" }),
              responsibility: {
                _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
                beganAt: JournalPosition.make(1),
                plannedAttempt
              }
            }
          }
        ],
        graph: TrackerGraphState.cases.GraphEstablished.make({
          observation: makeTestJournaledTrackerGraphObservation({
            snapshot: projected.snapshot,
            operationId: OperationId.make("fixture:unreadable-A-independent-B"),
            recordedAt: JournalPosition.make(1)
          })
        }),
        policy
      }
    })
    const layer = makeDeliveryRelationsLayer({
      publicationConsistency: { withStablePublication: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect },
      coherent: currentSignalFromCurrentFirstStream(SubscriptionRef.changes(coherent)),
      proposalContributions: currentSignalFromCurrentFirstStream(SubscriptionRef.changes(proposalContributions))
    })
    const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
    const initial = Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))
    expect(
      initial.current.ticketDeliveries.deliveries.find(({ taskId }) => taskId === taskA)?.standings[0]
    ).toMatchObject({
      _tag: "ResponsibilitySituation",
      facts: { disposition: { _tag: "PlannedAttemptGitConstraint", gitState: "WorktreeLost" } }
    })
    const executed = yield* Ref.make<ReadonlyArray<TaskId>>([])
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Ref.update(executed, (current) => [...current, taskB]).pipe(
          Effect.andThen(
            SubscriptionRef.update(proposalContributions, (current) => ({ ...current, ticketDelivery: [] }))
          ),
          Effect.andThen(
            SubscriptionRef.update(coherent, (current) => ({
              ...current,
              actionInputs: {
                ...current.actionInputs,
                runtimeFacts: { ...current.actionInputs.runtimeFacts, acceptedAt: JournalPosition.make(2) }
              }
            }))
          ),
          Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult)
        )
    })

    expect(
      yield* runDeliveryRuntimeDecision(relation).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(DeliveryActionExecutor, executor)
      )
    ).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
    expect(yield* Ref.get(executed)).toEqual([taskB])
  }).pipe(Effect.scoped)
)

it.effect("does not allocate an operation or attempt identity before admission", () =>
  Effect.gen(function* () {
    const a = proposal(0, TaskId.make("A"))
    const initial = {
      ...withProposals(yield* baseEvaluation, [a], 1),
      taskWork: {
        capacity: TaskWorkCapacity.make(1),
        held: [{ correlation: { attemptId: AttemptId.make("attempt:B"), runId }, taskId: TaskId.make("B") }]
      }
    }
    const relation = yield* dynamicEvaluationSignal(initial)
    const allocations = yield* Ref.make(0)
    const allocator = OperationIdAllocator.of({
      allocate: () =>
        Ref.updateAndGet(allocations, (count) => count + 1).pipe(
          Effect.map((ordinal) => `operation:${ordinal}` as never)
        )
    })
    const executed = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Deferred.succeed(executed, undefined).pipe(
          Effect.andThen(relation.publish(withProposals(initial, [], 1))),
          Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult)
        )
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(plannerLayer),
      Effect.provide(testDeliveryRuntimeResourcesLayer),
      Effect.provide(plannedAttemptProtocolControllerLayer),
      Effect.provideService(OperationIdAllocator, allocator),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Effect.yieldNow
    expect(yield* Ref.get(allocations)).toBe(0)

    yield* relation.publish({
      ...withProposals(initial, [a], 1),
      taskWork: { capacity: TaskWorkCapacity.make(1), held: [] }
    })
    yield* Deferred.await(executed)
    expect(yield* Ref.get(allocations)).toBe(1)
    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
  }).pipe(Effect.scoped)
)

it.effect("starts one live action while its proposal remains present", () =>
  Effect.gen(function* () {
    const persistent = trackerGraphReadProposalOf({
      acceptedAt: JournalPosition.make(1),
      purpose: "EstablishCurrentGraph",
      runId,
      target
    })
    const initial = withProposals(yield* baseEvaluation, [persistent])
    const relation = yield* dynamicEvaluationSignal(initial)
    const started = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const settled = yield* Deferred.make<void>()
    const starts = yield* Ref.make(0)
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Ref.update(starts, (count) => count + 1).pipe(
          Effect.andThen(Deferred.succeed(started, undefined)),
          Effect.andThen(Deferred.await(finish)),
          Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult)
        )
    })
    const runtime = yield* runDeliveryRuntimeQuiescence(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.provideService(
        DeliverySemanticTrace,
        DeliverySemanticTrace.of({
          emit: (event) =>
            event._tag === "ActionOutcome" && event.result.proposalId === persistent.id
              ? Deferred.succeed(settled, undefined)
              : Effect.void
        })
      ),
      Effect.forkChild
    )
    yield* Deferred.await(started)
    yield* relation.publish(initial)
    yield* Effect.yieldNow
    expect(yield* Ref.get(starts)).toBe(1)
    yield* Deferred.succeed(finish, undefined)
    yield* Deferred.await(settled)
    yield* relation.publish(initial)
    yield* Effect.yieldNow
    expect(yield* Ref.get(starts)).toBe(1)
    yield* relation.publish(withProposals(initial, []))
    const quiescence = yield* Fiber.join(runtime)
    expect(quiescence.proposedActions).toEqual(withProposals(initial, []).proposedActions)
    expect(quiescence.disposition).toEqual({ _tag: "QuiescencePassive", reason: "RunPaused" })
  }).pipe(Effect.scoped)
)

it.effect("interrupts every scoped live action without manufacturing completion", () =>
  Effect.gen(function* () {
    const a = proposal(0, TaskId.make("A"))
    const relation = yield* dynamicEvaluationSignal(withProposals(yield* baseEvaluation, [a], 1))
    const started = yield* Deferred.make<void>()
    const interrupted = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(interrupted, undefined))
        )
    })
    const fiber = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(started)
    yield* Fiber.interrupt(fiber)
    yield* Deferred.await(interrupted)
  }).pipe(Effect.scoped)
)

const assertInterruptedAdmissionHandoffReleases = Effect.fn("Test.assertInterruptedAdmissionHandoffReleases")(
  function* (gap: "AfterReservations" | "AfterOwnerRegistration") {
    const admitted = handoffProposal()
    const relation = yield* dynamicEvaluationSignal(withProposals(yield* baseEvaluation, [admitted], 1))
    const gapEntered = yield* Deferred.make<void>()
    const releaseGap = yield* Deferred.make<void>()
    const releaseCalls = yield* Ref.make(0)
    const executorCalls = yield* Ref.make(0)
    const admissionCreated = yield* Deferred.make<DeliveryRuntimeAdmissionController>()
    const underlyingIntegrationTargets = yield* makeIntegrationTargetResourceController()
    const integrationTargets = {
      ...underlyingIntegrationTargets,
      acquire: (responsibility: Parameters<typeof underlyingIntegrationTargets.acquire>[0]) =>
        (gap === "AfterReservations"
          ? Deferred.succeed(gapEntered, undefined).pipe(Effect.andThen(Deferred.await(releaseGap)))
          : Effect.void
        ).pipe(Effect.andThen(underlyingIntegrationTargets.acquire(responsibility))),
      release: (responsibility: Parameters<typeof underlyingIntegrationTargets.release>[0]) =>
        Ref.update(releaseCalls, (count) => count + 1).pipe(
          Effect.andThen(underlyingIntegrationTargets.release(responsibility))
        )
    }
    const baseCapabilities = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
    const resources = {
      ...baseCapabilities.resources,
      makeAdmissionController: (initial: Parameters<typeof baseCapabilities.resources.makeAdmissionController>[0]) =>
        baseCapabilities.resources
          .makeAdmissionController(initial)
          .pipe(Effect.tap((controller) => Deferred.succeed(admissionCreated, controller)))
    }
    const capabilities = { ...baseCapabilities, resources }
    const protocol = yield* makePlannedAttemptProtocolController()
    const trace = DeliverySemanticTrace.of({
      emit: (event) =>
        gap === "AfterOwnerRegistration" && event._tag === "ProposalAdmitted" && event.proposalId === admitted.id
          ? Deferred.succeed(gapEntered, undefined).pipe(Effect.andThen(Deferred.await(releaseGap)))
          : Effect.void
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(plannerLayer),
      Effect.provide(deterministicOperationIdAllocatorLayer(`admission-handoff-${gap}`)),
      Effect.provideService(PlannedAttemptProtocolController, protocol),
      Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
      Effect.provideService(DeliverySemanticTrace, trace),
      Effect.provideService(
        DeliveryActionExecutor,
        DeliveryActionExecutor.of({
          execute: () => Ref.update(executorCalls, (count) => count + 1).pipe(Effect.andThen(Effect.never))
        })
      ),
      Effect.forkChild
    )

    yield* Deferred.await(gapEntered)
    const interruption = yield* Fiber.interrupt(runtime).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Deferred.succeed(releaseGap, undefined)
    yield* Fiber.join(interruption)

    const admission = yield* Deferred.await(admissionCreated)
    expect(yield* Ref.get(executorCalls)).toBe(0)
    expect(yield* Ref.get(releaseCalls)).toBe(1)
    expect((yield* admission.snapshot).positions.size).toBe(0)
    const exactPermit = Option.getOrThrow(yield* protocol.reserve(handoffCorrelation))
    yield* exactPermit.release

    const later = yield* admission.tryReserve(admitted)
    expect(later._tag).toBe("Admitted")
    if (later._tag === "Deferred") return
    expect((yield* admission.snapshot).positions.size).toBe(1)
    yield* admission.rollback(later.reservation, false)
    expect((yield* admission.snapshot).positions.size).toBe(0)
    expect(yield* Ref.get(releaseCalls)).toBe(2)
  }
)

it.effect("releases exact admission resources when interrupted after reservations and before owner registration", () =>
  assertInterruptedAdmissionHandoffReleases("AfterReservations").pipe(Effect.scoped)
)

it.effect(
  "releases exact admission resources when interrupted after owner registration and before child ownership",
  () => assertInterruptedAdmissionHandoffReleases("AfterOwnerRegistration").pipe(Effect.scoped)
)

it.effect("releases acquired integration ownership and its relation subscriber on interruption", () =>
  Effect.gen(function* () {
    const acquired = {
      ...proposal(0, TaskId.make("A")),
      admission: {
        integrationTarget: {
          _tag: "IntegrationTargetResourceRequired" as const,
          access: "Acquire" as const,
          integrationTarget: IntegrationTarget.make({
            repository: GitRepositoryLocator.make("/runtime-test/repository.git"),
            ref: IntegrationTargetRef.make("refs/heads/main")
          }),
          queuedAt: JournalPosition.make(40)
        },
        plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
        taskWorkPosition: { _tag: "NoTaskWorkPosition" as const }
      }
    }
    const evaluation = withProposals(yield* baseEvaluation, [acquired])
    const subscribers = yield* Ref.make(0)
    const evaluations = currentSignalFromCurrentFirstStream(
      Stream.fromEffect(Ref.update(subscribers, (count) => count + 1).pipe(Effect.as(evaluation))).pipe(
        Stream.concat(Stream.never),
        Stream.ensuring(Ref.update(subscribers, (count) => count - 1))
      )
    )
    const relation = evaluations satisfies DeliveryRuntimeInput
    const actionStarted = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (_action, lease) =>
        lease.acceptIntegrationTargetOwnership.pipe(
          Effect.andThen(Deferred.succeed(actionStarted, undefined)),
          Effect.andThen(Effect.never)
        )
    })
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
    const fiber = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(plannerLayer),
      Effect.provide(deterministicOperationIdAllocatorLayer("interrupt-cleanup")),
      Effect.provide(plannedAttemptProtocolControllerLayer),
      Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(actionStarted)
    expect((yield* integrationTargets.snapshot).heldResponsibilityPositions).toEqual(
      new Set([JournalPosition.make(40)])
    )
    expect(yield* Ref.get(subscribers)).toBe(1)

    yield* Fiber.interrupt(fiber)

    expect(yield* integrationTargets.snapshot).toEqual({
      activeResponsibilityPositions: new Set(),
      heldResponsibilityPositions: new Set()
    })
    expect(yield* Ref.get(subscribers)).toBe(0)
    const afterRollback = yield* capabilities.resources.runtimeObservation.get
    if (afterRollback._tag !== "Closed" || afterRollback.final === null) {
      return expect.fail("interrupted owner rollback must be observable")
    }
    expect(afterRollback.final.liveOwners).toEqual([])
  }).pipe(Effect.scoped)
)

it.effect("rolls back acquired integration ownership when the action fails", () =>
  Effect.gen(function* () {
    const acquired = {
      ...proposal(0, TaskId.make("A")),
      admission: {
        integrationTarget: {
          _tag: "IntegrationTargetResourceRequired" as const,
          access: "Acquire" as const,
          integrationTarget: IntegrationTarget.make({
            repository: GitRepositoryLocator.make("/runtime-test/failure-repository.git"),
            ref: IntegrationTargetRef.make("refs/heads/main")
          }),
          queuedAt: JournalPosition.make(41)
        },
        plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
        taskWorkPosition: { _tag: "NoTaskWorkPosition" as const }
      }
    }
    const relation = yield* dynamicEvaluationSignal(withProposals(yield* baseEvaluation, [acquired]))
    const actionFailure = new IntegratorBoundaryUnavailable({ boundary: "Integrator" })
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)

    expect(
      yield* runDeliveryRuntimeDecision(relation).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(deterministicOperationIdAllocatorLayer("failed-integration-action")),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.fail(actionFailure) })
        ),
        Effect.flip
      )
    ).toEqual(actionFailure)
    expect(yield* integrationTargets.snapshot).toEqual({
      activeResponsibilityPositions: new Set(),
      heldResponsibilityPositions: new Set()
    })
  }).pipe(Effect.scoped)
)

it.effect("fails with the exact relation cause before admitting any proposal", () =>
  Effect.gen(function* () {
    const relationFailure = { _tag: "TestRelationFailure" as const }
    const relation = currentSignalFromCurrentFirstStream(Stream.fail(relationFailure)) satisfies DeliveryRuntimeInput<
      typeof relationFailure
    >
    const executor = DeliveryActionExecutor.of({ execute: () => Effect.die("no action may start") })

    const failure = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.flip
    )

    expect(failure).toEqual(relationFailure)
  }).pipe(Effect.scoped)
)

it.effect("fails closed when the assembled relation reports conflicting proposal ownership", () =>
  Effect.gen(function* () {
    const conflictedId = DeliveryProposalId.make("runtime-owner-conflict")
    const conflicted = {
      ...(yield* baseEvaluation),
      proposedActions: {
        _tag: "DeliveryProposalOwnershipConflict" as const,
        conflicts: [
          {
            id: conflictedId,
            order: proposal(0, TaskId.make("runtime-owner-conflict")).order,
            owners: ["TrackerGraph" as const, "TicketDelivery" as const]
          }
        ] as const
      }
    }
    const relation = yield* dynamicEvaluationSignal(conflicted)
    const executor = DeliveryActionExecutor.of({ execute: () => Effect.die("conflict cannot authorize action") })

    const failure = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.flip
    )

    expect(failure).toBeInstanceOf(DeliveryRuntimeProposalOwnershipConflict)
    if (!(failure instanceof DeliveryRuntimeProposalOwnershipConflict))
      return expect.fail("expected ownership conflict")
    expect(failure.proposalIds).toEqual([conflictedId])
  }).pipe(Effect.scoped)
)

it.effect("rejects reconfirmation without both an established graph and its accepted position", () =>
  Effect.gen(function* () {
    const base = yield* baseEvaluation
    const projected = projectTrackerSnapshot({ revision: "invalid-reconfirmation", tasks: [] })
    if (projected._tag === "Invalid") return yield* Effect.die("empty reconfirmation graph must be valid")
    const established = TrackerGraphState.cases.GraphEstablished.make({
      observation: makeTestJournaledTrackerGraphObservation({
        operationId: OperationId.make("invalid-reconfirmation-operation"),
        recordedAt: JournalPosition.make(1),
        snapshot: projected.snapshot
      })
    })
    const invalid = [
      { ...base, quiescence: { _tag: "TrackerReconfirmationAllowed" as const } },
      {
        ...base,
        acceptedAt: null,
        current: { ...base.current, trackerGraph: established },
        quiescence: { _tag: "TrackerReconfirmationAllowed" as const }
      }
    ]

    for (const evaluation of invalid) {
      const failure = yield* runDeliveryRuntimeQuiescence(yield* dynamicEvaluationSignal(evaluation)).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("invalid reconfirmation cannot execute") })
        ),
        Effect.flip
      )
      expect(failure).toBeInstanceOf(DeliveryRuntimeReconfirmationStateInvalid)
    }
  }).pipe(Effect.scoped)
)

it.effect("returns the exact action failure after rolling back its process-local admission", () =>
  Effect.gen(function* () {
    const actionProposal = proposal(0, TaskId.make("action-failure"))
    const initial = withProposals(yield* baseEvaluation, [actionProposal], 1)
    const relation = yield* dynamicEvaluationSignal(initial)
    const actionFailure = new IntegratorBoundaryUnavailable({ boundary: "Integrator" })
    const executor = DeliveryActionExecutor.of({ execute: () => Effect.fail(actionFailure) })

    const failure = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.flip
    )

    expect(failure).toEqual(actionFailure)
  }).pipe(Effect.scoped)
)

it.effect("materializes accepted and source-derived operation identities only after admission", () =>
  Effect.gen(function* () {
    const requestId = TaskClaimReacquisitionRequestId.make("runtime-reacquisition-request")
    const reacquisition = recoveredProposalFor(
      RunnableFrontierTransition.CommitTaskClaimReacquisitionIntent({
        plannedAttempt,
        requestId,
        taskId: plannedAttempt.taskId
      })
    )
    const claimOperationId = OperationId.make("runtime-external-claim")
    const claim = ActiveTaskClaim.make({
      operationId: claimOperationId,
      owner: ClaimOwner.make("dalph"),
      taskId: plannedAttempt.taskId,
      token: ClaimToken.make("runtime-external-token")
    })
    const releaseOperation = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
      predecessorOperationIds: [claimOperationId],
      release: { claim, operationId: OperationId.make("runtime-release-placeholder") }
    })
    const externalRelease = recoveredProposalFor(
      RunnableFrontierTransition.ReleaseExternallyCompletedTaskClaim({ operation: releaseOperation, plannedAttempt })
    )
    const acceptedOperationId = OperationId.make("runtime-accepted-operation")
    const accepted = recoveredProposalFor(
      RunnableFrontierTransition.CheckTaskClaim({ operationId: acceptedOperationId, taskId: plannedAttempt.taskId }),
      new Set([acceptedOperationId])
    )
    const initial = withProposals(yield* baseEvaluation, [reacquisition, externalRelease, accepted], 1)
    const relation = yield* dynamicEvaluationSignal(initial)
    const actions = yield* Ref.make<ReadonlyArray<{ readonly id: DeliveryProposalId; readonly operationId: string }>>(
      []
    )
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Ref.update(actions, (current) => [
          ...current,
          {
            id: action.proposal.id,
            operationId:
              action._tag === "FreshOperationAction"
                ? action.operationId
                : action._tag === "AcceptedOperationAction"
                  ? acceptedWorkflowTransitionOperationId(action.proposal.route.transition)
                  : "unexpected"
          }
        ]).pipe(
          Effect.andThen(
            relation.get.pipe(
              Effect.flatMap((current) =>
                relation.publish(
                  withProposals(
                    current,
                    current.proposedActions._tag === "DeliveryProposalsAvailable"
                      ? current.proposedActions.proposals.filter(({ id }) => id !== action.proposal.id)
                      : [],
                    1
                  )
                )
              )
            )
          ),
          Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } as const)
        )
    })

    expect(
      yield* runDeliveryRuntimeDecision(relation).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(DeliveryActionExecutor, executor)
      )
    ).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
    expect(yield* Ref.get(actions)).toEqual([
      { id: reacquisition.id, operationId: taskClaimReacquisitionOperationId(requestId) },
      { id: externalRelease.id, operationId: `external-success-release:${claimOperationId}` },
      { id: accepted.id, operationId: acceptedOperationId }
    ])
  }).pipe(Effect.scoped)
)

it.effect("passes a deferred proposal without reordering the later proposals", () =>
  Effect.gen(function* () {
    const live = proposal(0, TaskId.make("live"))
    const blockedFirst = proposal(1, TaskId.make("blocked-first"))
    const blockedLater = proposal(2, TaskId.make("blocked-later"))
    const free = {
      ...trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(90),
        purpose: "EstablishCurrentGraph",
        runId,
        target
      }),
      id: DeliveryProposalId.make("runtime-free-later-proposal")
    }
    const initial = withProposals(yield* baseEvaluation, [live], 1)
    const relation = yield* dynamicEvaluationSignal(initial)
    const liveStarted = yield* Deferred.make<void>()
    const freeStarted = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action, lease) =>
        Effect.gen(function* () {
          if (action.proposal.id === live.id) {
            yield* Deferred.succeed(liveStarted, undefined)
          } else if (action.proposal.id === free.id) {
            yield* lease.bindPlannedAttemptPosition({ attemptId: plannedAttempt.attemptId, runId })
            yield* Deferred.succeed(freeStarted, undefined)
          }
          return yield* Effect.never
        })
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(liveStarted)
    yield* relation.publish(withProposals(initial, [blockedFirst, live, blockedLater, free], 1))
    yield* Deferred.await(freeStarted)
    yield* Fiber.interrupt(runtime)
  }).pipe(Effect.scoped)
)

it.effect("returns a relation failure published after actions have started", () =>
  Effect.gen(function* () {
    const actionProposal = proposal(0, TaskId.make("later-relation-failure"))
    const initial = withProposals(yield* baseEvaluation, [actionProposal], 1)
    const fail = yield* Deferred.make<void>()
    const relationFailure = { _tag: "LaterRelationFailure" as const }
    const evaluations = currentSignalFromCurrentFirstStream(
      Stream.succeed(initial).pipe(
        Stream.concat(Stream.fromEffect(Deferred.await(fail).pipe(Effect.andThen(Effect.fail(relationFailure)))))
      )
    )
    const relation = evaluations satisfies DeliveryRuntimeInput<typeof relationFailure>
    const started = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(started)
    yield* Deferred.succeed(fail, undefined)

    expect(yield* Effect.flip(Fiber.join(runtime))).toEqual(relationFailure)
  }).pipe(Effect.scoped)
)

it.effect("fails closed when a later evaluation introduces conflicting ownership", () =>
  Effect.gen(function* () {
    const actionProposal = proposal(0, TaskId.make("later-owner-conflict"))
    const initial = withProposals(yield* baseEvaluation, [actionProposal], 1)
    const dynamic = yield* dynamicEvaluationSignal(initial)
    const conflictedId = DeliveryProposalId.make("later-runtime-owner-conflict")
    const conflicted = {
      ...initial,
      proposedActions: {
        _tag: "DeliveryProposalOwnershipConflict" as const,
        conflicts: [
          { id: conflictedId, order: actionProposal.order, owners: ["TrackerGraph", "TicketDelivery"] }
        ] as const
      }
    }
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        dynamic.publish(conflicted).pipe(Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id }))
    })
    const failure = yield* runDeliveryRuntimeDecision(dynamic).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.flip
    )

    expect(failure).toBeInstanceOf(DeliveryRuntimeProposalOwnershipConflict)
    if (!(failure instanceof DeliveryRuntimeProposalOwnershipConflict))
      return expect.fail("expected ownership conflict")
    expect(failure.proposalIds).toEqual([conflictedId])
  }).pipe(Effect.scoped)
)

it.effect(
  "reaches tracker reconfirmation after cleanup defers and retries cleanup only after newer accepted facts",
  () =>
    Effect.gen(function* () {
      const deferredProposal = proposal(0, TaskId.make("deferred-finality-task"))
      const unrelatedProposal = proposal(1, TaskId.make("unrelated-runnable-task"))
      const projected = projectTrackerSnapshot({ revision: "deferred-cleanup-reconfirmation", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die("empty reconfirmation graph must be valid")
      const acceptedAt = JournalPosition.make(99)
      const base = yield* baseEvaluation
      const initial: DeliveryRuntimeEvaluation = {
        ...withProposals(base, [deferredProposal, unrelatedProposal], 2),
        acceptedAt,
        current: {
          ...base.current,
          trackerGraph: TrackerGraphState.cases.GraphEstablished.make({
            observation: makeTestJournaledTrackerGraphObservation({
              operationId: OperationId.make("deferred-cleanup-reconfirmation"),
              recordedAt: acceptedAt,
              snapshot: projected.snapshot
            })
          })
        },
        quiescence: { _tag: "TrackerReconfirmationAllowed" }
      }
      const dynamic = yield* dynamicEvaluationSignal(initial)
      const deferredCalls = yield* Ref.make(0)
      const unrelatedCalls = yield* Ref.make(0)
      const actionOutcomes = yield* Ref.make<ReadonlyArray<DeliveryActionResult>>([])
      const executor = DeliveryActionExecutor.of({
        execute: (action) => {
          if (action.proposal.id === deferredProposal.id) {
            return Effect.gen(function* () {
              const count = yield* Ref.updateAndGet(deferredCalls, (count) => count + 1)
              if (count === 1) {
                return {
                  _tag: "ActionDeferred",
                  proposalId: action.proposal.id,
                  reason: "CompletionClaimConflict"
                } satisfies DeliveryActionResult
              }
              const current = yield* dynamic.get
              yield* dynamic.publish({
                ...current,
                proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }
              })
              return { _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult
            })
          }
          return Ref.update(unrelatedCalls, (count) => count + 1).pipe(
            Effect.andThen(
              dynamic.publish({
                ...initial,
                proposedActions: {
                  _tag: "DeliveryProposalsAvailable",
                  isolatedIssues: [],
                  proposals: [deferredProposal]
                }
              })
            ),
            Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult)
          )
        }
      })
      const trace = DeliverySemanticTrace.of({
        emit: (event) =>
          event._tag === "ActionOutcome"
            ? Ref.update(actionOutcomes, (current) => [...current, event.result])
            : Effect.void
      })

      const firstQuiescence = yield* runDeliveryRuntimeQuiescence(dynamic).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.provideService(DeliverySemanticTrace, trace)
      )
      expect(firstQuiescence._tag).toBe("TrackerReconfirmationQuiescence")
      expect(firstQuiescence.acceptedAt).toBe(acceptedAt)
      expect(firstQuiescence.proposedActions.proposals).toEqual([])
      expect(yield* Ref.get(deferredCalls)).toBe(1)
      expect(yield* Ref.get(unrelatedCalls)).toBe(1)
      expect(yield* Ref.get(actionOutcomes)).toContainEqual({
        _tag: "ActionDeferred",
        proposalId: deferredProposal.id,
        reason: "CompletionClaimConflict"
      })

      const newerAcceptedAt = JournalPosition.make(100)
      yield* dynamic.publish({
        ...initial,
        acceptedAt: newerAcceptedAt,
        current: {
          ...initial.current,
          trackerGraph: TrackerGraphState.cases.GraphEstablished.make({
            observation: makeTestJournaledTrackerGraphObservation({
              operationId: OperationId.make("deferred-cleanup-reconfirmation-later-graph"),
              recordedAt: newerAcceptedAt,
              snapshot: projected.snapshot
            })
          })
        },
        proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [deferredProposal] }
      })
      const secondQuiescence = yield* runDeliveryRuntimeQuiescence(dynamic).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.provideService(DeliverySemanticTrace, trace)
      )
      if (secondQuiescence._tag !== "TrackerReconfirmationQuiescence") {
        return expect.fail("the later complete graph must reach tracker reconfirmation quiescence")
      }
      expect(secondQuiescence.acceptedAt).toBe(newerAcceptedAt)
      expect(secondQuiescence.current.trackerGraph.observation.recordedAt).toBe(newerAcceptedAt)
      expect(yield* Ref.get(deferredCalls)).toBe(2)
      expect(yield* Ref.get(unrelatedCalls)).toBe(1)
    }).pipe(Effect.scoped)
)

it.effect("processes a changed frontier without a caller-supplied runtime boundary", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const independentTaskId = TaskId.make("runtime-boundary-independent")
      const graphProjection = projectTrackerSnapshot({
        revision: "active-refresh-runtime-boundary",
        tasks: [
          { id: plannedAttempt.taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
          { id: independentTaskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
        ]
      })
      if (graphProjection._tag === "Invalid") return yield* Effect.die("active refresh boundary graph must be valid")
      const acceptedAt = JournalPosition.make(10)
      const graph = TrackerGraphState.cases.GraphEstablished.make({
        observation: makeTestJournaledTrackerGraphObservation({
          operationId: OperationId.make("active-refresh-runtime-boundary-graph"),
          recordedAt: acceptedAt,
          snapshot: graphProjection.snapshot
        })
      })
      const firstProposal = proposal(0, plannedAttempt.taskId)
      const independentProposal = proposal(1, independentTaskId)
      const first = {
        ...withProposals(
          {
            ...base,
            acceptedAt,
            current: { ...base.current, trackerGraph: graph },
            quiescence: { _tag: "TrackerReconfirmationAllowed" as const }
          },
          [firstProposal, independentProposal],
          1
        ),
        quiescence: { _tag: "TrackerReconfirmationAllowed" as const }
      }
      const relation = yield* dynamicEvaluationSignal(first)
      const executorCalls = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const executor = DeliveryActionExecutor.of({
        execute: (action) =>
          Effect.gen(function* () {
            yield* Ref.update(executorCalls, (calls) => [...calls, action.proposal.id])
            if (action.proposal.id === firstProposal.id) {
              yield* relation.publish({
                ...first,
                acceptedAt: JournalPosition.make(11),
                current: { ...first.current, trackerGraph: graph },
                proposedActions: {
                  _tag: "DeliveryProposalsAvailable",
                  isolatedIssues: [],
                  proposals: [independentProposal]
                }
              })
            } else {
              yield* relation.publish({
                ...first,
                acceptedAt: JournalPosition.make(12),
                current: { ...first.current, trackerGraph: graph },
                proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }
              })
            }
            return { _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult
          })
      })

      const result = yield* runDeliveryRuntimePhase(relation).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(DeliveryActionExecutor, executor)
      )

      if (result._tag !== "TrackerReconfirmationQuiescence") {
        return yield* Effect.die(`expected tracker reconfirmation, got ${result._tag}`)
      }
      expect(result.proposedActions.proposals).toEqual([])
      expect(result.acceptedAt).toBe(JournalPosition.make(12))
      expect(yield* Ref.get(executorCalls)).toEqual([firstProposal.id, independentProposal.id])
      const latest = yield* relation.get
      if (latest.proposedActions._tag !== "DeliveryProposalsAvailable") {
        return yield* Effect.die("the current evaluation must retain its descriptive proposal frontier")
      }
      expect(latest.proposedActions.proposals).toEqual([])
    })
  )
)

it.effect("holds old-graph admission until G2 after direct safe or terminal settlement", () =>
  Effect.gen(function* () {
    const reports = [
      PlannedAttemptExecutorReport.cases.SafelySuspended.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId }
      }),
      PlannedAttemptExecutorReport.cases.Terminal.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId },
        result: { _tag: "Completed" }
      })
    ] as const

    for (const report of reports) {
      const base = yield* baseEvaluation
      const active = recoveredProposalFor(
        RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
      )
      const independent = recoveredProposalFor(
        RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
          acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
          plannedAttempt: independentPlannedAttempt
        }),
        new Set(),
        independentPlannedAttempt
      )
      const initial = {
        ...withProposals(base, [active, independent], 2),
        taskWork: {
          capacity: TaskWorkCapacity.make(2),
          held: [{ taskId: plannedAttempt.taskId, correlation: { attemptId: plannedAttempt.attemptId, runId } }]
        }
      }
      const relation = yield* dynamicEvaluationSignal(initial)
      const executed = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const executor = DeliveryActionExecutor.of({
        execute: (action) =>
          Effect.gen(function* () {
            yield* Ref.update(executed, (ids) => [...ids, action.proposal.id])
            expect(action.proposal.id).toBe(active.id)
            yield* relation.publish({
              ...initial,
              proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [independent] }
            })
            return {
              _tag: "ExecutorReportPublished",
              plannedAttempt,
              proposalId: active.id,
              report
            } satisfies DeliveryActionResult
          })
      })
      const result = yield* runDeliveryRuntimePhase(
        relation,
        DeliveryRuntimePhase.ActiveRefreshPreG2([{ runId, attemptId: plannedAttempt.attemptId }])
      ).pipe(Effect.provide(identityLayers), Effect.provideService(DeliveryActionExecutor, executor))

      expect(result._tag).toBe("PassiveRuntimeQuiescence")
      expect(yield* Ref.get(executed)).toEqual([active.id])
    }
  })
)

it.effect("rejects a captured active proposal after G2 before admitting independent work", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const active = recoveredProposalFor(
        RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
      )
      const independent = proposal(1, independentPlannedAttempt.taskId)
      const acceptedAt = JournalPosition.make(10)
      const graphProjection = projectTrackerSnapshot({
        revision: "post-g2-active-suppression",
        tasks: [plannedAttempt.taskId, independentPlannedAttempt.taskId].map((taskId) => ({
          id: taskId,
          lifecycle: { _tag: "Open" as const },
          parentTaskId: null,
          prerequisiteIds: []
        }))
      })
      if (graphProjection._tag === "Invalid") return yield* Effect.die("post-G2 suppression graph must be valid")
      const graph = TrackerGraphState.cases.GraphEstablished.make({
        observation: makeTestJournaledTrackerGraphObservation({
          operationId: OperationId.make("post-g2-active-suppression-graph"),
          recordedAt: acceptedAt,
          snapshot: graphProjection.snapshot
        })
      })
      const relation = yield* dynamicEvaluationSignal({
        ...withProposals(
          {
            ...base,
            acceptedAt,
            current: { ...base.current, trackerGraph: graph },
            quiescence: { _tag: "TrackerReconfirmationAllowed" as const }
          },
          [active, independent],
          2
        ),
        quiescence: { _tag: "TrackerReconfirmationAllowed" as const },
        activeRefreshBoundary: {
          _tag: "ActiveRefreshRuntimeBoundary" as const,
          runId,
          reconciledAttempts: [{ runId, attemptId: plannedAttempt.attemptId }]
        },
        taskWork: {
          capacity: TaskWorkCapacity.make(2),
          held: [{ taskId: plannedAttempt.taskId, correlation: { runId, attemptId: plannedAttempt.attemptId } }]
        }
      })
      const executed = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const executor = DeliveryActionExecutor.of({
        execute: ({ proposal: action }) =>
          Ref.update(executed, (current) => [...current, action.id]).pipe(
            Effect.andThen(
              relation.publish({
                ...withProposals(
                  {
                    ...base,
                    acceptedAt: JournalPosition.make(11),
                    current: { ...base.current, trackerGraph: graph },
                    quiescence: { _tag: "TrackerReconfirmationAllowed" as const }
                  },
                  [],
                  2
                ),
                quiescence: { _tag: "TrackerReconfirmationAllowed" as const },
                activeRefreshBoundary: {
                  _tag: "ActiveRefreshRuntimeBoundary" as const,
                  runId,
                  reconciledAttempts: [{ runId, attemptId: plannedAttempt.attemptId }]
                },
                taskWork: { capacity: TaskWorkCapacity.make(2), held: [] }
              })
            ),
            Effect.as({ _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult)
          )
      })
      const result = yield* runDeliveryRuntimePhase(
        relation,
        DeliveryRuntimePhase.ActiveRefreshPostG2([{ runId, attemptId: plannedAttempt.attemptId }])
      ).pipe(Effect.provide(identityLayers), Effect.provideService(DeliveryActionExecutor, executor))

      expect(result._tag).toBe("TrackerReconfirmationQuiescence")
      expect(yield* Ref.get(executed)).toEqual([independent.id])
    })
  )
)

it.effect("quiesces after G2 when retained active capacity cannot be freed locally", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const retainedTaskId = plannedAttempt.taskId
      const independentTaskId = TaskId.make("runtime-post-g2-retained-independent")
      const graphProjection = projectTrackerSnapshot({
        revision: "post-g2-retained-capacity",
        tasks: [
          { id: retainedTaskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
          { id: independentTaskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
        ]
      })
      if (graphProjection._tag === "Invalid") return yield* Effect.die("post-G2 retained graph must be valid")
      const acceptedAt = JournalPosition.make(10)
      const graph = TrackerGraphState.cases.GraphEstablished.make({
        observation: makeTestJournaledTrackerGraphObservation({
          operationId: OperationId.make("post-g2-retained-graph"),
          recordedAt: acceptedAt,
          snapshot: graphProjection.snapshot
        })
      })
      const boundary = {
        _tag: "ActiveRefreshRuntimeBoundary" as const,
        runId,
        reconciledAttempts: [{ runId, attemptId: plannedAttempt.attemptId }]
      }
      const independent = proposal(0, independentTaskId)
      const initial = {
        ...withProposals(
          {
            ...base,
            acceptedAt,
            current: { ...base.current, trackerGraph: graph },
            quiescence: { _tag: "TrackerReconfirmationAllowed" as const }
          },
          [independent],
          1
        ),
        activeRefreshBoundary: boundary,
        quiescence: { _tag: "TrackerReconfirmationAllowed" as const },
        taskWork: {
          capacity: TaskWorkCapacity.make(1),
          held: [{ taskId: retainedTaskId, correlation: { runId, attemptId: plannedAttempt.attemptId } }]
        }
      } satisfies DeliveryRuntimeEvaluation
      const relation = yield* dynamicEvaluationSignal(initial)
      const executed = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const result = yield* runDeliveryRuntimePhase(
        relation,
        DeliveryRuntimePhase.ActiveRefreshPostG2([{ runId, attemptId: plannedAttempt.attemptId }])
      ).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({
            execute: ({ proposal: action }) =>
              Ref.update(executed, (current) => [...current, action.id]).pipe(
                Effect.andThen(Effect.die("retained capacity must not admit independent work"))
              )
          })
        )
      )

      expect(result._tag).toBe("TrackerReconfirmationQuiescence")
      expect(result.proposedActions.proposals).toEqual([])
      expect(yield* Ref.get(executed)).toEqual([])
    })
  )
)

it.effect("continues waiting after G2 while an in-flight action can free retained capacity", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const retainedTaskId = plannedAttempt.taskId
      const independentTaskId = TaskId.make("runtime-post-g2-in-flight-independent")
      const graphProjection = projectTrackerSnapshot({
        revision: "post-g2-in-flight-capacity",
        tasks: [
          { id: retainedTaskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
          { id: independentTaskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
        ]
      })
      if (graphProjection._tag === "Invalid") return yield* Effect.die("post-G2 in-flight graph must be valid")
      const acceptedAt = JournalPosition.make(10)
      const graph = TrackerGraphState.cases.GraphEstablished.make({
        observation: makeTestJournaledTrackerGraphObservation({
          operationId: OperationId.make("post-g2-in-flight-graph"),
          recordedAt: acceptedAt,
          snapshot: graphProjection.snapshot
        })
      })
      const boundary = {
        _tag: "ActiveRefreshRuntimeBoundary" as const,
        runId,
        reconciledAttempts: [{ runId, attemptId: plannedAttempt.attemptId }]
      }
      const active = proposal(0, retainedTaskId)
      const independent = proposal(1, independentTaskId)
      const initial = {
        ...withProposals(
          {
            ...base,
            acceptedAt,
            current: { ...base.current, trackerGraph: graph },
            quiescence: { _tag: "TrackerReconfirmationAllowed" as const }
          },
          [active],
          2
        ),
        activeRefreshBoundary: boundary,
        quiescence: { _tag: "TrackerReconfirmationAllowed" as const }
      } satisfies DeliveryRuntimeEvaluation
      const relation = yield* dynamicEvaluationSignal(initial)
      const activeStarted = yield* Deferred.make<void>()
      const independentStarted = yield* Deferred.make<void>()
      const finishActive = yield* Deferred.make<void>()
      const executed = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const executor = DeliveryActionExecutor.of({
        execute: ({ proposal: action }) =>
          Effect.gen(function* () {
            yield* Ref.update(executed, (current) => [...current, action.id])
            if (action.id === active.id) {
              yield* Deferred.succeed(activeStarted, undefined)
              yield* relation.publish({
                ...initial,
                acceptedAt: JournalPosition.make(11),
                proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [independent] },
                taskWork: {
                  capacity: TaskWorkCapacity.make(1),
                  held: [{ taskId: retainedTaskId, correlation: { runId, attemptId: plannedAttempt.attemptId } }]
                }
              })
              yield* Deferred.await(finishActive)
              yield* relation.publish({
                ...initial,
                acceptedAt: JournalPosition.make(12),
                proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [independent] },
                taskWork: { capacity: TaskWorkCapacity.make(1), held: [] }
              })
              return { _tag: "ActionCompleted", proposalId: active.id } satisfies DeliveryActionResult
            }
            yield* Deferred.succeed(independentStarted, undefined)
            yield* relation.publish({
              ...initial,
              acceptedAt: JournalPosition.make(13),
              proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] },
              taskWork: { capacity: TaskWorkCapacity.make(1), held: [] }
            })
            return { _tag: "ActionCompleted", proposalId: independent.id } satisfies DeliveryActionResult
          })
      })
      const runtime = yield* runDeliveryRuntimePhase(
        relation,
        DeliveryRuntimePhase.ActiveRefreshPostG2([{ runId, attemptId: plannedAttempt.attemptId }])
      ).pipe(Effect.provide(identityLayers), Effect.provideService(DeliveryActionExecutor, executor), Effect.forkChild)

      yield* Deferred.await(activeStarted)
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(independentStarted)).toBe(false)
      expect(yield* Ref.get(executed)).toEqual([active.id])
      yield* Deferred.succeed(finishActive, undefined)
      yield* Deferred.await(independentStarted)
      expect(yield* Fiber.join(runtime)).toMatchObject({ _tag: "TrackerReconfirmationQuiescence" })
      expect(yield* Ref.get(executed)).toEqual([active.id, independent.id])
    })
  )
)

it.effect("fails closed on a pre-G2 proposal ownership conflict", () =>
  Effect.gen(function* () {
    const base = yield* baseEvaluation
    const conflicted = proposal(0, TaskId.make("pre-g2-conflict-task"))
    const relation = yield* dynamicEvaluationSignal({
      ...withProposals(base, [], 2),
      activeRefreshBoundary: {
        _tag: "ActiveRefreshRuntimeBoundary" as const,
        runId,
        reconciledAttempts: [{ runId, attemptId: plannedAttempt.attemptId }]
      },
      proposedActions: {
        _tag: "DeliveryProposalOwnershipConflict" as const,
        conflicts: [{ id: conflicted.id, order: conflicted.order, owners: ["TrackerGraph", "TicketDelivery"] as const }]
      }
    })

    const failure = yield* runDeliveryRuntimePhase(
      relation,
      DeliveryRuntimePhase.ActiveRefreshPreG2([{ runId, attemptId: plannedAttempt.attemptId }])
    ).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(
        DeliveryActionExecutor,
        DeliveryActionExecutor.of({ execute: () => Effect.die("conflict must fail before execution") })
      ),
      Effect.flip
    )

    expect(failure).toBeInstanceOf(DeliveryRuntimeProposalOwnershipConflict)
    if (failure instanceof DeliveryRuntimeProposalOwnershipConflict) {
      expect(failure.proposalIds).toEqual([conflicted.id])
    }
  })
)
