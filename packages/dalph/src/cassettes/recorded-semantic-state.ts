import type { reduceWorkflowJournalHistory } from "@dalph/orchestrator"

export const semanticJson = (value: unknown): string => JSON.stringify(value)

const semanticResponsibility = (
  history: Extract<ReturnType<typeof reduceWorkflowJournalHistory>, { readonly _tag: "ValidWorkflowJournalHistory" }>
) =>
  history.runState.responsibility.entries
    .map((entry) => {
      switch (entry._tag) {
        case "PlannedAttemptExecutorWorkResponsibility":
          return { _tag: entry._tag, plannedAttempt: entry.plannedAttempt }
        case "TaskClaimResponsibility":
          return { _tag: entry._tag, acquisition: entry.acquisition, taskId: entry.taskId }
        case "TaskClaimReleaseResponsibility":
          return { _tag: entry._tag, operation: entry.operation, taskId: entry.taskId }
        case "TaskWorktreeResponsibility":
          return { _tag: entry._tag, operation: entry.operation, taskId: entry.taskId }
      }
    })
    .toSorted((left, right) => semanticJson(left).localeCompare(semanticJson(right)))

export const semanticState = (history: ReturnType<typeof reduceWorkflowJournalHistory>): unknown =>
  history._tag === "InvalidWorkflowJournalHistory"
    ? { _tag: history._tag, issueKinds: history.issues.map(({ _tag }) => _tag) }
    : {
        graphKnowledge: history.runState.graphKnowledge,
        pause: history.runState.pause,
        responsibility: semanticResponsibility(history),
        runId: history.runId
      }

export const appliedOccurrencePosition = (history: ReturnType<typeof reduceWorkflowJournalHistory>): number =>
  history._tag === "InvalidWorkflowJournalHistory" ? 0 : history.runState.workflowHistory.records.length
