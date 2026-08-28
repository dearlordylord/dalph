import { expect, it } from "vitest"
import { Schema } from "effect"
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
  CompletionClaimDeletionReadObservedEvent,
  CompletionClaimDeletionReadPurpose,
  CompletionClaimCleanupReadOrdinal,
  CompletionClaimMarkerAbsent,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionClaimFinalityJournalEvent,
  completionOriginalTaskClaimReleaseFor,
  CompletionTaskAcknowledgement,
  CompletionTaskAcknowledgedEvent,
  CompletionTaskAttemptIntendedEvent,
  CompletionTaskCandidateAncestryObservedEvent,
  CompletionTaskCandidateAncestryReadIntendedEvent,
  CompletionTaskRejectedEvent,
  CompletionTaskRequestLookup,
  CompletionTaskRequestLookupIntendedEvent,
  CompletionTaskRequestLookupObservedEvent,
  CompletionTaskRequestOrdinal,
  CompletionTaskResponseLostEvent,
  CompletionClaimRequestOrdinal,
  CompletionTaskClaim,
  CompletionTaskIntendedEvent,
  completionTaskRequestFor,
  IntegrationFinalityJournalEvent,
  IntegrationFinalitySettledEvent
} from "./events.js"
import {
  deletionReadPurposeMatches,
  invalidIntegrationFinalityHistory,
  invalidIntegrationFinalityRunBinding,
  makeIntegrationFinalityHistoryIndexes,
  validateIntegrationFinalityHistoryRecord
} from "./history.js"
import {
  deriveIntegrationFinalityStateFor,
  isFinalityOccurrence,
  latestFocusedCompletedTaskObservationFor
} from "./state.js"
import { integrationFinalityFixture as fixture, prerequisiteRecordEvents } from "./fixtures.js"
import {
  makeCompletionTaskFactsObservationOperation,
  makeTaskAttemptPlanOperation,
  makeTaskClaimReleaseOperation,
  TaskClaimReleaseAuthority
} from "../../registry/operation.js"
import {
  taskTrackerReadIntent,
  TaskAttemptPlannedEvent,
  TaskClaimReleasedEvent,
  TaskClaimReleaseIntendedEvent
} from "../../registry/event.js"
import { describeJournalEvent } from "../../registry/event-descriptor.js"
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

