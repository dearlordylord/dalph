import { expect, it } from "vitest"
import { RunId } from "@dalph/contracts"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { outcomeRecordKey, targetPromotionObservedSuccessRecordKey } from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { OperationId } from "../../identity.js"
import {
  CompletionClaimDeletionAttemptIntendedEvent,
  CompletionClaimDeletedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionClaimRequestOrdinal,
  CompletionTaskClaim,
  CompletionTaskIntendedEvent,
  completionTaskRequestFor,
  IntegrationFinalitySettledEvent
} from "./events.js"
import {
  invalidIntegrationFinalityHistory,
  invalidIntegrationFinalityRunBinding,
  makeIntegrationFinalityHistoryIndexes,
  validateIntegrationFinalityHistoryRecord
} from "./history.js"
import { deriveIntegrationFinalityStateFor, latestFocusedCompletedTaskObservationFor } from "./state.js"
import { integrationFinalityFixture as fixture, prerequisiteRecordEvents } from "./fixtures.js"
import { makeCompletionTaskFactsObservationOperation, makeTaskAttemptPlanOperation } from "../../registry/operation.js"
import { taskTrackerReadIntent, TaskAttemptPlannedEvent } from "../../registry/event.js"
import { journaledIntegrationEvidenceOf } from "../../../coordination/delivery/delivery-evidence.js"
import {
  makeFocusedTaskCompletionFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"

const replacementOperationId = OperationId.make("history-replacement-operation")
const deletionOperationId = OperationId.make("history-deletion-operation")

const record = (position: number, event: JournalRecord["event"], key = `history:${position}`): JournalRecord => ({
  event,
  key: JournalRecordKey.make(key),
  position: JournalPosition.make(position),
  runId: fixture.runId
})

const successObservation = { ...fixture.successObservation, observedAt: JournalPosition.make(9) }

const validFinalityRecords = (): ReadonlyArray<JournalRecord> => {
  const promotion = record(
    3,
    fixture.promotionSuccess,
    targetPromotionObservedSuccessRecordKey(fixture.promotionCorrelation.requestId)
  )
  const replacementIntent = record(
    4,
    CompletionClaimReplacementIntendedEvent.make({
      claim: fixture.claim,
      operationId: replacementOperationId,
      version: workflowJournalEventVersion
    })
  )
  const replacementAttempt = record(
    5,
    CompletionClaimReplacementAttemptIntendedEvent.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
      claim: fixture.claim,
      operationId: replacementOperationId,
      version: workflowJournalEventVersion
    })
  )
  const replacement = record(
    6,
    CompletionClaimReplacedEvent.make({
      claim: fixture.claim,
      operationId: replacementOperationId,
      version: workflowJournalEventVersion
    })
  )
  const completionIntent = record(
    7,
    CompletionTaskIntendedEvent.make({ request: fixture.completionRequest, version: workflowJournalEventVersion })
  )
  const focusedIntent = record(8, fixture.focusedSuccessFactsReadIntentEvent)
  const focusedFacts = record(9, fixture.focusedSuccessFactsEvent)
  const deletionIntent = record(
    10,
    CompletionClaimDeletionIntendedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  const deletionAttempt = record(
    11,
    CompletionClaimDeletionAttemptIntendedEvent.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  const deleted = record(
    12,
    CompletionClaimDeletedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  const settled = record(
    13,
    IntegrationFinalitySettledEvent.make({
      claim: fixture.claim,
      deletionOperationId,
      replacementOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  return [
    record(1, prerequisiteRecordEvents[0]),
    record(2, prerequisiteRecordEvents[1]),
    promotion,
    replacementIntent,
    replacementAttempt,
    replacement,
    completionIntent,
    focusedIntent,
    focusedFacts,
    deletionIntent,
    deletionAttempt,
    deleted,
    settled
  ]
}

const validationErrors = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<string> => {
  const indexes = makeIntegrationFinalityHistoryIndexes()
  return records.flatMap((current) => {
    const issue = invalidIntegrationFinalityHistory(current, records, indexes)
    return issue === undefined ? [] : [issue]
  })
}

const deletionIntentRecord = (position: number, observation: typeof fixture.successObservation): JournalRecord =>
  record(
    position,
    CompletionClaimDeletionIntendedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: observation,
      version: workflowJournalEventVersion
    })
  )

it("accepts one complete promotion, replacement, fresh-success deletion, and settlement chronology", () => {
  const records = validFinalityRecords()
  expect(validationErrors(records)).toEqual([])
  expect(journaledIntegrationEvidenceOf(records).at(-1)?._tag).toBe("IntegrationFinalitySettlement")
})

it("projects each phase from exact stored evidence without rescanning authority state", () => {
  const records = validFinalityRecords()
  expect(deriveIntegrationFinalityStateFor(records.slice(0, 4), fixture.claim)?._tag).toBe("ReplacementPending")
  expect(deriveIntegrationFinalityStateFor(records.slice(0, 6), fixture.claim)?._tag).toBe("CompletionClaimReplaced")
  expect(deriveIntegrationFinalityStateFor(records.slice(0, 10), fixture.claim)?._tag).toBe("DeletionPending")
  expect(deriveIntegrationFinalityStateFor(records.slice(0, 12), fixture.claim)?._tag).toBe("CompletionClaimDeleted")
  expect(deriveIntegrationFinalityStateFor(records, fixture.claim)?._tag).toBe("IntegrationFinalitySettled")
})

it("does not settle from a terminal occurrence with different operation evidence", () => {
  const records = validFinalityRecords()
  const mismatchedSettlement = record(
    13,
    IntegrationFinalitySettledEvent.make({
      claim: fixture.claim,
      deletionOperationId: OperationId.make("foreign-deletion-operation"),
      replacementOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  expect(deriveIntegrationFinalityStateFor([...records.slice(0, 12), mismatchedSettlement], fixture.claim)?._tag).toBe(
    "CompletionClaimDeleted"
  )
})

it("uses only the exact focused task-local success as cleanup authority", () => {
  const records = validFinalityRecords()
  expect(
    latestFocusedCompletedTaskObservationFor(records, fixture.taskId, JournalPosition.make(6), fixture.claim)
  ).toEqual(successObservation)
  expect(
    latestFocusedCompletedTaskObservationFor(
      records.filter(({ event }) => event._tag !== "CompletionTaskIntended"),
      fixture.taskId,
      JournalPosition.make(6),
      fixture.claim
    )
  ).toBeUndefined()
})

it("does not treat a later complete graph as cleanup authority", () => {
  const prefix = validFinalityRecords().slice(0, 6)
  const graphShapedFocusedProof = {
    ...successObservation,
    observedAt: JournalPosition.make(7),
    operationId: fixture.graphOperation.operationId
  }
  expect(
    validationErrors([
      ...prefix,
      record(7, fixture.graphRecordEvent, outcomeRecordKey(fixture.graphOperation.operationId)),
      deletionIntentRecord(8, graphShapedFocusedProof)
    ])
  ).toHaveLength(1)
  expect(
    latestFocusedCompletedTaskObservationFor(
      [...prefix, record(7, fixture.graphRecordEvent)],
      fixture.taskId,
      JournalPosition.make(6),
      fixture.claim
    )
  ).toBeUndefined()
})

it("accepts exact successful focused facts directly and rejects a cleanup proof without them", () => {
  const prefix = validFinalityRecords().slice(0, 6)
  expect(validationErrors([...prefix, deletionIntentRecord(8, successObservation)])).toHaveLength(1)
  expect(
    validationErrors([
      ...prefix,
      record(
        7,
        CompletionTaskIntendedEvent.make({ request: fixture.completionRequest, version: workflowJournalEventVersion })
      ),
      record(8, fixture.focusedSuccessFactsReadIntentEvent),
      record(9, fixture.focusedSuccessFactsEvent),
      deletionIntentRecord(10, successObservation)
    ])
  ).toEqual([])
})

it("rejects every cleanup and settlement occurrence whose success binds a different same-task claim", () => {
  const records = validFinalityRecords()
  const foreignClaim = CompletionTaskClaim.make({
    ...fixture.claim,
    originalClaim: { ...fixture.activeClaim, operationId: OperationId.make("history-foreign-same-task-claim") }
  })
  const foreignRequest = completionTaskRequestFor(foreignClaim)
  const foreignOperation = makeCompletionTaskFactsObservationOperation(
    foreignRequest,
    fixture.target,
    fixture.focusedSuccessFactsEvent.observation.purpose
  )
  const foreignRequestIntent = record(
    7,
    CompletionTaskIntendedEvent.make({ request: foreignRequest, version: workflowJournalEventVersion })
  )
  const foreignIntent = record(8, taskTrackerReadIntent(foreignOperation))
  const foreignObservation = makeFocusedTaskCompletionFactsObserved(foreignOperation, {
    ...fixture.focusedSuccessFactsEvent.observation.facts,
    currentClaim: foreignClaim,
    operationId: foreignOperation.operationId
  })
  const foreignFocusedSuccess = record(
    9,
    taskTrackerFactsObservedEvent(foreignOperation.operationId, foreignObservation)
  )
  const foreignSuccessObservation = {
    ...successObservation,
    claim: foreignClaim,
    observedAt: JournalPosition.make(9),
    operationId: foreignOperation.operationId
  }
  const mismatchedIntent = record(
    10,
    CompletionClaimDeletionIntendedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: foreignSuccessObservation,
      version: workflowJournalEventVersion
    })
  )
  const mismatchedAttempt = record(
    11,
    CompletionClaimDeletionAttemptIntendedEvent.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: foreignSuccessObservation,
      version: workflowJournalEventVersion
    })
  )
  const mismatchedDeleted = record(
    12,
    CompletionClaimDeletedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: foreignSuccessObservation,
      version: workflowJournalEventVersion
    })
  )
  const mismatchedSettlement = record(
    13,
    IntegrationFinalitySettledEvent.make({
      claim: fixture.claim,
      deletionOperationId,
      replacementOperationId,
      successObservation: foreignSuccessObservation,
      version: workflowJournalEventVersion
    })
  )
  const prefix = [...records.slice(0, 6), foreignRequestIntent, foreignIntent, foreignFocusedSuccess]

  expect(validationErrors([...prefix, mismatchedIntent])).toHaveLength(1)
  expect(validationErrors([...prefix, mismatchedIntent, mismatchedAttempt])).toHaveLength(2)
  expect(validationErrors([...prefix, mismatchedIntent, mismatchedAttempt, mismatchedDeleted])).toHaveLength(3)
  expect(
    validationErrors([...prefix, mismatchedIntent, mismatchedAttempt, mismatchedDeleted, mismatchedSettlement])
  ).toHaveLength(4)
})

