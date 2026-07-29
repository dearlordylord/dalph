import type { AuthoredCassetteDecision, AuthoredOutsideOccurrence } from "./authored.js"

export const lyricForExpectedDecision = (decision: AuthoredCassetteDecision): string => {
  switch (decision._tag) {
    case "AcquireTaskClaim":
      return `Dalph is expected to decide to acquire the claim for task ${decision.taskId}.`
    case "ReadTaskWorkSpecification":
      return `Dalph is expected to decide to read the work specification for task ${decision.taskId}.`
    case "ReadTrackerGraph":
      return `Dalph is expected to decide to read tracker target ${JSON.stringify(decision.target)}.`
    case "ReconcileTaskWorktree":
      return `Dalph is expected to decide to reconcile the worktree for attempt ${decision.attemptId}.`
    case "RecordTaskAttemptPlan":
      return `Dalph is expected to decide to record the plan for attempt ${decision.attemptId}.`
  }
}

export const lyricForOutsideOccurrence = (occurrence: AuthoredOutsideOccurrence): string => {
  switch (occurrence._tag) {
    case "PlannedAttemptExecutorWorkReported":
      return `The controlled executor will report ${occurrence.report._tag} for attempt ${occurrence.report.correlation.attemptId}.`
    case "TaskWorkSpecificationEditedWithoutDalphObservation":
      return `Another person edits task ${occurrence.taskId}, but Dalph never observes that edit.`
    case "TaskWorkSpecificationReadReturned":
      return `The task tracker returns "${occurrence.title}" for task ${occurrence.taskId}.`
    case "TrackerGraphReadReturned":
      return `The task tracker returns ${occurrence.graph.tasks.length} task graph facts at ${occurrence.graph.revision}.`
  }
}
