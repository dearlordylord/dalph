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
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Context, Effect, Layer, Schema } from "effect"
import { expect } from "vitest"
import { acceptedResultFixture } from "../../../../test/support/evidence.js"
import { makeAcceptedIntegrationHistory } from "../../../../test/support/accepted-integration-history.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { OperationId } from "../../identity.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../registry/event.js"
import { makeTargetLineageObservationOperation } from "../../registry/operation.js"
import {
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  integratorRunCandidateGitObservedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  intentRecordKey,
  outcomeRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { journalEvidenceFrom } from "../../../workflow-journal/record-evidence.js"
import {
  InRunJournal,
  JournalStoreContradiction,
  type AppendableWorkflowJournalEvent,
  type JournalRecord
} from "../../../workflow-journal/store.js"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import { liveJournalTestLayer } from "../../../coordination/delivery/live-journal-test-layer.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
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
  integratorRetryRunOrdinal
} from "../integrator/events.js"
import { integratorResponsibilityFactsFromCorrelation } from "../integrator/state.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineDirectionSubject,
  IntegrationQuarantineResultEvidence,
  IntegrationQuarantinedEvent
} from "./events.js"
import { deriveIntegrationQuarantineState } from "./state.js"
import {
  appendRetryConclusiveIntegrationQuarantine,
  retryConclusiveIntegrationQuarantineIssueFromRecords
} from "./retry-conclusive.js"

const runId = RunId.make("retry-conclusive-quarantine-run")
const target = FixtureTarget.make("retry-conclusive-quarantine-target")
const base = GitCommitSha.make("a".repeat(40))
const fixedHead = GitCommitSha.make("b".repeat(40))
const acceptedCommit = GitCommitSha.make("c".repeat(40))
const taskSpecification = makeTaskWorkSpecification({
  body: "Exercise conclusive Retry quarantine.",
  taskId: TaskId.make("retry-conclusive-quarantine-task"),
  title: "Conclusive Retry quarantine"
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("retry-conclusive-quarantine-attempt"),
  baseSha: base,
  branch: TaskBranchRef.make("refs/heads/dalph/retry-conclusive-quarantine"),
  executor: TaskExecutorLocator.make("executor:retry-conclusive-quarantine"),
  runId,
  taskId: taskSpecification.taskId,
  taskRevision: taskSpecification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/retry-conclusive-quarantine")
})
const integrationTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/retry-conclusive-quarantine.git")
})
const acceptedResult = acceptedResultFixture(acceptedCommit)
const candidateText = IntegratorCandidateText.make("refs/heads/retry-conclusive-candidate")
const notPreparedDetail = IntegratorNotPreparedDetail.make("Retry run two returned no candidate")
const candidateObservation = IntegratorGitObservation.cases.Missing.make({ candidateText })

type History = {
  readonly acceptedJournalReader: AcceptedJournalReader["Service"]
  readonly input: IntegratorRunProtocolResult
  readonly journal: InRunJournal["Service"]
  readonly resultRecord: JournalRecord
  readonly candidateObservationRecord?: JournalRecord
  readonly run: IntegratorRunCorrelation
  readonly session: IntegratorSessionCorrelation
}

const appendRecord = Effect.fn("RetryConclusiveTest.appendRecord")(function* (
  journal: InRunJournal["Service"],
  key: JournalRecordKey,
  event: AppendableWorkflowJournalEvent
) {
  return yield* journal.append(runId, key, event)
})

const makeTargetLineage = (operationId: OperationId, targetHeadSha: GitCommitSha) =>
  TargetLineageObservedEvent.make({
    observation: TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: base,
      targetHeadSha
    }),
    occurrenceClassification: "NonActionOccurrence",
    operationId,
    plannedAttempt,
    version: workflowJournalEventVersion
  })

const makeLineageIntent = (operationId: OperationId) =>
  GitReadIntentRecordedEvent.make({
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    operation: makeTargetLineageObservationOperation({
      integrationTarget,
      operationId,
      plannedAttempt,
      predecessorOperationIds: []
    }),
    version: workflowJournalEventVersion
  })

