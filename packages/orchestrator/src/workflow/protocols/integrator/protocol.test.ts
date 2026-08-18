import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
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
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import {
  Integrator,
  IntegratorCallFailure,
  IntegratorGit,
  IntegratorGitReadFailure,
  IntegratorJournalContradiction,
  IntegratorTargetHeadChanged,
  IntegratorTargetLineageObservationChanged,
  IntegratorPreparationInput,
  deriveIntegratorState,
  prepareIntegrationCandidate,
  type IntegratorRequest
} from "./protocol.js"
import {
  appendIntegratorSessionIfNeeded,
  hasMatchingIntegratorTargetLineageObservation,
  integratorCorrelationFor,
  readRecordedIntegratorSession
} from "./session.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  type IntegratorProtocolResult,
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

    return { integratorCalls, gitCalls, gitCandidates, journal, records, readRecords: Ref.get(records), run }
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
          event._tag === "IntegratorResultRecorded"
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
          event._tag === "IntegratorCandidateGitObserved"
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
      const state = deriveIntegratorState(records, responsibility)

      expect(result._tag).toBe("PreparedCandidate")
      expect(replay._tag).toBe("PreparedCandidate")
      expect(result._tag === "PreparedCandidate" ? result.candidateCommit : undefined).toBe(canonicalCandidateCommit)
      expect(result._tag === "PreparedCandidate" ? result.candidateText : undefined).toBe(candidateText)
      expect(calls).toHaveLength(1)
      expect(gitCalls).toBe(1)
      expect(state._tag).toBe("GitQualifiedPrepared")
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
          "IntegratorResultRecorded",
          "IntegratorCandidateGitReadIntended",
          "IntegratorCandidateGitObserved"
        ]
      )
      const sessionRecord = records.find(({ event }) => event._tag === "IntegratorSessionFixed")
      expect(sessionRecord?.position).toBeGreaterThan(targetLineageObservedAt)
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
      expect(deriveIntegratorState(recordsAfterFailure, responsibility)._tag).toBe("SessionUnfinished")
      expect(second._tag).toBe("PreparedCandidate")
      expect(requests).toHaveLength(2)
      expect(requests[0]?.correlation.sessionId).toBe(requests[1]?.correlation.sessionId)
      expect(requests[0]?.correlation.candidateResource).toBe(requests[1]?.correlation.candidateResource)
      expect(records.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
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
      expect(deriveIntegratorState(records, responsibility)._tag).toBe("NotPrepared")
      expect(records.filter(({ event }) => event._tag.startsWith("Integrator")).map(({ event }) => event._tag)).toEqual(
        ["IntegratorSessionFixed", "IntegratorResultRecorded"]
      )
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
      expect(deriveIntegratorState(records, responsibility)._tag).toBe("CandidateRejected")
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
      expect(deriveIntegratorState(records, responsibility)._tag).toBe("Absent")
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
      expect(records.filter(({ event }) => event._tag === "IntegratorResultRecorded")).toHaveLength(1)
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
      expect(deriveIntegratorState(recordsAfterFailure, responsibility)._tag).toBe("PreparedAwaitingGit")
      expect(
        recordsAfterFailure.filter(({ event }) => event._tag.startsWith("Integrator")).map(({ event }) => event._tag)
      ).toEqual(["IntegratorSessionFixed", "IntegratorResultRecorded", "IntegratorCandidateGitReadIntended"])
      expect(second._tag).toBe("PreparedCandidate")
      expect(calls).toHaveLength(1)
      expect(gitCalls).toBe(2)
      expect(records.filter(({ event }) => event._tag === "IntegratorCandidateGitReadIntended")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "IntegratorCandidateGitObserved")).toHaveLength(1)
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

  it.effect("Missing and NonCommit Git objects never qualify as candidates", () =>
    Effect.gen(function* () {
      const missing = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(IntegratorGitObservation.cases.Missing.make({ candidateText }))
      )
      const nonCommit = yield* makeHarness(
        (request) => Effect.succeed(prepared(request)),
        successfulGitRead(IntegratorGitObservation.cases.NonCommit.make({ candidateText, objectType: "tree" }))
      )

      const missingResult = yield* missing.run(compatibleInput())
      const nonCommitResult = yield* nonCommit.run(compatibleInput())

      expect(missingResult._tag).toBe("CandidateRejected")
      expect(nonCommitResult._tag).toBe("CandidateRejected")
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
      const result = pristine.find(({ event }) => event._tag === "IntegratorResultRecorded")
      const intent = pristine.find(({ event }) => event._tag === "IntegratorCandidateGitReadIntended")
      const observed = pristine.find(({ event }) => event._tag === "IntegratorCandidateGitObserved")
      const lineageIntent = pristine.find(({ event }) => event._tag === "GitReadIntentRecorded")
      const lineage = pristine.find(({ event }) => event._tag === "TargetLineageObserved")
      if (
        session?.event._tag !== "IntegratorSessionFixed" ||
        result?.event._tag !== "IntegratorResultRecorded" ||
        intent?.event._tag !== "IntegratorCandidateGitReadIntended" ||
        observed?.event._tag !== "IntegratorCandidateGitObserved" ||
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
        expect(deriveIntegratorState(records, responsibility), label).toMatchObject({ _tag: "Contradiction" })
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
          replaceEvent(pristine, observed.key, { ...observed.event, correlation: foreignCorrelation }),
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
})
