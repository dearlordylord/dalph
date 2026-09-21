import type { RunId } from "@dalph/contracts"
import { Effect } from "effect"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import { journalRecordsOfKind, type JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import {
  remotePublicationAttemptIntendedRecordKey,
  remotePublicationIntendedRecordKey,
  remotePublicationRetainedRecordKey,
  remotePublicationSucceededRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import {
  RemotePublicationAttemptIntendedEvent,
  type RemotePublicationAttemptOrdinal,
  type RemotePublicationCorrelation,
  RemotePublicationIntendedEvent,
  RemotePublicationRetainedEvent,
  type RemotePublicationRetainedCause,
  type RemotePublicationProofBasis,
  RemotePublicationSucceededEvent,
  remotePublicationRefspecFor,
  remotePublicationCorrelationEquals,
  remotePublicationRunIdOf
} from "./events.js"
import { RemotePublicationHistoryContradiction } from "./errors.js"
import { deriveRemotePublicationState } from "./state.js"

export type CurrentRemotePublicationEvidence<E, R> = (runId: RunId) => Effect.Effect<JournalHistorySource, E, R>

type RemotePublicationTransitionEvent =
  | RemotePublicationIntendedEvent
  | RemotePublicationAttemptIntendedEvent
  | RemotePublicationSucceededEvent
  | RemotePublicationRetainedEvent

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
    ...journalRecordsOfKind(source, "RemotePublicationRetained"),
    ...journalRecordsOfKind(source, "RemotePublicationSucceeded")
  ]
    .sort((left, right) => Number(left.position) - Number(right.position))
    .flatMap(({ event }) => {
      if (
        (event._tag === "RemotePublicationIntended" ||
          event._tag === "RemotePublicationAttemptIntended" ||
          event._tag === "RemotePublicationRetained" ||
          event._tag === "RemotePublicationSucceeded") &&
        event.correlation.requestId === correlation.requestId
      ) {
        return [event]
      }
      return []
    })

export const validateRemotePublicationState = (
  source: JournalHistorySource,
  correlation: RemotePublicationCorrelation
) => {
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
  attemptOrdinal: RemotePublicationAttemptOrdinal
) {
  yield* appendRemotePublicationEvent(
    correlation,
    remotePublicationAttemptIntendedRecordKey(correlation.requestId, attemptOrdinal),
    RemotePublicationAttemptIntendedEvent.make({
      attemptOrdinal,
      correlation,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      refspec: remotePublicationRefspecFor(correlation.qualifiedCandidate.candidateCommit, correlation.target.branch),
      version: workflowJournalEventVersion
    })
  )
})

export const appendRemotePublicationRetained = Effect.fn("RemotePublication.appendRetained")(function* (
  correlation: RemotePublicationCorrelation,
  cause: RemotePublicationRetainedCause
) {
  yield* appendRemotePublicationEvent(
    correlation,
    remotePublicationRetainedRecordKey(correlation.requestId),
    RemotePublicationRetainedEvent.make({
      cause,
      correlation,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
  )
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
