import { it } from "@effect/vitest"
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
import { Effect } from "effect"
import { expect } from "vitest"
import { acceptedResultFixture } from "../../../../test/support/evidence.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { OperationId } from "../../identity.js"
import { TargetLineageObservedEvent } from "../../registry/event.js"
import { makeTargetLineageObservationOperation } from "../../registry/operation.js"
import {
  integrationQuarantinedRecordKey,
  integratorSuccessorSessionFixedRecordKey,
  integratorRunCandidateGitObservedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import {
  InRunJournal,
  JournalStore,
  JournalStoreContradiction,
  type JournalRecord
} from "../../../workflow-journal/store.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { deriveIntegrationQuarantineState } from "./state.js"
import { appendInitialConclusiveIntegrationQuarantine } from "./initial-conclusive.js"
import {
  IntegratorCandidateText,
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunProtocolResult,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionFixedEvent,
  IntegratorSessionId,
  IntegratorSuccessorSessionFixedEvent,
  firstFullRerunSuccessorGeneration
} from "../integrator/events.js"
import { integratorResponsibilityFactsFromCorrelation } from "../integrator/state.js"
import { integratorRunCorrelationForSession } from "../integrator/session.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineResultEvidence,
  IntegrationQuarantinedEvent
} from "./events.js"

const runId = RunId.make("initial-conclusive-quarantine-run")
const target = FixtureTarget.make("initial-conclusive-quarantine-target")
const base = GitCommitSha.make("a".repeat(40))
const targetHead = GitCommitSha.make("b".repeat(40))
const acceptedCommit = GitCommitSha.make("c".repeat(40))
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("initial-conclusive-quarantine-attempt"),
  baseSha: base,
  branch: TaskBranchRef.make("refs/heads/dalph/initial-conclusive-quarantine"),
  executor: TaskExecutorLocator.make("executor:initial-conclusive-quarantine"),
  runId,
  taskId: TaskId.make("initial-conclusive-quarantine-task"),
  taskRevision: TaskRevision.make("initial-conclusive-quarantine-revision"),
  worktree: WorktreeLocator.make("/worktrees/initial-conclusive-quarantine")
})
const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult: acceptedResultFixture(acceptedCommit),
  integrationTarget: IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("/repositories/initial-conclusive-quarantine.git")
  }),
  plannedAttempt,
  queuedAt: JournalPosition.make(3),
  startedAt: JournalPosition.make(4)
})
const lineage = TargetLineageObservation.make({
  plannedBaseIsAncestorOfTargetHead: true,
  plannedBaseSha: base,
  targetHeadSha: targetHead
})
const candidateText = IntegratorCandidateText.make("refs/heads/initial-conclusive-candidate")
const notPreparedDetail = IntegratorNotPreparedDetail.make("the outer Integrator returned no candidate")

