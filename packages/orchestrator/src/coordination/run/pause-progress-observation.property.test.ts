import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Stream } from "effect"
import * as fc from "fast-check"
import { expect, expectTypeOf } from "vitest"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../test/journaled-graph-observation.js"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { makeDeliveryReflection } from "../delivery/relations.js"
import {
  boundedParallelTicketsOf,
  deliverySettlementsOf,
  frontierOf,
  ticketDeliveriesOf
} from "../delivery/ticket-delivery-projection.js"
import {
  DeliveryProposalId,
  DeliveryProposalOrdinal,
  trackerGraphReadProposalOf
} from "../delivery/delivery-proposal.js"
import type { DeliveryActionProposal, DeliveryRuntimeEvaluation } from "../delivery/relations.js"
import {
  DeliveryRuntimeLiveOwnerSnapshot,
  DeliveryRuntimeObservationState
} from "../delivery/delivery-runtime-observation.js"
import { deliveryRuntimeResourceCapabilitiesOf as makeCapabilitiesWithAdmission } from "../delivery/delivery-runtime-resources.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import {
  type PlannedAttemptExecutorDisposition,
  ResponsibilityDisposition,
  type ResponsibilityFreshFacts
} from "../frontier/fresh-facts.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import {
  IntegrationCandidateCorrelation,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId
} from "../../workflow/protocols/integration-candidate-construction/events.js"

import {
  TargetPromotionCorrelation,
  TargetPromotionRequestId
} from "../../workflow/protocols/target-promotion/events.js"
import { TargetPromotionPendingRetry, TargetPromotionState } from "../../workflow/protocols/target-promotion/state.js"
import {
  TargetVerificationCorrelation,
  TargetVerificationPlanId,
  TargetVerificationRequestId
} from "../../workflow/protocols/target-verification/events.js"
import { observePauseProgress } from "./pause-progress-observer.js"
import {
  pauseProgressViewOf,
  type PauseDeliveryActionResponsibility,
  type PauseExecutorBlocker,
  type PauseResponsibilityAtBoundary,
  type PauseStartedIntegrationBlocker
} from "./pause-progress-observation.js"

const deliveryRuntimeResourceCapabilitiesOf = Effect.fn("PauseProgressProperty.makeCapabilities")(function* (
  integrationTargets: Parameters<typeof makeCapabilitiesWithAdmission>[0]
) {
  return yield* makeCapabilitiesWithAdmission(integrationTargets, (yield* makeApplicationExitLifecycle()).admission)
})

const runId = RunId.make("pause-progress-run")
const target = FixtureTarget.make("pause-progress-target")
const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(4)
})