const cleanupReleaseOperation = makeTaskClaimReleaseOperation({
  authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
  predecessorOperationIds: [fixture.activeClaim.operationId, successObservation.operationId],
  release: completionOriginalTaskClaimReleaseFor(fixture.claim)
})

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
  const originalReleaseRead = record(
    11,
    CompletionClaimDeletionReadObservedEvent.make({
      observation: fixture.claim,
      purpose: CompletionClaimDeletionReadPurpose.cases.BeforeOriginalClaimRelease.make({
        readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
      }),
      replacementOperationId,
      request: { claim: fixture.claim, operationId: deletionOperationId, successObservation },
      version: workflowJournalEventVersion
    })
  )
  const releaseIntent = record(
    12,
    TaskClaimReleaseIntendedEvent.make({ operation: cleanupReleaseOperation, version: workflowJournalEventVersion })
  )
  const released = record(
    13,
    TaskClaimReleasedEvent.make({ release: cleanupReleaseOperation.release, version: workflowJournalEventVersion })
  )
  const deletionRead = record(
    14,
    CompletionClaimDeletionReadObservedEvent.make({
      observation: fixture.claim,
      purpose: CompletionClaimDeletionReadPurpose.cases.BeforeDeletionAttempt.make({
        attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
        readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
      }),
      replacementOperationId,
      request: { claim: fixture.claim, operationId: deletionOperationId, successObservation },
      version: workflowJournalEventVersion
    })
  )
  const releaseConfirmed = record(
    15,
    CompletionClaimDeletionReadObservedEvent.make({
      observation: { _tag: "UnclaimedTask", taskId: fixture.taskId },
      purpose: CompletionClaimDeletionReadPurpose.cases.ConfirmOriginalClaimReleased.make({
        attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
        readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
      }),
      replacementOperationId,
      request: { claim: fixture.claim, operationId: deletionOperationId, successObservation },
      version: workflowJournalEventVersion
    })
  )
  const deletionAttempt = record(
    16,
    CompletionClaimDeletionAttemptIntendedEvent.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  const deletionAbsent = record(
    17,
    CompletionClaimDeletionReadObservedEvent.make({
      observation: CompletionClaimMarkerAbsent.make({ taskId: fixture.taskId }),
      purpose: CompletionClaimDeletionReadPurpose.cases.BeforeDeletionAttempt.make({
        attemptOrdinal: CompletionClaimRequestOrdinal.make(2),
        readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
      }),
      replacementOperationId,
      request: { claim: fixture.claim, operationId: deletionOperationId, successObservation },
      version: workflowJournalEventVersion
    })
  )
  const activeAbsentAfterMarker = record(
    18,
    CompletionClaimDeletionReadObservedEvent.make({
      observation: { _tag: "UnclaimedTask", taskId: fixture.taskId },
      purpose: CompletionClaimDeletionReadPurpose.cases.ConfirmNoActiveClaimAfterMarkerAbsent.make({
        attemptOrdinal: CompletionClaimRequestOrdinal.make(2),
        readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
      }),
      replacementOperationId,
      request: { claim: fixture.claim, operationId: deletionOperationId, successObservation },
      version: workflowJournalEventVersion
    })
  )
  const deleted = record(
    19,
    CompletionClaimDeletedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  )
  const settled = record(
    20,
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
    originalReleaseRead,
    releaseIntent,
    released,
    deletionRead,
    releaseConfirmed,
    deletionAttempt,
    deletionAbsent,
    activeAbsentAfterMarker,
    deleted,
    settled
  ]
}

const validationErrors = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<string> => {
  let indexes = makeIntegrationFinalityHistoryIndexes()
  return records.flatMap((current) => {
    const validation = invalidIntegrationFinalityHistory(current, records, indexes)
    indexes = validation.indexes
    return validation.detail === undefined ? [] : [validation.detail]
  })
}

const completeValidationErrors = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<string> => {
  let indexes = makeIntegrationFinalityHistoryIndexes()
  const errors: Array<string> = []
  for (const current of records) {
    indexes = validateIntegrationFinalityHistoryRecord(
      current,
      fixture.runId,
      records,
      indexes,
      (detail) => errors.push(detail),
      (detail) => errors.push(detail)
    )
  }
  return errors
}

const insertBeforeDeletionAttempt = (event: JournalRecord["event"]): ReadonlyArray<JournalRecord> => {
  const records = validFinalityRecords()
  const attemptIndex = records.findIndex(
    ({ event: candidate }) => candidate._tag === "CompletionClaimDeletionAttemptIntended"
  )
  const attempt = records[attemptIndex]
  expect(attempt).toBeDefined()
  if (attempt === undefined) return records
  return [
    ...records.slice(0, attemptIndex),
    record(Number(attempt.position), event, "history:contradictory-pre-delete-read"),
    ...records
      .slice(attemptIndex)
      .map((candidate) => ({ ...candidate, position: JournalPosition.make(Number(candidate.position) + 1) }))
  ]
}

