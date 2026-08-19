import {
  AttemptId,
  AcceptedResult,
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
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  IntegratorSessionId
} from "../integrator/events.js"
import {
  TargetPromotionAttemptOrdinal,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionSuccessObservation,
  targetPromotionCorrelationFor
} from "../target-promotion/events.js"
import { EvidenceDigest, EvidenceReference } from "../evidence-store.js"
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
  const integratorQueuedPosition = 5
  const integratorStartedPosition = 8
  const targetLineageObservedPosition = 9
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
  const acceptedResultEvidence = EvidenceReference.make({
    byteLength: 17,
    digest: EvidenceDigest.make("b".repeat(evidenceDigestLength))
  })
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("integration-finality-attempt"),
    baseSha: expectedTargetHead,
    branch: TaskBranchRef.make("refs/heads/dalph/integration-finality"),
    executor: TaskExecutorLocator.make("executor:integration-finality"),
    runId,
    taskId,
    taskRevision: TaskRevision.make("planned-task-revision"),
    worktree: WorktreeLocator.make("/worktrees/integration-finality")
  })
  const acceptedResult = AcceptedResult.make({ commit: acceptedResultCommit, evidenceManifest: acceptedResultEvidence })
  const integratorSession = {
    acceptedResult,
    candidateResource: IntegratorCandidateResourceLocator.make("/candidate/integration-finality"),
    expectedTargetHead,
    integrationTarget,
    plannedAttempt,
    queuedAt: JournalPosition.make(integratorQueuedPosition),
    sessionId: IntegratorSessionId.make("integration-finality-session"),
    startedAt: JournalPosition.make(integratorStartedPosition),
    targetLineageObservedAt: JournalPosition.make(targetLineageObservedPosition)
  }
  const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
    candidateCommit,
    candidateText: IntegratorCandidateText.make("refs/heads/integration-finality-candidate"),
    directParents: [expectedTargetHead, acceptedResultCommit],
    qualifiedAt: JournalPosition.make(constructedPosition),
    run: { ordinal: IntegratorRunOrdinal.make(1), session: integratorSession }
  })
  const promotionCorrelation = targetPromotionCorrelationFor(qualifiedCandidate)
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
    qualifiedCandidate
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
