import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { Effect } from "effect"
import { isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { AcceptedJournalReader } from "../../workflow-journal/accepted-reader.js"
import { type JournalRecord } from "../../workflow-journal/store.js"
import {
  journalRecordsForAttemptKind,
  journalRecordsForOperationId,
  lastJournalRecordForAttemptKind,
  type JournalHistorySource
} from "../../workflow-journal/record-evidence.js"
import { cancelledAttemptClaimNoReleaseRecordKey } from "../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { CancelledAttemptClaimNoReleaseObservedEvent } from "../../workflow/protocols/run-cancellation/events.js"
import { taskTrackerObservationMatchesRead } from "../../workflow/task-tracker-facts/observation-match.js"
import type { IdentityFreeWorkflowTransition } from "./delivery-action-proposal.js"
import { ExpectedAcceptedPrefixPosition, Journal } from "./journal.js"

type FocusedClaimObservationRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }> & {
    readonly observation: Extract<
      Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>["observation"],
      { readonly _tag: "FocusedTaskClaimFacts" }
    >
  }
}

type CancelledAttemptAbandonedRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "CancelledAttemptImplementationAbandoned" }>
}

type CancelledAttemptClaimNoReleaseTransition = Extract<
  IdentityFreeWorkflowTransition,
  { readonly _tag: "RecordCancelledAttemptClaimNoRelease" }
>

const hasMatchingCancelledAttemptClaimRead = (
  observation: FocusedClaimObservationRecord,
  readIntent: JournalRecord | undefined,
  transition: CancelledAttemptClaimNoReleaseTransition,
  abandoned: CancelledAttemptAbandonedRecord
): boolean => {
  if (readIntent?.event._tag !== "TaskTrackerReadIntentRecorded") return false
  if (readIntent.event.operation._tag !== "ReadTaskClaim") return false
  return (
    readIntent.event.operation.taskId === transition.plannedAttempt.taskId &&
    readIntent.event.operation.predecessorOperationIds.includes(abandoned.event.authorizedClaim.operationId) &&
    taskTrackerObservationMatchesRead(observation.event.observation, readIntent.event.operation)
  )
}

const exactCancelledAttemptAbandonment = (
  records: JournalHistorySource,
  transition: CancelledAttemptClaimNoReleaseTransition
): CancelledAttemptAbandonedRecord | undefined => {
  const candidate = lastJournalRecordForAttemptKind(
    records,
    transition.plannedAttempt.attemptId,
    "CancelledAttemptImplementationAbandoned"
  )
  return candidate?.event._tag === "CancelledAttemptImplementationAbandoned" &&
    plannedTaskAttemptEquivalence(candidate.event.plannedAttempt, transition.plannedAttempt)
    ? { ...candidate, event: candidate.event }
    : undefined
}

const cancelledAttemptClaimNoReleaseFacts = (
  records: JournalHistorySource,
  transition: CancelledAttemptClaimNoReleaseTransition
) => {
  if (
    Array.from(
      journalRecordsForAttemptKind(
        records,
        transition.plannedAttempt.attemptId,
        "CancelledAttemptClaimNoReleaseObserved"
      )
    ).some(
      ({ event }) =>
        event._tag === "CancelledAttemptClaimNoReleaseObserved" &&
        plannedTaskAttemptEquivalence(event.plannedAttempt, transition.plannedAttempt)
    )
  )
    return undefined
  const abandoned = exactCancelledAttemptAbandonment(records, transition)
  if (abandoned === undefined) return undefined
  // An intended release owns reconciliation even when its effect has already removed the claim.
  if (
    Array.from(journalRecordsForOperationId(records, abandoned.event.authorizedClaim.operationId)).some(
      ({ event, position }) =>
        position > abandoned.position &&
        event._tag === "TaskClaimReleaseIntended" &&
        event.operation.authority._tag === "CancelledAttemptClaimReleaseAuthority" &&
        event.operation.authority.cancellationAppliedAt === abandoned.event.cancellationAppliedAt &&
        event.operation.authority.implementationAbandonedAt === abandoned.position &&
        isExactTaskClaim(event.operation.release.claim, abandoned.event.authorizedClaim)
    )
  )
    return undefined
  const operationRecords = Array.from(journalRecordsForOperationId(records, transition.observationOperationId))
  const observation = operationRecords.findLast(
    (record): record is FocusedClaimObservationRecord =>
      record.position > abandoned.position &&
      record.event._tag === "TaskTrackerFactsObserved" &&
      record.event.operationId === transition.observationOperationId &&
      record.event.observation._tag === "FocusedTaskClaimFacts" &&
      record.event.observation.coverage.taskId === transition.plannedAttempt.taskId
  )
  if (observation === undefined) return undefined
  const readIntent = operationRecords.findLast(
    (record) =>
      record.position > abandoned.position &&
      record.position < observation.position &&
      record.event._tag === "TaskTrackerReadIntentRecorded" &&
      record.event.operation.operationId === observation.event.operationId
  )
  if (!hasMatchingCancelledAttemptClaimRead(observation, readIntent, transition, abandoned)) return undefined
  if (
    observation.event.observation.observation._tag === "ActiveTaskClaim" &&
    isExactTaskClaim(observation.event.observation.observation, abandoned.event.authorizedClaim)
  )
    return undefined
  return { observation, abandoned }
}

/** Records no-release only against the exact accepted cancellation prefix with no intended release. */
export const executeCancelledAttemptClaimNoRelease = Effect.fn("DeliveryAction.executeCancelledAttemptClaimNoRelease")(
  function* (transition: CancelledAttemptClaimNoReleaseTransition) {
    const journal = yield* Journal
    const records = yield* (yield* AcceptedJournalReader).readAccepted(transition.plannedAttempt.runId)
    const facts = cancelledAttemptClaimNoReleaseFacts(records, transition)
    if (facts === undefined || records.lastPosition === null) return
    return yield* journal.appendIfAcceptedPrefixCurrent(
      transition.plannedAttempt.runId,
      ExpectedAcceptedPrefixPosition.make(records.lastPosition),
      cancelledAttemptClaimNoReleaseRecordKey(transition.plannedAttempt.attemptId),
      CancelledAttemptClaimNoReleaseObservedEvent.make({
        cancellationAppliedAt: facts.abandoned.event.cancellationAppliedAt,
        expectedClaim: facts.abandoned.event.authorizedClaim,
        observation: facts.observation.event.observation.observation,
        observationOperationId: facts.observation.event.operationId,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt: transition.plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
  }
)
