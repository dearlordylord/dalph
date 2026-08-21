import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  AcceptedResultEvidenceManifest,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  TaskRevision
} from "@dalph/contracts"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import {
  AcceptedResultEvidenceUnavailable,
  AcceptedResultNotDurable,
  AcceptedResultSuppressedByRestart,
  IntegrationTargetSelection,
  QueuedIntegrationResponsibility,
  StartedIntegrationResponsibility,
  deriveIntegrationAdmission,
  deriveUnqueuedAcceptedResults,
  integrationTargetSelectionLayer,
  qualifyAcceptedResultEvidence,
  queueAcceptedResultIntegrationResponsibility,
  selectStartableIntegrationResponsibilities,
  startQueuedIntegration
} from "./protocol.js"
import { IntegrationResponsibilityBeganEvent, IntegrationStartedEvent } from "./events.js"
import {
  CompletionClaimDeletedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementIntendedEvent,
  IntegrationFinalitySettledEvent,
  completionClaimDeletionOperationIdFor,
  completionClaimReplacementOperationIdFor
} from "../integration-finality/events.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"
import { AttemptChoiceAppliedEvent, AttemptChoiceRequestId } from "../attempt-choice/events.js"
import { EvidenceStore } from "../evidence-store.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { rememberValidatedJournalPrefixSuccessor } from "../../../workflow-journal/prefix-lineage.js"
import {
  InRunJournal,
  JournalRecord,
  type JournalRecord as JournalRecordType
} from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { acceptedResultEquivalence } from "./responsibility.js"

const fixture = integrationFinalityFixture

const journalWith = (records: ReadonlyArray<JournalRecordType>): InRunJournal["Service"] => ({
  append: (_runId, _key, event) =>
    Effect.succeed({
      event,
      key: JournalRecordKey.make("appended"),
      position: JournalPosition.make(records.length + 1),
      runId: fixture.runId
    }),
  read: (_runId) => Effect.succeed(records)
})

const queued = (queuedAt: number): QueuedIntegrationResponsibility =>
  QueuedIntegrationResponsibility.make({
    acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
    integrationTarget: fixture.integrationTarget,
    plannedAttempt: fixture.plannedAttempt,
    preIntegrationCancellation: {
      attemptId: fixture.plannedAttempt.attemptId,
      queuedAt: JournalPosition.make(queuedAt),
      runId: fixture.runId
    },
    queuedAt: JournalPosition.make(queuedAt)
  })

const recordAt = (position: number, event: JournalRecordType["event"]): JournalRecordType =>
  JournalRecord.make({
    event,
    key: JournalRecordKey.make(`coverage-${position}`),
    position: JournalPosition.make(position),
    runId: fixture.runId
  })

const lastRecord = (records: ReadonlyArray<JournalRecordType>): JournalRecordType =>
  records[records.length - 1] as JournalRecordType

const responsibilityRecordAt = (position: number): JournalRecordType =>
  recordAt(
    position,
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt: fixture.plannedAttempt,
      version: workflowJournalEventVersion
    })
  )

const acceptedReportAt = (position: number): JournalRecordType =>
  recordAt(
    position,
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(position),
      report: {
        _tag: "Terminal",
        correlation: { attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId },
        result: { _tag: "Accepted", acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult }
      },
      version: workflowJournalEventVersion
    })
  )

const runningReportAt = (position: number): JournalRecordType =>
  recordAt(
    position,
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(position),
      report: { _tag: "Running", correlation: { attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId } },
      version: workflowJournalEventVersion
    })
  )

const restartChoiceAt = (position: number): JournalRecordType =>
  recordAt(
    position,
    AttemptChoiceAppliedEvent.make({
      choice: "RestartTaskImplementation",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: AttemptChoiceRequestId.make({ nonce: `coverage-restart-${position}`, runId: fixture.runId }),
      subject: {
        observedTaskRevision: TaskRevision.make("coverage-observed-revision"),
        plannedAttempt: fixture.plannedAttempt
      },
      version: workflowJournalEventVersion
    })
  )

