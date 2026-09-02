import { it } from "@effect/vitest"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Cause, Deferred, Effect, Fiber, Layer, Option, Queue, Ref, Stream, SubscriptionRef } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim, UnclaimedTask } from "../../authorities/task-tracker/claim-mutation.js"
import { TaskLifecycle, type Task } from "../../authorities/task-tracker/task.js"
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
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTargetLineageObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  TaskClaimReleaseAuthority
} from "../../workflow/registry/operation.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import { AttemptChoiceRequestId } from "../../workflow/protocols/attempt-choice/events.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
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
import { FreshWorkflowStep } from "./fresh-workflow-step.js"
import {
  currentSignalOf,
  currentSignalFromCurrentFirstStream,
  type DeliveryActionProposal,
  type DeliveryProposalFrontier,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeEvaluation,
  DeliveryRelationReconciliationError,
  deliveryFinalityOf,
  TrackerGraphRelationError,
  TrackerGraphState
} from "./relations.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../test/journaled-graph-observation.js"
import {
  DeliveryActionCompletionPublicationMismatch,
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
import {
  DeliveryRuntimeObservationObserver,
  type DeliveryRuntimeObservationState
} from "./delivery-runtime-observation.js"
import {
  makePlannedAttemptProtocolController,
  PlannedAttemptProtocolController,
  plannedAttemptProtocolControllerLayer
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import type { DeliveryRuntimeAdmissionController } from "./delivery-runtime-admission.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { deriveJournalResponsibilityFacts } from "../run/recovery-activation.js"
import { requiredPlannedAttemptPositionsOf } from "../run/required-planned-attempt-positions.js"
import {
  makeFocusedTaskClaimFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import {
  makePreparedBeginFixture,
  preparedBeginProposalsOf as derivePreparedBeginProposals
} from "../../../test/support/prepared-begin-proposal.js"
import { DeliveryAcceptedFactPublication } from "./delivery-accepted-fact-publication.js"
import { deliveryRuntimeLocalDeferralAfter, DeliveryRuntimeLocalDeferral } from "./delivery-runtime-local-deferral.js"
import { reconcileDeliveryRuntimeLocalDeferrals } from "./delivery-runtime-local-deferral-reconciliation.js"
import { executeFreshPlannedAttempt } from "./planned-attempt-delivery-action-adapter.js"
import {
  PassivePlannedAttemptObserver,
  PassivePlannedAttemptProjectionPublication
} from "../run/passive-planned-attempt-observer.js"

const deliveryRuntimeResourceCapabilitiesOf = Effect.fn("RunDeliveryRuntimeTest.makeCapabilities")(function* (
  integrationTargets: Parameters<typeof makeCapabilitiesWithAdmission>[0]
) {
  return yield* makeCapabilitiesWithAdmission(integrationTargets, (yield* makeApplicationExitLifecycle()).admission)
})

const testDeliveryRuntimeResourcesLayer = Layer.unwrap(
  makeApplicationExitLifecycle().pipe(Effect.map((lifecycle) => deliveryRuntimeResourcesLayer(lifecycle.admission)))
)

const runId = RunId.make("runtime-test-run")

const defaultAcceptedFactPublication = DeliveryAcceptedFactPublication.of({
  awaitCurrent: Effect.succeed({
    _tag: "DeliveryAcceptedPublicationBoundary",
    acceptedThrough: JournalPosition.make(1),
    runId
  })
})

const runDeliveryRuntimeQuiescence = <E>(
  relation: DeliveryRuntimeInput<E>,
  publication: DeliveryAcceptedFactPublication["Service"] = defaultAcceptedFactPublication
) => runDeliveryRuntime(runId, relation).pipe(Effect.provideService(DeliveryAcceptedFactPublication, publication))

const runDeliveryRuntimeDecision = <E>(relation: DeliveryRuntimeInput<E>) =>
  runDeliveryRuntimeQuiescence(relation).pipe(
    Effect.map(({ current, disposition, proposedActions }) => deliveryFinalityOf(current, proposedActions, disposition))
  )

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
  plannedAttemptProtocolControllerLayer,
  Layer.succeed(
    DeliveryAcceptedFactPublication,
    DeliveryAcceptedFactPublication.of({
      awaitCurrent: Effect.succeed({
        _tag: "DeliveryAcceptedPublicationBoundary",
        acceptedThrough: JournalPosition.make(1),
        runId
      })
    })
  )
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

const preparedAttemptFixture = (name: string) =>
  makePreparedBeginFixture(plannedAttempt, "runtime-admission-stalled", name)
const preparedBeginProposalsOf = (fixtures: ReadonlyArray<ReturnType<typeof preparedAttemptFixture>>) =>
  derivePreparedBeginProposals(runId, fixtures)

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
              acceptedAt: JournalPosition.make(1),
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

it.effect("admits independent D while recovered A and C perform read-only restart obligations", () =>
  Effect.gen(function* () {
    const attemptFor = (task: string, suffix: string) =>
      PlannedTaskAttempt.make({
        ...plannedAttempt,
        attemptId: AttemptId.make(`read-only-restart-${suffix}-attempt`),
        branch: TaskBranchRef.make(`refs/heads/dalph/read-only-restart-${suffix}`),
        taskId: TaskId.make(task),
        worktree: WorktreeLocator.make(`/runtime-test/read-only-restart-${suffix}`)
      })
    const attemptA = attemptFor("A", "a")
    const attemptC = attemptFor("C", "c")
    const readFor = (attempt: PlannedTaskAttempt) =>
      RunnableFrontierTransition.ReconcilePlannedAttemptExecutorWork({ plannedAttempt: attempt })
    const readA = readFor(attemptA)
    const readC = readFor(attemptC)
    const taskD = {
      id: TaskId.make("D"),
      lifecycle: TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: []
    }
    const claimD = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId: taskD.id,
      taskRevision: TaskRevision.make("read-only-restart-D-revision")
    })
    const claimStepD = FreshWorkflowStep.AcquireTaskClaim({
      predecessorOperationId: OperationId.make("read-only-restart-D-graph"),
      task: taskD
    })
    const proposals = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [{ step: claimStepD, transition: claimD }],
      responsibilities: [
        {
          _tag: "PlannedAttemptExecutorWorkResponsibility",
          beganAt: JournalPosition.make(1),
          plannedAttempt: attemptA
        },
        { _tag: "PlannedAttemptExecutorWorkResponsibility", beganAt: JournalPosition.make(2), plannedAttempt: attemptC }
      ],
      runId,
      transitions: [readA, readC, claimD]
    }).ticketDelivery
    const [proposalA, proposalC, proposalD] = proposals
    if (proposalA === undefined || proposalC === undefined || proposalD === undefined) {
      return yield* Effect.die("restart admission chronology did not derive A C and D")
    }
    expect([proposalA.admission.taskWorkPosition, proposalC.admission.taskWorkPosition]).toEqual([
      { _tag: "NoTaskWorkPosition" },
      { _tag: "NoTaskWorkPosition" }
    ])
    expect([proposalA.route, proposalC.route]).toEqual([
      { _tag: "IdentityFreeWorkflowRoute", transition: readA },
      { _tag: "IdentityFreeWorkflowRoute", transition: readC }
    ])
    expect(proposalD.admission.taskWorkPosition).toEqual({
      _tag: "TaskWorkPositionRequired",
      mode: "ReserveOrReuse",
      taskId: taskD.id
    })

    const initial = withProposals(yield* baseEvaluation, proposals, 1)
    const relation = yield* dynamicEvaluationSignal(initial)
    const started = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
    const allStarted = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: ({ proposal }) =>
        Ref.updateAndGet(started, (ids) => [...ids, proposal.id]).pipe(
          Effect.tap((ids) => (ids.length === 3 ? Deferred.succeed(allStarted, undefined) : Effect.void)),
          Effect.andThen(Effect.never)
        )
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )

    yield* Deferred.await(allStarted)
    expect(yield* Ref.get(started)).toEqual([proposalA.id, proposalC.id, proposalD.id])
    yield* Fiber.interrupt(runtime)
  }).pipe(Effect.scoped)
)

it.effect("gives retained B1 the released position before D and rejects uncorrelated B replacement work", () =>
  Effect.gen(function* () {
    const taskB = TaskId.make("retained-B")
    const retainedB = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("retained-B1"),
      branch: TaskBranchRef.make("refs/heads/dalph/retained-B1"),
      taskId: taskB,
      worktree: WorktreeLocator.make("/runtime-test/retained-B1")
    })
    const resumeB = RunnableFrontierTransition.ResumePlannedAttemptExecutorWorkAfterCurrentFacts({
      acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: PlannedAttemptExecutorReportOrdinal.make(2) },
      plannedAttempt: retainedB,
      witness: {
        activeTaskContinuationRead: {
          graphObservationOperationId: OperationId.make("retained-B-current-graph"),
          taskClaimObservationOperationId: OperationId.make("retained-B-current-claim"),
          taskWorkSpecificationObservationOperationId: OperationId.make("retained-B-current-specification")
        },
        targetLineageObservationOperationId: OperationId.make("retained-B-current-lineage"),
        worktreeObservationOperationId: OperationId.make("retained-B-current-worktree")
      }
    })
    const freshClaim = (taskId: TaskId, suffix: string) => {
      const task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
      const transition = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
        taskId,
        taskRevision: TaskRevision.make(`retained-priority-${suffix}-revision`)
      })
      return {
        step: FreshWorkflowStep.AcquireTaskClaim({
          predecessorOperationId: OperationId.make(`retained-priority-${suffix}-graph`),
          task
        }),
        transition
      }
    }
    const freshD = freshClaim(TaskId.make("retained-priority-D"), "D")
    const replacementB = freshClaim(taskB, "B2")
    const proposals = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [freshD, replacementB],
      responsibilities: [
        {
          _tag: "PlannedAttemptExecutorWorkResponsibility",
          beganAt: JournalPosition.make(3),
          plannedAttempt: retainedB
        }
      ],
      runId,
      transitions: [resumeB, freshD.transition, replacementB.transition]
    }).ticketDelivery
    const [retainedResume, independentD, uncorrelatedReplacement] = proposals
    if (retainedResume === undefined || independentD === undefined || uncorrelatedReplacement === undefined) {
      return yield* Effect.die("retained priority chronology did not derive B1 D and B2")
    }
    expect(retainedResume.admission).toMatchObject({
      plannedAttemptProtocol: {
        _tag: "PlannedAttemptProtocolRequired",
        correlation: { attemptId: retainedB.attemptId, runId }
      },
      taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId: taskB }
    })

    const heldA = {
      correlation: { attemptId: AttemptId.make("retained-priority-held-A"), runId },
      taskId: TaskId.make("retained-priority-A")
    }
    const releasing = {
      correlation: { attemptId: AttemptId.make("retained-priority-releasing"), runId },
      taskId: TaskId.make("retained-priority-releasing")
    }
    const initial = {
      ...withProposals(yield* baseEvaluation, proposals, 2),
      taskWork: { capacity: TaskWorkCapacity.make(2), held: [heldA, releasing] }
    }
    const relation = yield* dynamicEvaluationSignal(initial)
    const retainedDeferred = yield* Deferred.make<void>()
    const retainedStarted = yield* Deferred.make<void>()
    const independentStarted = yield* Deferred.make<void>()
    const replacementStarted = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: ({ proposal }) =>
        proposal.id === retainedResume.id
          ? Deferred.succeed(retainedStarted, undefined).pipe(Effect.andThen(Effect.never))
          : proposal.id === independentD.id
            ? Deferred.succeed(independentStarted, undefined).pipe(Effect.andThen(Effect.never))
            : Deferred.succeed(replacementStarted, undefined).pipe(Effect.andThen(Effect.never))
    })
    const trace = DeliverySemanticTrace.of({
      emit: (event) =>
        event._tag === "ProposalDeferred" && event.proposalId === retainedResume.id
          ? Deferred.succeed(retainedDeferred, undefined)
          : Effect.void
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.provideService(DeliverySemanticTrace, trace),
      Effect.forkChild
    )

    yield* Deferred.await(retainedDeferred)
    expect(yield* Deferred.isDone(retainedStarted)).toBe(false)
    yield* relation.publish({ ...initial, taskWork: { capacity: TaskWorkCapacity.make(2), held: [heldA] } })
    yield* Deferred.await(retainedStarted)
    yield* Effect.yieldNow
    expect(yield* Deferred.isDone(independentStarted)).toBe(false)
    expect(yield* Deferred.isDone(replacementStarted)).toBe(false)
    yield* Fiber.interrupt(runtime)
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

it.effect("does not repeat task C's current-graph read when task B's accepted read changes its predecessor", () =>
  Effect.gen(function* () {
    const taskId = TaskId.make("C")
    const task: Task = {
      id: taskId,
      lifecycle: TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: []
    }
    const currentGraphRead = (predecessor: string) => {
      const transition = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
        taskId,
        taskRevision: TaskRevision.make("runtime-current-graph-C")
      })
      const step = FreshWorkflowStep.ReadCurrentTaskGraph({
        predecessorOperationId: OperationId.make(predecessor),
        task
      })
      return Option.getOrThrow(
        Option.fromUndefinedOr(
          deliveryProposalsOf({
            acceptedOperationIds: new Set(),
            fresh: [{ step, transition }],
            runId,
            transitions: [transition]
          }).ticketDelivery[0]
        )
      )
    }

    const first = currentGraphRead("graph-before-B-read")
    const superseding = currentGraphRead("accepted-B-read")
    const independent = proposal(1, TaskId.make("independent-after-B-read"))
    expect(superseding.id).not.toBe(first.id)
    const initial = withProposals(yield* baseEvaluation, [first], 2)
    const relation = yield* dynamicEvaluationSignal(initial)
    const firstStarted = yield* Deferred.make<void>()
    const finishFirst = yield* Deferred.make<void>()
    const firstOutcome = yield* Deferred.make<void>()
    const supersedingStarted = yield* Deferred.make<void>()
    const independentStarted = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Effect.gen(function* () {
          if (action.proposal.id === first.id) {
            yield* Deferred.succeed(firstStarted, undefined)
            yield* relation.publish(withProposals(initial, [superseding], 2))
            yield* Deferred.await(finishFirst)
          } else if (action.proposal.id === superseding.id) {
            yield* Deferred.succeed(supersedingStarted, undefined)
          } else {
            yield* Deferred.succeed(independentStarted, undefined)
            yield* relation.publish(withProposals(initial, [], 2))
          }
          return { _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult
        })
    })
    const trace = DeliverySemanticTrace.of({
      emit: (event) =>
        event._tag === "ActionOutcome" && event.result.proposalId === first.id
          ? Deferred.succeed(firstOutcome, undefined)
          : Effect.void
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.provideService(DeliverySemanticTrace, trace),
      Effect.forkChild
    )

    yield* Deferred.await(firstStarted)
    expect(yield* Deferred.isDone(supersedingStarted)).toBe(false)
    yield* Deferred.succeed(finishFirst, undefined)
    yield* Deferred.await(firstOutcome)
    yield* relation.publish(withProposals(initial, [superseding, independent], 2))
    yield* Deferred.await(independentStarted)
    expect(yield* Deferred.isDone(supersedingStarted)).toBe(false)
    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
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
          ? relation
              .publish(withProposals(initial, [stopped, marker], 2))
              .pipe(
                Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult)
              )
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
          acceptedAt: JournalPosition.make(1),
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
    const pending = yield* Deferred.make<void>()
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
            event._tag === "ActionCompletionPublicationPending" && event.proposalId === persistent.id
              ? Deferred.succeed(pending, undefined)
              : event._tag === "ActionOutcome" && event.result.proposalId === persistent.id
                ? Deferred.succeed(settled, undefined)
                : Effect.void
        })
      ),
      Effect.forkChild
    )
    yield* Deferred.await(started)
    yield* relation.publish(initial)
    yield* Deferred.succeed(finish, undefined)
    yield* Deferred.await(pending)
    yield* relation.publish(initial)
    yield* relation.publish(withProposals(initial, []))
    yield* Deferred.await(settled)
    const quiescence = yield* Fiber.join(runtime)
    expect(yield* Ref.get(starts)).toBe(1)
    expect(quiescence.proposedActions).toEqual(withProposals(initial, []).proposedActions)
    expect(quiescence.disposition).toEqual({ _tag: "QuiescencePassive", reason: "RunPaused" })
  }).pipe(Effect.scoped)
)

