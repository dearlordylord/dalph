import type { TaskId } from "@dalph/contracts"
import { isExactTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import type { TrackerTarget } from "../../../authorities/task-tracker/target.js"
import { claimReadMatchesTarget } from "../../../workflow-journal/run-target.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
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
  records: ReadonlyArray<JournalRecord>,
  application: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>
) =>
  records.findLast(
    (record): record is AbandonmentRecord =>
      record.event._tag === "AttemptImplementationAbandoned" &&
      sameAttemptChoiceRequestId(record.event.requestId, application.requestId) &&
      sameAttemptChoiceSubject(record.event.subject, application.subject)
  )

export const noReleaseAfter = (
  records: ReadonlyArray<JournalRecord>,
  abandonment: JournalRecord,
  application: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>,
  immutableRunTarget: TrackerTarget
) =>
  records.findLast(
    (record): record is NoReleaseRecord =>
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

export const claimReleaseAfter = (
  records: ReadonlyArray<JournalRecord>,
  abandonment: JournalRecord,
  expectedClaim: Extract<JournalRecord["event"], { readonly _tag: "AttemptImplementationAbandoned" }>["expectedClaim"],
  plannedAttemptTaskId: TaskId,
  immutableRunTarget: TrackerTarget
) =>
  records.findLast((record): record is ClaimReleasedRecord => {
    if (
      record.position <= abandonment.position ||
      record.event._tag !== "TaskClaimReleased" ||
      !isExactTaskClaim(record.event.release.claim, expectedClaim)
    )
      return false
    const released = record.event
    const releaseIntent = records.findLast(
      ({ event, position }) =>
        position > abandonment.position &&
        position < record.position &&
        event._tag === "TaskClaimReleaseIntended" &&
        event.operation.release.operationId === released.release.operationId
    )
    return (
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
  })

export const claimReleaseIntentAfter = (
  records: ReadonlyArray<JournalRecord>,
  abandonment: JournalRecord,
  expectedClaim: Extract<JournalRecord["event"], { readonly _tag: "AttemptImplementationAbandoned" }>["expectedClaim"],
  plannedAttemptTaskId: TaskId,
  immutableRunTarget: TrackerTarget
) =>
  records.findLast((record): record is ClaimReleaseIntentRecord => {
    if (
      record.position <= abandonment.position ||
      record.event._tag !== "TaskClaimReleaseIntended" ||
      !isExactTaskClaim(record.event.operation.release.claim, expectedClaim) ||
      record.event.operation.authority._tag !== "StoppedAttemptClaimReleaseAuthority"
    )
      return false
    return claimReadMatchesTarget(
      records,
      record.event.operation.authority.observationOperationId,
      plannedAttemptTaskId,
      abandonment.position,
      record.position,
      immutableRunTarget
    )
  })
