import { expect, it } from "vitest"
import { RunId, TaskId, TaskRevision } from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { taskTrackerReadIntent, type WorkflowJournalEvent } from "../../registry/event.js"
import { makeCompletionTaskFactsObservationOperation } from "../../registry/operation.js"
import {
  makeFocusedTaskCompletionFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"
import { integrationFinalityFixture as fixture } from "./fixtures.js"
import { invalidCompletionTaskHistory } from "./completion-task-history.js"
import {
  completionTaskCandidateAncestryReadOperationIdFor,
  completionTaskFocusedReadOperationIdFor,
  completionTaskRequestLookupOperationIdFor
} from "./completion-task-operation-identity.js"
import {
  CompletionTaskConfirmationReadOrdinal,
  CompletionTaskAuthorizationReadOrdinal,
  CompletionClaimReplacedEvent,
  CompletionTaskAcknowledgement,
  CompletionTaskAcknowledgedEvent,
  CompletionTaskAttemptIntendedEvent,
  CompletionTaskCandidateAncestryObservedEvent,
  CompletionTaskCandidateAncestryReadIntendedEvent,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskIntendedEvent,
  CompletionTaskRequestLookup,
  CompletionTaskRequestLookupIntendedEvent,
  CompletionTaskRequestLookupObservedEvent,
  CompletionTaskRequestOrdinal,
  CompletionTaskResponseLostEvent,
  completionClaimReplacementOperationIdFor,
  completionTaskRequestFor
} from "./events.js"

const request = completionTaskRequestFor(fixture.claim)
const ordinal = CompletionTaskRequestOrdinal.make(1)
const authorizationPurpose = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
  attemptOrdinal: ordinal,
  authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1)
})
const confirmationPurpose = CompletionTaskFocusedReadPurpose.cases.Confirmation.make({
  attemptOrdinal: ordinal,
  confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(1)
})
const trackerReadOperationId = completionTaskFocusedReadOperationIdFor(request, authorizationPurpose)
const gitReadOperationId = completionTaskCandidateAncestryReadOperationIdFor(request, authorizationPurpose)
const lookupOperationId = completionTaskRequestLookupOperationIdFor(request, ordinal)

const focusedFacts = (operationId: OperationId) => ({
  currentClaim: fixture.claim,
  lifecycle: "Open" as const,
  operationId,
  target: fixture.target,
  targetMembership: "Member" as const,
  taskId: fixture.taskId,
  taskRevision: fixture.plannedAttempt.taskRevision,
  trackerRevision: fixture.trackerRevision,
  unfinishedPrerequisiteTaskIds: []
})

const focusedReadEvents = (purpose: typeof authorizationPurpose | typeof confirmationPurpose) => {
  const operation = makeCompletionTaskFactsObservationOperation(request, fixture.target, purpose)
  const observation = makeFocusedTaskCompletionFactsObserved(operation, focusedFacts(operation.operationId))
  return {
    intent: taskTrackerReadIntent(operation),
    outcome: { ...taskTrackerFactsObservedEvent(operation.operationId, observation), observation }
  }
}

const record = (position: number, event: WorkflowJournalEvent): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`completion-history:${position}`),
  position: JournalPosition.make(position),
  runId: fixture.runId
})