it.effect("settles one unchanged passive observation owner without re-admission or successor permission", () =>
  Effect.gen(function* () {
    const observe = recoveredProposalFor(
      RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
        acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
        plannedAttempt
      })
    )
    const initial = withProposals(yield* baseEvaluation, [observe], 1)
    const relation = yield* dynamicEvaluationSignal(initial)
    const starts = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
    const applied = yield* Deferred.make<void>()
    const pending = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Ref.update(starts, (ids) => [...ids, action.proposal.id]).pipe(
          Effect.as({
            _tag: "ExecutorReportPublished",
            acceptedFacts: "UnchangedPassiveObservation",
            plannedAttempt,
            proposalId: action.proposal.id,
            report: {
              _tag: "ExecutorWorkExecuting",
              correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
            }
          } satisfies DeliveryActionResult)
        )
    })

    const runtime = yield* runDeliveryRuntimeQuiescence(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.provideService(
        DeliverySemanticTrace,
        DeliverySemanticTrace.of({
          emit: (event) =>
            event._tag === "ActionCompletionPublicationPending"
              ? Deferred.succeed(pending, undefined)
              : event._tag === "ActionOutcome"
                ? Deferred.succeed(applied, undefined)
                : Effect.void
        })
      ),
      Effect.forkChild
    )

    expect(
      yield* Effect.race(
        Deferred.await(applied).pipe(Effect.as("Applied" as const)),
        Deferred.await(pending).pipe(Effect.as("Pending" as const))
      )
    ).toBe("Applied")
    const quiescence = yield* Fiber.join(runtime)
    expect(yield* Ref.get(starts)).toEqual([observe.id])
    expect(quiescence.acceptedAt).toBe(initial.acceptedAt)
    expect(quiescence.proposedActions.proposals).toEqual([])
    expect(quiescence.current.trackerGraph).toEqual(initial.current.trackerGraph)
  }).pipe(Effect.scoped)
)

it.effect("admits an independently proposed suspension after one unchanged passive observation", () =>
  Effect.gen(function* () {
    const transitions = [
      RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
        acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
        plannedAttempt
      }),
      RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
    ] as const
    const proposals = deliveryProposalsOf({
      acceptedOperationIds: new Set<OperationId>(),
      fresh: [],
      integrationResponsibilities: [],
      responsibilities: [
        { _tag: "PlannedAttemptExecutorWorkResponsibility" as const, beganAt: JournalPosition.make(1), plannedAttempt }
      ],
      runId,
      transitions
    }).ticketDelivery
    const observe = proposals.find(({ route }) =>
      route._tag === "FreshExecutorWorkflowRoute"
        ? route.step._tag === "ObservePlannedAttemptExecutorWork"
        : route._tag === "IdentityFreeWorkflowRoute" && route.transition._tag === "ObservePlannedAttemptExecutorWork"
    )
    const suspension = proposals.find(
      ({ route }) =>
        route._tag === "IdentityFreeWorkflowRoute" && route.transition._tag === "SuspendPlannedAttemptExecutorWork"
    )
    if (observe === undefined || suspension === undefined) return yield* Effect.die("missing executor proposals")
    const relation = yield* dynamicEvaluationSignal(withProposals(yield* baseEvaluation, proposals, 1))
    const starts = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
    const suspensionStarted = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Ref.update(starts, (ids) => [...ids, action.proposal.id]).pipe(
          Effect.andThen(
            action.proposal.id === observe.id
              ? Effect.succeed({
                  _tag: "ExecutorReportPublished" as const,
                  acceptedFacts: "UnchangedPassiveObservation" as const,
                  plannedAttempt,
                  proposalId: action.proposal.id,
                  report: {
                    _tag: "ExecutorWorkExecuting" as const,
                    correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
                  }
                })
              : Deferred.succeed(suspensionStarted, undefined).pipe(Effect.andThen(Effect.never))
          )
        )
    })
    const runtime = yield* runDeliveryRuntimeQuiescence(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )

    yield* Deferred.await(suspensionStarted)
    expect(yield* Ref.get(starts)).toEqual([observe.id, suspension.id])
    yield* Fiber.interrupt(runtime)
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

it.effect("preserves both C2 delivery relation source failures after one admitted Suspend without retrying", () =>
  Effect.gen(function* () {
    const c2Attempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("attempt:C:2"),
      taskId: TaskId.make("C")
    })
    const c2Suspension = recoveredProposalFor(
      RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt: c2Attempt }),
      new Set(),
      c2Attempt
    )
    const relationFailures = [
      new TrackerGraphRelationError({
        cause: Cause.fail("the C2 tracker graph relation failed"),
        summary: "the accepted C2 report could not be joined to the tracker graph"
      }),
      new DeliveryRelationReconciliationError({
        cause: Cause.fail("the accepted C2 delivery relation could not reconcile")
      })
    ] as const

    for (const expected of relationFailures) {
      const executorCalls = yield* Ref.make(0)
      const publicationCalls = yield* Ref.make(0)
      const initial = {
        ...withProposals(yield* baseEvaluation, [c2Suspension], 1),
        taskWork: {
          capacity: TaskWorkCapacity.make(1),
          held: [{ taskId: c2Attempt.taskId, correlation: plannedAttemptExecutorCorrelation(c2Attempt) }]
        }
      }
      const relation = yield* dynamicEvaluationSignal(initial)
      const failure = yield* runDeliveryRuntimeQuiescence(
        relation,
        DeliveryAcceptedFactPublication.of({
          awaitCurrent: Ref.update(publicationCalls, (count) => count + 1).pipe(Effect.andThen(Effect.fail(expected)))
        })
      ).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({
            execute: (action) =>
              Effect.gen(function* () {
                expect(action.proposal).toEqual(c2Suspension)
                yield* Ref.update(executorCalls, (count) => count + 1)
                return {
                  _tag: "ExecutorReportPublished" as const,
                  acceptedFacts: "Changed" as const,
                  plannedAttempt: c2Attempt,
                  proposalId: action.proposal.id,
                  report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
                    correlation: plannedAttemptExecutorCorrelation(c2Attempt)
                  })
                }
              })
          })
        ),
        Effect.flip
      )

      expect(failure, expected._tag).toBe(expected)
      expect(yield* Ref.get(executorCalls), expected._tag).toBe(1)
      expect(yield* Ref.get(publicationCalls), expected._tag).toBe(1)
    }
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
    const pending = yield* Deferred.make<void>()

    const result = yield* Effect.race(
      runDeliveryRuntimeDecision(relation).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.provideService(
          DeliverySemanticTrace,
          DeliverySemanticTrace.of({
            emit: (event) =>
              event._tag === "ActionCompletionPublicationPending" ? Deferred.succeed(pending, undefined) : Effect.void
          })
        ),
        Effect.flip,
        Effect.map((failure) => ({ _tag: "Failed" as const, failure }))
      ),
      Deferred.await(pending).pipe(Effect.as({ _tag: "Pending" as const }))
    )

    expect(result).toEqual({ _tag: "Failed", failure: actionFailure })
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

      const result = yield* runDeliveryRuntimePhase(runId, relation).pipe(
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

it.effect("keeps an action owner until its accepted successor publication reaches the runtime", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const predecessor = proposal(0, TaskId.make("publication-through-predecessor"))
      const specification = proposal(1, TaskId.make("publication-through-specification-A"))
      const position21 = JournalPosition.make(21)
      const position22 = JournalPosition.make(22)
      const position23 = JournalPosition.make(23)
      const position24 = JournalPosition.make(24)
      const initial = {
        ...withProposals(base, [predecessor], 1),
        acceptedAt: position21,
        current: { ...base.current, runId }
      } satisfies DeliveryRuntimeEvaluation
      const relation = yield* dynamicEvaluationSignal(initial)
      const predecessorStarted = yield* Deferred.make<void>()
      const finishPredecessor = yield* Deferred.make<void>()
      const predecessorPending = yield* Deferred.make<void>()
      const staleEvaluationApplied = yield* Deferred.make<void>()
      const specificationStarted = yield* Deferred.make<void>()
      const executions = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const outcomes = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const executor = DeliveryActionExecutor.of({
        execute: ({ proposal: action }) =>
          Effect.gen(function* () {
            yield* Ref.update(executions, (current) => [...current, action.id])
            if (action.id === predecessor.id) {
              yield* Deferred.succeed(predecessorStarted, undefined)
              yield* Deferred.await(finishPredecessor)
              return { _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult
            }
            if (action.id !== specification.id) return yield* Effect.die("unexpected publication-through proposal")
            yield* Deferred.succeed(specificationStarted, undefined)
            yield* relation.publish({
              ...initial,
              acceptedAt: position24,
              proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }
            })
            return { _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult
          })
      })
      const observer = DeliveryRuntimeObservationObserver.of({
        observe: ({ evaluation, liveOwners }) =>
          evaluation.acceptedAt === position22 &&
          liveOwners.some(({ proposal: liveProposal }) => liveProposal.id === predecessor.id)
            ? Deferred.succeed(staleEvaluationApplied, undefined)
            : Effect.void
      })
      const trace = DeliverySemanticTrace.of({
        emit: (event) => {
          if (event._tag === "ActionOutcome") {
            return Ref.update(outcomes, (current) => [...current, event.result.proposalId])
          }
          return event._tag === "ActionCompletionPublicationPending" && event.proposalId === predecessor.id
            ? Deferred.succeed(predecessorPending, undefined)
            : Effect.void
        }
      })
      const publication = DeliveryAcceptedFactPublication.of({
        awaitCurrent: Ref.get(executions).pipe(
          Effect.map((current) => ({
            _tag: "DeliveryAcceptedPublicationBoundary" as const,
            acceptedThrough: current.at(-1) === predecessor.id ? position23 : position24,
            runId
          }))
        )
      })
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets).pipe(
        Effect.provideService(DeliveryRuntimeObservationObserver, observer)
      )
      const runtime = yield* runDeliveryRuntimeQuiescence(relation, publication).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(deterministicOperationIdAllocatorLayer("runtime-publication-through")),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.provideService(DeliverySemanticTrace, trace),
        Effect.forkChild
      )

      yield* Deferred.await(predecessorStarted)
      yield* relation.publish({
        ...initial,
        acceptedAt: position22,
        proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }
      })
      yield* Deferred.await(staleEvaluationApplied)

      // The accepted-fact boundary has already published position 23, but its
      // independent EvaluationChanged offer is deliberately held until below.
      yield* Deferred.succeed(finishPredecessor, undefined)
      yield* Deferred.await(predecessorPending)

      expect(runtime.pollUnsafe()).toBeUndefined()
      expect(yield* Ref.get(outcomes)).toEqual([])
      expect(yield* Ref.get(executions)).toEqual([predecessor.id])

      yield* relation.publish({
        ...initial,
        acceptedAt: position23,
        proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [specification] }
      })
      yield* Deferred.await(specificationStarted)

      const quiescence = yield* Fiber.join(runtime)
      expect(quiescence).toMatchObject({ _tag: "PassiveRuntimeQuiescence", acceptedAt: position24 })
      expect(yield* Ref.get(executions)).toEqual([predecessor.id, specification.id])
      expect(yield* Ref.get(outcomes)).toEqual([predecessor.id, specification.id])
    })
  )
)

