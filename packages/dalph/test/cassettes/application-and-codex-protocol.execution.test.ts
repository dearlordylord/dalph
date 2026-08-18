import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  maintainedApplicationExitProtocolCassetteCatalog,
  maintainedCodexPlannedAttemptExecutorCassetteCatalog,
  runApplicationExitProtocolCassette,
  runCodexPlannedAttemptExecutorCassette
} from "../../src/cassettes/index.js"
import { codexAttemptRecordOrNull } from "../../src/cassettes/codex-planned-attempt-executor-cassette.js"

it("reports an absent private Codex record as null", () => {
  expect(codexAttemptRecordOrNull(undefined)).toBeNull()
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
    const [first, lost, accepted, suspended] = runs

    expect(first?.reports.map(({ _tag }) => _tag)).toEqual(["Running"])
    expect(first?.threadStartCount).toBe(1)
    expect(first?.turnStartCount).toBe(1)
    expect(first?.activeActivity._tag).toBe("ExactLive")
    expect(lost?.reports.map(({ _tag }) => _tag)).toEqual(["Running"])
    expect(lost?.turnStartCount).toBe(1)
    expect(accepted?.reports.map(({ _tag }) => _tag)).toEqual(["Running", "Terminal"])
    expect(accepted?.reports[1]?._tag === "Terminal" && accepted.reports[1].result._tag).toBe("Accepted")
    expect(accepted?.privateRecord?._tag).toBe("Terminal")
    expect(suspended?.reports.map(({ _tag }) => _tag)).toEqual(["Running", "SafelySuspended"])
    expect(suspended?.privateRecord?._tag).toBe("SafelySuspended")
  }).pipe(Effect.provide(NodeCrypto.layer))
)
