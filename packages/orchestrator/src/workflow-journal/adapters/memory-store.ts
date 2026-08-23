import { type RunId } from "@dalph/contracts"
import { Effect, Layer, Ref, Schema } from "effect"
import { JournalPosition, type JournalRecordKey } from "../identity.js"
import {
  type AppendableWorkflowJournalEvent,
  type JournalRecord,
  JournalDataCorruption,
  JournalHistoryNotTerminal,
  JournalPartitionContradiction,
  JournalStore,
  JournalStoreContradiction,
  journalStoreCapabilities,
  unpublishedInRunJournalTestLayer,
  type JournalTerminalHistoryRetirement,
  type WorkflowRunAlreadyBegan,
  WorkflowRunAlreadyTerminated,
  type WorkflowRunTerminationEvidenceInvalid,
  type WorkflowRunIdentityAlreadyUsed,
  WorkflowRunNotBegan
} from "../store.js"
import { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import {
  decideWorkflowRunBeginning,
  decideWorkflowRunTermination,
  readRecoverableRunBeginning
} from "../run-lifecycle.js"
import { workflowJournalHistoryIssueDetail } from "../../coordination/reconstruction/history-result.js"
import type { InitialControlPolicy } from "../../control/policy.js"
import type { RunFinalityEvidence, RunTerminationDisposition } from "../../coordination/frontier/run-finality.js"
import { JournalSemanticIssue } from "../recovery-model.js"
import { reduceWorkflowJournalHistory } from "../../coordination/reconstruction/history.js"

interface MemoryJournalState {
  readonly hotRecordsByRun: ReadonlyMap<RunId, ReadonlyArray<JournalRecord>>
  readonly coldRecordsByRun: ReadonlyMap<RunId, ReadonlyArray<JournalRecord>>
}

const emptyMemoryJournalState = (): MemoryJournalState => ({ coldRecordsByRun: new Map(), hotRecordsByRun: new Map() })

const lastRecordIndex = -1

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

const semanticIssueFor = (partition: "Hot" | "Cold", runId: RunId, records: ReadonlyArray<JournalRecord>) => {
  const reduction = reduceWorkflowJournalHistory(runId, records)
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    return new JournalSemanticIssue({
      detail: reduction.issues.map(workflowJournalHistoryIssueDetail).join("; "),
      partition,
      runId
    })
  }
  if (partition === "Cold" && reduction.records.at(lastRecordIndex)?.event._tag !== "WorkflowRunTerminated") {
    return new JournalSemanticIssue({ detail: "Cold history is not terminal", partition, runId })
  }
  return undefined
}

const readColdHistory = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  operation: "JournalStore.read" | "JournalStore.readRunForRecovery"
): Effect.Effect<ReadonlyArray<JournalRecord>, JournalDataCorruption> => {
  const issue = semanticIssueFor("Cold", runId, records)
  return issue === undefined
    ? Effect.succeed(records)
    : Effect.fail(new JournalDataCorruption({ detail: issue.detail, operation }))
}

