import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Option, Ref } from "effect"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { acceptedResultFixture } from "../../../../test/support/evidence.js"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { OperationId } from "../../identity.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../registry/event.js"
import { makeTargetLineageObservationOperation } from "../../registry/operation.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import {
  integratorCandidateGitObservedRecordKey,
  integratorCandidateGitReadIntendedRecordKey,
  integratorResultRecordedRecordKey,
  integratorRunCandidateGitObservedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunRecordKeyPrefix,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  integratorSuccessorSessionFixedRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantinedEvent
} from "../integration-quarantine/events.js"
import {
  IntegratorCandidateGitObservedEvent,
  IntegratorCandidateGitReadIntendedEvent,
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorCorrelation,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  IntegratorResultRecordedEvent,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunOrdinal,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionId,
  IntegratorSessionFixedEvent,
  IntegratorSuccessorSessionFixedEvent,
  integratorQualifiedCandidateFromState
} from "./events.js"
import { IntegratorJournalContradiction } from "./errors.js"
import {
  appendRunGitReadIntentIfNeeded,
  readLegacyInitialResultForRun,
  readRecordedRunResult,
  readRunCandidateObservation,
  reconcileRunResult,
  runObservationFromAppendedRecord,
  runResultFromAppendedRecord,
  validateLegacyInitialResult
} from "./journal-record-reconciliation.js"
import {
  integratorCorrelationFor,
  appendIntegratorRunStartedIfNeeded,
  integratorRunCorrelationForSession,
  integratorSuccessorCorrelationFor,
  IntegratorPreparationInput
} from "./session.js"
import {
  deriveCurrentIntegratorState,
  deriveIntegratorRunState,
  deriveIntegratorState,
  integratorRunQualifiedCandidateFromState,
  integratorResponsibilityFactsFor
} from "./state.js"
import type { IntegratorHistoryIndexes } from "../../../coordination/reconstruction/integrator-history.js"
import { validateIntegratorHistoryEvent } from "../../../coordination/reconstruction/integrator-history.js"

const sha = (value: string): GitCommitSha => GitCommitSha.make(value.repeat(40))

const runId = RunId.make("integrator-reconstruction-run")
const base = sha("a")
const targetHead = sha("b")
const acceptedCommit = sha("c")
const candidateCommit = sha("d")
const target = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/integrator-reconstruction.git")
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("integrator-reconstruction-attempt"),
  baseSha: base,
  branch: TaskBranchRef.make("refs/heads/dalph/integrator-reconstruction"),
  executor: TaskExecutorLocator.make("executor:controlled-test"),
  runId,
  taskId: TaskId.make("integrator-reconstruction-task"),
  taskRevision: TaskRevision.make("integrator-reconstruction-revision"),
  worktree: WorktreeLocator.make("/worktrees/integrator-reconstruction")
})
const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult: acceptedResultFixture(acceptedCommit),
  integrationTarget: target,
  plannedAttempt,
  queuedAt: JournalPosition.make(2),
  startedAt: JournalPosition.make(3)
})
const input = IntegratorPreparationInput.make({
  responsibility,
  targetLineage: TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: base,
    targetHeadSha: targetHead
  }),
  targetLineageObservedAt: JournalPosition.make(5)
})
const session = integratorCorrelationFor(input)
const runOne = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(1))
const candidateText = IntegratorCandidateText.make("refs/heads/dalph/integrator-candidate")
const detail = IntegratorNotPreparedDetail.make("provider reached a conclusive non-prepared result")

const record = (
  position: number,
  event: JournalRecord["event"],
  key: JournalRecord["key"] = JournalRecordKey.make(`integrator-reconstruction:${position}`)
): JournalRecord => ({ event, key, position: JournalPosition.make(position), runId })

const lineageRecords = (): ReadonlyArray<JournalRecord> => {
  const operationId = OperationId.make("integrator-reconstruction-lineage")
  const operation = makeTargetLineageObservationOperation({
    integrationTarget: target,
    operationId,
    plannedAttempt,
    predecessorOperationIds: []
  })
  return [
    record(
      4,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation,
        version: workflowJournalEventVersion
      })
    ),
    record(
      5,
      TargetLineageObservedEvent.make({
        observation: input.targetLineage,
        occurrenceClassification: "NonActionOccurrence",
        operationId,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
  ]
}

const sessionRecord = (correlation: IntegratorCorrelation = session, position = 6): JournalRecord =>
  record(
    position,
    IntegratorSessionFixedEvent.make({ correlation, version: workflowJournalEventVersion }),
    integratorSessionFixedRecordKey(integratorResponsibilityFactsFor(responsibility))
  )

const legacyResultRecord = (result: IntegratorResult, position = 7): JournalRecord =>
  record(
    position,
    IntegratorResultRecordedEvent.make({ result, version: workflowJournalEventVersion }),
    integratorResultRecordedRecordKey(session)
  )

const runStartRecord = (run = runOne, position = 8, key = integratorRunStartedRecordKey(run)): JournalRecord =>
  record(position, IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion }), key)

const runResultRecord = (
  result: IntegratorResult,
  run = runOne,
  position = 9,
  key = integratorRunResultRecordedRecordKey(run)
): JournalRecord =>
  record(position, IntegratorRunResultRecordedEvent.make({ result, run, version: workflowJournalEventVersion }), key)

const preparedResult = (correlation: IntegratorCorrelation = session): IntegratorResult =>
  IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation })

const notPreparedResult = (correlation: IntegratorCorrelation = session): IntegratorResult =>
  IntegratorResult.cases.NotPrepared.make({ correlation, detail })

const candidateObservation = (
  observation: IntegratorGitObservation = IntegratorGitObservation.cases.Commit.make({
    candidateText,
    commit: candidateCommit,
    directParents: [targetHead, acceptedCommit]
  })
): IntegratorGitObservation => observation

const runGitFacts = (
  run = runOne,
  observation = candidateObservation(),
  intentPosition = 10,
  observationPosition = 11
): ReadonlyArray<JournalRecord> => [
  record(
    intentPosition,
    IntegratorRunCandidateGitReadIntendedEvent.make({ candidateText, run, version: workflowJournalEventVersion }),
    integratorRunCandidateGitReadIntendedRecordKey(run, candidateText)
  ),
  record(
    observationPosition,
    IntegratorRunCandidateGitObservedEvent.make({
      candidateText,
      observation,
      run,
      version: workflowJournalEventVersion
    }),
    integratorRunCandidateGitObservedRecordKey(run, candidateText)
  )
]

const legacyGitFacts = (observation = candidateObservation()): ReadonlyArray<JournalRecord> => [
  record(
    10,
    IntegratorCandidateGitReadIntendedEvent.make({
      candidateText,
      correlation: session,
      version: workflowJournalEventVersion
    }),
    integratorCandidateGitReadIntendedRecordKey(session, candidateText)
  ),
  record(
    11,
    IntegratorCandidateGitObservedEvent.make({
      candidateText,
      correlation: session,
      observation,
      version: workflowJournalEventVersion
    }),
    integratorCandidateGitObservedRecordKey(session, candidateText)
  )
]

