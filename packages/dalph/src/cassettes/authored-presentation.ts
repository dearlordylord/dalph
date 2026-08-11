import { Match } from "effect"
import type {
  AuthoredCassetteStoryItem,
  AuthoredOrchestrationEvidence,
  AuthoredProtocolEvidence,
  AuthoredScenarioCassette,
  AuthoredTaskWorkResult
} from "./authored-domain.js"

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
    CompletionTaskFocusedReadReturned: noLandmark,
    CompletionTaskRequestLookupReturned: noLandmark,
    CompletionTaskRequestReturned: noLandmark,
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

const taskWorkResultLyric = Match.type<AuthoredTaskWorkResult>().pipe(
  Match.tagsExhaustive({
    PlannedWorkForTaskAccepted: (result) =>
      `The story expects task ${result.taskId} to produce accepted commit ${result.commit}.`,
    PlannedWorkForTaskCompleted: (result) =>
      `The story expects the planned work for task ${result.taskId} to complete.`,
    PlannedWorkForTaskFailed: (result) => `The story expects the planned work for task ${result.taskId} to fail.`
  })
)

type AuthoredTargetPromotionEvidence = Extract<
  AuthoredOrchestrationEvidence,
  { readonly _tag: "TargetPromotionSucceeded" | "TargetPromotionNonConvergent" | "TargetPromotionStale" }
>

const isTargetPromotionEvidence = (
  evidence: AuthoredOrchestrationEvidence
): evidence is AuthoredTargetPromotionEvidence => evidence._tag.startsWith("TargetPromotion")

const targetPromotionEvidenceLyric = Match.type<AuthoredTargetPromotionEvidence>().pipe(
  Match.tagsExhaustive({
    TargetPromotionSucceeded: (evidence) =>
      `The story expects ${evidence.basis._tag} to establish candidate ${evidence.candidateCommit} on target head ${evidence.observedTargetHead} by ${evidence.observation}.`,
    TargetPromotionNonConvergent: (evidence) =>
      `The story expects candidate ${evidence.candidateCommit} to stop after attempt ${evidence.attemptOrdinal} with ${evidence.lastObservation}.`,
    TargetPromotionStale: (evidence) =>
      `The story expects Git to preserve head ${evidence.observedTargetHead} instead of replacing it with stale candidate ${evidence.candidateCommit}.`
  })
)

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

const executorOrchestrationEvidenceLyric = Match.type<AuthoredExecutorOrchestrationEvidence>().pipe(
  Match.tagsExhaustive({
    PlannedAttemptExecutorWorkResponsibilityBegan: (evidence) =>
      `The story expects Dalph to assume executor-work responsibility for task ${evidence.taskId}, attempt ${evidence.attemptId}.`,
    PlannedAttemptExecutorWorkReported: (evidence) =>
      `The story expects executor report ${evidence.report} for attempt ${evidence.attemptId}.`,
    PlannedAttemptExecutorCommandProjectionObserved: (evidence) =>
      `The story expects exact executor projection ${evidence.report} for attempt ${evidence.attemptId}.`
  })
)

const orchestrationEvidenceLyric = (evidence: AuthoredOrchestrationEvidence): string => {
  if (isTargetPromotionEvidence(evidence)) return targetPromotionEvidenceLyric(evidence)
  if (isTargetVerificationEvidence(evidence)) return targetVerificationEvidenceLyric(evidence)
  if (isExecutorOrchestrationEvidence(evidence)) return executorOrchestrationEvidenceLyric(evidence)
  return Match.value(evidence).pipe(
    Match.tagsExhaustive({
      AcceptedResultIntegrationResponsibilityBegan: (evidence) =>
        `The story expects Dalph to queue accepted commit ${evidence.commit} from attempt ${evidence.attemptId}.`,
      AcceptedResultIntegrationStarted: (evidence) =>
        `The story expects Dalph to start integrating accepted commit ${evidence.commit} from attempt ${evidence.attemptId}.`,
      IntegrationCandidateConstructed: (evidence) =>
        `The story expects candidate ${evidence.candidateCommit} to have target ${evidence.expectedTargetHead} first and accepted result ${evidence.acceptedResultCommit} second.`
    })
  )
}

const protocolEvidenceLyric = Match.type<AuthoredProtocolEvidence>().pipe(
  Match.tagsExhaustive({
    AttemptChoiceApplied: (evidence) =>
      `The story expects Operator to apply ${evidence.choice} to task ${evidence.taskId}, attempt ${evidence.attemptId}, at authored revision ${evidence.observedTaskRevision}.`,
    AttemptImplementationAbandoned: (evidence) =>
      `The story expects Dalph to abandon implementation responsibility for task ${evidence.taskId}, attempt ${evidence.attemptId}.`,
    AttemptWorktreeLost: (evidence) =>
      `The story expects Git to report the planned worktree lost for task ${evidence.taskId}, attempt ${evidence.attemptId}.`,
    CompatibleTargetAdvance: (evidence) =>
      `The story expects Git to prove target ${evidence.targetHeadSha} descends from Base ${evidence.plannedBaseSha} for task ${evidence.taskId}.`,
    ControlDirectionApplied: (evidence) =>
      `The story expects Operator to apply ${evidence.direction} to ${
        evidence.subject._tag === "Run" ? "the Run" : `task ${evidence.subject.taskId}`
      }.`,
    IncompatibleTargetRewrite: (evidence) =>
      `The story expects Git to prove target ${evidence.targetHeadSha} is outside Base ${evidence.plannedBaseSha} for task ${evidence.taskId}.`,
    TaskClaimAcquired: (evidence) => `The story expects Dalph to acquire the claim for task ${evidence.taskId}.`,
    TaskClaimReleased: (evidence) => `The story expects Dalph to release its exact claim for task ${evidence.taskId}.`,
    TaskClaimObserved: (evidence) =>
      `The story expects Dalph to record ${evidence.claimState.toLowerCase()} claim authority for task ${evidence.taskId}.`,
    TaskClaimReadExhausted: (evidence) =>
      `The story expects Dalph to exhaust the bounded claim read for task ${evidence.taskId}.`,
    TaskClaimReacquisitionDirected: (evidence) =>
      `The story expects Operator request ${evidence.requestId} to direct Dalph to reacquire the claim for task ${evidence.taskId}.`,
    TaskAttemptPlanned: (evidence) =>
      `The story expects Dalph to plan attempt ${evidence.attemptId} for task ${evidence.taskId}.`,
    TaskWorktreeReady: (evidence) =>
      `The story expects the worktree for task ${evidence.taskId}, attempt ${evidence.attemptId}, to become ready.`,
    StoppedAttemptClaimNoReleaseObserved: (evidence) =>
      `The story expects Dalph to preserve the ${evidence.claimState.toLowerCase()} claim state for stopped task ${evidence.taskId}.`
  })
)

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