it.effect("keeps a same-position worktree completion pending until its lineage successor reaches the runtime", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const position80 = JournalPosition.make(80)
      const position81 = JournalPosition.make(81)
      const attemptB = PlannedTaskAttempt.make({
        ...plannedAttempt,
        attemptId: AttemptId.make("same-position-runtime-B-attempt"),
        branch: TaskBranchRef.make("refs/heads/dalph/same-position-runtime-B"),
        taskId: TaskId.make("same-position-runtime-B"),
        worktree: WorktreeLocator.make("/runtime-test/same-position-B")
      })
      const worktreeOperation = makeTaskWorktreeObservationOperation({
        operationId: OperationId.make("same-position-runtime-A-worktree"),
        plannedAttempt,
        predecessorOperationIds: []
      })
      const claimOperation = makeTaskClaimObservationOperation(
        OperationId.make("same-position-runtime-C-claim"),
        target,
        independentPlannedAttempt.taskId
      )
      const lineageOperation = makeTargetLineageObservationOperation({
        integrationTarget: IntegrationTarget.make({
          repository: GitRepositoryLocator.make("/runtime-test/same-position-lineage.git"),
          ref: IntegrationTargetRef.make("refs/heads/main")
        }),
        operationId: OperationId.make("same-position-runtime-A-lineage"),
        plannedAttempt,
        predecessorOperationIds: [worktreeOperation.operationId]
      })
      const claimTransition = RunnableFrontierTransition.ObservePlannedAttemptContinuationClaim({
        operation: claimOperation,
        plannedAttempt: independentPlannedAttempt
      })
      const worktreeTransition = RunnableFrontierTransition.ObservePlannedAttemptContinuationWorktree({
        operation: worktreeOperation,
        plannedAttempt
      })
      const lineageTransition = RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
        operation: lineageOperation,
        plannedAttempt
      })
      const observationProposals = (
        transition: typeof worktreeTransition | typeof lineageTransition
      ): ReadonlyArray<DeliveryActionProposal> =>
        deliveryProposalsOf({
          acceptedOperationIds: new Set(),
          fresh: [],
          pendingReadOperationIds: new Set([transition.operation.operationId, claimOperation.operationId]),
          runId,
          transitions: [transition, claimTransition]
        }).ticketDelivery
      const worktreeAndClaim = observationProposals(worktreeTransition)
      const lineageAndClaim = observationProposals(lineageTransition)
      const worktree = worktreeAndClaim.find(
        ({ route }) => route._tag === "RecoveredNewActionRoute" && route.action._tag === "ReadTaskWorktree"
      )
      const lineage = lineageAndClaim.find(
        ({ route }) => route._tag === "RecoveredNewActionRoute" && route.action._tag === "ReadTargetLineage"
      )
      const claim = worktreeAndClaim.find(
        ({ route }) => route._tag === "RecoveredNewActionRoute" && route.action._tag === "ReadTaskClaim"
      )
      const [blockedD, blockedE] = preparedBeginProposalsOf([
        preparedAttemptFixture("same-position-D"),
        preparedAttemptFixture("same-position-E")
      ])
      if (
        worktree === undefined ||
        lineage === undefined ||
        claim === undefined ||
        blockedD === undefined ||
        blockedE === undefined
      ) {
        return yield* Effect.die("the same-position runtime fixture must derive A, C, D, and E proposals")
      }
      const held = [plannedAttempt, attemptB, independentPlannedAttempt].map((attempt) => ({
        correlation: plannedAttemptExecutorCorrelation(attempt),
        taskId: attempt.taskId
      }))
      const evaluation = (
        acceptedAt: JournalPosition,
        proposals: ReadonlyArray<DeliveryActionProposal>
      ): DeliveryRuntimeEvaluation => ({
        ...withProposals(base, proposals, 3),
        acceptedAt,
        current: { ...base.current, runId },
        taskWork: { capacity: TaskWorkCapacity.make(3), held }
      })
      const stale = evaluation(position80, [worktree, claim, blockedD, blockedE])
      const successor = evaluation(position80, [lineage, claim, blockedD, blockedE])
      const sentinel = evaluation(position81, [claim, blockedD, blockedE])
      const relation = yield* dynamicEvaluationSignal(stale)
      const worktreeStarted = yield* Deferred.make<void>()
      const finishWorktree = yield* Deferred.make<void>()
      const lineageStarted = yield* Deferred.make<void>()
      const finishLineage = yield* Deferred.make<void>()
      const worktreePending = yield* Deferred.make<void>()
      const worktreeApplied = yield* Deferred.make<void>()
      const lineagePending = yield* Deferred.make<void>()
      const blocked = yield* Ref.make<ReadonlySet<DeliveryProposalId>>(new Set())
      const calls = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const outcomes = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const publicationPosition = yield* Ref.make(position80)
      const executor = DeliveryActionExecutor.of({
        execute: ({ proposal: action }) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (current) => [...current, action.id])
            if (action.id === worktree.id) {
              yield* Deferred.succeed(worktreeStarted, undefined)
              yield* Deferred.await(finishWorktree)
              return { _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult
            }
            if (action.id === lineage.id) {
              yield* Deferred.succeed(lineageStarted, undefined)
              yield* Deferred.await(finishLineage)
              return { _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult
            }
            if (action.id === claim.id) {
              return {
                _tag: "ActionDeferred",
                proposalId: action.id,
                reason: "TrackerGraphReadUnavailable"
              } satisfies DeliveryActionResult
            }
            return yield* Effect.die("capacity-full D/E must not cross the executor boundary")
          })
      })
      const publication = DeliveryAcceptedFactPublication.of({
        awaitCurrent: Ref.get(publicationPosition).pipe(
          Effect.map((acceptedThrough) => ({
            _tag: "DeliveryAcceptedPublicationBoundary" as const,
            acceptedThrough,
            runId
          }))
        )
      })
      const trace = DeliverySemanticTrace.of({
        emit: (event) => {
          if (event._tag === "ActionCompletionPublicationPending") {
            return event.proposalId === worktree.id
              ? Deferred.succeed(worktreePending, undefined)
              : event.proposalId === lineage.id
                ? Deferred.succeed(lineagePending, undefined)
                : Effect.void
          }
          if (event._tag === "ActionOutcome") {
            return Ref.update(outcomes, (current) => [...current, event.result.proposalId]).pipe(
              Effect.andThen(
                event.result.proposalId === worktree.id ? Deferred.succeed(worktreeApplied, undefined) : Effect.void
              )
            )
          }
          return event._tag === "ProposalDeferred" &&
            (event.proposalId === blockedD.id || event.proposalId === blockedE.id)
            ? Ref.update(blocked, (current) => new Set(current).add(event.proposalId))
            : Effect.void
        }
      })
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
      const runtime = yield* runDeliveryRuntimeQuiescence(relation, publication).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(deterministicOperationIdAllocatorLayer("runtime-same-position-successor")),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.provideService(DeliverySemanticTrace, trace),
        Effect.forkChild
      )

      yield* Deferred.await(worktreeStarted)
      yield* Deferred.succeed(finishWorktree, undefined)
      expect(
        yield* Effect.race(
          Deferred.await(worktreePending).pipe(Effect.as("Pending" as const)),
          Deferred.await(worktreeApplied).pipe(Effect.as("Applied" as const))
        )
      ).toBe("Pending")
      const pendingObservation = yield* capabilities.resources.runtimeObservation.get
      if (pendingObservation._tag !== "Ready") return yield* Effect.die("the pending owner must be observable")
      expect(pendingObservation.liveOwners.map(({ proposal }) => proposal.id)).toContain(worktree.id)
      expect(yield* Ref.get(outcomes)).not.toContain(worktree.id)

      yield* relation.publish(successor)
      yield* Deferred.await(lineageStarted)
      yield* Deferred.await(worktreeApplied)
      yield* Ref.set(publicationPosition, position81)
      yield* Deferred.succeed(finishLineage, undefined)
      yield* Deferred.await(lineagePending)
      yield* relation.publish(sentinel)

      const result = yield* Fiber.join(runtime)
      expect(result._tag).toBe("TaskWorkAdmissionStalledRuntimeQuiescence")
      if (result._tag !== "TaskWorkAdmissionStalledRuntimeQuiescence") {
        return yield* Effect.die("full exact capacity must preserve D/E as admission-stalled")
      }
      expect(result.acceptedAt).toBe(position81)
      expect(result.taskWork.held.map(({ correlation }) => correlation)).toEqual(
        held.map(({ correlation }) => correlation)
      )
      expect(result.proposedActions.proposals).toEqual([blockedD, blockedE])
      expect((yield* relation.get).proposedActions).toMatchObject({ proposals: [claim, blockedD, blockedE] })
      const actionCalls = yield* Ref.get(calls)
      expect(actionCalls.filter((id) => id === worktree.id)).toHaveLength(1)
      expect(actionCalls.filter((id) => id === lineage.id)).toHaveLength(1)
      expect(actionCalls).not.toContain(blockedD.id)
      expect(actionCalls).not.toContain(blockedE.id)
      expect([...(yield* Ref.get(blocked))]).toEqual(expect.arrayContaining([blockedD.id, blockedE.id]))
      expect((yield* Ref.get(outcomes)).filter((id) => id === worktree.id)).toHaveLength(1)
    })
  )
)

it.effect("keeps a completion pending when newer accepted facts still retain its exact predecessor", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const predecessor = proposal(0, TaskId.make("newer-facts-retained-predecessor"))
      const acceptedThrough = JournalPosition.make(50)
      const newer = JournalPosition.make(51)
      const retainedBarrier = JournalPosition.make(52)
      const initial = {
        ...withProposals(base, [predecessor], 1),
        acceptedAt: acceptedThrough,
        current: { ...base.current, runId }
      } satisfies DeliveryRuntimeEvaluation
      const relation = yield* dynamicEvaluationSignal(initial)
      const started = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const pending = yield* Deferred.make<void>()
      const applied = yield* Deferred.make<void>()
      const retainedBarrierObserved = yield* Deferred.make<void>()
      const executor = DeliveryActionExecutor.of({
        execute: ({ proposal: action }) =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as({ _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult)
          )
      })
      const observer = DeliveryRuntimeObservationObserver.of({
        observe: ({ evaluation }) =>
          evaluation.acceptedAt === retainedBarrier ? Deferred.succeed(retainedBarrierObserved, undefined) : Effect.void
      })
      const trace = DeliverySemanticTrace.of({
        emit: (event) =>
          event._tag === "ActionCompletionPublicationPending"
            ? Deferred.succeed(pending, undefined)
            : event._tag === "ActionOutcome"
              ? Deferred.succeed(applied, undefined)
              : Effect.void
      })
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets).pipe(
        Effect.provideService(DeliveryRuntimeObservationObserver, observer)
      )
      const runtime = yield* runDeliveryRuntimeQuiescence(
        relation,
        DeliveryAcceptedFactPublication.of({
          awaitCurrent: Effect.succeed({ _tag: "DeliveryAcceptedPublicationBoundary", acceptedThrough, runId })
        })
      ).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(deterministicOperationIdAllocatorLayer("runtime-newer-retained-predecessor")),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.provideService(DeliverySemanticTrace, trace),
        Effect.forkChild
      )

      yield* Deferred.await(started)
      yield* Deferred.succeed(finish, undefined)
      expect(
        yield* Effect.race(
          Deferred.await(pending).pipe(Effect.as("Pending" as const)),
          Deferred.await(applied).pipe(Effect.as("Applied" as const))
        )
      ).toBe("Pending")
      yield* relation.publish({ ...initial, acceptedAt: newer })
      yield* relation.publish({ ...initial, acceptedAt: retainedBarrier })
      // Reaching the second retained evaluation proves the first evaluation's
      // post-application completion flush has returned without settling A.
      yield* Deferred.await(retainedBarrierObserved)
      expect(yield* Deferred.isDone(applied)).toBe(false)

      yield* relation.publish({
        ...initial,
        acceptedAt: retainedBarrier,
        proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }
      })
      expect(yield* Fiber.join(runtime)).toMatchObject({
        _tag: "PassiveRuntimeQuiescence",
        acceptedAt: retainedBarrier
      })
      expect(yield* Deferred.isDone(applied)).toBe(true)
    })
  )
)

