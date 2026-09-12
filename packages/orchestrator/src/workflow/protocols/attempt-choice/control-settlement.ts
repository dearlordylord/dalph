import type { TaskId } from "@dalph/contracts"
import { isExactTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import type { TrackerTarget } from "../../../authorities/task-tracker/target.js"
import { claimReadMatchesTarget } from "../../../workflow-journal/run-target.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  journalRecordsForAttempt,
  journalRecordsForTask,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import { sameAttemptChoiceRequestId, sameAttemptChoiceSubject } from "./events.js"

type AbandonmentRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptImplementationAbandoned" }>
}

type NoReleaseRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "StoppedAttemptClaimNoReleaseObserved" }>
}

type ClaimReleasedRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimReleased" }>
}

type ClaimReleaseIntentRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimReleaseIntended" }>
}

const isAbandonmentRecord = (
  record: JournalRecord,
  application: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>
): record is AbandonmentRecord => {
  const { event } = record
  return (
    event._tag === "AttemptImplementationAbandoned" &&
    sameAttemptChoiceRequestId(event.requestId, application.requestId) &&
    sameAttemptChoiceSubject(event.subject, application.subject)
  )
}

const isNoReleaseRecord = (
  record: JournalRecord,
  abandonment: JournalRecord,
  application: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>,
  records: JournalHistorySource,
  immutableRunTarget: TrackerTarget
): record is NoReleaseRecord => {
  const { event } = record
  return (
    record.position > abandonment.position &&
    event._tag === "StoppedAttemptClaimNoReleaseObserved" &&
    sameAttemptChoiceRequestId(event.requestId, application.requestId) &&
    sameAttemptChoiceSubject(event.subject, application.subject) &&
    claimReadMatchesTarget(
      records,
      event.observationOperationId,
      application.subject.plannedAttempt.taskId,
      abandonment.position,
      record.position,
      immutableRunTarget
    )
  )
}

const isClaimReleasedRecord = (
  record: JournalRecord,
  expectedClaim: Extract<JournalRecord["event"], { readonly _tag: "AttemptImplementationAbandoned" }>["expectedClaim"]
): record is ClaimReleasedRecord =>
  record.event._tag === "TaskClaimReleased" && isExactTaskClaim(record.event.release.claim, expectedClaim)

const isClaimReleaseIntentRecord = (
  record: JournalRecord,
  expectedClaim: Extract<JournalRecord["event"], { readonly _tag: "AttemptImplementationAbandoned" }>["expectedClaim"]
): record is ClaimReleaseIntentRecord =>
  record.event._tag === "TaskClaimReleaseIntended" &&
  isExactTaskClaim(record.event.operation.release.claim, expectedClaim) &&
  record.event.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority"

const isReleaseIntentFor = (
  record: JournalRecord,
  operationId: ClaimReleasedRecord["event"]["release"]["operationId"]
): record is ClaimReleaseIntentRecord =>
  record.event._tag === "TaskClaimReleaseIntended" && record.event.operation.release.operationId === operationId

export const abandonmentFor = (
  records: JournalHistorySource,
  application: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>
) => {
  let found: AbandonmentRecord | undefined
  for (const record of journalRecordsForAttempt(records, application.subject.plannedAttempt.attemptId)) {
    if (isAbandonmentRecord(record, application)) found = record
  }
  return found
}

export const noReleaseAfter = (
  records: JournalHistorySource,
  abandonment: JournalRecord,
  application: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>,
  immutableRunTarget: TrackerTarget
) => {
  let found: NoReleaseRecord | undefined
  for (const record of journalRecordsForAttempt(records, application.subject.plannedAttempt.attemptId)) {
    if (isNoReleaseRecord(record, abandonment, application, records, immutableRunTarget)) found = record
  }
  return found
}

const lastReleaseIntentBetween = (
  records: JournalHistorySource,
  taskId: TaskId,
  released: ClaimReleasedRecord,
  after: JournalRecord["position"]
): ClaimReleaseIntentRecord | undefined => {
  let releaseIntent: ClaimReleaseIntentRecord | undefined
  for (const candidate of journalRecordsForTask(records, taskId)) {
    if (
      candidate.position > after &&
      candidate.position < released.position &&
      isReleaseIntentFor(candidate, released.event.release.operationId)
    )
      releaseIntent = candidate
  }
  return releaseIntent
}

export const claimReleaseAfter = (
  records: JournalHistorySource,
  abandonment: JournalRecord,
  expectedClaim: Extract<JournalRecord["event"], { readonly _tag: "AttemptImplementationAbandoned" }>["expectedClaim"],
  plannedAttemptTaskId: TaskId,
  immutableRunTarget: TrackerTarget
) => {
  let found: ClaimReleasedRecord | undefined
  for (const record of journalRecordsForTask(records, plannedAttemptTaskId)) {
    if (record.position <= abandonment.position || !isClaimReleasedRecord(record, expectedClaim)) continue
    const releaseIntent = lastReleaseIntentBetween(records, plannedAttemptTaskId, record, abandonment.position)
    if (
      releaseIntent !== undefined &&
      releaseIntent.event.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority" &&
      claimReadMatchesTarget(
        records,
        releaseIntent.event.operation.authority.observationOperationId,
        plannedAttemptTaskId,
        abandonment.position,
        releaseIntent.position,
        immutableRunTarget
      )
    )
      found = record
  }
  return found
}

export const claimReleaseIntentAfter = (
  records: JournalHistorySource,
  abandonment: JournalRecord,
  expectedClaim: Extract<JournalRecord["event"], { readonly _tag: "AttemptImplementationAbandoned" }>["expectedClaim"],
  plannedAttemptTaskId: TaskId,
  immutableRunTarget: TrackerTarget
) => {
  let found: ClaimReleaseIntentRecord | undefined
  for (const record of journalRecordsForTask(records, plannedAttemptTaskId)) {
    if (record.position <= abandonment.position || !isClaimReleaseIntentRecord(record, expectedClaim)) continue
    if (record.event.operation.authority._tag !== "StoppedAttemptClaimReleaseAuthority") continue
    if (
      claimReadMatchesTarget(
        records,
        record.event.operation.authority.observationOperationId,
        plannedAttemptTaskId,
        abandonment.position,
        record.position,
        immutableRunTarget
      )
    )
      found = record
  }
  return found
}
