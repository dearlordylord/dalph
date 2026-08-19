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
  integratorRunCandidateGitObservedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunRecordKeyPrefix,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  integratorSuccessorSessionFixedRecordKey,
  integrationQuarantinedRecordKey,
  integrationQuarantineDirectionAppliedRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineDirectionSubject,
  IntegrationQuarantinedEvent
} from "../integration-quarantine/events.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunOrdinal,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorResult,
  IntegratorSessionFixedEvent,
  IntegratorSessionId,
  IntegratorSuccessorSessionFixedEvent
} from "./events.js"
import { IntegratorJournalContradiction } from "./errors.js"
import {
  appendRunGitReadIntentIfNeeded,
  readRecordedRunResult,
  readRunCandidateObservation,
  reconcileRunResult,
  runObservationFromAppendedRecord,
  runResultFromAppendedRecord
} from "./journal-record-reconciliation.js"
import {
  appendIntegratorRunStartedIfNeeded,
  integratorCorrelationFor,
  integratorRunCorrelationForSession,
  integratorSuccessorCorrelationFor,
  IntegratorPreparationInput
} from "./session.js"
import {
  deriveCurrentIntegratorState,
  deriveIntegratorRunState,
  integratorResponsibilityFactsFor,
  integratorRunQualifiedCandidateFromState
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

const sessionRecord = (correlation: IntegratorSessionCorrelation = session, position = 6): JournalRecord =>
  record(
    position,
    IntegratorSessionFixedEvent.make({ correlation, version: workflowJournalEventVersion }),
    integratorSessionFixedRecordKey(integratorResponsibilityFactsFor(responsibility))
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

const preparedResult = (correlation: IntegratorSessionCorrelation = session): IntegratorResult =>
  IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation })

const notPreparedResult = (correlation: IntegratorSessionCorrelation = session): IntegratorResult =>
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

const makeRunHistoryIndexes = (): IntegratorHistoryIndexes => {
  const fixed = IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })
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
    integratorRunStarted: new Map(),
    integratorRunResults: new Map(),
    integratorRunCandidateGitReadIntents: new Map(),
    integratorRunCandidateGitObservations: new Map()
  }
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
      evidence: { resultRecordedAt: JournalPosition.make(9) }
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
  return { freshLineage, indexes, records, successor, successorEvent }
}