it("rejects a fourth replacement or deletion request beyond the production bound", () => {
  const records = validFinalityRecords()
  const replacementAttempt = record(
    12,
    CompletionClaimReplacementAttemptIntendedEvent.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(4),
      claim: fixture.claim,
      operationId: replacementOperationId,
      version: workflowJournalEventVersion
    })
  )
  const deletionAttempt = record(
    12,
    CompletionClaimDeletionAttemptIntendedEvent.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(4),
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  expect(validationErrors([...records.slice(0, 5), replacementAttempt])).toHaveLength(1)
  expect(validationErrors([...records.slice(0, 10), deletionAttempt])).toHaveLength(1)
})

it("rejects deletion intent without an earlier replacement and fresh successful graph observation", () => {
  const records = validFinalityRecords()
  const premature = record(
    4,
    CompletionClaimDeletionIntendedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: fixture.successObservation,
      version: workflowJournalEventVersion
    })
  )
  expect(validationErrors([...records.slice(0, 3), premature])).toHaveLength(1)
})

it("rejects a same-task claim that is not the planned attempt's causal predecessor", () => {
  const unrelatedClaimOperationId = OperationId.make("unrelated-same-task-claim")
  const unrelatedPlan = TaskAttemptPlannedEvent.make({
    operation: makeTaskAttemptPlanOperation({
      ...fixture.planOperation,
      predecessorOperationIds: [unrelatedClaimOperationId]
    }),
    version: workflowJournalEventVersion
  })
  const records = validFinalityRecords()
  const acquired = records[0]
  if (acquired === undefined) return expect.fail("fixture must contain its exact acquired claim")
  expect(validationErrors([acquired, record(2, unrelatedPlan), ...records.slice(2, 4)])).toHaveLength(1)
})