const chronology = (): ReadonlyArray<JournalRecord> => [
  record(
    1,
    CompletionClaimReplacedEvent.make({
      claim: fixture.claim,
      operationId: completionClaimReplacementOperationIdFor(fixture.claim),
      version: workflowJournalEventVersion
    })
  ),
  record(2, focusedReadEvents(authorizationPurpose).intent),
  record(3, focusedReadEvents(authorizationPurpose).outcome),
  record(
    4,
    CompletionTaskCandidateAncestryReadIntendedEvent.make({
      attemptOrdinal: ordinal,
      operationId: gitReadOperationId,
      request,
      version: workflowJournalEventVersion
    })
  ),
  record(
    5,
    CompletionTaskCandidateAncestryObservedEvent.make({
      attemptOrdinal: ordinal,
      observation: { _tag: "CandidateCurrent", currentHeadSha: request.promotionCorrelation.candidateCommit },
      operationId: gitReadOperationId,
      request,
      version: workflowJournalEventVersion
    })
  ),
  record(6, CompletionTaskIntendedEvent.make({ request, version: workflowJournalEventVersion })),
  record(
    7,
    CompletionTaskAttemptIntendedEvent.make({
      attemptOrdinal: ordinal,
      focusedFactsOperationId: trackerReadOperationId,
      gitReadOperationId,
      request,
      version: workflowJournalEventVersion
    })
  ),
  record(
    8,
    CompletionTaskResponseLostEvent.make({ attemptOrdinal: ordinal, request, version: workflowJournalEventVersion })
  ),
  record(9, focusedReadEvents(confirmationPurpose).intent),
  record(10, focusedReadEvents(confirmationPurpose).outcome),
  record(
    11,
    CompletionTaskRequestLookupIntendedEvent.make({
      attemptOrdinal: ordinal,
      operationId: lookupOperationId,
      request,
      version: workflowJournalEventVersion
    })
  ),
  record(
    12,
    CompletionTaskRequestLookupObservedEvent.make({
      attemptOrdinal: ordinal,
      lookup: CompletionTaskRequestLookup.cases.NotApplied.make({ request }),
      operationId: lookupOperationId,
      request,
      version: workflowJournalEventVersion
    })
  )
]

const authorizationRecords = (
  attemptOrdinal: number,
  positions: readonly [number, number, number, number, number]
): ReadonlyArray<JournalRecord> => {
  const currentOrdinal = CompletionTaskRequestOrdinal.make(attemptOrdinal)
  const purpose = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
    attemptOrdinal: currentOrdinal,
    authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1)
  })
  const focusedOperationId = completionTaskFocusedReadOperationIdFor(request, purpose)
  const ancestryOperationId = completionTaskCandidateAncestryReadOperationIdFor(request, purpose)
  return [
    record(positions[0], focusedReadEvents(purpose).intent),
    record(positions[1], focusedReadEvents(purpose).outcome),
    record(
      positions[2],
      CompletionTaskCandidateAncestryReadIntendedEvent.make({
        attemptOrdinal: currentOrdinal,
        operationId: ancestryOperationId,
        request,
        version: workflowJournalEventVersion
      })
    ),
    record(
      positions[3],
      CompletionTaskCandidateAncestryObservedEvent.make({
        attemptOrdinal: currentOrdinal,
        observation: { _tag: "CandidateCurrent", currentHeadSha: request.promotionCorrelation.candidateCommit },
        operationId: ancestryOperationId,
        request,
        version: workflowJournalEventVersion
      })
    ),
    record(
      positions[4],
      CompletionTaskAttemptIntendedEvent.make({
        attemptOrdinal: currentOrdinal,
        focusedFactsOperationId: focusedOperationId,
        gitReadOperationId: ancestryOperationId,
        request,
        version: workflowJournalEventVersion
      })
    )
  ]
}

const lostResponseReconciliationRecords = (
  attemptOrdinal: number,
  startPosition: number
): ReadonlyArray<JournalRecord> => {
  const currentOrdinal = CompletionTaskRequestOrdinal.make(attemptOrdinal)
  const purpose = CompletionTaskFocusedReadPurpose.cases.Confirmation.make({
    attemptOrdinal: currentOrdinal,
    confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(1)
  })
  const currentLookupOperationId = completionTaskRequestLookupOperationIdFor(request, currentOrdinal)
  return [
    record(
      startPosition,
      CompletionTaskResponseLostEvent.make({
        attemptOrdinal: currentOrdinal,
        request,
        version: workflowJournalEventVersion
      })
    ),
    record(startPosition + 1, focusedReadEvents(purpose).intent),
    record(startPosition + 2, focusedReadEvents(purpose).outcome),
    record(
      startPosition + 3,
      CompletionTaskRequestLookupIntendedEvent.make({
        attemptOrdinal: currentOrdinal,
        operationId: currentLookupOperationId,
        request,
        version: workflowJournalEventVersion
      })
    ),
    record(
      startPosition + 4,
      CompletionTaskRequestLookupObservedEvent.make({
        attemptOrdinal: currentOrdinal,
        lookup: CompletionTaskRequestLookup.cases.NotApplied.make({ request }),
        operationId: currentLookupOperationId,
        request,
        version: workflowJournalEventVersion
      })
    )
  ]
}

