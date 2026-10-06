import type { AttemptId, RunId, TaskId } from "@dalph/contracts"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import {
  executorReportProvesStoppedWriters,
  latestAcceptedPlannedAttemptExecutorEvidence,
  latestUnsettledPlannedAttemptExecutorCommand
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import type { ReconstructedRunState } from "../reconstruction/state.js"
import { journalRecordsForAttemptKind } from "../../workflow-journal/record-evidence.js"
export { requiredPreStartTaskWorkPositionsOf } from "./required-pre-start-task-work-positions.js"

/** One exact planned attempt whose unfinished work still requires a process-local task-work position. */
export interface RequiredPlannedAttemptPosition {
  readonly attemptId: AttemptId
  readonly runId: RunId
  readonly taskId: TaskId
}

/**
 * Derives the positions Dalph must recreate from accepted journal history.
 * An executor report proving stopped writers releases the position until a later
 * command makes that exact attempt unresolved again.
 */
export const requiredPlannedAttemptPositionsOf = (
  runState: Pick<ReconstructedRunState, "responsibility" | "workflowHistory">
): ReadonlyArray<RequiredPlannedAttemptPosition> => {
  const records = runState.workflowHistory.evidence
  return runState.responsibility.entries.flatMap((responsibility) => {
    if (responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility") return []
    const plannedAttempt = responsibility.plannedAttempt
    const abandoned = Array.from(
      journalRecordsForAttemptKind(records, plannedAttempt.attemptId, "AttemptImplementationAbandoned")
    ).some(
      ({ event }) =>
        event._tag === "AttemptImplementationAbandoned" &&
        plannedTaskAttemptEquivalence(event.subject.plannedAttempt, plannedAttempt)
    )
    const evidence = latestAcceptedPlannedAttemptExecutorEvidence(records, plannedAttempt)
    const unsettledCommandExists = latestUnsettledPlannedAttemptExecutorCommand(records, plannedAttempt) !== undefined
    if (
      abandoned ||
      (evidence !== undefined && !unsettledCommandExists && executorReportProvesStoppedWriters(evidence.report))
    ) {
      return []
    }
    return [{ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }]
  })
}