const trackerClaimLyric = Match.type<AuthoredTrackerClaimStoryItem>().pipe(
  Match.tagsExhaustive({
    CompletionClaimDeletionApplied: (item) =>
      `The task tracker deletes the exact completion claim for task ${item.taskId}.`,
    CompletionClaimReadReturned: (item) =>
      `The task tracker returns the exact ${item.claim.toLowerCase()} claim for finality task ${item.taskId}.`,
    CompletionClaimReplacementApplied: (item) =>
      `The task tracker replaces task ${item.taskId}'s active claim with its exact promotion-correlated completion claim.`,
    TaskClaimCurrentReadReturned: (item) => `The task tracker returns its current exact claim for task ${item.taskId}.`,
    TaskClaimReadFailed: (item) => `The task tracker cannot read the claim for task ${item.taskId}.`,
    TaskClaimReadReturned: (item) =>
      `The task tracker returns ${item.observation._tag} for task ${item.observation.taskId}.`
  })
)

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
  return Match.value(item).pipe(
    Match.tagsExhaustive({
      DalphHoldsAdmittedContinuationBeforeExecutorIntent: (item) =>
        `Dalph holds the admitted continuation for attempt ${item.attemptId} before its executor command intent while Alice's Stop request is applied.`,
      DalphSelects: (item) => `Dalph selects ${item.operation._tag}.`,
      GitWorktreeObservationChanged: (item) =>
        `Git changes the planned worktree observation to ${item.observation._tag}.`,
      IntegrationCandidateAgentReported: (item) => `The integration agent reports ${item.report._tag}.`,
      IntegrationCandidateGitValidationFailed: (item) =>
        `Git cannot validate the explicitly submitted candidate: ${item.detail}`,
      IntegrationCandidateGitValidationReturned: (item) =>
        `Git returns ${item.observation._tag} for the explicitly submitted candidate.`,
      CompletionTaskFocusedReadReturned: (item) =>
        `The task tracker reports task ${item.taskId} ${item.lifecycle} with ${item.unfinishedPrerequisiteTaskIds.length} unfinished prerequisites in the focused completion read.`,
      CompletionTaskRequestReturned: (item) =>
        `The task tracker returns ${item.outcome} for the exact completion request for task ${item.taskId}.`,
      CompletionTaskRequestLookupReturned: (item) =>
        `The task tracker classifies the exact completion request for task ${item.taskId} as ${item.outcome}.`,
      TargetVerificationReturned: (item) =>
        `The target repository's public verification wrapper returns ${item.result._tag}.`,
      TargetPromotionCompareAndSetReturned: (item) =>
        `Git returns ${item.result._tag} for the exact expected-head compare-and-set.`,
      TargetPromotionCompareAndSetResponseLost: (item) =>
        `Git may have applied the exact compare-and-set, but its response is lost: ${item.detail}`,
      TargetPromotionGitReadReturned: (item) =>
        `Git returns ${item.observation._tag} from the current-head candidate-ancestry read.`,
      TargetPromotionGitReadFailed: (item) =>
        `Git cannot complete the current-head candidate-ancestry read: ${item.detail}`,
      TaskWorkSpecificationReadReturned: (item) => `The task tracker returns "${item.title}" for task ${item.taskId}.`,
      PlannedAttemptExecutorWorkReported: (item) =>
        `The executor reports ${item.report._tag} for attempt ${item.report.attemptId}.`,
      PlannedAttemptExecutorProjectionReturned: (item) =>
        `A read-only executor projection returns ${item.report._tag} for attempt ${item.report.attemptId}.`,
      PlannedAttemptExecutorResponseLost: (item) =>
        `The executor reaches ${item.report._tag} for attempt ${item.report.attemptId}, but Dalph loses the ${item.request} response: ${item.detail}`,
      TaskClaimReleaseResponseLost: (item) =>
        `The task tracker applies the exact claim release for task ${item.taskId}, but Dalph loses the response: ${item.detail}`,
      ExpectedBehavior: expectedBehaviorLyric,
      InitialControlPolicy: (item) => `Dalph starts with task-execution capacity ${item.policy.taskExecutionCapacity}.`,
      RunCoordinator: (item) => `The maintainer asks Dalph to coordinate ${JSON.stringify(item.target)}.`
    })
  )
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