const finalityRecords = (options?: {
  readonly duplicateFacts?: boolean
  readonly mismatchedSettlement?: boolean
  readonly includeSettlement?: boolean
}): ReadonlyArray<JournalRecordType> => {
  const replacementOperationId = completionClaimReplacementOperationIdFor(fixture.claim)
  const deletionOperationId = completionClaimDeletionOperationIdFor(fixture.claim)
  const replacementIntent = CompletionClaimReplacementIntendedEvent.make({
    claim: fixture.claim,
    operationId: replacementOperationId,
    version: workflowJournalEventVersion
  })
  const replacement = CompletionClaimReplacedEvent.make({
    claim: fixture.claim,
    operationId: replacementOperationId,
    version: workflowJournalEventVersion
  })
  const deletionIntent = CompletionClaimDeletionIntendedEvent.make({
    claim: fixture.claim,
    operationId: deletionOperationId,
    successObservation: fixture.successObservation,
    version: workflowJournalEventVersion
  })
  const deleted = CompletionClaimDeletedEvent.make({
    claim: fixture.claim,
    operationId: deletionOperationId,
    successObservation: fixture.successObservation,
    version: workflowJournalEventVersion
  })
  const settlement = IntegrationFinalitySettledEvent.make({
    claim: fixture.claim,
    deletionOperationId,
    replacementOperationId: options?.mismatchedSettlement
      ? OperationId.make("coverage-mismatched-replacement")
      : replacementOperationId,
    successObservation: fixture.successObservation,
    version: workflowJournalEventVersion
  })
  const events =
    options?.includeSettlement === false
      ? [replacementIntent, replacement, deletionIntent, deleted]
      : [replacementIntent, replacement, deletionIntent, deleted, settlement]
  const repeated =
    options?.duplicateFacts === true ? [...events, replacementIntent, replacement, deletionIntent, deleted] : events
  return repeated.map((event, index) => recordAt(index + 1, event))
}

it.effect("provides the exact configured integration target to the settlement runtime", () =>
  Effect.gen(function* () {
    expect(yield* IntegrationTargetSelection).toEqual(fixture.integrationTarget)
  }).pipe(Effect.provide(integrationTargetSelectionLayer(fixture.integrationTarget)))
)

it.effect("rejects queue admission until the exact accepted executor result is durable", () =>
  Effect.gen(function* () {
    const failure = yield* queueAcceptedResultIntegrationResponsibility(
      fixture.plannedAttempt,
      fixture.qualifiedCandidate.run.session.acceptedResult,
      fixture.integrationTarget
    ).pipe(Effect.provideService(InRunJournal, journalWith([])), Effect.flip)

    expect(failure).toEqual(
      new AcceptedResultNotDurable({ attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId })
    )
  })
)

it.effect("crosses the integration cutoff once for an exact queued responsibility", () =>
  Effect.gen(function* () {
    const responsibility = queued(4)
    const started = yield* startQueuedIntegration(responsibility).pipe(
      Effect.provideService(InRunJournal, journalWith([]))
    )

    expect(started).toEqual(
      StartedIntegrationResponsibility.make({
        acceptedResult: responsibility.acceptedResult,
        integrationTarget: responsibility.integrationTarget,
        plannedAttempt: responsibility.plannedAttempt,
        queuedAt: responsibility.queuedAt,
        startedAt: JournalPosition.make(1)
      })
    )
  })
)

