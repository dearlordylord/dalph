import type {
  AuthoredCassetteStoryItem,
  AuthoredOrchestrationEvidence,
  AuthoredProtocolEvidence,
  AuthoredScenarioCassette,
  AuthoredTaskWorkResult
} from "./authored-domain.js"

const taskWorkResultLyric = (result: AuthoredTaskWorkResult): string => {
  switch (result._tag) {
    case "PlannedWorkForTaskAccepted":
      return `The story expects task ${result.taskId} to produce accepted commit ${result.commit}.`
    case "PlannedWorkForTaskCompleted":
      return `The story expects the planned work for task ${result.taskId} to complete.`
    case "PlannedWorkForTaskFailed":
      return `The story expects the planned work for task ${result.taskId} to fail.`
  }
}

type AuthoredTargetPromotionEvidence = Extract<
  AuthoredOrchestrationEvidence,
  { readonly _tag: "TargetPromotionSucceeded" | "TargetPromotionNonConvergent" | "TargetPromotionStale" }
>

const isTargetPromotionEvidence = (
  evidence: AuthoredOrchestrationEvidence
): evidence is AuthoredTargetPromotionEvidence => evidence._tag.startsWith("TargetPromotion")

const targetPromotionEvidenceLyric = (evidence: AuthoredTargetPromotionEvidence): string => {
  switch (evidence._tag) {
    case "TargetPromotionSucceeded":
      return `The story expects ${evidence.basis._tag} to establish candidate ${evidence.candidateCommit} on target head ${evidence.observedTargetHead} by ${evidence.observation}.`
    case "TargetPromotionNonConvergent":
      return `The story expects candidate ${evidence.candidateCommit} to stop after attempt ${evidence.attemptOrdinal} with ${evidence.lastObservation}.`
    case "TargetPromotionStale":
      return `The story expects Git to preserve head ${evidence.observedTargetHead} instead of replacing it with stale candidate ${evidence.candidateCommit}.`
  }
}

type AuthoredTargetVerificationEvidence = Extract<
  AuthoredOrchestrationEvidence,
  { readonly _tag: "TargetVerificationPassed" | "TargetVerificationStopped" }
>

const isTargetVerificationEvidence = (
  evidence: AuthoredOrchestrationEvidence
): evidence is AuthoredTargetVerificationEvidence => evidence._tag.startsWith("TargetVerification")

const targetVerificationEvidenceLyric = (evidence: AuthoredTargetVerificationEvidence): string =>
  evidence._tag === "TargetVerificationPassed"
    ? `The story expects public verification plan ${evidence.planId} to pass candidate ${evidence.candidateCommit} for task ${evidence.taskId}.`
    : `The story expects public verification plan ${evidence.planId} to stop candidate ${evidence.candidateCommit} with ${evidence.outcome} for task ${evidence.taskId}.`

const orchestrationEvidenceLyric = (evidence: AuthoredOrchestrationEvidence): string => {
  if (isTargetPromotionEvidence(evidence)) return targetPromotionEvidenceLyric(evidence)
  if (isTargetVerificationEvidence(evidence)) return targetVerificationEvidenceLyric(evidence)
  switch (evidence._tag) {
    case "AcceptedResultIntegrationResponsibilityBegan":
      return `The story expects Dalph to queue accepted commit ${evidence.commit} from attempt ${evidence.attemptId}.`
    case "AcceptedResultIntegrationStarted":
      return `The story expects Dalph to start integrating accepted commit ${evidence.commit} from attempt ${evidence.attemptId}.`
    case "IntegrationCandidateConstructed":
      return `The story expects candidate ${evidence.candidateCommit} to have target ${evidence.expectedTargetHead} first and accepted result ${evidence.acceptedResultCommit} second.`
    case "PlannedAttemptExecutorWorkResponsibilityBegan":
      return `The story expects Dalph to assume executor-work responsibility for task ${evidence.taskId}, attempt ${evidence.attemptId}.`
    case "PlannedAttemptExecutorWorkReported":
      return `The story expects executor report ${evidence.report} for attempt ${evidence.attemptId}.`
  }
}

