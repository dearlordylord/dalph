import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  expectedRecoveryPrefix,
  recoveryPrefixMismatch,
  replayRecoveryPrefix,
  type RecoveryStoreLane
} from "./recovery-store-lanes.js"
import {
  trackerCompletionRecoveryPrefixes,
  trackerCompletionRecoveryTrace
} from "./tracker-completion-recovery-trace.js"
import { maintainedAuthoredCassetteCatalog, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"

const lanes: ReadonlyArray<RecoveryStoreLane> = ["memory", "sqlite"]

const maintainedCompletionRun = () => {
  return runAuthoredScenarioCassette(
    maintainedAuthoredCassetteCatalog[trackerCompletionRecoveryTrace.cassetteKey]
  ).pipe(Effect.provide(NodeCrypto.layer))
}

it.effect("reopens every tracker-completion cut through memory and SQLite with the same projection", () =>
  Effect.gen(function* () {
    const source = yield* maintainedCompletionRun()
    const prefixes = trackerCompletionRecoveryPrefixes(source.records)
    expect(prefixes).toHaveLength(7)
    if (prefixes.length !== 7) return yield* Effect.die("maintained completion cassette lacks P0-P6 endpoints")

    const executions = yield* Effect.forEach(prefixes, (prefix) =>
      Effect.gen(function* () {
        const expected = yield* expectedRecoveryPrefix(prefix)
        expect(expected.historyTag, `${prefix.cut} must be a legal retained history`).toBe(
          "ValidWorkflowJournalHistory"
        )
        return yield* Effect.forEach(lanes, (lane) =>
          Effect.gen(function* () {
            const actual = yield* replayRecoveryPrefix(prefix, lane)
            const mismatch = recoveryPrefixMismatch(prefix.cut, lane, expected, actual)
            expect(mismatch, `${prefix.cut} / ${lane} (${prefix.endpoint})`).toBeUndefined()
            return { cut: prefix.cut, lane }
          })
        )
      })
    )

    expect(executions.flat()).toHaveLength(trackerCompletionRecoveryTrace.executionCount)
  })
)

it.effect("rejects a recovery cut whose retained prefix or expected projection is inconsistent", () =>
  Effect.gen(function* () {
    const source = yield* maintainedCompletionRun()
    const prefixes = trackerCompletionRecoveryPrefixes(source.records)
    expect(prefixes).toHaveLength(7)
    if (prefixes.length !== 7) return yield* Effect.die("maintained completion cassette lacks P0-P6 endpoints")

    const prefix = prefixes[4]
    if (prefix === undefined) return yield* Effect.die("P4 completion prefix is missing")
    const expected = yield* expectedRecoveryPrefix(prefix)
    const actual = yield* replayRecoveryPrefix(prefix, "sqlite")
    const inconsistent = { ...actual, decodedRecords: actual.decodedRecords.slice(1) }

    expect(recoveryPrefixMismatch("P4", "sqlite", expected, inconsistent)).toBe(
      "recovery prefix P4 / sqlite: canonical decoded history differs"
    )
  })
)
