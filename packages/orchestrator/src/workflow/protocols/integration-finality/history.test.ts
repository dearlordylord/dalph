import { expect, it } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
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
  IntegrationFinalitySettledEvent
} from "./events.js"
import {
  invalidIntegrationFinalityHistory,
  invalidIntegrationFinalityRunBinding,
  makeIntegrationFinalityHistoryIndexes,
  validateIntegrationFinalityHistoryRecord
} from "./history.js"
import { deriveIntegrationFinalityStateFor, latestFreshCompletedTaskObservationFor } from "./state.js"
import { integrationFinalityFixture as fixture, prerequisiteRecordEvents } from "./fixtures.js"
import { makeTaskAttemptPlanOperation, makeTrackerGraphObservationOperation } from "../../registry/operation.js"
import { TaskAttemptPlannedEvent } from "../../registry/event.js"
import { makeTaskTrackerFactsObservedFromRead } from "../task-tracker-read/protocol.js"
import { journaledIntegrationEvidenceOf } from "../../../coordination/delivery/delivery-evidence.js"
import {
  FocusedTaskClaimFactsObserved,
  TaskTrackerFactsObservedEvent,
  UnchangedTaskTrackerFactsReconfirmed
} from "../../task-tracker-facts/observation.js"
import { TrackerRevision } from "../../../authorities/task-tracker/task.js"

const replacementOperationId = OperationId.make("history-replacement-operation")
const deletionOperationId = OperationId.make("history-deletion-operation")

const record = (position: number, event: JournalRecord["event"], key = `history:${position}`): JournalRecord => ({
  event,
  key: JournalRecordKey.make(key),
  position: JournalPosition.make(position),
  runId: fixture.runId
})