// eslint-disable-next-line complexity -- Every closed protocol-evidence variant owns one maintainer-readable sentence.
const protocolEvidenceLyric = (evidence: AuthoredProtocolEvidence): string => {
  switch (evidence._tag) {
    case "AttemptChoiceApplied":
      return `The story expects Operator to apply ${evidence.choice} to task ${evidence.taskId}, attempt ${evidence.attemptId}, at authored revision ${evidence.observedTaskRevision}.`
    case "AttemptImplementationAbandoned":
      return `The story expects Dalph to abandon implementation responsibility for task ${evidence.taskId}, attempt ${evidence.attemptId}.`
    case "AttemptWorktreeLost":
      return `The story expects Git to report the planned worktree lost for task ${evidence.taskId}, attempt ${evidence.attemptId}.`
    case "CompatibleTargetAdvance":
      return `The story expects Git to prove target ${evidence.targetHeadSha} descends from Base ${evidence.plannedBaseSha} for task ${evidence.taskId}.`
    case "ControlDirectionApplied":
      return `The story expects Operator to apply ${evidence.direction} to ${
        evidence.subject._tag === "Run" ? "the Run" : `task ${evidence.subject.taskId}`
      }.`
    case "IncompatibleTargetRewrite":
      return `The story expects Git to prove target ${evidence.targetHeadSha} is outside Base ${evidence.plannedBaseSha} for task ${evidence.taskId}.`
    case "TaskClaimAcquired":
      return `The story expects Dalph to acquire the claim for task ${evidence.taskId}.`
    case "TaskClaimReleased":
      return `The story expects Dalph to release its exact claim for task ${evidence.taskId}.`
    case "TaskClaimObserved":
      return `The story expects Dalph to record ${evidence.claimState.toLowerCase()} claim authority for task ${evidence.taskId}.`
    case "TaskClaimReadExhausted":
      return `The story expects Dalph to exhaust the bounded claim read for task ${evidence.taskId}.`
    case "TaskClaimReacquisitionDirected":
      return `The story expects Operator request ${evidence.requestId} to direct Dalph to reacquire the claim for task ${evidence.taskId}.`
    case "TaskAttemptPlanned":
      return `The story expects Dalph to plan attempt ${evidence.attemptId} for task ${evidence.taskId}.`
    case "TaskWorktreeReady":
      return `The story expects the worktree for task ${evidence.taskId}, attempt ${evidence.attemptId}, to become ready.`
    case "StoppedAttemptClaimNoReleaseObserved":
      return `The story expects Dalph to preserve the ${evidence.claimState.toLowerCase()} claim state for stopped task ${evidence.taskId}.`
  }
}

const expectedBehaviorLyric = (item: Extract<AuthoredCassetteStoryItem, { readonly _tag: "ExpectedBehavior" }>) =>
  [
    ...item.taskWork.results.map(taskWorkResultLyric),
    ...item.taskWork.absences.map(
      ({ taskId }) =>
        `The story expects Dalph not to assume executor-work responsibility for any planned attempt belonging to task ${taskId}.`
    ),
    ...(item.orchestration === null ? [] : item.orchestration.map(orchestrationEvidenceLyric)),
    ...(item.protocol === null ? [] : item.protocol.map(protocolEvidenceLyric))
  ].join("\n")

type AuthoredTrackerGraphStoryItem = Extract<
  AuthoredCassetteStoryItem,
  { readonly _tag: "TrackerGraphReadFailed" | "TrackerGraphReadReturned" }
>

const isTrackerGraphStoryItem = (item: AuthoredCassetteStoryItem): item is AuthoredTrackerGraphStoryItem =>
  item._tag === "TrackerGraphReadReturned" || item._tag === "TrackerGraphReadFailed"

const trackerGraphLyric = (item: AuthoredTrackerGraphStoryItem): string =>
  item._tag === "TrackerGraphReadReturned"
    ? `The task tracker returns ${item.graph.tasks.length} task graph facts at ${item.graph.revision}.`
    : `The task tracker fails the logical graph read because ${item.reason}.`

