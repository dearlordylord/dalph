import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Option, Ref, Schema, Stream } from "effect"
import { expect } from "vitest"
import {
  EvidenceDigest,
  EvidenceReference,
  AttemptId,
  GitCommitSha,
  IntegrationTargetRef,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorReport,
  RunId,
  TaskId
} from "@dalph/contracts"
import {
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  JournalStore,
  memoryJournalTestLayer,
  plannedAttemptExecutorWorkReportedRecordKey,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { AuthoredScenarioCassette } from "../../src/cassettes/authored-domain.js"
import { controlledExecutorLayer } from "../../src/cassettes/authored-adapters.js"
import { makeStoryCursor } from "../../src/cassettes/authored-cursor.js"
import {
  afterAuthoredExecutorReadiness,
  appendAuthoredJournalEvent,
  makeAuthoredExecutorReadiness,
  makeAuthoredProviderReadiness,
  releaseAuthoredIntegratorReadinessFromAcceptedWorkReport
} from "../../src/cassettes/authored-provider-readiness.js"
import { deliveryInvariantStoryAuthoredCassette } from "../../src/cassettes/catalog.js"

const acceptedReport = (attemptId: AttemptId, runId: RunId, commit: GitCommitSha) =>
  PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
    correlation: { attemptId, runId },
    result: {
      _tag: "Accepted",
      acceptedResult: {
        commit,
        evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("1".repeat(64)) })
      }
    }
  })

it.effect("releases only the exact controlled provider source without using time or cursor polling", () =>
  Effect.gen(function* () {
    const relation = deliveryInvariantStoryAuthoredCassette.controlledProviderReadiness?.[0]
    if (relation === undefined) return yield* Effect.die("delivery invariant story has no provider readiness relation")
    const readiness = yield* makeAuthoredProviderReadiness([relation])

    expect(
      yield* readiness.releaseSource(
        relation.source.correlation,
        IntegratorCandidateText.make("refs/heads/dalph/foreign-candidate")
      )
    ).toBe(false)
    expect(Option.isNone(yield* readiness.pollTarget(relation.target))).toBe(true)

    expect(yield* readiness.releaseSource(relation.source.correlation, relation.source.candidateText)).toBe(true)
    expect(Option.isSome(yield* readiness.pollTarget(relation.target))).toBe(true)
    yield* readiness.assertAllReleased()
  })
)

it("rejects a controlled provider relation whose exact source is absent", () => {
  const relation = deliveryInvariantStoryAuthoredCassette.controlledProviderReadiness?.[0]
  expect(relation).toBeDefined()
  expect(() =>
    Schema.decodeUnknownSync(AuthoredScenarioCassette)({
      ...deliveryInvariantStoryAuthoredCassette,
      controlledProviderReadiness: [
        { ...relation, source: { ...relation?.source, candidateText: "refs/heads/dalph/missing-candidate" } }
      ]
    })
  ).toThrow(/must name one exact target, Integrator session, and candidate observation/)
})

it("authors early target selection before the exact candidate fact that releases provider readiness", () => {
  const relation = deliveryInvariantStoryAuthoredCassette.controlledProviderReadiness?.[0]
  expect(relation).toBeDefined()
  if (relation === undefined) return
  const targetIndex = deliveryInvariantStoryAuthoredCassette.story.findIndex(
    (item) =>
      item._tag === "DalphSelects" &&
      item.operation._tag === "ReconcileTaskWorktree" &&
      item.operation.attemptId === relation.target.attemptId &&
      item.operation.taskId === relation.target.taskId
  )
  const sourceIndex = deliveryInvariantStoryAuthoredCassette.story.findIndex(
    (item) => item._tag === "IntegratorGitObservationReturned" && item.candidateText === relation.source.candidateText
  )

  expect(targetIndex).toBeGreaterThanOrEqual(0)
  expect(sourceIndex).toBeGreaterThan(targetIndex)
})