it("accepts only the exact next cleanup reread identity after deletion intent", () => {
  const prefix = validFinalityRecords().slice(0, 10)
  let indexes = makeIntegrationFinalityHistoryIndexes()
  for (const current of prefix) indexes = invalidIntegrationFinalityHistory(current, prefix, indexes).indexes
  const request = { claim: fixture.claim, operationId: deletionOperationId, successObservation }
  const observed = CompletionClaimDeletionReadObservedEvent.make({
    observation: fixture.claim,
    purpose: CompletionClaimDeletionReadPurpose.cases.BeforeDeletionAttempt.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
      readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
    }),
    replacementOperationId,
    request,
    version: workflowJournalEventVersion
  })
  const read = record(11, observed, describeJournalEvent(observed).expectedKey)
  expect(deletionReadPurposeMatches(observed, 0)).toBe(true)
  expect(deletionReadPurposeMatches(observed, 1)).toBe(false)
  const afterExhaustion = CompletionClaimDeletionReadObservedEvent.make({
    ...observed,
    purpose: CompletionClaimDeletionReadPurpose.cases.AfterDeletionAttemptsExhausted.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(3),
      readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
    })
  })
  expect(deletionReadPurposeMatches(afterExhaustion, 3)).toBe(true)
  expect(deletionReadPurposeMatches(afterExhaustion, 2)).toBe(false)
  const identities: Array<string> = []
  const semantics: Array<string> = []
  validateIntegrationFinalityHistoryRecord(
    read,
    fixture.runId,
    [...prefix, read],
    indexes,
    (detail) => identities.push(detail),
    (detail) => semantics.push(detail)
  )
  expect(identities).toEqual([])
  expect(semantics).toEqual([])

  const wrongOrdinal = CompletionClaimDeletionReadObservedEvent.make({
    ...observed,
    purpose: CompletionClaimDeletionReadPurpose.cases.BeforeDeletionAttempt.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(2),
      readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
    })
  })
  validateIntegrationFinalityHistoryRecord(
    record(11, wrongOrdinal, describeJournalEvent(wrongOrdinal).expectedKey),
    fixture.runId,
    prefix,
    indexes,
    () => undefined,
    (detail) => semantics.push(detail)
  )
  expect(semantics).toContainEqual(expect.stringContaining("lacks its exact deletion intent, replacement, or ordinal"))
})

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

it("rejects cleanup release or marker deletion when either exact cleanup read is absent", () => {
  const records = validFinalityRecords()
  expect(validationErrors(records.filter(({ event }) => event._tag !== "CompletionClaimDeletionReadObserved"))).toEqual(
    expect.arrayContaining([
      "completion cleanup release intent requires a fresh exact completion-marker observation",
      expect.stringContaining("completion-claim deletion attempt")
    ])
  )
  expect(validationErrors(records.filter(({ event }) => event._tag !== "TaskClaimReleased"))).toContainEqual(
    expect.stringContaining("completion-claim deletion attempt")
  )
  expect(
    validationErrors(
      records.filter(
        ({ event }) =>
          event._tag !== "CompletionClaimDeletionReadObserved" || event.purpose._tag !== "ConfirmOriginalClaimReleased"
      )
    )
  ).toContainEqual(expect.stringContaining("completion-claim deletion attempt"))
  expect(
    validationErrors(
      records.filter(
        ({ event }) =>
          event._tag !== "CompletionClaimDeletionReadObserved" || event.purpose._tag !== "BeforeDeletionAttempt"
      )
    )
  ).toContainEqual(expect.stringContaining("completion-claim deletion attempt"))
})

it("rejects marker deletion when the current active-record read predates the exact marker reread", () => {
  const records = validFinalityRecords()
  const markerIndex = records.findIndex(
    ({ event }) =>
      event._tag === "CompletionClaimDeletionReadObserved" && event.purpose._tag === "BeforeDeletionAttempt"
  )
  const confirmationIndex = records.findIndex(
    ({ event }) =>
      event._tag === "CompletionClaimDeletionReadObserved" && event.purpose._tag === "ConfirmOriginalClaimReleased"
  )
  const marker = records[markerIndex]
  const confirmation = records[confirmationIndex]
  expect(marker).toBeDefined()
  expect(confirmation).toBeDefined()
  if (marker === undefined || confirmation === undefined) return
  const reversed = records.map((candidate, index) =>
    index === markerIndex
      ? { ...confirmation, position: candidate.position }
      : index === confirmationIndex
        ? { ...marker, position: candidate.position }
        : candidate
  )
  expect(completeValidationErrors(reversed)).toContainEqual(expect.stringContaining("completion claim cleanup read"))
  expect(completeValidationErrors(reversed)).toContainEqual(
    expect.stringContaining("completion-claim deletion attempt")
  )
})

