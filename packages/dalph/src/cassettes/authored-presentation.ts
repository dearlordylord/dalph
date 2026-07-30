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

const protocolEvidenceLyric = (evidence: AuthoredProtocolEvidence): string => {
  switch (evidence._tag) {
    case "TaskClaimAcquired":
      return `The story expects Dalph to acquire the claim for task ${evidence.taskId}.`
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

const coordinatorStoryLyric = (item: CoordinatorStoryItem): string => {
  if (isTrackerGraphStoryItem(item)) return trackerGraphLyric(item)
  return item._tag === "InitialControlPolicy"
    ? `Dalph starts with task-execution capacity ${item.policy.taskExecutionCapacity}.`
    : item._tag === "RunCoordinator"
      ? `The maintainer asks Dalph to coordinate ${JSON.stringify(item.target)}.`
      : item._tag === "DalphSelects"
        ? `Dalph selects ${item.operation._tag}.`
        : item._tag === "TaskWorkSpecificationReadReturned"
          ? `The task tracker returns "${item.title}" for task ${item.taskId}.`
          : item._tag === "PlannedAttemptExecutorWorkReported"
            ? `The controlled executor reports ${item.report._tag} for attempt ${item.report.attemptId}.`
            : item._tag === "ExpectedBehavior"
              ? expectedBehaviorLyric(item)
              : `Operator applies task-execution capacity ${item.capacity} to the Run.`
}

const storyLyric = (item: AuthoredCassetteStoryItem): string =>
  item._tag === "CoordinatorProcessDies"
    ? "The coordinator process and its same-process fake executor die; durable and authority facts remain."
    : coordinatorStoryLyric(item)

/** Readable prose is derived from structured story items and is never parsed. */
export const renderAuthoredCassetteLyrics = (cassette: AuthoredScenarioCassette): string =>
  [`Scenario: ${cassette.name}.`, ...cassette.story.map(storyLyric)].join("\n")