describe("Integrator reconstruction states", () => {
  it("reconstructs only explicit run outcomes from their exact chronology", () => {
    expect(deriveCurrentIntegratorState([], responsibility)).toMatchObject({ _tag: "Absent" })
    const fixed = [...lineageRecords(), sessionRecord()]
    expect(deriveCurrentIntegratorState(fixed, responsibility)).toMatchObject({ _tag: "RunUnfinished" })

    const prepared = [...fixed, runStartRecord(), runResultRecord(preparedResult()), ...runGitFacts()]
    const current = deriveCurrentIntegratorState(prepared, responsibility)
    expect(current._tag).toBe("GitQualifiedPrepared")
    if (current._tag === "GitQualifiedPrepared") {
      expect(integratorRunQualifiedCandidateFromState(current).run).toEqual(runOne)
    }
    expect(deriveIntegratorRunState([...fixed, runStartRecord()], responsibility, runOne)).toMatchObject({
      _tag: "RunUnfinished"
    })
    expect(
      deriveIntegratorRunState(
        [...fixed, runStartRecord(), runResultRecord(notPreparedResult())],
        responsibility,
        runOne
      )
    ).toMatchObject({ _tag: "NotPrepared" })
    expect(
      deriveIntegratorRunState(
        [...fixed, runStartRecord(), runResultRecord(notPreparedResult()), ...runGitFacts()],
        responsibility,
        runOne
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("NotPrepared cannot") })
    expect(
      deriveIntegratorRunState(
        [
          ...fixed,
          runStartRecord(),
          runResultRecord(preparedResult()),
          ...runGitFacts(
            undefined,
            candidateObservation(IntegratorGitObservation.cases.Missing.make({ candidateText }))
          )
        ],
        responsibility,
        runOne
      )
    ).toMatchObject({ _tag: "CandidateRejected" })
  })

  it("fails closed when run-bound records are unbound or out of chronology", () => {
    const fixed = [...lineageRecords(), sessionRecord()]
    expect(
      deriveIntegratorRunState([...fixed, runResultRecord(notPreparedResult())], responsibility, runOne)
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("without IntegratorRunStarted") })
    expect(
      deriveCurrentIntegratorState(
        [...fixed, runStartRecord(runOne, 8, JournalRecordKey.make("foreign-run-start-key"))],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("foreign key") })
    const runTwo = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(2))
    expect(deriveIntegratorRunState(fixed, responsibility, runTwo)).toMatchObject({ _tag: "Absent" })
  })

  it("fails closed when the exact run session index is missing or points to an unknown session", () => {
    const missingSession = makeRunHistoryIndexes()
    missingSession.integratorSessionsBySessionId.clear()
    expect(validateIntegratorHistoryEvent(runStartRecord(), missingSession)).toMatchObject({
      handled: true,
      issue: expect.stringContaining("no exact earlier fixed session")
    })

    const unknownSession = makeRunHistoryIndexes()
    unknownSession.integratorSessionsBySessionId.set(session.sessionId, JournalPosition.make(99))
    expect(validateIntegratorHistoryEvent(runStartRecord(), unknownSession)).toMatchObject({
      handled: true,
      issue: expect.stringContaining("no exact earlier fixed session")
    })

    const overRetry = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(3))
    expect(validateIntegratorHistoryEvent(runStartRecord(overRetry, 12), makeRunHistoryIndexes())).toMatchObject({
      handled: true,
      issue: expect.stringContaining("exceeds Retry bound")
    })
  })

  it("rejects duplicate, foreign, and out-of-order exact run facts", () => {
    const fixed = [...lineageRecords(), sessionRecord()]
    const duplicateStart = [...fixed, runStartRecord(), runStartRecord(runOne, 12)]
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

    const wrongResult = [...fixed, runStartRecord(), runResultRecord(preparedResult()), ...runGitFacts()]
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

  it("rejects foreign session, key, and target-lineage facts", () => {
    const fixed = [...lineageRecords(), sessionRecord()]
    const foreign = IntegratorSessionCorrelation.make({
      ...session,
      candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:foreign"),
      sessionId: IntegratorSessionId.make("integrator-session:foreign")
    })
    expect(
      deriveIntegratorRunState(
        [
          ...fixed,
          record(7, IntegratorSessionFixedEvent.make({ correlation: foreign, version: workflowJournalEventVersion })),
          runStartRecord()
        ],
        responsibility,
        runOne
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("multiple fixed sessions") })

    expect(
      deriveCurrentIntegratorState(
        [
          ...fixed,
          record(7, IntegratorSessionFixedEvent.make({ correlation: foreign, version: workflowJournalEventVersion }))
        ],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("multiple target heads") })

    expect(
      deriveCurrentIntegratorState(
        [...fixed, runStartRecord(runOne, 8, JournalRecordKey.make("foreign-run-start-key"))],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("foreign key") })

    const foreignSessionRecord = record(
      7,
      IntegratorSessionFixedEvent.make({
        correlation: IntegratorSessionCorrelation.make({ ...foreign, acceptedResult: acceptedResultFixture(sha("f")) }),
        version: workflowJournalEventVersion
      }),
      integratorSessionFixedRecordKey(integratorResponsibilityFactsFor(responsibility))
    )
    expect(deriveCurrentIntegratorState([...lineageRecords(), foreignSessionRecord], responsibility)).toMatchObject({
      _tag: "Contradiction",
      detail: expect.stringContaining("does not bind")
    })

    const foreignLineage = lineageRecords().map((item) =>
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
    )
    expect(deriveCurrentIntegratorState([...foreignLineage, sessionRecord()], responsibility)).toMatchObject({
      _tag: "Contradiction",
      detail: expect.stringContaining("target-lineage")
    })

    const nonSessionAtSessionKey = runStartRecord(
      runOne,
      8,
      integratorSessionFixedRecordKey(integratorResponsibilityFactsFor(responsibility))
    )
    expect(deriveCurrentIntegratorState([...lineageRecords(), nonSessionAtSessionKey], responsibility)).toMatchObject({
      _tag: "Contradiction",
      detail: expect.stringContaining("non-session")
    })
  })

  it("promotes only one chronologically complete FullRerun successor", () => {
    const fixture = makeSuccessorValidationFixture()
    const base = [...lineageRecords(), sessionRecord()]
    const complete = [...base, record(15, fixture.freshLineage), ...fixture.records]
    expect(deriveCurrentIntegratorState(complete, responsibility)).toMatchObject({ _tag: "RunUnfinished" })

    const successorRunOne = integratorRunCorrelationForSession(fixture.successor, IntegratorRunOrdinal.make(1))
    expect(deriveIntegratorRunState(complete, responsibility, successorRunOne)).toMatchObject({
      _tag: "RunUnfinished",
      run: successorRunOne
    })
    expect(
      deriveIntegratorRunState(
        [
          ...complete,
          runResultRecord(
            IntegratorResult.cases.NotPrepared.make({ correlation: fixture.successor, detail }),
            successorRunOne,
            17
          )
        ],
        responsibility,
        successorRunOne
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("without IntegratorRunStarted") })

    const unrelatedPredecessor = IntegratorSessionCorrelation.make({
      ...session,
      candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:unrelated-predecessor"),
      sessionId: IntegratorSessionId.make("integrator-session:unrelated-predecessor")
    })
    const unrelatedSuccessor = IntegratorSuccessorSessionFixedEvent.make({
      ...fixture.successorEvent,
      predecessor: unrelatedPredecessor
    })
    expect(
      deriveIntegratorRunState(
        [...complete, record(18, unrelatedSuccessor), runStartRecord(runOne, 19)],
        responsibility,
        runOne
      )
    ).toMatchObject({ _tag: "RunUnfinished", run: runOne })

    const successorRunTwo = integratorRunCorrelationForSession(fixture.successor, IntegratorRunOrdinal.make(2))
    expect(
      deriveCurrentIntegratorState(
        [...complete, runStartRecord(successorRunTwo, 17, integratorRunStartedRecordKey(successorRunTwo))],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("initial Integrator run") })

    expect(
      deriveCurrentIntegratorState([...complete, runStartRecord(successorRunOne, 17)], responsibility)
    ).toMatchObject({ _tag: "RunUnfinished" })

    const successorRecord = fixture.records[2]
    const quarantineRecord = fixture.records[0]
    expect(successorRecord).toBeDefined()
    expect(quarantineRecord).toBeDefined()
    if (successorRecord === undefined || quarantineRecord === undefined) return
    expect(
      deriveCurrentIntegratorState(
        [...complete, { ...successorRecord, position: JournalPosition.make(17) }],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("multiple FullRerun successors") })

    const foreignPredecessor = IntegratorSessionCorrelation.make({ ...session, expectedTargetHead: sha("f") })
    const foreignPredecessorEvent = IntegratorSuccessorSessionFixedEvent.make({
      ...fixture.successorEvent,
      predecessor: foreignPredecessor
    })
    expect(
      deriveCurrentIntegratorState(
        [
          ...base,
          record(15, fixture.freshLineage),
          record(10, fixture.records[0]?.event ?? fixture.successorEvent),
          record(12, fixture.records[1]?.event ?? fixture.successorEvent),
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
          record(15, fixture.freshLineage),
          ...fixture.records.map((item, index) =>
            index === 2 ? { ...item, key: JournalRecordKey.make("foreign-successor-key") } : item
          )
        ],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("foreign key") })

    const invalidDirection = fixture.records[1]
    expect(invalidDirection).toBeDefined()
    if (invalidDirection === undefined || invalidDirection.event._tag !== "IntegrationQuarantineDirectionApplied")
      return
    const retryDirection = record(
      invalidDirection.position,
      IntegrationQuarantineDirectionAppliedEvent.make({
        ...invalidDirection.event,
        fingerprint: IntegrationQuarantineDirectionFingerprint.make({
          ...invalidDirection.event.fingerprint,
          direction: "Retry"
        })
      }),
      invalidDirection.key
    )
    expect(
      deriveCurrentIntegratorState(
        [...base, record(15, fixture.freshLineage), quarantineRecord, retryDirection, successorRecord],
        responsibility
      )
    ).toMatchObject({ _tag: "Contradiction", detail: expect.stringContaining("FullRerun successor does not preserve") })
  })
})