it("rejects duplicate terminal outcomes and settlement without exact deletion proof", () => {
  const records = validFinalityRecords()
  const duplicateDeleted = record(
    12,
    CompletionClaimDeletedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  const duplicateSettlement = record(
    12,
    IntegrationFinalitySettledEvent.make({
      claim: fixture.claim,
      deletionOperationId,
      replacementOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  expect(validationErrors([...records, duplicateDeleted])).toHaveLength(1)
  expect(validationErrors([...records, duplicateSettlement])).toHaveLength(1)
  expect(
    validationErrors([
      ...records.slice(0, 11),
      record(
        11,
        IntegrationFinalitySettledEvent.make({
          claim: fixture.claim,
          deletionOperationId,
          replacementOperationId,
          successObservation: fixture.successObservation,
          version: workflowJournalEventVersion
        })
      )
    ])
  ).toHaveLength(1)
})

it("rejects a replacement outcome without its exact intent", () => {
  expect(
    validationErrors([
      record(
        1,
        CompletionClaimReplacedEvent.make({
          claim: fixture.claim,
          operationId: replacementOperationId,
          version: workflowJournalEventVersion
        })
      )
    ])
  ).toHaveLength(1)
})

it("reports exact run binding and semantic issues through the reconstruction callbacks", () => {
  const intent = validFinalityRecords()[3]
  if (intent === undefined) return expect.fail("fixture must contain replacement intent")
  expect(invalidIntegrationFinalityRunBinding(intent.event, RunId.make("foreign-finality-run"))).toContain(
    fixture.runId
  )
  expect(invalidIntegrationFinalityRunBinding(intent.event, fixture.runId)).toBeUndefined()
  expect(invalidIntegrationFinalityRunBinding(fixture.graphRecordEvent, fixture.runId)).toBeUndefined()
  const identities: Array<string> = []
  const semantics: Array<string> = []
  validateIntegrationFinalityHistoryRecord(
    { ...intent, runId: RunId.make("foreign-finality-run") },
    RunId.make("foreign-finality-run"),
    [],
    makeIntegrationFinalityHistoryIndexes(),
    (detail) => identities.push(detail),
    (detail) => semantics.push(detail)
  )
  expect(identities).toHaveLength(1)
  expect(semantics).toHaveLength(1)

  const acceptedIdentities: Array<string> = []
  const acceptedSemantics: Array<string> = []
  const records = validFinalityRecords()
  const acceptedRecord = records[0]
  if (acceptedRecord === undefined) return expect.fail("fixture must contain a prerequisite record")
  validateIntegrationFinalityHistoryRecord(
    acceptedRecord,
    fixture.runId,
    records,
    makeIntegrationFinalityHistoryIndexes(),
    (detail) => acceptedIdentities.push(detail),
    (detail) => acceptedSemantics.push(detail)
  )
  expect(acceptedIdentities).toEqual([])
  expect(acceptedSemantics).toEqual([])

  const completionIntent = record(
    1,
    CompletionTaskIntendedEvent.make({ request: fixture.completionRequest, version: workflowJournalEventVersion })
  )
  const completionIdentities: Array<string> = []
  const completionSemantics: Array<string> = []
  validateIntegrationFinalityHistoryRecord(
    completionIntent,
    fixture.runId,
    [completionIntent],
    makeIntegrationFinalityHistoryIndexes(),
    (detail) => completionIdentities.push(detail),
    (detail) => completionSemantics.push(detail)
  )
  expect(completionSemantics).toContainEqual(expect.stringContaining("lacks one exact prior claim replacement"))
  validateIntegrationFinalityHistoryRecord(
    { ...completionIntent, runId: RunId.make("foreign-completion-run") },
    RunId.make("foreign-completion-run"),
    [completionIntent],
    makeIntegrationFinalityHistoryIndexes(),
    (detail) => completionIdentities.push(detail),
    (detail) => completionSemantics.push(detail)
  )
  expect(completionIdentities).toContainEqual(expect.stringContaining("binds another Run"))
})
