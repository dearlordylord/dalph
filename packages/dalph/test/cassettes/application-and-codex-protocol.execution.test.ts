import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import {
  maintainedApplicationExitProtocolCassetteCatalog,
  maintainedCodexPlannedAttemptExecutorCassetteCatalog,
  CodexPlannedAttemptExecutorRecordedCassette,
  recordCodexPlannedAttemptExecutorCassette,
  runApplicationExitProtocolCassette,
  runCodexPlannedAttemptExecutorCassette
} from "../../src/cassettes/index.js"
import { codexAttemptRecordTagOrNull } from "../../src/cassettes/codex-planned-attempt-executor-cassette.js"

it("reports an absent private Codex record tag as null", () => {
  expect(codexAttemptRecordTagOrNull(undefined)).toBeNull()
})

it.effect("runs maintained application Exit stories through the production request boundary", () =>
  Effect.gen(function* () {
    const idle = yield* Effect.scoped(
      runApplicationExitProtocolCassette(maintainedApplicationExitProtocolCassetteCatalog.idleSuccess)
    )
    const failed = yield* Effect.scoped(
      runApplicationExitProtocolCassette(maintainedApplicationExitProtocolCassetteCatalog.drainFailure)
    )

    expect(idle.result._tag).toBe("Succeeded")
    expect(idle.quickDrains).toEqual(["ProcessLocalResources", "CoordinatorLock"])
    expect(idle.processEndDecisions).toEqual([{ _tag: "RequestGracefulTermination", status: 0 }])
    expect(idle.trace.map(({ _tag }) => _tag)).toEqual([
      "ExitRequested",
      "AdmissionCutoffClosed",
      "ProducedJournalWritesFlushed",
      "ProcessLocalResourcesClosed",
      "CoordinatorLockReleased",
      "ExitResultReported",
      "ProcessEndRequested"
    ])

    expect(failed.result._tag).toBe("Failed")
    expect(failed.quickDrains.toSorted()).toEqual(["CoordinatorLock", "ProcessLocalResources"])
    expect(failed.processEndDecisions).toEqual([{ _tag: "RequestForcedTermination", status: 1 }])
  })
)

