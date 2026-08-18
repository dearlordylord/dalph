import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Ref, Schema } from "effect"
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
  integrationQuarantineDirectionAppliedRecordKey,
  integrationProviderRunActivityAbsentRecordKey,
  integrationQuarantinedRecordKey,
  integratorResultRecordedRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantinedEvent,
  IntegrationProviderRunActivityAbsentEvent,
  IntegrationQuarantineFailureDetail,
  integrationQuarantineDirectionSubject
} from "../integration-quarantine/events.js"
import { appendInitialConclusiveIntegrationQuarantine } from "../integration-quarantine/initial-conclusive.js"
import {
  Integrator,
  IntegratorCallFailure,
  IntegratorGit,
  IntegratorGitReadFailure,
  IntegratorJournalContradiction,
  IntegratorTargetHeadChanged,
  IntegratorTargetLineageIncompatible,
  IntegratorTargetLineageObservationChanged,
  IntegratorPreparationInput,
  deriveIntegratorRunState,
  prepareIntegrationCandidate,
  prepareIntegrationCandidateRun,
  type IntegratorRequest
} from "./protocol.js"
import {
  appendIntegratorSessionIfNeeded,
  hasMatchingIntegratorTargetLineageObservation,
  integratorCorrelationFor,
  integratorInitialRunCorrelationFor,
  integratorRunCorrelationForSession,
  readRecordedIntegratorSession
} from "./session.js"
import { deriveCurrentIntegratorState, integratorRunQualifiedCandidateFromState } from "./state.js"
import {
  evaluateIntegratorRetryAuthorization,
  integratorRetryAuthorizationIssue,
  integratorRunTwoAuthorizationIssue
} from "./retry-authorization.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorRunQualifiedCandidate,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorNotPreparedDetail,
  IntegratorResultRecordedEvent,
  IntegratorCorrelation,
  type IntegratorProtocolResult,
  type IntegratorRunProtocolResult,
  IntegratorResult
} from "./events.js"

const sha = (value: string): GitCommitSha => GitCommitSha.make(value.repeat(40))

const runId = RunId.make("run-222")
const attemptId = AttemptId.make("attempt-222")
const target = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/integrator-222.git")
})
const base = sha("a")
const targetHead = sha("b")
const changedTargetHead = sha("e")
const acceptedResultCommit = sha("c")
const canonicalCandidateCommit = sha("d")
const targetLineageObservedAt = JournalPosition.make(7)
const changedTargetLineageObservedAt = JournalPosition.make(6)
const candidateText = IntegratorCandidateText.make("M-reported-by-integrator")
const notPreparedDetail = IntegratorNotPreparedDetail.make("integrator reached a conclusive non-prepared outcome")

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId,
  baseSha: base,
  branch: TaskBranchRef.make("refs/heads/dalph/integrator-222"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId,
  taskId: TaskId.make("task-222"),
  taskRevision: TaskRevision.make("revision-222"),
  worktree: WorktreeLocator.make("/worktrees/integrator-222")
})

const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult: acceptedResultFixture(acceptedResultCommit),
  integrationTarget: target,
  plannedAttempt,
  queuedAt: JournalPosition.make(8),
  startedAt: JournalPosition.make(9)
})

const compatibleInput = (
  targetHeadSha = targetHead,
  targetLineageAt = targetLineageObservedAt
): IntegratorPreparationInput =>
  IntegratorPreparationInput.make({
    responsibility,
    targetLineage: TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: base,
      targetHeadSha
    }),
    targetLineageObservedAt: targetLineageAt
  })

const incompatibleInput = (): IntegratorPreparationInput =>
  IntegratorPreparationInput.make({
    responsibility,
    targetLineage: TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: false,
      plannedBaseSha: base,
      targetHeadSha: targetHead
    }),
    targetLineageObservedAt
  })

const initialRunState = (records: ReadonlyArray<JournalRecord>, input: IntegratorPreparationInput) =>
  deriveIntegratorRunState(records, responsibility, integratorInitialRunCorrelationFor(input))

const prepared = (request: IntegratorRequest): IntegratorResult =>
  IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: request.correlation })

const notPrepared = (request: IntegratorRequest): IntegratorResult =>
  IntegratorResult.cases.NotPrepared.make({ correlation: request.correlation, detail: notPreparedDetail })

const commitObservation = (parents: ReadonlyArray<GitCommitSha>): IntegratorGitObservation =>
  IntegratorGitObservation.cases.Commit.make({
    candidateText,
    commit: canonicalCandidateCommit,
    directParents: parents
  })

type GitBehavior = (
  target: IntegrationTarget,
  candidate: IntegratorCandidateText
) => Effect.Effect<IntegratorGitObservation, IntegratorGitReadFailure>

const successfulGitRead =
  (observation: IntegratorGitObservation): GitBehavior =>
  () =>
    Effect.succeed(observation)

// eslint-disable-next-line functional/no-mixed-types -- Controlled harness groups durable state with its effectful test boundary.
interface Harness {
  readonly integratorCalls: Ref.Ref<ReadonlyArray<IntegratorRequest>>
  readonly gitCalls: Ref.Ref<number>
  readonly gitCandidates: Ref.Ref<ReadonlyArray<IntegratorCandidateText>>
  readonly records: Ref.Ref<ReadonlyArray<JournalRecord>>
  readonly journal: InRunJournal["Service"]
  readonly run: (input: IntegratorPreparationInput) => Effect.Effect<IntegratorProtocolResult, unknown>
  readonly runExact: (
    input: IntegratorPreparationInput,
    ordinal: IntegratorRunOrdinal,
    session?: IntegratorCorrelation
  ) => Effect.Effect<IntegratorRunProtocolResult, unknown>
  readonly readRecords: Effect.Effect<ReadonlyArray<JournalRecord>>
}

const makeHarness = (
  integratorResult: (request: IntegratorRequest) => Effect.Effect<IntegratorResult, IntegratorCallFailure>,
  gitBehavior: GitBehavior,
  appendWinner?: (event: JournalRecord["event"]) => JournalRecord["event"]
): Effect.Effect<Harness> =>
  Effect.gen(function* () {
    const integratorCalls = yield* Ref.make<ReadonlyArray<IntegratorRequest>>([])
    const gitCalls = yield* Ref.make(0)
    const gitCandidates = yield* Ref.make<ReadonlyArray<IntegratorCandidateText>>([])
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      {
        event: GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: makeTargetLineageObservationOperation({
            integrationTarget: target,
            operationId: OperationId.make("operation-target-lineage-222"),
            plannedAttempt,
            predecessorOperationIds: []
          }),
          version: workflowJournalEventVersion
        }),
        key: JournalRecordKey.make("target-lineage:integrator-222:intent"),
        position: JournalPosition.make(5),
        runId
      },
      {
        event: TargetLineageObservedEvent.make({
          observation: TargetLineageObservation.make({
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: base,
            targetHeadSha: targetHead
          }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: OperationId.make("operation-target-lineage-222"),
          plannedAttempt,
          version: workflowJournalEventVersion
        }),
        key: JournalRecordKey.make("target-lineage:integrator-222"),
        position: targetLineageObservedAt,
        runId
      }
    ])

    const journal = InRunJournal.of({
      append: (requestedRunId, key, event) =>
        Ref.modify(records, (current) => {
          const existing = current.find((record) => record.key === key)
          if (existing !== undefined) return [Effect.succeed(existing), current] as const
          const record: JournalRecord = {
            event: appendWinner?.(event) ?? event,
            key,
            position: JournalPosition.make(current.length + 10),
            runId: requestedRunId
          }
          return [Effect.succeed(record), [...current, record]] as const
        }).pipe(Effect.flatMap((result) => result)),
      read: (requestedRunId) =>
        Ref.get(records).pipe(Effect.map((current) => current.filter(({ runId: id }) => id === requestedRunId)))
    })

    const integrator = Integrator.of({
      prepare: (request) =>
        Ref.update(integratorCalls, (calls) => [...calls, request]).pipe(Effect.andThen(integratorResult(request)))
    })
    const git = IntegratorGit.of({
      readCandidate: (requestedTarget, requestedCandidate) =>
        Ref.update(gitCalls, (count) => count + 1).pipe(
          Effect.andThen(Ref.update(gitCandidates, (candidates) => [...candidates, requestedCandidate])),
          Effect.andThen(gitBehavior(requestedTarget, requestedCandidate))
        )
    })
    const run = (input: IntegratorPreparationInput) =>
      prepareIntegrationCandidate(input).pipe(
        Effect.provideService(Integrator, integrator),
        Effect.provideService(IntegratorGit, git),
        Effect.provideService(InRunJournal, journal)
      )
    const runExact = (
      input: IntegratorPreparationInput,
      ordinal: IntegratorRunOrdinal,
      session = integratorCorrelationFor(input)
    ) =>
      prepareIntegrationCandidateRun({
        preparation: input,
        run: integratorRunCorrelationForSession(session, ordinal)
      }).pipe(
        Effect.provideService(Integrator, integrator),
        Effect.provideService(IntegratorGit, git),
        Effect.provideService(InRunJournal, journal)
      )

    return { integratorCalls, gitCalls, gitCandidates, journal, records, readRecords: Ref.get(records), run, runExact }
  })

