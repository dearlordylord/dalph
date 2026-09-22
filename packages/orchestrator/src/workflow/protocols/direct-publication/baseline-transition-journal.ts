import type { RunId } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import { journalRecordsOfKind, type JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import {
  localTargetCatchUpIntendedRecordKey,
  localTargetCatchUpObservedRecordKey,
  remoteBaselineObservedRecordKey,
  remoteBaselineReadIntendedRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import {
  type LocalTargetCatchUpResult,
  LocalTargetCatchUpIntendedEvent,
  LocalTargetCatchUpObservedEvent,
  RemoteBaselineCorrelation,
  type RemoteBaselineJournalEvent,
  type RemoteBaselineObservation,
  RemoteBaselineObservedEvent,
  RemoteBaselineReadIntendedEvent
} from "./baseline-events.js"
import { deriveRemoteBaselineState } from "./baseline-state.js"

export type CurrentRemoteBaselineEvidence<E, R> = (runId: RunId) => Effect.Effect<JournalHistorySource, E, R>

export class RemoteBaselineHistoryContradiction extends Schema.TaggedError<RemoteBaselineHistoryContradiction>()(
  "RemoteBaselineHistoryContradiction",
  { baselineId: Schema.String, detail: Schema.String }
) {}

export const readAcceptedRemoteBaselineEvidence = Effect.fn("RemoteBaseline.readAcceptedEvidence")(function* (
  runId: RunId
) {
  return yield* (yield* AcceptedJournalReader).readAccepted(runId)
})

export const remoteBaselineEventsFor = (
  source: JournalHistorySource,
  correlation: RemoteBaselineCorrelation
): ReadonlyArray<RemoteBaselineJournalEvent> =>
  [
    ...journalRecordsOfKind(source, "RemoteBaselineReadIntended"),
    ...journalRecordsOfKind(source, "RemoteBaselineObserved"),
    ...journalRecordsOfKind(source, "LocalTargetCatchUpIntended"),
    ...journalRecordsOfKind(source, "LocalTargetCatchUpObserved")
  ]
    .sort((left, right) => Number(left.position) - Number(right.position))
    .flatMap(({ event }) =>
      (event._tag === "RemoteBaselineReadIntended" ||
        event._tag === "RemoteBaselineObserved" ||
        event._tag === "LocalTargetCatchUpIntended" ||
        event._tag === "LocalTargetCatchUpObserved") &&
      event.correlation.baselineId === correlation.baselineId
        ? [event]
        : []
    )

const correlationEquals = Schema.toEquivalence(RemoteBaselineCorrelation)

export const validateRemoteBaselineState = (source: JournalHistorySource, correlation: RemoteBaselineCorrelation) => {
  const events = remoteBaselineEventsFor(source, correlation)
  if (events.some((event) => !correlationEquals(event.correlation, correlation))) {
    return Effect.fail(
      new RemoteBaselineHistoryContradiction({
        baselineId: correlation.baselineId,
        detail: "journal contains a different exact baseline correlation for this baseline id"
      })
    )
  }
  const state = deriveRemoteBaselineState(events)
  return state._tag === "Contradiction"
    ? Effect.fail(new RemoteBaselineHistoryContradiction({ baselineId: correlation.baselineId, detail: state.detail }))
    : Effect.succeed(state)
}

const appendRemoteBaselineEvent = Effect.fn("RemoteBaseline.appendEvent")(function* (
  correlation: RemoteBaselineCorrelation,
  key: Parameters<InRunJournal["Service"]["append"]>[1],
  event: RemoteBaselineJournalEvent
) {
  yield* (yield* InRunJournal).append(correlation.runId, key, event)
})

export const appendRemoteBaselineReadIntent = Effect.fn("RemoteBaseline.appendReadIntent")(function* (
  correlation: RemoteBaselineCorrelation
) {
  yield* appendRemoteBaselineEvent(
    correlation,
    remoteBaselineReadIntendedRecordKey(correlation.baselineId),
    RemoteBaselineReadIntendedEvent.make({
      correlation,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
})

export const appendRemoteBaselineObservation = Effect.fn("RemoteBaseline.appendObservation")(function* (
  correlation: RemoteBaselineCorrelation,
  observation: RemoteBaselineObservation
) {
  yield* appendRemoteBaselineEvent(
    correlation,
    remoteBaselineObservedRecordKey(correlation.baselineId),
    RemoteBaselineObservedEvent.make({
      correlation,
      observation,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
  )
})

export const appendLocalTargetCatchUpIntent = Effect.fn("RemoteBaseline.appendCatchUpIntent")(function* (
  correlation: RemoteBaselineCorrelation,
  expectedLocalHead: LocalTargetCatchUpIntendedEvent["expectedLocalHead"],
  remoteHead: LocalTargetCatchUpIntendedEvent["remoteHead"]
) {
  yield* appendRemoteBaselineEvent(
    correlation,
    localTargetCatchUpIntendedRecordKey(correlation.baselineId),
    LocalTargetCatchUpIntendedEvent.make({
      correlation,
      expectedLocalHead,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      remoteHead,
      version: workflowJournalEventVersion
    })
  )
})

export const appendLocalTargetCatchUpObservation = Effect.fn("RemoteBaseline.appendCatchUpObservation")(function* (
  correlation: RemoteBaselineCorrelation,
  expectedLocalHead: LocalTargetCatchUpObservedEvent["expectedLocalHead"],
  remoteHead: LocalTargetCatchUpObservedEvent["remoteHead"],
  result: LocalTargetCatchUpResult
) {
  yield* appendRemoteBaselineEvent(
    correlation,
    localTargetCatchUpObservedRecordKey(correlation.baselineId),
    LocalTargetCatchUpObservedEvent.make({
      correlation,
      expectedLocalHead,
      occurrenceClassification: "NonActionOccurrence",
      remoteHead,
      result,
      version: workflowJournalEventVersion
    })
  )
})