it.effect("settles pending completions in their publication arrival order when one evaluation releases both", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const first = proposal(0, TaskId.make("publication-fifo-first"))
      const second = proposal(1, TaskId.make("publication-fifo-second"))
      const beforePublication = JournalPosition.make(25)
      const acceptedThrough = JournalPosition.make(26)
      const initial = {
        ...withProposals(base, [first, second], 2),
        acceptedAt: beforePublication,
        current: { ...base.current, runId }
      } satisfies DeliveryRuntimeEvaluation
      const relation = yield* dynamicEvaluationSignal(initial)
      const firstStarted = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()
      const releaseSecond = yield* Deferred.make<void>()
      const publicationReturned = yield* Queue.unbounded<DeliveryProposalId>()
      const completionPending = yield* Queue.unbounded<DeliveryProposalId>()
      const completing = yield* Ref.make(first.id)
      const outcomes = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const executor = DeliveryActionExecutor.of({
        execute: ({ proposal: action }) =>
          Effect.gen(function* () {
            if (action.id === first.id) {
              yield* Deferred.succeed(firstStarted, undefined)
              yield* Deferred.await(releaseFirst)
            } else if (action.id === second.id) {
              yield* Deferred.succeed(secondStarted, undefined)
              yield* Deferred.await(releaseSecond)
            } else {
              return yield* Effect.die("unexpected FIFO publication proposal")
            }
            yield* Ref.set(completing, action.id)
            return { _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult
          })
      })
      const publication = DeliveryAcceptedFactPublication.of({
        awaitCurrent: Effect.gen(function* () {
          const proposalId = yield* Ref.get(completing)
          yield* Queue.offer(publicationReturned, proposalId)
          return { _tag: "DeliveryAcceptedPublicationBoundary", acceptedThrough, runId }
        })
      })
      const runtime = yield* runDeliveryRuntimeQuiescence(relation, publication).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(deterministicOperationIdAllocatorLayer("runtime-publication-fifo")),
        Effect.provide(testDeliveryRuntimeResourcesLayer),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.provideService(
          DeliverySemanticTrace,
          DeliverySemanticTrace.of({
            emit: (event) => {
              if (event._tag === "ActionOutcome") {
                return Ref.update(outcomes, (current) => [...current, event.result.proposalId])
              }
              return event._tag === "ActionCompletionPublicationPending"
                ? Queue.offer(completionPending, event.proposalId)
                : Effect.void
            }
          })
        ),
        Effect.forkChild
      )

      yield* Deferred.await(firstStarted)
      yield* Deferred.await(secondStarted)
      yield* Deferred.succeed(releaseFirst, undefined)
      expect(yield* Queue.take(publicationReturned)).toBe(first.id)
      expect(yield* Queue.take(completionPending)).toBe(first.id)
      yield* Deferred.succeed(releaseSecond, undefined)
      expect(yield* Queue.take(publicationReturned)).toBe(second.id)
      expect(yield* Queue.take(completionPending)).toBe(second.id)

      expect(runtime.pollUnsafe()).toBeUndefined()
      expect(yield* Ref.get(outcomes)).toEqual([])

      yield* relation.publish({
        ...initial,
        acceptedAt: acceptedThrough,
        proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }
      })

      expect(yield* Fiber.join(runtime)).toMatchObject({
        _tag: "PassiveRuntimeQuiescence",
        acceptedAt: acceptedThrough
      })
      expect(yield* Ref.get(outcomes)).toEqual([first.id, second.id])
    })
  )
)

it.effect("fails closed when an action completion proof differs from the exact activation Run or proposal", () =>
  Effect.forEach(
    ["Run", "RunWithoutSnapshot", "ResultProposal"] as const,
    (mismatch) =>
      Effect.scoped(
        Effect.gen(function* () {
          const base = yield* baseEvaluation
          const expected = proposal(0, TaskId.make(`publication-mismatch-${mismatch}`))
          const acceptedThrough = JournalPosition.make(30)
          const initial = {
            ...withProposals(base, [expected], 1),
            acceptedAt: acceptedThrough,
            current: mismatch === "RunWithoutSnapshot" ? base.current : { ...base.current, runId }
          } satisfies DeliveryRuntimeEvaluation
          const relation = yield* dynamicEvaluationSignal(initial)
          const outcomes = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
          const unexpectedProposalId = DeliveryProposalId.make(`publication-mismatch-unexpected-${mismatch}`)
          const publication = DeliveryAcceptedFactPublication.of({
            awaitCurrent: Effect.succeed({
              _tag: "DeliveryAcceptedPublicationBoundary",
              acceptedThrough,
              runId: mismatch === "ResultProposal" ? runId : RunId.make("publication-mismatch-foreign-run")
            })
          })
          const executor = DeliveryActionExecutor.of({
            execute: () =>
              Effect.succeed({
                _tag: "ActionCompleted",
                proposalId: mismatch === "ResultProposal" ? unexpectedProposalId : expected.id
              })
          })
          const failure = yield* runDeliveryRuntimeQuiescence(relation, publication).pipe(
            Effect.provide(plannerLayer),
            Effect.provide(deterministicOperationIdAllocatorLayer(`runtime-publication-mismatch-${mismatch}`)),
            Effect.provide(testDeliveryRuntimeResourcesLayer),
            Effect.provide(plannedAttemptProtocolControllerLayer),
            Effect.provideService(DeliveryActionExecutor, executor),
            Effect.provideService(
              DeliverySemanticTrace,
              DeliverySemanticTrace.of({
                emit: (event) =>
                  event._tag === "ActionOutcome"
                    ? Ref.update(outcomes, (current) => [...current, event.result.proposalId])
                    : Effect.void
              })
            ),
            Effect.flip
          )

          expect(failure).toBeInstanceOf(DeliveryActionCompletionPublicationMismatch)
          if (!(failure instanceof DeliveryActionCompletionPublicationMismatch)) {
            return expect.fail("expected the completion publication mismatch")
          }
          expect(failure.expectedProposalId).toBe(expected.id)
          expect(failure.expectedRunId).toBe(runId)
          expect(yield* Ref.get(outcomes)).toEqual([])
        })
      ),
    { discard: true }
  )
)

it.effect("rolls back an owner when its pending completion loses the relation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const pending = proposal(0, TaskId.make("pending-completion-relation-failure"))
      const acceptedAt = JournalPosition.make(40)
      const acceptedThrough = JournalPosition.make(41)
      const initial = {
        ...withProposals(base, [pending], 1),
        acceptedAt,
        current: { ...base.current, runId }
      } satisfies DeliveryRuntimeEvaluation
      const relationFailure = { _tag: "PendingCompletionRelationFailure" as const }
      const failRelation = yield* Deferred.make<never, typeof relationFailure>()
      const relation = currentSignalFromCurrentFirstStream(
        Stream.concat(Stream.make(initial), Stream.fromEffect(Deferred.await(failRelation)))
      ) satisfies DeliveryRuntimeInput<typeof relationFailure>
      const completionPending = yield* Deferred.make<void>()
      const outcomes = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const executor = DeliveryActionExecutor.of({
        execute: ({ proposal: action }) => Effect.succeed({ _tag: "ActionCompleted", proposalId: action.id } as const)
      })
      const publication = DeliveryAcceptedFactPublication.of({
        awaitCurrent: Effect.succeed({ _tag: "DeliveryAcceptedPublicationBoundary", acceptedThrough, runId })
      })
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
      const runtime = yield* runDeliveryRuntimeQuiescence(relation, publication).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(deterministicOperationIdAllocatorLayer("runtime-pending-completion-relation-failure")),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.provideService(
          DeliverySemanticTrace,
          DeliverySemanticTrace.of({
            emit: (event) =>
              event._tag === "ActionOutcome"
                ? Ref.update(outcomes, (current) => [...current, event.result.proposalId])
                : event._tag === "ActionCompletionPublicationPending" && event.proposalId === pending.id
                  ? Deferred.succeed(completionPending, undefined)
                  : Effect.void
          })
        ),
        Effect.flip,
        Effect.forkChild
      )

      yield* Deferred.await(completionPending)
      const beforeFailure = yield* capabilities.resources.runtimeObservation.get
      expect(beforeFailure._tag).toBe("Ready")
      if (beforeFailure._tag !== "Ready") return expect.fail("pending completion owner must remain observable")
      expect(beforeFailure.liveOwners.map(({ proposal }) => proposal.id)).toEqual([pending.id])
      expect(yield* Ref.get(outcomes)).toEqual([])

      yield* Deferred.fail(failRelation, relationFailure)
      expect(yield* Fiber.join(runtime)).toEqual(relationFailure)
      const afterFailure = yield* capabilities.resources.runtimeObservation.get
      expect(afterFailure._tag).toBe("Closed")
      if (afterFailure._tag !== "Closed") return expect.fail("failed runtime observation must close")
      expect(afterFailure.final?.liveOwners).toEqual([])
      expect(yield* Ref.get(outcomes)).toEqual([])
    })
  )
)

it.effect("ignores a stale accepted frontier before it can call the executor", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const holder = proposal(0, TaskId.make("accepted-runtime-holder"))
      const stale = proposal(1, TaskId.make("stale-runtime-task"))
      const relation = yield* dynamicEvaluationSignal({
        ...withProposals(base, [holder]),
        acceptedAt: JournalPosition.make(10)
      })
      const executorCalls = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const holderStarted = yield* Deferred.make<void>()
      const releaseHolder = yield* Deferred.make<void>()
      const acceptedThirteenObserved = yield* Deferred.make<void>()
      const executor = DeliveryActionExecutor.of({
        execute: ({ proposal }) =>
          Effect.gen(function* () {
            yield* Ref.update(executorCalls, (calls) => [...calls, proposal.id])
            if (proposal.id !== holder.id) return yield* Effect.die("a stale proposal must never reach the executor")
            yield* Deferred.succeed(holderStarted, undefined)
            yield* Deferred.await(releaseHolder)
            return { _tag: "ActionCompleted", proposalId: proposal.id } satisfies DeliveryActionResult
          })
      })
      const observer = DeliveryRuntimeObservationObserver.of({
        observe: ({ evaluation }) =>
          evaluation.acceptedAt === JournalPosition.make(13)
            ? Deferred.succeed(acceptedThirteenObserved, undefined)
            : Effect.void
      })
      const runtime = yield* runDeliveryRuntimePhase(runId, relation).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.provideService(DeliveryRuntimeObservationObserver, observer),
        Effect.forkChild
      )

      yield* Deferred.await(holderStarted)
      yield* relation.publish({ ...withProposals(base, []), acceptedAt: JournalPosition.make(12) })
      yield* relation.publish({ ...withProposals(base, [stale]), acceptedAt: JournalPosition.make(11) })
      yield* relation.publish({ ...withProposals(base, []), acceptedAt: JournalPosition.make(13) })
      yield* Deferred.await(acceptedThirteenObserved)
      yield* Deferred.succeed(releaseHolder, undefined)

      const quiescence = yield* Fiber.join(runtime)
      expect(quiescence).toMatchObject({ _tag: "PassiveRuntimeQuiescence", acceptedAt: JournalPosition.make(13) })
      expect(yield* Ref.get(executorCalls)).toEqual([holder.id])
      expect(yield* Ref.get(executorCalls)).not.toContain(stale.id)
    })
  )
)

it.effect("accepts Pause during phase two and retains the exact G2 boundary without executor work", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const g2AcceptedAt = JournalPosition.make(7)
      const pauseAcceptedAt = JournalPosition.make(8)
      const waitingTaskId = independentPlannedAttempt.taskId
      const occupiedTaskId = TaskId.make("post-g2-pause-capacity-holder")
      const beginOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
      const suspendOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
      const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: plannedAttemptExecutorCorrelation(independentPlannedAttempt)
      })
      const safelySuspended = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: plannedAttemptExecutorCorrelation(independentPlannedAttempt)
      })
      const acquisition = {
        operationId: OperationId.make("post-g2-pause-independent-acquisition"),
        owner: ClaimOwner.make("dalph"),
        taskId: waitingTaskId,
        token: ClaimToken.make("post-g2-pause-independent-token")
      }
      const claimAcquisition = makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] })
      const attemptPlan = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("post-g2-pause-independent-plan"),
        plannedAttempt: independentPlannedAttempt,
        predecessorOperationIds: [acquisition.operationId]
      })
      const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
        event,
        key: describeJournalEvent(event).expectedKey,
        position: JournalPosition.make(position),
        runId
      })
      const executorChronology = [
        record(
          1,
          TaskClaimAcquisitionIntendedEvent.make({ operation: claimAcquisition, version: workflowJournalEventVersion })
        ),
        record(
          2,
          TaskClaimAcquiredEvent.make({
            claim: ActiveTaskClaim.make(acquisition),
            version: workflowJournalEventVersion
          })
        ),
        record(3, TaskAttemptPlannedEvent.make({ operation: attemptPlan, version: workflowJournalEventVersion })),
        record(
          4,
          PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
            plannedAttempt: independentPlannedAttempt,
            version: workflowJournalEventVersion
          })
        ),
        record(
          5,
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "Begin",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: beginOrdinal,
            plannedAttempt: independentPlannedAttempt,
            version: workflowJournalEventVersion
          })
        ),
        record(
          6,
          PlannedAttemptExecutorCommandResponseObservedEvent.make({
            commandOrdinal: beginOrdinal,
            occurrenceClassification: "NonActionOccurrence",
            plannedAttempt: independentPlannedAttempt,
            report: executing,
            version: workflowJournalEventVersion
          })
        ),
        record(
          7,
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
            report: executing,
            version: workflowJournalEventVersion
          })
        ),
        record(
          8,
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "Suspend",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: suspendOrdinal,
            plannedAttempt: independentPlannedAttempt,
            version: workflowJournalEventVersion
          })
        ),
        record(
          9,
          PlannedAttemptExecutorCommandResponseObservedEvent.make({
            commandOrdinal: suspendOrdinal,
            occurrenceClassification: "NonActionOccurrence",
            plannedAttempt: independentPlannedAttempt,
            report: safelySuspended,
            version: workflowJournalEventVersion
          })
        ),
        record(
          10,
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
            report: safelySuspended,
            version: workflowJournalEventVersion
          })
        )
      ]
      const reducedB = reduceWorkflowJournalHistory(runId, executorChronology)
      if (reducedB._tag !== "ValidWorkflowJournalHistory") {
        return yield* Effect.die(
          `B's accepted executor chronology must reconstruct as valid journal history: ${JSON.stringify(reducedB.issues)}`
        )
      }
      const bFacts = deriveJournalResponsibilityFacts(reducedB.runState).find(
        (facts) =>
          facts._tag === "PlannedAttemptExecutorFreshFacts" &&
          facts.responsibility.plannedAttempt.runId === independentPlannedAttempt.runId &&
          facts.responsibility.plannedAttempt.attemptId === independentPlannedAttempt.attemptId
      )
      if (
        bFacts?._tag !== "PlannedAttemptExecutorFreshFacts" ||
        bFacts.disposition._tag !== "Ready" ||
        bFacts.disposition.acceptedProgress._tag !== "ExecutorReportAccepted"
      ) {
        return yield* Effect.die("B must be ready from its accepted safely suspended executor report")
      }
      const waiting = recoveredProposalFor(
        RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
          acceptedProgress: bFacts.disposition.acceptedProgress,
          plannedAttempt: independentPlannedAttempt
        }),
        new Set(),
        independentPlannedAttempt
      )
      const graphProjection = projectTrackerSnapshot({
        revision: "post-g2-pause",
        tasks: [plannedAttempt.taskId, waitingTaskId, occupiedTaskId].map((id) => ({
          id,
          lifecycle: { _tag: "Open" as const },
          parentTaskId: null,
          prerequisiteIds: []
        }))
      })
      if (graphProjection._tag === "Invalid") return yield* Effect.die("the accepted G2 graph must be valid")
      const graph = TrackerGraphState.cases.GraphEstablished.make({
        observation: makeTestJournaledTrackerGraphObservation({
          operationId: OperationId.make("post-g2-pause-graph"),
          recordedAt: g2AcceptedAt,
          snapshot: graphProjection.snapshot
        })
      })
      const boundary = {
        _tag: "ActiveRefreshRuntimeBoundary" as const,
        runId,
        reconciledAttempts: [{ runId, attemptId: plannedAttempt.attemptId }]
      }
      const acceptedG2 = {
        ...withProposals(base, [waiting], 1),
        acceptedAt: g2AcceptedAt,
        activeRefreshBoundary: boundary,
        current: { ...base.current, trackerGraph: graph },
        pauseCoverage: {
          _tag: "PauseCoverageGraphEstablished" as const,
          applied: { run: { _tag: "RunUnpaused" as const }, tasks: { _tag: "NoTaskPauses" as const } },
          observedAt: g2AcceptedAt,
          snapshot: graphProjection.snapshot
        },
        quiescence: { _tag: "TrackerReconfirmationAllowed" as const },
        taskWork: {
          capacity: TaskWorkCapacity.make(1),
          held: [
            {
              correlation: { attemptId: AttemptId.make("post-g2-pause-capacity-attempt"), runId },
              taskId: occupiedTaskId
            }
          ]
        }
      } satisfies DeliveryRuntimeEvaluation
      expect(requiredPlannedAttemptPositionsOf(reducedB.runState)).toEqual([])
      expect(acceptedG2.taskWork.held.map(({ taskId }) => taskId)).toEqual([occupiedTaskId])
      expect(waiting.route).toMatchObject({
        transition: {
          acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: PlannedAttemptExecutorReportOrdinal.make(2) },
          plannedAttempt: independentPlannedAttempt
        }
      })
      const acceptedPause = {
        ...acceptedG2,
        acceptedAt: pauseAcceptedAt,
        pauseCoverage: {
          ...acceptedG2.pauseCoverage,
          applied: { run: { _tag: "RunPaused" as const }, tasks: { _tag: "NoTaskPauses" as const } }
        },
        proposedActions: { _tag: "DeliveryProposalsAvailable" as const, isolatedIssues: [], proposals: [] },
        quiescence: { _tag: "QuiescencePassive" as const, reason: "RunPaused" as const }
      } satisfies DeliveryRuntimeEvaluation
      const relation = yield* dynamicEvaluationSignal(acceptedG2)
      const waitingDeferred = yield* Deferred.make<void>()
      const trace = DeliverySemanticTrace.of({
        emit: (event) =>
          event._tag === "ProposalDeferred" && event.proposalId === waiting.id
            ? Deferred.succeed(waitingDeferred, undefined)
            : Effect.void
      })
      const executorCalls = yield* Ref.make(0)
      const runtime = yield* runDeliveryRuntimePhase(
        runId,
        relation,
        DeliveryRuntimePhase.ActiveRefreshPostG2([{ runId, attemptId: plannedAttempt.attemptId }])
      ).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(DeliverySemanticTrace, trace),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({
            execute: () => Ref.update(executorCalls, (count) => count + 1).pipe(Effect.andThen(Effect.die("unused")))
          })
        ),
        Effect.forkChild
      )
      yield* Deferred.await(waitingDeferred)
      yield* relation.publish(acceptedPause)
      const result = yield* Fiber.join(runtime)

      expect(result).toMatchObject({
        _tag: "PassiveRuntimeQuiescence",
        acceptedAt: pauseAcceptedAt,
        activeRefreshBoundary: boundary,
        current: { trackerGraph: graph },
        disposition: { _tag: "QuiescencePassive", reason: "RunPaused" },
        proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }
      })
      expect(yield* Ref.get(executorCalls)).toBe(0)
    })
  )
)

