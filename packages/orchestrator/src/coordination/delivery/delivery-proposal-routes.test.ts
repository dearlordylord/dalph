import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { describe, expect, expectTypeOf, it } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Option, Ref, Stream } from "effect"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { TaskLifecycle, type Task } from "../../authorities/task-tracker/task.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { outcomeRecordKey } from "../../workflow-journal/record-key.js"
import {
  makeTargetLineageObservationOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation,
  TaskClaimReleaseAuthority
} from "../../workflow/registry/operation.js"
import {
  QueuedIntegrationResponsibility,
  StartedIntegrationResponsibility,
  UnqueuedAcceptedResult
} from "../../workflow/protocols/integration-admission/protocol.js"
import {
  IntegrationCandidateAgent,
  CandidateContinuationLimit,
  CandidateCorrectionLimit
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { RunnableFrontierTransition, type RunnableFrontierTransition as Transition } from "../frontier/frontier.js"
import { deliveryProposalsOf } from "./delivery-proposal.js"
import { FreshWorkflowStep } from "./fresh-workflow-step.js"
import { executeAcceptedWorkflowAction, executeNewRecoveredAction } from "./recovered-delivery-action-adapter.js"
import { DeliveryActionExecutor, type DeliveryActionExecutionLease } from "./delivery-action-executor.js"
import type {
  AcceptedIdentityDeliveryProposal,
  DeliveryActionProposal,
  FreshIdentityDeliveryProposal,
  IdentityFreeDeliveryProposal
} from "./delivery-action-proposal.js"
import { executeIntegrationAction } from "./integration-delivery-action-adapter.js"
import { IntegrationCandidateBoundaryUnavailable } from "./integration-candidate-boundary.js"
import { executeFreshWorkflowOperation } from "./fresh-delivery-action-adapter.js"
import { executePlannedAttemptTransition } from "./planned-attempt-delivery-action-adapter.js"
import { liveDeliveryActionExecutorLayer, makeLiveDeliveryActionExecutor } from "./live-delivery-action-executor.js"
import { DeliveryAcceptedFactPublication } from "./delivery-accepted-fact-publication.js"
import {
  completionClaimDeletionRequestFor,
  CompletionClaimBoundary,
  CompletionClaimReadFailure,
  completionClaimReplacementOperationIdFor,
  completionClaimReplacementRequestFor
} from "../../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { IntegrationFinalityRuntimeUnavailable } from "./integration-finality-boundary.js"

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

it("makes stopped and ordinary claim-release route authorities mutually unconstructible", () => {
  type StoppedRelease = Extract<Transition, { readonly _tag: "ReleaseStoppedAttemptClaim" }>["operation"]
  type ExternalRelease = Extract<Transition, { readonly _tag: "ReleaseExternallyCompletedTaskClaim" }>["operation"]

  expectTypeOf<StoppedRelease["authority"]["_tag"]>().toEqualTypeOf<"StoppedAttemptClaimReleaseAuthority">()
  expectTypeOf<ExternalRelease["authority"]["_tag"]>().toEqualTypeOf<"WorkflowClaimReleaseAuthority">()
})
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

const isIdentityFreeProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

const isAcceptedIdentityProposal = (proposal: DeliveryActionProposal): proposal is AcceptedIdentityDeliveryProposal =>
  proposal.actionIdentity._tag === "ExistingOperationId"

type FreshOperationProposal = Extract<
  FreshIdentityDeliveryProposal,
  { readonly actionIdentity: { readonly _tag: "FreshOperationIdRequired" } }
>

const isFreshOperationProposal = (proposal: DeliveryActionProposal): proposal is FreshOperationProposal =>
  proposal.actionIdentity._tag === "FreshOperationIdRequired"

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

const inertLease: DeliveryActionExecutionLease = {
  acceptIntegrationTargetOwnership: Effect.void,
  bindPlannedAttemptPosition: () => Effect.void,
  integrationTargets: {
    acquire: () => Effect.void,
    changes: Stream.empty,
    publishAcceptedOwnership: () => Effect.void,
    release: () => Effect.void,
    releaseAll: Effect.void,
    snapshot: Effect.succeed({ activeResponsibilityPositions: new Set(), heldResponsibilityPositions: new Set() }),
    withPermit: (_responsibility, effect) => effect
  },
  recordIntent: () => Effect.void,
  releasePlannedAttemptPosition: () => Effect.void
}

const appendableJournalFor = (records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  InRunJournal.of({
    append: (runId, key, event) =>
      Ref.modify(records, (current) => {
        const existing = current.find((candidate) => candidate.key === key)
        if (existing !== undefined) return [Effect.succeed(existing), current] as const
        const appended: JournalRecord = { event, key, position: JournalPosition.make(current.length + 1), runId }
        return [Effect.succeed(appended), [...current, appended]] as const
      }).pipe(Effect.flatten),
    read: () => Ref.get(records)
  })

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
      authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
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
        transition: RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
          acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
          plannedAttempt
        })
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
          acceptedCandidateProgressAt: null,
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
      },
      {
        access: "NoIntegrationTargetResource",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.ReplacePromotedTaskClaim({
          request: completionClaimReplacementRequestFor(integrationFinalityFixture.claim),
          responsibility: started
        })
      },
      {
        access: "NoIntegrationTargetResource",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.DeleteCompletedTaskCompletionClaim({
          replacementOperationId: completionClaimReplacementOperationIdFor(integrationFinalityFixture.claim),
          request: completionClaimDeletionRequestFor(
            integrationFinalityFixture.claim,
            integrationFinalityFixture.successObservation
          ),
          responsibility: started
        })
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

  effectIt.effect("executes the identity-free acquire route and names missing candidate boundaries", () =>
    Effect.gen(function* () {
      const candidateJournal = InRunJournal.of({
        append: () => Effect.die("candidate journal must not append"),
        read: () => Effect.succeed([])
      })
      const acquire = RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility: started })
      const acquireProposal = proposalsFor(acquire).proposals[0]
      if (acquireProposal === undefined || !isIdentityFreeProposal(acquireProposal)) {
        return yield* Effect.die("missing identity-free acquire proposal")
      }
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: acquireProposal },
          acquire,
          inertLease
        ).pipe(Effect.provideService(InRunJournal, candidateJournal))
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: acquireProposal.id })

      const lineage = TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: plannedAttempt.baseSha,
        targetHeadSha: GitCommitSha.make("4".repeat(40))
      })
      const continuation = RunnableFrontierTransition.ContinueStartedIntegrationCandidate({
        acceptedCandidateProgressAt: null,
        continuationLimit: CandidateContinuationLimit.make(2),
        correctionLimit: CandidateCorrectionLimit.make(2),
        lineage,
        responsibility: started
      })
      const continuationProposal = proposalsFor(continuation).proposals[0]
      if (continuationProposal === undefined || !isIdentityFreeProposal(continuationProposal)) {
        return yield* Effect.die("missing identity-free continuation proposal")
      }
      const action = { _tag: "IdentityFreeAction" as const, proposal: continuationProposal }
      const missingAgent = yield* executeIntegrationAction(action, continuation, inertLease).pipe(
        Effect.provideService(InRunJournal, candidateJournal),
        Effect.flip
      )
      expect(missingAgent).toEqual(new IntegrationCandidateBoundaryUnavailable({ boundary: "Agent" }))

      const missingGit = yield* executeIntegrationAction(action, continuation, inertLease).pipe(
        Effect.provideService(
          IntegrationCandidateAgent,
          IntegrationCandidateAgent.of({ startOrContinue: () => Effect.die("candidate agent must not run") })
        ),
        Effect.provideService(InRunJournal, candidateJournal),
        Effect.flip
      )
      expect(missingGit).toEqual(new IntegrationCandidateBoundaryUnavailable({ boundary: "Git" }))
    })
  )

  effectIt.effect("executes completion-claim replacement and deletion through the configured boundary", () =>
    Effect.gen(function* () {
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
        {
          event: integrationFinalityFixture.promotionSuccess,
          key: JournalRecordKey.make("integration-finality-action:promotion"),
          position: JournalPosition.make(1),
          runId: integrationFinalityFixture.runId
        }
      ])
      const journal = appendableJournalFor(records)
      let currentClaim: typeof integrationFinalityFixture.activeClaim | typeof integrationFinalityFixture.claim =
        integrationFinalityFixture.activeClaim
      const boundary = CompletionClaimBoundary.of({
        deleteTaskClaim: () => Effect.sync(() => undefined),
        readTaskClaim: () => Effect.succeed(currentClaim),
        replaceTaskClaim: (request) =>
          Effect.sync(() => {
            currentClaim = request.claim
            return request.claim
          })
      })
      const replacement = RunnableFrontierTransition.ReplacePromotedTaskClaim({
        request: completionClaimReplacementRequestFor(integrationFinalityFixture.claim),
        responsibility: started
      })
      const replacementProposal = proposalsFor(replacement).proposals[0]
      if (replacementProposal === undefined || !isIdentityFreeProposal(replacementProposal)) {
        return yield* Effect.die("missing completion-claim replacement proposal")
      }
      const replacementAction = { _tag: "IdentityFreeAction" as const, proposal: replacementProposal }
      expect(
        yield* executeIntegrationAction(replacementAction, replacement, inertLease).pipe(
          Effect.provideService(InRunJournal, journal),
          Effect.flip
        )
      ).toEqual(new IntegrationFinalityRuntimeUnavailable())
      expect(
        yield* executeIntegrationAction(replacementAction, replacement, inertLease).pipe(
          Effect.provideService(CompletionClaimBoundary, boundary),
          Effect.provideService(InRunJournal, journal)
        )
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: replacementProposal.id })

      const graphPosition = JournalPosition.make((yield* Ref.get(records)).length + 1)
      yield* journal.append(
        integrationFinalityFixture.runId,
        outcomeRecordKey(integrationFinalityFixture.graphOperation.operationId),
        integrationFinalityFixture.graphRecordEvent
      )
      const successObservation = { ...integrationFinalityFixture.successObservation, observedAt: graphPosition }
      const deletion = RunnableFrontierTransition.DeleteCompletedTaskCompletionClaim({
        replacementOperationId: completionClaimReplacementOperationIdFor(integrationFinalityFixture.claim),
        request: completionClaimDeletionRequestFor(integrationFinalityFixture.claim, successObservation),
        responsibility: started
      })
      const deletionProposal = proposalsFor(deletion).proposals[0]
      if (deletionProposal === undefined || !isIdentityFreeProposal(deletionProposal)) {
        return yield* Effect.die("missing completion-claim deletion proposal")
      }
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: deletionProposal },
          deletion,
          inertLease
        ).pipe(Effect.provideService(CompletionClaimBoundary, boundary), Effect.provideService(InRunJournal, journal))
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: deletionProposal.id })
      expect((yield* Ref.get(records)).at(-1)?.event._tag).toBe("IntegrationFinalitySettled")

      const waitingRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([
        {
          event: integrationFinalityFixture.promotionSuccess,
          key: JournalRecordKey.make("integration-finality-action:foreign-promotion"),
          position: JournalPosition.make(1),
          runId: integrationFinalityFixture.runId
        }
      ])
      const waitingJournal = appendableJournalFor(waitingRecords)
      const foreignBoundary = CompletionClaimBoundary.of({
        deleteTaskClaim: () => Effect.die("foreign wait must not delete"),
        readTaskClaim: () =>
          Effect.succeed({
            ...integrationFinalityFixture.activeClaim,
            operationId: OperationId.make("foreign-finality-action-claim")
          }),
        replaceTaskClaim: () => Effect.die("foreign wait must not replace")
      })
      expect(
        yield* executeIntegrationAction(replacementAction, replacement, inertLease).pipe(
          Effect.provideService(CompletionClaimBoundary, foreignBoundary),
          Effect.provideService(InRunJournal, waitingJournal)
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: "CompletionClaimConflict" })

      const unreadableBoundary = CompletionClaimBoundary.of({
        deleteTaskClaim: () => Effect.die("unreadable claim must not be deleted"),
        readTaskClaim: (taskId) =>
          Effect.fail(new CompletionClaimReadFailure({ detail: "tracker claim is unreadable", taskId })),
        replaceTaskClaim: () => Effect.die("unreadable claim must not be replaced")
      })
      expect(
        yield* executeIntegrationAction(replacementAction, replacement, inertLease).pipe(
          Effect.provideService(CompletionClaimBoundary, unreadableBoundary),
          Effect.provideService(InRunJournal, waitingJournal)
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: "CompletionClaimReadUnavailable" })

      const deletionPrefix = (yield* Ref.get(records)).filter(({ event }) =>
        ["TargetPromotionObservedSuccess", "CompletionClaimReplaced", "TaskTrackerFactsObserved"].includes(event._tag)
      )
      const deletionWaitingRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>(deletionPrefix)
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: deletionProposal },
          deletion,
          inertLease
        ).pipe(
          Effect.provideService(CompletionClaimBoundary, unreadableBoundary),
          Effect.provideService(InRunJournal, appendableJournalFor(deletionWaitingRecords))
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: "CompletionClaimReadUnavailable" })
    })
  )

  effectIt.effect("does not admit executor work after an ordinary post-claim read makes the task ineligible", () =>
    Effect.gen(function* () {
      const projected = projectTrackerSnapshot({ revision: "post-claim-ineligible", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die("the empty tracker graph must be valid")
      const claimOperation = makeTaskClaimAcquisitionOperation({
        acquisition: {
          operationId: OperationId.make("post-claim-ineligible-claim"),
          owner: ClaimOwner.make("dalph"),
          taskId,
          token: ClaimToken.make("post-claim-ineligible-token")
        },
        predecessorOperationIds: []
      })
      const step = FreshWorkflowStep.ReadPostClaimGraph({
        claimOperation,
        predecessorOperationId: claimOperation.acquisition.operationId,
        task
      })
      const transition = RunnableFrontierTransition.ContinueFreshWorkflowOperation({
        operationId: claimOperation.acquisition.operationId,
        taskId
      })
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set<OperationId>(),
        fresh: [{ step, transition }],
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (
        proposal === undefined ||
        !isFreshOperationProposal(proposal) ||
        proposal.route._tag !== "FreshWorkflowRoute"
      ) {
        return yield* Effect.die("a fresh post-claim route must be derivable")
      }
      const traceTags = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* executeFreshWorkflowOperation(
        { _tag: "FreshOperationAction", operationId: OperationId.make("post-claim-ineligible-read"), proposal },
        proposal.route,
        inertLease,
        target
      ).pipe(
        Effect.provideService(
          WorkflowInterpreter,
          WorkflowInterpreter.of({
            acquireTaskClaim: () => Effect.die("unused claim acquisition"),
            readTaskClaim: () => Effect.die("unused claim read"),
            readTaskWorktree: () => Effect.die("unused worktree read"),
            readTargetLineage: () => Effect.die("unused lineage read"),
            readTrackerGraph: () => Effect.succeed(projected.snapshot),
            readTaskWorkSpecification: () => Effect.die("unused specification read"),
            reconcileTaskWorktree: () => Effect.die("unused worktree reconciliation"),
            recordTaskAttemptPlan: () => Effect.die("unused attempt planning"),
            releaseTaskClaim: () => Effect.die("unused claim release")
          })
        ),
        Effect.provideService(
          WorkflowTrace,
          WorkflowTrace.of({ emit: (item) => Ref.update(traceTags, (current) => [...current, item._tag]) })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unused claim planning") })
        )
      )

      expect(result).toEqual({ _tag: "ActionCompleted", proposalId: proposal.id })
      expect(yield* Ref.get(traceTags)).not.toContain("TrackerExecutionAdmitted")
    })
  )

  effectIt.effect("retains the task position while a continued executor still reports running", () =>
    Effect.gen(function* () {
      const transition = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
        acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
        plannedAttempt
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing continued executor proposal")
      }
      const releases = yield* Ref.make(0)
      const lease: DeliveryActionExecutionLease = {
        ...inertLease,
        releasePlannedAttemptPosition: () => Ref.update(releases, (count) => count + 1)
      }
      const correlation = { attemptId: plannedAttempt.attemptId, runId }
      const report = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
      const result = yield* executePlannedAttemptTransition(
        { _tag: "IdentityFreeAction", proposal },
        transition,
        lease
      ).pipe(
        Effect.provideService(
          InRunJournal,
          InRunJournal.of({
            append: (_runId, key, event) => Effect.succeed({ event, key, position: JournalPosition.make(100), runId }),
            read: () => Effect.succeed([])
          })
        ),
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            project: () => Effect.succeed(Option.none()),
            requestSuspension: () => Effect.die("suspension was not requested"),
            startOrContinue: () => Effect.succeed(report)
          })
        )
      )

      expect(result._tag).toBe("ExecutorReportPublished")
      if (result._tag !== "ExecutorReportPublished") return yield* Effect.die("executor report was not published")
      expect(result.report).toEqual(report)
      expect(yield* Ref.get(releases)).toBe(0)
    })
  )

  effectIt.effect("routes every recovered observation and reconciliation variant through its exact adapter", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const record = (name: string) =>
        Ref.update(calls, (current) => [...current, name]).pipe(Effect.as(undefined as never))
      const interpreter = WorkflowInterpreter.of({
        acquireTaskClaim: () => record("acquireTaskClaim"),
        readTaskClaim: () => record("readTaskClaim"),
        readTaskWorktree: () => record("readTaskWorktree"),
        readTargetLineage: () => record("readTargetLineage"),
        readTrackerGraph: () => record("readTrackerGraph"),
        readTaskWorkSpecification: () => record("readTaskWorkSpecification"),
        reconcileTaskWorktree: () => record("reconcileTaskWorktree"),
        recordTaskAttemptPlan: () => record("recordTaskAttemptPlan"),
        releaseTaskClaim: () => record("releaseTaskClaim")
      })
      const withAdapterServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideService(
            InRunJournal,
            InRunJournal.of({ append: () => Effect.die("unused append"), read: () => Effect.succeed([]) })
          ),
          Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
          Effect.provideService(
            TaskClaimAcquisitionPlanner,
            TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unused claim planner") })
          ),
          Effect.provideService(
            PlannedAttemptExecutor,
            PlannedAttemptExecutor.of({
              project: () => Effect.succeed(Option.none()),
              requestSuspension: () => Effect.die("unused executor suspension"),
              startOrContinue: () => Effect.die("unused executor continuation")
            })
          ),
          Effect.provideService(WorkflowInterpreter, interpreter)
        )
      const graphOperation = makeTrackerGraphObservationOperation(OperationId.make("adapter-observe-graph"), target)
      const specificationOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("adapter-observe-specification"),
        target,
        taskId
      )
      const claimOperation = makeTaskClaimObservationOperation(
        OperationId.make("adapter-observe-claim"),
        target,
        taskId
      )
      const worktreeOperation = makeTaskWorktreeObservationOperation({
        operationId: OperationId.make("adapter-observe-worktree"),
        plannedAttempt,
        predecessorOperationIds: []
      })
      const lineageOperation = makeTargetLineageObservationOperation({
        integrationTarget,
        operationId: OperationId.make("adapter-observe-lineage"),
        plannedAttempt,
        predecessorOperationIds: []
      })
      const observations = [
        RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
          operation: graphOperation,
          plannedAttempt
        }),
        RunnableFrontierTransition.ObservePlannedAttemptContinuationSpecification({
          operation: specificationOperation,
          plannedAttempt
        }),
        RunnableFrontierTransition.ObservePlannedAttemptContinuationClaim({
          operation: claimOperation,
          plannedAttempt
        }),
        RunnableFrontierTransition.ObserveResponsibleTaskClaim({ operation: claimOperation, taskId }),
        RunnableFrontierTransition.ObservePlannedAttemptContinuationWorktree({
          operation: worktreeOperation,
          plannedAttempt
        }),
        RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
          operation: lineageOperation,
          plannedAttempt
        })
      ] as const

      for (const transition of observations) {
        const fresh = proposalsFor(transition).proposals[0]
        if (fresh?.route._tag !== "RecoveredNewActionRoute") {
          return yield* Effect.die(new Error(`missing fresh adapter route for ${transition._tag}`))
        }
        yield* withAdapterServices(
          executeNewRecoveredAction(fresh.route.action, OperationId.make(`fresh:${transition._tag}`), inertLease, runId)
        )
        yield* withAdapterServices(executeAcceptedWorkflowAction(runId, transition))
      }

      const recoveryOperationId = OperationId.make("adapter-recovery-operation")
      for (const transition of [
        RunnableFrontierTransition.CheckTaskClaim({ operationId: recoveryOperationId, taskId }),
        RunnableFrontierTransition.ReconcileTaskClaim({ operationId: recoveryOperationId, taskId }),
        RunnableFrontierTransition.ReconcileTaskClaimRelease({ operationId: recoveryOperationId, taskId }),
        RunnableFrontierTransition.ReconcileTaskWorktree({ operationId: recoveryOperationId, taskId })
      ]) {
        yield* withAdapterServices(executeAcceptedWorkflowAction(runId, transition))
      }

      const acceptedTransition = RunnableFrontierTransition.CheckTaskClaim({ operationId: recoveryOperationId, taskId })
      const acceptedProposal = proposalsFor(acceptedTransition, new Set([recoveryOperationId])).proposals[0]
      if (acceptedProposal === undefined || !isAcceptedIdentityProposal(acceptedProposal)) {
        return yield* Effect.die("missing accepted live-dispatch proposal")
      }
      const acceptedAction = { _tag: "AcceptedOperationAction" as const, proposal: acceptedProposal }
      const directExecutor = yield* withAdapterServices(
        makeLiveDeliveryActionExecutor(runId, target).pipe(
          Effect.provideService(
            DeliveryAcceptedFactPublication,
            DeliveryAcceptedFactPublication.of({ awaitCurrent: Effect.void })
          )
        )
      )
      expect(yield* directExecutor.execute(acceptedAction, inertLease)).toMatchObject({
        _tag: "ActionCompleted",
        proposalId: acceptedProposal.id
      })
      const layeredExecutor = yield* withAdapterServices(
        DeliveryActionExecutor.pipe(
          Effect.provide(liveDeliveryActionExecutorLayer(runId, target)),
          Effect.provideService(
            DeliveryAcceptedFactPublication,
            DeliveryAcceptedFactPublication.of({ awaitCurrent: Effect.void })
          )
        )
      )
      expect(yield* layeredExecutor.execute(acceptedAction, inertLease)).toMatchObject({
        _tag: "ActionCompleted",
        proposalId: acceptedProposal.id
      })

      const release = makeTaskClaimReleaseOperation({
        authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
        predecessorOperationIds: [activeClaim.operationId],
        release: { claim: activeClaim, operationId: OperationId.make("adapter-release-placeholder") }
      })
      const releaseProposal = proposalsFor(
        RunnableFrontierTransition.ReleaseExternallyCompletedTaskClaim({ operation: release, plannedAttempt })
      ).proposals[0]
      if (releaseProposal?.route._tag !== "RecoveredNewActionRoute") {
        return yield* Effect.die(new Error("missing external release adapter route"))
      }
      yield* withAdapterServices(
        executeNewRecoveredAction(releaseProposal.route.action, OperationId.make("adapter-release"), inertLease, runId)
      )

      const reacquisitionProposal = proposalsFor(
        RunnableFrontierTransition.CommitTaskClaimReacquisitionIntent({
          plannedAttempt,
          requestId: TaskClaimReacquisitionRequestId.make("adapter-reacquisition"),
          taskId
        })
      ).proposals[0]
      if (reacquisitionProposal?.route._tag !== "RecoveredNewActionRoute") {
        return yield* Effect.die(new Error("missing reacquisition adapter route"))
      }
      yield* executeNewRecoveredAction(
        reacquisitionProposal.route.action,
        OperationId.make("adapter-reacquisition-operation"),
        inertLease,
        runId
      ).pipe(
        Effect.provideService(
          InRunJournal,
          InRunJournal.of({ append: () => Effect.die("unused append"), read: () => Effect.succeed([]) })
        ),
        Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({
            plan: (operationId, selectedTaskId) =>
              Effect.succeed({
                operationId,
                owner: ClaimOwner.make("dalph"),
                taskId: selectedTaskId,
                token: ClaimToken.make("adapter-reacquisition-token")
              })
          })
        ),
        Effect.provideService(WorkflowInterpreter, interpreter)
      )

      expect(yield* Ref.get(calls)).toEqual([
        "readTrackerGraph",
        "readTrackerGraph",
        "readTaskWorkSpecification",
        "readTaskWorkSpecification",
        "readTaskClaim",
        "readTaskClaim",
        "readTaskClaim",
        "readTaskClaim",
        "readTaskWorktree",
        "readTaskWorktree",
        "readTargetLineage",
        "readTargetLineage",
        "releaseTaskClaim",
        "acquireTaskClaim"
      ])
    })
  )
})
