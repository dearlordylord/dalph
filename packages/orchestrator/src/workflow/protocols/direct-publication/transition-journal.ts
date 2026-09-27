import type { RunId } from "@dalph/contracts"
import { Effect } from "effect"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import {
  journalRecordByPosition,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import {
  remotePublicationAttemptIntendedRecordKey,
  remotePublicationAttemptRejectedRecordKey,
  remotePublicationIntendedRecordKey,
  remotePublicationRetainedRecordKey,
  remotePublicationResumeRequestedRecordKey,
  remotePublicationSucceededRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import {
  RemotePublicationAttemptIntendedEvent,
  RemotePublicationAttemptRejectedNonFastForwardEvent,
  type RemotePublicationAttemptOrdinal,
  type RemotePublicationCorrelation,
  RemotePublicationIntendedEvent,
  type RemotePublicationAttemptAuthorization,
  RemotePublicationRetainedEvent,
  RemotePublicationResumeRequestedEvent,
  type RemotePublicationBatchGrantAppliedEvent,
  type RemotePublicationResumeRequest,
  type RemotePublicationRetainedCause,
  type RemotePublicationProofBasis,
  RemotePublicationSucceededEvent,
  remotePublicationAttemptLimit,
  remotePublicationRefspecFor,
  remotePublicationCorrelationEquals,
  remotePublicationRunIdOf
} from "./events.js"
import { RemotePublicationHistoryContradiction } from "./errors.js"
import { deriveRemotePublicationState, type RemotePublicationState as RemotePublicationStateType } from "./state.js"

const lastElementOffset = -1

export type CurrentRemotePublicationEvidence<E, R> = (runId: RunId) => Effect.Effect<JournalHistorySource, E, R>

type RemotePublicationTransitionEvent =
  | RemotePublicationIntendedEvent
  | RemotePublicationAttemptIntendedEvent
  | RemotePublicationAttemptRejectedNonFastForwardEvent
  | RemotePublicationSucceededEvent
  | RemotePublicationRetainedEvent
  | RemotePublicationResumeRequestedEvent

export const readAcceptedRemotePublicationEvidence = Effect.fn("RemotePublication.readAcceptedEvidence")(function* (
  runId: RunId
) {
  return yield* (yield* AcceptedJournalReader).readAccepted(runId)
})

export const remotePublicationEventsFor = (
  source: JournalHistorySource,
  correlation: RemotePublicationCorrelation
): ReadonlyArray<RemotePublicationTransitionEvent> =>
  [
    ...journalRecordsOfKind(source, "RemotePublicationIntended"),
    ...journalRecordsOfKind(source, "RemotePublicationAttemptIntended"),
    ...journalRecordsOfKind(source, "RemotePublicationAttemptRejectedNonFastForward"),
    ...journalRecordsOfKind(source, "RemotePublicationRetained"),
    ...journalRecordsOfKind(source, "RemotePublicationSucceeded"),
    ...journalRecordsOfKind(source, "RemotePublicationResumeRequested")
  ]
    .sort((left, right) => Number(left.position) - Number(right.position))
    .flatMap(({ event }) => {
      if (
        (event._tag === "RemotePublicationIntended" ||
          event._tag === "RemotePublicationAttemptIntended" ||
          event._tag === "RemotePublicationAttemptRejectedNonFastForward" ||
          event._tag === "RemotePublicationRetained" ||
          event._tag === "RemotePublicationSucceeded" ||
          event._tag === "RemotePublicationResumeRequested") &&
        event.correlation.requestId === correlation.requestId
      ) {
        return [event]
      }
      return []
    })

export type RemotePublicationBatchGrantRecord = JournalRecord & {
  readonly event: RemotePublicationBatchGrantAppliedEvent
}

const batchGrantReferencesExhaustion = (
  source: JournalHistorySource,
  grant: RemotePublicationBatchGrantRecord
): boolean => {
  const exhaustion = journalRecordByPosition(source, grant.event.request.exhaustionAt)
  return (
    exhaustion?.event._tag === "RemotePublicationRetained" &&
    exhaustion.runId === grant.runId &&
    exhaustion.position < grant.position &&
    exhaustion.event.correlation.qualifiedCandidate.run.session.queuedAt ===
      grant.event.request.responsibility.queuedAt &&
    (exhaustion.event.cause._tag === "AttemptsExhausted" || exhaustion.event.cause._tag === "CompatibleCompetingHead")
  )
}

const remotePublicationBatchGrantIsForCorrelation = (
  record: JournalRecord,
  correlation: RemotePublicationCorrelation
): record is RemotePublicationBatchGrantRecord => {
  if (record.event._tag !== "RemotePublicationBatchGrantApplied") return false
  const request = record.event.request
  return (
    record.runId === remotePublicationRunIdOf(correlation) &&
    request.runId === remotePublicationRunIdOf(correlation) &&
    request.responsibility.runId === request.runId &&
    request.responsibility.queuedAt === correlation.qualifiedCandidate.run.session.queuedAt
  )
}

/** Returns accepted Full rerun grants for this exact Run responsibility in journal order. */
export const remotePublicationBatchGrantsFor = (
  source: JournalHistorySource,
  correlation: RemotePublicationCorrelation
): ReadonlyArray<RemotePublicationBatchGrantRecord> =>
  Array.from(journalRecordsOfKind(source, "RemotePublicationBatchGrantApplied"))
    .filter((record): record is RemotePublicationBatchGrantRecord =>
      remotePublicationBatchGrantIsForCorrelation(record, correlation)
    )
    .sort((left, right) => Number(left.position) - Number(right.position))

/** Finds the latest grant that can authorize the next attempt for this candidate. */
export const remotePublicationBatchGrantForNextAttempt = (
  source: JournalHistorySource,
  correlation: RemotePublicationCorrelation,
  state: RemotePublicationStateType
): RemotePublicationBatchGrantRecord | undefined => {
  if (state._tag === "PublicationSucceeded" || state._tag === "PublicationContradiction") return undefined
  const grants = remotePublicationBatchGrantsFor(source, correlation)
  const latest = grants.at(lastElementOffset)
  if (latest === undefined) return undefined
  if (state._tag === "PublicationPending" || state._tag === "PublicationResumeReady") {
    if (state.batchGrantAt !== undefined) return grants.find(({ position }) => position === state.batchGrantAt)
    return state.attemptOrdinals.length === 0 ? latest : undefined
  }
  if (state._tag === "PublicationAbsent") return latest
  const lastRetained = Array.from(journalRecordsOfKind(source, "RemotePublicationRetained")).findLast(
    (record) =>
      record.event._tag === "RemotePublicationRetained" && record.event.correlation.requestId === correlation.requestId
  )
  return lastRetained !== undefined && latest.position > lastRetained.position ? latest : undefined
}

export const validateRemotePublicationState = (
  source: JournalHistorySource,
  correlation: RemotePublicationCorrelation
) => {
  const attemptRecords = Array.from(journalRecordsOfKind(source, "RemotePublicationAttemptIntended"))
    .filter(
      ({ event }) =>
        event._tag === "RemotePublicationAttemptIntended" && event.correlation.requestId === correlation.requestId
    )
    .sort((left, right) => Number(left.position) - Number(right.position))
  const grants = remotePublicationBatchGrantsFor(source, correlation)
  const retainedRecords = Array.from(journalRecordsOfKind(source, "RemotePublicationRetained")).filter(
    ({ event }) => event._tag === "RemotePublicationRetained" && event.correlation.requestId === correlation.requestId
  )
  for (const retained of retainedRecords) {
    if (retained.event._tag !== "RemotePublicationRetained") continue
    const currentGrant = grants.findLast(({ position }) => position < retained.position)
    if (retained.event.batchGrantAt !== currentGrant?.position) {
      return Effect.fail(
        new RemotePublicationHistoryContradiction({
          detail: "retained publication must reference the latest exact batch grant before its durable outcome",
          requestId: correlation.requestId
        })
      )
    }
    if (currentGrant !== undefined && !batchGrantReferencesExhaustion(source, currentGrant)) {
      return Effect.fail(
        new RemotePublicationHistoryContradiction({
          detail: "publication batch grant must reference an earlier retained exhaustion occurrence",
          requestId: correlation.requestId
        })
      )
    }
  }
  const grantedAttemptCounts = new Map<string, number>()
  for (const attempt of attemptRecords) {
    if (attempt.event._tag !== "RemotePublicationAttemptIntended") continue
    const currentGrant = grants.findLast(({ position }) => position < attempt.position)
    if (attempt.event.batchGrantAt !== currentGrant?.position) {
      return Effect.fail(
        new RemotePublicationHistoryContradiction({
          detail: "publication attempt must reference the latest exact batch grant before its durable intent",
          requestId: correlation.requestId
        })
      )
    }
    if (currentGrant !== undefined && !batchGrantReferencesExhaustion(source, currentGrant)) {
      return Effect.fail(
        new RemotePublicationHistoryContradiction({
          detail: "publication batch grant must reference an earlier retained exhaustion occurrence",
          requestId: correlation.requestId
        })
      )
    }
    if (currentGrant !== undefined) {
      const key = String(currentGrant.position)
      const count = (grantedAttemptCounts.get(key) ?? 0) + 1
      if (count > remotePublicationAttemptLimit) {
        return Effect.fail(
          new RemotePublicationHistoryContradiction({
            detail: "publication candidate exceeds the three-intent allowance for one batch grant",
            requestId: correlation.requestId
          })
        )
      }
      grantedAttemptCounts.set(key, count)
    }
  }
  const events = remotePublicationEventsFor(source, correlation)
  if (events.some((event) => !remotePublicationCorrelationEquals(event.correlation, correlation))) {
    return Effect.fail(
      new RemotePublicationHistoryContradiction({
        detail: "journal contains a different exact publication correlation for this request id",
        requestId: correlation.requestId
      })
    )
  }
  const state = deriveRemotePublicationState(events)
  return state._tag === "PublicationContradiction"
    ? Effect.fail(new RemotePublicationHistoryContradiction({ detail: state.detail, requestId: correlation.requestId }))
    : Effect.succeed(state)
}

const appendRemotePublicationEvent = Effect.fn("RemotePublication.appendEvent")(function* (
  correlation: RemotePublicationCorrelation,
  key: Parameters<InRunJournal["Service"]["append"]>[1],
  event: RemotePublicationTransitionEvent
) {
  yield* (yield* InRunJournal).append(remotePublicationRunIdOf(correlation), key, event)
})

export const appendRemotePublicationIntent = Effect.fn("RemotePublication.appendIntent")(function* (
  correlation: RemotePublicationCorrelation
) {
  yield* appendRemotePublicationEvent(
    correlation,
    remotePublicationIntendedRecordKey(correlation.requestId),
    RemotePublicationIntendedEvent.make({
      correlation,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
})

export const appendRemotePublicationAttemptIntent = Effect.fn("RemotePublication.appendAttemptIntent")(function* (
  correlation: RemotePublicationCorrelation,
  attemptOrdinal: RemotePublicationAttemptOrdinal,
  batchGrantAt?: RemotePublicationAttemptIntendedEvent["batchGrantAt"]
) {
  yield* appendRemotePublicationEvent(
    correlation,
    remotePublicationAttemptIntendedRecordKey(correlation.requestId, attemptOrdinal),
    RemotePublicationAttemptIntendedEvent.make({
      attemptOrdinal,
      ...(batchGrantAt === undefined ? {} : { batchGrantAt }),
      correlation,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      refspec: remotePublicationRefspecFor(correlation.qualifiedCandidate.candidateCommit, correlation.target.branch),
      version: workflowJournalEventVersion
    })
  )
})

export const appendRemotePublicationAttemptRejection = Effect.fn("RemotePublication.appendAttemptRejection")(function* (
  correlation: RemotePublicationCorrelation,
  attemptOrdinal: RemotePublicationAttemptOrdinal
) {
  yield* appendRemotePublicationEvent(
    correlation,
    remotePublicationAttemptRejectedRecordKey(correlation.requestId, attemptOrdinal),
    RemotePublicationAttemptRejectedNonFastForwardEvent.make({
      attemptOrdinal,
      correlation,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
  )
})

export const appendRemotePublicationRetained = Effect.fn("RemotePublication.appendRetained")(function* (
  correlation: RemotePublicationCorrelation,
  cause: RemotePublicationRetainedCause,
  authorization: RemotePublicationAttemptAuthorization,
  batchGrantAt?: RemotePublicationRetainedEvent["batchGrantAt"]
) {
  yield* appendRemotePublicationEvent(
    correlation,
    remotePublicationRetainedRecordKey(correlation.requestId, authorization, batchGrantAt),
    RemotePublicationRetainedEvent.make({
      ...(batchGrantAt === undefined ? {} : { batchGrantAt }),
      authorization,
      cause,
      correlation,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
  )
})

export const appendRemotePublicationResumeRequest = Effect.fn("RemotePublication.appendResumeRequest")(function* (
  correlation: RemotePublicationCorrelation,
  request: RemotePublicationResumeRequest
) {
  const event = RemotePublicationResumeRequestedEvent.make({
    correlation,
    initiatedBy: WorkflowActor.cases.Operator.make({}),
    occurrenceClassification: "InitiatedAction",
    request,
    version: workflowJournalEventVersion
  })
  yield* appendRemotePublicationEvent(correlation, remotePublicationResumeRequestedRecordKey(request.requestId), event)
  return event
})

export const appendRemotePublicationSuccess = Effect.fn("RemotePublication.appendSuccess")(function* (
  correlation: RemotePublicationCorrelation,
  proof: RemotePublicationProofBasis
) {
  yield* appendRemotePublicationEvent(
    correlation,
    remotePublicationSucceededRecordKey(correlation.requestId),
    RemotePublicationSucceededEvent.make({
      correlation,
      occurrenceClassification: "NonActionOccurrence",
      proof,
      version: workflowJournalEventVersion
    })
  )
  return RemotePublicationSucceededEvent.make({
    correlation,
    occurrenceClassification: "NonActionOccurrence",
    proof,
    version: workflowJournalEventVersion
  })
})
