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
import { expect } from "vitest"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { TaskClaimAcquisition } from "../../authorities/task-tracker/claim-mutation.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../test/journaled-graph-observation.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import {
  DeliveryProposalId,
  DeliveryProposalOrdinal,
  trackerGraphReadProposalOf,
  type DeliveryActionProposal
} from "../delivery/delivery-action-proposal.js"
import {
  DeliveryRuntimeLiveOwnerSnapshot,
  DeliveryRuntimeObservationState
} from "../delivery/delivery-runtime-observation.js"
import { deliveryRuntimeResourceCapabilitiesOf as makeCapabilitiesWithAdmission } from "../delivery/delivery-runtime-resources.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import {
  currentSignalFromCurrentFirstStream,
  makeDeliveryReflection,
  type DeliveryRuntimeEvaluation,
  type ExactTicketDeliveryEvidence
} from "../delivery/relations.js"
import {
  boundedParallelTicketsOf,
  deliverySettlementsOf,
  frontierOf,
  ticketDeliveriesOf
} from "../delivery/ticket-delivery-projection.js"
import { ResponsibilityDisposition, type ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import {
  QueuedIntegrationResponsibility,
  UnqueuedAcceptedResult
} from "../../workflow/protocols/integration-admission/protocol.js"
import { observePauseProgress } from "./pause-progress-observer.js"
import { pauseProgressViewOf, pauseSafeBoundaryBlockersOf } from "./pause-progress-observation.js"

const deliveryRuntimeResourceCapabilitiesOf = Effect.fn("PauseProgressCoverage.makeCapabilities")(function* (
  integrationTargets: Parameters<typeof makeCapabilitiesWithAdmission>[0]
) {
  return yield* makeCapabilitiesWithAdmission(integrationTargets, (yield* makeApplicationExitLifecycle()).admission)
})

const runId = RunId.make("pause-progress-coverage-run")
const taskId = TaskId.make("A")
const target = FixtureTarget.make("pause-progress-coverage-target")
const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(2)
})

