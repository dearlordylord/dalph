import { Match } from "effect"
import type {
  AuthoredCassetteDeliveryScope,
  AuthoredCassetteStoryItem,
  AuthoredOrchestrationEvidence,
  AuthoredProtocolEvidence,
  AuthoredScenarioCassette,
  AuthoredTaskWorkResult
} from "./authored-domain.js"

/** Human meaning of the typed delivery-evidence scope carried by one authored cassette. */
export const renderAuthoredCassetteDeliveryScope = Match.type<AuthoredCassetteDeliveryScope>().pipe(
  Match.tagsExhaustive({
    FocusedWorkflowSlice: ({ externallyCompletedTaskIds }) =>
      externallyCompletedTaskIds.length === 0
        ? "Focused workflow slice: only the named behavior is asserted; no externally completed tracker task is part of this chronology."
        : `External tracker-completion corner case: ${externallyCompletedTaskIds.join(", ")} reach tracker success without Dalph integration. This is explicit outside provenance, not the normal delivery path.`,
    CompleteGraphDelivery: () =>
      "Complete graph delivery: every observed graph task reaches tracker success and carries one correlated accepted commit, attempt, integration, candidate, verification, promotion, and completion-finality chain."
  })
)

/**
 * One authored boundary occurrence worth exposing as a delivery-playback
 * landmark. This projection belongs with the typed authored vocabulary so a
 * browser harness never has to reinterpret raw story tags.
 */
const noLandmark = (): null => null

const trackerGraphLandmark = (
  graph: Extract<AuthoredCassetteStoryItem, { readonly _tag: "RunActivationFinalTrackerGraphReadReturned" }>["graph"],
  readMeaning: string
): string => {
  const taskStates = graph.tasks.map((task) => `task ${task.id} ${task.lifecycle._tag}`)
  return `${readMeaning} ${graph.revision}${taskStates.length === 0 ? " with no tasks" : `: ${taskStates.join("; ")}`}`
}

export const renderAuthoredStoryItemLandmark = Match.type<AuthoredCassetteStoryItem>().pipe(
  Match.tagsExhaustive({
    CompletionClaimDeletionApplied: noLandmark,
    CompletionClaimReadReturned: noLandmark,
    CompletionClaimReplacementApplied: noLandmark,
    CoordinatorActivationReturned: noLandmark,
    CoordinatorProcessDies: () =>
      "The coordinator process died; the next activation reconstructs accepted journal history",
    DalphHoldsAdmittedContinuationBeforeExecutorIntent: noLandmark,
    DalphSelects: noLandmark,
    ExpectedBehavior: noLandmark,
    GitWorktreeObservationChanged: noLandmark,
    InitialControlPolicy: noLandmark,
    IntegrationCandidateAgentReported: noLandmark,
    IntegrationCandidateGitValidationFailed: noLandmark,
    IntegrationCandidateGitValidationReturned: noLandmark,
    OperatorAppliesControlDirection: (item) => {
      const target = item.subject._tag === "Run" ? "the Run" : `task ${item.subject.taskId}`
      return `Operator ${item.direction.toLowerCase()}d ${target}`
    },
    OperatorAppliesControlDirectionWhileExecutorRequestInFlight: (item) => {
      const target = item.subject._tag === "Run" ? "the Run" : `task ${item.subject.taskId}`
      return `Operator ${item.direction.toLowerCase()}d ${target} while its executor request was in flight`
    },
    OperatorContinuesAttempt: noLandmark,
    OperatorControlDirectionFailed: noLandmark,
    OperatorDirectsTaskClaimReacquisition: noLandmark,
    OperatorRacesContinueAndStop: noLandmark,
    OperatorStopsAttempt: noLandmark,
    PlannedAttemptExecutorProjectionReturned: noLandmark,
    PlannedAttemptExecutorResponseLost: noLandmark,
    PlannedAttemptExecutorWorkReported: (item) =>
      `Attempt ${item.report.attemptId} reported ${item.report._tag}${item.report._tag === "SafelySuspended" ? "; its held position can now be released" : ""}`,
    RunActivationFinalTrackerGraphReadReturned: (item) =>
      trackerGraphLandmark(item.graph, "Activation-final tracker read returned graph"),
    RunCoordinator: noLandmark,
    SetTaskExecutionCapacity: noLandmark,
    TargetPromotionCompareAndSetResponseLost: noLandmark,
    TargetPromotionCompareAndSetReturned: noLandmark,
    TargetPromotionGitReadFailed: noLandmark,
    TargetPromotionGitReadReturned: noLandmark,
    TargetVerificationReturned: noLandmark,
    TaskClaimCurrentReadReturned: noLandmark,
    TaskClaimReadFailed: noLandmark,
    TaskClaimReadReturned: noLandmark,
    TaskClaimReleaseResponseLost: noLandmark,
    TaskWorkSpecificationReadReturned: noLandmark,
    TrackerGraphReadFailed: noLandmark,
    TrackerGraphReadReturned: (item) => trackerGraphLandmark(item.graph, "Tracker returned graph")
  })
)

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