it("rejects a deletion attempt after later absent or foreign marker reads contradict the earlier exact marker", () => {
  const foreignMarker = CompletionTaskClaim.make({
    ...fixture.claim,
    originalClaim: { ...fixture.activeClaim, operationId: OperationId.make("history-later-foreign-completion-marker") }
  })
  for (const observation of [CompletionClaimMarkerAbsent.make({ taskId: fixture.taskId }), foreignMarker]) {
    const contradictoryMarker = CompletionClaimDeletionReadObservedEvent.make({
      observation,
      purpose: CompletionClaimDeletionReadPurpose.cases.BeforeDeletionAttempt.make({
        attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
        readOrdinal: CompletionClaimCleanupReadOrdinal.make(2)
      }),
      replacementOperationId,
      request: { claim: fixture.claim, operationId: deletionOperationId, successObservation },
      version: workflowJournalEventVersion
    })

    expect(completeValidationErrors(insertBeforeDeletionAttempt(contradictoryMarker))).toContainEqual(
      expect.stringContaining("completion-claim deletion attempt")
    )
  }
})

it("rejects a deletion attempt after later exact or foreign active reads contradict the earlier absence", () => {
  const foreignActive = { ...fixture.activeClaim, operationId: OperationId.make("history-later-foreign-active-claim") }
  for (const observation of [fixture.activeClaim, foreignActive]) {
    const contradictoryActive = CompletionClaimDeletionReadObservedEvent.make({
      observation,
      purpose: CompletionClaimDeletionReadPurpose.cases.ConfirmOriginalClaimReleased.make({
        attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
        readOrdinal: CompletionClaimCleanupReadOrdinal.make(2)
      }),
      replacementOperationId,
      request: { claim: fixture.claim, operationId: deletionOperationId, successObservation },
      version: workflowJournalEventVersion
    })

    expect(completeValidationErrors(insertBeforeDeletionAttempt(contradictoryActive))).toContainEqual(
      expect.stringContaining("completion-claim deletion attempt")
    )
  }
})

it("rejects an active-record absence observation as proof that the completion marker was deleted", () => {
  const records = validFinalityRecords().map((candidate) =>
    candidate.event._tag === "CompletionClaimDeletionReadObserved" &&
    candidate.event.purpose._tag === "BeforeDeletionAttempt" &&
    candidate.event.observation._tag === "CompletionClaimMarkerAbsent"
      ? {
          ...candidate,
          event: CompletionClaimDeletionReadObservedEvent.make({
            ...candidate.event,
            observation: { _tag: "UnclaimedTask", taskId: fixture.taskId }
          })
        }
      : candidate
  )
  const errors = completeValidationErrors(records)
  expect(errors).toContainEqual(expect.stringContaining("cleanup read observation kind"))
  expect(errors).toContainEqual(expect.stringContaining("completion-claim deletion outcome"))
})

it("rejects completion-marker absence as an active-record confirmation", () => {
  const records = validFinalityRecords().map((candidate) =>
    candidate.event._tag === "CompletionClaimDeletionReadObserved" &&
    candidate.event.purpose._tag === "ConfirmNoActiveClaimAfterMarkerAbsent"
      ? {
          ...candidate,
          event: CompletionClaimDeletionReadObservedEvent.make({
            ...candidate.event,
            observation: CompletionClaimMarkerAbsent.make({ taskId: fixture.taskId })
          })
        }
      : candidate
  )
  expect(completeValidationErrors(records)).toContainEqual(expect.stringContaining("cleanup read observation kind"))
})

it("rejects marker-deletion settlement without a fresh active-record absence after marker absence", () => {
  const records = validFinalityRecords().filter(
    ({ event }) =>
      event._tag !== "CompletionClaimDeletionReadObserved" ||
      event.purpose._tag !== "ConfirmNoActiveClaimAfterMarkerAbsent"
  )
  expect(completeValidationErrors(records)).toContainEqual(expect.stringContaining("completion-claim deletion outcome"))
})

