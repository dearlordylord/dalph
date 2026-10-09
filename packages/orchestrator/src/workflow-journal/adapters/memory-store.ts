import { makeMemoryArchiveRetention, savedMemoryArchiveBytes } from "./memory-archive-retention.js"
import {
  adoptMemoryCompletions,
  decideMemoryCompletion,
  readMemoryCompletion,
  memoryTerminationTransition,
  type MemoryJournalState
} from "./memory-completion.js"
import { RunCompletionTime, type RunCompletion } from "../completion.js"
import type { AttemptBasePolicy } from "../../workflow/protocols/task-attempt-planning/base.js"
import { type RemotePublicationTarget, type RunId } from "@dalph/contracts"
import { Clock, Effect, Layer, Ref, Schema } from "effect"
import { JournalPosition, type JournalRecordKey } from "../identity.js"
import {
  type JournalDataCorruption,
  type AppendableWorkflowJournalEvent,
  type JournalRecord,
  type JournalStoreOperation,
  JournalHistoryDeleted,
  JournalHistoryCorruption,
  JournalHistoryNotTerminal,
  JournalPartitionContradiction,
  JournalStore,
  JournalStoreContradiction,
  journalStoreCapabilities,
  unpublishedInRunJournalTestLayer,
  type JournalTerminalHistoryRetirement,
  WorkflowRunAlreadyBegan,
  WorkflowRunTargetMismatch,
  WorkflowRunAlreadyTerminated,
  type WorkflowRunIdentityAlreadyUsed,
  WorkflowRunNotBegan
} from "../store.js"
import { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../../authorities/task-tracker/target.js"
import { decideWorkflowRunBeginning, readRecoverableRunBeginning } from "../run-lifecycle.js"
import type { InitialControlPolicy } from "../../control/policy.js"
import type { RunFinalityEvidence, RunTerminationDisposition } from "../../coordination/frontier/run-finality.js"
import { decideJournalPartitionHistory } from "../partition-history.js"
import type { JournalScan } from "../recovery-model.js"

const emptyMemoryJournalState = (): MemoryJournalState => ({
  archiveBytes: new Map(),
  deletions: new Map(),
  completions: new Map(),
  coldRecordsByRun: new Map(),
  hotRecordsByRun: new Map()
})

const recordsByRun = (records: ReadonlyArray<JournalRecord>): ReadonlyMap<RunId, ReadonlyArray<JournalRecord>> => {
  return records.reduce(
    (result, record) => new Map([...result, [record.runId, [...(result.get(record.runId) ?? []), record]]]),
    new Map<RunId, ReadonlyArray<JournalRecord>>()
  )
}

const locateRun = (state: MemoryJournalState, runId: RunId) => ({
  cold: state.coldRecordsByRun.get(runId),
  hot: state.hotRecordsByRun.get(runId)
})

const sameEvent = (left: WorkflowJournalEvent, right: WorkflowJournalEvent): boolean =>
  JSON.stringify(Schema.encodeUnknownSync(WorkflowJournalEvent)(left)) ===
  JSON.stringify(Schema.encodeUnknownSync(WorkflowJournalEvent)(right))

type MemoryAppendError =
  | JournalDataCorruption
  | JournalStoreContradiction
  | WorkflowRunAlreadyTerminated
  | JournalPartitionContradiction
  | JournalHistoryCorruption
type MemoryAppendTransition = readonly [Effect.Effect<JournalRecord, MemoryAppendError>, MemoryJournalState]

const existingMemoryAppendTransition = (
  current: MemoryJournalState,
  runId: RunId,
  key: JournalRecordKey,
  event: AppendableWorkflowJournalEvent,
  records: ReadonlyArray<JournalRecord>,
  cold: ReadonlyArray<JournalRecord> | undefined
): MemoryAppendTransition | undefined => {
  const terminated = records.find(({ event: recorded }) => recorded._tag === "WorkflowRunTerminated")
  if (terminated !== undefined) {
    return [Effect.fail(new WorkflowRunAlreadyTerminated({ runId, terminatedAt: terminated.position })), current]
  }
  if (cold !== undefined) {
    return [
      Effect.fail(
        new JournalHistoryCorruption({
          detail: "cold partition contains nonterminal history",
          operation: "JournalStore.append",
          partition: "Cold",
          runId
        })
      ),
      current
    ]
  }
  const existing = records.find((record) => record.key === key)
  if (existing === undefined) return undefined
  return sameEvent(existing.event, event)
    ? [Effect.succeed(existing), current]
    : [Effect.fail(new JournalStoreContradiction({ existingPosition: existing.position, key, runId })), current]
}

const memoryAppendTransition = (
  current: MemoryJournalState,
  runId: RunId,
  key: JournalRecordKey,
  event: AppendableWorkflowJournalEvent
): MemoryAppendTransition => {
  const completion = decideMemoryCompletion(current, runId, "JournalStore.append")
  if (completion._tag === "CompletedRun")
    return [
      Effect.fail(new WorkflowRunAlreadyTerminated({ runId, terminatedAt: completion.completion.terminatedAt })),
      current
    ]
  if (completion._tag !== "NoCompletion") return [Effect.fail(completion), current]
  const { cold, hot } = locateRun(current, runId)
  if (cold !== undefined && hot !== undefined) {
    return [Effect.fail(new JournalPartitionContradiction({ runId })), current]
  }
  const records = hot ?? cold ?? []
  const existing = existingMemoryAppendTransition(current, runId, key, event, records, cold)
  if (existing !== undefined) return existing
  const record: JournalRecord = { event, key, position: JournalPosition.make(records.length + 1), runId }
  const hotRecordsByRun = new Map([...current.hotRecordsByRun, [runId, [...records, record]] as const])
  return [Effect.succeed(record), { ...current, hotRecordsByRun }]
}

type MemoryRetirementError =
  | JournalHistoryCorruption
  | JournalPartitionContradiction
  | WorkflowRunNotBegan
  | JournalHistoryNotTerminal
type MemoryRetirementTransition = readonly [
  Effect.Effect<JournalTerminalHistoryRetirement, MemoryRetirementError>,
  MemoryJournalState
]

const coldMemoryRetirementTransition = (
  current: MemoryJournalState,
  runId: RunId,
  cold: ReadonlyArray<JournalRecord>
): MemoryRetirementTransition => {
  const decision = decideJournalPartitionHistory("Cold", runId, cold)
  if (decision._tag === "InvalidPartitionHistory") {
    return [
      Effect.fail(
        new JournalHistoryCorruption({
          detail: decision.issue.detail,
          operation: "JournalStore.retireTerminalRun",
          partition: "Cold",
          runId
        })
      ),
      current
    ]
  }
  return [Effect.succeed({ _tag: "AlreadyRetired", partition: "Cold", runId }), current]
}

const hotMemoryRetirementTransition = (
  current: MemoryJournalState,
  runId: RunId,
  hot: ReadonlyArray<JournalRecord>
): MemoryRetirementTransition => {
  const decision = decideJournalPartitionHistory("Hot", runId, hot)
  if (decision._tag === "InvalidPartitionHistory") {
    return [
      Effect.fail(
        new JournalHistoryCorruption({
          detail: decision.issue.detail,
          operation: "JournalStore.retireTerminalRun",
          partition: "Hot",
          runId
        })
      ),
      current
    ]
  }
  if (!decision.isTerminal) {
    return [Effect.fail(new JournalHistoryNotTerminal({ runId })), current]
  }
  const coldRecordsByRun = new Map([...current.coldRecordsByRun, [runId, hot] as const])
  const hotRecordsByRun = new Map([...current.hotRecordsByRun].filter(([candidate]) => candidate !== runId))
  return [
    Effect.succeed({ _tag: "Retired", from: "Hot", runId, to: "Cold" }),
    {
      ...current,
      coldRecordsByRun,
      hotRecordsByRun,
      archiveBytes: new Map([...current.archiveBytes, [runId, savedMemoryArchiveBytes(hot)] as const])
    }
  ]
}

const memoryRetirementTransition = (current: MemoryJournalState, runId: RunId): MemoryRetirementTransition => {
  const { cold, hot } = locateRun(current, runId)
  if (cold !== undefined && hot !== undefined)
    return [Effect.fail(new JournalPartitionContradiction({ runId })), current]
  if (cold !== undefined) return coldMemoryRetirementTransition(current, runId, cold)
  if (hot === undefined) return [Effect.fail(new WorkflowRunNotBegan({ runId })), current]
  return hotMemoryRetirementTransition(current, runId, hot)
}

const memoryRawJournalStoreLayer = (initial = emptyMemoryJournalState()) =>
  Layer.effect(
    JournalStore,
    Effect.gen(function* () {
      const baseline = RunCompletionTime.make(yield* Clock.currentTimeMillis)
      const completions = adoptMemoryCompletions(initial, baseline)
      const state = yield* Ref.make<MemoryJournalState>({
        ...initial,
        completions,
        archiveBytes: new Map([...initial.coldRecordsByRun].map(([id, rows]) => [id, savedMemoryArchiveBytes(rows)]))
      })
      const readCompletion = Effect.fn("JournalStore.Memory.readCompletion")(function* (
        runId: RunId,
        operation: JournalStoreOperation = "JournalStore.readCompletion"
      ) {
        const current = yield* Ref.get(state)
        return yield* readMemoryCompletion(current, runId, operation)
      })
      // These immutable roots belong to this layer's Cold partition. Weak identity
      // retention fits their lifetime; Effect Cache's capacity/TTL eviction does
      // not. This is neither caller-array acceptance nor mutation isolation.
      const validatedColdRoots = new WeakMap<ReadonlyArray<JournalRecord>, RunId>()
      for (const [runId, records] of initial.coldRecordsByRun) {
        if (!initial.completions.has(runId) && completions.has(runId)) validatedColdRoots.set(records, runId)
      }
      const readColdHistory = (
        runId: RunId,
        records: ReadonlyArray<JournalRecord>,
        operation: "JournalStore.read" | "JournalStore.readRunForRecovery"
      ): Effect.Effect<ReadonlyArray<JournalRecord>, JournalHistoryCorruption> => {
        if (validatedColdRoots.get(records) === runId) return Effect.succeed(records)
        const decision = decideJournalPartitionHistory("Cold", runId, records)
        if (decision._tag === "InvalidPartitionHistory") {
          return Effect.fail(
            new JournalHistoryCorruption({ detail: decision.issue.detail, operation, partition: "Cold", runId })
          )
        }
        validatedColdRoots.set(records, runId)
        return Effect.succeed(records)
      }

      const beginRun = Effect.fn("JournalStore.Memory.beginRun")(function* (
        runId: RunId,
        target: TrackerTarget,
        initialControlPolicy: InitialControlPolicy,
        remotePublicationTarget: RemotePublicationTarget,
        attemptBasePolicy?: AttemptBasePolicy
      ) {
        const update = (
          current: MemoryJournalState
        ): readonly [
          Effect.Effect<
            JournalRecord,
            | WorkflowRunAlreadyBegan
            | WorkflowRunIdentityAlreadyUsed
            | JournalPartitionContradiction
            | JournalDataCorruption
            | JournalHistoryCorruption
          >,
          MemoryJournalState
        ] => {
          const completion = decideMemoryCompletion(current, runId, "JournalStore.beginRun")
          if (completion._tag === "CompletedRun")
            return [Effect.fail(new WorkflowRunAlreadyBegan({ runId, beganAt: JournalPosition.make(1) })), current]
          if (completion._tag !== "NoCompletion") return [Effect.fail(completion), current]
          const { cold, hot } = locateRun(current, runId)
          if (cold !== undefined && hot !== undefined) {
            return [Effect.fail(new JournalPartitionContradiction({ runId })), current]
          }
          const records = hot ?? cold ?? []
          const decision = decideWorkflowRunBeginning(
            records,
            runId,
            target,
            initialControlPolicy,
            remotePublicationTarget,
            attemptBasePolicy
          )
          if (decision._tag === "LifecycleTransitionRejected") {
            return [Effect.fail(decision.failure), current]
          }
          const record = decision.record
          const hotRecordsByRun = new Map([...current.hotRecordsByRun, [runId, [record]] as const])
          return [Effect.succeed(record), { ...current, hotRecordsByRun }]
        }
        const result = yield* Ref.modify(state, update)
        return yield* result
      })

      const append = Effect.fn("JournalStore.Memory.append")(function* (
        runId: RunId,
        key: JournalRecordKey,
        event: AppendableWorkflowJournalEvent
      ) {
        const result = yield* Ref.modify(state, (current) => memoryAppendTransition(current, runId, key, event))
        return yield* result
      })

      const read = Effect.fn("JournalStore.Memory.read")(function* (runId: RunId) {
        const current = yield* Ref.get(state)
        const receipt = current.deletions.has(runId)
          ? yield* readMemoryCompletion(current, runId, "JournalStore.read")
          : undefined
        if (receipt?._tag === "CompletedRun" && receipt.history === "Deleted")
          return yield* new JournalHistoryDeleted({ completion: receipt.completion, deletion: receipt.deletion })
        const { cold, hot } = locateRun(current, runId)
        if (cold !== undefined && hot !== undefined) return yield* new JournalPartitionContradiction({ runId })
        return cold === undefined ? (hot ?? []) : yield* readColdHistory(runId, cold, "JournalStore.read")
      })

      const readRunForRecovery = Effect.fn("JournalStore.Memory.readRunForRecovery")(function* (
        runId: RunId,
        target: TrackerTarget
      ) {
        const receipt = yield* readCompletion(runId, "JournalStore.readRunForRecovery")
        if (receipt._tag === "CompletedRun") {
          if (taskTrackerTargetKey(receipt.completion.target) !== taskTrackerTargetKey(target))
            return yield* new WorkflowRunTargetMismatch({
              recordedTarget: receipt.completion.target,
              requestedTarget: target,
              runId
            })
          return yield* new WorkflowRunAlreadyTerminated({ runId, terminatedAt: receipt.completion.terminatedAt })
        }
        const current = yield* Ref.get(state)
        const { cold, hot } = locateRun(current, runId)
        if (cold !== undefined && hot !== undefined) return yield* new JournalPartitionContradiction({ runId })
        const records =
          cold === undefined ? (hot ?? []) : yield* readColdHistory(runId, cold, "JournalStore.readRunForRecovery")
        return yield* readRecoverableRunBeginning(records, runId, target)
      })

      const scanHot = Effect.fn("JournalStore.Memory.scanHot")(function* () {
        const recordsByRun = (yield* Ref.get(state)).hotRecordsByRun
        return [...recordsByRun].reduce<JournalScan>(
          (scan, [runId, records]) => {
            const decision = decideJournalPartitionHistory("Hot", runId, records)
            return decision._tag === "InvalidPartitionHistory"
              ? { issues: [...scan.issues, decision.issue], runs: scan.runs }
              : { issues: scan.issues, runs: [...scan.runs, { records, runId }] }
          },
          { issues: [], runs: [] }
        )
      })

      const auditAll = Effect.fn("JournalStore.Memory.auditAll")(function* () {
        const current = yield* Ref.get(state)
        const contradictoryRunId = [...current.hotRecordsByRun.keys()].find((runId) =>
          current.coldRecordsByRun.has(runId)
        )
        if (contradictoryRunId !== undefined)
          return yield* new JournalPartitionContradiction({ runId: contradictoryRunId })
        for (const runId of current.completions.keys()) yield* readCompletion(runId)
        const hot = [...current.hotRecordsByRun]
        const cold = [...current.coldRecordsByRun]
        const issues = [
          ...hot.flatMap(([runId, records]) => {
            const decision = decideJournalPartitionHistory("Hot", runId, records)
            return decision._tag === "InvalidPartitionHistory" ? [decision.issue] : []
          }),
          ...cold.flatMap(([runId, records]) => {
            const decision = decideJournalPartitionHistory("Cold", runId, records)
            return decision._tag === "InvalidPartitionHistory" ? [decision.issue] : []
          })
        ]
        const runs = [
          ...hot.map(([runId, records]) => ({ partition: "Hot" as const, records, runId })),
          ...cold.map(([runId, records]) => ({ partition: "Cold" as const, records, runId }))
        ]
        return {
          issues,
          runs,
          completions: [...current.completions.keys()]
            .map((id) => decideMemoryCompletion(current, id, "JournalStore.auditAll"))
            .filter((receipt) => receipt._tag === "CompletedRun")
        }
      })

      const maintainArchive = yield* makeMemoryArchiveRetention(state)

      const retireTerminalRun = Effect.fn("JournalStore.Memory.retireTerminalRun")(function* (runId: RunId) {
        yield* readCompletion(runId, "JournalStore.retireTerminalRun")
        const result = yield* Ref.modify(state, (current) => memoryRetirementTransition(current, runId))
        return yield* result
      })

      const terminateRun = Effect.fn("JournalStore.Memory.terminateRun")(function* (
        runId: RunId,
        disposition: RunTerminationDisposition,
        evidence: RunFinalityEvidence
      ) {
        const timing = { _tag: "Known" as const, completedAt: RunCompletionTime.make(yield* Clock.currentTimeMillis) }
        const update = (current: MemoryJournalState) =>
          memoryTerminationTransition(current, runId, disposition, evidence, timing)
        const result = yield* Ref.modify(state, update)
        return yield* result
      })

      return JournalStore.of({
        maintainArchive,
        readCompletion,
        append,
        auditAll,
        beginRun,
        read,
        readRunForRecovery,
        retireTerminalRun,
        scanHot,
        terminateRun
      })
    })
  )

export const memoryJournalStoreLayer = journalStoreCapabilities(memoryRawJournalStoreLayer())

/** Raw test storage; this does not establish a live accepted Journal. */
export const memoryJournalTestLayer = unpublishedInRunJournalTestLayer.pipe(Layer.provideMerge(memoryJournalStoreLayer))

/** Test-only storage seam for injecting exact typed rows into either partition. */
export const memoryJournalStoreLayerFromPartitionRecords = (input: {
  readonly completions?: ReadonlyArray<RunCompletion>
  readonly cold?: ReadonlyArray<JournalRecord>
  readonly hot?: ReadonlyArray<JournalRecord>
}) =>
  journalStoreCapabilities(
    memoryRawJournalStoreLayer({
      archiveBytes: new Map(),
      deletions: new Map(),
      completions: new Map((input.completions ?? []).map((receipt) => [receipt.runId, receipt])),
      coldRecordsByRun: recordsByRun(input.cold ?? []),
      hotRecordsByRun: recordsByRun(input.hot ?? [])
    })
  )

/** Raw malformed/cold fixtures deliberately bypass accepted Journal acquisition. */
export const memoryJournalTestLayerFromPartitionRecords = (input: {
  readonly completions?: ReadonlyArray<RunCompletion>
  readonly cold?: ReadonlyArray<JournalRecord>
  readonly hot?: ReadonlyArray<JournalRecord>
}) => unpublishedInRunJournalTestLayer.pipe(Layer.provideMerge(memoryJournalStoreLayerFromPartitionRecords(input)))
