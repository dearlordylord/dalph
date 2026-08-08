import { type JournalRecord } from "../../workflow-journal/store.js"

export interface RunPolicyHistoryIndex {
  readonly latestRunPolicyRevision: number | undefined
}

export interface RunPolicyHistoryValidation {
  readonly details: ReadonlyArray<string>
  readonly latestRunPolicyRevision: number | undefined
}

/** Validates the strictly increasing durable policy revision for one Run. */
export const validateRunPolicyHistory = (
  record: JournalRecord,
  index: RunPolicyHistoryIndex
): RunPolicyHistoryValidation => {
  const event = record.event
  if (event._tag === "WorkflowRunBegan") {
    return { details: [], latestRunPolicyRevision: 1 }
  }
  if (event._tag !== "TaskWorkCapacityChanged") {
    return { details: [], latestRunPolicyRevision: index.latestRunPolicyRevision }
  }
  const latest = index.latestRunPolicyRevision
  const predecessorDetails =
    latest === undefined
      ? ["TaskWorkCapacityChanged requires prior WorkflowRunBegan"]
      : event.previousRevision !== latest
        ? [`task-work capacity expected previous policy revision ${latest}, found ${event.previousRevision}`]
        : []
  const revisionDetails =
    event.revision === event.previousRevision + 1
      ? []
      : [`task-work capacity revision ${event.revision} must immediately follow ${event.previousRevision}`]
  return { details: [...predecessorDetails, ...revisionDetails], latestRunPolicyRevision: event.revision }
}