const appendExactHistory = Effect.fn("InitialConclusiveTest.appendExactHistory")(function* (
  kind: "NotPrepared" | "CandidateRejected"
) {
  const journal = yield* JournalStore
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget: responsibility.integrationTarget,
    operationId: OperationId.make("initial-conclusive-lineage"),
    plannedAttempt,
    predecessorOperationIds: []
  })
  yield* journal.append(
    runId,
    JournalRecordKey.make("initial-conclusive:lineage"),
    TargetLineageObservedEvent.make({
      observation: lineage,
      occurrenceClassification: "NonActionOccurrence",
      operationId: lineageOperation.operationId,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const session = IntegratorSessionCorrelation.make({
    acceptedResult: responsibility.acceptedResult,
    candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:initial-conclusive"),
    expectedTargetHead: targetHead,
    integrationTarget: responsibility.integrationTarget,
    plannedAttempt,
    queuedAt: responsibility.queuedAt,
    sessionId: IntegratorSessionId.make("integrator-session:initial-conclusive"),
    startedAt: responsibility.startedAt,
    targetLineageObservedAt: JournalPosition.make(2)
  })
  const run = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(1))
  yield* journal.append(runId, integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(session)), {
    _tag: "IntegratorSessionFixed",
    correlation: session,
    version: workflowJournalEventVersion
  })
  yield* journal.append(
    runId,
    integratorRunStartedRecordKey(run),
    IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
  )
  const result: IntegratorRunProtocolResult =
    kind === "NotPrepared"
      ? IntegratorRunProtocolResult.cases.NotPrepared.make({ detail: notPreparedDetail, run })
      : IntegratorRunProtocolResult.cases.CandidateRejected.make({
          candidateText,
          observation: IntegratorGitObservation.cases.Missing.make({ candidateText }),
          run
        })
  const resultRecord = yield* journal.append(
    runId,
    integratorRunResultRecordedRecordKey(run),
    IntegratorRunResultRecordedEvent.make({
      result:
        kind === "NotPrepared"
          ? IntegratorResult.cases.NotPrepared.make({ correlation: session, detail: notPreparedDetail })
          : IntegratorResult.cases.PreparedCandidate.make({ correlation: session, candidateText }),
      run,
      version: workflowJournalEventVersion
    })
  )
  let observationRecord: JournalRecord | undefined
  if (kind === "CandidateRejected") {
    yield* journal.append(
      runId,
      integratorRunCandidateGitReadIntendedRecordKey(run, candidateText),
      IntegratorRunCandidateGitReadIntendedEvent.make({ candidateText, run, version: workflowJournalEventVersion })
    )
    observationRecord = yield* journal.append(
      runId,
      integratorRunCandidateGitObservedRecordKey(run, candidateText),
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText,
        observation: IntegratorGitObservation.cases.Missing.make({ candidateText }),
        run,
        version: workflowJournalEventVersion
      })
    )
  }
  return { journal, result, resultRecord, run, session, observationRecord }
})