it("rejects marker-deletion settlement when a later active-record read contradicts the recorded absence", () => {
  const records = validFinalityRecords()
  const contradictoryRead = record(
    19,
    CompletionClaimDeletionReadObservedEvent.make({
      observation: fixture.activeClaim,
      purpose: CompletionClaimDeletionReadPurpose.cases.ConfirmNoActiveClaimAfterMarkerAbsent.make({
        attemptOrdinal: CompletionClaimRequestOrdinal.make(2),
        readOrdinal: CompletionClaimCleanupReadOrdinal.make(2)
      }),
      replacementOperationId,
      request: { claim: fixture.claim, operationId: deletionOperationId, successObservation },
      version: workflowJournalEventVersion
    })
  )
  const chronology = [
    ...records.slice(0, -2),
    contradictoryRead,
    ...records
      .slice(-2)
      .map((candidate) => ({ ...candidate, position: JournalPosition.make(Number(candidate.position) + 1) }))
  ]

  expect(completeValidationErrors(chronology)).toContainEqual(
    expect.stringContaining("completion-claim deletion outcome")
  )
})

it("projects each phase from exact stored evidence without rescanning authority state", () => {
  const records = validFinalityRecords()
  expect(deriveIntegrationFinalityStateFor(records.slice(0, 4), fixture.claim)?._tag).toBe("ReplacementPending")
  expect(deriveIntegrationFinalityStateFor(records.slice(0, 6), fixture.claim)?._tag).toBe("CompletionClaimReplaced")
  expect(deriveIntegrationFinalityStateFor(records.slice(0, 10), fixture.claim)?._tag).toBe("DeletionPending")
  expect(deriveIntegrationFinalityStateFor(records.slice(0, 19), fixture.claim)?._tag).toBe("CompletionClaimDeleted")
  expect(deriveIntegrationFinalityStateFor(records, fixture.claim)?._tag).toBe("IntegrationFinalitySettled")
})