const appendHistory = Effect.fn("RetryConclusiveTest.appendHistory")(function* (
  kind: "NotPrepared" | "CandidateRejected"
) {
  const accepted = makeAcceptedIntegrationHistory({
    acceptedResult,
    activeClaim: ActiveTaskClaim.make({
      operationId: OperationId.make("retry-conclusive-claim"),
      owner: ClaimOwner.make("retry-conclusive-owner"),
      taskId: plannedAttempt.taskId,
      token: ClaimToken.make("retry-conclusive-token")
    }),
    integrationTarget,
    initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
    plannedAttempt,
    runId,
    targetHeadSha: fixedHead,
    taskSpecification,
    trackerTarget: target
  })
  const context = yield* Layer.build(liveJournalTestLayer({ records: accepted.records, runId, target }))
  const journal = Context.get(context, InRunJournal)

  const session = IntegratorSessionCorrelation.make({
    acceptedResult,
    candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:retry-conclusive"),
    expectedTargetHead: fixedHead,
    integrationTarget,
    plannedAttempt,
    queuedAt: accepted.responsibility.queuedAt,
    sessionId: IntegratorSessionId.make("integrator-session:retry-conclusive"),
    startedAt: accepted.responsibility.startedAt,
    targetLineageObservedAt: accepted.targetLineageObservedAt
  })
  yield* appendRecord(
    journal,
    integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(session)),
    IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })
  )

  const runOne = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
  yield* appendRecord(
    journal,
    integratorRunStartedRecordKey(runOne),
    IntegratorRunStartedEvent.make({ run: runOne, version: workflowJournalEventVersion })
  )
  const runOneResult = yield* appendRecord(
    journal,
    integratorRunResultRecordedRecordKey(runOne),
    IntegratorRunResultRecordedEvent.make({
      result: IntegratorResult.cases.NotPrepared.make({ correlation: runOne, detail: notPreparedDetail }),
      run: runOne,
      version: workflowJournalEventVersion
    })
  )
  const q1Basis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
    cause: IntegrationQuarantineCause.cases.NotPrepared.make({ detail: notPreparedDetail }),
    evidence: IntegrationQuarantineResultEvidence.make({ resultRecordedAt: runOneResult.position })
  })
  const q1 = yield* appendRecord(
    journal,
    integrationQuarantinedRecordKey(session.sessionId, q1Basis),
    IntegrationQuarantinedEvent.make({
      basis: q1Basis,
      correlation: session,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
  )
  yield* appendRecord(
    journal,
    integrationQuarantineDirectionAppliedRecordKey(
      IntegrationQuarantineDirectionSubject.make({ quarantineAt: q1.position, sessionId: session.sessionId })
    ),
    IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: IntegrationQuarantineDirectionFingerprint.make({
        direction: "Retry",
        quarantineAt: q1.position,
        sessionId: session.sessionId
      }),
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "retry-conclusive-direction", runId }),
      version: workflowJournalEventVersion
    })
  )

  const freshLineageOperationId = OperationId.make("retry-conclusive-fresh-lineage")
  const directionPosition = q1.position + 1
  yield* appendRecord(journal, intentRecordKey(freshLineageOperationId), makeLineageIntent(freshLineageOperationId))
  const freshLineage = yield* appendRecord(
    journal,
    outcomeRecordKey(freshLineageOperationId),
    makeTargetLineage(freshLineageOperationId, fixedHead)
  )

  const run = IntegratorRunCorrelation.make({ ordinal: integratorRetryRunOrdinal, session })
  const runStart = yield* appendRecord(
    journal,
    integratorRunStartedRecordKey(run),
    IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
  )
  if (runStart.position <= directionPosition || freshLineage.position <= directionPosition) {
    return yield* Effect.die("retry fixture failed to append fresh lineage after Retry direction")
  }

  const input: IntegratorRunProtocolResult =
    kind === "NotPrepared"
      ? IntegratorRunProtocolResult.cases.NotPrepared.make({ detail: notPreparedDetail, run })
      : IntegratorRunProtocolResult.cases.CandidateRejected.make({
          candidateText,
          observation: candidateObservation,
          run
        })
  const resultRecord = yield* appendRecord(
    journal,
    integratorRunResultRecordedRecordKey(run),
    IntegratorRunResultRecordedEvent.make({
      result:
        kind === "NotPrepared"
          ? IntegratorResult.cases.NotPrepared.make({ correlation: run, detail: notPreparedDetail })
          : IntegratorResult.cases.PreparedCandidate.make({ correlation: run, candidateText }),
      run,
      version: workflowJournalEventVersion
    })
  )
  let candidateObservationRecord: JournalRecord | undefined
  if (kind === "CandidateRejected") {
    yield* appendRecord(
      journal,
      integratorRunCandidateGitReadIntendedRecordKey(run, candidateText),
      IntegratorRunCandidateGitReadIntendedEvent.make({ candidateText, run, version: workflowJournalEventVersion })
    )
    candidateObservationRecord = yield* appendRecord(
      journal,
      integratorRunCandidateGitObservedRecordKey(run, candidateText),
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText,
        observation: candidateObservation,
        run,
        version: workflowJournalEventVersion
      })
    )
  }
  return {
    acceptedJournalReader: Context.get(context, AcceptedJournalReader),
    input,
    journal,
    resultRecord,
    run,
    session,
    ...(candidateObservationRecord === undefined ? {} : { candidateObservationRecord })
  } satisfies History
})