type CoordinatorStoryItem = Exclude<
  AuthoredCassetteStoryItem,
  { readonly _tag: "CoordinatorActivationReturned" | "CoordinatorProcessDies" }
>

type AuthoredTrackerClaimStoryItem = Extract<
  CoordinatorStoryItem,
  { readonly _tag: "TaskClaimCurrentReadReturned" | "TaskClaimReadFailed" | "TaskClaimReadReturned" }
>

const isTrackerClaimStoryItem = (item: CoordinatorStoryItem): item is AuthoredTrackerClaimStoryItem =>
  item._tag === "TaskClaimCurrentReadReturned" ||
  item._tag === "TaskClaimReadFailed" ||
  item._tag === "TaskClaimReadReturned"

const trackerClaimLyric = (item: AuthoredTrackerClaimStoryItem): string => {
  switch (item._tag) {
    case "TaskClaimCurrentReadReturned":
      return `The task tracker returns its current exact claim for task ${item.taskId}.`
    case "TaskClaimReadFailed":
      return `The task tracker cannot read the claim for task ${item.taskId}.`
    case "TaskClaimReadReturned":
      return `The task tracker returns ${item.observation._tag} for task ${item.observation.taskId}.`
  }
}

type RemainingCoordinatorStoryItem = Exclude<
  CoordinatorStoryItem,
  AuthoredTrackerGraphStoryItem | AuthoredTrackerClaimStoryItem
>

type OperatorStoryItem = Extract<
  RemainingCoordinatorStoryItem,
  {
    readonly _tag:
      | "OperatorAppliesControlDirection"
      | "OperatorAppliesControlDirectionWhileExecutorRequestInFlight"
      | "OperatorControlDirectionFailed"
      | "OperatorContinuesAttempt"
      | "OperatorDirectsTaskClaimReacquisition"
      | "OperatorStopsAttempt"
      | "SetTaskExecutionCapacity"
  }
>

const isOperatorStoryItem = (item: RemainingCoordinatorStoryItem): item is OperatorStoryItem =>
  item._tag === "OperatorAppliesControlDirection" ||
  item._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight" ||
  item._tag === "OperatorControlDirectionFailed" ||
  item._tag === "OperatorContinuesAttempt" ||
  item._tag === "OperatorDirectsTaskClaimReacquisition" ||
  item._tag === "OperatorStopsAttempt" ||
  item._tag === "SetTaskExecutionCapacity"

const operatorLyric = (item: OperatorStoryItem): string => {
  if (item._tag === "SetTaskExecutionCapacity") {
    return `Operator applies task-execution capacity ${item.capacity} to the Run.`
  }
  if (item._tag === "OperatorControlDirectionFailed") {
    return `Dalph rejects Operator ${item.direction} for task ${item.subject.taskId}: ${item.reason}.`
  }
  if (item._tag === "OperatorContinuesAttempt" || item._tag === "OperatorStopsAttempt") {
    const direction = item._tag === "OperatorContinuesAttempt" ? "Continue" : "Stop"
    const result =
      item.expected._tag === "Rejected"
        ? `rejection ${item.expected.reason}`
        : item._tag === "OperatorStopsAttempt"
          ? `status ${item.expected.status}`
          : "ContinueApplied"
    return `Operator applies ${direction} request ${item.requestNonce} to task ${item.taskId}, attempt ${item.attemptId}, and observes ${result}.`
  }
  if (
    item._tag === "OperatorAppliesControlDirection" ||
    item._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight"
  ) {
    return `Operator applies ${item.direction} to ${
      item.subject._tag === "Run" ? "the Run" : `task ${item.subject.taskId}`
    }${item._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight" ? " while the executor request is in flight" : ""}.`
  }
  return `Operator request ${item.requestId} directs Dalph to reacquire the claim for task ${item.taskId}.`
}

