import {
  samePlannedTaskAttempt,
  executorGuidanceTextByteLimit,
  ExecutorGuidanceTransmission,
  type RunId
} from "@dalph/contracts"
import { Schema } from "effect"
import type { WorkflowJournalEvent } from "../../registry/event.js"
import {
  journalRecordByKey,
  journalRecordsForAttempt,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import {
  executorGuidanceAdmittedRecordKey,
  executorGuidanceDispatchIntendedRecordKey,
  executorGuidanceObservedRecordKey
} from "../../../workflow-journal/record-key.js"
import { recordedTaskAttemptPlanFor } from "../task-attempt-planning/journal-evidence.js"
import { latestAcceptedPlannedAttemptExecutorEvidence } from "../planned-attempt-executor-work/evidence.js"
import { ExecutorGuidanceMetadata } from "./events.js"

export type ExecutorGuidanceJournalEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "ExecutorGuidanceAdmitted" | "ExecutorGuidanceDispatchIntended" | "ExecutorGuidanceObserved" }
>
const sameMetadata = Schema.toEquivalence(ExecutorGuidanceMetadata)

/** Information never changes the admitted plan or bypasses a terminal/integration cutoff. */
export const executorGuidanceDispatchProblem = (
  records: JournalHistorySource,
  attempt: Parameters<typeof recordedTaskAttemptPlanFor>[1]
): string | undefined => {
  if (recordedTaskAttemptPlanFor(records, attempt) === undefined)
    return "guidance selection differs from its immutable plan"
  const evidence = latestAcceptedPlannedAttemptExecutorEvidence(records, attempt)
  if (evidence?.report._tag !== "ExecutorWorkExecuting")
    return "guidance requires accepted executing implementation work"
  for (const { event } of journalRecordsForAttempt(records, attempt.attemptId)) {
    if (
      event._tag === "IntegrationStarted" ||
      event._tag === "PlannedAttemptReplaced" ||
      event._tag === "ResultRecoveryAttemptReplaced"
    )
      return "guidance selection crossed its implementation cutoff"
  }
  return undefined
}

/** Chronological admission shared by journal validation and the guidance model adapter. */
export const executorGuidanceEventProblem = (
  records: JournalHistorySource,
  runId: RunId,
  event: ExecutorGuidanceJournalEvent
): string | undefined => {
  if (event._tag === "ExecutorGuidanceAdmitted") {
    if (event.metadata.plannedAttempt.runId !== runId) return "guidance admission names another Run"
    if (recordedTaskAttemptPlanFor(records, event.metadata.plannedAttempt) === undefined)
      return "guidance admission differs from its immutable plan"
    const prior = journalRecordByKey(records, executorGuidanceAdmittedRecordKey(event.metadata.requestId))
    return prior?.event._tag === "ExecutorGuidanceAdmitted" && !sameMetadata(prior.event.metadata, event.metadata)
      ? "guidance request identity was reused for another input"
      : undefined
  }
  const admitted = journalRecordByKey(records, executorGuidanceAdmittedRecordKey(event.requestId))
  if (admitted?.event._tag !== "ExecutorGuidanceAdmitted") return "guidance effect has no exact admission"
  const metadata = admitted.event.metadata
  if (metadata.plannedAttempt.runId !== runId) return "guidance effect names another Run"
  const observed = journalRecordByKey(records, executorGuidanceObservedRecordKey(event.requestId))
  if (observed !== undefined) return "guidance request already has an observed disposition"
  const intended = journalRecordByKey(records, executorGuidanceDispatchIntendedRecordKey(event.requestId))
  if (event._tag === "ExecutorGuidanceDispatchIntended") {
    if (metadata.payloadBytes > executorGuidanceTextByteLimit) return "oversized guidance cannot authorize transmission"
    if (intended !== undefined) return "guidance request already has transmission intent"
    if (!samePlannedTaskAttempt(event.target.plannedAttempt, metadata.plannedAttempt))
      return "guidance target differs from its admitted attempt"
    return executorGuidanceDispatchProblem(records, metadata.plannedAttempt)
  }
  if (event.disposition._tag !== "Refused" && intended?.event._tag !== "ExecutorGuidanceDispatchIntended")
    return "guidance acknowledgement or uncertainty has no exact transmission intent"
  if (event.disposition._tag === "Refused" && event.disposition.reason === "PayloadLost" && intended !== undefined)
    return "possible transmission cannot be downgraded to lost unsent text"
  return undefined
}

/** Redelivery reads retained metadata and disposition; caller text cannot recreate a lost effect. */
export const executorGuidanceRedelivery = (
  records: JournalHistorySource,
  metadata: ExecutorGuidanceMetadata
):
  | { readonly _tag: "New" }
  | { readonly _tag: "Contradiction" }
  | { readonly _tag: "Retained" | "Observe"; readonly disposition: ExecutorGuidanceTransmission } => {
  const admitted = journalRecordByKey(records, executorGuidanceAdmittedRecordKey(metadata.requestId))
  if (admitted === undefined) return { _tag: "New" }
  if (admitted.event._tag !== "ExecutorGuidanceAdmitted" || !sameMetadata(admitted.event.metadata, metadata))
    return { _tag: "Contradiction" }
  const observed = journalRecordByKey(records, executorGuidanceObservedRecordKey(metadata.requestId))
  if (observed?.event._tag === "ExecutorGuidanceObserved")
    return { _tag: "Retained", disposition: observed.event.disposition }
  const intended = journalRecordByKey(records, executorGuidanceDispatchIntendedRecordKey(metadata.requestId))
  return {
    _tag: "Observe",
    disposition:
      intended === undefined
        ? ExecutorGuidanceTransmission.cases.Refused.make({ reason: "PayloadLost" })
        : ExecutorGuidanceTransmission.cases.Unknown.make({})
  }
}