const provideHistory =
  (history: History, journal: InRunJournal["Service"] = history.journal) =>
  <A, E, R>(effect: Effect.Effect<A, E, R | AcceptedJournalReader | InRunJournal>) =>
    effect.pipe(
      Effect.provideService(InRunJournal, journal),
      Effect.provideService(AcceptedJournalReader, history.acceptedJournalReader)
    )

const coldIssue = Effect.fn("RetryConclusiveTest.coldIssue")(function* (
  history: History,
  transform: (records: ReadonlyArray<JournalRecord>) => ReadonlyArray<JournalRecord>,
  input: IntegratorRunProtocolResult = history.input
) {
  if (input._tag === "PreparedCandidate") return "Retry conclusive quarantine accepts only conclusive results"
  return retryConclusiveIntegrationQuarantineIssueFromRecords(transform(yield* history.journal.read(runId)), input)
})

it.effect("records a fresh quarantine after the authorized Retry run ends conclusively", () =>
  Effect.gen(function* () {
    const history = yield* appendHistory("NotPrepared")
    const first = yield* appendRetryConclusiveIntegrationQuarantine(history.input).pipe(provideHistory(history))
    const second = yield* appendRetryConclusiveIntegrationQuarantine(history.input).pipe(provideHistory(history))

    expect(second).toEqual(first)
    expect(first.event.basis).toEqual({
      _tag: "ConclusiveResult",
      cause: { _tag: "NotPrepared", detail: notPreparedDetail },
      evidence: { resultRecordedAt: history.resultRecord.position }
    })
    expect(first.key).toEqual(integrationQuarantinedRecordKey(history.session.sessionId, first.event.basis))
    const records = yield* history.journal.read(runId)
    expect(records.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(2)
    expect(
      records.filter(({ event }) => event._tag === "IntegratorRunStarted" && Number(event.run.ordinal) > 2)
    ).toHaveLength(0)
  })
)

it.effect("records Q2 CandidateRejected only with the exact run-two Git evidence", () =>
  Effect.gen(function* () {
    const history = yield* appendHistory("CandidateRejected")
    const quarantine = yield* appendRetryConclusiveIntegrationQuarantine(history.input).pipe(provideHistory(history))
    const candidateObservationRecord = history.candidateObservationRecord
    if (candidateObservationRecord === undefined) {
      return yield* Effect.die("candidate rejection lacks its observation record")
    }

    expect(quarantine.event.basis).toEqual({
      _tag: "ConclusiveResult",
      cause: { _tag: "InvalidCandidate", candidateText, observation: candidateObservation },
      evidence: {
        resultRecordedAt: history.resultRecord.position,
        candidateObservationAt: history.candidateObservationRecord?.position
      }
    })
    if (quarantine.event.basis._tag !== "ConclusiveResult")
      return yield* Effect.die("candidate Q2 lacks conclusive basis")
    expect(quarantine.event.basis.evidence.candidateObservationAt).toBe(candidateObservationRecord.position)

    const records = yield* history.journal.read(runId)
    const reconstructed = deriveIntegrationQuarantineState(records, history.session.sessionId)
    expect(reconstructed._tag).toBe("Quarantined")
    expect(deriveIntegrationQuarantineState(journalEvidenceFrom(records), history.session.sessionId)).toEqual(
      reconstructed
    )

    const foreignCandidateKey = records.map((record) =>
      record.position === candidateObservationRecord.position
        ? { ...record, key: JournalRecordKey.make("retry-conclusive:foreign-candidate-observation-key") }
        : record
    )
    expect(deriveIntegrationQuarantineState(foreignCandidateKey, history.session.sessionId)._tag).toBe("Contradiction")

    const nonCandidateAtObservation = records.map((record) =>
      record.position === candidateObservationRecord.position
        ? {
            ...record,
            event: IntegratorRunStartedEvent.make({ run: history.run, version: workflowJournalEventVersion })
          }
        : record
    )
    const nonCandidateRecord = nonCandidateAtObservation.find(
      (record) => record.position === candidateObservationRecord.position
    )
    if (nonCandidateRecord?.event._tag !== "IntegratorRunStarted") {
      return yield* Effect.die("candidate observation replacement did not take effect")
    }
    expect(deriveIntegrationQuarantineState(nonCandidateAtObservation, history.session.sessionId)._tag).toBe(
      "Contradiction"
    )

    const resultAfterRunStart = records.map((record) =>
      record.event._tag === "IntegratorRunStarted" && record.event.run.ordinal === integratorRetryRunOrdinal
        ? { ...record, position: JournalPosition.make(history.resultRecord.position + 1) }
        : record
    )
    expect(deriveIntegrationQuarantineState(resultAfterRunStart, history.session.sessionId)._tag).toBe("Contradiction")
  })
)

it.effect("reconstructs Q2 only when Retry chronology is authorized and tolerates unrelated run records", () =>
  Effect.gen(function* () {
    const history = yield* appendHistory("NotPrepared")
    const q2 = yield* appendRetryConclusiveIntegrationQuarantine(history.input).pipe(provideHistory(history))
    const unrelatedAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("retry-conclusive-unrelated-attempt"),
      branch: TaskBranchRef.make("refs/heads/dalph/retry-conclusive-unrelated"),
      executor: TaskExecutorLocator.make("executor:retry-conclusive-unrelated"),
      taskId: TaskId.make("retry-conclusive-unrelated-task"),
      taskRevision: TaskRevision.make("retry-conclusive-unrelated-revision"),
      worktree: WorktreeLocator.make("/worktrees/retry-conclusive-unrelated")
    })
    const unrelatedSession = IntegratorSessionCorrelation.make({
      ...history.session,
      candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:retry-conclusive-unrelated"),
      plannedAttempt: unrelatedAttempt,
      queuedAt: JournalPosition.make(q2.position + 1),
      sessionId: IntegratorSessionId.make("integrator-session:retry-conclusive-unrelated"),
      startedAt: JournalPosition.make(q2.position + 2)
    })
    const unrelatedRun = IntegratorRunCorrelation.make({
      ordinal: IntegratorRunOrdinal.make(1),
      session: unrelatedSession
    })
    const liveRecords = yield* history.journal.read(runId)
    const records: ReadonlyArray<JournalRecord> = [
      ...liveRecords,
      {
        event: IntegratorSessionFixedEvent.make({
          correlation: unrelatedSession,
          version: workflowJournalEventVersion
        }),
        key: integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(unrelatedSession)),
        position: JournalPosition.make(liveRecords.length + 1),
        runId
      },
      {
        event: IntegratorRunStartedEvent.make({ run: unrelatedRun, version: workflowJournalEventVersion }),
        key: integratorRunStartedRecordKey(unrelatedRun),
        position: JournalPosition.make(liveRecords.length + 2),
        runId
      }
    ]
    const reconstructed = deriveIntegrationQuarantineState(records, history.session.sessionId)
    expect(reconstructed._tag).toBe("Quarantined")
    if (reconstructed._tag !== "Quarantined") return
    expect(reconstructed.quarantineAt).toBe(q2.position)
    expect(reconstructed.quarantine.basis._tag).toBe("ConclusiveResult")

    const withoutRetryDirection = records.filter(({ event }) => event._tag !== "IntegrationQuarantineDirectionApplied")
    expect(deriveIntegrationQuarantineState(withoutRetryDirection, history.session.sessionId)._tag).toBe(
      "Contradiction"
    )

    const freshLineageRecords = records.filter(
      ({ event }) =>
        !(
          (event._tag === "GitReadIntentRecorded" &&
            event.operation.operationId === OperationId.make("retry-conclusive-fresh-lineage")) ||
          (event._tag === "TargetLineageObserved" &&
            event.operationId === OperationId.make("retry-conclusive-fresh-lineage"))
        )
    )
    const runStart = freshLineageRecords.find(
      ({ event }) => event._tag === "IntegratorRunStarted" && event.run.ordinal === integratorRetryRunOrdinal
    )
    if (runStart === undefined) return yield* Effect.die("retry fixture lacks run-two start")
    const shifted = freshLineageRecords.map((record) =>
      record.position >= history.resultRecord.position
        ? { ...record, position: JournalPosition.make(record.position + 2) }
        : record
    )
    const originalFreshIntent = records.find(
      ({ event }) =>
        event._tag === "GitReadIntentRecorded" &&
        event.operation.operationId === OperationId.make("retry-conclusive-fresh-lineage")
    )
    const originalFreshObservation = records.find(
      ({ event }) =>
        event._tag === "TargetLineageObserved" &&
        event.operationId === OperationId.make("retry-conclusive-fresh-lineage")
    )
    if (
      originalFreshIntent?.event._tag !== "GitReadIntentRecorded" ||
      originalFreshObservation?.event._tag !== "TargetLineageObserved"
    ) {
      return yield* Effect.die("retry fixture lacks fresh lineage pair")
    }
    const lineageAfterRunStart = [
      ...shifted,
      { ...originalFreshIntent, position: JournalPosition.make(runStart.position + 1) },
      { ...originalFreshObservation, position: JournalPosition.make(runStart.position + 2) }
    ]
    expect(deriveIntegrationQuarantineState(lineageAfterRunStart, history.session.sessionId)._tag).toBe("Contradiction")
  })
)

