import {
  AcceptedResult,
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
  WorktreeLocator
} from "@dalph/contracts"
import { describe, expect, it } from "vitest"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { TaskLifecycle, type Task } from "../../authorities/task-tracker/task.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import {
  makeTargetLineageObservationOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  QueuedIntegrationResponsibility,
  StartedIntegrationResponsibility,
  UnqueuedAcceptedResult
} from "../../workflow/protocols/integration-admission/protocol.js"
import {
  CandidateContinuationLimit,
  CandidateCorrectionLimit
} from "../../workflow/protocols/integration-candidate-construction/events.js"
import { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import { RunnableFrontierTransition, type RunnableFrontierTransition as Transition } from "../frontier/frontier.js"
import { deliveryProposalsOf } from "./delivery-proposal.js"
import { FreshWorkflowStep } from "./fresh-workflow-step.js"

const runId = RunId.make("route-matrix-run")
const taskId = TaskId.make("A")
const target = FixtureTarget.make("route-matrix-target")
const task: Task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("route-matrix-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/A"),
  executor: TaskExecutorLocator.make("executor:fake"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("route-matrix-revision"),
  worktree: WorktreeLocator.make("/worktrees/A")
})
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repo/.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const acceptedResult = AcceptedResult.make({ commit: GitCommitSha.make("2".repeat(40)) })
const queued = QueuedIntegrationResponsibility.make({
  acceptedResult,
  integrationTarget,
  plannedAttempt,
  preIntegrationCancellation: { attemptId: plannedAttempt.attemptId, queuedAt: JournalPosition.make(20), runId },
  queuedAt: JournalPosition.make(20)
})
const started = StartedIntegrationResponsibility.make({
  acceptedResult,
  integrationTarget,
  plannedAttempt,
  queuedAt: queued.queuedAt,
  startedAt: JournalPosition.make(21)
})
const unqueued = UnqueuedAcceptedResult.make({ acceptedResult, plannedAttempt, terminalAt: JournalPosition.make(19) })
const activeClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("accepted-claim"),
  owner: ClaimOwner.make("dalph"),
  taskId,
  token: ClaimToken.make("route-matrix-token")
})
const responsibilityBeganAt = JournalPosition.make(18)

const proposalsFor = (transition: Transition, acceptedOperationIds: ReadonlySet<OperationId> = new Set()) => {
  const result = deliveryProposalsOf({
    acceptedOperationIds,
    fresh: [],
    integrationResponsibilities: [started],
    responsibilities: [
      { _tag: "PlannedAttemptExecutorWorkResponsibility", beganAt: responsibilityBeganAt, plannedAttempt }
    ],
    runId,
    transitions: [transition]
  })
  return { issues: result.issues, proposals: [...result.ticketDelivery, ...result.deliverySettlement] }
}