describe("Integrator reconstruction history indexes", () => {
  it("accepts and validates one exact run start, result, Git intent, and observation", () => {
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
    const foreignKeyIndexes = makeRunHistoryIndexes()
    expect(validateIntegratorHistoryEvent(start, foreignKeyIndexes, [start])).toEqual({
      handled: true,
      issue: undefined
    })
    expect(validateIntegratorHistoryEvent(result, foreignKeyIndexes, [start, result])).toEqual({
      handled: true,
      issue: undefined
    })
    expect(
      validateIntegratorHistoryEvent({ ...intent, key: JournalRecordKey.make("foreign-key") }, foreignKeyIndexes, [
        start,
        result,
        intent
      ])
    ).toMatchObject({ handled: true, issue: expect.stringContaining("foreign key") })
  })

  it("requires exact retry predecessor evidence before indexing run two", () => {
    const runTwo = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(2))
    const laterStart = runStartRecord(runTwo, 20)
    expect(validateIntegratorHistoryEvent(laterStart, makeRunHistoryIndexes(), [laterStart])).toMatchObject({
      handled: true,
      issue: expect.any(String)
    })
    const indexes = makeRunHistoryIndexes()
    const fixed = sessionRecord()
    const previousStart = runStartRecord(runOne, 8)
    const previousResult = runResultRecord(notPreparedResult(), runOne, 9)
    const basis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
      cause: { _tag: "NotPrepared", detail },
      evidence: { resultRecordedAt: previousResult.position }
    })
    const quarantine = record(
      10,
      IntegrationQuarantinedEvent.make({
        basis,
        correlation: session,
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      }),
      integrationQuarantinedRecordKey(session.sessionId, basis)
    )
    const directionFingerprint = IntegrationQuarantineDirectionFingerprint.make({
      direction: "Retry",
      quarantineAt: quarantine.position,
      sessionId: session.sessionId
    })
    const direction = record(
      11,
      IntegrationQuarantineDirectionAppliedEvent.make({
        fingerprint: directionFingerprint,
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "reconstruction-retry", runId }),
        version: workflowJournalEventVersion
      }),
      integrationQuarantineDirectionAppliedRecordKey(
        IntegrationQuarantineDirectionSubject.make({ quarantineAt: quarantine.position, sessionId: session.sessionId })
      )
    )
    const freshLineageOperationId = OperationId.make("integrator-reconstruction-retry-lineage")
    const freshLineageOperation = makeTargetLineageObservationOperation({
      integrationTarget: target,
      operationId: freshLineageOperationId,
      plannedAttempt,
      predecessorOperationIds: []
    })
    const freshIntent = record(
      12,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: freshLineageOperation,
        version: workflowJournalEventVersion
      })
    )
    const freshObservation = record(
      13,
      TargetLineageObservedEvent.make({
        observation: input.targetLineage,
        occurrenceClassification: "NonActionOccurrence",
        operationId: freshLineageOperationId,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    indexes.integratorRunStarted.set(integratorRunRecordKeyPrefix(runOne), {
      event: previousStart.event as Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunStarted" }>,
      position: previousStart.position
    })
    indexes.integratorRunResults.set(integratorRunRecordKeyPrefix(runOne), {
      event: previousResult.event as Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunResultRecorded" }>,
      position: previousResult.position
    })
    const retryRecords = [
      ...lineageRecords(),
      fixed,
      previousStart,
      previousResult,
      quarantine,
      direction,
      freshIntent,
      freshObservation,
      laterStart
    ]
    expect(
      validateIntegratorHistoryEvent(laterStart, indexes, [
        fixed,
        previousStart,
        previousResult,
        quarantine,
        direction,
        freshIntent,
        freshObservation,
        laterStart
      ])
    ).toMatchObject({ handled: true, issue: undefined })
    expect(deriveCurrentIntegratorState(retryRecords, responsibility)).toMatchObject({
      _tag: "RunUnfinished",
      run: runTwo
    })
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
    expect(
      validateIntegratorHistoryEvent(
        { ...successorRecord, key: JournalRecordKey.make("foreign-successor-key") },
        foreignKeyFixture.indexes,
        foreignKeyFixture.records
      )
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
            preparedResult(IntegratorSessionCorrelation.make({ ...session, expectedTargetHead: sha("f") })),
            runOne,
            9
          ).event
        }
      }
    ]

    for (const { result, start } of cases) {
      const indexes = makeRunHistoryIndexes()
      if (start !== undefined && start.event._tag === "IntegratorRunStarted") {
        indexes.integratorRunStarted.set(integratorRunRecordKeyPrefix(runOne), {
          event: start.event,
          position: start.position
        })
      }
      if (result !== undefined && result.event._tag === "IntegratorRunResultRecorded") {
        indexes.integratorRunResults.set(integratorRunRecordKeyPrefix(runOne), {
          event: result.event,
          position: result.position
        })
      }
      expect(validateIntegratorHistoryEvent(laterStart, indexes, [laterStart])).toMatchObject({ handled: true })
    }
  })

  it("binds a first run to a fixed FullRerun successor session", () => {
    const fixture = makeSuccessorValidationFixture()
    const indexes = fixture.indexes
    indexes.integratorSessionFixed.set(JournalPosition.make(16), fixture.successorEvent)
    indexes.integratorSessionsBySessionId.set(fixture.successor.sessionId, JournalPosition.make(16))
    indexes.integratorSessionsByCandidateResource.set(fixture.successor.candidateResource, JournalPosition.make(16))
    const successorRun = integratorRunCorrelationForSession(fixture.successor, IntegratorRunOrdinal.make(1))

    expect(validateIntegratorHistoryEvent(runStartRecord(successorRun, 17), indexes)).toEqual({
      handled: true,
      issue: undefined
    })
  })
})