it.effect("holds old-graph admission until G2 after direct safe or terminal settlement", () =>
  Effect.gen(function* () {
    const reports = [
      PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId }
      }),
      PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
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
        RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
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
              acceptedFacts: "Changed",
              plannedAttempt,
              proposalId: active.id,
              report
            } satisfies DeliveryActionResult
          })
      })
      const result = yield* runDeliveryRuntimePhase(
        runId,
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
        runId,
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
        runId,
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

const runEffectiveAdmissionSnapshotScenario = Effect.fn("Test.runEffectiveAdmissionSnapshotScenario")(function* () {
  const base = yield* baseEvaluation
  const [a, b, c, d, e] = ["snapshot-A", "snapshot-B", "snapshot-C", "snapshot-D", "snapshot-E"].map(
    preparedAttemptFixture
  )
  if (a === undefined || b === undefined || c === undefined || d === undefined || e === undefined) {
    return yield* Effect.die("five effective admission snapshot fixtures must be present")
  }
  const [beginC, blockedD, blockedE] = preparedBeginProposalsOf([c, d, e])
  if (beginC === undefined || blockedD === undefined || blockedE === undefined) {
    return yield* Effect.die("C, D, and E must each produce one exact Begin proposal")
  }
  const blocked = [blockedD, blockedE] as const
  const initialAt = JournalPosition.make(1)
  const acceptedThrough = JournalPosition.make(4)
  const initial = {
    ...withProposals({ ...base, acceptedAt: initialAt }, [beginC, ...blocked], 3),
    current: { ...base.current, runId },
    taskWork: {
      capacity: TaskWorkCapacity.make(3),
      held: [a, b].map(({ attempt }) => ({
        correlation: plannedAttemptExecutorCorrelation(attempt),
        taskId: attempt.taskId
      }))
    }
  } satisfies DeliveryRuntimeEvaluation
  const accepted = {
    ...initial,
    acceptedAt: acceptedThrough,
    proposedActions: { _tag: "DeliveryProposalsAvailable" as const, isolatedIssues: [], proposals: blocked }
  } satisfies DeliveryRuntimeEvaluation
  const poison = {
    ...accepted,
    acceptedAt: JournalPosition.make(5),
    proposedActions: {
      _tag: "DeliveryProposalOwnershipConflict" as const,
      conflicts: [{ id: blockedD.id, order: blockedD.order, owners: ["TrackerGraph", "TicketDelivery"] }]
    }
  } satisfies DeliveryRuntimeEvaluation
  const relationSource = yield* dynamicEvaluationSignal(initial)
  const relationPublicationCount = yield* Ref.make(0)
  const relation = {
    ...relationSource,
    publish: (evaluation: DeliveryRuntimeEvaluation) =>
      relationSource
        .publish(evaluation)
        .pipe(Effect.andThen(Ref.update(relationPublicationCount, (count) => count + 1)))
  }
  const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
  const journal = InRunJournal.of({
    append: (recordRunId, key, event) =>
      Ref.modify(records, (current) => {
        const existing = current.find((record) => record.key === key)
        if (existing !== undefined) return [existing, current] as const
        const appended = {
          event,
          key,
          position: JournalPosition.make(current.length + 1),
          runId: recordRunId
        } satisfies JournalRecord
        return [appended, [...current, appended]] as const
      }),
    read: () => Ref.get(records)
  })
  const admissionCreated = yield* Deferred.make<DeliveryRuntimeAdmissionController>()
  const beginBoundary = yield* Deferred.make<{
    readonly journalTags: ReadonlyArray<JournalRecord["event"]["_tag"]>
    readonly position: unknown
  }>()
  const journalCountAtPublication = yield* Deferred.make<number>()
  const relationPublicationCountBeforeQuiescence = yield* Deferred.make<number>()
  const integrationTargets = yield* makeIntegrationTargetResourceController()
  const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
  const resources = {
    ...capabilities.resources,
    makeAdmissionController: (basis: Parameters<typeof capabilities.resources.makeAdmissionController>[0]) =>
      capabilities.resources
        .makeAdmissionController(basis)
        .pipe(Effect.tap((controller) => Deferred.succeed(admissionCreated, controller)))
  }
  const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
    correlation: plannedAttemptExecutorCorrelation(c.attempt)
  })
  const plannedAttemptExecutor = PlannedAttemptExecutor.of({
    begin: () =>
      Effect.gen(function* () {
        const admission = yield* Deferred.await(admissionCreated)
        yield* Deferred.succeed(beginBoundary, {
          journalTags: (yield* Ref.get(records)).map(({ event }) => event._tag),
          position: (yield* admission.snapshot).positions.get(c.attempt.taskId)
        })
        return executing
      }),
    observe: () => Effect.die("the attached C projection is supplied without another executor read"),
    requestSuspension: () => Effect.die("the snapshot scenario does not suspend C"),
    resume: () => Effect.die("the snapshot scenario does not resume C")
  })
  const passiveObserver = PassivePlannedAttemptObserver.of({
    attach: () => Effect.succeed({ acceptedFacts: "UnchangedPassiveObservation", report: executing })
  })
  const passivePublication = PassivePlannedAttemptProjectionPublication.of({
    publish: () => Effect.die("the controlled C attachment emits no later projection"),
    publishWithPermit: () => Effect.die("the controlled C attachment already has an accepted executing report")
  })
  const actionExecutor = DeliveryActionExecutor.of({
    execute: (action, lease) => {
      if (action._tag !== "IdentityFreeAction" || action.proposal.route._tag !== "FreshExecutorWorkflowRoute") {
        return Effect.die("only C's exact fresh executor action may cross the action boundary")
      }
      return executeFreshPlannedAttempt(action, action.proposal.route, lease).pipe(
        Effect.provideService(InRunJournal, journal),
        Effect.provideService(PlannedAttemptExecutor, plannedAttemptExecutor),
        Effect.provideService(PassivePlannedAttemptObserver, passiveObserver),
        Effect.provideService(PassivePlannedAttemptProjectionPublication, passivePublication)
      )
    }
  })
  const blockedIds = new Set(blocked.map(({ id }) => id))
  const deferred = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
  const trace = DeliverySemanticTrace.of({
    emit: (event) =>
      event._tag === "ProposalDeferred" && blockedIds.has(event.proposalId)
        ? Ref.modify(deferred, (current) => {
            if (current.includes(event.proposalId)) return [false, current] as const
            const next = [...current, event.proposalId]
            return [next.length === blocked.length, next] as const
          }).pipe(
            Effect.flatMap((publishCausalPoison) =>
              publishCausalPoison
                ? relation.publish(poison).pipe(
                    Effect.andThen(Ref.get(relationPublicationCount)),
                    Effect.flatMap((count) => Deferred.succeed(relationPublicationCountBeforeQuiescence, count))
                  )
                : Effect.void
            )
          )
        : Effect.void
  })
  const publication = DeliveryAcceptedFactPublication.of({
    awaitCurrent: Effect.gen(function* () {
      yield* Deferred.succeed(journalCountAtPublication, (yield* Ref.get(records)).length)
      yield* relation.publish(accepted)
      return { _tag: "DeliveryAcceptedPublicationBoundary" as const, acceptedThrough, runId }
    })
  })

  const result = yield* runDeliveryRuntimePhase(runId, relation).pipe(
    Effect.provide(plannerLayer),
    Effect.provide(deterministicOperationIdAllocatorLayer("runtime-effective-admission-snapshot")),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(deliveryRuntimeResourceCapabilitiesLayer({ ...capabilities, resources }).pipe(Layer.fresh)),
    Effect.provideService(DeliveryActionExecutor, actionExecutor),
    Effect.provideService(DeliveryAcceptedFactPublication, publication),
    Effect.provideService(DeliverySemanticTrace, trace)
  )
  return {
    acceptedTaskWork: accepted.taskWork,
    beginBoundary: yield* Deferred.await(beginBoundary),
    blocked,
    expectedCorrelations: [a, b, c].map(({ attempt }) => plannedAttemptExecutorCorrelation(attempt)),
    finalJournalTags: (yield* Ref.get(records)).map(({ event }) => event._tag),
    journalCountAtPublication: yield* Deferred.await(journalCountAtPublication),
    relationPublicationCountBeforeQuiescence: yield* Deferred.await(relationPublicationCountBeforeQuiescence),
    finalRelationPublicationCount: yield* Ref.get(relationPublicationCount),
    result
  }
})

it.effect(
  "binds C before its journal-first Begin and returns admission-stalled from the effective admission snapshot",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const scenario = yield* runEffectiveAdmissionSnapshotScenario()
        expect(scenario.beginBoundary.position).toMatchObject({ correlation: scenario.expectedCorrelations[2] })
        expect(scenario.beginBoundary.journalTags).toEqual([
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorCommandIntended"
        ])
        expect(scenario.result._tag).toBe("TaskWorkAdmissionStalledRuntimeQuiescence")
        expect(scenario.result.proposedActions.proposals).toEqual(scenario.blocked)
        if (scenario.result._tag !== "TaskWorkAdmissionStalledRuntimeQuiescence") {
          return yield* Effect.die("the effective admission snapshot must classify blocked D and E")
        }
        expect(scenario.result.taskWork.held.map(({ correlation }) => correlation)).toEqual(
          scenario.expectedCorrelations
        )
      })
    )
)

