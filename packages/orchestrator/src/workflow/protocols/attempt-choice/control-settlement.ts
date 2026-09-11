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

export const abandonmentFor = (
  records: JournalHistorySource,
  application: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>
) => {
  let found: AbandonmentRecord | undefined
  for (const record of journalRecordsForAttempt(records, application.subject.plannedAttempt.attemptId)) {
    if (
      record.event._tag === "AttemptImplementationAbandoned" &&
      sameAttemptChoiceRequestId(record.event.requestId, application.requestId) &&
      sameAttemptChoiceSubject(record.event.subject, application.subject)
    ) {
      found = record as AbandonmentRecord
    }
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
    if (
      record.position > abandonment.position &&
      record.event._tag === "StoppedAttemptClaimNoReleaseObserved" &&
      sameAttemptChoiceRequestId(record.event.requestId, application.requestId) &&
      sameAttemptChoiceSubject(record.event.subject, application.subject) &&
      claimReadMatchesTarget(
        records,
        record.event.observationOperationId,
        application.subject.plannedAttempt.taskId,
        abandonment.position,
        record.position,
        immutableRunTarget
      )
    )
      found = record as NoReleaseRecord
  }
  return found
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
    if (
      record.position <= abandonment.position ||
      record.event._tag !== "TaskClaimReleased" ||
      !isExactTaskClaim(record.event.release.claim, expectedClaim)
    )
      continue
    const released = record.event
    let releaseIntent: ClaimReleaseIntentRecord | undefined
    for (const candidate of journalRecordsForTask(records, plannedAttemptTaskId)) {
      const { event, position } = candidate
      if (
        position > abandonment.position &&
        position < record.position &&
        event._tag === "TaskClaimReleaseIntended" &&
        event.operation.release.operationId === released.release.operationId
      )
        releaseIntent = candidate as ClaimReleaseIntentRecord
    }
    if (
      releaseIntent?.event._tag === "TaskClaimReleaseIntended" &&
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
      found = record as ClaimReleasedRecord
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
    if (
      record.position <= abandonment.position ||
      record.event._tag !== "TaskClaimReleaseIntended" ||
      !isExactTaskClaim(record.event.operation.release.claim, expectedClaim) ||
      record.event.operation.authority._tag !== "StoppedAttemptClaimReleaseAuthority"
    )
      continue
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
      found = record as ClaimReleaseIntentRecord
  }
  return found
}