describe("delivery proposal route matrix", () => {
  it("reuses accepted identity for every operation-reconciliation route", () => {
    const operationId = OperationId.make("accepted-operation")
    const transitions = [
      RunnableFrontierTransition.CheckTaskClaim({ operationId, taskId }),
      RunnableFrontierTransition.ReconcileTaskClaim({ operationId, taskId }),
      RunnableFrontierTransition.ReconcileTaskClaimRelease({ operationId, taskId }),
      RunnableFrontierTransition.ReconcileTaskWorktree({ operationId, taskId })
    ]

    for (const transition of transitions) {
      expect(proposalsFor(transition, new Set([operationId]))).toMatchObject({
        issues: [],
        proposals: [
          {
            actionIdentity: { _tag: "ExistingOperationId", operationId },
            owner: "TicketDelivery",
            route: { _tag: "AcceptedWorkflowRoute", transition }
          }
        ]
      })
    }

    const firstTransition = transitions[0]
    if (firstTransition === undefined) return expect.fail("route matrix must contain one accepted-operation transition")
    expect(proposalsFor(firstTransition)).toMatchObject({
      issues: [{ _tag: "AcceptedOperationEvidenceMissing", operationId }],
      proposals: []
    })
  })

  it("distinguishes new observation reads from accepted observation reconciliation", () => {
    const graphOperation = makeTrackerGraphObservationOperation(OperationId.make("observe-graph"), target)
    const specificationOperation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("observe-specification"),
      target,
      taskId
    )
    const claimOperation = makeTaskClaimObservationOperation(OperationId.make("observe-claim"), target, taskId)
    const worktreeOperation = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("observe-worktree"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const lineageOperation = makeTargetLineageObservationOperation({
      integrationTarget,
      operationId: OperationId.make("observe-lineage"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const observations = [
      {
        actionTag: "ReadTrackerGraph",
        operationId: graphOperation.operationId,
        transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
          operation: graphOperation,
          plannedAttempt
        })
      },
      {
        actionTag: "ReadTaskWorkSpecification",
        operationId: specificationOperation.operationId,
        transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationSpecification({
          operation: specificationOperation,
          plannedAttempt
        })
      },
      {
        actionTag: "ReadTaskClaim",
        operationId: claimOperation.operationId,
        transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationClaim({
          operation: claimOperation,
          plannedAttempt
        })
      },
      {
        actionTag: "ReadTaskWorktree",
        operationId: worktreeOperation.operationId,
        transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationWorktree({
          operation: worktreeOperation,
          plannedAttempt
        })
      },
      {
        actionTag: "ReadTargetLineage",
        operationId: lineageOperation.operationId,
        transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
          operation: lineageOperation,
          plannedAttempt
        })
      }
    ] as const

    for (const { actionTag, operationId, transition } of observations) {
      const fresh = proposalsFor(transition)
      const accepted = proposalsFor(transition, new Set([operationId]))

      expect(proposalsFor(transition)).toEqual(fresh)
      expect(proposalsFor(transition, new Set([operationId]))).toEqual(accepted)
      expect(fresh).toMatchObject({
        issues: [],
        proposals: [
          {
            actionIdentity: { _tag: "FreshOperationIdRequired" },
            route: { _tag: "RecoveredNewActionRoute", action: { _tag: actionTag } }
          }
        ]
      })
      expect(JSON.stringify(fresh)).not.toContain(operationId)
      expect(accepted).toMatchObject({
        issues: [],
        proposals: [
          {
            actionIdentity: { _tag: "ExistingOperationId", operationId },
            route: { _tag: "AcceptedWorkflowRoute", transition }
          }
        ]
      })
    }

    const responsibleClaimOperation = makeTaskClaimObservationOperation(
      OperationId.make("observe-responsible-claim"),
      target,
      taskId
    )
    const claimTransition = RunnableFrontierTransition.ObserveResponsibleTaskClaim({
      operation: responsibleClaimOperation,
      taskId
    })
    expect(proposalsFor(claimTransition)).toMatchObject({
      issues: [],
      proposals: [
        {
          actionIdentity: { _tag: "FreshOperationIdRequired" },
          route: { _tag: "RecoveredNewActionRoute", action: { _tag: "ReadTaskClaim", plannedAttempt: null } }
        }
      ]
    })
    expect(proposalsFor(claimTransition, new Set([responsibleClaimOperation.operationId]))).toMatchObject({
      issues: [],
      proposals: [
        { actionIdentity: { _tag: "ExistingOperationId", operationId: responsibleClaimOperation.operationId } }
      ]
    })
  })

  it("keeps new recovery actions identity-free until admission", () => {
    const release = makeTaskClaimReleaseOperation({
      predecessorOperationIds: [activeClaim.operationId],
      release: { claim: activeClaim, operationId: OperationId.make("release-placeholder") }
    })
    const transitions = [
      RunnableFrontierTransition.CommitTaskClaimReacquisitionIntent({
        plannedAttempt,
        requestId: TaskClaimReacquisitionRequestId.make("reacquire-A"),
        taskId
      }),
      RunnableFrontierTransition.ReleaseExternallyCompletedTaskClaim({ operation: release, plannedAttempt })
    ]

    for (const transition of transitions) {
      const result = proposalsFor(transition)
      expect(result).toMatchObject({
        issues: [],
        proposals: [
          {
            actionIdentity: { _tag: "FreshOperationIdRequired" },
            order: { _tag: "RecoveredWorkflowOrder", responsibilityBeganAt },
            owner: "TicketDelivery",
            route: { _tag: "RecoveredNewActionRoute", action: { plannedAttempt } }
          }
        ]
      })
      expect(JSON.stringify(result)).not.toContain("release-placeholder")
    }
  })

  it("keeps exact attempt provenance in recovered proposal identity", () => {
    const otherAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("route-matrix-other-attempt")
    })
    const requestId = TaskClaimReacquisitionRequestId.make("same-reacquisition-request")
    const proposalForAttempt = (attempt: PlannedTaskAttempt) =>
      proposalsFor(
        RunnableFrontierTransition.CommitTaskClaimReacquisitionIntent({ plannedAttempt: attempt, requestId, taskId })
      ).proposals[0]

    const first = proposalForAttempt(plannedAttempt)
    const second = proposalForAttempt(otherAttempt)

    expect(first).toMatchObject({ route: { action: { plannedAttempt } } })
    expect(second).toMatchObject({ route: { action: { plannedAttempt: otherAttempt } } })
    expect(first?.id).not.toBe(second?.id)
  })

  it("assigns every identity-free executor and integration route to its exact owner and resource", () => {
    const lineage = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: plannedAttempt.baseSha,
      targetHeadSha: GitCommitSha.make("3".repeat(40))
    })
    const cases = [
      {
        access: "NoIntegrationTargetResource",
        owner: "TicketDelivery",
        position: "ReserveOrReuse",
        transition: RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({ plannedAttempt })
      },
      {
        access: "NoIntegrationTargetResource",
        owner: "TicketDelivery",
        position: "Existing",
        transition: RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
      },
      {
        access: "NoIntegrationTargetResource",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.QueueAcceptedResultIntegrationResponsibility({
          accepted: unqueued,
          integrationTarget
        })
      },
      {
        access: "Acquire",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.StartQueuedIntegration({ responsibility: queued })
      },
      {
        access: "Acquire",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility: started })
      },
      {
        access: "UseHeld",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.ContinueStartedIntegrationCandidate({
          continuationLimit: CandidateContinuationLimit.make(2),
          correctionLimit: CandidateCorrectionLimit.make(2),
          lineage,
          responsibility: started
        })
      },
      {
        access: "Release",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility: started })
      }
    ] as const

    for (const routeCase of cases) {
      const proposals = proposalsFor(routeCase.transition).proposals
      expect(proposals).toHaveLength(1)
      const proposal = proposals[0]
      if (proposal === undefined) continue
      const { admission, owner, route } = proposal
      expect(owner).toBe(routeCase.owner)
      expect(route).toMatchObject({ _tag: "IdentityFreeWorkflowRoute", transition: routeCase.transition })
      expect(admission.integrationTarget._tag).toBe(
        routeCase.access === "NoIntegrationTargetResource"
          ? "NoIntegrationTargetResource"
          : "IntegrationTargetResourceRequired"
      )
      if (admission.integrationTarget._tag === "IntegrationTargetResourceRequired") {
        expect(admission.integrationTarget.access).toBe(routeCase.access)
        expect(admission.integrationTarget.integrationTarget).toEqual(integrationTarget)
      }
      expect(admission.taskWorkPosition).toMatchObject(
        routeCase.position === null
          ? { _tag: "NoTaskWorkPosition" }
          : { _tag: "TaskWorkPositionRequired", mode: routeCase.position, taskId }
      )
    }
  })

  it("requires fresh provenance for all three fresh-only transition tags", () => {
    const start = RunnableFrontierTransition.StartPlannedAttemptExecutorWork({ plannedAttempt })
    const step = FreshWorkflowStep.StartPlannedAttemptExecutorWork({ plannedAttempt, task })
    const [proposal] = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [{ step, transition: start }],
      runId,
      transitions: [start]
    }).ticketDelivery
    expect(proposal).toMatchObject({
      actionIdentity: { _tag: "NoWorkflowOperationIdentity" },
      admission: { taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId } },
      route: { _tag: "FreshExecutorWorkflowRoute", step }
    })

    for (const transition of [
      RunnableFrontierTransition.CommitFreshTaskClaimIntent({ taskId, taskRevision: plannedAttempt.taskRevision }),
      RunnableFrontierTransition.ContinueFreshWorkflowOperation({
        operationId: OperationId.make("fresh-predecessor"),
        taskId
      }),
      start
    ]) {
      expect(proposalsFor(transition)).toMatchObject({
        issues: [{ _tag: "FreshRouteProvenanceMissing", taskId, transition: transition._tag }],
        proposals: []
      })
    }
  })
})
