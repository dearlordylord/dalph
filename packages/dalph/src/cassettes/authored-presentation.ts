import type { AuthoredCassetteStoryItem, AuthoredScenarioCassette } from "./authored-domain.js"

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
              : item._tag === "ExpectedObservedOutcomes"
                ? `The story expects the complete ordered sequence of ${item.expected.length} outcomes and forbids ${item.forbidden.length}.`
                : `The unsupported story asks Dalph to change task-execution capacity to ${item.capacity}.`

/** Readable prose is derived from structured story items and is never parsed. */
export const renderAuthoredCassetteLyrics = (cassette: AuthoredScenarioCassette): string =>
  [`Scenario: ${cassette.name}.`, ...cassette.story.map(storyLyric)].join("\n")
