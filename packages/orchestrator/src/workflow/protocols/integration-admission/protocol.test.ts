import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  AcceptedResultEvidenceManifest,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  TaskRevision,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { defaultTaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { liveJournalTestLayer } from "../../../coordination/delivery/live-journal-test-layer.js"
import { makeWorkflowRunBeganRecord } from "../../../workflow-journal/run-lifecycle.js"
import { makeAcceptedIntegrationHistory } from "../../../../test/support/accepted-integration-history.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import {
  AcceptedResultEvidenceUnavailable,
  AcceptedResultNotDurable,
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
import { EvidenceStore, EvidenceStoreFailure } from "../evidence-store.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { journalEvidenceFrom } from "../../../workflow-journal/record-evidence.js"
import { JournalRecord, type JournalRecord as JournalRecordType } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { acceptedResultEquivalence } from "./responsibility.js"

const fixture = integrationFinalityFixture
const trackerTarget = FixtureTarget.make("integration-admission-target")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity })
const admissionSpecification = makeTaskWorkSpecification({
  body: "Queue the exact accepted executor result for integration.",
  taskId: fixture.plannedAttempt.taskId,
  title: "Integration admission"
})
const admissionAttempt = { ...fixture.plannedAttempt, taskRevision: admissionSpecification.fingerprint }
const begunJournalLayer = liveJournalTestLayer({
  records: [makeWorkflowRunBeganRecord(fixture.runId, trackerTarget, initialPolicy)],
  runId: fixture.runId,
  target: trackerTarget
})
const acceptedHistory = makeAcceptedIntegrationHistory({
  acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
  activeClaim: fixture.activeClaim,
  integrationTarget: fixture.integrationTarget,
  plannedAttempt: admissionAttempt,
  runId: fixture.runId,
  targetHeadSha: fixture.qualifiedCandidate.run.session.expectedTargetHead,
  taskSpecification: admissionSpecification,
  trackerTarget
})
const acceptedJournalLayer = liveJournalTestLayer({
  records: acceptedHistory.records,
  runId: fixture.runId,
  target: trackerTarget
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
        _tag: "ExecutorWorkTerminal",
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
      report: {
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId }
      },
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
    ).pipe(Effect.flip)

    expect(failure).toEqual(
      new AcceptedResultNotDurable({ attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId })
    )
  }).pipe(Effect.provide(begunJournalLayer))
)

it.effect("crosses the integration cutoff once for an exact queued responsibility", () =>
  Effect.gen(function* () {
    const responsibility = QueuedIntegrationResponsibility.make({
      acceptedResult: acceptedHistory.acceptedResult,
      integrationTarget: acceptedHistory.integrationTarget,
      plannedAttempt: acceptedHistory.plannedAttempt,
      preIntegrationCancellation: {
        attemptId: acceptedHistory.plannedAttempt.attemptId,
        queuedAt: acceptedHistory.responsibility.queuedAt,
        runId: acceptedHistory.runId
      },
      queuedAt: acceptedHistory.responsibility.queuedAt
    })
    const started = yield* startQueuedIntegration(responsibility)

    expect(started).toEqual(
      StartedIntegrationResponsibility.make({
        acceptedResult: responsibility.acceptedResult,
        integrationTarget: responsibility.integrationTarget,
        plannedAttempt: responsibility.plannedAttempt,
        queuedAt: responsibility.queuedAt,
        startedAt: JournalPosition.make(responsibility.queuedAt + 1)
      })
    )
  }).pipe(
    Effect.provide(
      liveJournalTestLayer({
        records: acceptedHistory.records.slice(0, acceptedHistory.responsibility.queuedAt),
        runId: acceptedHistory.runId,
        target: trackerTarget
      })
    )
  )
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
        _tag: "ExecutorWorkTerminal",
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
        _tag: "ExecutorWorkTerminal",
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
  expect(deriveUnqueuedAcceptedResults(queuedBranch)).toEqual([])
  expect(deriveUnqueuedAcceptedResults(startedBranch)).toEqual(coldStartedResults)
  expect(deriveIntegrationAdmission(queuedBranch).responsibilities).toHaveLength(1)
  expect(deriveIntegrationAdmission(startedBranch).responsibilities).toEqual(
    deriveIntegrationAdmission([...prefix, startedRecord]).responsibilities
  )
})

