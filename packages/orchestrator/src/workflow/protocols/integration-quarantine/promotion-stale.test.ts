import { GitCommitSha } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import {
  memoryJournalTestLayer,
  memoryJournalTestLayerFromPartitionRecords
} from "../../../workflow-journal/adapters/memory-store.js"
import {
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey,
  targetPromotionStaleRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  InRunJournal,
  type InRunJournalService,
  JournalStore,
  JournalStoreContradiction,
  type JournalRecord
} from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { IntegratorSessionId } from "../integrator/events.js"
import {
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionCompareAndSetFailure,
  TargetPromotionGit,
  TargetPromotionGitReadFailure,
  TargetPromotionGitReadObservation,
  targetPromotionCorrelationFor,
  TargetPromotionIntendedEvent,
  TargetPromotionStaleEvent,
  TargetPromotionStaleObservation,
  TargetPromotionTerminalBasis
} from "../target-promotion/events.js"
import { runTargetPromotion } from "../target-promotion/protocol.js"
import {
  appendPromotionStaleIntegrationQuarantine,
  IntegrationPromotionStaleQuarantineRejected,
  pendingPromotionStaleIntegrationQuarantineFor
} from "./promotion-stale.js"
import { deriveIntegrationQuarantineState } from "./state.js"

const candidate = integrationFinalityFixture.qualifiedCandidate
const correlation = targetPromotionCorrelationFor(candidate)
const runId = candidate.run.session.plannedAttempt.runId
const target = FixtureTarget.make("promotion-stale-quarantine-target")
const attemptOrdinal = TargetPromotionAttemptOrdinal.make(1)
const changedHead = GitCommitSha.make("4".repeat(40))

type StaleKind = "BeforeFirstAttempt" | "DirectRejectionAfterAttempt" | "StaleAfterMissingAttemptIntent"

const appendStaleScenario = Effect.fn("PromotionStaleQuarantineTest.appendScenario")(function* (kind: StaleKind) {
  const journal = yield* JournalStore
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
  yield* journal.append(
    runId,
    targetPromotionIntentRecordKey(correlation.requestId),
    TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  )
  const afterAttempt = kind !== "BeforeFirstAttempt"
  if (afterAttempt && kind !== "StaleAfterMissingAttemptIntent") {
    yield* journal.append(
      runId,
      targetPromotionAttemptIntentRecordKey(correlation.requestId, attemptOrdinal),
      TargetPromotionAttemptIntendedEvent.make({
        attemptOrdinal,
        correlation,
        reason: TargetPromotionAttemptReason.cases.Initial.make({
          observedHeadSha: candidate.run.session.expectedTargetHead
        }),
        version: workflowJournalEventVersion
      })
    )
  }
  return yield* journal.append(
    runId,
    targetPromotionStaleRecordKey(correlation.requestId),
    TargetPromotionStaleEvent.make({
      basis: afterAttempt
        ? TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal })
        : TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}),
      correlation,
      observation:
        kind === "DirectRejectionAfterAttempt"
          ? TargetPromotionStaleObservation.cases.CompareAndSetRejected.make({ observedHeadSha: changedHead })
          : TargetPromotionStaleObservation.cases.ReconciledCandidateNotInAncestry.make({
              observedHeadSha: changedHead
            }),
      version: workflowJournalEventVersion
    })
  )
})

const appendQuarantineFor = Effect.fn("PromotionStaleQuarantineTest.appendQuarantineFor")(function* (kind: StaleKind) {
  const stale = yield* appendStaleScenario(kind)
  return yield* appendPromotionStaleIntegrationQuarantine({ correlation, targetPromotionStaleAt: stale.position })
})

it.effect("rejects quarantine after a stale pre-request read or a missing compare-and-set intent", () =>
  Effect.gen(function* () {
    for (const kind of ["BeforeFirstAttempt", "StaleAfterMissingAttemptIntent"] as const) {
      const failure = yield* appendQuarantineFor(kind).pipe(Effect.provide(memoryJournalTestLayer), Effect.flip)
      expect(failure).toBeInstanceOf(IntegrationPromotionStaleQuarantineRejected)
    }
  })
)