const makeJournal = (initial: ReadonlyArray<JournalRecord>) =>
  Effect.gen(function* () {
    const records = yield* Ref.make(initial)
    const journal = InRunJournal.of({
      append: (requestedRunId, key, event) =>
        Ref.modify(records, (current) => {
          const existing = current.find((item) => item.key === key)
          if (existing !== undefined) return [Effect.succeed(existing), current] as const
          const appended: JournalRecord = {
            event,
            key,
            position: JournalPosition.make(Math.max(0, ...current.map((item) => Number(item.position))) + 1),
            runId: requestedRunId
          }
          return [Effect.succeed(appended), [...current, appended]] as const
        }).pipe(Effect.flatMap((result) => result)),
      read: (requestedRunId) =>
        Ref.get(records).pipe(Effect.map((current) => current.filter(({ runId: id }) => id === requestedRunId)))
    })
    return { journal, records }
  })

const makeRunHistoryIndexes = (includeLegacyResult = true): IntegratorHistoryIndexes => {
  const fixed = IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })
  const legacyResult = IntegratorResultRecordedEvent.make({
    result: preparedResult(),
    version: workflowJournalEventVersion
  })
  return {
    integrationStarted: new Map(),
    targetLineageReadIntents: new Map(),
    targetLineageObservations: new Map(),
    integratorSessionFixed: new Map([[JournalPosition.make(6), fixed]]),
    integratorSessionsByStartedAt: new Map([[session.startedAt, JournalPosition.make(6)]]),
    integratorSessionsBySessionId: new Map([[session.sessionId, JournalPosition.make(6)]]),
    integratorSessionsByCandidateResource: new Map([[session.candidateResource, JournalPosition.make(6)]]),
    integratorSuccessorSessionFixed: new Map(),
    integratorSuccessorSessionsByPredecessor: new Map(),
    integratorResultsByStartedAt: includeLegacyResult
      ? new Map([[session.startedAt, { event: legacyResult, position: JournalPosition.make(7) }]])
      : new Map(),
    integratorCandidateGitReadIntents: new Map(),
    integratorCandidateGitObservations: new Map(),
    integratorRunStarted: new Map(),
    integratorRunResults: new Map(),
    integratorRunCandidateGitReadIntents: new Map(),
    integratorRunCandidateGitObservations: new Map()
  }
}

const integratorHistoryIssue = (
  recordToValidate: JournalRecord,
  indexes: IntegratorHistoryIndexes
): string | undefined => {
  const result = validateIntegratorHistoryEvent(recordToValidate, indexes)
  return result.handled ? result.issue : undefined
}

const makeSuccessorValidationFixture = () => {
  const indexes = makeRunHistoryIndexes()
  const freshOperationId = OperationId.make("integrator-reconstruction-successor-lineage")
  const freshOperation = makeTargetLineageObservationOperation({
    integrationTarget: target,
    operationId: freshOperationId,
    plannedAttempt,
    predecessorOperationIds: []
  })
  const freshLineage = TargetLineageObservedEvent.make({
    observation: TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: base,
      targetHeadSha: sha("e")
    }),
    occurrenceClassification: "NonActionOccurrence",
    operationId: freshOperationId,
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  indexes.targetLineageReadIntents.set(freshOperationId, {
    operation: freshOperation,
    position: JournalPosition.make(14)
  })
  indexes.targetLineageObservations.set(JournalPosition.make(15), freshLineage)
  const quarantineAt = JournalPosition.make(10)
  const directionAppliedAt = JournalPosition.make(12)
  const quarantine = IntegrationQuarantinedEvent.make({
    basis: IntegrationQuarantineBasis.cases.ConclusiveResult.make({
      cause: { _tag: "NotPrepared", detail },
      evidence: { resultRecordedAt: JournalPosition.make(7) }
    }),
    correlation: session,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const direction = IntegrationQuarantineDirectionAppliedEvent.make({
    fingerprint: IntegrationQuarantineDirectionFingerprint.make({
      direction: "FullRerun",
      quarantineAt,
      sessionId: session.sessionId
    }),
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "integrator-reconstruction-successor", runId }),
    version: workflowJournalEventVersion
  })
  const successor = integratorSuccessorCorrelationFor({
    directionAppliedAt,
    predecessor: session,
    quarantineAt,
    targetLineage: freshLineage.observation,
    targetLineageObservedAt: JournalPosition.make(15)
  })
  const successorEvent = IntegratorSuccessorSessionFixedEvent.make({
    direction: "FullRerun",
    directionAppliedAt,
    predecessor: session,
    quarantineAt,
    successor,
    successorGeneration: 2,
    version: workflowJournalEventVersion
  })
  const records = [
    record(10, quarantine),
    record(12, direction),
    record(16, successorEvent, integratorSuccessorSessionFixedRecordKey(session, quarantineAt, directionAppliedAt))
  ]
  return { directionAppliedAt, indexes, records, successor, successorEvent }
}