it.effect("contacts the exact Begin provider only after its exact successful promotion", () =>
  Effect.gen(function* () {
    const relation = deliveryInvariantStoryAuthoredCassette.controlledExecutorReadiness?.[0]
    if (relation === undefined) return yield* Effect.die("delivery invariant story has no executor readiness relation")
    const readiness = yield* makeAuthoredExecutorReadiness([relation])
    const providerCalls = yield* Ref.make(0)
    const call = yield* afterAuthoredExecutorReadiness(
      readiness,
      relation.target,
      Ref.update(providerCalls, (count) => count + 1)
    ).pipe(Effect.forkScoped({ startImmediately: true }))

    expect(yield* Ref.get(providerCalls)).toBe(0)
    expect(call.pollUnsafe()).toBeUndefined()
    expect(
      yield* readiness.releaseSource({
        ...relation.source,
        candidateCommit: GitCommitSha.make("ffffffffffffffffffffffffffffffffffffffff")
      })
    ).toBe(false)
    expect(yield* Ref.get(providerCalls)).toBe(0)

    expect(yield* readiness.releaseSource(relation.source)).toBe(true)
    yield* Fiber.join(call)
    expect(yield* Ref.get(providerCalls)).toBe(1)
    expect(yield* readiness.releaseSource(relation.source)).toBe(false)
    expect(yield* Ref.get(providerCalls)).toBe(1)
    yield* readiness.assertAllReleased()
  })
)

it("rejects executor readiness relations with a missing promotion, task, or target ref", () => {
  const relation = deliveryInvariantStoryAuthoredCassette.controlledExecutorReadiness?.[0]
  if (relation === undefined) return expect.fail("delivery invariant story has no executor readiness relation")
  const decodeRelation = (replacement: NonNullable<typeof relation>) =>
    Schema.decodeUnknownSync(AuthoredScenarioCassette)({
      ...deliveryInvariantStoryAuthoredCassette,
      controlledExecutorReadiness: [replacement]
    })
  expect(() =>
    decodeRelation({ ...relation, source: { ...relation.source, candidateCommit: GitCommitSha.make("9".repeat(40)) } })
  ).toThrow(/must name one exact successful promotion, worktree selection, and Begin result/)
  expect(() =>
    decodeRelation({ ...relation, target: { ...relation.target, taskId: TaskId.make("foreign-task") } })
  ).toThrow(/must name one exact successful promotion, worktree selection, and Begin result/)
  expect(() =>
    decodeRelation({
      ...relation,
      source: {
        ...relation.source,
        integrationTarget: {
          ...relation.source.integrationTarget,
          ref: IntegrationTargetRef.make("refs/heads/foreign")
        }
      }
    })
  ).toThrow(/must name one exact successful promotion, worktree selection, and Begin result/)
})

it.effect("releases the exact C Integrator request only after X's accepted lifecycle change", () =>
  Effect.gen(function* () {
    const relation = deliveryInvariantStoryAuthoredCassette.controlledIntegratorReadiness?.[0]
    const unrelated = deliveryInvariantStoryAuthoredCassette.controlledProviderReadiness?.[0]?.source.correlation
    if (relation === undefined || unrelated === undefined) {
      return yield* Effect.die("delivery invariant story has no Integrator readiness relation")
    }
    const readiness = yield* makeAuthoredProviderReadiness([], [relation])
    const target = yield* readiness
      .awaitIntegratorTarget(relation.target.correlation)
      .pipe(Effect.as("released" as const), Effect.forkScoped({ startImmediately: true }))

    expect(Option.isNone(yield* readiness.pollIntegratorTarget(relation.target.correlation))).toBe(true)
    expect(target.pollUnsafe()).toBeUndefined()
    expect(Option.isNone(yield* readiness.pollIntegratorTarget(unrelated))).toBe(true)
    yield* readiness.awaitIntegratorTarget(unrelated)

    expect(
      yield* releaseAuthoredIntegratorReadinessFromAcceptedWorkReport(
        readiness,
        PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: { attemptId: relation.source.attemptId, runId: RunId.make("unrelated-executing-projection") }
        })
      )
    ).toBe(false)
    expect(
      yield* releaseAuthoredIntegratorReadinessFromAcceptedWorkReport(
        readiness,
        PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation: { attemptId: relation.source.attemptId, runId: RunId.make("unaccepted-passive-change") },
          result: { _tag: "Completed" }
        })
      )
    ).toBe(false)
    expect(
      yield* readiness.releaseIntegratorSource({
        ...relation.source,
        acceptedCommit: GitCommitSha.make("f".repeat(40))
      })
    ).toBe(false)
    expect(target.pollUnsafe()).toBeUndefined()

    expect(yield* readiness.releaseIntegratorSource(relation.source)).toBe(true)
    expect(yield* Fiber.join(target)).toBe("released")
    expect(yield* readiness.releaseIntegratorSource(relation.source)).toBe(false)
    yield* readiness.assertAllReleased()
  })
)