const appendRetryAuthorization = Effect.fn("IntegratorProtocolTest.appendRetryAuthorization")(function* (
  harness: Harness,
  freshHead: GitCommitSha = targetHead,
  evidence: "ConclusiveResult" | "ProviderRunFailure" = "ConclusiveResult"
) {
  const records = yield* harness.readRecords
  const sessionRecord = records.find(({ event }) => event._tag === "IntegratorSessionFixed")
  if (sessionRecord?.event._tag !== "IntegratorSessionFixed") return yield* Effect.die("expected fixed session")
  const session = sessionRecord.event.correlation
  let basis: IntegrationQuarantineBasis
  if (evidence === "ConclusiveResult") {
    const resultRecord = records.find(({ event }) => event._tag === "IntegratorRunResultRecorded")
    if (resultRecord?.event._tag !== "IntegratorRunResultRecorded") {
      return yield* Effect.die("expected ordinal-one result")
    }
    basis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
      cause: IntegrationQuarantineCause.cases.NotPrepared.make({ detail: notPreparedDetail }),
      evidence: { resultRecordedAt: resultRecord.position }
    })
  } else {
    const detail = IntegrationQuarantineFailureDetail.make("provider reports no owned activity for run one")
    const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
    const absence = yield* harness.journal.append(
      runId,
      integrationProviderRunActivityAbsentRecordKey(run),
      IntegrationProviderRunActivityAbsentEvent.make({
        correlation: session,
        detail,
        occurrenceClassification: "NonActionOccurrence",
        run,
        version: workflowJournalEventVersion
      })
    )
    basis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail,
      ownedActivityProvenAbsentAt: absence.position
    })
  }
  const quarantine = yield* harness.journal.append(
    runId,
    integrationQuarantinedRecordKey(session.sessionId, basis),
    IntegrationQuarantinedEvent.make({
      basis,
      correlation: session,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
  )
  const direction = yield* harness.journal.append(
    runId,
    integrationQuarantineDirectionAppliedRecordKey(
      integrationQuarantineDirectionSubject(
        IntegrationQuarantineDirectionFingerprint.make({
          direction: "Retry",
          quarantineAt: quarantine.position,
          sessionId: session.sessionId
        })
      )
    ),
    IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: IntegrationQuarantineDirectionFingerprint.make({
        direction: "Retry",
        quarantineAt: quarantine.position,
        sessionId: session.sessionId
      }),
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "integrator-retry", runId }),
      version: workflowJournalEventVersion
    })
  )
  const operationId = OperationId.make("operation-target-lineage-retry")
  const intent = yield* harness.journal.append(
    runId,
    JournalRecordKey.make("integrator-retry:lineage-intent"),
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: makeTargetLineageObservationOperation({
        integrationTarget: target,
        operationId,
        plannedAttempt,
        predecessorOperationIds: []
      }),
      version: workflowJournalEventVersion
    })
  )
  const observation = yield* harness.journal.append(
    runId,
    JournalRecordKey.make("integrator-retry:lineage-observation"),
    TargetLineageObservedEvent.make({
      observation: TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: base,
        targetHeadSha: freshHead
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  return {
    direction,
    input: compatibleInput(freshHead, observation.position),
    intent,
    observation,
    quarantine,
    session
  }
})

describe("outer Integrator protocol", () => {
  it.effect("fails closed when a concurrent writer fixes a different session", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit])),
        (event) =>
          event._tag === "IntegratorSessionFixed"
            ? {
                ...event,
                correlation: {
                  ...event.correlation,
                  candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:foreign-winner")
                }
              }
            : event
      )

      const failure = yield* harness.run(compatibleInput()).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(IntegratorJournalContradiction)
      expect(yield* Ref.get(harness.integratorCalls)).toHaveLength(0)
    })
  )

  it.effect("replays the exact fixed session and rejects foreign records at its durable key", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      const input = compatibleInput()
      const correlation = integratorCorrelationFor(input)
      const initial = yield* harness.readRecords
      expect(hasMatchingIntegratorTargetLineageObservation(initial, input)).toBe(true)
      expect(hasMatchingIntegratorTargetLineageObservation([], input)).toBe(false)
      const fixed = yield* appendIntegratorSessionIfNeeded(harness.journal, correlation, initial)
      const afterFixed = yield* harness.readRecords
      expect(yield* appendIntegratorSessionIfNeeded(harness.journal, correlation, afterFixed)).toEqual(fixed)

      const lineage = afterFixed.find(({ event }) => event._tag === "TargetLineageObserved")
      if (lineage?.event._tag !== "TargetLineageObserved") {
        return yield* Effect.die("expected durable target lineage")
      }
      const foreignKeyEvent = afterFixed.map((record) =>
        record.key === fixed.key ? { ...record, event: lineage.event } : record
      )
      expect(
        yield* appendIntegratorSessionIfNeeded(harness.journal, correlation, foreignKeyEvent).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)
      expect(yield* readRecordedIntegratorSession(foreignKeyEvent, responsibility).pipe(Effect.flip)).toBeInstanceOf(
        IntegratorJournalContradiction
      )

      const foreignResponsibility = afterFixed.map((record) =>
        record.key === fixed.key && record.event._tag === "IntegratorSessionFixed"
          ? {
              ...record,
              event: {
                ...record.event,
                correlation: { ...record.event.correlation, acceptedResult: acceptedResultFixture(sha("f")) }
              }
            }
          : record
      )
      expect(
        yield* readRecordedIntegratorSession(foreignResponsibility, responsibility).pipe(Effect.flip)
      ).toBeInstanceOf(IntegratorJournalContradiction)
    })
  )

  it.effect("rejects an Integrator result correlated to another candidate resource", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) =>
          Effect.succeed(
            IntegratorResult.cases.PreparedCandidate.make({
              candidateText,
              correlation: {
                ...request.correlation,
                candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:foreign-result")
              }
            })
          ),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )

      expect(yield* harness.run(compatibleInput()).pipe(Effect.flip)).toBeInstanceOf(IntegratorJournalContradiction)
      expect(yield* Ref.get(harness.gitCalls)).toBe(0)
    })
  )

  it.effect("fails closed when a concurrent writer records a different outer result", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit])),
        (event) =>
          event._tag === "IntegratorRunResultRecorded"
            ? {
                ...event,
                result: IntegratorResult.cases.NotPrepared.make({
                  correlation: event.result.correlation,
                  detail: notPreparedDetail
                })
              }
            : event
      )

      const failure = yield* harness.run(compatibleInput()).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(IntegratorJournalContradiction)
      expect(yield* Ref.get(harness.gitCalls)).toBe(0)
    })
  )

  it.effect("fails closed when a concurrent writer records different candidate Git facts", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit])),
        (event) =>
          event._tag === "IntegratorRunCandidateGitObserved"
            ? {
                ...event,
                observation: IntegratorGitObservation.cases.Missing.make({ candidateText: event.candidateText })
              }
            : event
      )

      const failure = yield* harness.run(compatibleInput()).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(IntegratorJournalContradiction)
      expect(yield* Ref.get(harness.gitCalls)).toBe(1)
    })
  )

  it.effect("successful preparation returns only the Git-qualified canonical M", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      const result = yield* harness.run(compatibleInput())
      const replay = yield* harness.run(compatibleInput())
      const calls = yield* Ref.get(harness.integratorCalls)
      const gitCalls = yield* Ref.get(harness.gitCalls)
      const records = yield* harness.readRecords
      const state = initialRunState(records, compatibleInput())
      const current = deriveCurrentIntegratorState(records, responsibility)

      expect(result._tag).toBe("PreparedCandidate")
      expect(replay._tag).toBe("PreparedCandidate")
      expect(result._tag === "PreparedCandidate" ? result.candidateCommit : undefined).toBe(canonicalCandidateCommit)
      expect(result._tag === "PreparedCandidate" ? result.candidateText : undefined).toBe(candidateText)
      expect(calls).toHaveLength(1)
      expect(gitCalls).toBe(1)
      expect(state._tag).toBe("GitQualifiedPrepared")
      expect(current._tag).toBe("GitQualifiedPrepared")
      expect(current._tag === "GitQualifiedPrepared" ? current.run.ordinal : undefined).toBe(1)
      if (state._tag !== "GitQualifiedPrepared") return yield* Effect.die("expected Git-qualified state")
      const qualified = integratorRunQualifiedCandidateFromState(state)
      const gitObservation = records.findLast(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")
      expect(qualified.candidateCommit).toBe(canonicalCandidateCommit)
      expect(qualified.directParents).toEqual([targetHead, acceptedResultCommit])
      expect(qualified.qualifiedAt).toBe(gitObservation?.position)
      expect(
        Schema.is(IntegratorRunQualifiedCandidate)({ ...qualified, directParents: [acceptedResultCommit, targetHead] })
      ).toBe(false)
      expect(Schema.is(IntegratorRunQualifiedCandidate)({ ...qualified, qualifiedAt: targetLineageObservedAt })).toBe(
        false
      )
      expect(calls[0]?.correlation.acceptedResult).toEqual(responsibility.acceptedResult)
      expect(calls[0]?.correlation.integrationTarget).toEqual(responsibility.integrationTarget)
      expect(calls[0]?.correlation.plannedAttempt).toEqual(responsibility.plannedAttempt)
      expect(calls[0]?.correlation.queuedAt).toBe(responsibility.queuedAt)
      expect(calls[0]?.correlation.startedAt).toBe(responsibility.startedAt)
      expect(calls[0]?.correlation.expectedTargetHead).toBe(targetHead)
      expect(calls[0]?.correlation.targetLineageObservedAt).toBe(targetLineageObservedAt)
      expect(calls[0]?.correlation.candidateResource).toContain("integrator-resource:")
      expect(calls[0]?.correlation.sessionId).toContain("integrator-session:")
      expect(calls[0]?.correlation.candidateResource).toContain(acceptedResultCommit)
      expect(calls[0]?.correlation.candidateResource).toContain(target.repository)
      expect(calls[0]?.correlation.candidateResource).toContain(target.ref)
      expect(calls[0]?.correlation.sessionId).toContain(acceptedResultCommit)
      expect(calls[0]?.correlation.sessionId).toContain(target.repository)
      expect(calls[0]?.correlation.sessionId).toContain(target.ref)
      expect(yield* Ref.get(harness.gitCandidates)).toEqual([candidateText])
      expect(records.filter(({ event }) => event._tag.startsWith("Integrator")).map(({ event }) => event._tag)).toEqual(
        [
          "IntegratorSessionFixed",
          "IntegratorRunStarted",
          "IntegratorRunResultRecorded",
          "IntegratorRunCandidateGitReadIntended",
          "IntegratorRunCandidateGitObserved"
        ]
      )
      const sessionRecord = records.find(({ event }) => event._tag === "IntegratorSessionFixed")
      expect(sessionRecord?.position).toBeGreaterThan(targetLineageObservedAt)
    })
  )

  it.effect("rejects a run occurrence recorded under a foreign Journal key", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* harness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
      yield* Ref.update(harness.records, (records) =>
        records.map((record) =>
          record.event._tag === "IntegratorRunStarted"
            ? { ...record, key: JournalRecordKey.make("integrator-run:foreign-start-key") }
            : record
        )
      )

      expect(deriveCurrentIntegratorState(yield* harness.readRecords, responsibility)).toMatchObject({
        _tag: "Contradiction",
        detail: expect.stringContaining("foreign key")
      })
    })
  )

  it.effect("process loss before the outer result reuses the same unfinished session", () =>
    Effect.gen(function* () {
      let calls = 0
      const harness = yield* makeHarness(
        (request) => {
          calls += 1
          return calls === 1
            ? Effect.fail(
                new IntegratorCallFailure({ correlation: request.correlation, detail: "process lost before result" })
              )
            : Effect.succeed(prepared(request))
        },
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )

      const first = yield* Effect.exit(harness.run(compatibleInput()))
      const recordsAfterFailure = yield* harness.readRecords
      const second = yield* harness.run(compatibleInput())
      const requests = yield* Ref.get(harness.integratorCalls)
      const records = yield* harness.readRecords

      expect(first._tag).toBe("Failure")
      expect(initialRunState(recordsAfterFailure, compatibleInput())._tag).toBe("RunUnfinished")
      expect(second._tag).toBe("PreparedCandidate")
      expect(requests).toHaveLength(2)
      expect(requests[0]?.correlation.sessionId).toBe(requests[1]?.correlation.sessionId)
      expect(requests[0]?.correlation.candidateResource).toBe(requests[1]?.correlation.candidateResource)
      expect(records.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
    })
  )

  it.effect("starts run two only after exact Retry and a fresh matching target-head read", () =>
    Effect.gen(function* () {
      const input = compatibleInput()
      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )

      const initial = yield* harness.runExact(input, IntegratorRunOrdinal.make(1))
      const retryFailure = yield* harness.runExact(input, IntegratorRunOrdinal.make(2)).pipe(Effect.flip)
      const authorization = yield* appendRetryAuthorization(harness)
      const retried = yield* harness.runExact(authorization.input, IntegratorRunOrdinal.make(2), authorization.session)
      const records = yield* harness.readRecords
      const runTwo = integratorRunCorrelationForSession(authorization.session, IntegratorRunOrdinal.make(2))
      const runTwoStart = records.find(({ event }) => event._tag === "IntegratorRunStarted" && event.run.ordinal === 2)

      expect(initial._tag).toBe("NotPrepared")
      expect(retryFailure).toBeInstanceOf(IntegratorJournalContradiction)
      expect(retried._tag).toBe("NotPrepared")
      expect(yield* Ref.get(harness.integratorCalls)).toHaveLength(2)
      expect(deriveIntegratorRunState(records, responsibility, runTwo)._tag).toBe("NotPrepared")
      expect(records.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(2)
      expect(records.filter(({ event }) => event._tag === "IntegratorRunResultRecorded")).toHaveLength(2)
      expect(authorization.quarantine.position).toBeLessThan(authorization.direction.position)
      expect(authorization.direction.position).toBeLessThan(authorization.intent.position)
      expect(authorization.intent.position).toBeLessThan(authorization.observation.position)
      expect(authorization.observation.position).toBeLessThan(runTwoStart?.position ?? 0)
      expect(
        runTwoStart === undefined
          ? "missing run-two start"
          : integratorRunTwoAuthorizationIssue(records, runTwo, { beforePosition: runTwoStart.position })
      ).toBeUndefined()
      expect(evaluateIntegratorRetryAuthorization(records, integratorInitialRunCorrelationFor(input))).toMatchObject({
        _tag: "Rejected",
        detail: expect.stringContaining("applies only to run ordinal two")
      })

      const changedHarness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* changedHarness.runExact(input, IntegratorRunOrdinal.make(1))
      const changedAuthorization = yield* appendRetryAuthorization(changedHarness, changedTargetHead)
      const changedRunTwo = integratorRunCorrelationForSession(
        changedAuthorization.session,
        IntegratorRunOrdinal.make(2)
      )
      const changedRecords = yield* changedHarness.readRecords
      expect(
        integratorRunTwoAuthorizationIssue(changedRecords, changedRunTwo, {
          beforePosition: JournalPosition.make(Number(changedAuthorization.observation.position) + 1)
        })
      ).toContain("unchanged target-lineage")
      expect(
        integratorRetryAuthorizationIssue(changedRecords, {
          preparation: compatibleInput(targetHead, changedAuthorization.observation.position),
          run: changedRunTwo
        })
      ).toContain("does not match its exact Journal observation")
    })
  )

  it.effect("applies a recorded Retry after restart without another user request", () =>
    Effect.gen(function* () {
      let calls = 0
      const harness = yield* makeHarness(
        (request) => {
          calls += 1
          return calls < 3
            ? Effect.fail(new IntegratorCallFailure({ correlation: request.correlation, detail: "process lost" }))
            : Effect.succeed(notPrepared(request))
        },
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )

      yield* Effect.exit(harness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1)))
      const authorization = yield* appendRetryAuthorization(harness, targetHead, "ProviderRunFailure")
      const firstRetry = yield* Effect.exit(
        harness.runExact(authorization.input, IntegratorRunOrdinal.make(2), authorization.session)
      )
      const secondRetry = yield* harness.runExact(
        authorization.input,
        IntegratorRunOrdinal.make(2),
        authorization.session
      )
      const records = yield* harness.readRecords

      expect(firstRetry._tag).toBe("Failure")
      expect(secondRetry._tag).toBe("NotPrepared")
      expect(yield* Ref.get(harness.integratorCalls)).toHaveLength(3)
      expect(records.filter(({ event }) => event._tag === "IntegrationQuarantineDirectionApplied")).toHaveLength(1)
      expect(
        records.filter(({ event }) => event._tag === "IntegratorRunStarted" && event.run.ordinal === 2)
      ).toHaveLength(1)
    })
  )

  it.effect("rejects legacy session-only initial-run result evidence for Retry", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* harness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
      const authorization = yield* appendRetryAuthorization(harness)
      yield* Ref.update(harness.records, (records) =>
        records
          .filter(({ event }) => event._tag !== "IntegratorRunStarted" || event.run.ordinal !== 1)
          .map((record) =>
            record.event._tag === "IntegratorRunResultRecorded" && record.event.run.ordinal === 1
              ? {
                  ...record,
                  event: IntegratorResultRecordedEvent.make({
                    result: record.event.result,
                    version: workflowJournalEventVersion
                  }),
                  key: integratorResultRecordedRecordKey(authorization.session)
                }
              : record
          )
      )
      expect(deriveCurrentIntegratorState(yield* harness.readRecords, responsibility)._tag).toBe("Contradiction")

      const retried = yield* harness
        .runExact(authorization.input, IntegratorRunOrdinal.make(2), authorization.session)
        .pipe(Effect.flip)

      expect(retried).toBeInstanceOf(IntegratorJournalContradiction)
      expect(yield* Ref.get(harness.integratorCalls)).toHaveLength(1)
    })
  )

  it.effect("starts no Retry run when the fresh target head differs from the fixed session head", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* harness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
      const authorization = yield* appendRetryAuthorization(harness, changedTargetHead)

      const failure = yield* harness
        .runExact(authorization.input, IntegratorRunOrdinal.make(2), authorization.session)
        .pipe(Effect.flip)
      const records = yield* harness.readRecords

      expect(failure).toBeInstanceOf(IntegratorTargetHeadChanged)
      expect(yield* Ref.get(harness.integratorCalls)).toHaveLength(1)
      expect(
        records.filter(({ event }) => event._tag === "IntegratorRunStarted" && event.run.ordinal === 2)
      ).toHaveLength(0)
    })
  )

  it.effect("rejects Retry evidence bound to a foreign Run before crossing the Integrator boundary", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* harness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
      const authorization = yield* appendRetryAuthorization(harness)
      yield* Ref.update(harness.records, (records) =>
        records.map((record) =>
          record.position === authorization.direction.position &&
          record.event._tag === "IntegrationQuarantineDirectionApplied"
            ? {
                ...record,
                event: {
                  ...record.event,
                  requestId: IntegrationQuarantineDirectionRequestId.make({
                    nonce: "foreign-retry",
                    runId: RunId.make("foreign-run")
                  })
                }
              }
            : record
        )
      )

      const failure = yield* harness
        .runExact(authorization.input, IntegratorRunOrdinal.make(2), authorization.session)
        .pipe(Effect.flip)

      expect(failure).toBeInstanceOf(IntegratorJournalContradiction)
      expect(yield* Ref.get(harness.integratorCalls)).toHaveLength(1)
    })
  )

  it.effect("rejects non-Retry, conflicting, stale-lineage, and wrong-quarantine evidence before run two", () =>
    Effect.forEach(
      [
        "FullRerun",
        "ConflictingDirection",
        "LineageBeforeDirection",
        "WrongQuarantineEvidence",
        "WrongQuarantineKey"
      ] as const,
      (invalidCase) =>
        Effect.gen(function* () {
          const harness = yield* makeHarness(
            (request) => Effect.succeed(notPrepared(request)),
            successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
          )
          yield* harness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
          const authorization = yield* appendRetryAuthorization(harness)

          if (invalidCase === "ConflictingDirection") {
            yield* harness.journal.append(
              runId,
              JournalRecordKey.make("integrator-retry:conflicting-direction"),
              IntegrationQuarantineDirectionAppliedEvent.make({
                fingerprint: IntegrationQuarantineDirectionFingerprint.make({
                  direction: "FullRerun",
                  quarantineAt: authorization.quarantine.position,
                  sessionId: authorization.session.sessionId
                }),
                initiatedBy: { _tag: "Operator" },
                occurrenceClassification: "InitiatedAction",
                requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "conflicting-full-rerun", runId }),
                version: workflowJournalEventVersion
              })
            )
          } else {
            yield* Ref.update(harness.records, (records) =>
              records.map((record) => {
                if (
                  invalidCase === "FullRerun" &&
                  record.position === authorization.direction.position &&
                  record.event._tag === "IntegrationQuarantineDirectionApplied"
                ) {
                  return {
                    ...record,
                    event: {
                      ...record.event,
                      fingerprint: IntegrationQuarantineDirectionFingerprint.make({
                        ...record.event.fingerprint,
                        direction: "FullRerun"
                      })
                    }
                  }
                }
                if (invalidCase === "LineageBeforeDirection" && record.position === authorization.direction.position) {
                  return { ...record, position: JournalPosition.make(Number(authorization.observation.position) + 1) }
                }
                if (
                  invalidCase === "WrongQuarantineEvidence" &&
                  record.position === authorization.quarantine.position &&
                  record.event._tag === "IntegrationQuarantined" &&
                  record.event.basis._tag === "ConclusiveResult"
                ) {
                  return {
                    ...record,
                    event: {
                      ...record.event,
                      basis: IntegrationQuarantineBasis.cases.ConclusiveResult.make({
                        cause: record.event.basis.cause,
                        evidence: { resultRecordedAt: JournalPosition.make(999) }
                      })
                    }
                  }
                }
                if (invalidCase === "WrongQuarantineKey" && record.position === authorization.quarantine.position) {
                  return { ...record, key: JournalRecordKey.make("integrator-retry:foreign-quarantine-key") }
                }
                return record
              })
            )
          }

          const failure = yield* harness
            .runExact(authorization.input, IntegratorRunOrdinal.make(2), authorization.session)
            .pipe(Effect.flip)
          const records = yield* harness.readRecords

          expect(failure, invalidCase).toBeInstanceOf(IntegratorJournalContradiction)
          expect(yield* Ref.get(harness.integratorCalls), invalidCase).toHaveLength(1)
          expect(
            records.filter(({ event }) => event._tag === "IntegratorRunStarted" && event.run.ordinal === 2),
            invalidCase
          ).toHaveLength(0)
        }),
      { concurrency: 1 }
    ).pipe(Effect.asVoid)
  )

  it.effect("rejects successor ordinals before crossing the Integrator boundary", () =>
    Effect.gen(function* () {
      const input = compatibleInput()
      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )

      const failure = yield* harness.runExact(input, IntegratorRunOrdinal.make(3)).pipe(Effect.flip)
      const records = yield* harness.readRecords

      expect(failure).toBeInstanceOf(IntegratorJournalContradiction)
      expect(yield* Ref.get(harness.integratorCalls)).toHaveLength(0)
      expect(records.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(0)
      expect(records.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(0)
    })
  )

  it.effect("conclusive NotPrepared is retained for quarantine and is not automatically retried", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      const first = yield* harness.run(compatibleInput())
      const second = yield* harness.run(compatibleInput())
      const calls = yield* Ref.get(harness.integratorCalls)
      const gitCalls = yield* Ref.get(harness.gitCalls)
      const records = yield* harness.readRecords

      expect(first._tag).toBe("NotPrepared")
      expect(second._tag).toBe("NotPrepared")
      expect(first._tag === "NotPrepared" ? first.detail : undefined).toBe(notPreparedDetail)
      expect(second._tag === "NotPrepared" ? second.detail : undefined).toBe(notPreparedDetail)
      expect(calls).toHaveLength(1)
      expect(gitCalls).toBe(0)
      expect(initialRunState(records, compatibleInput())._tag).toBe("NotPrepared")
      expect(records.filter(({ event }) => event._tag.startsWith("Integrator")).map(({ event }) => event._tag)).toEqual(
        ["IntegratorSessionFixed", "IntegratorRunStarted", "IntegratorRunResultRecorded"]
      )
    })
  )

  it.effect("records one initial quarantine from the exact modern NotPrepared run evidence", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      const result = yield* harness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
      if (result._tag !== "NotPrepared") return yield* Effect.die("expected exact NotPrepared result")

      const first = yield* appendInitialConclusiveIntegrationQuarantine(result).pipe(
        Effect.provideService(InRunJournal, harness.journal)
      )
      const redelivered = yield* appendInitialConclusiveIntegrationQuarantine(result).pipe(
        Effect.provideService(InRunJournal, harness.journal)
      )
      const records = yield* harness.readRecords

      expect(redelivered).toEqual(first)
      expect(records.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(1)
      expect(first.event).toMatchObject({
        _tag: "IntegrationQuarantined",
        basis: { _tag: "ConclusiveResult", cause: { _tag: "NotPrepared", detail: notPreparedDetail } },
        correlation: result.run.session
      })
      expect(records.map(({ event }) => event._tag).slice(-2)).toEqual([
        "IntegratorRunResultRecorded",
        "IntegrationQuarantined"
      ])
    })
  )

  it.effect("records invalid-candidate quarantine only after the exact run Git observation", () =>
    Effect.gen(function* () {
      const observation = IntegratorGitObservation.cases.NonCommit.make({ candidateText, objectType: "tree" })
      const harness = yield* makeHarness((request) => Effect.succeed(prepared(request)), successfulGitRead(observation))
      const result = yield* harness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
      if (result._tag !== "CandidateRejected") return yield* Effect.die("expected exact rejected candidate")

      const quarantine = yield* appendInitialConclusiveIntegrationQuarantine(result).pipe(
        Effect.provideService(InRunJournal, harness.journal)
      )
      const records = yield* harness.readRecords
      const observationAt = records.find(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")?.position

      expect(quarantine.event).toMatchObject({
        _tag: "IntegrationQuarantined",
        basis: {
          _tag: "ConclusiveResult",
          cause: { _tag: "InvalidCandidate", candidateText, observation },
          evidence: { candidateObservationAt: observationAt }
        }
      })
      expect(records.map(({ event }) => event._tag).slice(-2)).toEqual([
        "IntegratorRunCandidateGitObserved",
        "IntegrationQuarantined"
      ])
    })
  )

  it.effect("resource HEAD never supplies an unreported candidate", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      const result = yield* harness.run(compatibleInput())
      const gitCalls = yield* Ref.get(harness.gitCalls)

      expect(result._tag).toBe("NotPrepared")
      expect(gitCalls).toBe(0)
    })
  )

  it.effect("wrong ordered parents do not qualify the explicitly reported M", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(commitObservation([acceptedResultCommit, targetHead]))
      )
      const result = yield* harness.run(compatibleInput())
      const records = yield* harness.readRecords

      expect(result._tag).toBe("CandidateRejected")
      expect(initialRunState(records, compatibleInput())._tag).toBe("CandidateRejected")
      expect(result._tag === "CandidateRejected" ? result.candidateText : undefined).toBe(candidateText)
      expect(result._tag === "CandidateRejected" ? "candidateCommit" in result : false).toBe(false)
    })
  )

  it.effect("incompatible target lineage stops before session creation", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        () => Effect.die("Integrator must not be called"),
        () => Effect.die("Git must not be called")
      )
      const result = yield* Effect.exit(harness.run(incompatibleInput()))
      const calls = yield* Ref.get(harness.integratorCalls)
      const gitCalls = yield* Ref.get(harness.gitCalls)
      const records = yield* harness.readRecords

      expect(result._tag).toBe("Failure")
      expect(calls).toHaveLength(0)
      expect(gitCalls).toBe(0)
      expect(records.filter(({ event }) => event._tag.startsWith("Integrator"))).toHaveLength(0)
      expect(initialRunState(records, incompatibleInput())._tag).toBe("Absent")
    })
  )

  it.effect("a lineage observation for another integration target cannot authorize the session", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      const foreignTarget = IntegrationTarget.make({
        ref: IntegrationTargetRef.make("refs/heads/other"),
        repository: target.repository
      })
      yield* Ref.update(harness.records, (records) =>
        records.map((record) =>
          record.event._tag === "GitReadIntentRecorded" && record.event.operation._tag === "ReadTargetLineage"
            ? {
                ...record,
                event: { ...record.event, operation: { ...record.event.operation, integrationTarget: foreignTarget } }
              }
            : record
        )
      )

      const failure = yield* Effect.flip(harness.run(compatibleInput()))
      expect(failure).toBeInstanceOf(IntegratorJournalContradiction)
      expect(yield* Ref.get(harness.integratorCalls)).toHaveLength(0)
    })
  )

  it.effect("a later ordinary activation with a different H fails closed without a new session or call", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* harness.run(compatibleInput())
      const failure = yield* Effect.flip(harness.run(compatibleInput(changedTargetHead)))
      const calls = yield* Ref.get(harness.integratorCalls)
      const records = yield* harness.readRecords

      expect(failure).toBeInstanceOf(IntegratorTargetHeadChanged)
      expect(calls).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "IntegratorRunResultRecorded")).toHaveLength(1)
    })
  )

  it.effect("a later activation with a different lineage observation identity fails closed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* harness.run(compatibleInput())
      const failure = yield* Effect.flip(harness.run(compatibleInput(targetHead, changedTargetLineageObservedAt)))
      const calls = yield* Ref.get(harness.integratorCalls)
      const records = yield* harness.readRecords

      expect(failure).toBeInstanceOf(IntegratorTargetLineageObservationChanged)
      expect(calls).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
    })
  )

  it.effect("a Git read failure leaves its intent and restart rereads Git without rerunning Integrator", () =>
    Effect.gen(function* () {
      let gitAttempts = 0
      const harness = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        (requestedTarget, requestedCandidate) => {
          gitAttempts += 1
          return gitAttempts === 1
            ? Effect.fail(
                new IntegratorGitReadFailure({
                  candidateText: requestedCandidate,
                  detail: "Git read was interrupted",
                  target: requestedTarget
                })
              )
            : Effect.succeed(commitObservation([targetHead, acceptedResultCommit]))
        }
      )

      const firstFailure = yield* Effect.flip(harness.run(compatibleInput()))
      const recordsAfterFailure = yield* harness.readRecords
      const second = yield* harness.run(compatibleInput())
      const calls = yield* Ref.get(harness.integratorCalls)
      const gitCalls = yield* Ref.get(harness.gitCalls)
      const records = yield* harness.readRecords

      expect(firstFailure).toBeInstanceOf(IntegratorGitReadFailure)
      expect(initialRunState(recordsAfterFailure, compatibleInput())._tag).toBe("PreparedAwaitingGit")
      expect(
        recordsAfterFailure.filter(({ event }) => event._tag.startsWith("Integrator")).map(({ event }) => event._tag)
      ).toEqual([
        "IntegratorSessionFixed",
        "IntegratorRunStarted",
        "IntegratorRunResultRecorded",
        "IntegratorRunCandidateGitReadIntended"
      ])
      expect(second._tag).toBe("PreparedCandidate")
      expect(calls).toHaveLength(1)
      expect(gitCalls).toBe(2)
      expect(records.filter(({ event }) => event._tag === "IntegratorRunCandidateGitReadIntended")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")).toHaveLength(1)
    })
  )

  it.effect("a Git Commit observation for different candidate text fails closed", () =>
    Effect.gen(function* () {
      const mismatchedText = IntegratorCandidateText.make("N-foreign-text")
      const harness = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(
          IntegratorGitObservation.cases.Commit.make({
            candidateText: mismatchedText,
            commit: canonicalCandidateCommit,
            directParents: [targetHead, acceptedResultCommit]
          })
        )
      )
      const failure = yield* Effect.flip(harness.run(compatibleInput()))

      expect(failure).toBeInstanceOf(IntegratorJournalContradiction)
    })
  )

  it.effect("rejects a candidate whose Git object or ordered parents are invalid", () =>
    Effect.gen(function* () {
      const missing = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(IntegratorGitObservation.cases.Missing.make({ candidateText }))
      )
      const nonCommit = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(IntegratorGitObservation.cases.NonCommit.make({ candidateText, objectType: "tree" }))
      )
      const wrongParents = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(commitObservation([acceptedResultCommit, targetHead]))
      )

      const missingResult = yield* missing.run(compatibleInput())
      const nonCommitResult = yield* nonCommit.run(compatibleInput())
      const wrongParentsResult = yield* wrongParents.run(compatibleInput())

      expect(missingResult._tag).toBe("CandidateRejected")
      expect(nonCommitResult._tag).toBe("CandidateRejected")
      expect(wrongParentsResult._tag).toBe("CandidateRejected")
    })
  )

  it.effect("the public result schema contains no Integrator-private stages", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* harness.run(compatibleInput())
      const calls = yield* Ref.get(harness.integratorCalls)
      const request = calls[0]
      if (request === undefined) return yield* Effect.die("expected one Integrator request")
      const outerResult = prepared(request)
      const retainedNotPrepared = notPrepared(request)

      expect(Object.keys(outerResult).toSorted()).toEqual(["_tag", "candidateText", "correlation"])
      expect(Object.keys(retainedNotPrepared).toSorted()).toEqual(["_tag", "correlation", "detail"])
    })
  )

  it.effect("fails closed for every corrupted durable outer-session relationship", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* harness.run(compatibleInput())
      const pristine = yield* harness.readRecords
      const session = pristine.find(({ event }) => event._tag === "IntegratorSessionFixed")
      const result = pristine.find(({ event }) => event._tag === "IntegratorRunResultRecorded")
      const intent = pristine.find(({ event }) => event._tag === "IntegratorRunCandidateGitReadIntended")
      const observed = pristine.find(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")
      const lineageIntent = pristine.find(({ event }) => event._tag === "GitReadIntentRecorded")
      const lineage = pristine.find(({ event }) => event._tag === "TargetLineageObserved")
      if (
        session?.event._tag !== "IntegratorSessionFixed" ||
        result?.event._tag !== "IntegratorRunResultRecorded" ||
        intent?.event._tag !== "IntegratorRunCandidateGitReadIntended" ||
        observed?.event._tag !== "IntegratorRunCandidateGitObserved" ||
        lineageIntent?.event._tag !== "GitReadIntentRecorded" ||
        lineage?.event._tag !== "TargetLineageObserved"
      ) {
        return yield* Effect.die("expected one complete outer-session history")
      }
      const foreignCandidate = IntegratorCandidateText.make("foreign-candidate")
      const foreignCorrelation = {
        ...session.event.correlation,
        candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:foreign-correlation")
      }
      const replaceEvent = (
        records: ReadonlyArray<JournalRecord>,
        key: JournalRecordKey,
        event: JournalRecord["event"]
      ): ReadonlyArray<JournalRecord> => records.map((record) => (record.key === key ? { ...record, event } : record))
      const appendEvent = (
        records: ReadonlyArray<JournalRecord>,
        key: string,
        event: JournalRecord["event"]
      ): ReadonlyArray<JournalRecord> => [
        ...records,
        { event, key: JournalRecordKey.make(key), position: JournalPosition.make(100 + records.length), runId }
      ]

      const stateCorruptions: ReadonlyArray<readonly [string, ReadonlyArray<JournalRecord>]> = [
        ["result without session", pristine.filter((record) => record.key !== session.key)],
        ["non-session at session key", replaceEvent(pristine, session.key, lineage.event)],
        [
          "session for another responsibility",
          replaceEvent(pristine, session.key, {
            ...session.event,
            correlation: { ...session.event.correlation, acceptedResult: acceptedResultFixture(sha("f")) }
          })
        ],
        [
          "session after mismatched lineage",
          replaceEvent(pristine, lineage.key, {
            ...lineage.event,
            observation: { ...lineage.event.observation, targetHeadSha: changedTargetHead }
          })
        ],
        [
          "second session",
          appendEvent(pristine, "integrator-session:foreign", { ...session.event, correlation: foreignCorrelation })
        ],
        ["non-result at result key", replaceEvent(pristine, result.key, lineage.event)],
        [
          "result for another correlation",
          replaceEvent(pristine, result.key, {
            ...result.event,
            result: { ...result.event.result, correlation: foreignCorrelation }
          })
        ],
        [
          "second outer result",
          appendEvent(pristine, "integrator-result:foreign", {
            ...result.event,
            result: { ...result.event.result, correlation: foreignCorrelation }
          })
        ],
        ["Git observation without intent", pristine.filter((record) => record.key !== intent.key)],
        ["non-observation at observation key", replaceEvent(pristine, observed.key, lineage.event)],
        [
          "Git facts for another candidate",
          appendEvent(pristine, "integrator-git-intent:foreign", { ...intent.event, candidateText: foreignCandidate })
        ],
        ["non-intent at intent key", replaceEvent(pristine, intent.key, lineage.event)]
      ]
      for (const [label, records] of stateCorruptions) {
        expect(initialRunState(records, compatibleInput()), label).toMatchObject({ _tag: "Contradiction" })
      }

      const protocolCorruptions: ReadonlyArray<
        readonly [string, ReadonlyArray<JournalRecord>, IntegratorPreparationInput, string?]
      > = [
        ["non-result at result key", replaceEvent(pristine, result.key, lineage.event), compatibleInput()],
        [
          "result for another correlation",
          replaceEvent(pristine, result.key, {
            ...result.event,
            result: { ...result.event.result, correlation: foreignCorrelation }
          }),
          compatibleInput()
        ],
        ["non-observation at observation key", replaceEvent(pristine, observed.key, lineage.event), compatibleInput()],
        [
          "observation for another correlation",
          replaceEvent(pristine, observed.key, {
            ...observed.event,
            run: { ...observed.event.run, session: foreignCorrelation }
          }),
          compatibleInput()
        ],
        [
          "observation payload for another candidate",
          replaceEvent(pristine, observed.key, {
            ...observed.event,
            observation: { ...observed.event.observation, candidateText: foreignCandidate }
          }),
          compatibleInput()
        ],
        ["non-intent at intent key", replaceEvent(pristine, intent.key, lineage.event), compatibleInput()],
        ["observation without intent", pristine.filter((record) => record.key !== intent.key), compatibleInput()],
        [
          "session without lineage intent",
          pristine.filter((record) => record.key !== lineageIntent.key),
          compatibleInput()
        ],
        [
          "recovered session with incompatible lineage",
          pristine,
          incompatibleInput(),
          "IntegratorTargetLineageIncompatible"
        ]
      ]
      for (const [label, records, input, expectedTag = "IntegratorJournalContradiction"] of protocolCorruptions) {
        yield* Ref.set(harness.records, records)
        const failure = yield* harness.run(input).pipe(Effect.flip)
        expect(failure, label).toMatchObject({ _tag: expectedTag })
      }
    })
  )

  it.effect("rejects Retry requests without a fixed session, with incompatible lineage, or for a foreign session", () =>
    Effect.gen(function* () {
      const empty = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      const noSession = yield* empty.runExact(compatibleInput(), IntegratorRunOrdinal.make(2)).pipe(Effect.flip)
      expect(noSession).toMatchObject({
        _tag: "IntegratorJournalContradiction",
        detail: expect.stringContaining("no exact earlier fixed session")
      })

      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* harness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
      const authorization = yield* appendRetryAuthorization(harness)
      const incompatibleRetry = yield* harness
        .runExact(
          IntegratorPreparationInput.make({
            ...authorization.input,
            targetLineage: TargetLineageObservation.make({
              plannedBaseIsAncestorOfTargetHead: false,
              plannedBaseSha: base,
              targetHeadSha: targetHead
            })
          }),
          IntegratorRunOrdinal.make(2),
          authorization.session
        )
        .pipe(Effect.flip)
      expect(incompatibleRetry).toBeInstanceOf(IntegratorTargetLineageIncompatible)

      const foreignSession = IntegratorCorrelation.make({
        ...authorization.session,
        candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:foreign-request")
      })
      const foreignRequest = yield* harness
        .runExact(compatibleInput(), IntegratorRunOrdinal.make(1), foreignSession)
        .pipe(Effect.flip)
      expect(foreignRequest).toMatchObject({
        _tag: "IntegratorJournalContradiction",
        detail: expect.stringContaining("foreign session")
      })
    })
  )

  it.effect("reuses a legacy session result and rejects a foreign legacy correlation", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* harness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
      const sessionRecord = (yield* harness.readRecords).find(({ event }) => event._tag === "IntegratorSessionFixed")
      const runResult = (yield* harness.readRecords).find(({ event }) => event._tag === "IntegratorRunResultRecorded")
      if (
        sessionRecord?.event._tag !== "IntegratorSessionFixed" ||
        runResult?.event._tag !== "IntegratorRunResultRecorded"
      ) {
        return yield* Effect.die("expected one fixed session and run result")
      }
      const legacyRecords = (yield* harness.readRecords)
        .filter(({ event }) => event._tag !== "IntegratorRunStarted" && event._tag !== "IntegratorRunResultRecorded")
        .concat({
          ...runResult,
          event: IntegratorResultRecordedEvent.make({
            result: runResult.event.result,
            version: workflowJournalEventVersion
          }),
          key: integratorResultRecordedRecordKey(sessionRecord.event.correlation)
        })
      yield* Ref.set(harness.records, legacyRecords)
      const reused = yield* harness.runExact(
        compatibleInput(),
        IntegratorRunOrdinal.make(1),
        sessionRecord.event.correlation
      )
      expect(reused._tag).toBe("NotPrepared")
      expect(yield* Ref.get(harness.integratorCalls)).toHaveLength(1)

      const foreignCorrelation = {
        ...sessionRecord.event.correlation,
        candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:foreign-legacy")
      }
      const legacyResultKey = integratorResultRecordedRecordKey(sessionRecord.event.correlation)
      yield* Ref.update(harness.records, (records) =>
        records.map((record) =>
          record.key === legacyResultKey && record.event._tag === "IntegratorResultRecorded"
            ? {
                ...record,
                event: IntegratorResultRecordedEvent.make({
                  result: { ...record.event.result, correlation: foreignCorrelation },
                  version: workflowJournalEventVersion
                })
              }
            : record
        )
      )
      const foreign = yield* harness
        .runExact(compatibleInput(), IntegratorRunOrdinal.make(1), sessionRecord.event.correlation)
        .pipe(Effect.flip)
      expect(foreign).toMatchObject({
        _tag: "IntegratorJournalContradiction",
        detail: expect.stringContaining("foreign correlation")
      })
    })
  )

  it.effect("rejects Retry authorization after a foreign record, duplicate identity, or changed-head quarantine", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* harness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
      const authorization = yield* appendRetryAuthorization(harness)
      const runTwo = IntegratorRunCorrelation.make({
        ordinal: IntegratorRunOrdinal.make(2),
        session: authorization.session
      })

      const records = yield* harness.readRecords
      const foreignRecord = records.map((record, index) =>
        index === 0 ? { ...record, runId: RunId.make("foreign-retry-history") } : record
      )
      expect(evaluateIntegratorRetryAuthorization(foreignRecord, runTwo)).toMatchObject({
        _tag: "Rejected",
        detail: expect.stringContaining("one exact Journal history")
      })
      expect(
        evaluateIntegratorRetryAuthorization(
          [...records, { ...authorization.direction, position: JournalPosition.make(999) }],
          runTwo
        )
      ).toMatchObject({ _tag: "Rejected", detail: expect.stringContaining("one exact Journal history") })

      const changedBasis = IntegrationQuarantineBasis.cases.RetryTargetHeadChanged.make({
        direction: "Retry",
        directionAppliedAt: authorization.direction.position,
        observedTargetHead: changedTargetHead,
        priorQuarantineAt: authorization.quarantine.position,
        targetLineageObservedAt: authorization.observation.position
      })
      const changedQuarantine = {
        event: IntegrationQuarantinedEvent.make({
          basis: changedBasis,
          correlation: authorization.session,
          occurrenceClassification: "NonActionOccurrence",
          version: workflowJournalEventVersion
        }),
        key: integrationQuarantinedRecordKey(authorization.session.sessionId, changedBasis),
        position: JournalPosition.make(Number(authorization.observation.position) + 1),
        runId
      }
      expect(evaluateIntegratorRetryAuthorization([...records, changedQuarantine], runTwo)).toMatchObject({
        _tag: "Rejected",
        detail: expect.stringContaining("changed-head quarantine")
      })

      const secondOperationId = OperationId.make("operation-target-lineage-retry-second")
      yield* harness.journal.append(
        runId,
        JournalRecordKey.make("integrator-retry:lineage-intent-second"),
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: makeTargetLineageObservationOperation({
            integrationTarget: target,
            operationId: secondOperationId,
            plannedAttempt,
            predecessorOperationIds: []
          }),
          version: workflowJournalEventVersion
        })
      )
      yield* harness.journal.append(
        runId,
        JournalRecordKey.make("integrator-retry:lineage-observation-second"),
        TargetLineageObservedEvent.make({
          observation: TargetLineageObservation.make({
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: base,
            targetHeadSha: targetHead
          }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: secondOperationId,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      expect(evaluateIntegratorRetryAuthorization(yield* harness.readRecords, runTwo)).toMatchObject({
        _tag: "Authorized"
      })
    })
  )

  it.effect("authorizes Retry from a prepared candidate with an exact invalid Git observation", () =>
    Effect.gen(function* () {
      const observation = IntegratorGitObservation.cases.NonCommit.make({ candidateText, objectType: "tree" })
      const harness = yield* makeHarness((request) => Effect.succeed(prepared(request)), successfulGitRead(observation))
      const result = yield* harness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
      expect(result._tag).toBe("CandidateRejected")
      const records = yield* harness.readRecords
      const resultRecord = records.find(({ event }) => event._tag === "IntegratorRunResultRecorded")
      const observationRecord = records.find(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")
      if (
        resultRecord?.event._tag !== "IntegratorRunResultRecorded" ||
        observationRecord?.event._tag !== "IntegratorRunCandidateGitObserved"
      ) {
        return yield* Effect.die("expected prepared result and candidate observation")
      }

      const authorization = yield* appendRetryAuthorization(harness)
      const cause = IntegrationQuarantineCause.cases.InvalidCandidate.make({ candidateText, observation })
      const basis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
        cause,
        evidence: { candidateObservationAt: observationRecord.position, resultRecordedAt: resultRecord.position }
      })
      const rewritten = (yield* harness.readRecords).map((record) =>
        record.position === authorization.quarantine.position && record.event._tag === "IntegrationQuarantined"
          ? {
              ...record,
              event: IntegrationQuarantinedEvent.make({ ...record.event, basis }),
              key: integrationQuarantinedRecordKey(authorization.session.sessionId, basis)
            }
          : record
      )
      yield* Ref.set(harness.records, rewritten)

      const runTwo = IntegratorRunCorrelation.make({
        ordinal: IntegratorRunOrdinal.make(2),
        session: authorization.session
      })
      const resultAfterRewrite = evaluateIntegratorRetryAuthorization(yield* harness.readRecords, runTwo)
      expect(resultAfterRewrite).toMatchObject({
        _tag: "Authorized",
        authorization: { ordinalOneEvidence: { _tag: "ConclusiveResult", candidateObservation: observationRecord } }
      })

      const missingResultBasis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
        cause,
        evidence: {
          candidateObservationAt: observationRecord.position,
          resultRecordedAt: JournalPosition.make(Number(resultRecord.position) + 999)
        }
      })
      const missingResultRecords = rewritten.map((record) =>
        record.position === authorization.quarantine.position && record.event._tag === "IntegrationQuarantined"
          ? {
              ...record,
              event: IntegrationQuarantinedEvent.make({ ...record.event, basis: missingResultBasis }),
              key: integrationQuarantinedRecordKey(authorization.session.sessionId, missingResultBasis)
            }
          : record
      )
      expect(evaluateIntegratorRetryAuthorization(missingResultRecords, runTwo)).toMatchObject({
        _tag: "Rejected",
        detail: expect.stringContaining("modern ordinal-one terminal evidence")
      })

      const directionWithMissingQuarantine = rewritten.map((record) => {
        if (
          record.position !== authorization.direction.position ||
          record.event._tag !== "IntegrationQuarantineDirectionApplied"
        )
          return record
        const fingerprint = IntegrationQuarantineDirectionFingerprint.make({
          ...record.event.fingerprint,
          quarantineAt: JournalPosition.make(Number(authorization.quarantine.position) + 999)
        })
        return {
          ...record,
          event: IntegrationQuarantineDirectionAppliedEvent.make({ ...record.event, fingerprint }),
          key: integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(fingerprint))
        }
      })
      expect(evaluateIntegratorRetryAuthorization(directionWithMissingQuarantine, runTwo)).toMatchObject({
        _tag: "Rejected",
        detail: expect.stringContaining("no exact earlier ordinal-one quarantine")
      })

      const foreignCandidateText = IntegratorCandidateText.make("M-foreign-retry-evidence")
      const foreignObservation = IntegratorGitObservation.cases.NonCommit.make({
        candidateText: foreignCandidateText,
        objectType: "tree"
      })
      const foreignCause = IntegrationQuarantineCause.cases.InvalidCandidate.make({
        candidateText: foreignCandidateText,
        observation: foreignObservation
      })
      const foreignBasis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
        cause: foreignCause,
        evidence: { candidateObservationAt: observationRecord.position, resultRecordedAt: resultRecord.position }
      })
      const foreignEvidenceRecords = rewritten.map((record) =>
        record.position === authorization.quarantine.position && record.event._tag === "IntegrationQuarantined"
          ? {
              ...record,
              event: IntegrationQuarantinedEvent.make({ ...record.event, basis: foreignBasis }),
              key: integrationQuarantinedRecordKey(authorization.session.sessionId, foreignBasis)
            }
          : record
      )
      expect(evaluateIntegratorRetryAuthorization(foreignEvidenceRecords, runTwo)).toMatchObject({
        _tag: "Rejected",
        detail: expect.stringContaining("modern ordinal-one terminal evidence")
      })
    })
  )

  it.effect("rejects Retry when each exact terminal, direction, or fresh-lineage relation is malformed", () =>
    Effect.gen(function* () {
      const notPreparedHarness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* notPreparedHarness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
      const notPreparedAuthorization = yield* appendRetryAuthorization(notPreparedHarness)
      const runTwo = IntegratorRunCorrelation.make({
        ordinal: IntegratorRunOrdinal.make(2),
        session: notPreparedAuthorization.session
      })
      const notPreparedRecords = yield* notPreparedHarness.readRecords
      const notPreparedQuarantine = notPreparedRecords.find(({ event }) => event._tag === "IntegrationQuarantined")
      if (notPreparedQuarantine?.event._tag !== "IntegrationQuarantined") {
        return yield* Effect.die("expected NotPrepared quarantine")
      }
      const notPreparedQuarantineEvent = notPreparedQuarantine.event
      const wrongDetail = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
        cause: IntegrationQuarantineCause.cases.NotPrepared.make({ detail: IntegratorNotPreparedDetail.make("wrong") }),
        evidence:
          notPreparedQuarantine.event.basis._tag === "ConclusiveResult"
            ? notPreparedQuarantine.event.basis.evidence
            : { resultRecordedAt: JournalPosition.make(0) }
      })
      const wrongDetailRecords = notPreparedRecords.map((record) =>
        record.position === notPreparedQuarantine.position
          ? {
              ...record,
              event: IntegrationQuarantinedEvent.make({ ...notPreparedQuarantineEvent, basis: wrongDetail }),
              key: integrationQuarantinedRecordKey(notPreparedAuthorization.session.sessionId, wrongDetail)
            }
          : record
      )
      expect(evaluateIntegratorRetryAuthorization(wrongDetailRecords, runTwo)).toMatchObject({
        _tag: "Rejected",
        detail: expect.stringContaining("modern ordinal-one terminal evidence")
      })

      const providerHarness = yield* makeHarness(
        (request) => Effect.succeed(notPrepared(request)),
        successfulGitRead(commitObservation([targetHead, acceptedResultCommit]))
      )
      yield* providerHarness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
      const providerAuthorization = yield* appendRetryAuthorization(providerHarness, targetHead, "ProviderRunFailure")
      const providerRecords = yield* providerHarness.readRecords
      const providerQuarantine = providerRecords.find(({ event }) => event._tag === "IntegrationQuarantined")
      if (providerQuarantine?.event._tag !== "IntegrationQuarantined") {
        return yield* Effect.die("expected provider-failure quarantine")
      }
      if (providerQuarantine.event.basis._tag !== "ProviderRunFailure") {
        return yield* Effect.die("expected provider-failure basis")
      }
      const providerQuarantineEvent = providerQuarantine.event
      const wrongAbsence = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
        detail: providerQuarantine.event.basis.detail,
        ownedActivityProvenAbsentAt: providerQuarantine.position
      })
      const wrongAbsenceRecords = providerRecords.map((record) =>
        record.position === providerQuarantine.position
          ? {
              ...record,
              event: IntegrationQuarantinedEvent.make({ ...providerQuarantineEvent, basis: wrongAbsence }),
              key: integrationQuarantinedRecordKey(providerAuthorization.session.sessionId, wrongAbsence)
            }
          : record
      )
      expect(
        evaluateIntegratorRetryAuthorization(wrongAbsenceRecords, {
          ordinal: IntegratorRunOrdinal.make(2),
          session: providerAuthorization.session
        })
      ).toMatchObject({ _tag: "Rejected", detail: expect.stringContaining("modern ordinal-one terminal evidence") })

      const preparedHarness = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(IntegratorGitObservation.cases.NonCommit.make({ candidateText, objectType: "tree" }))
      )
      yield* preparedHarness.runExact(compatibleInput(), IntegratorRunOrdinal.make(1))
      const preparedAuthorization = yield* appendRetryAuthorization(preparedHarness)
      const preparedRecords = yield* preparedHarness.readRecords
      const preparedResultRecord = preparedRecords.find(({ event }) => event._tag === "IntegratorRunResultRecorded")
      const preparedObservationRecord = preparedRecords.find(
        ({ event }) => event._tag === "IntegratorRunCandidateGitObserved"
      )
      const preparedQuarantine = preparedRecords.find(({ event }) => event._tag === "IntegrationQuarantined")
      if (
        preparedResultRecord?.event._tag !== "IntegratorRunResultRecorded" ||
        preparedObservationRecord?.event._tag !== "IntegratorRunCandidateGitObserved" ||
        preparedQuarantine?.event._tag !== "IntegrationQuarantined"
      ) {
        return yield* Effect.die("expected prepared candidate Retry records")
      }
      const preparedObservationEvent = preparedObservationRecord.event
      const preparedQuarantineEvent = preparedQuarantine.event
      const invalidCandidate = IntegrationQuarantineCause.cases.InvalidCandidate.make({
        candidateText,
        observation: IntegratorGitObservation.cases.NonCommit.make({ candidateText, objectType: "tree" })
      })
      const invalidBasis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
        cause: invalidCandidate,
        evidence: {
          candidateObservationAt: preparedObservationRecord.position,
          resultRecordedAt: preparedResultRecord.position
        }
      })
      const preparedWithInvalidBasis = preparedRecords.map((record) =>
        record.position === preparedQuarantine.position
          ? {
              ...record,
              event: IntegrationQuarantinedEvent.make({ ...preparedQuarantineEvent, basis: invalidBasis }),
              key: integrationQuarantinedRecordKey(preparedAuthorization.session.sessionId, invalidBasis)
            }
          : record
      )
      const foreignCandidateText = IntegratorCandidateText.make("M-foreign-retry-candidate")
      const foreignCandidateRecord = preparedWithInvalidBasis.map((record) =>
        record.position === preparedObservationRecord.position
          ? { ...record, event: { ...preparedObservationEvent, candidateText: foreignCandidateText } }
          : record
      )
      expect(
        evaluateIntegratorRetryAuthorization(foreignCandidateRecord, {
          ordinal: IntegratorRunOrdinal.make(2),
          session: preparedAuthorization.session
        })
      ).toMatchObject({ _tag: "Rejected", detail: expect.stringContaining("modern ordinal-one terminal evidence") })

      const mismatchedObservation = preparedWithInvalidBasis.map((record) =>
        record.position === preparedObservationRecord.position
          ? {
              ...record,
              event: {
                ...preparedObservationEvent,
                observation: IntegratorGitObservation.cases.NonCommit.make({ candidateText, objectType: "blob" })
              }
            }
          : record
      )
      expect(
        evaluateIntegratorRetryAuthorization(mismatchedObservation, {
          ordinal: IntegratorRunOrdinal.make(2),
          session: preparedAuthorization.session
        })
      ).toMatchObject({ _tag: "Rejected", detail: expect.stringContaining("modern ordinal-one terminal evidence") })

      const delayedQuarantinePosition = JournalPosition.make(100)
      const directionBeforeQuarantine = notPreparedRecords.map((record) => {
        if (record.position === notPreparedAuthorization.quarantine.position) {
          return { ...record, position: delayedQuarantinePosition }
        }
        if (record.position !== notPreparedAuthorization.direction.position) return record
        if (record.event._tag !== "IntegrationQuarantineDirectionApplied") return record
        const fingerprint = IntegrationQuarantineDirectionFingerprint.make({
          ...record.event.fingerprint,
          quarantineAt: delayedQuarantinePosition
        })
        return {
          ...record,
          event: IntegrationQuarantineDirectionAppliedEvent.make({ ...record.event, fingerprint }),
          key: integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(fingerprint))
        }
      })
      expect(evaluateIntegratorRetryAuthorization(directionBeforeQuarantine, runTwo)).toMatchObject({
        _tag: "Rejected",
        detail: expect.stringContaining("no exact earlier ordinal-one quarantine")
      })

      const duplicateLineage = {
        ...notPreparedAuthorization.observation,
        key: JournalRecordKey.make("integrator-retry:duplicate-lineage-observation"),
        position: JournalPosition.make(Number(notPreparedAuthorization.observation.position) + 1)
      }
      expect(evaluateIntegratorRetryAuthorization([...notPreparedRecords, duplicateLineage], runTwo)).toMatchObject({
        _tag: "Rejected",
        detail: expect.stringContaining("fresh matching target-lineage")
      })
    })
  )
})
