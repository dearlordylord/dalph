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

const orchestrationEvidenceLyric = (evidence: AuthoredOrchestrationEvidence): string => {
  switch (evidence._tag) {
    case "AcceptedResultIntegrationResponsibilityBegan":
      return `The story expects Dalph to queue accepted commit ${evidence.commit} from attempt ${evidence.attemptId}.`
    case "AcceptedResultIntegrationStarted":
      return `The story expects Dalph to start integrating accepted commit ${evidence.commit} from attempt ${evidence.attemptId}.`
    case "PlannedAttemptExecutorWorkResponsibilityBegan":
      return `The story expects Dalph to assume executor-work responsibility for task ${evidence.taskId}, attempt ${evidence.attemptId}.`
    case "PlannedAttemptExecutorWorkReported":
      return `The story expects executor report ${evidence.report} for attempt ${evidence.attemptId}.`
  }
}

// eslint-disable-next-line complexity -- Every closed protocol-evidence variant owns one maintainer-readable sentence.
const protocolEvidenceLyric = (evidence: AuthoredProtocolEvidence): string => {
  switch (evidence._tag) {
    case "AttemptWorktreeLost":
      return `The story expects Git to report the planned worktree lost for task ${evidence.taskId}, attempt ${evidence.attemptId}.`
    case "CompatibleTargetAdvance":
      return `The story expects Git to prove target ${evidence.targetHeadSha} descends from Base ${evidence.plannedBaseSha} for task ${evidence.taskId}.`
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
    case "TaskClaimReacquisitionRequested":
      return `The story expects the operator's command ${evidence.commandId} to request a replacement claim for task ${evidence.taskId}.`
    case "TaskAttemptPlanned":
      return `The story expects Dalph to plan attempt ${evidence.attemptId} for task ${evidence.taskId}.`
    case "TaskWorktreeReady":
      return `The story expects the worktree for task ${evidence.taskId}, attempt ${evidence.attemptId}, to become ready.`
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

type CoordinatorStoryItem = Exclude<AuthoredCassetteStoryItem, { readonly _tag: "CoordinatorProcessDies" }>

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
  { readonly _tag: "OperatorRequestsTaskClaimReacquisition" | "SetTaskExecutionCapacity" }
>

const isOperatorStoryItem = (item: RemainingCoordinatorStoryItem): item is OperatorStoryItem =>
  item._tag === "OperatorRequestsTaskClaimReacquisition" || item._tag === "SetTaskExecutionCapacity"

const operatorLyric = (item: OperatorStoryItem): string =>
  item._tag === "SetTaskExecutionCapacity"
    ? `Operator applies task-execution capacity ${item.capacity} to the Run.`
    : `Operator ${item.operatorId} requests a replacement claim for task ${item.taskId} with command ${item.commandId}.`

// eslint-disable-next-line complexity -- Every remaining authored story variant is rendered at this exhaustive presentation boundary.
const remainingCoordinatorLyric = (item: RemainingCoordinatorStoryItem): string => {
  if (isOperatorStoryItem(item)) return operatorLyric(item)
  switch (item._tag) {
    case "DalphSelects":
      return `Dalph selects ${item.operation._tag}.`
    case "GitWorktreeObservationChanged":
      return `Git changes the planned worktree observation to ${item.observation._tag}.`
    case "TaskWorkSpecificationReadReturned":
      return `The task tracker returns "${item.title}" for task ${item.taskId}.`
    case "PlannedAttemptExecutorWorkReported":
      return `The controlled executor reports ${item.report._tag} for attempt ${item.report.attemptId}.`
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

const storyLyric = (item: AuthoredCassetteStoryItem): string =>
  item._tag === "CoordinatorProcessDies"
    ? "The coordinator process and its same-process fake executor die; durable and authority facts remain."
    : coordinatorStoryLyric(item)

/** Readable prose is derived from structured story items and is never parsed. */
export const renderAuthoredCassetteLyrics = (cassette: AuthoredScenarioCassette): string =>
  [`Scenario: ${cassette.name}.`, ...cassette.story.map(storyLyric)].join("\n")