it.effect("keeps Integrator pending after passive pull until the exact report append is accepted", () =>
  Effect.gen(function* () {
    const relation = deliveryInvariantStoryAuthoredCassette.controlledIntegratorReadiness?.[0]
    const passive = deliveryInvariantStoryAuthoredCassette.story.find(
      (item) =>
        item._tag === "PlannedAttemptExecutorPassiveLifecycleChanged" &&
        item.report.attemptId === relation?.source.attemptId
    )
    if (relation === undefined || passive?._tag !== "PlannedAttemptExecutorPassiveLifecycleChanged") {
      return yield* Effect.die("delivery invariant story has no passive Integrator readiness source")
    }
    const readiness = yield* makeAuthoredProviderReadiness([], [relation])
    const cursor = yield* makeStoryCursor([
      { _tag: "PlannedAttemptExecutorProjectionReturned", report: passive.report },
      passive
    ])
    const runId = RunId.make("passive-readiness-boundary")
    const observation = yield* Effect.gen(function* () {
      const lifecycle = yield* PlannedAttemptExecutorLifecycleObservation
      return yield* lifecycle.attach({ attemptId: relation.source.attemptId, runId })
    }).pipe(
      Effect.provide(
        controlledExecutorLayer({
          beforeExecutorReport: () => Effect.void,
          cursor,
          runId,
          survivingReports: yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map()),
          unresolvedLostResponses: yield* Ref.make<ReadonlySet<string>>(new Set())
        })
      )
    )

    expect(observation.current).toMatchObject({ _tag: "Exact", report: { _tag: "ExecutorWorkTerminal" } })
    expect(Option.isNone(yield* readiness.pollIntegratorTarget(relation.target.correlation))).toBe(true)
    expect(Option.isSome(yield* Stream.runHead(observation.changes))).toBe(true)
    expect(Option.isNone(yield* readiness.pollIntegratorTarget(relation.target.correlation))).toBe(true)
    const appendRelease = yield* Deferred.make<void>()
    const report = acceptedReport(relation.source.attemptId, runId, relation.source.acceptedCommit)
    const ordinal = PlannedAttemptExecutorReportOrdinal.make(1)
    const event = PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal,
      report,
      version: workflowJournalEventVersion
    })
    const publication = yield* Effect.gen(function* () {
      const journal = yield* JournalStore
      return yield* appendAuthoredJournalEvent({
        afterAcceptedAppend: Effect.void,
        append: Deferred.await(appendRelease).pipe(
          Effect.andThen(
            journal.append(
              runId,
              plannedAttemptExecutorWorkReportedRecordKey(report.correlation.attemptId, ordinal),
              event
            )
          )
        ),
        event,
        readiness
      })
    }).pipe(Effect.provide(memoryJournalTestLayer), Effect.forkScoped({ startImmediately: true }))
    expect(publication.pollUnsafe()).toBeUndefined()
    expect(Option.isNone(yield* readiness.pollIntegratorTarget(relation.target.correlation))).toBe(true)
    yield* Deferred.succeed(appendRelease, undefined)
    yield* Fiber.join(publication)
    expect(Option.isSome(yield* readiness.pollIntegratorTarget(relation.target.correlation))).toBe(true)
    expect(
      yield* releaseAuthoredIntegratorReadinessFromAcceptedWorkReport(
        readiness,
        acceptedReport(relation.source.attemptId, runId, relation.source.acceptedCommit)
      )
    ).toBe(false)
    expect(yield* cursor.storyPosition).toBe(2)
    yield* readiness.assertAllReleased()
  })
)