// eslint-disable-next-line complexity -- Every remaining authored story variant is rendered at this exhaustive presentation boundary.
const remainingCoordinatorLyric = (item: RemainingCoordinatorStoryItem): string => {
  if (isOperatorStoryItem(item)) return operatorLyric(item)
  switch (item._tag) {
    case "DalphHoldsAdmittedContinuationBeforeExecutorIntent":
      return `Dalph holds the admitted continuation for attempt ${item.attemptId} before its executor command intent while Alice's Stop request is applied.`
    case "DalphSelects":
      return `Dalph selects ${item.operation._tag}.`
    case "GitWorktreeObservationChanged":
      return `Git changes the planned worktree observation to ${item.observation._tag}.`
    case "IntegrationCandidateAgentReported":
      return `The integration agent reports ${item.report._tag}.`
    case "IntegrationCandidateGitValidationFailed":
      return `Git cannot validate the explicitly submitted candidate: ${item.detail}`
    case "IntegrationCandidateGitValidationReturned":
      return `Git returns ${item.observation._tag} for the explicitly submitted candidate.`
    case "TargetVerificationReturned":
      return `The target repository's public verification wrapper returns ${item.result._tag}.`
    case "TargetPromotionCompareAndSetReturned":
      return `Git returns ${item.result._tag} for the exact expected-head compare-and-set.`
    case "TargetPromotionCompareAndSetResponseLost":
      return `Git may have applied the exact compare-and-set, but its response is lost: ${item.detail}`
    case "TargetPromotionGitReadReturned":
      return `Git returns ${item.observation._tag} from the current-head candidate-ancestry read.`
    case "TargetPromotionGitReadFailed":
      return `Git cannot complete the current-head candidate-ancestry read: ${item.detail}`
    case "TaskWorkSpecificationReadReturned":
      return `The task tracker returns "${item.title}" for task ${item.taskId}.`
    case "PlannedAttemptExecutorWorkReported":
      return `The executor reports ${item.report._tag} for attempt ${item.report.attemptId}.`
    case "PlannedAttemptExecutorProjectionReturned":
      return `A read-only executor projection returns ${item.report._tag} for attempt ${item.report.attemptId}.`
    case "PlannedAttemptExecutorResponseLost":
      return `The executor reaches ${item.report._tag} for attempt ${item.report.attemptId}, but Dalph loses the ${item.request} response: ${item.detail}`
    case "TaskClaimReleaseResponseLost":
      return `The task tracker applies the exact claim release for task ${item.taskId}, but Dalph loses the response: ${item.detail}`
    case "ExpectedBehavior":
      return expectedBehaviorLyric(item)
    case "InitialControlPolicy":
      return `Dalph starts with task-execution capacity ${item.policy.taskExecutionCapacity}.`
    case "RunCoordinator":
      return `The maintainer asks Dalph to coordinate ${JSON.stringify(item.target)}.`
  }
}

const coordinatorStoryLyric = (item: CoordinatorStoryItem): string => {
  if (isTrackerGraphStoryItem(item)) return trackerGraphLyric(item)
  if (isTrackerClaimStoryItem(item)) return trackerClaimLyric(item)
  return remainingCoordinatorLyric(item)
}

const storyLyric = (item: AuthoredCassetteStoryItem): string => {
  if (item._tag === "CoordinatorActivationReturned") {
    return item.decision._tag === "RunMayTerminate"
      ? "The coordinator activation returns RunMayTerminate before a later recovery activation."
      : `The coordinator activation returns RunMustRemainActive because ${item.decision.reason} before a later recovery activation.`
  }
  if (item._tag === "CoordinatorProcessDies") {
    return "The coordinator process and its same-process executor session die; durable and authority facts remain."
  }
  return coordinatorStoryLyric(item)
}

/** Readable prose is derived from structured story items and is never parsed. */
export const renderAuthoredCassetteLyrics = (cassette: AuthoredScenarioCassette): string =>
  [`Scenario: ${cassette.name}.`, ...cassette.story.map(storyLyric)].join("\n")