it.effect("does not journal or publish the process-local admission snapshot", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const scenario = yield* runEffectiveAdmissionSnapshotScenario()
      expect(scenario.finalJournalTags).toEqual([
        "PlannedAttemptExecutorWorkResponsibilityBegan",
        "PlannedAttemptExecutorCommandIntended",
        "PlannedAttemptExecutorCommandResponseObserved",
        "PlannedAttemptExecutorWorkReported"
      ])
      expect(scenario.journalCountAtPublication).toBe(scenario.finalJournalTags.length)
      expect(scenario.relationPublicationCountBeforeQuiescence).toBe(2)
      expect(scenario.finalRelationPublicationCount).toBe(scenario.relationPublicationCountBeforeQuiescence)
      expect(scenario.acceptedTaskWork.held.map(({ correlation }) => correlation)).toEqual(
        scenario.expectedCorrelations.slice(0, 2)
      )
      expect(scenario.result._tag).toBe("TaskWorkAdmissionStalledRuntimeQuiescence")
      if (scenario.result._tag !== "TaskWorkAdmissionStalledRuntimeQuiescence") {
        return yield* Effect.die("the process-local snapshot must not be persisted before quiescence")
      }
      expect(scenario.result.taskWork.held.map(({ correlation }) => correlation)).toEqual(scenario.expectedCorrelations)
    })
  )
)

it.effect(
  "returns admission-stalled quiescence with the blocked proposals when exact attempts hold all ordinary capacity",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const base = yield* baseEvaluation
        const [a, b, c, d, e] = ["A", "B", "C", "D", "E"].map(preparedAttemptFixture)
        if (a === undefined || b === undefined || c === undefined || d === undefined || e === undefined) {
          return yield* Effect.die("five exact prepared-attempt fixtures must be present")
        }
        const blocked = preparedBeginProposalsOf([d, e])
        expect(blocked).toHaveLength(2)
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
        const relation = yield* dynamicEvaluationSignal({
          ...withProposals(base, blocked, 3),
          taskWork: {
            capacity: TaskWorkCapacity.make(3),
            held: [a, b, c].map(({ attempt }) => ({
              taskId: attempt.taskId,
              correlation: plannedAttemptExecutorCorrelation(attempt)
            }))
          }
        })

        const result = yield* runDeliveryRuntimePhase(runId, relation).pipe(
          Effect.provide(identityLayers),
          Effect.provideService(
            DeliveryActionExecutor,
            DeliveryActionExecutor.of({ execute: () => Effect.die("full capacity must not execute D or E") })
          )
        )

        expect(result._tag).toBe("TaskWorkAdmissionStalledRuntimeQuiescence")
        expect(result.proposedActions.proposals).toEqual(blocked)
        if (result._tag !== "TaskWorkAdmissionStalledRuntimeQuiescence") {
          return yield* Effect.die("ordinary full capacity must return its typed descriptive result")
        }
        expect(result.taskWork.held.map(({ correlation }) => correlation)).toEqual(
          [a, b, c].map(({ attempt }) => plannedAttemptExecutorCorrelation(attempt))
        )
      })
    )
)

it.effect(
  "keeps exact passive attachments across unrelated accepted facts and returns blocked D and E as admission-stalled",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const [a, b, c, d, e] = ["passive-A", "passive-B", "passive-C", "blocked-D", "blocked-E"].map(
          preparedAttemptFixture
        )
        if (a === undefined || b === undefined || c === undefined || d === undefined || e === undefined) {
          return yield* Effect.die("five exact prepared-attempt fixtures must be present")
        }
        const observed = [a, b, c].map(({ attempt }) =>
          recoveredProposalFor(
            RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
              acceptedProgress: {
                _tag: "ExecutorReportAccepted",
                ordinal: PlannedAttemptExecutorReportOrdinal.make(1)
              },
              plannedAttempt: attempt
            }),
            new Set(),
            attempt
          )
        )
        const blocked = preparedBeginProposalsOf([d, e])
        const independentClaimTaskId = TaskId.make("passive-independent-claim-read")
        const independentClaimOperation = makeTaskClaimObservationOperation(
          OperationId.make("passive-independent-claim-read-operation"),
          target,
          independentClaimTaskId
        )
        const independentClaimRead = recoveredProposalFor(
          RunnableFrontierTransition.ObserveResponsibleTaskClaim({
            operation: independentClaimOperation,
            taskId: independentClaimTaskId
          }),
          new Set([independentClaimOperation.operationId]),
          a.attempt
        )
        const claimRecord = (position: number, event: JournalRecord["event"]): JournalRecord => ({
          event,
          key: describeJournalEvent(event).expectedKey,
          position: JournalPosition.make(position),
          runId
        })
        const claimReadIntent = claimRecord(1, taskTrackerReadIntent(independentClaimOperation))
        const claimReadObserved = claimRecord(
          2,
          taskTrackerFactsObservedEvent(
            independentClaimOperation.operationId,
            makeFocusedTaskClaimFactsObserved(
              independentClaimOperation,
              UnclaimedTask.make({ taskId: independentClaimTaskId })
            )
          )
        )
        const claimPublicationHistory = reduceWorkflowJournalHistory(runId, [claimReadIntent, claimReadObserved])
        if (claimPublicationHistory._tag !== "ValidWorkflowJournalHistory") {
          return yield* Effect.die(
            `the independent claim-read publication must be valid Journal history: ${JSON.stringify(claimPublicationHistory.issues)}`
          )
        }
        const acceptedAt = claimReadIntent.position
        const graphProjection = projectTrackerSnapshot({
          revision: "passive-attachment-claim-publication",
          tasks: [...[a, b, c, d, e].map(({ attempt }) => attempt.taskId), independentClaimTaskId].map((id) => ({
            id,
            lifecycle: { _tag: "Open" as const },
            parentTaskId: null,
            prerequisiteIds: []
          }))
        })
        if (graphProjection._tag === "Invalid") return yield* Effect.die("passive attachment graph must be valid")
        const capacityPolicy = RunControlPolicy.make({
          revision: initialRunPolicyRevision,
          taskExecutionCapacity: TaskWorkCapacity.make(3)
        })
        const graph = TrackerGraphState.cases.GraphEstablished.make({
          observation: makeTestJournaledTrackerGraphObservation({
            operationId: OperationId.make("passive-attachment-current-graph"),
            recordedAt: acceptedAt,
            snapshot: graphProjection.snapshot
          })
        })
        const proposalContributions = yield* SubscriptionRef.make({
          deliverySettlement: [],
          issues: [],
          ticketDelivery: [...observed, independentClaimRead, ...blocked]
        })
        const coherent = yield* SubscriptionRef.make<DeliveryRelationInputBundle>({
          actionInputs: {
            proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
            reflectionProposals: [],
            runtimeFacts: {
              acceptedAt,
              cancellationApplied: false,
              pauseCoverage: {
                _tag: "PauseCoverageGraphEstablished",
                applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
                observedAt: acceptedAt,
                snapshot: graphProjection.snapshot
              },
              quiescence: { _tag: "QuiescencePassive", reason: "RunPaused" },
              runId,
              taskWork: {
                capacity: TaskWorkCapacity.make(3),
                held: [a, b, c].map(({ attempt }) => ({
                  taskId: attempt.taskId,
                  correlation: plannedAttemptExecutorCorrelation(attempt)
                }))
              }
            },
            trackerGraphProposals: []
          },
          publication: { exactEvidence: [], graph, policy: capacityPolicy }
        })
        const relation = yield* deliveryRuntime.pipe(
          Effect.provide(
            makeDeliveryRelationsLayer({
              ...deterministicDeliveryRuntimeSupport(capacityPolicy),
              coherent: currentSignalFromCurrentFirstStream(SubscriptionRef.changes(coherent)),
              proposalContributions: currentSignalFromCurrentFirstStream(SubscriptionRef.changes(proposalContributions))
            })
          )
        )
        const initial = yield* relation.get
        if (initial.proposedActions._tag !== "DeliveryProposalsAvailable") {
          return yield* Effect.die("passive attachment proposals must have one owner each")
        }
        expect(new Set(initial.proposedActions.proposals.map(({ id }) => id))).toEqual(
          new Set([...observed, independentClaimRead, ...blocked].map(({ id }) => id))
        )
        expect(independentClaimRead.route).toMatchObject({
          _tag: "AcceptedWorkflowRoute",
          transition: {
            _tag: "ObserveResponsibleTaskClaim",
            operation: { operationId: independentClaimOperation.operationId, taskId: independentClaimTaskId }
          }
        })
        const calls = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
        const observationsSettled = yield* Deferred.make<void>()
        const observedIds = new Set(observed.map(({ id }) => id))
        const outcomes = yield* Ref.make(0)
        const result = yield* runDeliveryRuntimePhase(runId, relation).pipe(
          Effect.provide(identityLayers),
          Effect.provideService(
            DeliveryActionExecutor,
            DeliveryActionExecutor.of({
              execute: ({ proposal: action }) =>
                Effect.gen(function* () {
                  if (action.id === independentClaimRead.id) {
                    yield* Deferred.await(observationsSettled)
                    yield* SubscriptionRef.update(proposalContributions, (current) => ({
                      ...current,
                      ticketDelivery: current.ticketDelivery.filter(({ id }) => id !== independentClaimRead.id)
                    }))
                    yield* SubscriptionRef.update(coherent, (current) => ({
                      ...current,
                      actionInputs: {
                        ...current.actionInputs,
                        runtimeFacts: { ...current.actionInputs.runtimeFacts, acceptedAt: claimReadObserved.position }
                      }
                    }))
                    return { _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult
                  }
                  if (!observedIds.has(action.id)) return yield* Effect.die("blocked D or E must not execute")
                  const prior = yield* Ref.get(calls)
                  if (prior.includes(action.id)) return yield* Effect.die("exact passive owner attached twice")
                  yield* Ref.update(calls, (current) => [...current, action.id])
                  const fixture = [a, b, c].find(({ attempt }) =>
                    action.admission.plannedAttemptProtocol._tag === "PlannedAttemptProtocolRequired"
                      ? action.admission.plannedAttemptProtocol.correlation.attemptId === attempt.attemptId
                      : false
                  )
                  if (fixture === undefined) return yield* Effect.die("passive proposal lost its exact attempt")
                  return {
                    _tag: "ExecutorReportPublished",
                    acceptedFacts: "UnchangedPassiveObservation",
                    plannedAttempt: fixture.attempt,
                    proposalId: action.id,
                    report: {
                      _tag: "ExecutorWorkExecuting",
                      correlation: plannedAttemptExecutorCorrelation(fixture.attempt)
                    }
                  } satisfies DeliveryActionResult
                })
            })
          ),
          Effect.provideService(
            DeliverySemanticTrace,
            DeliverySemanticTrace.of({
              emit: (event) =>
                event._tag === "ActionOutcome" && observedIds.has(event.result.proposalId)
                  ? Ref.updateAndGet(outcomes, (count) => count + 1).pipe(
                      Effect.flatMap((count) =>
                        count === observed.length ? Deferred.succeed(observationsSettled, undefined) : Effect.void
                      )
                    )
                  : Effect.void
            })
          )
        )

        expect(yield* Ref.get(calls)).toEqual(observed.map(({ id }) => id))
        expect((yield* relation.get).acceptedAt).toBe(claimReadObserved.position)
        expect(result._tag).toBe("TaskWorkAdmissionStalledRuntimeQuiescence")
        expect(result.proposedActions.proposals).toEqual(blocked)
        if (result._tag !== "TaskWorkAdmissionStalledRuntimeQuiescence") {
          return yield* Effect.die("locally attached Observe proposals must leave only blocked D and E")
        }
        expect(result.taskWork.held.map(({ correlation }) => correlation)).toEqual(
          [a, b, c].map(({ attempt }) => plannedAttemptExecutorCorrelation(attempt))
        )
      })
    )
)

const freshExecutingObservePair = (name: string) => {
  const fixture = preparedAttemptFixture(name)
  const acceptedProgress = {
    _tag: "ExecutorReportAccepted" as const,
    ordinal: PlannedAttemptExecutorReportOrdinal.make(1)
  }
  const transition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
    acceptedProgress,
    plannedAttempt: fixture.attempt
  })
  const observeFor = (task: Task) =>
    deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [
        {
          step: FreshWorkflowStep.ObservePlannedAttemptExecutorWork({
            acceptedProgress,
            plannedAttempt: fixture.attempt,
            specification: fixture.fresh.step.specification,
            task
          }),
          transition
        }
      ],
      runId,
      transitions: [transition]
    }).ticketDelivery[0]
  const proposal = Option.getOrThrow(Option.fromUndefinedOr(observeFor(fixture.task)))
  const refreshed = Option.getOrThrow(
    Option.fromUndefinedOr(observeFor({ ...fixture.task, parentTaskId: TaskId.make(`${name}-refreshed-parent`) }))
  )
  return { fixture, proposal, refreshed }
}

it("derives a passive-attachment marker live-action key from its proposal", () => {
  const { fixture, proposal } = freshExecutingObservePair("derived-passive-marker-key")
  const deferral = Option.getOrThrow(
    deliveryRuntimeLocalDeferralAfter(
      {
        _tag: "ExecutorReportPublished",
        acceptedFacts: "UnchangedPassiveObservation",
        plannedAttempt: fixture.attempt,
        proposalId: proposal.id,
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: plannedAttemptExecutorCorrelation(fixture.attempt)
        })
      },
      proposal,
      JournalPosition.make(59)
    )
  )

  expect(deferral).toEqual(
    DeliveryRuntimeLocalDeferral.PassiveOwnerAttached({ liveActionKey: liveActionKeyOf(proposal) })
  )
})

it("does not transfer an accepted-facts deferral to a refreshed live-action proposal", () => {
  const { proposal, refreshed } = freshExecutingObservePair("exact-changed-facts-deferral")
  const acceptedAt = JournalPosition.make(59)
  expect(proposal.id).not.toBe(refreshed.id)
  expect(liveActionKeyOf(proposal)).toBe(liveActionKeyOf(refreshed))
  const deferral = DeliveryRuntimeLocalDeferral.AwaitChangedAcceptedFacts({ acceptedAt })

  const reconciled = reconcileDeliveryRuntimeLocalDeferrals(
    new Map([[proposal.id, deferral]]),
    { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [refreshed] },
    acceptedAt
  )

  expect(reconciled).toEqual(new Map())
})

