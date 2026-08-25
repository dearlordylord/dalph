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
  WorktreeLocator
} from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import {
  makeIntegrationTargetResourceController,
  type IntegrationTargetResourceController
} from "../admission/integration-target-resource.js"
import { deliveryProposalsOf } from "./delivery-proposal-derivation.js"
import type { IdentityFreeDeliveryProposal } from "./delivery-action-proposal.js"
import { makeDeliveryRuntimeAdmissionController } from "./delivery-runtime-admission.js"
import { dispatchRecoveredIntegrationAction } from "./recovered-integration-dispatcher.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import {
  IntegratorCandidateText,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate
} from "../../workflow/protocols/integrator/events.js"
import {
  IntegratorPreparationInput,
  integratorCorrelationFor,
  integratorRunCorrelationForSession
} from "../../workflow/protocols/integrator/session.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { AttemptChoiceRequestId } from "../../workflow/protocols/attempt-choice/events.js"

const runId = RunId.make("recovered-integration-dispatcher-test")
const taskId = TaskId.make("recovered-integration-dispatcher-task")
const integrationTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/recovered-integration-dispatcher.git")
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("recovered-integration-dispatcher-attempt"),
  baseSha: GitCommitSha.make("a".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/recovered-integration-dispatcher"),
  executor: TaskExecutorLocator.make("executor:recovered-integration-dispatcher"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("recovered-integration-dispatcher-revision"),
  worktree: WorktreeLocator.make("/worktrees/recovered-integration-dispatcher")
})
const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult: acceptedResultFixture(GitCommitSha.make("c".repeat(40))),
  integrationTarget,
  plannedAttempt,
  queuedAt: JournalPosition.make(1),
  startedAt: JournalPosition.make(2)
})
const target = FixtureTarget.make("recovered-integration-dispatcher-target")

const proposalFor = (
  transition: RunnableFrontierTransition,
  integrationResponsibilities: ReadonlyArray<StartedIntegrationResponsibility> = [responsibility]
): IdentityFreeDeliveryProposal => {
  const derived = deliveryProposalsOf({
    acceptedOperationIds: new Set(),
    fresh: [],
    integrationResponsibilities,
    responsibilities: [],
    runId,
    transitions: [transition]
  })
  const proposal = [...derived.deliverySettlement, ...derived.ticketDelivery][0]
  return proposal !== undefined && proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"
    ? proposal
    : expect.fail("recovered dispatcher fixture did not derive an identity-free proposal")
}

const makeDispatcher = Effect.fn("RecoveredIntegrationDispatcherTest.makeDispatcher")(function* (
  resources: IntegrationTargetResourceController
) {
  const lifecycle = yield* makeApplicationExitLifecycle()
  const admission = yield* makeDeliveryRuntimeAdmissionController(
    { capacity: TaskWorkCapacity.make(1), held: [] },
    resources,
    lifecycle.admission
  ).pipe(Effect.provide(plannedAttemptProtocolControllerLayer))
  return { admission, integrationTargets: resources, lifecycle }
})

const acquireTransition = RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })
const releaseTransition = RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })

const promotionTransition = (() => {
  const targetLineage = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: plannedAttempt.baseSha,
    targetHeadSha: GitCommitSha.make("b".repeat(40))
  })
  const session = integratorCorrelationFor(
    IntegratorPreparationInput.make({ responsibility, targetLineage, targetLineageObservedAt: JournalPosition.make(3) })
  )
  const run = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(1))
  const candidate = IntegratorRunQualifiedCandidate.make({
    candidateCommit: GitCommitSha.make("d".repeat(40)),
    candidateText: IntegratorCandidateText.make("refs/heads/recovered-integration-dispatcher-candidate"),
    directParents: [session.expectedTargetHead, session.acceptedResult.commit],
    qualifiedAt: JournalPosition.make(4),
    run
  })
  return RunnableFrontierTransition.RunTargetPromotion({ candidate, responsibility })
})()