it.effect("records one quarantine after Git directly rejects the exact compare-and-set", () =>
  Effect.gen(function* () {
    const first = yield* appendQuarantineFor("DirectRejectionAfterAttempt")
    const second = yield* appendPromotionStaleIntegrationQuarantine({
      correlation,
      targetPromotionStaleAt:
        first.event.basis._tag === "PromotionStale" ? first.event.basis.targetPromotionStaleAt : first.position
    })
    expect(first.event._tag).toBe("IntegrationQuarantined")
    expect(first.event.basis._tag).toBe("PromotionStale")
    expect(second).toEqual(first)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("reports exact pending quarantine work until the stale evidence is settled", () =>
  Effect.gen(function* () {
    const stale = yield* appendStaleScenario("DirectRejectionAfterAttempt")
    const journal = yield* JournalStore
    expect(pendingPromotionStaleIntegrationQuarantineFor(yield* journal.read(runId), correlation)).toEqual({
      correlation,
      targetPromotionStaleAt: stale.position
    })
    yield* appendPromotionStaleIntegrationQuarantine({ correlation, targetPromotionStaleAt: stale.position })
    expect(pendingPromotionStaleIntegrationQuarantineFor(yield* journal.read(runId), correlation)).toBeUndefined()
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("fails closed for stale-position drift and every ambiguous quarantine append result", () =>
  Effect.gen(function* () {
    const fixture = yield* Effect.gen(function* () {
      const stale = yield* appendStaleScenario("DirectRejectionAfterAttempt")
      const journal = yield* JournalStore
      const prefix = yield* journal.read(runId)
      const winner = yield* appendPromotionStaleIntegrationQuarantine({
        correlation,
        targetPromotionStaleAt: stale.position
      })
      return { prefix, stale, winner, withWinner: yield* journal.read(runId) }
    }).pipe(Effect.provide(memoryJournalTestLayer))
    const input = { correlation, targetPromotionStaleAt: fixture.stale.position }

    const wrongPosition = yield* appendPromotionStaleIntegrationQuarantine({
      ...input,
      targetPromotionStaleAt: JournalPosition.make(Number(fixture.stale.position) + 10)
    }).pipe(Effect.provide(memoryJournalTestLayerFromPartitionRecords({ hot: fixture.prefix })), Effect.flip)
    expect(wrongPosition).toBeInstanceOf(IntegrationPromotionStaleQuarantineRejected)

    const foreignWinner: JournalRecord = {
      ...fixture.winner,
      event: {
        ...fixture.winner.event,
        correlation: { ...fixture.winner.event.correlation, sessionId: IntegratorSessionId.make("foreign-session") }
      }
    }
    const layerFor = (read: InRunJournalService["read"], append: InRunJournalService["append"]) =>
      Layer.succeed(InRunJournal, InRunJournal.of({ append, read }))

    const existingForeign = yield* appendPromotionStaleIntegrationQuarantine(input).pipe(
      Effect.provide(
        layerFor(
          () => Effect.succeed([...fixture.prefix, foreignWinner]),
          () => Effect.die("unused")
        )
      ),
      Effect.flip
    )
    expect(existingForeign).toBeInstanceOf(IntegrationPromotionStaleQuarantineRejected)

    const foreignAppend = yield* appendPromotionStaleIntegrationQuarantine(input).pipe(
      Effect.provide(
        layerFor(
          () => Effect.succeed(fixture.prefix),
          () => Effect.succeed(foreignWinner)
        )
      ),
      Effect.flip
    )
    expect(foreignAppend).toBeInstanceOf(IntegrationPromotionStaleQuarantineRejected)

    const exactReads = yield* Ref.make(0)
    const exactAfterContradiction = yield* appendPromotionStaleIntegrationQuarantine(input).pipe(
      Effect.provide(
        layerFor(
          () =>
            Ref.getAndUpdate(exactReads, (count) => count + 1).pipe(
              Effect.map((count) => (count === 0 ? fixture.prefix : fixture.withWinner))
            ),
          (_requestedRunId, key) =>
            Effect.fail(new JournalStoreContradiction({ existingPosition: fixture.winner.position, key, runId }))
        )
      )
    )
    expect(exactAfterContradiction).toEqual(fixture.winner)

    const missingAfterContradiction = yield* appendPromotionStaleIntegrationQuarantine(input).pipe(
      Effect.provide(
        layerFor(
          () => Effect.succeed(fixture.prefix),
          (_requestedRunId, key) =>
            Effect.fail(new JournalStoreContradiction({ existingPosition: fixture.winner.position, key, runId }))
        )
      ),
      Effect.flip
    )
    expect(missingAfterContradiction).toBeInstanceOf(IntegrationPromotionStaleQuarantineRejected)
  })
)

it.effect("reconstructs promotion-stale quarantine only from one exact earlier compare-and-set intent", () =>
  Effect.gen(function* () {
    const quarantine = yield* appendQuarantineFor("DirectRejectionAfterAttempt")
    const journal = yield* JournalStore
    const records = yield* journal.read(runId)
    const stale = records.find(({ event }) => event._tag === "TargetPromotionStale")
    const attempt = records.find(({ event }) => event._tag === "TargetPromotionAttemptIntended")
    if (stale?.event._tag !== "TargetPromotionStale" || attempt?.event._tag !== "TargetPromotionAttemptIntended") {
      return yield* Effect.die("promotion-stale reconstruction fixture lacks its exact attempt and stale records")
    }
    const staleEvent = stale.event
    const attemptEvent = attempt.event

    expect(deriveIntegrationQuarantineState(records, quarantine.event.correlation.sessionId)._tag).toBe("Quarantined")

    const beforeFirstAttempt: ReadonlyArray<JournalRecord> = records.map((record) =>
      record.position === stale.position
        ? {
            ...record,
            event: TargetPromotionStaleEvent.make({
              ...staleEvent,
              basis: TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({})
            })
          }
        : record
    )
    const withoutAttempt: ReadonlyArray<JournalRecord> = records.filter(
      (record) => record.position !== attempt.position
    )
    const duplicateAttempt: ReadonlyArray<JournalRecord> = [...records, { ...attempt }]
    const foreignAttempt: ReadonlyArray<JournalRecord> = records.map((record) =>
      record.position === attempt.position
        ? {
            ...record,
            event: {
              ...attemptEvent,
              correlation: {
                ...attemptEvent.correlation,
                qualifiedCandidate: {
                  ...attemptEvent.correlation.qualifiedCandidate,
                  candidateCommit: GitCommitSha.make("5".repeat(40))
                }
              }
            }
          }
        : record
    )
    const mismatchedAttempt: ReadonlyArray<JournalRecord> = records.map((record) =>
      record.position === attempt.position
        ? { ...record, event: { ...attemptEvent, attemptOrdinal: TargetPromotionAttemptOrdinal.make(2) } }
        : record
    )

    for (const [label, invalid] of [
      ["BeforeFirstAttempt stale evidence", beforeFirstAttempt],
      ["zero compare-and-set intents", withoutAttempt],
      ["duplicate compare-and-set intents", duplicateAttempt],
      ["foreign promotion attempt", foreignAttempt],
      ["mismatched attempt ordinal", mismatchedAttempt]
    ] as const) {
      const state = deriveIntegrationQuarantineState(invalid, quarantine.event.correlation.sessionId)
      expect(state._tag, label).toBe("Contradiction")
      if (state._tag === "Contradiction") {
        expect(state.detail, label).toContain("exact earlier Journal facts")
      }
    }
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("checks Git after losing the compare-and-set response and records at most one quarantine", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<"compare-and-set" | "read">>([])
    const readCount = yield* Ref.make(0)
    const git = TargetPromotionGit.of({
      compareAndSet: () =>
        Ref.update(calls, (current) => [...current, "compare-and-set" as const]).pipe(
          Effect.andThen(
            Effect.fail(
              new TargetPromotionCompareAndSetFailure({
                candidateCommit: candidate.candidateCommit,
                detail: "Git changed H to H2 but the compare-and-set response was lost",
                expectedHead: candidate.run.session.expectedTargetHead,
                target: candidate.run.session.integrationTarget
              })
            )
          )
        ),
      read: () =>
        Ref.update(calls, (current) => [...current, "read" as const]).pipe(
          Effect.andThen(Ref.getAndUpdate(readCount, (count) => count + 1)),
          Effect.map((count) =>
            TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({
              currentHeadSha: count === 0 ? candidate.run.session.expectedTargetHead : changedHead
            })
          )
        )
    })

    const restartPrefix = yield* Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      )
      const first = yield* runTargetPromotion(candidate).pipe(Effect.provideService(TargetPromotionGit, git))
      expect(first._tag).toBe("PromotionPending")
      return yield* journal.read(runId)
    }).pipe(Effect.provide(memoryJournalTestLayer))
    expect(restartPrefix.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")).toHaveLength(1)
    expect(restartPrefix.filter(({ event }) => event._tag === "TargetPromotionStale")).toHaveLength(0)
    expect(restartPrefix.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(0)
    expect(restartPrefix.some(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")).toBe(false)
    expect(yield* Ref.get(calls)).toEqual(["read", "compare-and-set"])

    const recoveredRecords = yield* Effect.gen(function* () {
      const journal = yield* JournalStore
      const reconciled = yield* runTargetPromotion(candidate).pipe(Effect.provideService(TargetPromotionGit, git))
      expect(reconciled).toMatchObject({
        _tag: "PromotionStale",
        basis: { _tag: "AfterAttempt", attemptOrdinal: 1 },
        observation: { _tag: "ReconciledCandidateNotInAncestry", observedHeadSha: changedHead }
      })
      const records = yield* journal.read(runId)
      const stale = records.find(({ event }) => event._tag === "TargetPromotionStale")
      if (stale?.event._tag !== "TargetPromotionStale") {
        return yield* Effect.die("lost-response reconciliation did not record the exact stale result")
      }
      const firstQuarantine = yield* appendPromotionStaleIntegrationQuarantine({
        correlation: stale.event.correlation,
        targetPromotionStaleAt: stale.position
      })
      const secondQuarantine = yield* appendPromotionStaleIntegrationQuarantine({
        correlation: stale.event.correlation,
        targetPromotionStaleAt: stale.position
      })
      expect(secondQuarantine).toEqual(firstQuarantine)
      expect(firstQuarantine.event.correlation).toEqual(candidate.run.session)
      expect(stale.event.correlation.qualifiedCandidate).toEqual(candidate)
      return yield* journal.read(runId)
    }).pipe(Effect.provide(memoryJournalTestLayerFromPartitionRecords({ hot: restartPrefix })))
    expect(yield* Ref.get(calls)).toEqual(["read", "compare-and-set", "read"])
    expect(recoveredRecords.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")).toHaveLength(1)
    expect(recoveredRecords.filter(({ event }) => event._tag === "TargetPromotionStale")).toHaveLength(1)
    expect(recoveredRecords.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(1)
    expect(recoveredRecords.some(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")).toBe(false)
  })
)

it.effect("does not retry or authorize quarantine when restart cannot read Git", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const calls = yield* Ref.make<ReadonlyArray<"compare-and-set" | "read">>([])
    const readCount = yield* Ref.make(0)
    const readFailure = new TargetPromotionGitReadFailure({
      candidateCommit: candidate.candidateCommit,
      detail: "Git is unavailable during restart reconciliation",
      target: candidate.run.session.integrationTarget
    })
    const git = TargetPromotionGit.of({
      compareAndSet: () =>
        Ref.update(calls, (current) => [...current, "compare-and-set" as const]).pipe(
          Effect.andThen(
            Effect.fail(
              new TargetPromotionCompareAndSetFailure({
                candidateCommit: candidate.candidateCommit,
                detail: "compare-and-set response was lost",
                expectedHead: candidate.run.session.expectedTargetHead,
                target: candidate.run.session.integrationTarget
              })
            )
          )
        ),
      read: () =>
        Ref.update(calls, (current) => [...current, "read" as const]).pipe(
          Effect.andThen(Ref.getAndUpdate(readCount, (count) => count + 1)),
          Effect.flatMap((count) =>
            count === 0
              ? Effect.succeed(
                  TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({
                    currentHeadSha: candidate.run.session.expectedTargetHead
                  })
                )
              : Effect.fail(readFailure)
          )
        )
    })

    expect((yield* runTargetPromotion(candidate).pipe(Effect.provideService(TargetPromotionGit, git)))._tag).toBe(
      "PromotionPending"
    )
    expect(yield* runTargetPromotion(candidate).pipe(Effect.provideService(TargetPromotionGit, git), Effect.flip)).toBe(
      readFailure
    )
    const records = yield* journal.read(runId)
    expect(yield* Ref.get(calls)).toEqual(["read", "compare-and-set", "read"])
    expect(records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")).toHaveLength(1)
    expect(records.filter(({ event }) => event._tag === "TargetPromotionStale")).toHaveLength(0)
    expect(records.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(0)
    expect(records.some(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")).toBe(false)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
