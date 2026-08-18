import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect } from "effect"
import { expect } from "vitest"
import { JournalPosition, JournalRecord } from "@dalph/orchestrator"
import {
  changedAttemptRestartsCleanlyAuthoredCassette,
  maintainedAuthoredCassetteCatalog,
  maintainedIntegrationFinalityProtocolCassetteCatalog,
  runAuthoredScenarioCassette,
  runIntegrationFinalityProtocolCassetteFromPromotedRecords
} from "../../src/cassettes/index.js"

const runAuthored = (input: unknown) => runAuthoredScenarioCassette(input).pipe(Effect.provide(NodeCrypto.layer))

it.effect("accepts a promoted history containing a replacement plan while selecting the promoted plan", () =>
  Effect.gen(function* () {
    const promoted = yield* runAuthored(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    const replacementRun = yield* runAuthored(changedAttemptRestartsCleanlyAuthoredCassette)
    const replacement = replacementRun.records.findLast(({ event }) => event._tag === "PlannedAttemptReplaced")
    if (replacement === undefined) return yield* Effect.die("replacement fixture did not record a replacement plan")

    const replacementRecord = JournalRecord.make({
      event: replacement.event,
      key: replacement.key,
      position: JournalPosition.make(promoted.records.length + 1),
      runId: promoted.runId
    })
    const finalized = yield* runIntegrationFinalityProtocolCassetteFromPromotedRecords(
      maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess,
      [...promoted.records, replacementRecord]
    )

    expect(finalized.failureTag).toBeNull()
    expect(finalized.records.some(({ event }) => event._tag === "IntegrationFinalitySettled")).toBe(true)
  })
)
