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
  makeFocusedTaskCompletionFactsObserved,
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent,
  TaskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"
import {
  makeCompletionTaskFactsObservationOperation,
  makeTaskAttemptPlanOperation,
  makeTrackerGraphObservationOperation
} from "../../registry/operation.js"
import { taskTrackerReadIntent, TaskAttemptPlannedEvent, TaskClaimAcquiredEvent } from "../../registry/event.js"
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
import {
  CompletionTaskClaim,
  CompletionTaskConfirmationReadOrdinal,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskRequestOrdinal,
  completionTaskRequestFor,
  FocusedCompletedTaskObservation,
  FocusedTaskCompletionFacts
} from "./events.js"

/** Shared exact identities used by the focused completion-finality tests. */
export const integrationFinalityFixture = (() => {
  const gitShaLength = 40
  const constructedPosition = 10
  const evidenceDigestLength = 64
  const focusedObservationPosition = 3
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
  const acceptanceManifest = EvidenceReference.make({
    byteLength: 17,
    digest: EvidenceDigest.make("b".repeat(evidenceDigestLength))
  })
  const reviewManifest = EvidenceReference.make({
    byteLength: 18,
    digest: EvidenceDigest.make("c".repeat(evidenceDigestLength))
  })
  const verificationManifest = EvidenceReference.make({
    byteLength: 19,
    digest: EvidenceDigest.make("a".repeat(evidenceDigestLength))
  })
  const candidateCorrelation = IntegrationCandidateCorrelation.make({
    acceptanceManifest,
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
    acceptanceManifest,
    candidateCommit,
    candidateConstructedAt: JournalPosition.make(constructedPosition),
    candidateCorrelation,
    expectedTargetHead,
    integrationTarget,
    reviewManifest,
    requestId: TargetPromotionRequestId.make(`target-promotion:${candidateCorrelation.candidateId}`),
    verificationCorrelation,
    verificationManifest
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
  const claim = CompletionTaskClaim.make({
    acceptanceManifest,
    integrationReviewManifest: reviewManifest,
    originalClaim: activeClaim,
    plannedAttempt,
    promotionCorrelation,
    verificationManifest
  })
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
  const completionRequest = completionTaskRequestFor(claim)
  const focusedSuccessPurpose = CompletionTaskFocusedReadPurpose.cases.Confirmation.make({
    attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
    confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(1)
  })
  const focusedSuccessOperation = makeCompletionTaskFactsObservationOperation(
    completionRequest,
    target,
    focusedSuccessPurpose
  )
  const focusedSuccessOperationId = focusedSuccessOperation.operationId
  const focusedSuccessFacts = FocusedTaskCompletionFacts.make({
    currentClaim: claim,
    lifecycle: "CompletedSuccessfully",
    operationId: focusedSuccessOperationId,
    target,
    targetMembership: "Member",
    taskId,
    taskRevision: plannedAttempt.taskRevision,
    trackerRevision,
    unfinishedPrerequisiteTaskIds: []
  })
  const focusedSuccessFactsObservation = makeFocusedTaskCompletionFactsObserved(
    focusedSuccessOperation,
    focusedSuccessFacts
  )
  const focusedSuccessFactsEvent = {
    ...taskTrackerFactsObservedEvent(focusedSuccessOperationId, focusedSuccessFactsObservation),
    observation: focusedSuccessFactsObservation
  }
  const successObservation = FocusedCompletedTaskObservation.make({
    claim,
    lifecycle: "CompletedSuccessfully",
    observedAt: JournalPosition.make(focusedObservationPosition),
    operationId: focusedSuccessOperationId,
    taskId,
    taskRevision: plannedAttempt.taskRevision,
    target,
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
    completionRequest,
    focusedSuccessFactsReadIntentEvent: taskTrackerReadIntent(focusedSuccessOperation),
    focusedSuccessFactsEvent,
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