it("accepts the exact completion authorization and lost-response reconciliation chronology", () => {
  const records = chronology()
  expect(records.flatMap((current) => invalidCompletionTaskHistory(current, records, fixture.runId) ?? [])).toEqual([])
})

it("reconstructs calls two and three only after the previous exact request was recorded NotApplied", () => {
  const records = [
    ...chronology(),
    ...authorizationRecords(2, [13, 14, 15, 16, 17]),
    ...lostResponseReconciliationRecords(2, 18),
    ...authorizationRecords(3, [23, 24, 25, 26, 27])
  ]
  expect(records.flatMap((current) => invalidCompletionTaskHistory(current, records, fixture.runId) ?? [])).toEqual([])
})

it("rejects retry calls without an exact prior NotApplied result recorded before fresh authorization", () => {
  const exact = [...chronology(), ...authorizationRecords(2, [13, 14, 15, 16, 17])]
  const attempt = eventAt(exact, 17)
  const withoutLookup = exact.filter(({ position }) => position !== JournalPosition.make(12))
  expect(invalidCompletionTaskHistory(attempt, withoutLookup, fixture.runId)?.detail).toContain(
    "lacks the previous exact NotApplied lookup before fresh authorization"
  )

  const lookupOutcome = eventAt(exact, 12).event
  if (lookupOutcome._tag !== "CompletionTaskRequestLookupObserved") throw new Error("fixture lacks lookup outcome")
  const applied = replaceAt(
    exact,
    12,
    CompletionTaskRequestLookupObservedEvent.make({
      ...lookupOutcome,
      lookup: CompletionTaskRequestLookup.cases.Applied.make({ request })
    })
  )
  expect(invalidCompletionTaskHistory(eventAt(applied, 17), applied, fixture.runId)?.detail).toContain(
    "lacks the previous exact NotApplied lookup before fresh authorization"
  )

  const freshAuthorizationPrecedesLookup = [
    ...chronology().filter(({ position }) => position !== JournalPosition.make(12)),
    ...authorizationRecords(2, [13, 14, 16, 17, 18]),
    record(15, lookupOutcome)
  ]
  expect(
    invalidCompletionTaskHistory(
      eventAt(freshAuthorizationPrecedesLookup, 18),
      freshAuthorizationPrecedesLookup,
      fixture.runId
    )?.detail
  ).toContain("lacks the previous exact NotApplied lookup before fresh authorization")

  const throughThirdCall = [
    ...exact,
    ...lostResponseReconciliationRecords(2, 18),
    ...authorizationRecords(3, [23, 24, 25, 26, 27])
  ]
  const thirdCallWithoutSecondLookup = throughThirdCall.filter(({ position }) => position !== JournalPosition.make(22))
  expect(
    invalidCompletionTaskHistory(eventAt(throughThirdCall, 27), thirdCallWithoutSecondLookup, fixture.runId)?.detail
  ).toContain("lacks the previous exact NotApplied lookup before fresh authorization")
})

it("rejects a completion call without its recorded current tracker outcome", () => {
  const records = chronology().filter(({ position }) => position !== JournalPosition.make(3))
  const attempt = records.find(({ event }) => event._tag === "CompletionTaskAttemptIntended")
  if (attempt === undefined) throw new Error("fixture lacks its completion attempt")
  expect(invalidCompletionTaskHistory(attempt, records, fixture.runId)?.detail).toContain(
    "lacks exact current tracker and Git authorization"
  )
})