const plannedAttempt = (attemptTaskId = taskId): PlannedTaskAttempt =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`pause-progress-coverage-${attemptTaskId}`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/pause-progress-coverage-${attemptTaskId}`),
    executor: TaskExecutorLocator.make("executor:pause-progress-coverage"),
    runId,
    taskId: attemptTaskId,
    taskRevision: TaskRevision.make(`pause-progress-coverage-${attemptTaskId}`),
    worktree: WorktreeLocator.make(`/pause-progress-coverage/${attemptTaskId}`)
  })

const projected = projectTrackerSnapshot({
  revision: "pause-progress-coverage-G1",
  tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
})
if (projected._tag === "Invalid") throw new Error("pause progress coverage graph must be valid")

const graph = {
  _tag: "GraphEstablished" as const,
  observation: makeTestJournaledTrackerGraphObservation({
    operationId: OperationId.make("pause-progress-coverage-graph"),
    recordedAt: JournalPosition.make(5),
    snapshot: projected.snapshot
  })
}

const executorEvidence = (safe: boolean): ExactTicketDeliveryEvidence => {
  const attempt = plannedAttempt()
  const facts: ResponsibilityFreshFacts = {
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: safe
      ? ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
          correlation: plannedAttemptExecutorCorrelation(attempt)
        })
      : ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested(),
    responsibility: {
      _tag: "PlannedAttemptExecutorWorkResponsibility",
      beganAt: JournalPosition.make(1),
      plannedAttempt: attempt
    }
  }
  return { _tag: "ResponsibilityFacts", facts }
}

const evaluation = (
  exactEvidence: ReadonlyArray<ExactTicketDeliveryEvidence>,
  proposals: ReadonlyArray<DeliveryActionProposal> = [],
  runPaused = false
): DeliveryRuntimeEvaluation => {
  const publication = { exactEvidence, graph, policy }
  const frontier = frontierOf(publication)
  const tickets = boundedParallelTicketsOf(frontier)
  const ticketDeliveries = ticketDeliveriesOf(tickets, exactEvidence)
  const settlements = deliverySettlementsOf(ticketDeliveries)
  return {
    _tag: "DeliveryRuntimeEvaluation",
    acceptedAt: JournalPosition.make(5),
    current: {
      _tag: "DeliveryRuntimeSnapshot",
      reflection: makeDeliveryReflection(settlements),
      settlements,
      ticketDeliveries,
      trackerGraph: graph
    },
    pauseCoverage: {
      _tag: "PauseCoverageGraphEstablished",
      applied: {
        run: runPaused ? { _tag: "RunPaused" } : { _tag: "RunUnpaused" },
        tasks: runPaused ? { _tag: "NoTaskPauses" } : { _tag: "TaskPauses", taskIds: [taskId] }
      },
      observedAt: JournalPosition.make(5),
      snapshot: projected.snapshot
    },
    proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals },
    quiescence: { _tag: "QuiescencePassive", reason: "RunPaused" },
    taskWork: { capacity: policy.taskExecutionCapacity, held: [] }
  }
}

const executorProposal = (attemptTaskId = taskId): DeliveryActionProposal => ({
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
      correlation: plannedAttemptExecutorCorrelation(plannedAttempt(attemptTaskId))
    },
    taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "Existing", taskId }
  },
  id: DeliveryProposalId.make(`pause-progress-coverage-executor-${attemptTaskId}`),
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

const accepted = UnqueuedAcceptedResult.make({
  acceptedResult: acceptedResultFixture(GitCommitSha.make("2".repeat(40))),
  plannedAttempt: plannedAttempt(),
  terminalAt: JournalPosition.make(6)
})
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/pause-progress-coverage/integration.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const queued = QueuedIntegrationResponsibility.make({
  acceptedResult: accepted.acceptedResult,
  integrationTarget,
  plannedAttempt: accepted.plannedAttempt,
  preIntegrationCancellation: {
    attemptId: accepted.plannedAttempt.attemptId,
    queuedAt: JournalPosition.make(7),
    runId
  },
  queuedAt: JournalPosition.make(7)
})

const integrationProposal = (queuedAt: JournalPosition): DeliveryActionProposal => ({
  ...executorProposal(),
  admission: {
    integrationTarget: { _tag: "IntegrationTargetResourceRequired", access: "Acquire", integrationTarget, queuedAt },
    plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" },
    taskWorkPosition: { _tag: "NoTaskWorkPosition" }
  },
  id: DeliveryProposalId.make(`pause-progress-coverage-integration-${queuedAt}`)
})

const taskSubject = { _tag: "Task" as const, runId, taskId }
const emptyResources = {
  activeResponsibilityPositions: new Set<JournalPosition>(),
  heldResponsibilityPositions: new Set<JournalPosition>()
}

it.effect("matches executor actions only to the exact planned-attempt obligation and reports every owner state", () =>
  Effect.sync(() => {
    const matching = executorProposal()
    const mismatched = executorProposal(TaskId.make("different-task"))
    const withoutPermit = {
      ...executorProposal(),
      admission: {
        integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
        plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
        taskWorkPosition: { _tag: "NoTaskWorkPosition" as const }
      },
      id: DeliveryProposalId.make("pause-progress-coverage-without-permit")
    } satisfies DeliveryActionProposal

    const ownerCases = [
      DeliveryRuntimeLiveOwnerSnapshot.AdmittedDeliveryAction({ proposal: matching }),
      DeliveryRuntimeLiveOwnerSnapshot.MaterializedDeliveryAction({
        intent: "IntentNotRecorded",
        operationId: OperationId.make("pause-owner-materialized"),
        proposal: matching
      }),
      DeliveryRuntimeLiveOwnerSnapshot.SettledBeforeMaterialization({ proposal: matching }),
      DeliveryRuntimeLiveOwnerSnapshot.SettledMaterializedDeliveryAction({
        intent: "IntentRecorded",
        operationId: OperationId.make("pause-owner-settled"),
        proposal: matching
      })
    ]

    const blockersByOwner = ownerCases.map((owner) => {
      const view = pauseProgressViewOf(
        taskSubject,
        DeliveryRuntimeObservationState.Ready({
          evaluation: evaluation([executorEvidence(false)], [matching, mismatched, withoutPermit]),
          liveOwners: [owner]
        }),
        emptyResources
      )
      expect(view._tag).toBe("PauseWaiting")
      if (view._tag !== "PauseWaiting") return []
      return view.preventing.flatMap(pauseSafeBoundaryBlockersOf)
    })

    expect(blockersByOwner.map((blockers) => blockers.map(({ _tag }) => _tag))).toEqual([
      ["ExecutorSafeSuspensionRequired", "LiveDeliveryAction", "ProposedDeliveryAction", "ProposedDeliveryAction"],
      ["ExecutorSafeSuspensionRequired", "LiveDeliveryAction", "ProposedDeliveryAction", "ProposedDeliveryAction"],
      [
        "ExecutorSafeSuspensionRequired",
        "AcceptedOutcomePublicationPending",
        "ProposedDeliveryAction",
        "ProposedDeliveryAction"
      ],
      [
        "ExecutorSafeSuspensionRequired",
        "AcceptedOutcomePublicationPending",
        "ProposedDeliveryAction",
        "ProposedDeliveryAction"
      ]
    ])
    for (const blockers of blockersByOwner.slice(2)) {
      const pending = blockers.find(({ _tag }) => _tag === "AcceptedOutcomePublicationPending")
      expect(pending).toEqual({ _tag: "AcceptedOutcomePublicationPending", proposal: matching })
    }
  })
)

it.effect("matches queued integration actions by position and exposes held and active target blockers", () =>
  Effect.sync(() => {
    const proposal = integrationProposal(queued.queuedAt)
    const view = pauseProgressViewOf(
      taskSubject,
      DeliveryRuntimeObservationState.Ready({
        evaluation: evaluation(
          [
            { _tag: "AcceptedAwaitingIntegration", accepted },
            { _tag: "QueuedIntegration", responsibility: queued }
          ],
          [proposal]
        ),
        liveOwners: []
      }),
      {
        activeResponsibilityPositions: new Set([queued.queuedAt]),
        heldResponsibilityPositions: new Set([queued.queuedAt])
      }
    )
    expect(view._tag).toBe("PauseWaiting")
    if (view._tag !== "PauseWaiting") return
    expect(view.atBoundary.map(({ responsibility }) => responsibility._tag)).toEqual([
      "PauseAcceptedIntegrationResponsibility"
    ])
    expect(view.preventing.flatMap(({ blockers }) => blockers.map(({ _tag }) => _tag))).toEqual([
      "HeldIntegrationTarget",
      "ActiveIntegrationTarget",
      "ProposedDeliveryAction"
    ])

    const safeView = pauseProgressViewOf(
      taskSubject,
      DeliveryRuntimeObservationState.Ready({
        evaluation: evaluation([{ _tag: "QueuedIntegration", responsibility: queued }]),
        liveOwners: []
      }),
      emptyResources
    )
    expect(safeView).toMatchObject({
      _tag: "PauseConfirmed",
      atBoundary: [{ responsibility: { _tag: "PauseQueuedIntegrationResponsibility" } }]
    })
  })
)

it.effect("matches an accepted workflow action only to the obligation carrying the same operation", () =>
  Effect.sync(() => {
    const operationId = OperationId.make("pause-progress-coverage-claim")
    const responsibility = WorkflowResponsibilityEntry.cases.TaskClaimResponsibility.make({
      acquisition: TaskClaimAcquisition.make({
        operationId,
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("pause-progress-coverage-token")
      }),
      beganAt: JournalPosition.make(2),
      taskId
    })
    const transition = RunnableFrontierTransition.ReconcileTaskClaim({ operationId, taskId })
    const matching = {
      _tag: "DeliveryActionProposal",
      actionIdentity: { _tag: "ExistingOperationId" },
      admission: {
        integrationTarget: { _tag: "NoIntegrationTargetResource" },
        plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" },
        taskWorkPosition: { _tag: "NoTaskWorkPosition" }
      },
      id: DeliveryProposalId.make("pause-progress-coverage-matching-claim"),
      order: {
        _tag: "RecoveredWorkflowOrder",
        acceptedAt: JournalPosition.make(5),
        frontierOrdinal: DeliveryProposalOrdinal.make(0),
        responsibilityBeganAt: JournalPosition.make(2),
        taskId,
        transition: "ReconcileTaskClaim"
      },
      owner: "TicketDelivery",
      route: { _tag: "AcceptedWorkflowRoute", transition },
      waitsForLiveOperationId: null
    } satisfies DeliveryActionProposal
    const mismatched = {
      ...matching,
      id: DeliveryProposalId.make("pause-progress-coverage-mismatched-claim"),
      route: {
        _tag: "AcceptedWorkflowRoute" as const,
        transition: RunnableFrontierTransition.ReconcileTaskClaim({
          operationId: OperationId.make("pause-progress-coverage-other-claim"),
          taskId
        })
      }
    } satisfies DeliveryActionProposal
    const view = pauseProgressViewOf(
      taskSubject,
      DeliveryRuntimeObservationState.Ready({
        evaluation: evaluation(
          [
            {
              _tag: "ResponsibilityFacts",
              facts: {
                _tag: "WorkflowOperationFreshFacts",
                disposition: ResponsibilityDisposition.Ready(),
                responsibility
              }
            }
          ],
          [matching, mismatched]
        ),
        liveOwners: [DeliveryRuntimeLiveOwnerSnapshot.AdmittedDeliveryAction({ proposal: matching })]
      }),
      emptyResources
    )
    expect(view._tag).toBe("PauseWaiting")
    if (view._tag !== "PauseWaiting") return
    expect(view.preventing.flatMap(({ blockers }) => blockers.map(({ _tag }) => _tag))).toEqual([
      "LiveDeliveryAction",
      "ProposedDeliveryAction"
    ])

    const safeView = pauseProgressViewOf(
      taskSubject,
      DeliveryRuntimeObservationState.Ready({
        evaluation: evaluation([
          {
            _tag: "ResponsibilityFacts",
            facts: {
              _tag: "WorkflowOperationFreshFacts",
              disposition: ResponsibilityDisposition.Ready(),
              responsibility
            }
          }
        ]),
        liveOwners: []
      }),
      emptyResources
    )
    expect(safeView).toMatchObject({
      _tag: "PauseConfirmed",
      atBoundary: [{ responsibility: { _tag: "PauseWorkflowOperationResponsibility" } }]
    })
  })
)

it.effect("ignores an ownership conflict whose order names no covered task", () =>
  Effect.sync(() => {
    const unrelated = trackerGraphReadProposalOf({
      acceptedAt: JournalPosition.make(5),
      purpose: "EstablishCurrentGraph",
      runId,
      target
    })
    const base = evaluation([executorEvidence(true)])
    const view = pauseProgressViewOf(
      taskSubject,
      DeliveryRuntimeObservationState.Ready({
        evaluation: {
          ...base,
          proposedActions: {
            _tag: "DeliveryProposalOwnershipConflict",
            conflicts: [{ id: unrelated.id, order: unrelated.order, owners: ["TrackerGraph", "TicketDelivery"] }]
          }
        },
        liveOwners: []
      }),
      emptyResources
    )
    expect(view._tag).toBe("PauseConfirmed")
  })
)

it.effect("ignores an available tracker-graph action because it names no Pause-covered task", () =>
  Effect.sync(() => {
    const graphProposal = trackerGraphReadProposalOf({
      acceptedAt: JournalPosition.make(5),
      purpose: "EstablishCurrentGraph",
      runId,
      target
    })
    const base = evaluation([executorEvidence(true)])
    const view = pauseProgressViewOf(
      taskSubject,
      DeliveryRuntimeObservationState.Ready({
        evaluation: {
          ...base,
          proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [graphProposal] }
        },
        liveOwners: []
      }),
      emptyResources
    )
    expect(view._tag).toBe("PauseConfirmed")
  })
)

it.effect("keeps exact task coverage while complete grouping facts are not established", () =>
  Effect.sync(() => {
    const base = evaluation([executorEvidence(false)])
    const view = pauseProgressViewOf(
      taskSubject,
      DeliveryRuntimeObservationState.Ready({
        evaluation: {
          ...base,
          pauseCoverage: { _tag: "PauseCoverageGraphNotEstablished", applied: base.pauseCoverage.applied }
        },
        liveOwners: []
      }),
      emptyResources
    )
    expect(view).toMatchObject({
      _tag: "PauseWaiting",
      preventing: [{ responsibility: { coverage: { _tag: "ExactTaskPauseCoverage" }, taskId } }]
    })
  })
)

it.effect("re-emits Pause progress when only accepted integration-target activity changes", () =>
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    yield* integrationTargets.acquire({ integrationTarget, queuedAt: queued.queuedAt })
    yield* integrationTargets.publishAcceptedOwnership({ integrationTarget, queuedAt: queued.queuedAt })
    const { observation: runtime, resources } = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
    yield* runtime.publish(evaluation([{ _tag: "QueuedIntegration", responsibility: queued }]), [])

    const initialObserved = yield* Deferred.make<void>()
    const activeObserved = yield* observePauseProgress(resources, runId, null, taskSubject).pipe(
      Stream.tap(() => Deferred.succeed(initialObserved, undefined)),
      Stream.filter(
        (view) =>
          view._tag === "PauseWaiting" &&
          view.preventing.some(({ blockers }) => blockers.some(({ _tag }) => _tag === "ActiveIntegrationTarget"))
      ),
      Stream.runHead,
      Effect.forkChild
    )
    yield* Deferred.await(initialObserved)
    yield* integrationTargets.withPermit(
      { integrationTarget, queuedAt: queued.queuedAt },
      Fiber.join(activeObserved).pipe(Effect.asVoid)
    )
    expect(yield* Fiber.join(activeObserved)).toMatchObject({ _tag: "Some", value: { _tag: "PauseWaiting" } })
    yield* integrationTargets.releaseAll
  })
)

it.effect("canonicalizes integration-target position sets without depending on insertion order", () =>
  Effect.gen(function* () {
    const ready = DeliveryRuntimeObservationState.Ready({
      evaluation: evaluation([executorEvidence(false)]),
      liveOwners: []
    })
    const position = (value: number) => JournalPosition.make(value)
    const snapshots = [
      {
        activeResponsibilityPositions: new Set([position(101)]),
        heldResponsibilityPositions: new Set([position(201)])
      },
      {
        activeResponsibilityPositions: new Set([position(101)]),
        heldResponsibilityPositions: new Set([position(202)])
      },
      {
        activeResponsibilityPositions: new Set([position(101)]),
        heldResponsibilityPositions: new Set([position(202), position(203)])
      },
      {
        activeResponsibilityPositions: new Set([position(102)]),
        heldResponsibilityPositions: new Set([position(203), position(202)])
      },
      {
        activeResponsibilityPositions: new Set([position(102), position(103)]),
        heldResponsibilityPositions: new Set([position(202), position(203)])
      }
    ]
    const views = yield* observePauseProgress(
      {
        integrationTargets: { changes: Stream.fromIterable(snapshots) },
        runtimeObservation: currentSignalFromCurrentFirstStream(Stream.make(ready))
      },
      runId,
      null,
      taskSubject
    ).pipe(Stream.runCollect)
    expect(Array.from(views).map(({ _tag }) => _tag)).toEqual(["PauseWaiting"])
  })
)

it.effect("reads both closed runtime variants and covers a whole-Run Pause from its accepted position", () =>
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const { observation: runtime, resources } = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)

    yield* runtime.publish(evaluation([executorEvidence(false)], [], true), [])
    const firstView = yield* Deferred.make<void>()
    const observing = yield* observePauseProgress(
      resources,
      runId,
      { latestAcceptedAt: JournalPosition.make(5) },
      { _tag: "Run", runId }
    ).pipe(
      Stream.tap(() => Deferred.succeed(firstView, undefined)),
      Stream.runCollect,
      Effect.forkChild
    )
    yield* Deferred.await(firstView)
    yield* runtime.close
    expect(Array.from(yield* Fiber.join(observing)).map(({ _tag }) => _tag)).toEqual(["PauseWaiting"])

    const confirmed = pauseProgressViewOf(
      { _tag: "Run", runId },
      DeliveryRuntimeObservationState.Ready({
        evaluation: evaluation([executorEvidence(true)], [], true),
        liveOwners: []
      }),
      emptyResources
    )
    expect(confirmed).toMatchObject({
      _tag: "PauseConfirmed",
      atBoundary: [{ responsibility: { coverage: { _tag: "RunPauseCoverage" }, taskId } }]
    })

    const notReadyIntegrationTargets = yield* makeIntegrationTargetResourceController()
    const { observation: notReadyRuntime, resources: notReadyResources } =
      yield* deliveryRuntimeResourceCapabilitiesOf(notReadyIntegrationTargets)
    const notReadyStarted = yield* Deferred.make<void>()
    const notReadyObservation = yield* observePauseProgress(notReadyResources, runId, null, taskSubject).pipe(
      Stream.onStart(Deferred.succeed(notReadyStarted, undefined)),
      Stream.runCollect,
      Effect.forkChild
    )
    yield* Deferred.await(notReadyStarted)
    yield* notReadyRuntime.close
    expect(Array.from(yield* Fiber.join(notReadyObservation))).toEqual([])
    yield* notReadyIntegrationTargets.releaseAll
  })
)