it("retains repeated executor and accepted-terminal facts without sharing branch state", () => {
  const records = [responsibilityRecordAt(1), responsibilityRecordAt(2), acceptedReportAt(3), acceptedReportAt(4)]

  expect(deriveUnqueuedAcceptedResults(records)).toHaveLength(2)
  expect(deriveUnqueuedAcceptedResults(records)).toEqual(deriveUnqueuedAcceptedResults([...records]))
  expect(deriveUnqueuedAcceptedResults(journalEvidenceFrom(records))).toEqual(deriveUnqueuedAcceptedResults(records))
  expect(deriveIntegrationAdmission(records)).toEqual(deriveIntegrationAdmission(records.slice()))
  expect(deriveIntegrationAdmission(journalEvidenceFrom(records))).toEqual(deriveIntegrationAdmission(records))
})

it("settles exact finality and fails closed on a contradictory later settlement", () => {
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
  expect(deriveIntegrationAdmission(settled).responsibilities).toHaveLength(0)
  expect(deriveIntegrationAdmission(mismatch).responsibilities).toHaveLength(1)
  expect(deriveIntegrationAdmission(settledQueue).responsibilities).toHaveLength(0)
  expect(deriveIntegrationAdmission(unrelatedAppend).responsibilities).toHaveLength(0)
})

it("suppresses only queued and unknown accepted reports across chronological appends", () => {
  const appendAndDerive = (
    prior: ReadonlyArray<JournalRecordType>,
    appended: JournalRecordType
  ): ReadonlyArray<ReturnType<typeof deriveUnqueuedAcceptedResults>[number]> => {
    const successor = [...prior, appended]
    expect(deriveUnqueuedAcceptedResults(prior)).toBeDefined()
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
  expect(appendAndDerive([responsibilityRecordAt(1), restartChoiceAt(2)], acceptedReportAt(3))).toHaveLength(1)
  expect(appendAndDerive([responsibilityRecordAt(1)], acceptedReportAt(2))).toHaveLength(1)
})

it.effect("queues only a durable accepted result after evidence checks", () =>
  Effect.gen(function* () {
    const acceptedResult = fixture.qualifiedCandidate.run.session.acceptedResult
    const afterRestart = [responsibilityRecordAt(1), restartChoiceAt(2), acceptedReportAt(3)]
    const evidenceFailure = yield* Effect.gen(function* () {
      return yield* Effect.flip(
        queueAcceptedResultIntegrationResponsibility(admissionAttempt, acceptedResult, fixture.integrationTarget)
      )
    }).pipe(Effect.provide(acceptedJournalLayer))
    expect(evidenceFailure).toBeInstanceOf(AcceptedResultEvidenceUnavailable)

    const manifest = AcceptedResultEvidenceManifest.make({
      commit: acceptedResult.commit,
      correlation: { attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId },
      formatVersion: 1,
      outcome: "Accepted",
      predecessor: null
    })
    const queuedResult = yield* Effect.gen(function* () {
      return yield* queueAcceptedResultIntegrationResponsibility(
        admissionAttempt,
        acceptedResult,
        fixture.integrationTarget
      )
    }).pipe(
      Effect.provide(acceptedJournalLayer),
      Effect.provideService(
        EvidenceStore,
        EvidenceStore.of({
          put: () => Effect.die("unused"),
          read: () => Effect.succeed(new TextEncoder().encode(JSON.stringify(manifest)))
        })
      )
    )
    expect(queuedResult.acceptedResult).toEqual(acceptedResult)

    // A restart choice between executor responsibility and terminal evidence
    // does not consume either fact in the indexed admission projection.
    expect(deriveUnqueuedAcceptedResults(journalEvidenceFrom(afterRestart))).toHaveLength(1)

    const notDurable = yield* Effect.gen(function* () {
      return yield* Effect.flip(
        queueAcceptedResultIntegrationResponsibility(fixture.plannedAttempt, acceptedResult, fixture.integrationTarget)
      )
    }).pipe(Effect.provide(begunJournalLayer))
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
            read: () =>
              Effect.fail(
                new EvidenceStoreFailure({ detail: "coverage evidence read failed", operation: "EvidenceStore.read" })
              )
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