it("rejects a Git authorization read started before the focused tracker outcome", () => {
  const exact = chronology()
  const focusedOutcome = eventAt(exact, 3).event
  const ancestryIntent = eventAt(exact, 4).event
  const reversed = replaceAt(replaceAt(exact, 3, ancestryIntent), 4, focusedOutcome)
  expect(invalidCompletionTaskHistory(eventAt(reversed, 3), reversed, fixture.runId)?.detail).toContain(
    "lacks its exact replacement-bound identity"
  )
})

it("rejects an exact-request lookup before the focused open-task confirmation", () => {
  const records = chronology().filter(({ position }) => position !== JournalPosition.make(10))
  const intent = records.find(({ event }) => event._tag === "CompletionTaskRequestLookupIntended")
  if (intent === undefined) throw new Error("fixture lacks its completion request lookup")
  expect(invalidCompletionTaskHistory(intent, records, fixture.runId)?.detail).toContain(
    "lacks a prior lost call and exact open-task confirmation"
  )
})

it("rejects an exact-request lookup when its open confirmation predates the lost response", () => {
  const exact = chronology()
  const lost = eventAt(exact, 8).event
  const confirmationIntent = eventAt(exact, 9).event
  const confirmationOutcome = eventAt(exact, 10).event
  const reversed = replaceAt(replaceAt(replaceAt(exact, 8, confirmationIntent), 9, confirmationOutcome), 10, lost)
  expect(invalidCompletionTaskHistory(eventAt(reversed, 11), reversed, fixture.runId)?.detail).toContain(
    "lacks a prior lost call and exact open-task confirmation"
  )
})

it("rejects task-completion evidence bound to another Run", () => {
  const records = chronology()
  const focusedIntent = records[1]
  if (focusedIntent === undefined) throw new Error("fixture lacks its focused read intent")
  expect(invalidCompletionTaskHistory(focusedIntent, records, RunId.make("another-run"))?.kind).toBe("Identity")
})

const eventAt = (records: ReadonlyArray<JournalRecord>, position: number): JournalRecord => {
  const found = records.find((candidate) => candidate.position === JournalPosition.make(position))
  if (found === undefined) throw new Error(`fixture lacks completion event at ${position}`)
  return found
}

const replaceAt = (
  records: ReadonlyArray<JournalRecord>,
  position: number,
  event: WorkflowJournalEvent
): ReadonlyArray<JournalRecord> =>
  records.map((candidate) =>
    candidate.position === JournalPosition.make(position) ? record(position, event) : candidate
  )

