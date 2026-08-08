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
import { Option } from "effect"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { TaskLifecycle, TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { projectTrackerSnapshot } from "../../../authorities/task-tracker/graph.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"
import { makeTaskAttemptPlanOperation, makeTrackerGraphObservationOperation } from "../../registry/operation.js"
import { TaskAttemptPlannedEvent, TaskClaimAcquiredEvent } from "../../registry/event.js"
import {
  IntegrationCandidateCorrelation,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId
} from "../integration-candidate-construction/events.js"
import {
  TargetPromotionCorrelation,
  TargetPromotionAttemptOrdinal,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionRequestId,
  TargetPromotionSuccessObservation
} from "../target-promotion/events.js"
import { TargetVerificationPlanId, TargetVerificationRequestId } from "../target-verification/events.js"
import { EvidenceDigest, EvidenceReference } from "../target-verification/evidence-store.js"
import { CompletionTaskClaim, FreshCompletedTaskObservation } from "./events.js"

/** Shared exact identities used by the focused completion-finality tests. */
export const integrationFinalityFixture = (() => {
  const gitShaLength = 40
  const constructedPosition = 10
  const evidenceDigestLength = 64
  const freshObservationPosition = 3
  const runId = RunId.make("integration-finality-test-run")
  const taskId = TaskId.make("integration-finality-task")
  const target = FixtureTarget.make("integration-finality-target")
  const integrationTarget = IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("/repositories/integration-finality.git")
  })
  const expectedTargetHead = GitCommitSha.make("1".repeat(gitShaLength))
  const acceptedResultCommit = GitCommitSha.make("2".repeat(gitShaLength))
  const candidateCommit = GitCommitSha.make("3".repeat(gitShaLength))
  const candidateCorrelation = IntegrationCandidateCorrelation.make({
    acceptedResultCommit,
    attemptId: AttemptId.make("integration-finality-attempt"),
    candidateId: IntegrationCandidateId.make("integration-finality-candidate"),
    candidateResource: IntegrationCandidateResourceLocator.make("/candidate/integration-finality"),
    expectedTargetHead,
    integrationSessionId: IntegrationSessionId.make("integration-finality-session"),
    integrationTarget,
    runId
  })
  const verificationCorrelation = {
    candidateCommit,
    candidateCorrelation,
    candidateConstructedAt: JournalPosition.make(constructedPosition),
    planId: TargetVerificationPlanId.make("integration-finality-plan"),
    requestId: TargetVerificationRequestId.make("integration-finality-verification")
  }
  const promotionCorrelation = TargetPromotionCorrelation.make({
    candidateCommit,
    candidateConstructedAt: JournalPosition.make(constructedPosition),
    candidateCorrelation,
    expectedTargetHead,
    integrationTarget,
    requestId: TargetPromotionRequestId.make(`target-promotion:${candidateCorrelation.candidateId}`),
    verificationCorrelation,
    verificationManifest: EvidenceReference.make({
      byteLength: 19,
      digest: EvidenceDigest.make("a".repeat(evidenceDigestLength))
    })
  })
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: candidateCorrelation.attemptId,
    baseSha: expectedTargetHead,
    branch: TaskBranchRef.make("refs/heads/dalph/integration-finality"),
    executor: TaskExecutorLocator.make("executor:integration-finality"),
    runId,
    taskId,
    taskRevision: TaskRevision.make("planned-task-revision"),
    worktree: WorktreeLocator.make("/worktrees/integration-finality")
  })
  const activeClaim = ActiveTaskClaim.make({
    operationId: OperationId.make("integration-finality-active-claim"),
    owner: ClaimOwner.make("dalph:integration-finality"),
    taskId,
    token: ClaimToken.make("integration-finality-token")
  })
  const claim = CompletionTaskClaim.make({ originalClaim: activeClaim, plannedAttempt, promotionCorrelation })
  const promotionSuccess = TargetPromotionObservedSuccessEvent.make({
    basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) },
    correlation: promotionCorrelation,
    observation: TargetPromotionSuccessObservation.cases.CompareAndSetApplied.make({
      candidateAncestry: "Current",
      targetHeadSha: candidateCommit
    }),
    version: workflowJournalEventVersion
  })
  const graphOperation = makeTrackerGraphObservationOperation(
    OperationId.make("integration-finality-fresh-success"),
    target,
    [],
    [taskId]
  )
  const trackerRevision = TrackerRevision.make("fresh-tracker-revision")
  const projected = projectTrackerSnapshot({
    revision: trackerRevision,
    tasks: [
      {
        id: taskId,
        lifecycle: TaskLifecycle.cases.CompletedSuccessfully.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
    ]
  })
  /* v8 ignore next -- @preserve The fixed acyclic single-task fixture is valid by construction; projection failure would be a fixture defect. */
  const snapshot = Option.getOrThrow(projected._tag === "Valid" ? Option.some(projected.snapshot) : Option.none())
  const graphObservation = makeCompleteTaskTrackerFactsObserved(graphOperation, snapshot)
  const successObservation = FreshCompletedTaskObservation.make({
    lifecycle: "CompletedSuccessfully",
    observedAt: JournalPosition.make(freshObservationPosition),
    operationId: graphOperation.operationId,
    taskId,
    trackerRevision
  })
  return {
    activeClaim,
    claim,
    graphObservation,
    graphSnapshot: snapshot,
    graphOperation,
    graphRecordEvent: TaskTrackerFactsObservedEvent.make({
      observation: graphObservation,
      operationId: graphOperation.operationId,
      version: workflowJournalEventVersion
    }),
    integrationTarget,
    plannedAttempt,
    planOperation: makeTaskAttemptPlanOperation({
      operationId: OperationId.make("integration-finality-plan-attempt"),
      plannedAttempt,
      predecessorOperationIds: [activeClaim.operationId]
    }),
    promotionCorrelation,
    promotionSuccess,
    runId,
    successObservation,
    target,
    taskId,
    trackerRevision,
    verificationCorrelation
  }
})()

/** Prefix records shared by protocol tests before a fresh graph observation. */
export const promotionRecordEvent = integrationFinalityFixture.promotionSuccess

/** Exact prior plan/claim records required by the chronology validator. */
export const prerequisiteRecordEvents = [
  TaskClaimAcquiredEvent.make({ claim: integrationFinalityFixture.activeClaim, version: workflowJournalEventVersion }),
  TaskAttemptPlannedEvent.make({
    operation: integrationFinalityFixture.planOperation,
    version: workflowJournalEventVersion
  })
] as const
