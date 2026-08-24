import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { AttemptChoiceRequestId } from "../attempt-choice/events.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { PlannedAttemptWorktreeObservedEvent } from "../../registry/event.js"
import {
  worktreeCleanupAbsenceConfirmedRecordKey,
  worktreeCleanupAuthorizedRecordKey,
  worktreeCleanupContradictedRecordKey,
  worktreeCleanupMutationIntendedRecordKey,
  worktreeCleanupMutationResultRecordedRecordKey,
  worktreeCleanupObservationIntendedRecordKey,
  worktreeCleanupObservedRecordKey,
  worktreeCleanupSettledRecordKey
} from "../../../workflow-journal/record-key.js"
import {
  CleanupMutationOrdinal,
  CleanupObservationOrdinal,
  PlannedAttemptCleanupDisposition,
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupOwner,
  worktreeCleanupAuthorizationEquals
} from "./disposition.js"
import {
  WorktreeCleanupAbsenceConfirmedEvent,
  WorktreeCleanupAuthorizedEvent,
  WorktreeCleanupContradictedEvent,
  type WorktreeCleanupJournalEvent,
  WorktreeCleanupMutationIntendedEvent,
  WorktreeCleanupMutationResult,
  WorktreeCleanupMutationResultRecordedEvent,
  WorktreeCleanupObservation,
  WorktreeCleanupObservationIntendedEvent,
  WorktreeCleanupObservedEvent,
  WorktreeCleanupSettledEvent
} from "./worktree.js"
import { validateCleanupHistory, type CleanupHistoryDescriptor } from "./cleanup-history.js"

const runId = RunId.make("cleanup-history-test-run")
const baseSha = GitCommitSha.make("1".repeat(40))
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("cleanup-history-attempt"),
  baseSha,
  branch: TaskBranchRef.make("refs/heads/task/cleanup-history"),
  executor: TaskExecutorLocator.make("executor:cleanup-history"),
  runId,
  taskId: TaskId.make("cleanup-history-task"),
  taskRevision: TaskRevision.make("cleanup-history-revision"),
  worktree: WorktreeLocator.make("/tmp/cleanup-history")
})
const disposition = PlannedAttemptCleanupDisposition.cases.Abandoned.make({
  dispositionAt: JournalPosition.make(1),
  plannedAttempt: attempt,
  requestId: AttemptChoiceRequestId.make({ nonce: "cleanup-history-request", runId })
})
const authorization = WorktreeCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("cleanup-history:predecessor")],
  disposition,
  evidenceRevision: WorktreeCleanupEvidenceRevision.make(1),
  expectedHead: baseSha,
  locator: attempt.worktree,
  observationAt: JournalPosition.make(1),
  observationOperationId: OperationId.make("cleanup-history:source-observation"),
  operationId: OperationId.make("cleanup-history"),
  owner: WorktreeCleanupOwner.make({ attemptId: attempt.attemptId, branch: attempt.branch }),
  writerQuiescent: true
})
const foreignAuthorization = WorktreeCleanupAuthorization.make({
  ...authorization,
  expectedHead: GitCommitSha.make("2".repeat(40))
})

const observationOperationId = (ordinal: number): OperationId =>
  OperationId.make(`cleanup-history:observation:${ordinal}`)
const mutationOperationId = (attemptOrdinal: number): OperationId =>
  OperationId.make(`cleanup-history:mutation:${attemptOrdinal}`)
const foreignOperationId = OperationId.make("cleanup-history:foreign-operation")

const record = (position: number, key: JournalRecordKey, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key,
  position: JournalPosition.make(position),
  runId
})

