import { Match } from "effect"
import { deriveJournalResponsibilityFacts, type reduceWorkflowJournalHistory } from "@dalph/orchestrator"

export const semanticJson = (value: unknown): string => JSON.stringify(value)

type ValidWorkflowJournalHistory = Extract<
  ReturnType<typeof reduceWorkflowJournalHistory>,
  { readonly _tag: "ValidWorkflowJournalHistory" }
>

const semanticResponsibilityEntry = (
  entry: ValidWorkflowJournalHistory["runState"]["responsibility"]["entries"][number]
) =>
  Match.value(entry).pipe(
    Match.tagsExhaustive({
      PlannedAttemptExecutorWorkResponsibility: (value) => ({ _tag: value._tag, plannedAttempt: value.plannedAttempt }),
      TaskClaimResponsibility: (value) => ({ _tag: value._tag, acquisition: value.acquisition, taskId: value.taskId }),
      TaskClaimReleaseResponsibility: (value) => ({
        _tag: value._tag,
        operation: value.operation,
        taskId: value.taskId
      }),
      TaskWorktreeResponsibility: (value) => ({ _tag: value._tag, operation: value.operation, taskId: value.taskId })
    })
  )

const semanticResponsibility = (history: ValidWorkflowJournalHistory) =>
  history.runState.responsibility.entries
    .map(semanticResponsibilityEntry)
    .toSorted((left, right) => semanticJson(left).localeCompare(semanticJson(right)))

/** The current pure selection projection is one disposition per reconstructed responsibility. */
export const semanticResponsibilityFacts = (history: ValidWorkflowJournalHistory): unknown =>
  deriveJournalResponsibilityFacts(history.runState)
    .map(({ _tag, disposition, responsibility }) => ({
      _tag,
      disposition,
      responsibility: semanticResponsibilityEntry(responsibility)
    }))
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