it.effect("requires Q1, the winning Retry direction, fresh lineage, and exact run-two chronology", () =>
  Effect.gen(function* () {
    const history = yield* appendHistory("NotPrepared")
    const records = yield* history.journal.read(runId)
    const requiredTags = [
      "IntegrationQuarantined",
      "IntegrationQuarantineDirectionApplied",
      "TargetLineageObserved",
      "IntegratorRunStarted",
      "IntegratorRunResultRecorded"
    ] as const
    for (const tag of requiredTags) {
      const failure = yield* coldIssue(history, (records) => records.filter((record) => record.event._tag !== tag))
      expect(failure).toBeDefined()
    }
    const ordinalOne = IntegratorRunProtocolResult.cases.NotPrepared.make({
      detail: notPreparedDetail,
      run: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: history.session })
    })
    const ordinalFailure = yield* coldIssue(history, (records) => records, ordinalOne)
    expect(ordinalFailure).toBeDefined()
    expect(records.some(({ event }) => event._tag === "IntegratorRunStarted" && event.run.ordinal === 2)).toBe(true)
  })
)

it.effect("rejects a Retry run-two candidate with missing, foreign, or valid Git evidence", () =>
  Effect.gen(function* () {
    const history = yield* appendHistory("CandidateRejected")
    const missingObservation = yield* coldIssue(history, (records) =>
      records.filter(
        (record) =>
          !(
            record.event._tag === "IntegratorRunCandidateGitObserved" &&
            record.event.run.ordinal === integratorRetryRunOrdinal
          )
      )
    )
    expect(missingObservation).toBeDefined()

    const foreignObservation = yield* coldIssue(history, (records) =>
      records.map((record) =>
        record.event._tag === "IntegratorRunCandidateGitObserved" &&
        record.event.run.ordinal === integratorRetryRunOrdinal
          ? { ...record, key: JournalRecordKey.make("retry-conclusive:foreign-candidate-observation") }
          : record
      )
    )
    expect(foreignObservation).toBeDefined()

    const validParents = IntegratorGitObservation.cases.Commit.make({
      candidateText,
      commit: GitCommitSha.make("d".repeat(40)),
      directParents: [fixedHead, acceptedCommit]
    })
    const validInput = IntegratorRunProtocolResult.cases.CandidateRejected.make({
      candidateText,
      observation: validParents,
      run: history.run
    })
    const validFailure = yield* coldIssue(history, (records) => records, validInput)
    expect(validFailure).toBeDefined()
  })
)