const authorized = (eventAuthorization = authorization): JournalRecord =>
  record(
    1,
    worktreeCleanupAuthorizedRecordKey(eventAuthorization.operationId),
    WorktreeCleanupAuthorizedEvent.make({
      authorization: eventAuthorization,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )

const absentObservation = (revision: number): Extract<WorktreeCleanupObservation, { readonly _tag: "Absent" }> =>
  WorktreeCleanupObservation.cases.Absent.make({
    locator: attempt.worktree,
    revision: WorktreeCleanupEvidenceRevision.make(revision)
  })

const observation = (state: "Present" | "Absent", revision: number): WorktreeCleanupObservation =>
  state === "Present"
    ? WorktreeCleanupObservation.cases.Present.make({
        attemptId: attempt.attemptId,
        branch: attempt.branch,
        headSha: baseSha,
        locator: attempt.worktree,
        revision: WorktreeCleanupEvidenceRevision.make(revision),
        writerQuiescent: true
      })
    : absentObservation(revision)

const observationIntent = (
  position: number,
  ordinal: number,
  eventOperationId = observationOperationId(ordinal),
  eventAuthorization = authorization,
  key = worktreeCleanupObservationIntendedRecordKey(
    eventAuthorization.operationId,
    CleanupObservationOrdinal.make(ordinal)
  )
): JournalRecord => {
  const observationOrdinal = CleanupObservationOrdinal.make(ordinal)
  return record(
    position,
    key,
    WorktreeCleanupObservationIntendedEvent.make({
      authorization: eventAuthorization,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operationId: eventOperationId,
      ordinal: observationOrdinal,
      version: workflowJournalEventVersion
    })
  )
}

const observed = (
  position: number,
  ordinal: number,
  state: "Present" | "Absent" = "Present",
  eventOperationId = observationOperationId(ordinal),
  eventAuthorization = authorization,
  revision = state === "Present" ? 1 : 2,
  key = worktreeCleanupObservedRecordKey(eventAuthorization.operationId, CleanupObservationOrdinal.make(ordinal))
): JournalRecord => {
  const observationOrdinal = CleanupObservationOrdinal.make(ordinal)
  return record(
    position,
    key,
    WorktreeCleanupObservedEvent.make({
      authorization: eventAuthorization,
      observation: observation(state, revision),
      occurrenceClassification: "NonActionOccurrence",
      operationId: eventOperationId,
      ordinal: observationOrdinal,
      version: workflowJournalEventVersion
    })
  )
}

const mutationIntent = (
  position: number,
  attemptOrdinal = 1,
  eventOperationId = mutationOperationId(attemptOrdinal),
  eventAuthorization = authorization,
  key = worktreeCleanupMutationIntendedRecordKey(
    eventAuthorization.operationId,
    CleanupMutationOrdinal.make(attemptOrdinal)
  )
): JournalRecord => {
  const mutationOrdinal = CleanupMutationOrdinal.make(attemptOrdinal)
  return record(
    position,
    key,
    WorktreeCleanupMutationIntendedEvent.make({
      attempt: mutationOrdinal,
      authorization: eventAuthorization,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operationId: eventOperationId,
      version: workflowJournalEventVersion
    })
  )
}

const mutationResultValue = (
  result: "Removed" | "AlreadyAbsent" = "Removed",
  revision = 2
): Extract<WorktreeCleanupMutationResult, { readonly _tag: "Removed" | "AlreadyAbsent" }> =>
  result === "Removed"
    ? WorktreeCleanupMutationResult.cases.Removed.make({
        branch: attempt.branch,
        locator: attempt.worktree,
        revision: WorktreeCleanupEvidenceRevision.make(revision)
      })
    : WorktreeCleanupMutationResult.cases.AlreadyAbsent.make({
        branch: attempt.branch,
        locator: attempt.worktree,
        revision: WorktreeCleanupEvidenceRevision.make(revision)
      })

const mutationResult = (
  position: number,
  attemptOrdinal = 1,
  eventOperationId = mutationOperationId(attemptOrdinal),
  eventAuthorization = authorization,
  key = worktreeCleanupMutationResultRecordedRecordKey(
    eventAuthorization.operationId,
    CleanupMutationOrdinal.make(attemptOrdinal)
  )
): JournalRecord => {
  const mutationOrdinal = CleanupMutationOrdinal.make(attemptOrdinal)
  return record(
    position,
    key,
    WorktreeCleanupMutationResultRecordedEvent.make({
      attempt: mutationOrdinal,
      authorization: eventAuthorization,
      occurrenceClassification: "NonActionOccurrence",
      operationId: eventOperationId,
      result: mutationResultValue(),
      version: workflowJournalEventVersion
    })
  )
}

const absence = (
  position: number,
  ordinal = 2,
  cause: "InitialAbsence" | "MutationResponseReconciliation" = "MutationResponseReconciliation",
  eventOperationId = observationOperationId(ordinal),
  eventAuthorization = authorization,
  revision = 2,
  key = worktreeCleanupAbsenceConfirmedRecordKey(
    eventAuthorization.operationId,
    CleanupObservationOrdinal.make(ordinal)
  )
): JournalRecord => {
  const observationOrdinal = CleanupObservationOrdinal.make(ordinal)
  return record(
    position,
    key,
    WorktreeCleanupAbsenceConfirmedEvent.make({
      authorization: eventAuthorization,
      cause,
      observation: absentObservation(revision),
      occurrenceClassification: "NonActionOccurrence",
      operationId: eventOperationId,
      ordinal: observationOrdinal,
      version: workflowJournalEventVersion
    })
  )
}

const contradiction = (
  position: number,
  eventOperationId = observationOperationId(1),
  eventAuthorization = authorization,
  key = worktreeCleanupContradictedRecordKey(eventAuthorization.operationId)
): JournalRecord =>
  record(
    position,
    key,
    WorktreeCleanupContradictedEvent.make({
      authorization: eventAuthorization,
      detail: "cleanup-history contradiction",
      observation: observation("Present", 1),
      occurrenceClassification: "NonActionOccurrence",
      operationId: eventOperationId,
      version: workflowJournalEventVersion
    })
  )

const settled = (
  position: number,
  result: "Removed" | "AlreadyAbsent" = "Removed",
  eventAuthorization = authorization,
  key = worktreeCleanupSettledRecordKey(eventAuthorization.operationId)
): JournalRecord =>
  record(
    position,
    key,
    WorktreeCleanupSettledEvent.make({
      authorization: eventAuthorization,
      occurrenceClassification: "NonActionOccurrence",
      result: mutationResultValue(result),
      version: workflowJournalEventVersion
    })
  )

const isWorktreeCleanupEvent = (event: JournalRecord["event"]): event is WorktreeCleanupJournalEvent =>
  event._tag === "WorktreeCleanupAuthorized" ||
  event._tag === "WorktreeCleanupObservationIntended" ||
  event._tag === "WorktreeCleanupObserved" ||
  event._tag === "WorktreeCleanupAbsenceConfirmed" ||
  event._tag === "WorktreeCleanupMutationIntended" ||
  event._tag === "WorktreeCleanupMutationResultRecorded" ||
  event._tag === "WorktreeCleanupContradicted" ||
  event._tag === "WorktreeCleanupSettled"

const expectedObservationOperationId = (ordinal: CleanupObservationOrdinal): OperationId =>
  observationOperationId(Number(ordinal))

const expectedMutationOperationId = (ordinal: CleanupMutationOrdinal): OperationId =>
  mutationOperationId(Number(ordinal))

const worktreeCleanupObservationEquals = Schema.toEquivalence(WorktreeCleanupObservation)
const worktreeCleanupMutationResultEquals = Schema.toEquivalence(WorktreeCleanupMutationResult)

const descriptor: CleanupHistoryDescriptor<WorktreeCleanupAuthorization> = {
  data: {
    absenceTag: "WorktreeCleanupAbsenceConfirmed",
    authorizedKey: worktreeCleanupAuthorizedRecordKey(authorization.operationId),
    authorization,
    authorizationTag: "WorktreeCleanupAuthorized",
    contradictionTag: "WorktreeCleanupContradicted",
    familyTags: [
      "WorktreeCleanupAuthorized",
      "WorktreeCleanupObservationIntended",
      "WorktreeCleanupObserved",
      "WorktreeCleanupMutationIntended",
      "WorktreeCleanupMutationResultRecorded",
      "WorktreeCleanupAbsenceConfirmed",
      "WorktreeCleanupContradicted",
      "WorktreeCleanupSettled"
    ],
    maxMutationAttempts: 3,
    mutationIntentTag: "WorktreeCleanupMutationIntended",
    mutationResultTag: "WorktreeCleanupMutationResultRecorded",
    observedTag: "WorktreeCleanupObserved",
    observationIntentTag: "WorktreeCleanupObservationIntended",
    operationId: authorization.operationId,
    runId,
    settledTag: "WorktreeCleanupSettled",
    successDetail: "valid fixture chronology"
  },
  strategies: {
    authorizationEquals: worktreeCleanupAuthorizationEquals,
    authorizationOf: (event) => (isWorktreeCleanupEvent(event) ? event.authorization : undefined),
    observationIntent: (event) =>
      event._tag === "WorktreeCleanupObservationIntended"
        ? {
            key: String(event.ordinal),
            recordKey: worktreeCleanupObservationIntendedRecordKey(event.authorization.operationId, event.ordinal)
          }
        : undefined,
    observationResult: (event) =>
      event._tag === "WorktreeCleanupObserved"
        ? {
            identityMatches: event.operationId === expectedObservationOperationId(event.ordinal),
            key: String(event.ordinal),
            operationId: event.operationId,
            recordKey: worktreeCleanupObservedRecordKey(event.authorization.operationId, event.ordinal)
          }
        : undefined,
    mutationIntent: (event) =>
      event._tag === "WorktreeCleanupMutationIntended"
        ? {
            attempt: String(event.attempt),
            operationId: event.operationId,
            recordKey: worktreeCleanupMutationIntendedRecordKey(event.authorization.operationId, event.attempt)
          }
        : undefined,
    mutationResult: (event) =>
      event._tag === "WorktreeCleanupMutationResultRecorded"
        ? {
            attempt: String(event.attempt),
            identityMatches: event.operationId === expectedMutationOperationId(event.attempt),
            operationId: event.operationId,
            recordKey: worktreeCleanupMutationResultRecordedRecordKey(event.authorization.operationId, event.attempt)
          }
        : undefined,
    absence: (event, observations) => {
      if (event._tag !== "WorktreeCleanupAbsenceConfirmed") return undefined
      const observed = observations.get(String(event.ordinal))
      const observedEvent = observed?.event
      return {
        cause: event.cause,
        identityMatches: event.operationId === expectedObservationOperationId(event.ordinal),
        key: String(event.ordinal),
        observationMatches:
          observedEvent?._tag === "WorktreeCleanupObserved" &&
          worktreeCleanupObservationEquals(observedEvent.observation, event.observation),
        recordKey: worktreeCleanupAbsenceConfirmedRecordKey(event.authorization.operationId, event.ordinal)
      }
    },
    contradiction: (event) =>
      event._tag === "WorktreeCleanupContradicted"
        ? {
            identityMatches:
              event.operationId === observationOperationId(1) || event.operationId === observationOperationId(2),
            observationOperationId: event.operationId,
            recordKey: worktreeCleanupContradictedRecordKey(event.authorization.operationId)
          }
        : undefined,
    settled: (event, context) => {
      if (event._tag !== "WorktreeCleanupSettled") return undefined
      const mutationResult = context.mutationResult
      const resultMatches =
        mutationResult === undefined
          ? event.result._tag === "AlreadyAbsent"
          : mutationResult.event._tag === "WorktreeCleanupMutationResultRecorded" &&
            worktreeCleanupMutationResultEquals(event.result, mutationResult.event.result)
      return {
        identityMatches: worktreeCleanupAuthorizationEquals(event.authorization, authorization),
        resultMatches,
        recordKey: worktreeCleanupSettledRecordKey(event.authorization.operationId)
      }
    },
    isPresentObservation: (event) => event._tag === "WorktreeCleanupObserved" && event.observation._tag === "Present",
    isAbsentObservation: (event) => event._tag === "WorktreeCleanupObserved" && event.observation._tag === "Absent"
  }
}

const descriptorWithNonAuthorizationFamilyEvent: CleanupHistoryDescriptor<WorktreeCleanupAuthorization> = {
  ...descriptor,
  data: { ...descriptor.data, familyTags: [...descriptor.data.familyTags, "PlannedAttemptWorktreeObserved"] }
}

const descriptorWithoutObservationIdentity: CleanupHistoryDescriptor<WorktreeCleanupAuthorization> = {
  ...descriptor,
  strategies: { ...descriptor.strategies, observationResult: () => undefined }
}

const descriptorWithoutMutationIdentity: CleanupHistoryDescriptor<WorktreeCleanupAuthorization> = {
  ...descriptor,
  strategies: { ...descriptor.strategies, mutationResult: () => undefined }
}

const descriptorWithoutAbsenceIdentity: CleanupHistoryDescriptor<WorktreeCleanupAuthorization> = {
  ...descriptor,
  strategies: { ...descriptor.strategies, absence: () => undefined }
}

const validRecords = (includeMutationResult = true): ReadonlyArray<JournalRecord> => {
  const secondIntentPosition = includeMutationResult ? 6 : 5
  const secondObservedPosition = includeMutationResult ? 7 : 6
  const absencePosition = includeMutationResult ? 8 : 7
  const settledPosition = includeMutationResult ? 9 : 8
  return [
    authorized(),
    observationIntent(2, 1),
    observed(3, 1),
    mutationIntent(4),
    ...(includeMutationResult ? [mutationResult(5)] : []),
    observationIntent(secondIntentPosition, 2),
    observed(secondObservedPosition, 2, "Absent"),
    absence(absencePosition),
    settled(settledPosition, includeMutationResult ? "Removed" : "AlreadyAbsent")
  ]
}

const replaceRecord = (
  records: ReadonlyArray<JournalRecord>,
  predicate: (candidate: JournalRecord) => boolean,
  replacement: JournalRecord
): ReadonlyArray<JournalRecord> => records.map((candidate) => (predicate(candidate) ? replacement : candidate))

describe("cleanup history chronology", () => {
  it("accepts a family with no records", () => {
    expect(validateCleanupHistory([], descriptor)._tag).toBe("Valid")
  })

  it("accepts one authorized prefix through mutation reconciliation and settlement", () => {
    expect(validateCleanupHistory(validRecords(), descriptor)).toEqual({
      _tag: "Valid",
      detail: "valid fixture chronology"
    })
  })

  it("accepts a fresh absence after a mutation intent whose response was lost", () => {
    expect(validateCleanupHistory(validRecords(false), descriptor)._tag).toBe("Valid")
  })

  it("accepts a current observation contradiction but rejects one after a newer pending intent", () => {
    expect(
      validateCleanupHistory(
        [authorized(), observationIntent(2, 1), observed(3, 1), contradiction(4, observationOperationId(1))],
        descriptor
      )._tag
    ).toBe("Valid")
    expect(
      validateCleanupHistory(
        [
          authorized(),
          observationIntent(2, 1),
          observed(3, 1),
          observationIntent(4, 2),
          contradiction(5, observationOperationId(1))
        ],
        descriptor
      )._tag
    ).toBe("Invalid")
  })

  it("ignores a typed family event without an authorization subject", () => {
    const event = PlannedAttemptWorktreeObservedEvent.make({
      observation: PlannedWorktreeReady.make({
        baseSha,
        branch: attempt.branch,
        headSha: baseSha,
        worktree: attempt.worktree
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: authorization.operationId,
      version: workflowJournalEventVersion
    })
    expect(
      validateCleanupHistory(
        [record(1, JournalRecordKey.make("cleanup-history:non-authorization"), event)],
        descriptorWithNonAuthorizationFamilyEvent
      )._tag
    ).toBe("Valid")
  })

  it.each([
    ["observation", descriptorWithoutObservationIdentity],
    ["mutation result", descriptorWithoutMutationIdentity],
    ["absence", descriptorWithoutAbsenceIdentity]
  ] as const)("rejects a %s event with no typed identity", (_name, alteredDescriptor) => {
    expect(validateCleanupHistory(validRecords(), alteredDescriptor)._tag).toBe("Invalid")
  })

  it.each([
    ["family event without authorization", (records: ReadonlyArray<JournalRecord>) => records.slice(1)],
    ["duplicate authorization", (records: ReadonlyArray<JournalRecord>) => [...records, authorized()]],
    [
      "foreign authorization subject",
      (records: ReadonlyArray<JournalRecord>) =>
        replaceRecord(
          records,
          ({ event }) => event._tag === "WorktreeCleanupAuthorized",
          authorized(foreignAuthorization)
        )
    ],
    [
      "foreign event authorization subject",
      (records: ReadonlyArray<JournalRecord>) =>
        replaceRecord(
          records,
          ({ event }) =>
            event._tag === "WorktreeCleanupObserved" && event.ordinal === CleanupObservationOrdinal.make(1),
          observed(3, 1, "Present", observationOperationId(1), foreignAuthorization)
        )
    ],
    [
      "family event before authorization",
      (records: ReadonlyArray<JournalRecord>) =>
        records.map((candidate) =>
          candidate.event._tag === "WorktreeCleanupAuthorized"
            ? { ...candidate, position: JournalPosition.make(2) }
            : candidate.event._tag === "WorktreeCleanupObserved" && candidate.position === JournalPosition.make(3)
              ? { ...candidate, position: JournalPosition.make(1) }
              : candidate
        )
    ],
    [
      "duplicate observation intent identity",
      (records: ReadonlyArray<JournalRecord>) => [
        ...records.slice(0, 2),
        observationIntent(3, 1),
        ...records
          .slice(2)
          .map((candidate) => ({ ...candidate, position: JournalPosition.make(Number(candidate.position) + 1) }))
      ]
    ],
    [
      "observation intent with a foreign key",
      (records: ReadonlyArray<JournalRecord>) =>
        replaceRecord(
          records,
          ({ event }) =>
            event._tag === "WorktreeCleanupObservationIntended" && event.ordinal === CleanupObservationOrdinal.make(1),
          observationIntent(
            2,
            1,
            observationOperationId(1),
            authorization,
            JournalRecordKey.make("cleanup-history:foreign-observation-intent")
          )
        )
    ],
    [
      "duplicate observation identity",
      (records: ReadonlyArray<JournalRecord>) => [
        ...records.slice(0, 3),
        observed(4, 1),
        ...records
          .slice(3)
          .map((candidate) => ({ ...candidate, position: JournalPosition.make(Number(candidate.position) + 1) }))
      ]
    ],
    [
      "observed event with an unrecognized identity",
      (records: ReadonlyArray<JournalRecord>) =>
        replaceRecord(
          records,
          ({ event }) =>
            event._tag === "WorktreeCleanupObserved" && event.ordinal === CleanupObservationOrdinal.make(1),
          observed(3, 1, "Present", foreignOperationId)
        )
    ],
    [
      "observed event with a foreign key",
      (records: ReadonlyArray<JournalRecord>) =>
        replaceRecord(
          records,
          ({ event }) =>
            event._tag === "WorktreeCleanupObserved" && event.ordinal === CleanupObservationOrdinal.make(1),
          observed(
            3,
            1,
            "Present",
            observationOperationId(1),
            authorization,
            1,
            JournalRecordKey.make("cleanup-history:foreign-observation")
          )
        )
    ],
    [
      "mutation intent without present facts",
      (records: ReadonlyArray<JournalRecord>) =>
        replaceRecord(
          records,
          ({ event }) =>
            event._tag === "WorktreeCleanupObserved" && event.ordinal === CleanupObservationOrdinal.make(1),
          observed(3, 1, "Absent")
        )
    ],
    [
      "mutation result with an unrecognized operation identity",
      (records: ReadonlyArray<JournalRecord>) =>
        replaceRecord(
          records,
          ({ event }) => event._tag === "WorktreeCleanupMutationResultRecorded",
          mutationResult(5, 1, foreignOperationId)
        )
    ],
    [
      "absence with an unrecognized operation identity",
      (records: ReadonlyArray<JournalRecord>) =>
        replaceRecord(
          records,
          ({ event }) => event._tag === "WorktreeCleanupAbsenceConfirmed",
          absence(8, 2, "MutationResponseReconciliation", foreignOperationId)
        )
    ],
    [
      "absence with the wrong cause",
      (records: ReadonlyArray<JournalRecord>) =>
        replaceRecord(
          records,
          ({ event }) => event._tag === "WorktreeCleanupAbsenceConfirmed",
          absence(8, 2, "InitialAbsence")
        )
    ],
    [
      "contradiction with a foreign identity",
      (records: ReadonlyArray<JournalRecord>) =>
        replaceRecord(
          records,
          ({ event }) => event._tag === "WorktreeCleanupSettled",
          contradiction(9, foreignOperationId)
        )
    ],
    [
      "contradiction without an ordered observation",
      (_records: ReadonlyArray<JournalRecord>) => [authorized(), contradiction(2)]
    ],
    [
      "event after terminal contradiction",
      (records: ReadonlyArray<JournalRecord>) => [
        ...records.filter(({ event }) => event._tag !== "WorktreeCleanupSettled"),
        contradiction(9),
        observed(10, 3)
      ]
    ],
    [
      "settlement with a mismatched result",
      (records: ReadonlyArray<JournalRecord>) =>
        replaceRecord(records, ({ event }) => event._tag === "WorktreeCleanupSettled", settled(9, "AlreadyAbsent"))
    ],
    [
      "settlement without a preceding absence",
      (records: ReadonlyArray<JournalRecord>) => [
        ...records.filter(
          ({ event }) => event._tag !== "WorktreeCleanupAbsenceConfirmed" && event._tag !== "WorktreeCleanupSettled"
        ),
        settled(9)
      ]
    ],
    ["event after settlement", (records: ReadonlyArray<JournalRecord>) => [...records, observed(10, 3)]]
  ])("rejects %s", (_name, mutate) => {
    expect(validateCleanupHistory(mutate(validRecords()), descriptor)._tag).toBe("Invalid")
  })
})
