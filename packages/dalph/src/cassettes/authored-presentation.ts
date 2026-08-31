/* eslint-disable max-lines -- One exhaustive renderer keeps every authored story tag visible at its presentation boundary. */
import { Match } from "effect"
import type {
  AuthoredCassetteStoryItem,
  AuthoredOrchestrationEvidence,
  AuthoredProtocolEvidence,
  AuthoredScenarioCassette,
  AuthoredTrackerGraph,
  AuthoredTaskWorkResult
} from "./authored-domain.js"

/**
 * One authored boundary occurrence worth exposing as a delivery-playback
 * landmark. This projection belongs with the typed authored vocabulary so a
 * browser harness never has to reinterpret raw story tags.
 */
const noLandmark = (): null => null

const trackerGraphLandmark = (graph: AuthoredTrackerGraph, readMeaning: string): string => {
  const taskStates = graph.tasks.map((task) => `task ${task.id} ${task.lifecycle._tag}`)
  return `${readMeaning} ${graph.revision}${taskStates.length === 0 ? " with no tasks" : `: ${taskStates.join("; ")}`}`
}

export const renderAuthoredStoryItemLandmark: (item: AuthoredCassetteStoryItem) => string | null =
  Match.type<AuthoredCassetteStoryItem>().pipe(
    Match.tagsExhaustive({
      CompletionClaimDeletionApplied: noLandmark,
      CompletionClaimReadReturned: noLandmark,
      CompletionClaimReplacementApplied: noLandmark,
      CompletionTaskFocusedReadReturned: noLandmark,
      CompletionTaskPrerequisiteReopened: (item) =>
        trackerGraphLandmark(item.graph, "Another tracker client reopened prerequisite B"),
      CompletionTaskRequestLookupReturned: noLandmark,
      CompletionTaskRequestReturned: noLandmark,
      CoordinatorActivationReturned: noLandmark,
      CoordinatorProcessDies: () =>
        "The coordinator process died; the next activation reconstructs accepted journal history",
      DalphHoldsAdmittedContinuationBeforeExecutorIntent: noLandmark,
      CassetteHoldsPlannedAttemptContinuationBeforeExecutorBoundary: noLandmark,
      CassetteReleasesHeldPlannedAttemptContinuation: noLandmark,
      DalphHoldsExecutorRequestThroughNextDeliveryPublication: noLandmark,
      CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary: noLandmark,
      CassetteReleasesHeldPlannedAttemptSuspension: noLandmark,
      CassetteHoldsTargetPromotionReconciliationReadBeforeBoundary: noLandmark,
      CassetteKillsCoordinatorAtTargetPromotionReconciliationRead: noLandmark,
      CassetteReleasesHeldTargetPromotionReconciliationRead: noLandmark,
      CassetteHoldsTaskWorkSpecificationReadBeforeBoundary: noLandmark,
      CassetteReleasesHeldTaskWorkSpecificationRead: noLandmark,
      ConcurrentTrackerReadBatch: noLandmark,
      DalphSelects: noLandmark,
      ExpectedBehavior: noLandmark,
      GitWorktreeObservationChanged: noLandmark,
      GitPlannedWorktreeCreateResponseLost: noLandmark,
      IntegratorRequestReceived: noLandmark,
      IntegratorResultReturned: noLandmark,
      IntegratorGitObservationReturned: noLandmark,
      IntegratorGitObservationFailed: noLandmark,
      InitialControlPolicy: noLandmark,
      OperatorAppliesControlDirection: (item) => {
        const target = item.subject._tag === "Run" ? "the Run" : `task ${item.subject.taskId}`
        return `Operator ${item.direction.toLowerCase()}d ${target}`
      },
      OperatorAppliesControlDirectionBeforeDeliveryActionAdmission: (item) => {
        const target = item.subject._tag === "Run" ? "the Run" : `task ${item.subject.taskId}`
        return `Operator ${item.direction.toLowerCase()}d ${target} before delivery-action admission`
      },
      OperatorAppliesControlDirectionWhileExecutorRequestInFlight: (item) => {
        const target = item.subject._tag === "Run" ? "the Run" : `task ${item.subject.taskId}`
        return `Operator ${item.direction.toLowerCase()}d ${target} while its executor request was in flight`
      },
      OperatorAppliesRunCancellation: noLandmark,
      OperatorAppliesRunCancellationWhileExecutorRequestInFlight: (item) =>
        `Operator cancelled the Run while executor attempt ${item.duringAttemptId} was in flight`,
      OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting: noLandmark,
      OperatorStartsPauseObservation: noLandmark,
      OperatorSubscribesToPauseObservation: noLandmark,
      OperatorAwaitsPauseProgress: noLandmark,
      PauseProgressObserved: noLandmark,
      PauseProgressObservedCancelledAndReconnected: noLandmark,
      OperatorContinuesAttempt: noLandmark,
      OperatorControlDirectionFailed: noLandmark,
      OperatorDirectsTaskClaimReacquisition: noLandmark,
      OperatorRacesContinueAndStop: noLandmark,
      OperatorRestartsAttempt: noLandmark,
      OperatorStopsAttempt: noLandmark,
      PlannedAttemptExecutorProjectionReturned: noLandmark,
      PlannedAttemptExecutorResponseLost: noLandmark,
      PlannedAttemptExecutorWorkReported: (item) =>
        `Attempt ${item.report.attemptId} reported ${item.report._tag}${item.report._tag === "ExecutorWorkSafelySuspended" ? "; its held position can now be released" : ""}`,
      RunActivationFinalTrackerGraphReadReturned: (item) =>
        trackerGraphLandmark(item.graph, "Activation-final tracker read returned graph"),
      RunCoordinator: noLandmark,
      SetTaskExecutionCapacity: noLandmark,
      TaskClaimAcquisitionConflictReturned: noLandmark,
      TaskClaimAcquisitionRejected: noLandmark,
      TargetPromotionCompareAndSetResponseLost: noLandmark,
      TargetPromotionCompareAndSetReturned: noLandmark,
      TargetPromotionGitReadFailed: noLandmark,
      TargetPromotionGitReadReturned: noLandmark,
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
  if (isExecutorOrchestrationEvidence(evidence)) return executorOrchestrationEvidenceLyric(evidence)
  return Match.value(evidence).pipe(
    Match.tagsExhaustive({
      AcceptedResultIntegrationResponsibilityBegan: (evidence) =>
        `The story expects Dalph to queue accepted commit ${evidence.commit} from attempt ${evidence.attemptId}.`,
      AcceptedResultIntegrationStarted: (evidence) =>
        `The story expects Dalph to start integrating accepted commit ${evidence.commit} from attempt ${evidence.attemptId}.`
    })
  )
}

const protocolEvidenceLyric = Match.type<AuthoredProtocolEvidence>().pipe(
  Match.tagsExhaustive({
    RunCancellationApplied: () => `The story expects Operator to apply whole-Run cancellation exactly once.`,
    AttemptChoiceApplied: (evidence) =>
      `The story expects Operator to apply ${evidence.choice} to task ${evidence.taskId}, attempt ${evidence.attemptId}, at authored revision ${evidence.observedTaskRevision}.`,
    AttemptImplementationAbandoned: (evidence) =>
      `The story expects Dalph to abandon implementation responsibility for task ${evidence.taskId}, attempt ${evidence.attemptId}.`,
    PlannedAttemptReplaced: (evidence) =>
      `The story expects Dalph to atomically replace attempt ${evidence.priorAttemptId} with clean attempt ${evidence.successorAttemptId} for task ${evidence.taskId}.`,
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
      | "TaskClaimAcquisitionConflictReturned"
      | "TaskClaimAcquisitionRejected"
      | "TaskClaimCurrentReadReturned"
      | "TaskClaimReadFailed"
      | "TaskClaimReadReturned"
  }
>

const isTrackerClaimStoryItem = (item: CoordinatorStoryItem): item is AuthoredTrackerClaimStoryItem =>
  item._tag === "CompletionClaimDeletionApplied" ||
  item._tag === "CompletionClaimReadReturned" ||
  item._tag === "CompletionClaimReplacementApplied" ||
  item._tag === "TaskClaimAcquisitionConflictReturned" ||
  item._tag === "TaskClaimAcquisitionRejected" ||
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
    TaskClaimAcquisitionConflictReturned: (item) =>
      `The task tracker returns foreign claim ${item.observed.token} while rejecting a fresh acquisition for task ${item.observed.taskId}.`,
    TaskClaimAcquisitionRejected: (item) =>
      `Dalph records the terminal foreign-claim rejection for task ${item.observed.taskId} and preserves claim ${item.observed.token}.`,
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
      | "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission"
      | "OperatorAppliesControlDirectionWhileExecutorRequestInFlight"
      | "OperatorAppliesRunCancellation"
      | "OperatorAppliesRunCancellationWhileExecutorRequestInFlight"
      | "OperatorControlDirectionFailed"
      | "OperatorContinuesAttempt"
      | "OperatorDirectsTaskClaimReacquisition"
      | "OperatorRacesContinueAndStop"
      | "OperatorRestartsAttempt"
      | "OperatorStopsAttempt"
      | "SetTaskExecutionCapacity"
  }
>

const operatorStoryItemTags: ReadonlySet<RemainingCoordinatorStoryItem["_tag"]> = new Set([
  "OperatorAppliesControlDirection",
  "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission",
  "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
  "OperatorAppliesRunCancellation",
  "OperatorAppliesRunCancellationWhileExecutorRequestInFlight",
  "OperatorControlDirectionFailed",
  "OperatorContinuesAttempt",
  "OperatorDirectsTaskClaimReacquisition",
  "OperatorRacesContinueAndStop",
  "OperatorRestartsAttempt",
  "OperatorStopsAttempt",
  "SetTaskExecutionCapacity"
])

const isOperatorStoryItem = (item: RemainingCoordinatorStoryItem): item is OperatorStoryItem =>
  operatorStoryItemTags.has(item._tag)

type AttemptChoiceOperatorItem = Extract<
  OperatorStoryItem,
  { readonly _tag: "OperatorContinuesAttempt" | "OperatorRestartsAttempt" | "OperatorStopsAttempt" }
>
type ControlDirectionOperatorItem = Extract<
  OperatorStoryItem,
  {
    readonly _tag:
      | "OperatorAppliesControlDirection"
      | "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission"
      | "OperatorAppliesControlDirectionWhileExecutorRequestInFlight"
  }
>

const isAttemptChoiceOperatorItem = (item: OperatorStoryItem): item is AttemptChoiceOperatorItem =>
  item._tag === "OperatorContinuesAttempt" ||
  item._tag === "OperatorRestartsAttempt" ||
  item._tag === "OperatorStopsAttempt"

const isControlDirectionOperatorItem = (item: OperatorStoryItem): item is ControlDirectionOperatorItem =>
  item._tag === "OperatorAppliesControlDirection" ||
  item._tag === "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission" ||
  item._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight"

const attemptChoiceOperatorLyric = (item: AttemptChoiceOperatorItem): string => {
  const direction =
    item._tag === "OperatorContinuesAttempt" ? "Continue" : item._tag === "OperatorRestartsAttempt" ? "Restart" : "Stop"
  const result =
    item.expected._tag === "Rejected"
      ? `rejection ${item.expected.reason}`
      : item._tag === "OperatorStopsAttempt"
        ? `status ${item.expected.status}`
        : item._tag === "OperatorRestartsAttempt"
          ? "RestartApplied"
          : "ContinueApplied"
  return `Operator applies ${direction} request ${item.requestNonce} to task ${item.taskId}, attempt ${item.attemptId}, and observes ${result}.`
}

const controlDirectionOperatorLyric = (item: ControlDirectionOperatorItem): string =>
  `Operator applies ${item.direction} to ${item.subject._tag === "Run" ? "the Run" : `task ${item.subject.taskId}`}${
    item._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight"
      ? ` while executor request ${item.duringAttemptId} is in flight`
      : item._tag === "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission"
        ? " before delivery-action admission"
        : ""
  }.`

const operatorLyric = (item: OperatorStoryItem): string => {
  if (item._tag === "SetTaskExecutionCapacity") {
    return `Operator applies task-execution capacity ${item.capacity} to the Run.`
  }
  if (item._tag === "OperatorControlDirectionFailed") {
    return `Dalph rejects Operator ${item.direction} for task ${item.subject.taskId}: ${item.reason}.`
  }
  if (item._tag === "OperatorAppliesRunCancellation") {
    return "Operator applies whole-Run cancellation."
  }
  if (item._tag === "OperatorAppliesRunCancellationWhileExecutorRequestInFlight") {
    return `Operator applies whole-Run cancellation while executor attempt ${item.duringAttemptId} is in flight.`
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
      CompletionTaskPrerequisiteReopened: (item) =>
        `Another tracker client reopens prerequisite B before completion request Q is acknowledged (${item.graph.revision}).`,
      DalphHoldsAdmittedContinuationBeforeExecutorIntent: (item) =>
        `Dalph holds the admitted continuation for attempt ${item.attemptId} before its executor command intent while Alice's Stop request is applied.`,
      CassetteHoldsPlannedAttemptContinuationBeforeExecutorBoundary: (item) =>
        `The cassette holds the already-running continuation for task ${item.taskId} attempt ${item.attemptId} before calling the executor.`,
      CassetteReleasesHeldPlannedAttemptContinuation: (item) =>
        `The cassette releases the held continuation for task ${item.taskId} attempt ${item.attemptId}.`,
      DalphHoldsExecutorRequestThroughNextDeliveryPublication: (item) =>
        `The cassette keeps ${item.request} for task ${item.taskId} attempt ${item.attemptId} in flight until the next ordinary delivery fact publishes.`,
      CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary: (item) =>
        `The cassette holds Suspend for task ${item.taskId} attempt ${item.attemptId} before calling the executor.`,
      CassetteReleasesHeldPlannedAttemptSuspension: (item) =>
        `The cassette releases the held Suspend for task ${item.taskId} attempt ${item.attemptId}.`,
      CassetteHoldsTargetPromotionReconciliationReadBeforeBoundary: () =>
        "The cassette holds the exact post-loss target-promotion reconciliation read before Git returns its observation.",
      CassetteKillsCoordinatorAtTargetPromotionReconciliationRead: () =>
        "The coordinator dies when the exact post-loss target-promotion reconciliation request reaches Git's read boundary.",
      CassetteReleasesHeldTargetPromotionReconciliationRead: () =>
        "The cassette releases the exact held target-promotion reconciliation read.",
      CassetteHoldsTaskWorkSpecificationReadBeforeBoundary: (item) =>
        `The cassette holds task ${item.taskId}'s specification read before its boundary.`,
      CassetteReleasesHeldTaskWorkSpecificationRead: (item) =>
        `The cassette releases task ${item.taskId}'s held specification read.`,
      ConcurrentTrackerReadBatch: (item) =>
        `The cassette accepts ${item.members.length} causally named tracker reads in either completion order.`,
      DalphSelects: (item) => `Dalph selects ${item.operation._tag}.`,
      GitWorktreeObservationChanged: (item) =>
        `Git changes the planned worktree observation to ${item.observation._tag}.`,
      CompletionTaskFocusedReadReturned: (item) =>
        `The task tracker reports task ${item.taskId} ${item.lifecycle} with ${item.unfinishedPrerequisiteTaskIds.length} unfinished prerequisites in the focused completion read.`,
      CompletionTaskRequestReturned: (item) =>
        `The task tracker returns ${item.outcome} for the exact completion request for task ${item.taskId}.`,
      CompletionTaskRequestLookupReturned: (item) =>
        `The task tracker classifies the exact completion request for task ${item.taskId} as ${item.outcome}.`,
      TargetPromotionCompareAndSetReturned: (item) =>
        `Git returns ${item.result._tag} for the exact expected-head compare-and-set.`,
      TargetPromotionCompareAndSetResponseLost: (item) =>
        `Git may have applied the exact compare-and-set, but its response is lost: ${item.detail}`,
      TargetPromotionGitReadReturned: (item) =>
        `Git returns ${item.observation._tag} while reconciling candidate ${item.candidateCommit} in ${item.repository}.`,
      TargetPromotionGitReadFailed: (item) =>
        `Git cannot reconcile candidate ${item.candidateCommit} in ${item.repository}: ${item.detail}`,
      TaskWorkSpecificationReadReturned: (item) => `The task tracker returns "${item.title}" for task ${item.taskId}.`,
      GitPlannedWorktreeCreateResponseLost: (item) =>
        `Git creates the exact planned worktree, but Dalph loses the response: ${item.detail}`,
      IntegratorRequestReceived: (item) =>
        `The outer Integrator receives session ${item.correlation.sessionId} for target ${item.correlation.integrationTarget.ref} at head ${item.correlation.expectedTargetHead}.`,
      IntegratorResultReturned: (item) =>
        `The outer Integrator returns ${item.result._tag}${item.result._tag === "NotPrepared" ? `: ${item.result.detail}` : ` ${item.result.candidateText}`}.`,
      IntegratorGitObservationReturned: (item) =>
        `Git returns ${item.observation._tag} for reported candidate ${item.candidateText}.`,
      IntegratorGitObservationFailed: (item) =>
        `Git cannot observe reported candidate ${item.candidateText}: ${item.detail}`,
      PlannedAttemptExecutorWorkReported: (item) =>
        `The executor reports ${item.report._tag} for attempt ${item.report.attemptId}.`,
      PlannedAttemptExecutorProjectionReturned: (item) =>
        `A read-only executor projection returns ${item.report._tag} for attempt ${item.report.attemptId}.`,
      PlannedAttemptExecutorResponseLost: (item) =>
        `The executor reaches ${item.report._tag} for attempt ${item.report.attemptId}, but Dalph loses the ${item.request} response: ${item.detail}`,
      OperatorStartsPauseObservation: (item) =>
        `Alice asks to observe Pause progress for ${
          item.subject._tag === "Run" ? "the Run" : `task ${item.subject.taskId}`
        }.`,
      OperatorSubscribesToPauseObservation: (item) =>
        `Alice subscribes to Pause progress for ${item.subject._tag === "Run" ? "the Run" : `task ${item.subject.taskId}`} before the held boundary publishes.`,
      OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting: (item) =>
        `Alice unpauses ${item.subject._tag === "Run" ? "the Run" : `task ${item.subject.taskId}`} during attempt ${item.duringAttemptId} after receiving the queued Waiting view.`,
      OperatorAwaitsPauseProgress: (item) =>
        `Alice awaits ${item.result._tag} from the following ordinary boundary result.`,
      PauseProgressObserved: (item) => `Alice receives ${item.result._tag} from the process-local Pause observation.`,
      PauseProgressObservedCancelledAndReconnected: (item) =>
        `Alice receives ${item.result._tag}, ends only her process-local Pause observation subscription, then reconnects after the next delivery publication and receives ${item.reconnectResult._tag}.`,
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