it("drops a passive marker when the refreshed live action is ownership-conflicted", () => {
  const { proposal, refreshed } = freshExecutingObservePair("conflicted-passive-marker")
  expect(proposal.id).not.toBe(refreshed.id)
  expect(liveActionKeyOf(proposal)).toBe(liveActionKeyOf(refreshed))
  const deferral = DeliveryRuntimeLocalDeferral.PassiveOwnerAttached({ liveActionKey: liveActionKeyOf(proposal) })

  const reconciled = reconcileDeliveryRuntimeLocalDeferrals(
    new Map([[proposal.id, deferral]]),
    {
      _tag: "DeliveryProposalOwnershipConflict",
      conflicts: [{ id: refreshed.id, order: refreshed.order, owners: ["TrackerGraph", "TicketDelivery"] }]
    },
    JournalPosition.make(59)
  )

  expect(reconciled).toEqual(new Map())
})

it.effect("keeps three publication-through passive attachments across a post-completion route refresh", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const [a, b, c, d, e] = ["refresh-A", "refresh-B", "refresh-C", "refresh-D", "refresh-E"].map(
        preparedAttemptFixture
      )
      if (a === undefined || b === undefined || c === undefined || d === undefined || e === undefined) {
        return yield* Effect.die("five post-completion refresh fixtures must be present")
      }
      const acceptedProgress = {
        _tag: "ExecutorReportAccepted" as const,
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1)
      }
      const observeFor = (fixture: typeof a, task: Task) => {
        const transition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
          acceptedProgress,
          plannedAttempt: fixture.attempt
        })
        return deliveryProposalsOf({
          acceptedOperationIds: new Set(),
          fresh: [
            {
              step: FreshWorkflowStep.ObservePlannedAttemptExecutorWork({
                acceptedProgress,
                plannedAttempt: fixture.attempt,
                specification: fixture.fresh.step.specification,
                task
              }),
              transition
            }
          ],
          runId,
          transitions: [transition]
        }).ticketDelivery[0]
      }
      const fixtures = [a, b, c] as const
      const observed = fixtures.map((fixture) => observeFor(fixture, fixture.task))
      const refreshed = fixtures.map((fixture, index) =>
        observeFor(fixture, { ...fixture.task, parentTaskId: TaskId.make(`post-completion-refresh-parent-${index}`) })
      )
      if ([...observed, ...refreshed].some((candidate) => candidate === undefined)) {
        return yield* Effect.die("all post-completion Observe routes must be derivable")
      }
      const exactObserved = observed as ReadonlyArray<DeliveryActionProposal>
      const exactRefreshed = refreshed as ReadonlyArray<DeliveryActionProposal>
      for (const [index, initialObserve] of exactObserved.entries()) {
        const refreshedObserve = exactRefreshed[index]
        if (refreshedObserve === undefined) return yield* Effect.die("each Observe must have a refreshed route")
        expect(refreshedObserve.id).not.toBe(initialObserve.id)
        expect(liveActionKeyOf(refreshedObserve)).toBe(liveActionKeyOf(initialObserve))
      }
      const blocked = preparedBeginProposalsOf([d, e])
      const keeper = trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(60),
        purpose: "EstablishCurrentGraph",
        runId,
        target
      })
      const beforePublication = JournalPosition.make(60)
      const acceptedThrough = JournalPosition.make(61)
      const refreshedAt = JournalPosition.make(62)
      const keeperRemovedAt = JournalPosition.make(63)
      const base = yield* baseEvaluation
      const initial = {
        ...withProposals({ ...base, acceptedAt: beforePublication }, [...exactObserved, keeper, ...blocked], 3),
        current: { ...base.current, runId },
        taskWork: {
          capacity: TaskWorkCapacity.make(3),
          held: fixtures.map(({ attempt }) => ({
            taskId: attempt.taskId,
            correlation: plannedAttemptExecutorCorrelation(attempt)
          }))
        }
      } satisfies DeliveryRuntimeEvaluation
      const relation = yield* dynamicEvaluationSignal(initial)
      const keeperStarted = yield* Deferred.make<void>()
      const finishKeeper = yield* Deferred.make<void>()
      const completionPending = yield* Queue.unbounded<DeliveryProposalId>()
      const calls = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const observedById = new Map(exactObserved.map((proposal, index) => [proposal.id, fixtures[index]] as const))
      const refreshedIds = new Set(exactRefreshed.map(({ id }) => id))
      const blockedIds = new Set(blocked.map(({ id }) => id))
      const executor = DeliveryActionExecutor.of({
        execute: ({ proposal: action }) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (current) => [...current, action.id])
            if (action.id === keeper.id) {
              yield* Deferred.succeed(keeperStarted, undefined)
              yield* Deferred.await(finishKeeper)
              return { _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult
            }
            if (refreshedIds.has(action.id)) {
              return yield* Effect.die("a post-completion passive marker must cover its refreshed Observe")
            }
            if (blockedIds.has(action.id)) return yield* Effect.die("blocked D or E must not execute")
            const fixture = observedById.get(action.id)
            if (fixture === undefined) return yield* Effect.die("post-completion refresh admitted an unknown action")
            return {
              _tag: "ExecutorReportPublished",
              acceptedFacts: "UnchangedPassiveObservation",
              plannedAttempt: fixture.attempt,
              proposalId: action.id,
              report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
                correlation: plannedAttemptExecutorCorrelation(fixture.attempt)
              })
            } satisfies DeliveryActionResult
          })
      })
      const allMarkersInstalled = yield* Deferred.make<void>()
      const refreshApplied = yield* Deferred.make<void>()
      const observer = DeliveryRuntimeObservationObserver.of({
        observe: ({ evaluation, liveOwners }) => {
          const liveIds = new Set(liveOwners.map(({ proposal }) => proposal.id))
          if (evaluation.acceptedAt === acceptedThrough && liveIds.size === 1 && liveIds.has(keeper.id)) {
            return Deferred.succeed(allMarkersInstalled, undefined)
          }
          return evaluation.acceptedAt === refreshedAt && liveIds.has(keeper.id)
            ? Deferred.succeed(refreshApplied, undefined)
            : Effect.void
        }
      })
      const publication = DeliveryAcceptedFactPublication.of({
        awaitCurrent: Effect.succeed({ _tag: "DeliveryAcceptedPublicationBoundary", acceptedThrough, runId })
      })
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets).pipe(
        Effect.provideService(DeliveryRuntimeObservationObserver, observer)
      )
      const runtime = yield* runDeliveryRuntimeQuiescence(relation, publication).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(deterministicOperationIdAllocatorLayer("runtime-post-completion-passive-refresh")),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.provideService(
          DeliverySemanticTrace,
          DeliverySemanticTrace.of({
            emit: (event) =>
              event._tag === "ActionCompletionPublicationPending" && observedById.has(event.proposalId)
                ? Queue.offer(completionPending, event.proposalId)
                : Effect.void
          })
        ),
        Effect.forkChild
      )

      yield* Deferred.await(keeperStarted)
      const pendingIds = new Set<DeliveryProposalId>()
      while (pendingIds.size < exactObserved.length) pendingIds.add(yield* Queue.take(completionPending))
      expect(pendingIds).toEqual(new Set(exactObserved.map(({ id }) => id)))
      expect(runtime.pollUnsafe()).toBeUndefined()

      yield* relation.publish({ ...initial, acceptedAt: acceptedThrough })
      yield* Deferred.await(allMarkersInstalled)
      yield* relation.publish({
        ...initial,
        acceptedAt: refreshedAt,
        proposedActions: {
          _tag: "DeliveryProposalsAvailable",
          isolatedIssues: [],
          proposals: [...exactRefreshed, keeper, ...blocked]
        }
      })
      yield* Deferred.await(refreshApplied)
      yield* relation.publish({
        ...initial,
        acceptedAt: keeperRemovedAt,
        proposedActions: {
          _tag: "DeliveryProposalsAvailable",
          isolatedIssues: [],
          proposals: [...exactRefreshed, ...blocked]
        }
      })
      yield* Deferred.succeed(finishKeeper, undefined)

      const result = yield* Fiber.join(runtime)
      const exactCalls = yield* Ref.get(calls)
      expect(exactCalls).toHaveLength(exactObserved.length + 1)
      for (const { id } of exactObserved) expect(exactCalls.filter((called) => called === id)).toHaveLength(1)
      expect(exactCalls.filter((called) => called === keeper.id)).toHaveLength(1)
      expect(result._tag).toBe("TaskWorkAdmissionStalledRuntimeQuiescence")
      expect(result.proposedActions.proposals).toEqual(blocked)
    })
  )
)

it.effect("moves a passive-attachment marker across an in-flight route refresh and removes it on disappearance", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const fixture = preparedAttemptFixture("same-activation-marker-pruning")
      const acceptedProgress = {
        _tag: "ExecutorReportAccepted" as const,
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1)
      }
      const observeTransition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
        acceptedProgress,
        plannedAttempt: fixture.attempt
      })
      const observeFor = (task: Task) =>
        deliveryProposalsOf({
          acceptedOperationIds: new Set(),
          fresh: [
            {
              step: FreshWorkflowStep.ObservePlannedAttemptExecutorWork({
                acceptedProgress,
                plannedAttempt: fixture.attempt,
                specification: fixture.fresh.step.specification,
                task
              }),
              transition: observeTransition
            }
          ],
          runId,
          transitions: [observeTransition]
        }).ticketDelivery[0]
      const observe = observeFor(fixture.task)
      const refreshedObserve = observeFor({
        ...fixture.task,
        parentTaskId: TaskId.make("same-activation-refreshed-parent")
      })
      if (observe === undefined || refreshedObserve === undefined) {
        return yield* Effect.die("fresh exact Observe proposals must be derivable")
      }
      expect(observe.id).not.toBe(refreshedObserve.id)
      expect(liveActionKeyOf(observe)).toBe(liveActionKeyOf(refreshedObserve))
      const keeper = trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(45),
        purpose: "EstablishCurrentGraph",
        runId,
        target
      })
      const initial = {
        ...withProposals({ ...base, acceptedAt: JournalPosition.make(45) }, [observe, keeper], 1),
        taskWork: {
          capacity: TaskWorkCapacity.make(1),
          held: [{ taskId: fixture.attempt.taskId, correlation: plannedAttemptExecutorCorrelation(fixture.attempt) }]
        }
      } satisfies DeliveryRuntimeEvaluation
      const relation = yield* dynamicEvaluationSignal(initial)
      const observeCalls = yield* Ref.make(0)
      const firstObserveOutcome = yield* Deferred.make<void>()
      const secondObserveOutcome = yield* Deferred.make<void>()
      const thirdObserveOutcome = yield* Deferred.make<void>()
      const firstAttachmentApplied = yield* Deferred.make<void>()
      const secondObserveStarted = yield* Deferred.make<void>()
      const finishSecondObserve = yield* Deferred.make<void>()
      const keeperStarted = yield* Deferred.make<void>()
      const finishKeeper = yield* Deferred.make<void>()
      const executor = DeliveryActionExecutor.of({
        execute: ({ proposal: action }) =>
          action.id === observe.id
            ? Ref.updateAndGet(observeCalls, (count) => count + 1).pipe(
                Effect.tap((count) =>
                  count === 2
                    ? Deferred.succeed(secondObserveStarted, undefined).pipe(
                        Effect.andThen(Deferred.await(finishSecondObserve))
                      )
                    : Effect.void
                ),
                Effect.as({
                  _tag: "ExecutorReportPublished" as const,
                  acceptedFacts: "UnchangedPassiveObservation" as const,
                  plannedAttempt: fixture.attempt,
                  proposalId: action.id,
                  report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
                    correlation: plannedAttemptExecutorCorrelation(fixture.attempt)
                  })
                } satisfies DeliveryActionResult)
              )
            : action.id === keeper.id
              ? Deferred.succeed(keeperStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(finishKeeper)),
                  Effect.as({ _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult)
                )
              : action.id === refreshedObserve.id
                ? Effect.die("the attached passive owner must cover its causally refreshed Observe proposal")
                : Effect.die("the marker-pruning scenario admitted an unknown proposal")
      })
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets).pipe(
        Effect.provideService(
          DeliveryRuntimeObservationObserver,
          DeliveryRuntimeObservationObserver.of({
            observe: (state) =>
              Effect.gen(function* () {
                if (
                  state.evaluation.proposedActions._tag !== "DeliveryProposalsAvailable" ||
                  !state.evaluation.proposedActions.proposals.some(({ id }) => id === observe.id) ||
                  state.liveOwners.some((owner) => owner.proposal.id === observe.id) ||
                  !(yield* Deferred.isDone(firstObserveOutcome))
                ) {
                  return
                }
                yield* Deferred.succeed(firstAttachmentApplied, undefined)
              })
          })
        )
      )
      const runtime = yield* runDeliveryRuntimeQuiescence(relation).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(deterministicOperationIdAllocatorLayer("runtime-passive-marker-pruning")),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.provideService(
          DeliverySemanticTrace,
          DeliverySemanticTrace.of({
            emit: (event) =>
              event._tag === "ActionOutcome" && event.result.proposalId === observe.id
                ? Ref.get(observeCalls).pipe(
                    Effect.flatMap((count) =>
                      Deferred.succeed(
                        count === 1 ? firstObserveOutcome : count === 2 ? secondObserveOutcome : thirdObserveOutcome,
                        undefined
                      )
                    )
                  )
                : Effect.void
          })
        ),
        Effect.forkChild
      )

      yield* Deferred.await(firstAttachmentApplied)
      yield* Deferred.await(keeperStarted)
      const markerRemoved = yield* capabilities.resources.runtimeObservation.changes.pipe(
        Stream.filter(
          (state) =>
            state._tag === "Ready" &&
            state.evaluation.proposedActions._tag === "DeliveryProposalsAvailable" &&
            !state.evaluation.proposedActions.proposals.some(({ id }) => id === observe.id)
        ),
        Stream.runHead,
        Effect.forkChild
      )
      const withoutObserve = {
        ...initial,
        acceptedAt: JournalPosition.make(46),
        proposedActions: { _tag: "DeliveryProposalsAvailable" as const, isolatedIssues: [], proposals: [keeper] }
      }
      yield* relation.publish(withoutObserve)
      expect(Option.isSome(yield* Fiber.join(markerRemoved))).toBe(true)

      yield* relation.publish({
        ...withoutObserve,
        proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [observe, keeper] }
      })
      yield* Deferred.await(secondObserveStarted)
      const inFlightRouteRefreshed = yield* capabilities.resources.runtimeObservation.changes.pipe(
        Stream.filter(
          (state) =>
            state._tag === "Ready" &&
            state.evaluation.proposedActions._tag === "DeliveryProposalsAvailable" &&
            !state.evaluation.proposedActions.proposals.some(({ id }) => id === observe.id) &&
            state.evaluation.proposedActions.proposals.some(({ id }) => id === refreshedObserve.id) &&
            state.liveOwners.some((owner) => owner.proposal.id === observe.id)
        ),
        Stream.runHead,
        Effect.forkChild
      )
      yield* relation.publish({
        ...withoutObserve,
        proposedActions: {
          _tag: "DeliveryProposalsAvailable",
          isolatedIssues: [],
          proposals: [refreshedObserve, keeper]
        }
      })
      expect(Option.isSome(yield* Fiber.join(inFlightRouteRefreshed))).toBe(true)
      yield* Deferred.succeed(finishSecondObserve, undefined)
      yield* Deferred.await(secondObserveOutcome)
      const inFlightOwnerRemoved = yield* capabilities.resources.runtimeObservation.changes.pipe(
        Stream.filter(
          (state) =>
            state._tag === "Ready" &&
            state.evaluation.proposedActions._tag === "DeliveryProposalsAvailable" &&
            state.evaluation.proposedActions.proposals.some(({ id }) => id === refreshedObserve.id) &&
            !state.liveOwners.some((owner) => owner.proposal.id === observe.id)
        ),
        Stream.runHead,
        Effect.forkChild
      )
      expect(Option.isSome(yield* Fiber.join(inFlightOwnerRemoved))).toBe(true)
      expect(yield* Ref.get(observeCalls)).toBe(2)

      const transferredMarkerRemoved = yield* capabilities.resources.runtimeObservation.changes.pipe(
        Stream.filter(
          (state) =>
            state._tag === "Ready" &&
            state.evaluation.proposedActions._tag === "DeliveryProposalsAvailable" &&
            !state.evaluation.proposedActions.proposals.some(({ id }) => id === refreshedObserve.id)
        ),
        Stream.runHead,
        Effect.forkChild
      )
      yield* relation.publish(withoutObserve)
      expect(Option.isSome(yield* Fiber.join(transferredMarkerRemoved))).toBe(true)
      yield* relation.publish({
        ...withoutObserve,
        proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [observe, keeper] }
      })
      yield* Deferred.await(thirdObserveOutcome)
      expect(yield* Ref.get(observeCalls)).toBe(3)

      yield* relation.publish({
        ...withoutObserve,
        proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }
      })
      yield* Deferred.succeed(finishKeeper, undefined)
      expect((yield* Fiber.join(runtime))._tag).toBe("PassiveRuntimeQuiescence")
    })
  )
)