describe("Integrator reconstruction states", () => {
  it("reconstructs legacy and run-bound outcomes only from their exact chronology", () => {
    const absent = deriveIntegratorState([], responsibility)
    expect(absent._tag).toBe("Absent")
    expect(deriveCurrentIntegratorState([], responsibility)._tag).toBe("Absent")

    const fixed = [...lineageRecords(), sessionRecord()]
    expect(deriveIntegratorState(fixed, responsibility)._tag).toBe("SessionUnfinished")
    expect(deriveCurrentIntegratorState(fixed, responsibility)._tag).toBe("RunUnfinished")

    const legacyNotPrepared = [...fixed, legacyResultRecord(notPreparedResult())]
    expect(deriveIntegratorState(legacyNotPrepared, responsibility)._tag).toBe("NotPrepared")

    const legacyPrepared = [...fixed, legacyResultRecord(preparedResult())]
    expect(deriveIntegratorState(legacyPrepared, responsibility)._tag).toBe("PreparedAwaitingGit")
    expect(deriveIntegratorState([...legacyPrepared, ...legacyGitFacts()], responsibility)._tag).toBe(
      "GitQualifiedPrepared"
    )
    expect(
      deriveIntegratorState(
        [...legacyPrepared, ...legacyGitFacts(IntegratorGitObservation.cases.Missing.make({ candidateText }))],
        responsibility
      )._tag
    ).toBe("CandidateRejected")

    const runPrepared = [...fixed, runStartRecord(), runResultRecord(preparedResult()), ...runGitFacts()]
    const current = deriveCurrentIntegratorState(runPrepared, responsibility)
    expect(current._tag).toBe("GitQualifiedPrepared")
    if (current._tag === "GitQualifiedPrepared") {
      expect(integratorRunQualifiedCandidateFromState(current).run).toEqual(runOne)
    }
    expect(deriveIntegratorRunState([...fixed, runStartRecord()], responsibility, runOne)._tag).toBe("RunUnfinished")
    expect(
      deriveIntegratorRunState(
        [...fixed, runStartRecord(), runResultRecord(notPreparedResult())],
        responsibility,
        runOne
      )._tag
    ).toBe("NotPrepared")

    const runTwo = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(2))
    expect(
      deriveCurrentIntegratorState([...fixed, runStartRecord(), runStartRecord(runTwo, 12)], responsibility)
    ).toMatchObject({ _tag: "RunUnfinished" })
  })

  it("keeps NotPrepared runs free of Git facts and restores a successor before its first run", () => {
    const fixed = [...lineageRecords(), sessionRecord()]
    expect(
      deriveIntegratorRunState(
        [...fixed, runStartRecord(), runResultRecord(notPreparedResult()), ...runGitFacts()],
        responsibility,
        runOne
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("NotPrepared cannot") })

    const fixture = makeSuccessorValidationFixture()
    const freshLineage = fixture.indexes.targetLineageObservations.get(JournalPosition.make(15))
    expect(freshLineage).toBeDefined()
    if (freshLineage === undefined) return
    const records = [...fixed, record(15, freshLineage), ...fixture.records]
    const successorRun = integratorRunCorrelationForSession(fixture.successor, IntegratorRunOrdinal.make(1))
    expect(deriveIntegratorRunState(records, responsibility, successorRun)).toMatchObject({
      _tag: "RunUnfinished",
      run: successorRun
    })
    const successorResult = runResultRecord(
      IntegratorResult.cases.NotPrepared.make({ correlation: fixture.successor, detail }),
      successorRun,
      18
    )
    expect(deriveIntegratorRunState([...records, successorResult], responsibility, successorRun)).toMatchObject({
      _tag: "Contradiction",
      detail: expect.stringContaining("without IntegratorRunStarted")
    })

    const foreignPredecessor = IntegratorCorrelation.make({ ...session, expectedTargetHead: sha("f") })
    const foreignSuccessor = IntegratorSuccessorSessionFixedEvent.make({
      ...fixture.successorEvent,
      predecessor: foreignPredecessor
    })
    expect(
      deriveIntegratorRunState(
        [
          ...fixed,
          record(15, freshLineage),
          ...fixture.records.slice(0, 2),
          record(
            17,
            foreignSuccessor,
            integratorSuccessorSessionFixedRecordKey(session, JournalPosition.make(10), JournalPosition.make(12))
          ),
          runStartRecord(successorRun, 18)
        ],
        responsibility,
        successorRun
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("multiple fixed sessions") })

    expect(
      deriveIntegratorRunState(
        [...fixed, record(15, freshLineage), ...fixture.records, runStartRecord(runOne, 18)],
        responsibility,
        runOne
      )
    ).toMatchObject({ _tag: "RunUnfinished", run: runOne })
  })

  it("fails closed when session, result, or candidate Git facts bind a foreign chronology", () => {
    const fixed = [...lineageRecords(), sessionRecord()]
    expect(
      deriveIntegratorState(
        fixed.map((item) =>
          item.key === sessionRecord().key ? { ...item, key: JournalRecordKey.make("foreign-session-key") } : item
        ),
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("result or Git record") })
    expect(
      deriveIntegratorState(
        [
          ...fixed,
          record(
            12,
            IntegratorResultRecordedEvent.make({ result: notPreparedResult(), version: workflowJournalEventVersion })
          )
        ],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("foreign result key") })
    expect(
      deriveIntegratorState(
        fixed.map((item) =>
          item.key === sessionRecord().key
            ? {
                ...item,
                event: IntegratorResultRecordedEvent.make({
                  result: notPreparedResult(),
                  version: workflowJournalEventVersion
                })
              }
            : item
        ),
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("non-session") })
    expect(
      deriveIntegratorState(
        [
          ...lineageRecords(),
          sessionRecord(IntegratorCorrelation.make({ ...session, acceptedResult: acceptedResultFixture(sha("f")) }))
        ],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("requested responsibility") })
    expect(
      deriveIntegratorState(
        [
          ...lineageRecords().map((item) =>
            item.position === JournalPosition.make(5) && item.event._tag === "TargetLineageObserved"
              ? {
                  ...item,
                  event: TargetLineageObservedEvent.make({
                    ...item.event,
                    observation: TargetLineageObservation.make({
                      ...item.event.observation,
                      plannedBaseIsAncestorOfTargetHead: false
                    })
                  })
                }
              : item
          ),
          sessionRecord()
        ],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("target-lineage") })

    const prepared = [...fixed, legacyResultRecord(preparedResult())]
    expect(
      deriveIntegratorState(
        [...prepared, ...legacyGitFacts()].map((item) =>
          item.event._tag === "IntegratorCandidateGitReadIntended"
            ? {
                ...item,
                event: IntegratorCandidateGitReadIntendedEvent.make({
                  ...item.event,
                  candidateText: IntegratorCandidateText.make("foreign")
                })
              }
            : item
        ),
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("Git facts do not bind") })
    expect(
      deriveIntegratorState(
        [...prepared, ...legacyGitFacts()].filter((item) => item.event._tag !== "IntegratorCandidateGitReadIntended"),
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("without a read intent") })
    expect(
      deriveIntegratorState(
        [...prepared, ...legacyGitFacts()].map((item) =>
          item.event._tag === "IntegratorCandidateGitObserved"
            ? {
                ...item,
                event: IntegratorCandidateGitObservedEvent.make({
                  ...item.event,
                  observation: IntegratorGitObservation.cases.Missing.make({
                    candidateText: IntegratorCandidateText.make("foreign")
                  })
                })
              }
            : item
        ),
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("reported candidate") })
    expect(
      deriveIntegratorState([...fixed, legacyResultRecord(notPreparedResult()), ...legacyGitFacts()], responsibility)
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("NotPrepared") })
    const foreignResult = IntegratorCorrelation.make({
      ...session,
      candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:foreign-result"),
      sessionId: IntegratorSessionId.make("integrator-session:foreign-result")
    })
    expect(
      deriveIntegratorState(
        [
          ...fixed,
          legacyResultRecord(notPreparedResult()),
          record(
            12,
            IntegratorResultRecordedEvent.make({
              result: notPreparedResult(foreignResult),
              version: workflowJournalEventVersion
            })
          )
        ],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("multiple outer results") })
  })

  it("rejects run histories with duplicate, unbound, and out-of-order records", () => {
    const fixed = [...lineageRecords(), sessionRecord()]
    const duplicateStart = [...fixed, runStartRecord(), runStartRecord(undefined, 12)]
    expect(deriveIntegratorRunState(duplicateStart, responsibility, runOne)).toMatchObject({
      _tag: "Contradiction",
      detail: expect.stringContaining("started more than once")
    })
    expect(deriveCurrentIntegratorState(duplicateStart, responsibility)).toMatchObject({
      _tag: "Contradiction",
      detail: expect.stringContaining("repeats one exact session ordinal")
    })
    const beforeSession = [...lineageRecords(), runStartRecord(runOne, 3), sessionRecord()]
    expect(deriveIntegratorRunState(beforeSession, responsibility, runOne)).toMatchObject({
      _tag: "Contradiction",
      detail: expect.stringContaining("does not follow")
    })
    const gitWithoutResult = [...fixed, runStartRecord(), ...runGitFacts()]
    expect(deriveIntegratorRunState(gitWithoutResult, responsibility, runOne)).toMatchObject({
      _tag: "Contradiction",
      detail: expect.stringContaining("without a run result")
    })
    const wrongResult = [
      ...fixed,
      runStartRecord(),
      runResultRecord(preparedResult(), runOne, 9, integratorRunResultRecordedRecordKey(runOne)),
      ...runGitFacts(runOne, candidateObservation(), 10, 11)
    ]
    const firstLineage = lineageRecords()[0]
    expect(firstLineage).toBeDefined()
    if (firstLineage === undefined) return
    const wrongResultWithForeignEvent = wrongResult.map((item) =>
      item.key === integratorRunResultRecordedRecordKey(runOne) ? { ...item, event: firstLineage.event } : item
    )
    expect(deriveIntegratorRunState(wrongResultWithForeignEvent, responsibility, runOne)).toMatchObject({
      _tag: "Contradiction",
      detail: expect.stringContaining("foreign event")
    })
    const duplicateGit = [
      ...fixed,
      runStartRecord(),
      runResultRecord(preparedResult()),
      ...runGitFacts(),
      ...runGitFacts(runOne, candidateObservation(), 12, 13)
    ]
    expect(deriveIntegratorRunState(duplicateGit, responsibility, runOne)).toMatchObject({
      _tag: "Contradiction",
      detail: expect.stringContaining("duplicate candidate Git facts")
    })
  })

  it("keeps exact result, intent, and session keys closed over foreign facts", () => {
    const fixed = [...lineageRecords(), sessionRecord()]
    const foreign = IntegratorCorrelation.make({
      ...session,
      candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:foreign"),
      sessionId: IntegratorSessionId.make("integrator-session:foreign")
    })

    expect(
      deriveIntegratorState([...fixed, legacyResultRecord(notPreparedResult(foreign), 7)], responsibility)
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("foreign correlation") })

    const firstLineage = lineageRecords()[0]
    expect(firstLineage).toBeDefined()
    if (firstLineage === undefined) return
    expect(
      deriveIntegratorState(
        [...fixed, { ...firstLineage, key: integratorResultRecordedRecordKey(session) }],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("non-result") })

    expect(
      deriveIntegratorState([...fixed, legacyResultRecord(preparedResult(foreign))], responsibility)
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("foreign correlation") })

    const prepared = [...fixed, legacyResultRecord(preparedResult())]
    const foreignIntent = record(
      10,
      firstLineage.event,
      integratorCandidateGitReadIntendedRecordKey(session, candidateText)
    )
    expect(deriveIntegratorState([...prepared, foreignIntent], responsibility)).toMatchObject({
      _tag: "Contradiction",
      detail: expect.stringContaining("foreign correlation")
    })

    const duplicateSession = record(
      7,
      IntegratorSessionFixedEvent.make({ correlation: foreign, version: workflowJournalEventVersion })
    )
    expect(
      deriveIntegratorState([...lineageRecords(), sessionRecord(), duplicateSession], responsibility)
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("multiple target heads") })

    expect(
      deriveCurrentIntegratorState(
        [...fixed, runStartRecord(runOne, 8, JournalRecordKey.make("foreign-run-start-key"))],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("foreign key") })
  })

  it("maps every legacy state only to the initial explicit run", () => {
    const fixed = [...lineageRecords(), sessionRecord()]
    expect(deriveIntegratorRunState([], responsibility, runOne)).toMatchObject({ _tag: "Absent" })
    expect(deriveIntegratorRunState(fixed, responsibility, runOne)).toMatchObject({ _tag: "RunUnfinished" })
    expect(
      deriveIntegratorRunState([...fixed, legacyResultRecord(preparedResult())], responsibility, runOne)
    ).toMatchObject({ _tag: "PreparedAwaitingGit" })
    expect(
      deriveIntegratorRunState(
        [...fixed, legacyResultRecord(preparedResult()), ...legacyGitFacts()],
        responsibility,
        runOne
      )
    ).toMatchObject({ _tag: "GitQualifiedPrepared" })
    expect(
      deriveIntegratorRunState(
        [
          ...fixed,
          legacyResultRecord(preparedResult()),
          ...legacyGitFacts(IntegratorGitObservation.cases.Missing.make({ candidateText }))
        ],
        responsibility,
        runOne
      )
    ).toMatchObject({ _tag: "CandidateRejected" })
    expect(
      deriveIntegratorRunState([...fixed, legacyResultRecord(notPreparedResult())], responsibility, runOne)
    ).toMatchObject({ _tag: "NotPrepared" })

    const contradiction = fixed.map((item) =>
      item.key === sessionRecord().key ? { ...item, key: JournalRecordKey.make("foreign-session-key") } : item
    )
    expect(deriveIntegratorRunState(contradiction, responsibility, runOne)).toMatchObject({ _tag: "Contradiction" })
    const runTwo = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(2))
    expect(deriveIntegratorRunState(fixed, responsibility, runTwo)).toMatchObject({ _tag: "Absent" })
    expect(
      deriveIntegratorRunState([...fixed, runResultRecord(notPreparedResult())], responsibility, runOne)
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("without IntegratorRunStarted") })
  })

  it("materializes legacy qualification and rejects malformed qualified parents", () => {
    const qualified = deriveIntegratorState(
      [...lineageRecords(), sessionRecord(), legacyResultRecord(preparedResult()), ...legacyGitFacts()],
      responsibility
    )
    expect(qualified._tag).toBe("GitQualifiedPrepared")
    if (qualified._tag !== "GitQualifiedPrepared") return
    expect(integratorQualifiedCandidateFromState(qualified)).toMatchObject({
      candidateText,
      directParents: [targetHead, acceptedCommit]
    })
    expect(() =>
      integratorQualifiedCandidateFromState({
        ...qualified,
        observation: { directParents: [acceptedCommit, targetHead] }
      })
    ).toThrow()
  })

  it("promotes only one chronologically complete FullRerun successor", () => {
    const fixture = makeSuccessorValidationFixture()
    const freshLineage = fixture.indexes.targetLineageObservations.get(JournalPosition.make(15))
    const quarantineRecord = fixture.records[0]
    const directionRecord = fixture.records[1]
    const successorRecord = fixture.records[2]
    expect(freshLineage).toBeDefined()
    expect(quarantineRecord).toBeDefined()
    expect(directionRecord).toBeDefined()
    expect(successorRecord).toBeDefined()
    if (
      freshLineage === undefined ||
      quarantineRecord === undefined ||
      directionRecord === undefined ||
      successorRecord === undefined
    )
      return
    const base = [...lineageRecords(), sessionRecord()]
    const complete = [...base, record(15, freshLineage), ...fixture.records]
    expect(deriveCurrentIntegratorState(complete, responsibility)).toMatchObject({ _tag: "RunUnfinished" })
    expect(() =>
      IntegratorSuccessorSessionFixedEvent.make({ ...fixture.successorEvent, predecessor: fixture.successor })
    ).toThrow()

    const successorRunTwo = integratorRunCorrelationForSession(fixture.successor, IntegratorRunOrdinal.make(2))
    expect(
      deriveCurrentIntegratorState(
        [...complete, runStartRecord(successorRunTwo, 17, integratorRunStartedRecordKey(successorRunTwo))],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("initial Integrator run") })

    const successorRunOne = integratorRunCorrelationForSession(fixture.successor, IntegratorRunOrdinal.make(1))
    expect(
      deriveCurrentIntegratorState([...complete, runStartRecord(successorRunOne, 17)], responsibility)
    ).toMatchObject({ _tag: "RunUnfinished" })

    expect(
      deriveCurrentIntegratorState(
        [...complete, { ...successorRecord, position: JournalPosition.make(17) }],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("multiple FullRerun successors") })

    const foreignPredecessor = IntegratorCorrelation.make({ ...session, expectedTargetHead: sha("f") })
    const foreignPredecessorEvent = IntegratorSuccessorSessionFixedEvent.make({
      ...fixture.successorEvent,
      predecessor: foreignPredecessor
    })
    expect(
      deriveCurrentIntegratorState(
        [
          ...base,
          record(15, freshLineage),
          record(10, quarantineRecord.event),
          record(12, directionRecord.event),
          record(
            16,
            foreignPredecessorEvent,
            integratorSuccessorSessionFixedRecordKey(session, JournalPosition.make(10), JournalPosition.make(12))
          )
        ],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("foreign predecessor") })

    expect(
      deriveCurrentIntegratorState(
        [
          ...base,
          ...fixture.records.map((item, index) =>
            index === 2 ? { ...item, key: JournalRecordKey.make("foreign-successor-key") } : item
          )
        ],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("foreign key") })

    expect(deriveCurrentIntegratorState([...base, ...fixture.records], responsibility)).toMatchObject({
      _tag: "Contradiction",
      detail: expect.stringContaining("chronology")
    })
  })
})