describe("Integrator journal-record reconciliation", () => {
  it.effect("reuses exact durable results and candidate observations, rejecting foreign records", () =>
    Effect.gen(function* () {
      const expectedResult = preparedResult()
      const expectedObservation = candidateObservation()
      const resultRecord = runResultRecord(expectedResult)
      const observationRecord = runGitFacts()[1]
      if (observationRecord === undefined || observationRecord.event._tag !== "IntegratorRunCandidateGitObserved") {
        return yield* Effect.die("fixture lacks run observation")
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
      expect(
        yield* readRunCandidateObservation([observationRecord], runOne, candidateText).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)

      const wrongResult = yield* runResultFromAppendedRecord(
        {
          ...resultRecord,
          event: IntegratorRunStartedEvent.make({ run: runOne, version: workflowJournalEventVersion })
        },
        runOne,
        expectedResult
      ).pipe(Effect.flip)
      expect(wrongResult).toBeInstanceOf(IntegratorJournalContradiction)
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

      const foreign = IntegratorSessionCorrelation.make({
        ...session,
        candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:foreign-reconcile"),
        sessionId: IntegratorSessionId.make("integrator-session:foreign-reconcile")
      })
      expect(
        yield* runResultFromAppendedRecord(runResultRecord(preparedResult(foreign)), runOne, expectedResult).pipe(
          Effect.flip
        )
      ).toBeInstanceOf(IntegratorJournalContradiction)

      const wrongObservation = yield* runObservationFromAppendedRecord(
        {
          ...observationRecord,
          event: IntegratorRunCandidateGitObservedEvent.make({
            ...observationRecord.event,
            candidateText: IntegratorCandidateText.make("foreign-candidate")
          })
        },
        runOne,
        candidateText,
        expectedObservation
      ).pipe(Effect.flip)
      expect(wrongObservation).toBeInstanceOf(IntegratorJournalContradiction)
    })
  )

  it.effect("writes the run intent before an ambiguous boundary and refuses an unproved retry", () =>
    Effect.gen(function* () {
      const { journal, records } = yield* makeJournal([...lineageRecords(), sessionRecord()])
      const appended = yield* appendRunGitReadIntentIfNeeded(journal, runOne, candidateText, yield* Ref.get(records))
      expect(appended.event._tag).toBe("IntegratorRunCandidateGitReadIntended")
      expect(yield* appendRunGitReadIntentIfNeeded(journal, runOne, candidateText, yield* Ref.get(records))).toEqual(
        appended
      )
      const existingIntent = runGitFacts()[0]
      if (existingIntent === undefined) return yield* Effect.die("fixture lacks run Git-read intent")
      expect(
        yield* appendRunGitReadIntentIfNeeded(journal, runOne, candidateText, [
          {
            ...existingIntent,
            event: IntegratorRunStartedEvent.make({ run: runOne, version: workflowJournalEventVersion })
          }
        ]).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)
      const runTwo = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(2))
      expect(
        yield* reconcileRunResult(journal, runTwo, yield* Ref.get(records), Option.none(), false).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)
      expect(yield* reconcileRunResult(journal, runOne, yield* Ref.get(records), Option.none(), false)).toEqual(
        Option.none()
      )
      const withPreviousRun = [
        ...lineageRecords(),
        sessionRecord(),
        runStartRecord(),
        runResultRecord(notPreparedResult())
      ]
      const { journal: retryJournal, records: retryRecords } = yield* makeJournal(withPreviousRun)
      expect(yield* reconcileRunResult(retryJournal, runTwo, withPreviousRun, Option.none(), false)).toEqual(
        Option.none()
      )
      expect((yield* Ref.get(retryRecords)).some((item) => item.event._tag === "IntegratorRunStarted")).toBe(true)
    })
  )

  it.effect("fails closed on foreign append results and reuses a durable predecessor for Retry", () =>
    Effect.gen(function* () {
      const wrongAppendJournal = InRunJournal.of({
        append: (requestedRunId, key) =>
          Effect.succeed({ ...runResultRecord(preparedResult(), runOne, 8, key), runId: requestedRunId }),
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

describe("Integrator session intent races", () => {
  it.effect("rejects a foreign run-start key and a losing append", () =>
    Effect.gen(function* () {
      const foreignEvent = sessionRecord(undefined, 8)
      const foreignKey = { ...foreignEvent, key: integratorRunStartedRecordKey(runOne) }
      const { journal } = yield* makeJournal([])
      expect(yield* appendIntegratorRunStartedIfNeeded(journal, runOne, [foreignKey]).pipe(Effect.flip)).toBeInstanceOf(
        IntegratorJournalContradiction
      )
    })
  )
})
