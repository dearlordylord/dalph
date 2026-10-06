import type { RunId } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import type { JournalService } from "../../../coordination/delivery/journal.js"
import { JournalRecordKey } from "../../../workflow-journal/identity.js"
import {
  journalRecordByKey,
  journalRecordsForTask,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import { intentRecordKey, outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  ApplyTaskAttemptBaseRetryRequest,
  TaskAttemptBaseRetryRejected,
  TaskAttemptBaseRetryRequestedEvent,
  type TaskAttemptBaseRetryRequestId
} from "./retry-data.js"

export const taskAttemptBaseRetryRecordKey = (refusedReadOperationId: OperationId) =>
  JournalRecordKey.make(`task-attempt-base-retry:${refusedReadOperationId}`)

/** Stable identities for each fresh tracker observation authorized by a recorded retry. */
export const taskAttemptBaseRetryFactOperationId = (
  requestId: TaskAttemptBaseRetryRequestId,
  family: "Graph" | "Claim" | "Specification"
) => OperationId.make(`task-attempt-base-retry:${JSON.stringify([requestId, family])}`)

export const taskAttemptBaseRetryRejection = (
  records: JournalHistorySource,
  runId: RunId,
  request: ApplyTaskAttemptBaseRetryRequest
): TaskAttemptBaseRetryRejected["reason"] | undefined => {
  if (request.subject.runId !== runId) return "RunMismatch"
  const existing = journalRecordByKey(records, taskAttemptBaseRetryRecordKey(request.subject.refusedReadOperationId))
  if (existing?.event._tag === "TaskAttemptBaseRetryRequested")
    return Schema.toEquivalence(ApplyTaskAttemptBaseRetryRequest)(existing.event, request)
      ? undefined
      : "AlreadyRequested"
  if (
    Array.from(journalRecordsOfKind(records, "TaskAttemptBaseRetryRequested")).some(
      ({ event }) => event._tag === "TaskAttemptBaseRetryRequested" && event.requestId === request.requestId
    )
  )
    return "RequestIdentityConflict"
  if (
    Array.from(journalRecordsForTask(records, request.subject.taskId)).some(
      ({ event }) => event._tag === "TaskAttemptPlanned"
    )
  )
    return "PlanExists"
  const intent = journalRecordByKey(records, intentRecordKey(request.subject.refusedReadOperationId))
  const outcome = journalRecordByKey(records, outcomeRecordKey(request.subject.refusedReadOperationId))
  return intent?.event._tag === "TaskAttemptBaseReadIntended" &&
    intent.event.operation.taskId === request.subject.taskId &&
    outcome?.event._tag === "TaskAttemptBaseObserved" &&
    outcome.event.observation._tag === "Refused" &&
    intent.position < outcome.position
    ? undefined
    : "NotRefused"
}

/** The serialized Operator ingress records authority only; it performs no tracker or Git call. */
export const applyTaskAttemptBaseRetry = Effect.fn("TaskAttemptBaseRetry.apply")(function* (
  journal: JournalService,
  runId: RunId,
  input: unknown
) {
  const request = yield* Schema.decodeUnknownEffect(ApplyTaskAttemptBaseRetryRequest, { onExcessProperty: "error" })(
    input
  )
  const history = (yield* journal.state.get).prefix
  const rejection = taskAttemptBaseRetryRejection(history, runId, request)
  if (rejection !== undefined) return yield* new TaskAttemptBaseRetryRejected({ reason: rejection })
  const record = yield* journal.append(
    runId,
    taskAttemptBaseRetryRecordKey(request.subject.refusedReadOperationId),
    TaskAttemptBaseRetryRequestedEvent.make({
      ...request,
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
  return { ...request, acceptedAt: record.position }
})

/** Receipt lookup is passive, including after termination; absence grants no retry authority. */
export const readTaskAttemptBaseRetryRequest = Effect.fn("TaskAttemptBaseRetry.read")(function* (
  journal: JournalService,
  runId: RunId,
  input: unknown
) {
  const request = yield* Schema.decodeUnknownEffect(ApplyTaskAttemptBaseRetryRequest, { onExcessProperty: "error" })(
    input
  )
  if (request.subject.runId !== runId) return yield* new TaskAttemptBaseRetryRejected({ reason: "RunMismatch" })
  const records = (yield* journal.state.get).prefix
  const recorded = Array.from(journalRecordsOfKind(records, "TaskAttemptBaseRetryRequested")).find(
    ({ event }) => event._tag === "TaskAttemptBaseRetryRequested" && event.requestId === request.requestId
  )
  if (recorded?.event._tag !== "TaskAttemptBaseRetryRequested") return { _tag: "NotRecorded" as const }
  if (!Schema.toEquivalence(ApplyTaskAttemptBaseRetryRequest)(recorded.event, request))
    return yield* new TaskAttemptBaseRetryRejected({ reason: "RequestIdentityConflict" })
  return { _tag: "Recorded" as const, ...request, acceptedAt: recorded.position }
})