type AuthoredExecutorOrchestrationEvidence = Extract<
  AuthoredOrchestrationEvidence,
  {
    readonly _tag:
      | "PlannedAttemptExecutorCommandProjectionObserved"
      | "PlannedAttemptExecutorWorkReported"
      | "PlannedAttemptExecutorWorkResponsibilityBegan"
  }
>

const isExecutorOrchestrationEvidence = (
  evidence: AuthoredOrchestrationEvidence
): evidence is AuthoredExecutorOrchestrationEvidence => evidence._tag.startsWith("PlannedAttemptExecutor")

const executorOrchestrationEvidenceLyric = (evidence: AuthoredExecutorOrchestrationEvidence): string => {
  switch (evidence._tag) {
    case "PlannedAttemptExecutorWorkResponsibilityBegan":
      return `The story expects Dalph to assume executor-work responsibility for task ${evidence.taskId}, attempt ${evidence.attemptId}.`
    case "PlannedAttemptExecutorWorkReported":
      return `The story expects executor report ${evidence.report} for attempt ${evidence.attemptId}.`
    case "PlannedAttemptExecutorCommandProjectionObserved":
      return `The story expects exact executor projection ${evidence.report} for attempt ${evidence.attemptId}.`
  }
}

const orchestrationEvidenceLyric = (evidence: AuthoredOrchestrationEvidence): string => {
  if (isTargetPromotionEvidence(evidence)) return targetPromotionEvidenceLyric(evidence)
  if (isTargetVerificationEvidence(evidence)) return targetVerificationEvidenceLyric(evidence)
  if (isExecutorOrchestrationEvidence(evidence)) return executorOrchestrationEvidenceLyric(evidence)
  switch (evidence._tag) {
    case "AcceptedResultIntegrationResponsibilityBegan":
      return `The story expects Dalph to queue accepted commit ${evidence.commit} from attempt ${evidence.attemptId}.`
    case "AcceptedResultIntegrationStarted":
      return `The story expects Dalph to start integrating accepted commit ${evidence.commit} from attempt ${evidence.attemptId}.`
    case "IntegrationCandidateConstructed":
      return `The story expects candidate ${evidence.candidateCommit} to have target ${evidence.expectedTargetHead} first and accepted result ${evidence.acceptedResultCommit} second.`
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
  {
    readonly _tag: "RunActivationFinalTrackerGraphReadReturned" | "TrackerGraphReadFailed" | "TrackerGraphReadReturned"
  }
>

const isTrackerGraphStoryItem = (item: AuthoredCassetteStoryItem): item is AuthoredTrackerGraphStoryItem =>
  item._tag === "TrackerGraphReadReturned" ||
  item._tag === "RunActivationFinalTrackerGraphReadReturned" ||
  item._tag === "TrackerGraphReadFailed"

const trackerGraphLyric = (item: AuthoredTrackerGraphStoryItem): string =>
  item._tag === "TrackerGraphReadFailed"
    ? `The task tracker fails the logical graph read because ${item.reason}.`
    : item._tag === "RunActivationFinalTrackerGraphReadReturned"
      ? `The task tracker returns ${item.graph.tasks.length} task graph facts for this activation's final complete target-closure read at ${item.graph.revision}.`
      : `The task tracker returns ${item.graph.tasks.length} task graph facts at ${item.graph.revision}.`

type CoordinatorStoryItem = Exclude<
  AuthoredCassetteStoryItem,
  { readonly _tag: "CoordinatorActivationReturned" | "CoordinatorProcessDies" }
>

type AuthoredTrackerClaimStoryItem = Extract<
  CoordinatorStoryItem,
  {
    readonly _tag:
      | "CompletionClaimDeletionApplied"
      | "CompletionClaimReadReturned"
      | "CompletionClaimReplacementApplied"
      | "TaskClaimCurrentReadReturned"
      | "TaskClaimReadFailed"
      | "TaskClaimReadReturned"
  }
>

const isTrackerClaimStoryItem = (item: CoordinatorStoryItem): item is AuthoredTrackerClaimStoryItem =>
  item._tag === "CompletionClaimDeletionApplied" ||
  item._tag === "CompletionClaimReadReturned" ||
  item._tag === "CompletionClaimReplacementApplied" ||
  item._tag === "TaskClaimCurrentReadReturned" ||
  item._tag === "TaskClaimReadFailed" ||
  item._tag === "TaskClaimReadReturned"

const trackerClaimLyric = (item: AuthoredTrackerClaimStoryItem): string => {
  switch (item._tag) {
    case "CompletionClaimDeletionApplied":
      return `The task tracker deletes the exact completion claim for task ${item.taskId}.`
    case "CompletionClaimReadReturned":
      return `The task tracker returns the exact ${item.claim.toLowerCase()} claim for finality task ${item.taskId}.`
    case "CompletionClaimReplacementApplied":
      return `The task tracker replaces task ${item.taskId}'s active claim with its exact promotion-correlated completion claim.`
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
      | "OperatorRacesContinueAndStop"
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
  item._tag === "OperatorRacesContinueAndStop" ||
  item._tag === "OperatorStopsAttempt" ||
  item._tag === "SetTaskExecutionCapacity"

type AttemptChoiceOperatorItem = Extract<
  OperatorStoryItem,
  { readonly _tag: "OperatorContinuesAttempt" | "OperatorStopsAttempt" }
>
type ControlDirectionOperatorItem = Extract<
  OperatorStoryItem,
  { readonly _tag: "OperatorAppliesControlDirection" | "OperatorAppliesControlDirectionWhileExecutorRequestInFlight" }
>

const isAttemptChoiceOperatorItem = (item: OperatorStoryItem): item is AttemptChoiceOperatorItem =>
  item._tag === "OperatorContinuesAttempt" || item._tag === "OperatorStopsAttempt"

const isControlDirectionOperatorItem = (item: OperatorStoryItem): item is ControlDirectionOperatorItem =>
  item._tag === "OperatorAppliesControlDirection" ||
  item._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight"

const attemptChoiceOperatorLyric = (item: AttemptChoiceOperatorItem): string => {
  const direction = item._tag === "OperatorContinuesAttempt" ? "Continue" : "Stop"
  const result =
    item.expected._tag === "Rejected"
      ? `rejection ${item.expected.reason}`
      : item._tag === "OperatorStopsAttempt"
        ? `status ${item.expected.status}`
        : "ContinueApplied"
  return `Operator applies ${direction} request ${item.requestNonce} to task ${item.taskId}, attempt ${item.attemptId}, and observes ${result}.`
}

const controlDirectionOperatorLyric = (item: ControlDirectionOperatorItem): string =>
  `Operator applies ${item.direction} to ${
    item.subject._tag === "Run" ? "the Run" : `task ${item.subject.taskId}`
  }${item._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight" ? " while the executor request is in flight" : ""}.`

const operatorLyric = (item: OperatorStoryItem): string => {
  if (item._tag === "SetTaskExecutionCapacity") {
    return `Operator applies task-execution capacity ${item.capacity} to the Run.`
  }
  if (item._tag === "OperatorControlDirectionFailed") {
    return `Dalph rejects Operator ${item.direction} for task ${item.subject.taskId}: ${item.reason}.`
  }
  if (isAttemptChoiceOperatorItem(item)) return attemptChoiceOperatorLyric(item)
  if (item._tag === "OperatorRacesContinueAndStop") {
    return `Alice concurrently submits Continue ${item.continueRequestNonce} and Stop ${item.stopRequestNonce} for task ${item.taskId}, attempt ${item.attemptId}; exactly one journaled request wins.`
  }
  if (isControlDirectionOperatorItem(item)) return controlDirectionOperatorLyric(item)
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

/** One exhaustive maintainer-readable sentence derived directly from a typed authored story item. */
export const renderAuthoredStoryItemLyric = (item: AuthoredCassetteStoryItem): string => {
  if (item._tag === "CoordinatorActivationReturned") {
    return item.decision._tag === "RunMayTerminate"
      ? "The coordinator activation returns RunMayTerminate at this authored lifecycle boundary."
      : `The coordinator activation returns RunMustRemainActive because ${item.decision.reason} at this authored lifecycle boundary.`
  }
  if (item._tag === "CoordinatorProcessDies") {
    return "The coordinator process and its same-process executor session die; durable and authority facts remain."
  }
  return coordinatorStoryLyric(item)
}

/** Readable prose is derived from structured story items and is never parsed. */
export const renderAuthoredCassetteLyrics = (cassette: AuthoredScenarioCassette): string =>
  [`Scenario: ${cassette.name}.`, ...cassette.story.map(renderAuthoredStoryItemLyric)].join("\n")