it("selects only the first queued responsibility for each integration target", () => {
  const first = queued(2)
  const second = queued(3)
  const otherTarget = QueuedIntegrationResponsibility.make({
    ...second,
    integrationTarget: IntegrationTarget.make({
      ref: IntegrationTargetRef.make("refs/heads/main"),
      repository: GitRepositoryLocator.make("/repositories/other.git")
    })
  })
  const started = StartedIntegrationResponsibility.make({
    acceptedResult: first.acceptedResult,
    integrationTarget: first.integrationTarget,
    plannedAttempt: first.plannedAttempt,
    queuedAt: first.queuedAt,
    startedAt: JournalPosition.make(4)
  })

  expect(selectStartableIntegrationResponsibilities({ responsibilities: [first, second, otherTarget] })).toEqual([
    first,
    otherTarget
  ])
  expect(selectStartableIntegrationResponsibilities({ responsibilities: [started, second, otherTarget] })).toEqual([
    otherTarget
  ])
})

it("derives one unqueued accepted result from matching executor responsibility and terminal report", () => {
  const responsibility = JournalRecord.make({
    event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt: fixture.plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("responsibility"),
    position: JournalPosition.make(1),
    runId: fixture.runId
  })
  const report = JournalRecord.make({
    event: PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report: {
        _tag: "Terminal",
        correlation: { attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId },
        result: { _tag: "Accepted", acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult }
      },
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("accepted"),
    position: JournalPosition.make(2),
    runId: fixture.runId
  })

  const [result] = deriveUnqueuedAcceptedResults([responsibility, report])
  expect(result).toBeDefined()
  expect(result?.plannedAttempt).toEqual(fixture.plannedAttempt)
  expect(
    result === undefined
      ? false
      : acceptedResultEquivalence(result.acceptedResult, fixture.qualifiedCandidate.run.session.acceptedResult)
  ).toBe(true)
})