it("rejects duplicate Q and individually malformed focused/Git chronology", () => {
  const exact = chronology()
  const q = eventAt(exact, 6).event
  if (q._tag !== "CompletionTaskIntended") throw new Error("fixture lacks Q")
  const duplicated = [...exact, record(5, q)]
  expect(invalidCompletionTaskHistory(eventAt(exact, 6), duplicated, fixture.runId)?.detail).toContain(
    "lacks one exact prior claim replacement"
  )

  const focusedIntent = eventAt(exact, 2).event
  if (focusedIntent._tag !== "TaskTrackerReadIntentRecorded") throw new Error("fixture lacks focused intent")
  const wrongFocusedIntent = replaceAt(exact, 2, {
    ...focusedIntent,
    operation: { ...focusedIntent.operation, operationId: OperationId.make("wrong-focused-operation") }
  })
  expect(invalidCompletionTaskHistory(eventAt(wrongFocusedIntent, 2), wrongFocusedIntent, fixture.runId)).toBeDefined()

  const focusedOutcome = eventAt(exact, 3).event
  if (
    focusedOutcome._tag !== "TaskTrackerFactsObserved" ||
    focusedOutcome.observation._tag !== "FocusedTaskCompletionFacts"
  ) {
    throw new Error("fixture lacks focused outcome")
  }
  const wrongFocusedOutcome = replaceAt(exact, 3, {
    ...focusedOutcome,
    observation: {
      ...focusedOutcome.observation,
      facts: { ...focusedOutcome.observation.facts, operationId: OperationId.make("wrong-facts-operation") }
    }
  })
  expect(
    invalidCompletionTaskHistory(eventAt(wrongFocusedOutcome, 3), wrongFocusedOutcome, fixture.runId)
  ).toBeDefined()

  const ancestryIntent = eventAt(exact, 4).event
  if (ancestryIntent._tag !== "CompletionTaskCandidateAncestryReadIntended") {
    throw new Error("fixture lacks ancestry intent")
  }
  const wrongAncestryIntent = replaceAt(
    exact,
    4,
    CompletionTaskCandidateAncestryReadIntendedEvent.make({
      ...ancestryIntent,
      operationId: OperationId.make("wrong-ancestry-operation")
    })
  )
  expect(
    invalidCompletionTaskHistory(eventAt(wrongAncestryIntent, 4), wrongAncestryIntent, fixture.runId)
  ).toBeDefined()

  const ancestryOutcome = eventAt(exact, 5).event
  if (ancestryOutcome._tag !== "CompletionTaskCandidateAncestryObserved") {
    throw new Error("fixture lacks ancestry outcome")
  }
  const wrongAncestryOutcome = replaceAt(
    exact,
    5,
    CompletionTaskCandidateAncestryObservedEvent.make({
      ...ancestryOutcome,
      attemptOrdinal: CompletionTaskRequestOrdinal.make(2)
    })
  )
  expect(
    invalidCompletionTaskHistory(eventAt(wrongAncestryOutcome, 5), wrongAncestryOutcome, fixture.runId)
  ).toBeDefined()
})

it("rejects stale authorization, unnumbered outcomes, and mismatched acknowledgements", () => {
  const exact = chronology()
  const ancestry = eventAt(exact, 5).event
  if (ancestry._tag !== "CompletionTaskCandidateAncestryObserved") throw new Error("fixture lacks ancestry")
  const stale = replaceAt(
    exact,
    5,
    CompletionTaskCandidateAncestryObservedEvent.make({
      ...ancestry,
      observation: { _tag: "CandidateNotInAncestry", currentHeadSha: fixture.promotionCorrelation.expectedTargetHead }
    })
  )
  expect(invalidCompletionTaskHistory(eventAt(stale, 7), stale, fixture.runId)?.detail).toContain("stale")

  const focused = eventAt(exact, 3).event
  if (focused._tag !== "TaskTrackerFactsObserved" || focused.observation._tag !== "FocusedTaskCompletionFacts") {
    throw new Error("fixture lacks focused authorization")
  }
  const terminal = replaceAt(exact, 3, {
    ...focused,
    observation: {
      ...focused.observation,
      facts: { ...focused.observation.facts, lifecycle: "TerminalWithoutSuccess" }
    }
  })
  expect(invalidCompletionTaskHistory(eventAt(terminal, 7), terminal, fixture.runId)?.detail).toContain("unauthorized")

  const withoutAttempt = exact.filter(({ position }) => position !== JournalPosition.make(7))
  expect(invalidCompletionTaskHistory(eventAt(withoutAttempt, 8), withoutAttempt, fixture.runId)?.detail).toContain(
    "lacks its exact prior numbered call intent"
  )

  const acknowledgementAfterLost = CompletionTaskAcknowledgedEvent.make({
    acknowledgement: CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId }),
    attemptOrdinal: ordinal,
    request,
    version: workflowJournalEventVersion
  })
  const contradictoryOutcomes = [...exact.slice(0, 8), record(9, acknowledgementAfterLost)]
  expect(
    invalidCompletionTaskHistory(eventAt(contradictoryOutcomes, 9), contradictoryOutcomes, fixture.runId)?.detail
  ).toContain("mutually exclusive CompletionTaskResponseLost and CompletionTaskAcknowledged outcomes")

  const mismatchedAcknowledgement = CompletionTaskAcknowledgedEvent.make({
    acknowledgement: CompletionTaskAcknowledgement.make({
      operationId: OperationId.make("another-completion-request"),
      taskId: request.taskId
    }),
    attemptOrdinal: ordinal,
    request,
    version: workflowJournalEventVersion
  })
  const withAcknowledgement = [...exact.slice(0, 7), record(8, mismatchedAcknowledgement)]
  expect(invalidCompletionTaskHistory(eventAt(withAcknowledgement, 8), withAcknowledgement, fixture.runId)?.kind).toBe(
    "Identity"
  )
  const wrongTaskAcknowledgement = CompletionTaskAcknowledgedEvent.make({
    acknowledgement: CompletionTaskAcknowledgement.make({
      operationId: request.operationId,
      taskId: TaskId.make("another-task")
    }),
    attemptOrdinal: ordinal,
    request,
    version: workflowJournalEventVersion
  })
  const withWrongTaskAcknowledgement = [...exact.slice(0, 7), record(8, wrongTaskAcknowledgement)]
  expect(
    invalidCompletionTaskHistory(eventAt(withWrongTaskAcknowledgement, 8), withWrongTaskAcknowledgement, fixture.runId)
      ?.kind
  ).toBe("Identity")
})