it.effect("rejects duplicate, foreign, and missing exact Retry run evidence", () =>
  Effect.gen(function* () {
    const history = yield* appendHistory("NotPrepared")
    const records = yield* history.journal.read(runId)
    const runStart = records.find(
      (record) => record.event._tag === "IntegratorRunStarted" && record.event.run.ordinal === integratorRetryRunOrdinal
    )
    const runResult = records.find(
      (record) =>
        record.event._tag === "IntegratorRunResultRecorded" && record.event.run.ordinal === integratorRetryRunOrdinal
    )
    if (runStart === undefined || runResult === undefined) return yield* Effect.die("retry fixture lacks run evidence")

    const rejectWith = (transform: (current: ReadonlyArray<JournalRecord>) => ReadonlyArray<JournalRecord>) =>
      coldIssue(history, transform)

    const duplicateStart = yield* rejectWith((current) => [
      ...current,
      { ...runStart, position: JournalPosition.make(runStart.position + 1) }
    ])
    expect(duplicateStart).toBeDefined()

    const foreignStart = yield* rejectWith((current) =>
      current.map((record) =>
        record === runStart ? { ...record, runId: RunId.make("retry-conclusive-foreign-run") } : record
      )
    )
    expect(foreignStart).toBeDefined()

    const wronglyKeyedStart = yield* rejectWith((current) =>
      current.map((record) =>
        record === runStart ? { ...record, key: JournalRecordKey.make("retry-conclusive:foreign-start-key") } : record
      )
    )
    expect(wronglyKeyedStart).toBeDefined()

    const duplicateResult = yield* rejectWith((current) => [
      ...current,
      { ...runResult, position: JournalPosition.make(runResult.position + 1) }
    ])
    expect(duplicateResult).toBeDefined()

    const foreignResult = yield* rejectWith((current) =>
      current.map((record) =>
        record === runResult ? { ...record, runId: RunId.make("retry-conclusive-foreign-result-run") } : record
      )
    )
    expect(foreignResult).toBeDefined()

    const foreignResultCorrelation = yield* rejectWith((current) =>
      current.map((record) =>
        record === runResult && record.event._tag === "IntegratorRunResultRecorded"
          ? {
              ...record,
              event: IntegratorRunResultRecordedEvent.make({
                ...record.event,
                result: IntegratorResult.cases.NotPrepared.make({
                  correlation: IntegratorRunCorrelation.make({
                    ordinal: record.event.run.ordinal,
                    session: IntegratorSessionCorrelation.make({
                      ...history.session,
                      sessionId: IntegratorSessionId.make("retry-conclusive-foreign-result-session")
                    })
                  }),
                  detail: notPreparedDetail
                })
              })
            }
          : record
      )
    )
    expect(foreignResultCorrelation).toBeDefined()

    const wronglyKeyedResult = yield* rejectWith((current) =>
      current.map((record) =>
        record === runResult ? { ...record, key: JournalRecordKey.make("retry-conclusive:foreign-result-key") } : record
      )
    )
    expect(wronglyKeyedResult).toBeDefined()

    const missingResult = yield* coldIssue(history, (records) =>
      records.filter(
        (record) =>
          !(
            record.event._tag === "IntegratorRunResultRecorded" &&
            record.event.run.ordinal === integratorRetryRunOrdinal
          )
      )
    )
    expect(missingResult).toBeDefined()

    const contradictoryResult = yield* rejectWith((current) =>
      current.map((record) =>
        record === runResult && record.event._tag === "IntegratorRunResultRecorded"
          ? {
              ...record,
              event: IntegratorRunResultRecordedEvent.make({
                ...record.event,
                result: IntegratorResult.cases.NotPrepared.make({
                  correlation: history.run,
                  detail: IntegratorNotPreparedDetail.make("a different durable result")
                })
              })
            }
          : record
      )
    )
    expect(contradictoryResult).toBeDefined()
  })
)