it.effect("quarantines one conclusively unsuccessful Integrator session and preserves its evidence", () =>
  Effect.gen(function* () {
    const history = yield* appendExactHistory("NotPrepared")
    const first = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(InRunJournal, history.journal)
    )
    const second = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(InRunJournal, history.journal)
    )
    expect(second).toEqual(first)
    const records = yield* history.journal.read(runId)
    expect(records.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(1)
    expect(deriveIntegrationQuarantineState(records, history.session.sessionId)._tag).toBe("Quarantined")
    const quarantine = records.find(({ event }) => event._tag === "IntegrationQuarantined")
    if (quarantine?.event._tag !== "IntegrationQuarantined") return
    expect(quarantine.event.correlation).toEqual(history.session)
    expect(quarantine.event.correlation.acceptedResult).toEqual(history.session.acceptedResult)
    expect(quarantine.event.correlation.candidateResource).toBe(history.session.candidateResource)
    expect(quarantine.event.correlation.queuedAt).toBe(history.session.queuedAt)
    expect(quarantine.event.correlation.startedAt).toBe(history.session.startedAt)
    expect(quarantine.event.basis).toEqual(
      expect.objectContaining({
        _tag: "ConclusiveResult",
        cause: { _tag: "NotPrepared", detail: notPreparedDetail },
        evidence: { resultRecordedAt: history.resultRecord.position }
      })
    )
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("records CandidateRejected Q with exact result and invalid Git observation positions", () =>
  Effect.gen(function* () {
    const history = yield* appendExactHistory("CandidateRejected")
    const quarantine = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(InRunJournal, history.journal)
    )
    expect(quarantine.event._tag).toBe("IntegrationQuarantined")
    expect(quarantine.event.basis).toEqual(
      expect.objectContaining({
        _tag: "ConclusiveResult",
        cause: { _tag: "InvalidCandidate", candidateText, observation: { _tag: "Missing", candidateText } },
        evidence: {
          resultRecordedAt: history.resultRecord.position,
          candidateObservationAt: history.observationRecord?.position
        }
      })
    )
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("fails closed for foreign evidence and an ambiguous append", () =>
  Effect.gen(function* () {
    const history = yield* appendExactHistory("NotPrepared")
    const current = yield* history.journal.read(runId)
    const foreignRecords = current.map((record) =>
      record.key === integratorRunResultRecordedRecordKey(history.run)
        ? {
            ...record,
            event: IntegratorRunStartedEvent.make({ run: history.run, version: workflowJournalEventVersion })
          }
        : record
    )
    const foreignJournal = InRunJournal.of({
      append: () => Effect.die("foreign evidence must not append"),
      read: () => Effect.succeed(foreignRecords)
    })
    const contradiction = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(InRunJournal, foreignJournal),
      Effect.flip
    )
    expect(contradiction._tag).toBe("IntegratorJournalContradiction")

    const ambiguousRecords: Array<JournalRecord> = [...current]
    const ambiguousJournal = InRunJournal.of({
      append: (requestedRunId, key, event) => {
        const winner: JournalRecord = {
          event,
          key,
          position: JournalPosition.make(ambiguousRecords.length + 1),
          runId: requestedRunId
        }
        ambiguousRecords.push(winner)
        return Effect.fail(
          new JournalStoreContradiction({ existingPosition: winner.position, key, runId: requestedRunId })
        )
      },
      read: () => Effect.succeed(ambiguousRecords)
    })
    const reconciled = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(InRunJournal, ambiguousJournal)
    )
    expect(reconciled.event._tag).toBe("IntegrationQuarantined")
    expect(reconciled.key).toEqual(integrationQuarantinedRecordKey(history.session.sessionId, reconciled.event.basis))
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("fails closed when the exact fixed-session key is duplicated", () =>
  Effect.gen(function* () {
    const history = yield* appendExactHistory("NotPrepared")
    const current = yield* history.journal.read(runId)
    const fixedSessionKey = integratorSessionFixedRecordKey(
      integratorResponsibilityFactsFromCorrelation(history.session)
    )
    const fixedSession = current.find((record) => record.key === fixedSessionKey)
    if (fixedSession === undefined) return yield* Effect.die("fixture lacks its exact fixed-session record")
    const duplicateRecords = [...current, { ...fixedSession, position: JournalPosition.make(current.length + 1) }]
    const contradiction = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("duplicate fixed-session evidence must not append"),
          read: () => Effect.succeed(duplicateRecords)
        })
      ),
      Effect.flip
    )
    expect(contradiction._tag).toBe("IntegratorJournalContradiction")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects legacy, foreign-key, and malformed modern run evidence", () =>
  Effect.gen(function* () {
    const history = yield* appendExactHistory("NotPrepared")
    const current = yield* history.journal.read(runId)
    const fixedSession = current.find((record) => record.event._tag === "IntegratorSessionFixed")
    const runStart = current.find(
      (record) =>
        record.event._tag === "IntegratorRunStarted" && record.event.run.ordinal === IntegratorRunOrdinal.make(1)
    )
    const runResult = current.find(
      (record) =>
        record.event._tag === "IntegratorRunResultRecorded" && record.event.run.ordinal === IntegratorRunOrdinal.make(1)
    )
    if (fixedSession === undefined || runStart === undefined || runResult === undefined) {
      return yield* Effect.die("fixture lacks its exact modern run evidence")
    }
    const rejectWith = (transform: (records: ReadonlyArray<JournalRecord>) => ReadonlyArray<JournalRecord>) =>
      appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
        Effect.provideService(
          InRunJournal,
          InRunJournal.of({
            append: () => Effect.die("malformed evidence must fail before append"),
            read: () => Effect.succeed(transform(current))
          })
        ),
        Effect.flip
      )

    const foreignFixedKey = yield* rejectWith((records) =>
      records.map((record) =>
        record === fixedSession
          ? { ...record, key: JournalRecordKey.make("initial-conclusive:foreign-fixed-key") }
          : record
      )
    )
    expect(foreignFixedKey._tag).toBe("IntegratorJournalContradiction")

    const duplicateFixedWithForeignEvent = yield* rejectWith((records) => [
      ...records,
      {
        ...fixedSession,
        event: IntegratorSessionFixedEvent.make({
          correlation: IntegratorSessionCorrelation.make({
            ...history.session,
            sessionId: IntegratorSessionId.make("initial-conclusive-foreign-fixed-session")
          }),
          version: workflowJournalEventVersion
        }),
        position: JournalPosition.make(current.length + 1)
      }
    ])
    expect(duplicateFixedWithForeignEvent._tag).toBe("IntegratorJournalContradiction")

    const foreignStartKey = yield* rejectWith((records) =>
      records.map((record) =>
        record === runStart ? { ...record, key: JournalRecordKey.make("initial-conclusive:foreign-start-key") } : record
      )
    )
    expect(foreignStartKey._tag).toBe("IntegratorJournalContradiction")

    const foreignResultKey = yield* rejectWith((records) =>
      records.map((record) =>
        record === runResult
          ? { ...record, key: JournalRecordKey.make("initial-conclusive:foreign-result-key") }
          : record
      )
    )
    expect(foreignResultKey._tag).toBe("IntegratorJournalContradiction")

    const missingResult = yield* rejectWith((records) => records.filter((record) => record !== runResult))
    expect(missingResult._tag).toBe("IntegratorJournalContradiction")

    const wrongResultKind = yield* rejectWith((records) =>
      records.map((record) =>
        record === runResult && record.event._tag === "IntegratorRunResultRecorded"
          ? {
              ...record,
              event: IntegratorRunResultRecordedEvent.make({
                ...record.event,
                result: IntegratorResult.cases.PreparedCandidate.make({ correlation: history.session, candidateText })
              })
            }
          : record
      )
    )
    expect(wrongResultKind._tag).toBe("IntegratorJournalContradiction")

    const ordinalTwo = IntegratorRunProtocolResult.cases.NotPrepared.make({
      detail: notPreparedDetail,
      run: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(2), session: history.session })
    })
    const ordinalFailure = yield* appendInitialConclusiveIntegrationQuarantine(ordinalTwo).pipe(
      Effect.provideService(InRunJournal, history.journal),
      Effect.flip
    )
    expect(ordinalFailure._tag).toBe("IntegratorJournalContradiction")

    const missingStart = yield* rejectWith((records) => records.filter((record) => record !== runStart))
    expect(missingStart._tag).toBe("IntegratorJournalContradiction")

    const fixedBeforeLineage = yield* rejectWith((records) =>
      records.map((record) => (record === fixedSession ? { ...record, position: JournalPosition.make(1) } : record))
    )
    expect(fixedBeforeLineage._tag).toBe("IntegratorJournalContradiction")

    const resultBeforeStart = yield* rejectWith((records) =>
      records.map((record) => (record === runResult ? { ...record, position: runStart.position } : record))
    )
    expect(resultBeforeStart._tag).toBe("IntegratorJournalContradiction")

    const startBeforeFixed = yield* rejectWith((records) =>
      records.map((record) => (record === runStart ? { ...record, position: fixedSession.position } : record))
    )
    expect(startBeforeFixed._tag).toBe("IntegratorJournalContradiction")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("fails closed when an exact candidate evidence key is duplicated", () =>
  Effect.gen(function* () {
    const history = yield* appendExactHistory("CandidateRejected")
    const current = yield* history.journal.read(runId)
    const readIntentKey = integratorRunCandidateGitReadIntendedRecordKey(history.run, candidateText)
    const observationKey = integratorRunCandidateGitObservedRecordKey(history.run, candidateText)
    const readIntent = current.find((record) => record.key === readIntentKey)
    const observation = current.find((record) => record.key === observationKey)
    if (readIntent === undefined || observation === undefined) {
      return yield* Effect.die("fixture lacks its exact candidate read intent or observation")
    }
    const duplicateReadIntent = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("duplicate candidate evidence must not append"),
          read: () =>
            Effect.succeed([...current, { ...readIntent, position: JournalPosition.make(current.length + 1) }])
        })
      ),
      Effect.flip
    )
    expect(duplicateReadIntent._tag).toBe("IntegratorJournalContradiction")

    const duplicateObservation = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("duplicate candidate evidence must not append"),
          read: () =>
            Effect.succeed([...current, { ...observation, position: JournalPosition.make(current.length + 1) }])
        })
      ),
      Effect.flip
    )
    expect(duplicateObservation._tag).toBe("IntegratorJournalContradiction")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a NotPrepared result with candidate evidence and candidate result/key contradictions", () =>
  Effect.gen(function* () {
    const notPreparedHistory = yield* appendExactHistory("NotPrepared")
    const notPreparedRecords = yield* notPreparedHistory.journal.read(runId)
    const notPreparedResult = notPreparedRecords.find((record) => record.event._tag === "IntegratorRunResultRecorded")
    if (notPreparedResult === undefined) return yield* Effect.die("fixture lacks its run result")
    const candidateEvidence: JournalRecord = {
      event: IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText,
        run: notPreparedHistory.run,
        version: workflowJournalEventVersion
      }),
      key: integratorRunCandidateGitReadIntendedRecordKey(notPreparedHistory.run, candidateText),
      position: JournalPosition.make(notPreparedRecords.length + 1),
      runId
    }
    const candidateFailure = yield* appendInitialConclusiveIntegrationQuarantine(notPreparedHistory.result).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("candidate evidence must fail before append"),
          read: () => Effect.succeed([...notPreparedRecords, candidateEvidence])
        })
      ),
      Effect.flip
    )
    expect(candidateFailure._tag).toBe("IntegratorJournalContradiction")

    const wrongResultKind = yield* appendInitialConclusiveIntegrationQuarantine(notPreparedHistory.result).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("wrong result kind must fail before append"),
          read: () =>
            Effect.succeed(
              notPreparedRecords.map((record) =>
                record === notPreparedResult && record.event._tag === "IntegratorRunResultRecorded"
                  ? {
                      ...record,
                      event: IntegratorRunResultRecordedEvent.make({
                        ...record.event,
                        result: IntegratorResult.cases.PreparedCandidate.make({
                          correlation: notPreparedHistory.session,
                          candidateText
                        })
                      })
                    }
                  : record
              )
            )
        })
      ),
      Effect.flip
    )
    expect(wrongResultKind._tag).toBe("IntegratorJournalContradiction")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects CandidateRejected results with foreign candidate names or keys", () =>
  Effect.gen(function* () {
    const history = yield* appendExactHistory("CandidateRejected")
    const records = yield* history.journal.read(runId)
    const readIntent = records.find((record) => record.event._tag === "IntegratorRunCandidateGitReadIntended")
    if (readIntent === undefined) return yield* Effect.die("candidate fixture lacks its exact read intent")
    const foreignCandidate = IntegratorCandidateText.make("refs/heads/initial-conclusive-foreign-candidate")
    const foreignCandidateEvent: JournalRecord = {
      event: IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText: foreignCandidate,
        run: history.run,
        version: workflowJournalEventVersion
      }),
      key: JournalRecordKey.make("initial-conclusive:foreign-candidate"),
      position: JournalPosition.make(records.length + 1),
      runId
    }
    const foreignCandidateFailure = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("foreign candidate must fail before append"),
          read: () => Effect.succeed([...records, foreignCandidateEvent])
        })
      ),
      Effect.flip
    )
    expect(foreignCandidateFailure._tag).toBe("IntegratorJournalContradiction")

    const foreignCandidateKey = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("foreign candidate key must fail before append"),
          read: () =>
            Effect.succeed(
              records.map((record) =>
                record === readIntent
                  ? { ...record, key: JournalRecordKey.make("initial-conclusive:foreign-read-key") }
                  : record
              )
            )
        })
      ),
      Effect.flip
    )
    expect(foreignCandidateKey._tag).toBe("IntegratorJournalContradiction")

    const candidateResult = records.find((record) => record.event._tag === "IntegratorRunResultRecorded")
    const observation = records.find((record) => record.event._tag === "IntegratorRunCandidateGitObserved")
    if (candidateResult === undefined || observation === undefined) {
      return yield* Effect.die("candidate fixture lacks its exact result or observation")
    }
    const wrongResultKind = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("candidate result mismatch must fail before append"),
          read: () =>
            Effect.succeed(
              records.map((record) =>
                record === candidateResult && record.event._tag === "IntegratorRunResultRecorded"
                  ? {
                      ...record,
                      event: IntegratorRunResultRecordedEvent.make({
                        ...record.event,
                        result: IntegratorResult.cases.NotPrepared.make({
                          correlation: history.session,
                          detail: notPreparedDetail
                        })
                      })
                    }
                  : record
              )
            )
        })
      ),
      Effect.flip
    )
    expect(wrongResultKind._tag).toBe("IntegratorJournalContradiction")

    const missingObservation = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("missing observation must fail before append"),
          read: () => Effect.succeed(records.filter((record) => record !== observation))
        })
      ),
      Effect.flip
    )
    expect(missingObservation._tag).toBe("IntegratorJournalContradiction")

    const nonChronological = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("non-chronological candidate evidence must fail before append"),
          read: () =>
            Effect.succeed(
              records.map((record) =>
                record.event._tag === "IntegratorRunCandidateGitReadIntended"
                  ? { ...record, position: observation.position }
                  : record
              )
            )
        })
      ),
      Effect.flip
    )
    expect(nonChronological._tag).toBe("IntegratorJournalContradiction")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("accepts a modern run whose fixed predecessor is a FullRerun successor session", () =>
  Effect.gen(function* () {
    const history = yield* appendExactHistory("NotPrepared")
    const current = yield* history.journal.read(runId)
    const fixed = current.find((record) => record.event._tag === "IntegratorSessionFixed")
    const start = current.find((record) => record.event._tag === "IntegratorRunStarted")
    const result = current.find((record) => record.event._tag === "IntegratorRunResultRecorded")
    if (fixed === undefined || start === undefined || result === undefined) {
      return yield* Effect.die("fixture lacks direct modern evidence")
    }
    const predecessor = IntegratorSessionCorrelation.make({
      ...history.session,
      candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:initial-predecessor"),
      sessionId: IntegratorSessionId.make("initial-conclusive-predecessor"),
      targetLineageObservedAt: JournalPosition.make(1)
    })
    const successor = IntegratorSessionCorrelation.make({
      ...history.session,
      targetLineageObservedAt: JournalPosition.make(5)
    })
    const successorRun = integratorRunCorrelationForSession(successor, IntegratorRunOrdinal.make(1))
    const successorFixedEvent = IntegratorSuccessorSessionFixedEvent.make({
      direction: "FullRerun",
      directionAppliedAt: JournalPosition.make(3),
      predecessor,
      quarantineAt: JournalPosition.make(2),
      successor,
      successorGeneration: firstFullRerunSuccessorGeneration,
      version: workflowJournalEventVersion
    })
    const successorRecords = current.map((record) => {
      if (record === fixed) {
        return {
          ...record,
          event: successorFixedEvent,
          key: integratorSuccessorSessionFixedRecordKey(predecessor, JournalPosition.make(2), JournalPosition.make(3)),
          position: JournalPosition.make(6)
        }
      }
      if (record === start) {
        return {
          ...record,
          event: IntegratorRunStartedEvent.make({ run: successorRun, version: workflowJournalEventVersion }),
          key: integratorRunStartedRecordKey(successorRun),
          position: JournalPosition.make(7)
        }
      }
      if (record === result && record.event._tag === "IntegratorRunResultRecorded") {
        return {
          ...record,
          event: IntegratorRunResultRecordedEvent.make({
            ...record.event,
            result: IntegratorResult.cases.NotPrepared.make({ correlation: successor, detail: notPreparedDetail }),
            run: successorRun
          }),
          key: integratorRunResultRecordedRecordKey(successorRun),
          position: JournalPosition.make(8)
        }
      }
      return record
    })
    const successorResult = IntegratorRunProtocolResult.cases.NotPrepared.make({
      detail: notPreparedDetail,
      run: successorRun
    })
    const quarantine = yield* appendInitialConclusiveIntegrationQuarantine(successorResult).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: (requestedRunId, key, event) => history.journal.append(requestedRunId, key, event),
          read: () => Effect.succeed(successorRecords)
        })
      )
    )
    expect(quarantine.event._tag).toBe("IntegrationQuarantined")
    expect(quarantine.event.correlation.sessionId).toBe(successor.sessionId)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects foreign Q keys/events and ambiguous append winners", () =>
  Effect.gen(function* () {
    const history = yield* appendExactHistory("NotPrepared")
    const first = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(InRunJournal, history.journal)
    )
    const recordsWithQ = yield* history.journal.read(runId)
    const foreignBasis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
      cause: IntegrationQuarantineCause.cases.NotPrepared.make({
        detail: IntegratorNotPreparedDetail.make("a contradictory Q payload")
      }),
      evidence: IntegrationQuarantineResultEvidence.make({ resultRecordedAt: history.resultRecord.position })
    })
    const foreignEvent = IntegrationQuarantinedEvent.make({ ...first.event, basis: foreignBasis })
    const foreignEventRecords = recordsWithQ.map((record) =>
      record === first ? { ...record, event: foreignEvent } : record
    )
    const foreignEventFailure = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("foreign Q event must fail before append"),
          read: () => Effect.succeed(foreignEventRecords)
        })
      ),
      Effect.flip
    )
    expect(foreignEventFailure._tag).toBe("IntegratorJournalContradiction")

    const foreignKeyFailure = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("foreign Q key must fail before append"),
          read: () =>
            Effect.succeed(
              recordsWithQ.map((record) =>
                record === first
                  ? { ...record, key: JournalRecordKey.make("initial-conclusive:foreign-q-key") }
                  : record
              )
            )
        })
      ),
      Effect.flip
    )
    expect(foreignKeyFailure._tag).toBe("IntegratorJournalContradiction")

    const recordsBeforeQ = recordsWithQ.filter((record) => record !== first)
    const foreignWinnerKey = JournalRecordKey.make("initial-conclusive:ambiguous-foreign-q")
    let appendAttempted = false
    const ambiguousJournal = InRunJournal.of({
      append: (requestedRunId: RunId, key: JournalRecordKey, _event: JournalRecord["event"]) => {
        appendAttempted = true
        return Effect.fail(
          new JournalStoreContradiction({
            existingPosition: JournalPosition.make(recordsWithQ.length),
            key,
            runId: requestedRunId
          })
        )
      },
      read: () =>
        Effect.succeed(
          appendAttempted
            ? [
                ...recordsBeforeQ,
                {
                  event: first.event,
                  key: foreignWinnerKey,
                  position: JournalPosition.make(recordsWithQ.length),
                  runId
                }
              ]
            : recordsBeforeQ
        )
    })
    const ambiguousFailure = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(InRunJournal, ambiguousJournal),
      Effect.flip
    )
    expect(ambiguousFailure._tag).toBe("IntegratorJournalContradiction")

    const returnedForeign = InRunJournal.of({
      append: (requestedRunId: RunId, _key: JournalRecordKey, event: JournalRecord["event"]) =>
        Effect.succeed({
          event,
          key: JournalRecordKey.make("initial-conclusive:return-foreign-q"),
          position: JournalPosition.make(recordsWithQ.length),
          runId: requestedRunId
        }),
      read: () => Effect.succeed(recordsBeforeQ)
    })
    const returnedFailure = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(InRunJournal, returnedForeign),
      Effect.flip
    )
    expect(returnedFailure._tag).toBe("IntegratorJournalContradiction")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("fails closed when the exact quarantine key is duplicated", () =>
  Effect.gen(function* () {
    const history = yield* appendExactHistory("NotPrepared")
    yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(InRunJournal, history.journal)
    )
    const current = yield* history.journal.read(runId)
    const quarantine = current.find((record) => record.event._tag === "IntegrationQuarantined")
    if (quarantine === undefined) return yield* Effect.die("fixture lacks its exact quarantine record")
    const duplicateRecords = [...current, { ...quarantine, position: JournalPosition.make(current.length + 1) }]
    const contradiction = yield* appendInitialConclusiveIntegrationQuarantine(history.result).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("duplicate quarantine must not append"),
          read: () => Effect.succeed(duplicateRecords)
        })
      ),
      Effect.flip
    )
    expect(contradiction._tag).toBe("IntegratorJournalContradiction")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