it("rejects lookup outcomes that do not match their exact source", () => {
  const exact = chronology()
  const lookupOutcome = eventAt(exact, 12).event
  if (lookupOutcome._tag !== "CompletionTaskRequestLookupObserved") throw new Error("fixture lacks lookup outcome")
  const withoutLookupIntent = exact.filter(({ position }) => position !== JournalPosition.make(11))
  expect(
    invalidCompletionTaskHistory(eventAt(withoutLookupIntent, 12), withoutLookupIntent, fixture.runId)?.detail
  ).toContain("lacks its exact prior intent")
})

it("preserves a changed task revision for task-local conflict while rejecting another task operation or target", () => {
  const exact = chronology()
  const focusedOutcome = eventAt(exact, 3).event
  if (
    focusedOutcome._tag !== "TaskTrackerFactsObserved" ||
    focusedOutcome.observation._tag !== "FocusedTaskCompletionFacts"
  ) {
    throw new Error("fixture lacks focused outcome")
  }
  const focusedObservation = focusedOutcome.observation
  const withFacts = (facts: typeof focusedObservation.facts): ReadonlyArray<JournalRecord> =>
    replaceAt(exact, 3, { ...focusedOutcome, observation: { ...focusedObservation, facts } })

  const changedRevision = withFacts({
    ...focusedOutcome.observation.facts,
    taskRevision: TaskRevision.make("completion-history-human-edit")
  })
  expect(invalidCompletionTaskHistory(eventAt(changedRevision, 3), changedRevision, fixture.runId)).toBeUndefined()

  const wrongTask = withFacts({ ...focusedOutcome.observation.facts, taskId: TaskId.make("another-focused-task") })
  expect(invalidCompletionTaskHistory(eventAt(wrongTask, 3), wrongTask, fixture.runId)).toBeDefined()
  const wrongOperation = withFacts({
    ...focusedOutcome.observation.facts,
    operationId: OperationId.make("another-focused-operation")
  })
  expect(invalidCompletionTaskHistory(eventAt(wrongOperation, 3), wrongOperation, fixture.runId)).toBeDefined()
  const wrongTarget = withFacts({
    ...focusedOutcome.observation.facts,
    target: FixtureTarget.make("another-focused-target")
  })
  expect(invalidCompletionTaskHistory(eventAt(wrongTarget, 3), wrongTarget, fixture.runId)).toBeDefined()
})