it.effect("rejects candidate evidence with foreign names, keys, or duplicate exact records", () =>
  Effect.gen(function* () {
    const history = yield* appendHistory("CandidateRejected")
    const records = yield* history.journal.read(runId)
    const readIntent = records.find(
      (record) => record.event._tag === "IntegratorRunCandidateGitReadIntended" && record.event.run.ordinal === 2
    )
    const observation = records.find(
      (record) => record.event._tag === "IntegratorRunCandidateGitObserved" && record.event.run.ordinal === 2
    )
    if (readIntent === undefined || observation === undefined)
      return yield* Effect.die("retry fixture lacks candidate evidence")

    const rejectWith = (transform: (current: ReadonlyArray<JournalRecord>) => ReadonlyArray<JournalRecord>) =>
      coldIssue(history, transform)

    const duplicateRead = yield* rejectWith((current) => [
      ...current,
      { ...readIntent, position: JournalPosition.make(readIntent.position + 1) }
    ])
    expect(duplicateRead).toBeDefined()

    const duplicateObservation = yield* rejectWith((current) => [
      ...current,
      { ...observation, position: JournalPosition.make(observation.position + 1) }
    ])
    expect(duplicateObservation).toBeDefined()

    const wronglyKeyedRead = yield* rejectWith((current) =>
      current.map((record) =>
        record === readIntent ? { ...record, key: JournalRecordKey.make("retry-conclusive:foreign-read-key") } : record
      )
    )
    expect(wronglyKeyedRead).toBeDefined()

    const foreignCandidate = IntegratorCandidateText.make("refs/heads/retry-conclusive-foreign-candidate")
    const foreignCandidateFailure = yield* coldIssue(history, (current) => [
      ...current,
      {
        event: IntegratorRunCandidateGitReadIntendedEvent.make({
          candidateText: foreignCandidate,
          run: history.run,
          version: workflowJournalEventVersion
        }),
        key: integratorRunCandidateGitReadIntendedRecordKey(history.run, foreignCandidate),
        position: JournalPosition.make(current.length + 1),
        runId
      }
    ])
    expect(foreignCandidateFailure).toBeDefined()
  })
)