type MemoryAppendError =
  | JournalStoreContradiction
  | WorkflowRunAlreadyTerminated
  | JournalPartitionContradiction
  | JournalDataCorruption
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
        new JournalDataCorruption({
          detail: "cold partition contains nonterminal history",
          operation: "JournalStore.append"
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
  | JournalDataCorruption
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
  const issue = semanticIssueFor("Cold", runId, cold)
  if (issue !== undefined) {
    return [
      Effect.fail(new JournalDataCorruption({ detail: issue.detail, operation: "JournalStore.retireTerminalRun" })),
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
  const reduction = reduceWorkflowJournalHistory(runId, hot)
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    return [
      Effect.fail(
        new JournalDataCorruption({
          detail: reduction.issues.map(workflowJournalHistoryIssueDetail).join("; "),
          operation: "JournalStore.retireTerminalRun"
        })
      ),
      current
    ]
  }
  if (reduction.records.at(lastRecordIndex)?.event._tag !== "WorkflowRunTerminated") {
    return [Effect.fail(new JournalHistoryNotTerminal({ runId })), current]
  }
  const coldRecordsByRun = new Map([...current.coldRecordsByRun, [runId, hot] as const])
  const hotRecordsByRun = new Map([...current.hotRecordsByRun].filter(([candidate]) => candidate !== runId))
  return [Effect.succeed({ _tag: "Retired", from: "Hot", runId, to: "Cold" }), { coldRecordsByRun, hotRecordsByRun }]
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
      const state = yield* Ref.make<MemoryJournalState>(initial)

      const beginRun = Effect.fn("JournalStore.Memory.beginRun")(function* (
        runId: RunId,
        target: TrackerTarget,
        initialControlPolicy: InitialControlPolicy
      ) {
        const update = (
          current: MemoryJournalState
        ): readonly [
          Effect.Effect<
            JournalRecord,
            WorkflowRunAlreadyBegan | WorkflowRunIdentityAlreadyUsed | JournalPartitionContradiction
          >,
          MemoryJournalState
        ] => {
          const { cold, hot } = locateRun(current, runId)
          if (cold !== undefined && hot !== undefined) {
            return [Effect.fail(new JournalPartitionContradiction({ runId })), current]
          }
          const records = hot ?? cold ?? []
          const decision = decideWorkflowRunBeginning(records, runId, target, initialControlPolicy)
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
        const { cold, hot } = locateRun(current, runId)
        if (cold !== undefined && hot !== undefined) return yield* new JournalPartitionContradiction({ runId })
        return cold === undefined ? (hot ?? []) : yield* readColdHistory(runId, cold, "JournalStore.read")
      })

      const readRunForRecovery = Effect.fn("JournalStore.Memory.readRunForRecovery")(function* (
        runId: RunId,
        target: TrackerTarget
      ) {
        const current = yield* Ref.get(state)
        const { cold, hot } = locateRun(current, runId)
        if (cold !== undefined && hot !== undefined) return yield* new JournalPartitionContradiction({ runId })
        const records =
          cold === undefined ? (hot ?? []) : yield* readColdHistory(runId, cold, "JournalStore.readRunForRecovery")
        return yield* readRecoverableRunBeginning(records, runId, target)
      })

      const scanHot = Effect.fn("JournalStore.Memory.scanHot")(function* () {
        const recordsByRun = (yield* Ref.get(state)).hotRecordsByRun
        const issues = [...recordsByRun].flatMap(([runId, records]) => {
          const issue = semanticIssueFor("Hot", runId, records)
          return issue === undefined ? [] : [issue]
        })
        const runs = [...recordsByRun].flatMap(([runId, records]) =>
          semanticIssueFor("Hot", runId, records) === undefined ? [{ records, runId }] : []
        )
        return { issues, runs }
      })

      const auditAll = Effect.fn("JournalStore.Memory.auditAll")(function* () {
        const current = yield* Ref.get(state)
        const contradictoryRunId = [...current.hotRecordsByRun.keys()].find((runId) =>
          current.coldRecordsByRun.has(runId)
        )
        if (contradictoryRunId !== undefined)
          return yield* new JournalPartitionContradiction({ runId: contradictoryRunId })
        const hot = [...current.hotRecordsByRun]
        const cold = [...current.coldRecordsByRun]
        const issues = [
          ...hot.flatMap(([runId, records]) => {
            const issue = semanticIssueFor("Hot", runId, records)
            return issue === undefined ? [] : [issue]
          }),
          ...cold.flatMap(([runId, records]) => {
            const issue = semanticIssueFor("Cold", runId, records)
            return issue === undefined ? [] : [issue]
          })
        ]
        const runs = [
          ...hot.map(([runId, records]) => ({ partition: "Hot" as const, records, runId })),
          ...cold.map(([runId, records]) => ({ partition: "Cold" as const, records, runId }))
        ]
        return { issues, runs }
      })

      const retireTerminalRun = Effect.fn("JournalStore.Memory.retireTerminalRun")(function* (runId: RunId) {
        const result = yield* Ref.modify(state, (current) => memoryRetirementTransition(current, runId))
        return yield* result
      })

      const terminateRun = Effect.fn("JournalStore.Memory.terminateRun")(function* (
        runId: RunId,
        disposition: RunTerminationDisposition,
        evidence: RunFinalityEvidence
      ) {
        const update = (
          current: MemoryJournalState
        ): readonly [
          Effect.Effect<
            JournalRecord,
            | WorkflowRunAlreadyTerminated
            | WorkflowRunNotBegan
            | WorkflowRunTerminationEvidenceInvalid
            | JournalPartitionContradiction
            | JournalDataCorruption
          >,
          MemoryJournalState
        ] => {
          const { cold, hot } = locateRun(current, runId)
          if (cold !== undefined && hot !== undefined)
            return [Effect.fail(new JournalPartitionContradiction({ runId })), current]
          const records = hot ?? cold ?? []
          const decision = decideWorkflowRunTermination(records, runId, disposition, evidence)
          if (decision._tag === "LifecycleTransitionRejected") {
            return [Effect.fail(decision.failure), current]
          }
          if (cold !== undefined) {
            return [
              Effect.fail(
                new JournalDataCorruption({
                  detail: "cold partition contains nonterminal history",
                  operation: "JournalStore.terminateRun"
                })
              ),
              current
            ]
          }
          const record = decision.record
          const hotRecordsByRun = new Map([...current.hotRecordsByRun, [runId, [...records, record]] as const])
          return [Effect.succeed(record), { ...current, hotRecordsByRun }]
        }
        const result = yield* Ref.modify(state, update)
        return yield* result
      })

      return JournalStore.of({
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

/** Complete test-only composition whose appends are not published through Journal. */
export const memoryJournalTestLayer = unpublishedInRunJournalTestLayer.pipe(Layer.provideMerge(memoryJournalStoreLayer))

/** Test-only storage seam for injecting exact typed rows into either partition. */
export const memoryJournalTestLayerFromPartitionRecords = (input: {
  readonly cold?: ReadonlyArray<JournalRecord>
  readonly hot?: ReadonlyArray<JournalRecord>
}) =>
  unpublishedInRunJournalTestLayer.pipe(
    Layer.provideMerge(
      journalStoreCapabilities(
        memoryRawJournalStoreLayer({
          coldRecordsByRun: recordsByRun(input.cold ?? []),
          hotRecordsByRun: recordsByRun(input.hot ?? [])
        })
      )
    )
  )
