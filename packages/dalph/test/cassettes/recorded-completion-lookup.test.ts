import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  CompletionTaskRequestLookup,
  CompletionTaskResponseLostEvent,
  CompletionTaskRequestOrdinal,
  describeJournalEvent,
  FocusedTaskCompletionFacts,
  JournalPosition,
  JournalRecord,
  TaskTrackerFactsObservedEvent,
  workflowJournalEventVersion,
  type WorkflowJournalEvent
} from "@dalph/orchestrator"
import {
  CompletionTaskRequestLookupIntendedEvent,
  CompletionTaskRequestLookupObservedEvent
} from "../../../orchestrator/src/workflow/protocols/integration-finality/events.js"
import { completionTaskRequestLookupOperationIdFor } from "../../../orchestrator/src/workflow/protocols/integration-finality/completion-task-operation-identity.js"
import { makeFocusedTaskCompletionFactsObserved } from "../../../orchestrator/src/workflow/task-tracker-facts/focused-completion-observation.js"
import { deliveryFinalitySpineAuthoredCassette, projectRecordedCassette } from "../../src/cassettes/index.js"
import { runAuthoredScenarioCassette } from "../../src/cassettes/authored-runner.js"

it.effect("records exact completion-request lookup intent and outcomes", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(deliveryFinalitySpineAuthoredCassette)
    const attempt = run.records.findLast(({ event }) => event._tag === "CompletionTaskAttemptIntended")?.event
    const confirmationIntent = run.records.findLast(
      ({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadCompletionTaskFacts" &&
        event.operation.purpose._tag === "Confirmation"
    )?.event
    const confirmation = run.records.findLast(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskCompletionFacts" &&
        event.observation.purpose._tag === "Confirmation"
    )?.event
    if (
      attempt?._tag !== "CompletionTaskAttemptIntended" ||
      confirmationIntent?._tag !== "TaskTrackerReadIntentRecorded" ||
      confirmationIntent.operation._tag !== "ReadCompletionTaskFacts" ||
      confirmation?._tag !== "TaskTrackerFactsObserved" ||
      confirmation.observation._tag !== "FocusedTaskCompletionFacts"
    ) {
      return yield* Effect.die("completion lookup fixture lacks the exact attempt and confirmation read")
    }

    const request = attempt.request
    const ordinal = CompletionTaskRequestOrdinal.make(Number(attempt.attemptOrdinal))
    const responseLost = CompletionTaskResponseLostEvent.make({
      attemptOrdinal: ordinal,
      request,
      version: workflowJournalEventVersion
    })
    const openFacts = FocusedTaskCompletionFacts.make({ ...confirmation.observation.facts, lifecycle: "Open" })
    const openObservation = makeFocusedTaskCompletionFactsObserved(confirmationIntent.operation, openFacts)
    const openFactsEvent = TaskTrackerFactsObservedEvent.make({
      observation: openObservation,
      operationId: openObservation.operationId,
      version: workflowJournalEventVersion
    })
    const lookupIntent = CompletionTaskRequestLookupIntendedEvent.make({
      attemptOrdinal: ordinal,
      operationId: completionTaskRequestLookupOperationIdFor(request, ordinal),
      request,
      version: workflowJournalEventVersion
    })
    const lookupObserved = CompletionTaskRequestLookupObservedEvent.make({
      attemptOrdinal: ordinal,
      lookup: CompletionTaskRequestLookup.cases.NotApplied.make({ request }),
      operationId: lookupIntent.operationId,
      request,
      version: workflowJournalEventVersion
    })
    const syntheticEvents: ReadonlyArray<WorkflowJournalEvent> = [
      ...run.records.slice(0, 44).map(({ event }) => event),
      responseLost,
      confirmationIntent,
      openFactsEvent,
      lookupIntent,
      lookupObserved
    ]
    const records = syntheticEvents.map((event, index) =>
      JournalRecord.make({
        event,
        key: describeJournalEvent(event).expectedKey,
        position: JournalPosition.make(index + 1),
        runId: run.runId
      })
    )
    const recorded = yield* projectRecordedCassette(records)

    expect(recorded.entries.map(({ _tag }) => _tag)).toEqual(
      expect.arrayContaining(["CompletionTaskRequestLookupIntended", "CompletionTaskRequestLookupObserved"])
    )
  }).pipe(Effect.provide(NodeCrypto.layer))
)