describe("Integrator reconstruction history indexes", () => {
  it("accepts one exact run start, result, Git intent, and Git observation sequence", () => {
    const indexes = makeRunHistoryIndexes()
    const start = runStartRecord()
    const result = runResultRecord(preparedResult())
    const [intent, observation] = runGitFacts()
    expect(intent).toBeDefined()
    expect(observation).toBeDefined()
    if (intent === undefined || observation === undefined) return

    expect(validateIntegratorHistoryEvent(start, indexes, [start])).toEqual({ handled: true, issue: undefined })
    expect(validateIntegratorHistoryEvent(result, indexes, [start, result])).toEqual({
      handled: true,
      issue: undefined
    })
    expect(validateIntegratorHistoryEvent(intent, indexes, [start, result, intent])).toEqual({
      handled: true,
      issue: undefined
    })
    expect(validateIntegratorHistoryEvent(observation, indexes, [start, result, intent, observation])).toEqual({
      handled: true,
      issue: undefined
    })

    expect(validateIntegratorHistoryEvent(runStartRecord(runOne, 12), indexes)).toMatchObject({
      handled: true,
      issue: expect.stringContaining("repeats exact session ordinal")
    })
    expect(validateIntegratorHistoryEvent(runResultRecord(preparedResult(), runOne, 13), indexes)).toMatchObject({
      handled: true,
      issue: expect.stringContaining("repeats exact session ordinal")
    })
    const duplicateFacts = runGitFacts(runOne, candidateObservation(), 14, 15)
    const duplicateIntent = duplicateFacts[0]
    const duplicateObservation = duplicateFacts[1]
    expect(duplicateIntent).toBeDefined()
    expect(duplicateObservation).toBeDefined()
    if (duplicateIntent === undefined || duplicateObservation === undefined) return
    expect(validateIntegratorHistoryEvent(duplicateIntent, indexes)).toMatchObject({
      handled: true,
      issue: expect.stringContaining("repeats candidate text")
    })
    expect(validateIntegratorHistoryEvent(duplicateObservation, indexes)).toMatchObject({
      handled: true,
      issue: expect.stringContaining("repeats candidate text")
    })
  })

  it("rejects duplicate legacy candidate Git facts after indexing their first exact result", () => {
    const indexes = makeRunHistoryIndexes()
    const facts = legacyGitFacts()
    const intent = facts[0]
    const observation = facts[1]
    expect(intent).toBeDefined()
    expect(observation).toBeDefined()
    if (intent === undefined || observation === undefined) return

    expect(validateIntegratorHistoryEvent(intent, indexes)).toEqual({ handled: true, issue: undefined })
    expect(validateIntegratorHistoryEvent(observation, indexes)).toEqual({ handled: true, issue: undefined })
    expect(validateIntegratorHistoryEvent({ ...intent, position: JournalPosition.make(12) }, indexes)).toMatchObject({
      handled: true,
      issue: expect.stringContaining("repeats candidate text")
    })
    expect(
      validateIntegratorHistoryEvent({ ...observation, position: JournalPosition.make(13) }, indexes)
    ).toMatchObject({ handled: true, issue: expect.stringContaining("repeats candidate text") })
  })

  it("accepts a deterministic FullRerun successor only after its quarantine, direction, and fresh lineage", () => {
    const fixture = makeSuccessorValidationFixture()
    const successorRecord = fixture.records[2]
    expect(successorRecord).toBeDefined()
    if (successorRecord === undefined) return
    expect(validateIntegratorHistoryEvent(successorRecord, fixture.indexes, fixture.records)).toEqual({
      handled: true,
      issue: undefined
    })

    const duplicate = { ...successorRecord, position: JournalPosition.make(17) }
    expect(validateIntegratorHistoryEvent(duplicate, fixture.indexes, [...fixture.records, duplicate])).toMatchObject({
      handled: true,
      issue: expect.stringContaining("already has a successor")
    })

    const foreignKeyFixture = makeSuccessorValidationFixture()
    const foreignKeyRecord = { ...successorRecord, key: JournalRecordKey.make("foreign-successor-key") }
    expect(
      validateIntegratorHistoryEvent(foreignKeyRecord, foreignKeyFixture.indexes, foreignKeyFixture.records)
    ).toMatchObject({ handled: true, issue: expect.stringContaining("requires record key") })

    const missingLineageFixture = makeSuccessorValidationFixture()
    missingLineageFixture.indexes.targetLineageObservations.clear()
    expect(
      validateIntegratorHistoryEvent(successorRecord, missingLineageFixture.indexes, missingLineageFixture.records)
    ).toMatchObject({ handled: true, issue: expect.stringContaining("not the deterministic result") })

    const missingIntentFixture = makeSuccessorValidationFixture()
    missingIntentFixture.indexes.targetLineageReadIntents.clear()
    expect(
      validateIntegratorHistoryEvent(successorRecord, missingIntentFixture.indexes, missingIntentFixture.records)
    ).toMatchObject({ handled: true, issue: expect.stringContaining("fresh target-lineage observation") })

    const missingPredecessorFixture = makeSuccessorValidationFixture()
    missingPredecessorFixture.indexes.integratorSessionsBySessionId.clear()
    expect(
      validateIntegratorHistoryEvent(
        successorRecord,
        missingPredecessorFixture.indexes,
        missingPredecessorFixture.records
      )
    ).toMatchObject({ handled: true, issue: expect.stringContaining("no exact earlier predecessor") })

    const reusedIdentityFixture = makeSuccessorValidationFixture()
    reusedIdentityFixture.indexes.integratorSessionsBySessionId.set(
      fixture.successor.sessionId,
      JournalPosition.make(6)
    )
    expect(
      validateIntegratorHistoryEvent(successorRecord, reusedIdentityFixture.indexes, reusedIdentityFixture.records)
    ).toMatchObject({ handled: true, issue: expect.stringContaining("reuses a session or resource") })

    const missingQuarantineFixture = makeSuccessorValidationFixture()
    expect(
      validateIntegratorHistoryEvent(
        successorRecord,
        missingQuarantineFixture.indexes,
        missingQuarantineFixture.records.slice(1)
      )
    ).toMatchObject({ handled: true, issue: expect.stringContaining("predecessor quarantine") })

    const missingDirectionFixture = makeSuccessorValidationFixture()
    expect(
      validateIntegratorHistoryEvent(
        successorRecord,
        missingDirectionFixture.indexes,
        [missingDirectionFixture.records[0], missingDirectionFixture.records[2]].filter(
          (item): item is JournalRecord => item !== undefined
        )
      )
    ).toMatchObject({ handled: true, issue: expect.stringContaining("FullRerun direction") })

    const notAfterLineageFixture = makeSuccessorValidationFixture()
    expect(
      validateIntegratorHistoryEvent(
        { ...successorRecord, position: JournalPosition.make(15) },
        notAfterLineageFixture.indexes,
        notAfterLineageFixture.records
      )
    ).toMatchObject({ handled: true, issue: expect.stringContaining("fixed after its fresh target-lineage") })
  })

  it("rejects run facts whose key, session, retry, result, or Git chronology is not exact", () => {
    const noLegacyResult = makeRunHistoryIndexes(false)
    expect(validateIntegratorHistoryEvent(runStartRecord(), noLegacyResult)).toMatchObject({
      handled: true,
      issue: undefined
    })

    const foreignKey = runStartRecord(runOne, 8, JournalRecordKey.make("foreign-run-start-key"))
    expect(validateIntegratorHistoryEvent(foreignKey, makeRunHistoryIndexes())).toMatchObject({
      handled: true,
      issue: expect.stringContaining("foreign key")
    })

    const missingSession = makeRunHistoryIndexes()
    missingSession.integratorSessionsByStartedAt.clear()
    missingSession.integratorSessionsBySessionId.clear()
    expect(validateIntegratorHistoryEvent(runStartRecord(), missingSession)).toMatchObject({
      handled: true,
      issue: expect.stringContaining("no exact earlier fixed session")
    })

    const runTwo = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(2))
    expect(validateIntegratorHistoryEvent(runStartRecord(runTwo, 12), makeRunHistoryIndexes())).toMatchObject({
      handled: true,
      issue: expect.any(String)
    })
    const runThree = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(3))
    expect(validateIntegratorHistoryEvent(runStartRecord(runThree, 12), makeRunHistoryIndexes())).toMatchObject({
      handled: true,
      issue: expect.stringContaining("exceeds Retry bound")
    })

    const noStart = makeRunHistoryIndexes()
    expect(validateIntegratorHistoryEvent(runResultRecord(preparedResult()), noStart)).toMatchObject({
      handled: true,
      issue: expect.stringContaining("no exact earlier run start")
    })

    const mismatchingResultIndexes = makeRunHistoryIndexes()
    const start = runStartRecord()
    expect(integratorHistoryIssue(start, mismatchingResultIndexes)).toBeUndefined()
    const foreignResult = runResultRecord(
      preparedResult(IntegratorCorrelation.make({ ...session, expectedTargetHead: sha("e") }))
    )
    expect(validateIntegratorHistoryEvent(foreignResult, mismatchingResultIndexes)).toMatchObject({
      handled: true,
      issue: expect.stringContaining("matching session")
    })

    const foreignResultKeyIndexes = makeRunHistoryIndexes()
    expect(integratorHistoryIssue(start, foreignResultKeyIndexes)).toBeUndefined()
    expect(
      validateIntegratorHistoryEvent(
        runResultRecord(preparedResult(), runOne, 9, JournalRecordKey.make("foreign-run-result-key")),
        foreignResultKeyIndexes
      )
    ).toMatchObject({ handled: true, issue: expect.stringContaining("foreign key") })

    const noPreparedResult = makeRunHistoryIndexes()
    const noPreparedFacts = runGitFacts()
    const noPreparedIntent = noPreparedFacts[0]
    expect(noPreparedIntent).toBeDefined()
    if (noPreparedIntent === undefined) return
    expect(validateIntegratorHistoryEvent(noPreparedIntent, noPreparedResult)).toMatchObject({
      handled: true,
      issue: expect.stringContaining("no exact earlier PreparedCandidate result")
    })

    const foreignIntentKeyIndexes = makeRunHistoryIndexes()
    expect(integratorHistoryIssue(start, foreignIntentKeyIndexes)).toBeUndefined()
    const result = runResultRecord(preparedResult())
    expect(integratorHistoryIssue(result, foreignIntentKeyIndexes)).toBeUndefined()
    const intentFacts = runGitFacts()
    const intent = intentFacts[0]
    expect(intent).toBeDefined()
    if (intent === undefined) return
    expect(
      validateIntegratorHistoryEvent(
        { ...intent, key: JournalRecordKey.make("foreign-run-intent-key") },
        foreignIntentKeyIndexes
      )
    ).toMatchObject({ handled: true, issue: expect.stringContaining("foreign key") })

    const noIntentIndexes = makeRunHistoryIndexes()
    expect(integratorHistoryIssue(start, noIntentIndexes)).toBeUndefined()
    expect(integratorHistoryIssue(result, noIntentIndexes)).toBeUndefined()
    const noIntentFacts = runGitFacts()
    const noIntentObservation = noIntentFacts[1]
    expect(noIntentObservation).toBeDefined()
    if (noIntentObservation === undefined) return
    expect(validateIntegratorHistoryEvent(noIntentObservation, noIntentIndexes)).toMatchObject({
      handled: true,
      issue: expect.stringContaining("no exact earlier intent")
    })

    const foreignObservationKeyIndexes = makeRunHistoryIndexes()
    expect(integratorHistoryIssue(start, foreignObservationKeyIndexes)).toBeUndefined()
    expect(integratorHistoryIssue(result, foreignObservationKeyIndexes)).toBeUndefined()
    expect(integratorHistoryIssue(intent, foreignObservationKeyIndexes)).toBeUndefined()
    const foreignObservationFacts = runGitFacts()
    const foreignObservation = foreignObservationFacts[1]
    expect(foreignObservation).toBeDefined()
    if (foreignObservation === undefined) return
    expect(
      validateIntegratorHistoryEvent(
        { ...foreignObservation, key: JournalRecordKey.make("foreign-run-observation-key") },
        foreignObservationKeyIndexes
      )
    ).toMatchObject({ handled: true, issue: expect.stringContaining("foreign key") })

    const mismatchingObservationIndexes = makeRunHistoryIndexes()
    expect(integratorHistoryIssue(start, mismatchingObservationIndexes)).toBeUndefined()
    expect(integratorHistoryIssue(result, mismatchingObservationIndexes)).toBeUndefined()
    expect(integratorHistoryIssue(intent, mismatchingObservationIndexes)).toBeUndefined()
    const observationFacts = runGitFacts()
    const observation = observationFacts[1]
    expect(observation).toBeDefined()
    if (observation === undefined) return
    expect(observation.event._tag).toBe("IntegratorRunCandidateGitObserved")
    if (observation.event._tag !== "IntegratorRunCandidateGitObserved") return
    expect(
      validateIntegratorHistoryEvent(
        {
          ...observation,
          event: IntegratorRunCandidateGitObservedEvent.make({
            ...observation.event,
            observation: IntegratorGitObservation.cases.Missing.make({
              candidateText: IntegratorCandidateText.make("foreign-candidate")
            })
          })
        },
        mismatchingObservationIndexes
      )
    ).toMatchObject({
      handled: true,
      issue: expect.stringContaining("no exact earlier intent, result, and candidate text")
    })
  })

  it("checks every previous run fact before indexing a later run start", () => {
    const previousStart = runStartRecord(runOne, 8)
    const previousResult = runResultRecord(notPreparedResult(), runOne, 9)
    const runTwo = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(2))
    const laterStart = runStartRecord(runTwo, 20)
    const cases = [
      { start: undefined, result: undefined },
      { start: previousStart, result: undefined },
      { start: undefined, result: previousResult },
      { start: { ...previousStart, position: JournalPosition.make(21) }, result: previousResult },
      { start: previousStart, result: { ...previousResult, position: JournalPosition.make(21) } },
      { start: { ...previousStart, event: runStartRecord(runTwo, 8).event }, result: previousResult },
      {
        start: previousStart,
        result: {
          ...previousResult,
          event: runResultRecord(
            preparedResult(IntegratorCorrelation.make({ ...session, expectedTargetHead: sha("f") })),
            runOne,
            9
          ).event
        }
      }
    ]

    for (const { result, start } of cases) {
      const indexes = makeRunHistoryIndexes()
      if (start !== undefined && start.event._tag === "IntegratorRunStarted")
        indexes.integratorRunStarted.set(integratorRunRecordKeyPrefix(runOne), {
          event: start.event,
          position: start.position
        })
      if (result !== undefined && result.event._tag === "IntegratorRunResultRecorded")
        indexes.integratorRunResults.set(integratorRunRecordKeyPrefix(runOne), {
          event: result.event,
          position: result.position
        })
      expect(validateIntegratorHistoryEvent(laterStart, indexes, [laterStart])).toMatchObject({ handled: true })
    }
  })

  it("binds a first run to a fixed FullRerun successor session", () => {
    const fixture = makeSuccessorValidationFixture()
    const indexes = fixture.indexes
    indexes.integratorSessionFixed.set(JournalPosition.make(16), fixture.successorEvent)
    indexes.integratorSessionsBySessionId.set(fixture.successor.sessionId, JournalPosition.make(16))
    const successorRun = integratorRunCorrelationForSession(fixture.successor, IntegratorRunOrdinal.make(1))

    expect(validateIntegratorHistoryEvent(runStartRecord(successorRun, 17), indexes)).toEqual({
      handled: true,
      issue: undefined
    })
  })
})