const plannedAttempt = (taskId: TaskId): PlannedTaskAttempt =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`pause-progress-${taskId}`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/pause-progress-${taskId}`),
    executor: TaskExecutorLocator.make("executor:pause-progress"),
    runId,
    taskId,
    taskRevision: TaskRevision.make(`revision-${taskId}`),
    worktree: WorktreeLocator.make(`/pause-progress/${taskId}`)
  })

const responsibilityFacts = (
  taskId: TaskId,
  disposition: PlannedAttemptExecutorDisposition
): ResponsibilityFreshFacts => ({
  _tag: "PlannedAttemptExecutorFreshFacts",
  disposition,
  responsibility: {
    _tag: "PlannedAttemptExecutorWorkResponsibility",
    beganAt: JournalPosition.make(1),
    plannedAttempt: plannedAttempt(taskId)
  }
})

const projection = projectTrackerSnapshot({
  revision: "pause-progress-G1",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: "A", prerequisiteIds: [] },
    { id: "C", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
  ]
})
if (projection._tag === "Invalid") throw new Error("pause progress fixture graph must be valid")

const publication = (aIsSafelySuspended = false) => ({
  exactEvidence: [
    {
      _tag: "ResponsibilityFacts" as const,
      facts: responsibilityFacts(
        TaskId.make("A"),
        aIsSafelySuspended
          ? ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
              correlation: plannedAttemptExecutorCorrelation(plannedAttempt(TaskId.make("A")))
            })
          : ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
      )
    },
    {
      _tag: "ResponsibilityFacts" as const,
      facts: responsibilityFacts(
        TaskId.make("D"),
        ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt(TaskId.make("D")))
        })
      )
    },
    {
      _tag: "ResponsibilityFacts" as const,
      facts: responsibilityFacts(
        TaskId.make("C"),
        ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt(TaskId.make("C")))
        })
      )
    }
  ],
  graph: {
    _tag: "GraphEstablished" as const,
    observation: makeTestJournaledTrackerGraphObservation({
      operationId: OperationId.make("pause-progress-graph"),
      recordedAt: JournalPosition.make(5),
      snapshot: projection.snapshot
    })
  },
  policy
})

const proposalFor = (taskId: TaskId): DeliveryActionProposal => ({
  ...trackerGraphReadProposalOf({
    acceptedAt: JournalPosition.make(5),
    purpose: "EstablishCurrentGraph",
    runId,
    target
  }),
  admission: {
    integrationTarget: { _tag: "NoIntegrationTargetResource" },
    plannedAttemptProtocol: {
      _tag: "PlannedAttemptProtocolRequired",
      correlation: plannedAttemptExecutorCorrelation(plannedAttempt(taskId))
    },
    taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "Existing", taskId }
  },
  id: DeliveryProposalId.make(`pause-progress:${taskId}`),
  order: {
    _tag: "RecoveredWorkflowOrder",
    acceptedAt: JournalPosition.make(5),
    frontierOrdinal: DeliveryProposalOrdinal.make(0),
    responsibilityBeganAt: JournalPosition.make(1),
    taskId,
    transition: "SuspendPlannedAttemptExecutorWork"
  },
  owner: "TicketDelivery"
})

const evaluation = (
  pauseApplied: boolean,
  options: { readonly aIsSafelySuspended?: boolean; readonly proposals?: ReadonlyArray<DeliveryActionProposal> } = {}
): DeliveryRuntimeEvaluation => {
  const graphPublication = publication(options.aIsSafelySuspended)
  const frontier = frontierOf(graphPublication)
  const tickets = boundedParallelTicketsOf(frontier)
  const ticketDeliveries = ticketDeliveriesOf(tickets, graphPublication.exactEvidence)
  const settlements = deliverySettlementsOf(ticketDeliveries)
  return {
    _tag: "DeliveryRuntimeEvaluation",
    acceptedAt: JournalPosition.make(5),
    current: {
      _tag: "DeliveryRuntimeSnapshot",
      reflection: makeDeliveryReflection(settlements),
      settlements,
      ticketDeliveries,
      trackerGraph: graphPublication.graph
    },
    pauseCoverage: {
      _tag: "PauseCoverageGraphEstablished",
      applied: {
        run: { _tag: "RunUnpaused" },
        tasks: pauseApplied ? { _tag: "TaskPauses", taskIds: [TaskId.make("A")] } : { _tag: "NoTaskPauses" }
      },
      observedAt: JournalPosition.make(5),
      snapshot: projection.snapshot
    },
    proposedActions: {
      _tag: "DeliveryProposalsAvailable",
      isolatedIssues: [],
      proposals: options.proposals ?? [proposalFor(TaskId.make("A"))]
    },
    quiescence: { _tag: "QuiescencePassive", reason: "RunPaused" },
    taskWork: { capacity: policy.taskExecutionCapacity, held: [] }
  }
}

const resources = {
  activeResponsibilityPositions: new Set<JournalPosition>(),
  heldResponsibilityPositions: new Set<JournalPosition>()
}

it("keeps action-only responsibilities and integration-only blockers out of impossible boundary variants", () => {
  expectTypeOf<PauseDeliveryActionResponsibility>().not.toMatchTypeOf<PauseResponsibilityAtBoundary["responsibility"]>()
  expectTypeOf<
    Extract<PauseStartedIntegrationBlocker, { readonly _tag: "TargetPromotionResultRequired" }>
  >().not.toMatchTypeOf<PauseExecutorBlocker>()
})

it("confirms exactly when every generated covered executor state has reached its safe boundary", () => {
  fc.assert(
    fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (aIsSafelySuspended, proposalPresent, liveOwnerPresent) => {
      const action = proposalFor(TaskId.make("A"))
      const view = pauseProgressViewOf(
        { _tag: "Task", runId, taskId: TaskId.make("A") },
        DeliveryRuntimeObservationState.Ready({
          evaluation: evaluation(true, { aIsSafelySuspended, proposals: proposalPresent ? [action] : [] }),
          liveOwners: liveOwnerPresent
            ? [
                DeliveryRuntimeLiveOwnerSnapshot.MaterializedDeliveryAction({
                  intent: "IntentRecorded",
                  operationId: OperationId.make("pause-progress-live-action"),
                  proposal: action
                })
              ]
            : []
        }),
        resources
      )
      const expected = aIsSafelySuspended && !proposalPresent && !liveOwnerPresent ? "PauseConfirmed" : "PauseWaiting"
      expect(view._tag).toBe(expected)
      if (view._tag === "PauseConfirmed") {
        expect(view.atBoundary.map(({ responsibility }) => responsibility.taskId)).toEqual(["A", "D"])
      }
    })
  )
})

it.effect("shows Alice every covered task responsibility and the exact safe-boundary blocker", () =>
  Effect.sync(() => {
    const view = pauseProgressViewOf(
      { _tag: "Task", runId, taskId: TaskId.make("A") },
      DeliveryRuntimeObservationState.Ready({ evaluation: evaluation(true), liveOwners: [] }),
      resources
    )
    expect(view._tag).toBe("PauseWaiting")
    if (view._tag !== "PauseWaiting") return
    expect(view.atBoundary.map(({ responsibility }) => responsibility.taskId)).toEqual(["D"])
    expect(view.atBoundary[0]?.responsibility.coverage).toEqual({
      _tag: "GroupingDescendantPauseCoverage",
      groupingObservedAt: JournalPosition.make(5),
      pausedTaskId: TaskId.make("A")
    })
    expect(view.preventing).toHaveLength(1)
    expect(view.preventing[0].responsibility.taskId).toBe("A")
    expect(view.preventing[0].responsibility).toMatchObject({
      _tag: "PauseExecutorResponsibility",
      coverage: { _tag: "ExactTaskPauseCoverage" }
    })
    expect(view.preventing[0].blockers.map(({ _tag }) => _tag)).toEqual([
      "ExecutorSafeSuspensionRequired",
      "ProposedDeliveryAction"
    ])
    expect([...view.atBoundary, ...view.preventing].map(({ responsibility }) => responsibility.taskId)).not.toContain(
      "C"
    )
  })
)

it.effect("keeps D's exact held integration responsibility visible until its ordinary resource boundary", () =>
  Effect.sync(() => {
    const base = evaluation(true)
    const queuedAt = JournalPosition.make(8)
    const responsibility = StartedIntegrationResponsibility.make({
      acceptedResult: acceptedResultFixture(GitCommitSha.make("2".repeat(40))),
      integrationTarget: IntegrationTarget.make({
        repository: GitRepositoryLocator.make("/pause-progress/integration.git"),
        ref: IntegrationTargetRef.make("refs/heads/main")
      }),
      plannedAttempt: plannedAttempt(TaskId.make("D")),
      queuedAt,
      startedAt: JournalPosition.make(9)
    })
    const ticketDeliveries = ticketDeliveriesOf(base.current.ticketDeliveries.source, [
      ...publication().exactEvidence,
      { _tag: "StartedIntegration", responsibility }
    ])
    const settlements = deliverySettlementsOf(ticketDeliveries)
    const view = pauseProgressViewOf(
      { _tag: "Task", runId, taskId: TaskId.make("A") },
      DeliveryRuntimeObservationState.Ready({
        evaluation: {
          ...base,
          current: { ...base.current, reflection: makeDeliveryReflection(settlements), settlements, ticketDeliveries }
        },
        liveOwners: []
      }),
      { activeResponsibilityPositions: new Set(), heldResponsibilityPositions: new Set([queuedAt]) }
    )
    expect(view._tag).toBe("PauseWaiting")
    if (view._tag !== "PauseWaiting") return
    expect(
      view.preventing.find(({ responsibility }) => responsibility._tag === "PauseStartedIntegrationResponsibility")
    ).toMatchObject({ blockers: [{ _tag: "HeldIntegrationTarget", queuedAt }], responsibility: { taskId: "D" } })
  })
)

it.effect("attaches D's pending promotion only to its exact started integration among D's obligations", () =>
  Effect.sync(() => {
    const base = evaluation(true)
    const dAttempt = plannedAttempt(TaskId.make("D"))
    const integration = StartedIntegrationResponsibility.make({
      acceptedResult: acceptedResultFixture(GitCommitSha.make("2".repeat(40))),
      integrationTarget: IntegrationTarget.make({
        repository: GitRepositoryLocator.make("/pause-progress/exact-promotion.git"),
        ref: IntegrationTargetRef.make("refs/heads/main")
      }),
      plannedAttempt: dAttempt,
      queuedAt: JournalPosition.make(8),
      startedAt: JournalPosition.make(9)
    })
    const candidateId = IntegrationCandidateId.make("pause-progress-exact-promotion")
    const candidateCommit = GitCommitSha.make("3".repeat(40))
    const candidateCorrelation = IntegrationCandidateCorrelation.make({
      acceptanceManifest: integration.acceptedResult.evidenceManifest,
      acceptedResultCommit: integration.acceptedResult.commit,
      attemptId: dAttempt.attemptId,
      candidateId,
      candidateResource: IntegrationCandidateResourceLocator.make("/pause-progress/exact-promotion-candidate"),
      expectedTargetHead: dAttempt.baseSha,
      integrationSessionId: IntegrationSessionId.make("pause-progress-exact-promotion-session"),
      integrationTarget: integration.integrationTarget,
      runId
    })
    const verificationCorrelation = TargetVerificationCorrelation.make({
      candidateCommit,
      candidateConstructedAt: JournalPosition.make(10),
      candidateCorrelation,
      planId: TargetVerificationPlanId.make("pause-progress-exact-promotion-plan"),
      requestId: TargetVerificationRequestId.make("pause-progress-exact-promotion-verification")
    })
    const request = TargetPromotionCorrelation.make({
      acceptanceManifest: integration.acceptedResult.evidenceManifest,
      candidateCommit,
      candidateConstructedAt: verificationCorrelation.candidateConstructedAt,
      candidateCorrelation,
      expectedTargetHead: dAttempt.baseSha,
      integrationTarget: integration.integrationTarget,
      requestId: TargetPromotionRequestId.make(`target-promotion:${candidateId}`),
      reviewManifest: integration.acceptedResult.evidenceManifest,
      verificationCorrelation,
      verificationManifest: integration.acceptedResult.evidenceManifest
    })
    const promotion = TargetPromotionState.cases.PromotionPending.make({
      correlation: request,
      retry: TargetPromotionPendingRetry.cases.NeedInitialReconciliationRead.make({})
    })
    const ticketDeliveries = ticketDeliveriesOf(base.current.ticketDeliveries.source, [
      ...publication().exactEvidence,
      { _tag: "StartedIntegration", responsibility: integration },
      { _tag: "TargetPromotion", responsibility: integration, state: promotion }
    ])
    const settlements = deliverySettlementsOf(ticketDeliveries)
    const view = pauseProgressViewOf(
      { _tag: "Task", runId, taskId: TaskId.make("A") },
      DeliveryRuntimeObservationState.Ready({
        evaluation: {
          ...base,
          current: { ...base.current, reflection: makeDeliveryReflection(settlements), settlements, ticketDeliveries }
        },
        liveOwners: []
      }),
      resources
    )
    expect(view._tag).toBe("PauseWaiting")
    if (view._tag !== "PauseWaiting") return
    expect(view.atBoundary.filter(({ responsibility }) => responsibility.taskId === TaskId.make("D"))).toMatchObject([
      { responsibility: { _tag: "PauseExecutorResponsibility" } }
    ])
    expect(view.preventing.filter(({ responsibility }) => responsibility.taskId === TaskId.make("D"))).toMatchObject([
      {
        blockers: [{ _tag: "TargetPromotionResultRequired", request }],
        responsibility: { _tag: "PauseStartedIntegrationResponsibility" }
      }
    ])
  })
)

it.effect("returns typed absence instead of inventing a view when Alice's exact Pause is not applied", () =>
  Effect.sync(() => {
    const view = pauseProgressViewOf(
      { _tag: "Task", runId, taskId: TaskId.make("A") },
      DeliveryRuntimeObservationState.Ready({ evaluation: evaluation(false), liveOwners: [] }),
      resources
    )
    expect(view).toEqual({ _tag: "PauseProjectionNotApplied" })
  })
)

it.effect("does not let a safe report from before grouping coverage confirm the later Pause obligation", () =>
  Effect.sync(() => {
    const afterGrouping = evaluation(true)
    const view = pauseProgressViewOf(
      { _tag: "Task", runId, taskId: TaskId.make("A") },
      DeliveryRuntimeObservationState.Ready({
        evaluation: {
          ...afterGrouping,
          proposedActions: {
            _tag: "DeliveryProposalsAvailable",
            isolatedIssues: [],
            proposals: [proposalFor(TaskId.make("D"))]
          }
        },
        liveOwners: []
      }),
      resources
    )
    expect(view._tag).toBe("PauseWaiting")
    if (view._tag !== "PauseWaiting") return
    const descendant = view.preventing.find(({ responsibility }) => responsibility.taskId === "D")
    expect(descendant?.blockers.map(({ _tag }) => _tag)).toEqual(["ProposedDeliveryAction"])
    expect(descendant?.responsibility).toMatchObject({
      obligation: { responsibility: { plannedAttempt: { attemptId: "pause-progress-D", taskId: "D" } } }
    })
  })
)

it.effect("fails closed instead of confirming when delivery action ownership conflicts", () =>
  Effect.sync(() => {
    const conflicted = evaluation(true)
    const proposalId = DeliveryProposalId.make("pause-progress-conflict")
    const view = pauseProgressViewOf(
      { _tag: "Task", runId, taskId: TaskId.make("A") },
      DeliveryRuntimeObservationState.Ready({
        evaluation: {
          ...conflicted,
          proposedActions: {
            _tag: "DeliveryProposalOwnershipConflict",
            conflicts: [
              {
                id: proposalId,
                order: proposalFor(TaskId.make("A")).order,
                owners: ["TicketDelivery", "DeliverySettlement"]
              }
            ]
          }
        },
        liveOwners: []
      }),
      resources
    )
    expect(view).toMatchObject({ _tag: "PauseProgressProjectionConflict", proposalIds: [proposalId] })
  })
)

it.effect("does not let an independent task's proposal conflict block Alice's task Pause", () =>
  Effect.sync(() => {
    const conflicted = evaluation(true, { aIsSafelySuspended: true, proposals: [] })
    const view = pauseProgressViewOf(
      { _tag: "Task", runId, taskId: TaskId.make("A") },
      DeliveryRuntimeObservationState.Ready({
        evaluation: {
          ...conflicted,
          proposedActions: {
            _tag: "DeliveryProposalOwnershipConflict",
            conflicts: [
              {
                id: DeliveryProposalId.make("independent-C-conflict"),
                order: proposalFor(TaskId.make("C")).order,
                owners: ["TicketDelivery", "DeliverySettlement"]
              }
            ]
          }
        },
        liveOwners: []
      }),
      resources
    )
    expect(view._tag).toBe("PauseConfirmed")
  })
)

it.effect("ends Alice's task Pause observation without claiming confirmation after Unpause", () =>
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const { observation: controller, resources: runtimeResources } =
      yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
    yield* controller.publish(evaluation(true), [])
    const firstView = yield* Deferred.make<void>()
    const observed = yield* observePauseProgress(runtimeResources, runId, null, {
      _tag: "Task",
      runId,
      taskId: TaskId.make("A")
    }).pipe(
      Stream.tap(() => Deferred.succeed(firstView, undefined)),
      Stream.runCollect,
      Effect.forkChild
    )
    yield* Deferred.await(firstView)
    yield* controller.publish(evaluation(false), [])
    expect(Array.from(yield* Fiber.join(observed)).map(({ _tag }) => _tag)).toEqual([
      "PauseWaiting",
      "PauseNoLongerApplied"
    ])
    yield* runtimeResources.integrationTargets.releaseAll
  })
)

it.effect("waits for the runtime view that includes every accepted fact present when Alice subscribes", () =>
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const { observation: controller, resources: runtimeResources } =
      yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
    yield* controller.publish(evaluation(false), [])
    const observed = yield* observePauseProgress(
      runtimeResources,
      runId,
      { latestAcceptedAt: JournalPosition.make(9) },
      { _tag: "Task", runId, taskId: TaskId.make("A") }
    ).pipe(Stream.runHead, Effect.forkChild)
    yield* Effect.yieldNow
    yield* controller.publish(
      { ...evaluation(true, { aIsSafelySuspended: true, proposals: [] }), acceptedAt: JournalPosition.make(6) },
      []
    )
    yield* Effect.yieldNow
    yield* controller.publish({ ...evaluation(true), acceptedAt: JournalPosition.make(9) }, [])
    expect(yield* Fiber.join(observed)).toMatchObject({
      _tag: "Some",
      value: { _tag: "PauseWaiting", subject: { _tag: "Task", taskId: "A" } }
    })
    yield* runtimeResources.integrationTargets.releaseAll
  })
)

it.effect("does not emit a stale Pause view when Alice subscribes just after accepted Unpause", () =>
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const { observation: controller, resources: runtimeResources } =
      yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
    yield* controller.publish(evaluation(true), [])
    const observed = yield* observePauseProgress(
      runtimeResources,
      runId,
      { latestAcceptedAt: JournalPosition.make(6) },
      { _tag: "Task", runId, taskId: TaskId.make("A") }
    ).pipe(Stream.runDrain, Effect.flip, Effect.forkChild)
    yield* Effect.yieldNow
    yield* controller.publish({ ...evaluation(false), acceptedAt: JournalPosition.make(6) }, [])
    expect(yield* Fiber.join(observed)).toMatchObject({
      _tag: "PauseNotApplied",
      subject: { _tag: "Task", taskId: "A" }
    })
    yield* runtimeResources.integrationTargets.releaseAll
  })
)

it.effect("delivers the final accepted confirmation before the activation observation source closes", () =>
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const { observation: controller, resources: runtimeResources } =
      yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
    yield* controller.publish(evaluation(true), [])
    const waiting = yield* Deferred.make<void>()
    const observed = yield* observePauseProgress(runtimeResources, runId, null, {
      _tag: "Task",
      runId,
      taskId: TaskId.make("A")
    }).pipe(
      Stream.tap(() => Deferred.succeed(waiting, undefined)),
      Stream.runCollect,
      Effect.forkChild
    )
    yield* Deferred.await(waiting)
    yield* controller.publish(evaluation(true, { aIsSafelySuspended: true, proposals: [] }), [])
    yield* controller.close
    expect(Array.from(yield* Fiber.join(observed)).map(({ _tag }) => _tag)).toEqual(["PauseWaiting", "PauseConfirmed"])
    yield* integrationTargets.releaseAll
  })
)

it.effect("fails with typed absence before creating a wait when Alice has no applied Pause", () =>
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const { observation: controller, resources: runtimeResources } =
      yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
    yield* controller.publish(evaluation(false), [])
    const failure = yield* observePauseProgress(runtimeResources, runId, null, {
      _tag: "Task",
      runId,
      taskId: TaskId.make("A")
    }).pipe(Stream.runHead, Effect.flip)
    expect(failure).toMatchObject({ _tag: "PauseNotApplied", subject: { _tag: "Task", taskId: "A" } })
    yield* runtimeResources.integrationTargets.releaseAll
  })
)

it.effect("does not let a late runtime publication reopen a closed observation", () =>
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const { observation: controller } = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
    const finalEvaluation = evaluation(true)

    yield* controller.publish(finalEvaluation, [])
    yield* controller.close
    yield* controller.publish(evaluation(false), [])

    const state = yield* controller.signal.get
    expect(state._tag).toBe("Closed")
    if (state._tag === "Closed") expect(state.final?.evaluation).toEqual(finalEvaluation)
    yield* integrationTargets.releaseAll
  })
)

it.effect("rejects a Pause observation correlated to a different Run", () =>
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const { resources: runtimeResources } = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
    const failure = yield* observePauseProgress(runtimeResources, runId, null, {
      _tag: "Run",
      runId: RunId.make("another-run")
    }).pipe(Stream.runDrain, Effect.flip)
    expect(failure).toMatchObject({
      _tag: "PauseObservationRunMismatch",
      expectedRunId: runId,
      requestedRunId: "another-run"
    })
    yield* runtimeResources.integrationTargets.releaseAll
  })
)