it.effect("waits for changed accepted facts after unchanged reconciliation instead of retaining an attachment", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const fixture = preparedAttemptFixture("unchanged-reconciliation")
      const reconcile = recoveredProposalFor(
        RunnableFrontierTransition.ReconcilePlannedAttemptExecutorWork({ plannedAttempt: fixture.attempt }),
        new Set(),
        fixture.attempt
      )
      const keeper = trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(50),
        purpose: "EstablishCurrentGraph",
        runId,
        target
      })
      const initial = {
        ...withProposals({ ...base, acceptedAt: JournalPosition.make(50) }, [reconcile, keeper], 1),
        taskWork: {
          capacity: TaskWorkCapacity.make(1),
          held: [{ taskId: fixture.attempt.taskId, correlation: plannedAttemptExecutorCorrelation(fixture.attempt) }]
        }
      } satisfies DeliveryRuntimeEvaluation
      const relation = yield* dynamicEvaluationSignal(initial)
      const reconcileCalls = yield* Ref.make(0)
      const firstReconcileOutcome = yield* Deferred.make<void>()
      const secondReconcileOutcome = yield* Deferred.make<void>()
      const firstDeferralApplied = yield* Deferred.make<void>()
      const sameAcceptedFactsRequested = yield* Deferred.make<void>()
      const sameAcceptedFactsApplied = yield* Deferred.make<void>()
      const keeperStarted = yield* Deferred.make<void>()
      const finishKeeper = yield* Deferred.make<void>()
      const executor = DeliveryActionExecutor.of({
        execute: ({ proposal: action }) =>
          action.id === reconcile.id
            ? Ref.updateAndGet(reconcileCalls, (count) => count + 1).pipe(
                Effect.as({
                  _tag: "ExecutorReportPublished",
                  acceptedFacts: "UnchangedPassiveObservation",
                  plannedAttempt: fixture.attempt,
                  proposalId: action.id,
                  report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
                    correlation: plannedAttemptExecutorCorrelation(fixture.attempt)
                  })
                } satisfies DeliveryActionResult)
              )
            : action.id === keeper.id
              ? Deferred.succeed(keeperStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(finishKeeper)),
                  Effect.as({ _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult)
                )
              : Effect.die("the unchanged-reconciliation scenario admitted an unknown proposal")
      })
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets).pipe(
        Effect.provideService(
          DeliveryRuntimeObservationObserver,
          DeliveryRuntimeObservationObserver.of({
            observe: (state) =>
              Effect.gen(function* () {
                if (
                  state.evaluation.acceptedAt !== JournalPosition.make(50) ||
                  state.evaluation.proposedActions._tag !== "DeliveryProposalsAvailable" ||
                  !state.evaluation.proposedActions.proposals.some(({ id }) => id === reconcile.id) ||
                  state.liveOwners.some((owner) => owner.proposal.id === reconcile.id) ||
                  !(yield* Deferred.isDone(firstReconcileOutcome))
                ) {
                  return
                }
                if (yield* Deferred.isDone(sameAcceptedFactsRequested)) {
                  yield* Deferred.succeed(sameAcceptedFactsApplied, undefined)
                } else {
                  yield* Deferred.succeed(firstDeferralApplied, undefined)
                }
              })
          })
        )
      )
      const runtime = yield* runDeliveryRuntimeQuiescence(relation).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(deterministicOperationIdAllocatorLayer("runtime-unchanged-reconciliation")),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(DeliveryActionExecutor, executor),
        Effect.provideService(
          DeliverySemanticTrace,
          DeliverySemanticTrace.of({
            emit: (event) =>
              event._tag === "ActionOutcome" && event.result.proposalId === reconcile.id
                ? Ref.get(reconcileCalls).pipe(
                    Effect.flatMap((count) =>
                      Deferred.succeed(count === 1 ? firstReconcileOutcome : secondReconcileOutcome, undefined)
                    )
                  )
                : Effect.void
          })
        ),
        Effect.forkChild
      )

      yield* Deferred.await(firstDeferralApplied)
      yield* Deferred.await(keeperStarted)
      yield* Deferred.succeed(sameAcceptedFactsRequested, undefined)
      yield* relation.publish({ ...initial })
      yield* Deferred.await(sameAcceptedFactsApplied)
      expect(yield* Ref.get(reconcileCalls)).toBe(1)
      yield* relation.publish({ ...initial, acceptedAt: JournalPosition.make(51) })
      yield* Deferred.await(secondReconcileOutcome)
      expect(yield* Ref.get(reconcileCalls)).toBe(2)

      yield* relation.publish({
        ...initial,
        acceptedAt: JournalPosition.make(51),
        proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }
      })
      yield* Deferred.succeed(finishKeeper, undefined)
      expect((yield* Fiber.join(runtime))._tag).toBe("PassiveRuntimeQuiescence")
    })
  )
)

it.effect(
  "does not report admission-stalled quiescence while a local owner can finish or for work that needs no task position",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const base = yield* baseEvaluation
        const heldAttempt = PlannedTaskAttempt.make({
          ...plannedAttempt,
          attemptId: AttemptId.make("runtime-admission-stalled-held"),
          taskId: TaskId.make("runtime-admission-stalled-held-task")
        })
        const blockedFixture = preparedAttemptFixture("blocked-by-live-owner")
        const [blocked] = preparedBeginProposalsOf([blockedFixture])
        if (blocked === undefined) return yield* Effect.die("prepared blocked attempt must produce Begin")
        const positionless = trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(20),
          purpose: "EstablishCurrentGraph",
          runId,
          target
        })
        const initial = {
          ...withProposals(base, [positionless, blocked], 1),
          taskWork: {
            capacity: TaskWorkCapacity.make(1),
            held: [{ taskId: heldAttempt.taskId, correlation: plannedAttemptExecutorCorrelation(heldAttempt) }]
          }
        } satisfies DeliveryRuntimeEvaluation
        const relation = yield* dynamicEvaluationSignal(initial)
        const positionlessStarted = yield* Deferred.make<void>()
        const finishPositionless = yield* Deferred.make<void>()
        const runtime = yield* runDeliveryRuntimePhase(runId, relation).pipe(
          Effect.provide(identityLayers),
          Effect.provideService(
            DeliveryActionExecutor,
            DeliveryActionExecutor.of({
              execute: ({ proposal: action }) =>
                action.id !== positionless.id
                  ? Effect.die("full capacity must not execute the position-gated proposal")
                  : Effect.gen(function* () {
                      yield* relation.publish({
                        ...initial,
                        proposedActions: {
                          _tag: "DeliveryProposalsAvailable",
                          isolatedIssues: [],
                          proposals: [blocked]
                        }
                      })
                      yield* Deferred.succeed(positionlessStarted, undefined)
                      yield* Deferred.await(finishPositionless)
                      return { _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult
                    })
            })
          ),
          Effect.forkChild
        )

        yield* Deferred.await(positionlessStarted)
        yield* Effect.yieldNow
        expect(runtime.pollUnsafe()).toBeUndefined()
        yield* Deferred.succeed(finishPositionless, undefined)
        const result = yield* Fiber.join(runtime)
        expect(result._tag).toBe("TaskWorkAdmissionStalledRuntimeQuiescence")
        expect(result.proposedActions.proposals).toEqual([blocked])
      })
    )
)

it.effect("reuses a full-capacity position for its matching exact prepared attempt", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const retained = preparedAttemptFixture("matching-retained-correlation")
      const [begin] = preparedBeginProposalsOf([retained])
      if (begin === undefined) return yield* Effect.die("matching prepared attempt must produce Begin")
      const initial = {
        ...withProposals(base, [begin], 1),
        taskWork: {
          capacity: TaskWorkCapacity.make(1),
          held: [{ taskId: retained.attempt.taskId, correlation: plannedAttemptExecutorCorrelation(retained.attempt) }]
        }
      } satisfies DeliveryRuntimeEvaluation
      const relation = yield* dynamicEvaluationSignal(initial)
      const executed = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])

      const result = yield* runDeliveryRuntimePhase(runId, relation).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({
            execute: ({ proposal: action }) =>
              Ref.update(executed, (current) => [...current, action.id]).pipe(
                Effect.andThen(
                  relation.publish({
                    ...initial,
                    proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }
                  })
                ),
                Effect.as({ _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult)
              )
          })
        )
      )

      expect(result._tag).not.toBe("TaskWorkAdmissionStalledRuntimeQuiescence")
      expect(yield* Ref.get(executed)).toEqual([begin.id])
    })
  )
)

it.effect("does not classify fresh work without an exact planned-attempt protocol as admission-stalled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const taskId = TaskId.make("runtime-admission-stalled-fresh-task")
      const task: Task = {
        id: taskId,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
      const transition = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
        taskId,
        taskRevision: TaskRevision.make("runtime-admission-stalled-fresh-revision")
      })
      const [fresh] = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: [
          {
            step: FreshWorkflowStep.AcquireTaskClaim({
              predecessorOperationId: OperationId.make("runtime-admission-stalled-fresh-graph"),
              task
            }),
            transition
          }
        ],
        runId,
        transitions: [transition]
      }).ticketDelivery
      if (fresh === undefined) return yield* Effect.die("fresh claim must produce a proposal")
      expect(fresh.admission).toMatchObject({
        plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" },
        taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId }
      })
      const held = preparedAttemptFixture("fresh-position-holder").attempt
      const relation = yield* dynamicEvaluationSignal({
        ...withProposals(base, [fresh], 1),
        taskWork: {
          capacity: TaskWorkCapacity.make(1),
          held: [{ taskId: held.taskId, correlation: plannedAttemptExecutorCorrelation(held) }]
        }
      })
      const deferred = yield* Deferred.make<void>()
      const runtime = yield* runDeliveryRuntimePhase(runId, relation).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.die("fresh work must remain position-gated") })
        ),
        Effect.provideService(
          DeliverySemanticTrace,
          DeliverySemanticTrace.of({
            emit: (event) =>
              event._tag === "ProposalDeferred" && event.proposalId === fresh.id
                ? Deferred.succeed(deferred, undefined)
                : Effect.void
          })
        ),
        Effect.forkChild
      )

      yield* Deferred.await(deferred)
      expect(runtime.pollUnsafe()).toBeUndefined()
      yield* Fiber.interrupt(runtime)
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
        runId,
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
      runId,
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