it.effect("rejects PreparedCandidate input and a changed fresh Retry target head", () =>
  Effect.gen(function* () {
    const history = yield* appendHistory("NotPrepared")
    const prepared = IntegratorRunProtocolResult.cases.PreparedCandidate.make({
      candidateCommit: acceptedCommit,
      candidateText,
      observation: { directParents: [fixedHead, acceptedCommit] },
      run: history.run
    })
    const preparedFailure = yield* appendRetryConclusiveIntegrationQuarantine(prepared).pipe(
      provideHistory(history),
      Effect.flip
    )
    expect(preparedFailure._tag).toBe("IntegratorJournalContradiction")

    const changedFreshHead = yield* coldIssue(history, (records) =>
      records.map((record) =>
        record.event._tag === "TargetLineageObserved" &&
        record.event.operationId === OperationId.make("retry-conclusive-fresh-lineage")
          ? {
              ...record,
              event: TargetLineageObservedEvent.make({
                ...record.event,
                observation: TargetLineageObservation.make({ ...record.event.observation, targetHeadSha: base })
              })
            }
          : record
      )
    )
    expect(changedFreshHead).toBeDefined()
  })
)

it.effect("rejects NotPrepared when run-two candidate evidence was also recorded", () =>
  Effect.gen(function* () {
    const history = yield* appendHistory("NotPrepared")
    const failure = yield* coldIssue(history, (records) => [
      ...records,
      {
        event: IntegratorRunCandidateGitReadIntendedEvent.make({
          candidateText,
          run: history.run,
          version: workflowJournalEventVersion
        }),
        key: integratorRunCandidateGitReadIntendedRecordKey(history.run, candidateText),
        position: JournalPosition.make(records.length + 1),
        runId
      }
    ])
    expect(failure).toBeDefined()
  })
)