const successObservation = { ...fixture.successObservation, observedAt: JournalPosition.make(7) }

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
  const graph = record(7, fixture.graphRecordEvent, outcomeRecordKey(fixture.graphOperation.operationId))
  const deletionIntent = record(
    8,
    CompletionClaimDeletionIntendedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  const deletionAttempt = record(
    9,
    CompletionClaimDeletionAttemptIntendedEvent.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  const deleted = record(
    10,
    CompletionClaimDeletedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  const settled = record(
    11,
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
    graph,
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
  expect(deriveIntegrationFinalityStateFor(records.slice(0, 8), fixture.claim)?._tag).toBe("DeletionPending")
  expect(deriveIntegrationFinalityStateFor(records.slice(0, 10), fixture.claim)?._tag).toBe("CompletionClaimDeleted")
  expect(deriveIntegrationFinalityStateFor(records, fixture.claim)?._tag).toBe("IntegrationFinalitySettled")
})

it("does not settle from a terminal occurrence with different operation evidence", () => {
  const records = validFinalityRecords()
  const mismatchedSettlement = record(
    11,
    IntegrationFinalitySettledEvent.make({
      claim: fixture.claim,
      deletionOperationId: OperationId.make("foreign-deletion-operation"),
      replacementOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  expect(deriveIntegrationFinalityStateFor([...records.slice(0, 10), mismatchedSettlement], fixture.claim)?._tag).toBe(
    "CompletionClaimDeleted"
  )
})

it("returns an exact success proof from a valid unchanged tracker reconfirmation", () => {
  const laterOperation = makeTrackerGraphObservationOperation(
    OperationId.make("integration-finality-reconfirmation"),
    fixture.target,
    [fixture.graphOperation.operationId],
    [fixture.taskId]
  )
  const reconfirmation = makeTaskTrackerFactsObservedFromRead(
    [{ event: fixture.graphRecordEvent }],
    laterOperation,
    fixture.graphSnapshot
  )
  const proof = latestFreshCompletedTaskObservationFor(
    [record(2, fixture.graphRecordEvent), record(3, reconfirmation)],
    fixture.taskId,
    JournalPosition.make(1)
  )
  expect(proof).toEqual({
    lifecycle: "CompletedSuccessfully",
    observedAt: JournalPosition.make(3),
    operationId: laterOperation.operationId,
    taskId: fixture.taskId,
    trackerRevision: fixture.trackerRevision
  })
  expect(
    latestFreshCompletedTaskObservationFor(
      [record(2, fixture.graphRecordEvent), record(3, reconfirmation)],
      TaskId.make("foreign-reconfirmed-task"),
      JournalPosition.make(1)
    )
  ).toBeUndefined()
})

it("validates deletion from an exact unchanged tracker reconfirmation and rejects an ungrounded one", () => {
  const laterOperation = makeTrackerGraphObservationOperation(
    OperationId.make("integration-finality-history-reconfirmation"),
    fixture.target,
    [fixture.graphOperation.operationId],
    [fixture.taskId]
  )
  const reconfirmation = makeTaskTrackerFactsObservedFromRead(
    [{ event: fixture.graphRecordEvent }],
    laterOperation,
    fixture.graphSnapshot
  )
  const proof = { ...successObservation, observedAt: JournalPosition.make(8), operationId: laterOperation.operationId }
  const prefix = validFinalityRecords().slice(0, 6)
  expect(
    validationErrors([
      ...prefix,
      record(7, fixture.graphRecordEvent),
      record(8, reconfirmation),
      deletionIntentRecord(9, proof)
    ])
  ).toEqual([])
  expect(validationErrors([...prefix, record(8, reconfirmation), deletionIntentRecord(9, proof)])).toHaveLength(1)
})

it("rejects a focused claim read or mismatched reconfirmation as task-success proof", () => {
  const prefix = validFinalityRecords().slice(0, 6)
  const focusedOperationId = OperationId.make("integration-finality-focused-claim")
  const focused = TaskTrackerFactsObservedEvent.make({
    observation: FocusedTaskClaimFactsObserved.make({
      completeness: "Complete",
      consistency: "Atomic",
      coverage: { taskId: fixture.taskId },
      freshness: { _tag: "ObservedDuringLogicalRead", operationId: focusedOperationId },
      observation: fixture.activeClaim,
      operationId: focusedOperationId,
      target: fixture.target
    }),
    operationId: focusedOperationId,
    version: workflowJournalEventVersion
  })
  const focusedProof = { ...successObservation, observedAt: JournalPosition.make(7), operationId: focusedOperationId }
  expect(validationErrors([...prefix, record(7, focused), deletionIntentRecord(8, focusedProof)])).toHaveLength(1)

  const laterOperation = makeTrackerGraphObservationOperation(
    OperationId.make("integration-finality-mismatched-reconfirmation"),
    fixture.target,
    [fixture.graphOperation.operationId],
    [fixture.taskId]
  )
  const baseReconfirmation = makeTaskTrackerFactsObservedFromRead(
    [{ event: fixture.graphRecordEvent }],
    laterOperation,
    fixture.graphSnapshot
  )
  if (baseReconfirmation.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed") {
    return expect.fail("fixture must produce unchanged tracker facts")
  }
  const [identities, lifecycles, prerequisites, groupings, membership] = baseReconfirmation.observation.factFamilies
  const differentRevision = TrackerRevision.make("different-finality-revision")
  const mismatchedObservation = UnchangedTaskTrackerFactsReconfirmed.make({
    ...baseReconfirmation.observation,
    factFamilies: [
      { ...identities, contentIdentity: differentRevision },
      { ...lifecycles, contentIdentity: differentRevision },
      { ...prerequisites, contentIdentity: differentRevision },
      { ...groupings, contentIdentity: differentRevision },
      { ...membership, contentIdentity: differentRevision }
    ],
    priorFullObservationOperationId: focusedOperationId
  })
  const mismatchedReconfirmation = TaskTrackerFactsObservedEvent.make({
    ...baseReconfirmation,
    observation: mismatchedObservation
  })
  const reconfirmedProof = {
    ...successObservation,
    observedAt: JournalPosition.make(8),
    operationId: laterOperation.operationId
  }
  expect(
    validationErrors([
      ...prefix,
      record(7, focused),
      record(8, mismatchedReconfirmation),
      deletionIntentRecord(9, reconfirmedProof)
    ])
  ).toHaveLength(1)
  expect(
    latestFreshCompletedTaskObservationFor(
      [
        record(7, fixture.graphRecordEvent),
        record(
          8,
          TaskTrackerFactsObservedEvent.make({
            ...mismatchedReconfirmation,
            observation: UnchangedTaskTrackerFactsReconfirmed.make({
              ...mismatchedObservation,
              priorFullObservationOperationId: fixture.graphOperation.operationId
            })
          })
        )
      ],
      fixture.taskId,
      JournalPosition.make(6)
    )?.operationId
  ).toBe(fixture.graphOperation.operationId)
})

it("rejects deletion proofs that point at no read or at a mismatched graph operation", () => {
  const prefix = validFinalityRecords().slice(0, 6)
  const absentProof = { ...successObservation, observedAt: JournalPosition.make(7) }
  const mismatchedGraph = {
    ...fixture.graphRecordEvent,
    operationId: OperationId.make("history-mismatched-outer-operation")
  } as JournalRecord["event"]
  expect(validationErrors([...prefix, deletionIntentRecord(8, absentProof)])).toHaveLength(1)
  expect(validationErrors([...prefix, record(7, mismatchedGraph), deletionIntentRecord(8, absentProof)])).toHaveLength(
    1
  )
})

it("does not accept a graph payload whose outer operation differs from its fact operation", () => {
  const forged: unknown = { ...fixture.graphRecordEvent, operationId: OperationId.make("forged-outer-operation") }
  expect(
    latestFreshCompletedTaskObservationFor(
      [{ event: forged, position: JournalPosition.make(2) }],
      fixture.taskId,
      JournalPosition.make(1)
    )
  ).toBeUndefined()
})

it("rejects stale, unrelated, incomplete, and ungrounded tracker success observations", () => {
  const laterOperation = makeTrackerGraphObservationOperation(
    OperationId.make("integration-finality-invalid-reconfirmation"),
    fixture.target,
    [fixture.graphOperation.operationId],
    [fixture.taskId]
  )
  const reconfirmation = makeTaskTrackerFactsObservedFromRead(
    [{ event: fixture.graphRecordEvent }],
    laterOperation,
    fixture.graphSnapshot
  )
  const foreignTaskId = TaskId.make("foreign-finality-task")
  const malformedReconfirmation = {
    ...reconfirmation,
    observation: {
      ...reconfirmation.observation,
      priorFullObservationOperationId: OperationId.make("missing-prior-full-observation")
    }
  }

  expect(
    latestFreshCompletedTaskObservationFor(
      [{ event: { _tag: "Other" }, position: JournalPosition.make(2) }],
      fixture.taskId,
      JournalPosition.make(1)
    )
  ).toBeUndefined()
  expect(
    latestFreshCompletedTaskObservationFor(
      [record(1, fixture.graphRecordEvent)],
      fixture.taskId,
      JournalPosition.make(1)
    )
  ).toBeUndefined()
  expect(
    latestFreshCompletedTaskObservationFor(
      [record(2, fixture.graphRecordEvent)],
      foreignTaskId,
      JournalPosition.make(1)
    )
  ).toBeUndefined()
  expect(
    latestFreshCompletedTaskObservationFor(
      [record(2, malformedReconfirmation as JournalRecord["event"])],
      fixture.taskId,
      JournalPosition.make(1)
    )
  ).toBeUndefined()
  expect(
    latestFreshCompletedTaskObservationFor(
      [record(1, fixture.graphRecordEvent), record(2, reconfirmation)],
      fixture.taskId,
      JournalPosition.make(2)
    )
  ).toBeUndefined()
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
  expect(validationErrors([...records.slice(0, 9), deletionAttempt])).toHaveLength(1)
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
      ...records.slice(0, 10),
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
})