describe("Integrator journal-record reconciliation", () => {
  it.effect("reuses exact durable results and candidate observations, rejecting lost races", () =>
    Effect.gen(function* () {
      const expectedResult = preparedResult()
      const expectedObservation = candidateObservation()
      const resultRecord = runResultRecord(expectedResult)
      const observationRecord = runGitFacts()[1]
      if (observationRecord === undefined) return yield* Effect.die("fixture lacks observation")
      if (observationRecord.event._tag !== "IntegratorRunCandidateGitObserved") {
        return yield* Effect.die("fixture has a non-run observation")
      }

      expect(yield* runResultFromAppendedRecord(resultRecord, runOne, expectedResult)).toEqual(expectedResult)
      expect(yield* readRecordedRunResult([resultRecord], runOne)).toEqual(Option.some(expectedResult))
      expect(yield* readRecordedRunResult([], runOne)).toEqual(Option.none())
      expect(
        yield* runObservationFromAppendedRecord(observationRecord, runOne, candidateText, expectedObservation)
      ).toEqual(expectedObservation)
      expect(
        yield* readRunCandidateObservation([observationRecord, ...runGitFacts().slice(0, 1)], runOne, candidateText)
      ).toEqual(Option.some(expectedObservation))

      const wrongResult = yield* runResultFromAppendedRecord(
        {
          ...resultRecord,
          event: IntegratorRunStartedEvent.make({ run: runOne, version: workflowJournalEventVersion })
        },
        runOne,
        expectedResult
      ).pipe(Effect.flip)
      expect(wrongResult).toBeInstanceOf(IntegratorJournalContradiction)
      const wrongObservation = yield* runObservationFromAppendedRecord(
        {
          ...observationRecord,
          event: IntegratorRunCandidateGitObservedEvent.make({
            ...observationRecord.event,
            candidateText: IntegratorCandidateText.make("foreign")
          })
        },
        runOne,
        candidateText,
        expectedObservation
      ).pipe(Effect.flip)
      expect(wrongObservation).toBeInstanceOf(IntegratorJournalContradiction)
      expect(
        yield* readRecordedRunResult(
          [
            {
              ...resultRecord,
              event: IntegratorRunStartedEvent.make({ run: runOne, version: workflowJournalEventVersion })
            }
          ],
          runOne
        ).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)
      expect(
        yield* readRunCandidateObservation([observationRecord], runOne, candidateText).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)
    })
  )

  it.effect("records one run Git-read intent before an effect and reconciles retry starts", () =>
    Effect.gen(function* () {
      const { journal, records } = yield* makeJournal([...lineageRecords(), sessionRecord()])
      const appended = yield* appendRunGitReadIntentIfNeeded(journal, runOne, candidateText, yield* Ref.get(records))
      expect(appended.event._tag).toBe("IntegratorRunCandidateGitReadIntended")
      const reused = yield* appendRunGitReadIntentIfNeeded(journal, runOne, candidateText, yield* Ref.get(records))
      expect(reused).toEqual(appended)

      const badExisting = [
        ...lineageRecords(),
        sessionRecord(),
        { ...appended, event: IntegratorRunStartedEvent.make({ run: runOne, version: workflowJournalEventVersion }) }
      ]
      expect(
        yield* appendRunGitReadIntentIfNeeded(journal, runOne, candidateText, badExisting).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)

      const runTwo = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(2))
      expect(
        yield* reconcileRunResult(journal, runTwo, yield* Ref.get(records), Option.none(), false).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)
      const started = yield* reconcileRunResult(journal, runOne, yield* Ref.get(records), Option.none(), false)
      expect(started).toEqual(Option.none())
      const withLegacyResult = [...lineageRecords(), sessionRecord(), legacyResultRecord(notPreparedResult())]
      const { journal: migrationJournal, records: migrationRecords } = yield* makeJournal(withLegacyResult)
      expect(yield* reconcileRunResult(migrationJournal, runTwo, withLegacyResult, Option.none(), false)).toEqual(
        Option.none()
      )
      expect((yield* Ref.get(migrationRecords)).some((item) => item.event._tag === "IntegratorRunStarted")).toBe(true)
    })
  )

  it.effect("reads legacy candidate facts only for ordinal one and rejects a legacy result/run collision", () =>
    Effect.gen(function* () {
      const legacy = [...lineageRecords(), sessionRecord(), legacyResultRecord(preparedResult()), ...legacyGitFacts()]
      expect(yield* readLegacyInitialResultForRun(legacy, runOne)).toEqual(Option.some(preparedResult()))
      expect(
        yield* readLegacyInitialResultForRun(
          legacy,
          integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(2))
        )
      ).toEqual(Option.none())
      expect(yield* readRunCandidateObservation(legacy, runOne, candidateText)).toEqual(
        Option.some(candidateObservation())
      )
      expect(
        yield* readRunCandidateObservation(
          legacy,
          integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(2)),
          candidateText
        )
      ).toEqual(Option.none())
      expect(yield* validateLegacyInitialResult(legacy, runOne, preparedResult())).toEqual(preparedResult())
      expect(
        yield* validateLegacyInitialResult([...legacy, runStartRecord()], runOne, preparedResult()).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)
    })
  )

  it.effect("fails closed on legacy key races and reuses a durable predecessor for Retry", () =>
    Effect.gen(function* () {
      const foreign = IntegratorCorrelation.make({
        ...session,
        candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:foreign-reconcile"),
        sessionId: IntegratorSessionId.make("integrator-session:foreign-reconcile")
      })
      const wrongResultRecord = {
        ...legacyResultRecord(preparedResult()),
        event: IntegratorRunStartedEvent.make({ run: runOne, version: workflowJournalEventVersion })
      }
      expect(yield* readLegacyInitialResultForRun([wrongResultRecord], runOne).pipe(Effect.flip)).toBeInstanceOf(
        IntegratorJournalContradiction
      )
      expect(
        yield* readLegacyInitialResultForRun([legacyResultRecord(preparedResult(foreign))], runOne).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)

      const legacyObservation = legacyGitFacts()[1]
      expect(legacyObservation).toBeDefined()
      if (legacyObservation === undefined) return
      expect(legacyObservation.event._tag).toBe("IntegratorCandidateGitObserved")
      if (legacyObservation.event._tag !== "IntegratorCandidateGitObserved") return
      expect(
        yield* readRunCandidateObservation(
          [
            {
              ...legacyObservation,
              event: IntegratorRunStartedEvent.make({ run: runOne, version: workflowJournalEventVersion })
            }
          ],
          runOne,
          candidateText
        ).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)
      expect(
        yield* readRunCandidateObservation(
          [
            {
              ...legacyObservation,
              event: IntegratorCandidateGitObservedEvent.make({ ...legacyObservation.event, correlation: foreign })
            }
          ],
          runOne,
          candidateText
        ).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)
      expect(
        yield* readRunCandidateObservation(
          [
            {
              ...legacyObservation,
              event: IntegratorCandidateGitObservedEvent.make({
                ...legacyObservation.event,
                observation: IntegratorGitObservation.cases.Missing.make({
                  candidateText: IntegratorCandidateText.make("foreign-candidate")
                })
              })
            }
          ],
          runOne,
          candidateText
        ).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)

      const legacyIntent = legacyGitFacts()[0]
      const legacyLineage = lineageRecords()[1]
      expect(legacyIntent).toBeDefined()
      expect(legacyLineage).toBeDefined()
      if (legacyIntent === undefined || legacyLineage === undefined) return
      expect(
        yield* readRunCandidateObservation(
          [{ ...legacyIntent, event: legacyLineage.event }],
          runOne,
          candidateText
        ).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)

      const wrongAppendJournal = InRunJournal.of({
        append: (requestedRunId, key) => Effect.succeed({ ...runStartRecord(runOne, 8, key), runId: requestedRunId }),
        read: () => Effect.succeed([])
      })
      expect(
        yield* appendRunGitReadIntentIfNeeded(wrongAppendJournal, runOne, candidateText, []).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)

      const previousRunRecords = [
        ...lineageRecords(),
        sessionRecord(),
        runStartRecord(runOne),
        runResultRecord(notPreparedResult(), runOne)
      ]
      const { journal } = yield* makeJournal(previousRunRecords)
      const runTwo = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(2))
      expect(yield* reconcileRunResult(journal, runTwo, previousRunRecords, Option.none(), false)).toEqual(
        Option.none()
      )
    })
  )
})

describe("Integrator session intent races", () => {
  it.effect("rejects an existing foreign run-start key and a losing append", () =>
    Effect.gen(function* () {
      const foreignEvent = sessionRecord(undefined, 8)
      const foreignKey = { ...foreignEvent, key: integratorRunStartedRecordKey(runOne) }
      const { journal } = yield* makeJournal([])
      expect(yield* appendIntegratorRunStartedIfNeeded(journal, runOne, [foreignKey]).pipe(Effect.flip)).toBeInstanceOf(
        IntegratorJournalContradiction
      )

      const losingJournal = InRunJournal.of({
        append: (requestedRunId, key) => Effect.succeed({ ...runStartRecord(runOne, 5, key), runId: requestedRunId }),
        read: () => Effect.succeed([])
      })
      expect(yield* appendIntegratorRunStartedIfNeeded(losingJournal, runOne, []).pipe(Effect.flip)).toBeInstanceOf(
        IntegratorJournalContradiction
      )
    })
  )
})
