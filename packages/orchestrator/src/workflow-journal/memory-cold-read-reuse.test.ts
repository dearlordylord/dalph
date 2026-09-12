import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { RunId } from "@dalph/contracts"
import { completedRunFinalityFixture } from "../../test/run-finality.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { observeWorkflowJournalValidationSteps } from "../coordination/reconstruction/history.js"
import { makeTraceReader, TraceCursor } from "../presentation/trace-reader.js"
import { memoryJournalStoreLayer, memoryJournalStoreLayerFromPartitionRecords } from "./adapters/memory-store.js"
import { JournalPosition } from "./identity.js"
import { decideJournalPartitionHistory } from "./partition-history.js"
import { intentRecordKey, outcomeRecordKey } from "./record-key.js"
import { observeJournalRecordSequenceOperations } from "./record-sequence.js"
import { makeWorkflowRunBeganRecord, makeWorkflowRunTerminatedRecord } from "./run-lifecycle.js"
import { JournalStore, type JournalRecord } from "./store.js"

const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })

const terminalRecordsFor = (
  runId: RunId,
  target: ReturnType<typeof FixtureTarget.make>
): ReadonlyArray<JournalRecord> => {
  const fixture = completedRunFinalityFixture({ runId, target })
  return [
    makeWorkflowRunBeganRecord(runId, target, initialPolicy),
    {
      event: fixture.intent,
      key: intentRecordKey(fixture.operation.operationId),
      position: JournalPosition.make(2),
      runId
    },
    {
      event: fixture.observation,
      key: outcomeRecordKey(fixture.operation.operationId),
      position: JournalPosition.make(3),
      runId
    },
    makeWorkflowRunTerminatedRecord(runId, JournalPosition.make(4), "Completed", fixture.evidence)
  ]
}

const withReadCounts = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    let validations = 0
    const materializations: Array<number> = []
    const restoreValidation = observeWorkflowJournalValidationSteps(() => {
      validations += 1
    })
    const restoreSequence = observeJournalRecordSequenceOperations((operation) => {
      if (operation._tag === "HistoricalMaterialization") materializations.push(operation.length)
    })
    const value = yield* effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          restoreSequence()
          restoreValidation()
        })
      )
    )
    return { materializations, validations, value }
  })

it.effect("validates a retired memory root once across repeated exact reads and recovery checks", () => {
  const runId = RunId.make("memory-retired-read-reuse")
  const target = FixtureTarget.make("memory-retired-read-reuse-target")
  const fixture = completedRunFinalityFixture({ runId, target })
  return Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, initialPolicy)
    yield* journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
    yield* journal.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
    yield* journal.terminateRun(runId, "Completed", fixture.evidence)
    const earlier = yield* journal.read(runId)
    const retained = [...earlier]
    yield* journal.retireTerminalRun(runId)
    const counts = yield* withReadCounts(
      Effect.gen(function* () {
        for (let index = 0; index < 3; index += 1) {
          expect(yield* journal.read(runId)).toBe(earlier)
          expect(yield* journal.read(runId)).toEqual(retained)
          expect(yield* Effect.flip(journal.readRunForRecovery(runId, target))).toMatchObject({
            _tag: "WorkflowRunAlreadyTerminated",
            runId,
            terminatedAt: JournalPosition.make(4)
          })
        }
      })
    )
    expect(counts.validations).toBe(earlier.length)
    expect(counts.materializations).toEqual([earlier.length])
    expect(earlier).toEqual(retained)
    const earlierReader = makeTraceReader({ read: () => Effect.succeed(earlier) })
    const retiredReader = makeTraceReader(journal)
    for (const { position } of earlier) {
      const cursor = TraceCursor.make({ position, runId })
      expect(yield* retiredReader.readAt(cursor)).toEqual(yield* earlierReader.readAt(cursor))
    }
  }).pipe(Effect.provide(memoryJournalStoreLayer))
})