it.effect("fails closed when an ambiguous or successful Q2 append returns a foreign Journal winner", () =>
  Effect.gen(function* () {
    const history = yield* appendHistory("NotPrepared")
    const expected = yield* appendRetryConclusiveIntegrationQuarantine(history.input).pipe(provideHistory(history))
    const records = yield* history.journal.read(runId)
    const foreignKey = JournalRecordKey.make("retry-conclusive:foreign-q2-key")
    const foreignWinner: JournalRecord = { ...expected, key: foreignKey }
    expect(
      retryConclusiveIntegrationQuarantineIssueFromRecords(
        records.map((record) => (record === expected ? foreignWinner : record)),
        history.input
      )
    ).toBeDefined()

    const ambiguousHistory = yield* appendHistory("NotPrepared")
    const ambiguousFailureJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key) =>
        Effect.fail(
          new JournalStoreContradiction({ existingPosition: JournalPosition.make(50_000), key, runId: requestedRunId })
        ),
      read: () => Effect.die("live Retry quarantine recovery must use accepted indexed evidence")
    }
    const ambiguousFailure = yield* appendRetryConclusiveIntegrationQuarantine(ambiguousHistory.input).pipe(
      provideHistory(ambiguousHistory, ambiguousFailureJournal),
      Effect.flip
    )
    expect(ambiguousFailure._tag).toBe("IntegratorJournalContradiction")

    const returnedHistory = yield* appendHistory("NotPrepared")
    const returnedForeignJournal: InRunJournal["Service"] = {
      append: (requestedRunId) => Effect.succeed({ ...expected, key: foreignKey, runId: requestedRunId }),
      read: () => Effect.die("live Retry quarantine recovery must use accepted indexed evidence")
    }
    const returnedForeign = yield* appendRetryConclusiveIntegrationQuarantine(returnedHistory.input).pipe(
      provideHistory(returnedHistory, returnedForeignJournal),
      Effect.flip
    )
    expect(returnedForeign._tag).toBe("IntegratorJournalContradiction")
  })
)

it.effect("reconciles an ambiguous Q2 append to the Journal winner", () =>
  Effect.gen(function* () {
    const history = yield* appendHistory("NotPrepared")
    const ambiguousJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key, event) =>
        Effect.gen(function* () {
          const winner = yield* history.journal.append(requestedRunId, key, event)
          return yield* new JournalStoreContradiction({ existingPosition: winner.position, key, runId: requestedRunId })
        }),
      read: () => Effect.die("live Retry quarantine recovery must use accepted indexed evidence")
    }
    const reconciled = yield* appendRetryConclusiveIntegrationQuarantine(history.input).pipe(
      provideHistory(history, ambiguousJournal)
    )
    expect(reconciled.key).toEqual(integrationQuarantinedRecordKey(history.session.sessionId, reconciled.event.basis))
  })
)

it.effect("strictly rejects excess input fields before any Q2 append", () =>
  Effect.gen(function* () {
    const history = yield* appendHistory("NotPrepared")
    const malformed = { ...history.input, unexpected: true }
    const failure = yield* appendRetryConclusiveIntegrationQuarantine(malformed).pipe(
      provideHistory(history),
      Effect.flip
    )
    expect(failure).toBeInstanceOf(Schema.SchemaError)
  })
)