it.effect("runs maintained Codex executor stories through the concrete production executor", () =>
  Effect.gen(function* () {
    const runs = yield* Effect.forEach(
      Object.values(maintainedCodexPlannedAttemptExecutorCassetteCatalog),
      runCodexPlannedAttemptExecutorCassette
    )
    const findScenario = (scenario: (typeof runs)[number]["cassette"]["scenario"]) =>
      runs.find((run) => run.cassette.scenario === scenario)
    const first = findScenario("FirstTurnExecutorWorkExecuting")
    const lost = findScenario("LostTurnResponse")
    const accepted = findScenario("AcceptedExecutorWorkTerminal")
    const suspended = findScenario("ExecutorWorkSafelySuspended")
    const replacement = findScenario("PurgedWorkUnitReplacement")
    const unreadable = findScenario("PurgedWorkUnitUnreadable")
    const writerConflict = findScenario("PurgedWorkUnitWriterConflict")
    const sessionAbsent = findScenario("PurgedWorkUnitSessionAbsent")
    const correlationConflict = findScenario("PurgedWorkUnitCorrelationConflict")
    const stillPresent = findScenario("PurgedWorkUnitStillPresent")
    const requestConflict = findScenario("PurgedWorkUnitRequestConflict")

    expect(first?.reports.map(({ _tag }) => _tag)).toEqual(["ExecutorWorkExecuting"])
    expect(first?.threadStartCount).toBe(1)
    expect(first?.turnStartCount).toBe(1)
    expect(first?.activeActivity._tag).toBe("ExactLive")
    expect(lost?.reports.map(({ _tag }) => _tag)).toEqual(["ExecutorWorkExecuting"])
    expect(lost?.turnStartCount).toBe(1)
    expect(accepted?.reports.map(({ _tag }) => _tag)).toEqual(["ExecutorWorkExecuting", "ExecutorWorkTerminal"])
    expect(accepted?.reports[1]?._tag === "ExecutorWorkTerminal" && accepted.reports[1].result._tag).toBe("Accepted")
    expect(accepted?.privateRecordTag).toBe("Terminal")
    expect(suspended?.reports.map(({ _tag }) => _tag)).toEqual(["ExecutorWorkExecuting", "ExecutorWorkSafelySuspended"])
    expect(suspended?.privateRecordTag).toBe("SafelySuspended")

    expect(replacement?.replacementResultTag).toBe("Replaced")
    expect(replacement?.reports.map(({ _tag }) => _tag)).toEqual(["ExecutorWorkExecuting"])
    expect(replacement?.threadStartCount).toBe(0)
    expect(replacement?.turnStartCount).toBe(1)
    expect(replacement?.purgedWorkUnitPreserved).toBe(true)
    expect(replacement?.distinctReplacementWorkUnit).toBe(true)
    // The passive observation returns Executing without rewriting the exact
    // replacement-boundary observation into another durable private state.
    expect(replacement?.privateRecordTag).toBe("TurnObserved")
    expect(replacement?.authorityObservationCount).toBe(2)
    expect(replacement?.authorityCallsBeforeProviderBoundary).toBe(2)
    expect(replacement?.authorityRequestMatches).toBe(true)
    expect(replacement?.authorityProofMatchesRequest).toBe(true)
    expect(replacement?.authorityGitProjectionStable).toBe(true)
    expect(replacement?.authorityRetainedWorkEvidenceMatches).toBe(true)
    expect(replacement?.downstreamBoundaryCalls).toEqual({ cleanup: 0, integration: 0, semanticReview: 0 })

    for (const [run, result, expectedAuthorityCalls, expectedRequestMatch] of [
      [unreadable, "ProviderTemporarilyUnreadable", 1, true],
      [writerConflict, "ExclusiveRetainedOwnershipUnproved", 1, true],
      [sessionAbsent, "TaskWorkSessionAbsent", 0, null],
      [correlationConflict, "CorrelationConflict", 1, true],
      [stillPresent, "PurgeUnconfirmed", 0, null],
      [requestConflict, "RequestIdentityReuseContradiction", 0, null]
    ] as const) {
      expect(run?.replacementResultTag).toBe(result)
      expect(run?.reports).toEqual([])
      expect(run?.turnStartCount).toBe(0)
      expect(run?.purgedWorkUnitPreserved).toBeNull()
      expect(run?.distinctReplacementWorkUnit).toBeNull()
      expect(run?.authorityObservationCount).toBe(expectedAuthorityCalls)
      expect(run?.authorityCallsBeforeProviderBoundary).toBeNull()
      expect(run?.authorityRequestMatches).toBe(expectedRequestMatch)
      expect(run?.authorityProofMatchesRequest).toBeNull()
      expect(run?.authorityGitProjectionStable).toBeNull()
      expect(run?.authorityRetainedWorkEvidenceMatches).toBeNull()
      expect(run?.downstreamBoundaryCalls).toEqual({ cleanup: 0, integration: 0, semanticReview: 0 })
    }
    const recorded = runs.map(recordCodexPlannedAttemptExecutorCassette)
    for (const projection of recorded) {
      expect(yield* Schema.decodeUnknownEffect(CodexPlannedAttemptExecutorRecordedCassette)(projection)).toEqual(
        projection
      )
    }
    const serialized = JSON.stringify(recorded)
    expect(serialized).not.toContain("codex-cassette-thread")
    expect(serialized).not.toContain("codex-cassette-turn-u1")
    expect(serialized).not.toContain("codex-cassette-token-u1")
    expect(serialized).not.toContain("TurnBoundaryCrossingBegan")
  }).pipe(Effect.provide(NodeCrypto.layer))
)