it.effect(
  "rechecks malformed Cold histories with exact operation errors while a valid sibling reuses its proof",
  () => {
    const runId = RunId.make("memory-malformed-cold-reuse")
    const target = FixtureTarget.make("memory-malformed-cold-reuse-target")
    const validRunId = RunId.make("memory-valid-cold-sibling")
    const validTarget = FixtureTarget.make("memory-valid-cold-sibling-target")
    const malformed = terminalRecordsFor(runId, target).map((record, index) =>
      index === 3 ? { ...record, position: JournalPosition.make(5) } : record
    )
    const valid = terminalRecordsFor(validRunId, validTarget)
    const malformedDecision = decideJournalPartitionHistory("Cold", runId, malformed)
    if (malformedDecision._tag !== "InvalidPartitionHistory") return Effect.die("Malformed Cold fixture must fail")
    return Effect.gen(function* () {
      const journal = yield* JournalStore
      const counts = yield* withReadCounts(
        Effect.gen(function* () {
          const sibling = yield* journal.read(validRunId)
          for (let index = 0; index < 2; index += 1) {
            expect(yield* Effect.flip(journal.read(runId))).toMatchObject({
              _tag: "JournalHistoryCorruption",
              operation: "JournalStore.read",
              detail: malformedDecision.issue.detail,
              partition: "Cold",
              runId
            })
            expect(yield* Effect.flip(journal.readRunForRecovery(runId, target))).toMatchObject({
              _tag: "JournalHistoryCorruption",
              operation: "JournalStore.readRunForRecovery",
              detail: malformedDecision.issue.detail,
              partition: "Cold",
              runId
            })
            expect(yield* journal.read(validRunId)).toBe(sibling)
          }
          expect(sibling).toEqual(valid)
        })
      )
      // The final noncanonical envelope triggers the existing raw diagnostic
      // replay after three indexed records; each failure must repeat both.
      const indexedRecordsBeforeMalformedEnvelope = 3
      expect(counts.validations).toBe(valid.length + 4 * (indexedRecordsBeforeMalformedEnvelope + malformed.length))
      expect(counts.materializations).toEqual([valid.length])
    }).pipe(Effect.provide(memoryJournalStoreLayerFromPartitionRecords({ cold: [...malformed, ...valid] })))
  }
)

it.effect("checks contradictory memory partitions before attempting Cold validation reuse", () => {
  const runId = RunId.make("memory-cold-reuse-contradiction")
  const target = FixtureTarget.make("memory-cold-reuse-contradiction-target")
  const records = terminalRecordsFor(runId, target)
  return Effect.gen(function* () {
    const journal = yield* JournalStore
    const counts = yield* withReadCounts(
      Effect.gen(function* () {
        for (let index = 0; index < 2; index += 1) {
          expect(yield* Effect.flip(journal.read(runId))).toMatchObject({
            _tag: "JournalPartitionContradiction",
            runId
          })
          expect(yield* Effect.flip(journal.readRunForRecovery(runId, target))).toMatchObject({
            _tag: "JournalPartitionContradiction",
            runId
          })
        }
      })
    )
    expect(counts.validations).toBe(0)
    expect(counts.materializations).toEqual([])
  }).pipe(Effect.provide(memoryJournalStoreLayerFromPartitionRecords({ cold: records, hot: records })))
})

it.effect("keeps successful Cold proofs local to an exact root, run, and fresh memory layer", () => {
  const runId = RunId.make("memory-cold-reuse-isolation")
  const target = FixtureTarget.make("memory-cold-reuse-isolation-target")
  const records = terminalRecordsFor(runId, target)
  const otherRunId = RunId.make("memory-cold-reuse-other-run")
  const other = terminalRecordsFor(otherRunId, FixtureTarget.make("memory-cold-reuse-other-target"))
  const readTwice = Effect.gen(function* () {
    const journal = yield* JournalStore
    const first = yield* journal.read(runId)
    expect(yield* journal.read(runId)).toBe(first)
    return first
  })
  return Effect.gen(function* () {
    const counts = yield* withReadCounts(
      Effect.gen(function* () {
        const first = yield* readTwice.pipe(
          Effect.provide(memoryJournalStoreLayerFromPartitionRecords({ cold: records }))
        )
        const second = yield* readTwice.pipe(
          Effect.provide(memoryJournalStoreLayerFromPartitionRecords({ cold: records }))
        )
        const third = yield* Effect.gen(function* () {
          const journal = yield* JournalStore
          expect(yield* journal.read(otherRunId)).toEqual(other)
          const sameContent = yield* journal.read(runId)
          expect(yield* journal.read(otherRunId)).toEqual(other)
          expect(yield* journal.read(runId)).toBe(sameContent)
          return sameContent
        }).pipe(Effect.provide(memoryJournalStoreLayerFromPartitionRecords({ cold: [...records, ...other] })))
        expect(first).not.toBe(second)
        expect(first).not.toBe(third)
        expect(first).toEqual(second)
        expect(first).toEqual(third)
      })
    )
    expect(counts.validations).toBe(3 * records.length + other.length)
    expect(counts.materializations).toEqual([records.length, records.length, other.length, records.length])
  })
})
