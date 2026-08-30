import { type AttemptId, type TaskId } from "@dalph/contracts"
import { type JournalRecord } from "@dalph/orchestrator"
import { Option } from "effect"
import { type AuthoredTaskWorkResult } from "./authored-domain.js"

export const taskWorkResultFor = (
  event: JournalRecord["event"],
  taskByAttempt: ReadonlyMap<AttemptId, TaskId>
): ReadonlyArray<AuthoredTaskWorkResult> => {
  if (event._tag !== "PlannedAttemptExecutorWorkReported" || event.report._tag !== "ExecutorWorkTerminal") return []
  const taskId = Option.getOrThrow(Option.fromUndefinedOr(taskByAttempt.get(event.report.correlation.attemptId)))
  return [
    event.report.result._tag === "Accepted"
      ? { _tag: "PlannedWorkForTaskAccepted", commit: event.report.result.acceptedResult.commit, taskId }
      : event.report.result._tag === "Completed"
        ? { _tag: "PlannedWorkForTaskCompleted", taskId }
        : { _tag: "PlannedWorkForTaskFailed", taskId }
  ]
}