it.effect("owns recovered integration admission through success, deferral, and adapter failure", () =>
  Effect.gen(function* () {
    const resources = yield* makeIntegrationTargetResourceController()
    const dispatcher = yield* makeDispatcher(resources)

    const acquired = yield* dispatchRecoveredIntegrationAction(proposalFor(acquireTransition), target, dispatcher)
    expect(acquired._tag).toBe("ActionCompleted")
    expect((yield* resources.snapshot).heldResponsibilityPositions).toEqual(new Set([responsibility.queuedAt]))
    const afterAcquireLifecycle = yield* dispatcher.lifecycle.admission.snapshot
    expect(afterAcquireLifecycle.registeredOwnerCount).toBe(0)

    const deferred = yield* dispatchRecoveredIntegrationAction(
      proposalFor(
        RunnableFrontierTransition.AcquireStartedIntegrationTarget({
          responsibility: { ...responsibility, queuedAt: JournalPosition.make(3) }
        }),
        [responsibility, { ...responsibility, queuedAt: JournalPosition.make(3) }]
      ),
      target,
      dispatcher
    ).pipe(Effect.exit)
    expect(deferred._tag).toBe("Failure")
    const afterDeferredLifecycle = yield* dispatcher.lifecycle.admission.snapshot
    expect(afterDeferredLifecycle.registeredOwnerCount).toBe(0)

    const failedPromotion = yield* dispatchRecoveredIntegrationAction(
      proposalFor(promotionTransition),
      target,
      dispatcher
    ).pipe(Effect.exit)
    expect(failedPromotion._tag).toBe("Failure")
    if (Exit.isFailure(failedPromotion)) {
      expect(failedPromotion.cause).toBeDefined()
    }
    const afterFailureLifecycle = yield* dispatcher.lifecycle.admission.snapshot
    expect(afterFailureLifecycle.registeredOwnerCount).toBe(0)

    const released = yield* dispatchRecoveredIntegrationAction(proposalFor(releaseTransition), target, dispatcher)
    expect(released._tag).toBe("ActionCompleted")
    expect((yield* resources.snapshot).heldResponsibilityPositions).toEqual(new Set())
    const afterReleaseLifecycle = yield* dispatcher.lifecycle.admission.snapshot
    expect(afterReleaseLifecycle.registeredOwnerCount).toBe(0)
  })
)

it.effect("settles the forward owner when adapter cleanup itself fails", () =>
  Effect.gen(function* () {
    const completeResources = yield* makeIntegrationTargetResourceController()
    const completeDispatcher = yield* makeDispatcher(completeResources)
    const completeFailureDispatcher = {
      ...completeDispatcher,
      admission: { ...completeDispatcher.admission, complete: () => Effect.die("controlled complete cleanup failure") }
    }
    const completeResult = yield* dispatchRecoveredIntegrationAction(
      proposalFor(acquireTransition),
      target,
      completeFailureDispatcher
    ).pipe(Effect.exit)
    expect(completeResult._tag).toBe("Failure")
    expect((yield* completeDispatcher.lifecycle.admission.snapshot).registeredOwnerCount).toBe(0)

    const rollbackResources = yield* makeIntegrationTargetResourceController()
    const rollbackDispatcher = yield* makeDispatcher(rollbackResources)
    yield* rollbackResources.acquire(responsibility)
    const rollbackFailureDispatcher = {
      ...rollbackDispatcher,
      admission: { ...rollbackDispatcher.admission, rollback: () => Effect.die("controlled rollback cleanup failure") }
    }
    const rollbackResult = yield* dispatchRecoveredIntegrationAction(
      proposalFor(promotionTransition),
      target,
      rollbackFailureDispatcher
    ).pipe(Effect.exit)
    expect(rollbackResult._tag).toBe("Failure")
    expect((yield* rollbackDispatcher.lifecycle.admission.snapshot).registeredOwnerCount).toBe(0)
  })
)

it.effect("rejects a recovered action whose route is not an integration transition", () =>
  Effect.gen(function* () {
    const resources = yield* makeIntegrationTargetResourceController()
    const dispatcher = yield* makeDispatcher(resources)
    const invalid = proposalFor(acquireTransition)
    const action = {
      ...invalid,
      route: {
        _tag: "IdentityFreeWorkflowRoute" as const,
        transition: RunnableFrontierTransition.AdvanceAttemptRestart({
          integrationTarget,
          plannedAttempt,
          requestId: AttemptChoiceRequestId.make({ nonce: "foreign-restart-request", runId }),
          subject: { plannedAttempt, observedTaskRevision: TaskRevision.make("foreign-restart-revision") }
        })
      }
    }
    const result = yield* dispatchRecoveredIntegrationAction(action, target, dispatcher).pipe(Effect.exit)
    expect(result._tag).toBe("Failure")
    const afterInvalidLifecycle = yield* dispatcher.lifecycle.admission.snapshot
    expect(afterInvalidLifecycle.registeredOwnerCount).toBe(0)
  })
)
