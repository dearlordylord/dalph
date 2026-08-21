import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { idleRunCancellationRecoveryAuthoredCassette, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"
import type { JournalRecord } from "@dalph/orchestrator"
import {
  expectedRecoveryPrefix,
  prefixThrough,
  replayRecoveryPrefix,
  recoveryPrefixMismatch,
  type RecoveryPrefix
} from "./recovery-store-lanes.js"

const graphReadIntent = (record: JournalRecord): boolean =>
  record.event._tag === "TaskTrackerReadIntentRecorded" && record.event.operation._tag === "ReadTrackerGraph"

const graphReadOperationId = (record: JournalRecord | undefined): string | undefined => {
  if (record?.event._tag !== "TaskTrackerReadIntentRecorded" || record.event.operation._tag !== "ReadTrackerGraph") {
    return undefined
  }
  return record.event.operation.operationId
}

const graphReadObservation = (record: JournalRecord, operationId: string): boolean =>
  record.event._tag === "TaskTrackerFactsObserved" && record.event.operationId === operationId

const cancellationRecoveryPrefixes = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<RecoveryPrefix> => {
  const cancellationIndex = records.findIndex((record) => record.event._tag === "RunCancellationApplied")
  const terminalIndex = records.findIndex((record) => record.event._tag === "WorkflowRunTerminated")
  if (cancellationIndex < 1 || terminalIndex < 0) {
    return []
  }

  const postCancellationIntentIndices = records.flatMap((record, index) =>
    index > cancellationIndex && graphReadIntent(record) ? [index] : []
  )
  if (postCancellationIntentIndices.length < 2) {
    return []
  }

  const firstFreshIntentIndex = postCancellationIntentIndices[0]
  const finalFreshIntentIndex = postCancellationIntentIndices[postCancellationIntentIndices.length - 1]
  if (firstFreshIntentIndex === undefined || finalFreshIntentIndex === undefined) {
    return []
  }
  const firstFreshOperationId = graphReadOperationId(records[firstFreshIntentIndex])
  const finalFreshOperationId = graphReadOperationId(records[finalFreshIntentIndex])
  if (firstFreshOperationId === undefined || finalFreshOperationId === undefined) {
    return []
  }

  const firstFreshObservationIndex = records.findIndex(
    (record, index) => index > firstFreshIntentIndex && graphReadObservation(record, firstFreshOperationId)
  )
  const finalFreshObservationIndex = records.findIndex(
    (record, index) => index > finalFreshIntentIndex && graphReadObservation(record, finalFreshOperationId)
  )
  if (firstFreshObservationIndex < 0 || finalFreshObservationIndex < 0) {
    return []
  }

  return [
    prefixThrough(records, "P0", "the record before RunCancellationApplied", cancellationIndex - 1),
    prefixThrough(records, "P1", "RunCancellationApplied", cancellationIndex),
    prefixThrough(records, "P2", "fresh G2 graph read intent before the first recovery crash", firstFreshIntentIndex),
    prefixThrough(
      records,
      "P3",
      "fresh G2 graph observation before the first recovery crash",
      firstFreshObservationIndex
    ),
    prefixThrough(records, "P4", "fresh G2 graph read intent after coordinator re-entry", finalFreshIntentIndex),
    prefixThrough(
      records,
      "P5",
      "fresh G2 graph observation proving cancellation finality",
      finalFreshObservationIndex
    ),
    prefixThrough(records, "P6", "WorkflowRunTerminated", terminalIndex)
  ].filter((prefix): prefix is RecoveryPrefix => prefix !== undefined)
}

it.effect("replays cancellation recovery prefixes P0-P6 through memory and SQLite", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(idleRunCancellationRecoveryAuthoredCassette)
    const cancellationRecords = run.records.filter((record) => record.event._tag === "RunCancellationApplied")
    const terminalRecords = run.records.filter((record) => record.event._tag === "WorkflowRunTerminated")

    expect(run.activationOrdinals).toEqual([1, 2, 3])
    expect(cancellationRecords).toHaveLength(1)
    expect(terminalRecords).toHaveLength(1)
    expect(terminalRecords[0]?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Cancelled" })

    const prefixes = cancellationRecoveryPrefixes(run.records)
    expect(prefixes).toHaveLength(7)
    if (prefixes.length !== 7) return yield* Effect.die("cancellation recovery cassette lacks P0-P6 endpoints")
    for (const prefix of prefixes) {
      const expected = yield* expectedRecoveryPrefix(prefix)
      for (const lane of ["memory", "sqlite"] as const) {
        const actual = yield* replayRecoveryPrefix(prefix, lane)
        expect(recoveryPrefixMismatch(prefix.cut, lane, expected, actual)).toBeUndefined()
      }
    }
  }).pipe(Effect.provide(NodeCrypto.layer))
)