it("keeps every finality event accepted while excluding unrelated or malformed records", () => {
  const claimOrdinal = CompletionClaimRequestOrdinal.make(1)
  const taskOrdinal = CompletionTaskRequestOrdinal.make(1)
  const request = fixture.completionRequest
  const focusedFactsOperationId = fixture.focusedSuccessFactsEvent.operationId
  const candidateAncestryOperationId = OperationId.make("history-candidate-ancestry")
  const lookupOperationId = OperationId.make("history-request-lookup")
  const claimEvents = validFinalityRecords().flatMap(({ event }) =>
    Schema.is(CompletionClaimFinalityJournalEvent)(event) ? [event] : []
  )
  const finalityEvents = [
    ...claimEvents,
    CompletionClaimDeletionReadObservedEvent.make({
      observation: fixture.claim,
      purpose: CompletionClaimDeletionReadPurpose.cases.BeforeDeletionAttempt.make({
        attemptOrdinal: claimOrdinal,
        readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
      }),
      replacementOperationId,
      request: { claim: fixture.claim, operationId: deletionOperationId, successObservation },
      version: workflowJournalEventVersion
    }),
    CompletionTaskIntendedEvent.make({ request, version: workflowJournalEventVersion }),
    CompletionTaskAttemptIntendedEvent.make({
      attemptOrdinal: taskOrdinal,
      focusedFactsOperationId,
      gitReadOperationId: candidateAncestryOperationId,
      request,
      version: workflowJournalEventVersion
    }),
    CompletionTaskAcknowledgedEvent.make({
      acknowledgement: CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId }),
      attemptOrdinal: taskOrdinal,
      request,
      version: workflowJournalEventVersion
    }),
    CompletionTaskResponseLostEvent.make({
      attemptOrdinal: taskOrdinal,
      request,
      version: workflowJournalEventVersion
    }),
    CompletionTaskRejectedEvent.make({
      attemptOrdinal: taskOrdinal,
      detail: "controlled rejection",
      request,
      version: workflowJournalEventVersion
    }),
    CompletionTaskCandidateAncestryReadIntendedEvent.make({
      attemptOrdinal: taskOrdinal,
      operationId: candidateAncestryOperationId,
      request,
      version: workflowJournalEventVersion
    }),
    CompletionTaskCandidateAncestryObservedEvent.make({
      attemptOrdinal: taskOrdinal,
      observation: {
        _tag: "CandidateCurrent",
        currentHeadSha: fixture.promotionCorrelation.qualifiedCandidate.candidateCommit
      },
      operationId: candidateAncestryOperationId,
      request,
      version: workflowJournalEventVersion
    }),
    CompletionTaskRequestLookupIntendedEvent.make({
      attemptOrdinal: taskOrdinal,
      operationId: lookupOperationId,
      request,
      version: workflowJournalEventVersion
    }),
    CompletionTaskRequestLookupObservedEvent.make({
      attemptOrdinal: taskOrdinal,
      lookup: CompletionTaskRequestLookup.cases.NotApplied.make({ request }),
      operationId: lookupOperationId,
      request,
      version: workflowJournalEventVersion
    })
  ]

  expect(finalityEvents.map(({ _tag }) => _tag).toSorted((left, right) => left.localeCompare(right))).toEqual(
    [
      "CompletionClaimDeletionAttemptIntended",
      "CompletionClaimDeleted",
      "CompletionClaimDeletionIntended",
      "CompletionClaimDeletionReadObserved",
      "CompletionClaimReplaced",
      "CompletionClaimReplacementAttemptIntended",
      "CompletionClaimReplacementIntended",
      "CompletionTaskAcknowledged",
      "CompletionTaskAttemptIntended",
      "CompletionTaskCandidateAncestryObserved",
      "CompletionTaskCandidateAncestryReadIntended",
      "CompletionTaskIntended",
      "CompletionTaskRejected",
      "CompletionTaskRequestLookupIntended",
      "CompletionTaskRequestLookupObserved",
      "CompletionTaskResponseLost",
      "IntegrationFinalitySettled"
    ].toSorted((left, right) => left.localeCompare(right))
  )
  expect(
    finalityEvents.map((event, index) => isFinalityOccurrence({ event, position: JournalPosition.make(index + 1) }))
  ).toEqual(finalityEvents.map((event) => Schema.is(IntegrationFinalityJournalEvent)(event)))
  expect(
    [fixture.promotionSuccess, fixture.graphRecordEvent, null, 42, { _tag: "CompletionTaskRejected" }].map((event) =>
      isFinalityOccurrence({ event, position: JournalPosition.make(1) })
    )
  ).toEqual([false, false, false, false, false])
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
  expect(deriveIntegrationFinalityStateFor([...records.slice(0, 19), mismatchedSettlement], fixture.claim)?._tag).toBe(
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
      ...records.slice(0, 16),
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
  const deletionRead = CompletionClaimDeletionReadObservedEvent.make({
    observation: fixture.claim,
    purpose: CompletionClaimDeletionReadPurpose.cases.BeforeDeletionAttempt.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
      readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
    }),
    replacementOperationId,
    request: { claim: fixture.claim, operationId: deletionOperationId, successObservation },
    version: workflowJournalEventVersion
  })
  expect(invalidIntegrationFinalityRunBinding(deletionRead, fixture.runId)).toBeUndefined()
  expect(invalidIntegrationFinalityRunBinding(deletionRead, RunId.make("foreign-finality-run"))).toContain(
    fixture.runId
  )
  const foreignDeletionSemantics: Array<string> = []
  validateIntegrationFinalityHistoryRecord(
    record(1, deletionRead),
    RunId.make("foreign-finality-run"),
    [],
    makeIntegrationFinalityHistoryIndexes(),
    () => undefined,
    (detail) => foreignDeletionSemantics.push(detail)
  )
  expect(foreignDeletionSemantics).toContain(`completion claim cleanup read binds run ${fixture.runId}`)
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