it("derives sibling successors from one persistent prefix index without leaking facts", () => {
  const responsibility = JournalRecord.make({
    event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt: fixture.plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("branch-responsibility"),
    position: JournalPosition.make(1),
    runId: fixture.runId
  })
  const report = JournalRecord.make({
    event: PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report: {
        _tag: "Terminal",
        correlation: { attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId },
        result: { _tag: "Accepted", acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult }
      },
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("branch-accepted"),
    position: JournalPosition.make(2),
    runId: fixture.runId
  })
  const prefix = [responsibility, report]
  const queuedEvent = IntegrationResponsibilityBeganEvent.make({
    acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
    integrationTarget: fixture.integrationTarget,
    plannedAttempt: fixture.plannedAttempt,
    version: workflowJournalEventVersion
  })
  const queuedRecord = JournalRecord.make({
    event: queuedEvent,
    key: JournalRecordKey.make("branch-queued"),
    position: JournalPosition.make(3),
    runId: fixture.runId
  })
  const startedRecord = JournalRecord.make({
    event: IntegrationStartedEvent.make({
      acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
      integrationTarget: fixture.integrationTarget,
      plannedAttempt: fixture.plannedAttempt,
      responsibilityBeganAt: JournalPosition.make(3),
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("branch-started"),
    position: JournalPosition.make(3),
    runId: fixture.runId
  })
  const queuedBranch = [...prefix, queuedRecord]
  const startedBranch = [...prefix, startedRecord]
  const coldStartedResults = deriveUnqueuedAcceptedResults([...prefix, startedRecord])

  expect(deriveUnqueuedAcceptedResults(prefix)).toHaveLength(1)
  expect(deriveIntegrationAdmission(prefix).responsibilities).toHaveLength(0)
  rememberValidatedJournalPrefixSuccessor(
    { records: prefix, runId: fixture.runId },
    { records: queuedBranch, runId: fixture.runId },
    queuedRecord
  )
  rememberValidatedJournalPrefixSuccessor(
    { records: prefix, runId: fixture.runId },
    { records: startedBranch, runId: fixture.runId },
    startedRecord
  )

  expect(deriveUnqueuedAcceptedResults(queuedBranch)).toEqual([])
  expect(deriveUnqueuedAcceptedResults(startedBranch)).toEqual(coldStartedResults)
  expect(deriveIntegrationAdmission(queuedBranch).responsibilities).toHaveLength(1)
  expect(deriveIntegrationAdmission(startedBranch).responsibilities).toEqual(
    deriveIntegrationAdmission([...prefix, startedRecord]).responsibilities
  )
})

it("retains repeated executor, accepted-terminal, and restart facts without sharing branch state", () => {
  const records = [
    responsibilityRecordAt(1),
    responsibilityRecordAt(2),
    acceptedReportAt(3),
    acceptedReportAt(4),
    restartChoiceAt(5),
    restartChoiceAt(6)
  ]

  expect(deriveUnqueuedAcceptedResults(records)).toHaveLength(2)
  expect(deriveUnqueuedAcceptedResults(records)).toEqual(deriveUnqueuedAcceptedResults([...records]))
  expect(deriveIntegrationAdmission(records)).toEqual(deriveIntegrationAdmission(records.slice()))
})

it("settles an exact finality prefix, rejects a mismatch, and suppresses a later settled queue", () => {
  const baseFinality = finalityRecords({ includeSettlement: false })
  const queuedRecord = recordAt(
    5,
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
      integrationTarget: fixture.integrationTarget,
      plannedAttempt: fixture.plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const prior = [...baseFinality, queuedRecord]
  const validSettlement = finalityRecords().at(-1)
  const mismatchedSettlement = finalityRecords({ mismatchedSettlement: true }).at(-1)
  expect(validSettlement).toBeDefined()
  expect(mismatchedSettlement).toBeDefined()
  if (validSettlement === undefined || mismatchedSettlement === undefined) return

  const settled = [...prior, recordAt(6, validSettlement.event)]
  const mismatch = [...settled, recordAt(7, mismatchedSettlement.event)]
  const settledQueue = [
    ...settled,
    recordAt(
      7,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
        integrationTarget: fixture.integrationTarget,
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
  ]
  const unrelatedAppend = [...settled, responsibilityRecordAt(7)]

  expect(deriveIntegrationAdmission(prior).responsibilities).toHaveLength(1)
  expect(deriveIntegrationAdmission(finalityRecords({ duplicateFacts: true }))).toEqual({ responsibilities: [] })
  rememberValidatedJournalPrefixSuccessor(
    { records: prior, runId: fixture.runId },
    { records: settled, runId: fixture.runId },
    lastRecord(settled)
  )
  rememberValidatedJournalPrefixSuccessor(
    { records: settled, runId: fixture.runId },
    { records: mismatch, runId: fixture.runId },
    lastRecord(mismatch)
  )
  rememberValidatedJournalPrefixSuccessor(
    { records: settled, runId: fixture.runId },
    { records: settledQueue, runId: fixture.runId },
    lastRecord(settledQueue)
  )
  rememberValidatedJournalPrefixSuccessor(
    { records: settled, runId: fixture.runId },
    { records: unrelatedAppend, runId: fixture.runId },
    lastRecord(unrelatedAppend)
  )

  expect(deriveIntegrationAdmission(settled).responsibilities).toHaveLength(0)
  expect(deriveIntegrationAdmission(mismatch).responsibilities).toHaveLength(0)
  expect(deriveIntegrationAdmission(settledQueue).responsibilities).toHaveLength(0)
  expect(deriveIntegrationAdmission(unrelatedAppend).responsibilities).toHaveLength(0)
})

it("incrementally preserves accepted-result suppression for queued, unknown, and restarted reports", () => {
  const appendAndDerive = (
    prior: ReadonlyArray<JournalRecordType>,
    appended: JournalRecordType
  ): ReadonlyArray<ReturnType<typeof deriveUnqueuedAcceptedResults>[number]> => {
    const successor = [...prior, appended]
    expect(deriveUnqueuedAcceptedResults(prior)).toBeDefined()
    rememberValidatedJournalPrefixSuccessor(
      { records: prior, runId: fixture.runId },
      { records: successor, runId: fixture.runId },
      appended
    )
    return deriveUnqueuedAcceptedResults(successor)
  }

  const queuedPrior = [
    responsibilityRecordAt(1),
    recordAt(
      2,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
        integrationTarget: fixture.integrationTarget,
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
  ]
  expect(appendAndDerive(queuedPrior, acceptedReportAt(3))).toEqual([])
  expect(appendAndDerive([], acceptedReportAt(1))).toEqual([])
  expect(appendAndDerive([responsibilityRecordAt(1)], runningReportAt(2))).toEqual([])
  expect(appendAndDerive([responsibilityRecordAt(1), restartChoiceAt(2)], acceptedReportAt(3))).toEqual([])
  expect(appendAndDerive([responsibilityRecordAt(1)], acceptedReportAt(2))).toHaveLength(1)
})

it.effect("queues only a durable accepted result after restart and evidence checks", () =>
  Effect.gen(function* () {
    const acceptedResult = fixture.qualifiedCandidate.run.session.acceptedResult
    const durable = [responsibilityRecordAt(1), acceptedReportAt(2)]
    const suppressed = [responsibilityRecordAt(1), restartChoiceAt(2), acceptedReportAt(3)]

    const restartFailure = yield* Effect.flip(
      queueAcceptedResultIntegrationResponsibility(
        fixture.plannedAttempt,
        acceptedResult,
        fixture.integrationTarget
      ).pipe(Effect.provideService(InRunJournal, journalWith(suppressed)))
    )
    expect(restartFailure).toEqual(
      new AcceptedResultSuppressedByRestart({ attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId })
    )

    const evidenceFailure = yield* Effect.flip(
      queueAcceptedResultIntegrationResponsibility(
        fixture.plannedAttempt,
        acceptedResult,
        fixture.integrationTarget
      ).pipe(Effect.provideService(InRunJournal, journalWith(durable)))
    )
    expect(evidenceFailure).toBeInstanceOf(AcceptedResultEvidenceUnavailable)

    const manifest = AcceptedResultEvidenceManifest.make({
      commit: acceptedResult.commit,
      correlation: { attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId },
      formatVersion: 1,
      outcome: "Accepted",
      predecessor: null
    })
    const queuedResult = yield* queueAcceptedResultIntegrationResponsibility(
      fixture.plannedAttempt,
      acceptedResult,
      fixture.integrationTarget
    ).pipe(
      Effect.provideService(InRunJournal, journalWith(durable)),
      Effect.provideService(
        EvidenceStore,
        EvidenceStore.of({
          put: () => Effect.die("unused"),
          read: () => Effect.succeed(new TextEncoder().encode(JSON.stringify(manifest)))
        })
      )
    )
    expect(queuedResult.acceptedResult).toEqual(acceptedResult)

    const notDurable = yield* Effect.flip(
      queueAcceptedResultIntegrationResponsibility(
        fixture.plannedAttempt,
        acceptedResult,
        fixture.integrationTarget
      ).pipe(Effect.provideService(InRunJournal, journalWith([acceptedReportAt(1)])))
    )
    expect(notDurable).toEqual(
      new AcceptedResultNotDurable({ attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId })
    )
  })
)

it.effect("reports a non-store evidence read failure as unavailable", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      qualifyAcceptedResultEvidence(fixture.plannedAttempt, fixture.qualifiedCandidate.run.session.acceptedResult).pipe(
        Effect.provideService(
          EvidenceStore,
          EvidenceStore.of({
            put: () => Effect.die("unused"),
            read: () => Effect.fail("coverage evidence read failed") as never
          })
        )
      )
    )
    expect(failure).toBeInstanceOf(AcceptedResultEvidenceUnavailable)
    expect(failure.detail).toBe("coverage evidence read failed")
  })
)

it("retains the journal event shape used for queued responsibility", () => {
  const event = IntegrationResponsibilityBeganEvent.make({
    acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
    integrationTarget: fixture.integrationTarget,
    plannedAttempt: fixture.plannedAttempt,
    version: workflowJournalEventVersion
  })
  expect(event._tag).toBe("IntegrationResponsibilityBegan")
})
