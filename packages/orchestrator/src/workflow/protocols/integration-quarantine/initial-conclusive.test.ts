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
import { legacyMemoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { deriveIntegrationQuarantineState } from "./state.js"
import { appendInitialConclusiveIntegrationQuarantine } from "./initial-conclusive.js"
import {
  IntegratorCandidateText,
  IntegratorCandidateResourceLocator,
  IntegratorCorrelation,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunOrdinal,
  IntegratorRunProtocolResult,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionId
} from "../integrator/events.js"
import { integratorResponsibilityFactsFromCorrelation } from "../integrator/state.js"
import { integratorRunCorrelationForSession } from "../integrator/session.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"

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
  const session = IntegratorCorrelation.make({
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

it.effect("records one idempotent Q for exact modern run-1 NotPrepared evidence", () =>
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
    expect(quarantine.event.basis).toEqual(
      expect.objectContaining({
        _tag: "ConclusiveResult",
        cause: { _tag: "NotPrepared", detail: notPreparedDetail },
        evidence: { resultRecordedAt: history.resultRecord.position }
      })
    )
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
)
