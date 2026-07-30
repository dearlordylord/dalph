import type {
  AuthoredCassetteStoryItem,
  AuthoredOrchestrationEvidence,
  AuthoredProtocolEvidence,
  AuthoredScenarioCassette,
  AuthoredTaskWorkResult
} from "./authored-domain.js"

const taskWorkResultLyric = (result: AuthoredTaskWorkResult): string =>
  result._tag === "PlannedWorkForTaskCompleted"
    ? `The story expects the planned work for task ${result.taskId} to complete.`
    : `The story expects the planned work for task ${result.taskId} to fail.`

const orchestrationEvidenceLyric = (evidence: AuthoredOrchestrationEvidence): string =>
  evidence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
    ? `The story expects Dalph to assume executor-work responsibility for task ${evidence.taskId}, attempt ${evidence.attemptId}.`
    : `The story expects executor report ${evidence.report} for attempt ${evidence.attemptId}.`

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

const storyLyric = (item: AuthoredCassetteStoryItem): string =>
  item._tag === "InitialControlPolicy"
    ? `Dalph starts with task-execution capacity ${item.policy.taskExecutionCapacity}.`
    : item._tag === "RunCoordinator"
      ? `The maintainer asks Dalph to coordinate ${JSON.stringify(item.target)}.`
      : item._tag === "DalphSelects"
        ? `Dalph selects ${item.operation._tag}.`
        : item._tag === "TrackerGraphReadReturned"
          ? `The task tracker returns ${item.graph.tasks.length} task graph facts at ${item.graph.revision}.`
          : item._tag === "TaskWorkSpecificationReadReturned"
            ? `The task tracker returns "${item.title}" for task ${item.taskId}.`
            : item._tag === "PlannedAttemptExecutorWorkReported"
              ? `The controlled executor reports ${item.report._tag} for attempt ${item.report.attemptId}.`
              : item._tag === "ExpectedBehavior"
                ? expectedBehaviorLyric(item)
                : `The unsupported story asks Dalph to change task-execution capacity to ${item.capacity}.`

/** Readable prose is derived from structured story items and is never parsed. */
export const renderAuthoredCassetteLyrics = (cassette: AuthoredScenarioCassette): string =>
  [`Scenario: ${cassette.name}.`, ...cassette.story.map(storyLyric)].join("\n")