it.effect(
  "does not release Integrator readiness when the report append fails, is interrupted, or carries a foreign report",
  () =>
    Effect.gen(function* () {
      const relation = deliveryInvariantStoryAuthoredCassette.controlledIntegratorReadiness?.[0]
      if (relation === undefined)
        return yield* Effect.die("delivery invariant story has no Integrator readiness relation")
      const readiness = yield* makeAuthoredProviderReadiness([], [relation])
      const runId = RunId.make("failed-publication")
      const exact = acceptedReport(relation.source.attemptId, runId, relation.source.acceptedCommit)
      const ordinal = PlannedAttemptExecutorReportOrdinal.make(1)
      const event = PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal,
        report: exact,
        version: workflowJournalEventVersion
      })
      const failed = yield* appendAuthoredJournalEvent({
        afterAcceptedAppend: Effect.void,
        append: Effect.fail("append failed"),
        event,
        readiness
      }).pipe(Effect.exit)
      expect(Exit.isFailure(failed)).toBe(true)
      expect(Option.isNone(yield* readiness.pollIntegratorTarget(relation.target.correlation))).toBe(true)

      const appendStarted = yield* Deferred.make<void>()
      const interrupted = yield* appendAuthoredJournalEvent({
        afterAcceptedAppend: Effect.void,
        append: Deferred.succeed(appendStarted, undefined).pipe(Effect.andThen(Effect.never)),
        event,
        readiness
      }).pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Deferred.await(appendStarted)
      yield* Fiber.interrupt(interrupted)
      expect(Option.isNone(yield* readiness.pollIntegratorTarget(relation.target.correlation))).toBe(true)

      const foreign = acceptedReport(
        AttemptId.make("attempt:foreign:0"),
        RunId.make("foreign-report"),
        relation.source.acceptedCommit
      )
      const foreignOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
      const foreignEvent = PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: foreignOrdinal,
        report: foreign,
        version: workflowJournalEventVersion
      })
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* appendAuthoredJournalEvent({
          afterAcceptedAppend: Effect.void,
          append: journal.append(
            foreign.correlation.runId,
            plannedAttemptExecutorWorkReportedRecordKey(foreign.correlation.attemptId, foreignOrdinal),
            foreignEvent
          ),
          event: foreignEvent,
          readiness
        })
      }).pipe(Effect.provide(memoryJournalTestLayer))
      expect(Option.isNone(yield* readiness.pollIntegratorTarget(relation.target.correlation))).toBe(true)

      const unaccepted = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
        correlation: { attemptId: relation.source.attemptId, runId: RunId.make("unaccepted-report") },
        result: { _tag: "Completed" }
      })
      const unacceptedOrdinal = PlannedAttemptExecutorReportOrdinal.make(3)
      const unacceptedEvent = PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: unacceptedOrdinal,
        report: unaccepted,
        version: workflowJournalEventVersion
      })
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* appendAuthoredJournalEvent({
          afterAcceptedAppend: Effect.void,
          append: journal.append(
            unaccepted.correlation.runId,
            plannedAttemptExecutorWorkReportedRecordKey(unaccepted.correlation.attemptId, unacceptedOrdinal),
            unacceptedEvent
          ),
          event: unacceptedEvent,
          readiness
        })
      }).pipe(Effect.provide(memoryJournalTestLayer))
      expect(Option.isNone(yield* readiness.pollIntegratorTarget(relation.target.correlation))).toBe(true)
    })
)

it("authors C lineage preflight before X acceptance and C integration after it", () => {
  const relation = deliveryInvariantStoryAuthoredCassette.controlledIntegratorReadiness?.[0]
  expect(relation).toBeDefined()
  if (relation === undefined) return
  const lineageIndex = deliveryInvariantStoryAuthoredCassette.story.findIndex(
    (item) =>
      item._tag === "DalphSelects" &&
      item.operation._tag === "ReadTargetLineage" &&
      item.operation.attemptId === relation.target.correlation.plannedAttempt.attemptId
  )
  const sourceIndex = deliveryInvariantStoryAuthoredCassette.story.findIndex(
    (item) =>
      item._tag === "PlannedAttemptExecutorPassiveLifecycleChanged" &&
      item.report.attemptId === relation.source.attemptId
  )
  const targetIndex = deliveryInvariantStoryAuthoredCassette.story.findIndex(
    (item) =>
      item._tag === "IntegratorRequestReceived" &&
      Schema.toEquivalence(IntegratorSessionCorrelation)(item.correlation, relation.target.correlation)
  )

  expect(lineageIndex).toBeGreaterThanOrEqual(0)
  expect(sourceIndex).toBeGreaterThan(lineageIndex)
  expect(targetIndex).toBeGreaterThan(sourceIndex)
})

it("rejects missing and duplicate Integrator readiness endpoints", () => {
  const relation = deliveryInvariantStoryAuthoredCassette.controlledIntegratorReadiness?.[0]
  expect(relation).toBeDefined()
  if (relation === undefined) return
  expect(() =>
    Schema.decodeUnknownSync(AuthoredScenarioCassette)({
      ...deliveryInvariantStoryAuthoredCassette,
      controlledIntegratorReadiness: [{ ...relation, source: { ...relation.source, acceptedCommit: "9".repeat(40) } }]
    })
  ).toThrow(/must name one exact accepted passive lifecycle change and Integrator request/)
  expect(() =>
    Schema.decodeUnknownSync(AuthoredScenarioCassette)({
      ...deliveryInvariantStoryAuthoredCassette,
      controlledIntegratorReadiness: [relation, relation]
    })
  ).toThrow(/must be one-to-one/)
})
