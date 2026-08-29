import type { AttemptId, RunId, TaskId } from "@dalph/contracts"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import {
  latestAcceptedPlannedAttemptExecutorEvidence,
  latestUnsettledPlannedAttemptExecutorCommand
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import type { ReconstructedRunState } from "../reconstruction/state.js"

/** One exact planned attempt whose unfinished work still requires a process-local task-work position. */
export interface RequiredPlannedAttemptPosition {
  readonly attemptId: AttemptId
  readonly runId: RunId
  readonly taskId: TaskId
}

/**
 * Derives the positions Dalph must recreate from accepted journal history.
 * A safe or terminal executor report releases the position only until a later
 * command makes that exact attempt unresolved again.
 */
export const requiredPlannedAttemptPositionsOf = (
  runState: Pick<ReconstructedRunState, "responsibility" | "workflowHistory">
): ReadonlyArray<RequiredPlannedAttemptPosition> => {
  const records = runState.workflowHistory.records
  return runState.responsibility.entries.flatMap((responsibility) => {
    if (responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility") return []
    const plannedAttempt = responsibility.plannedAttempt
    const abandoned = records.some(
      ({ event }) =>
        event._tag === "AttemptImplementationAbandoned" &&
        plannedTaskAttemptEquivalence(event.subject.plannedAttempt, plannedAttempt)
    )
    const evidence = latestAcceptedPlannedAttemptExecutorEvidence(records, plannedAttempt)
    const unsettledCommandExists = latestUnsettledPlannedAttemptExecutorCommand(records, plannedAttempt) !== undefined
    if (
      abandoned ||
      (evidence !== undefined &&
        !unsettledCommandExists &&
        (evidence.report._tag === "ExecutorWorkSafelySuspended" || evidence.report._tag === "ExecutorWorkTerminal"))
    ) {
      return []
    }
    return [{ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }]
  })
}
