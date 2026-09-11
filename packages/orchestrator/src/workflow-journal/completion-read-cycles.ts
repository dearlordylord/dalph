import { HashMap, HashSet, Option, Schema } from "effect"
import type { OperationId } from "../workflow/identity.js"
import {
  CompletionTaskRequest,
  type CompletionTaskFocusedReadPurpose,
  type CompletionTaskRequestOrdinal
} from "../workflow/protocols/integration-finality/events.js"
import type { JournalRecord } from "./store.js"

const CompletionReadCyclesTypeId: unique symbol = Symbol("CompletionReadCycles")
const branchingFactor = 2

/**
 * A completion request can reread tracker facts many times before or after one
 * numbered mutation. This immutable evidence remembers those read cycles,
 * including unresolved intents, without treating a read as authority to mutate.
 * Authorization uses the greatest observed intent ordinal; confirmation counts
 * intents. Neither chronology is assumed contiguous or resolved in order.
 * Exact request/purpose scopes and cutoff snapshots keep collisions and retained
 * earlier observations separate. Nothing here is persisted outside the journal.
 */
export interface CompletionReadCycles {
  readonly [CompletionReadCyclesTypeId]: true
}

export interface CompletionReadCycleState {
  readonly intentCount: number
  readonly maximumOrdinal: number
  readonly latestIntent: JournalRecord | undefined
  readonly latestUnresolvedIntent: JournalRecord | undefined
  readonly latestOutcome: JournalRecord | undefined
}
interface CycleState extends CompletionReadCycleState {
  readonly observedOperations: HashSet.HashSet<OperationId>
  readonly unresolvedOffsets: HashMap.HashMap<OperationId, number>
  /** Persistent position maxima permit exact removal without walking older pending reads. */
  readonly unresolvedTree: HashMap.HashMap<string, JournalRecord>
}
interface CycleHistory {
  readonly length: number
  readonly entries: HashMap.HashMap<number, { readonly position: number; readonly state: CycleState }>
}
type Roots = HashMap.HashMap<string, CycleHistory>
const rootsByEvidence = new WeakMap<CompletionReadCycles, Roots>()
const rootsOf = (index: CompletionReadCycles): Roots =>
  Option.getOrThrow(Option.fromUndefinedOr(rootsByEvidence.get(index)))
const retain = (roots: Roots): CompletionReadCycles => {
  const index: CompletionReadCycles = { [CompletionReadCyclesTypeId]: true }
  rootsByEvidence.set(index, roots)
  return index
}
export const emptyCompletionReadCycles = (): CompletionReadCycles => retain(HashMap.empty())
const emptyState = (): CycleState => ({
  intentCount: 0,
  maximumOrdinal: 0,
  latestIntent: undefined,
  latestUnresolvedIntent: undefined,
  latestOutcome: undefined,
  observedOperations: HashSet.empty(),
  unresolvedOffsets: HashMap.empty(),
  unresolvedTree: HashMap.empty()
})
const encodeRequest = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.toCodecJson(CompletionTaskRequest)))
const keyFor = (
  request: CompletionTaskRequest,
  attemptOrdinal: CompletionTaskRequestOrdinal,
  purpose: CompletionTaskFocusedReadPurpose["_tag"]
): string | undefined => {
  const encoded = encodeRequest(request)
  return Option.isSome(encoded) ? JSON.stringify([encoded.value, attemptOrdinal, purpose]) : undefined
}
const nodeKey = (level: number, offset: number): string => `${level}:${offset}`
const depthFor = (count: number): number => Math.ceil(Math.log2(Math.max(1, count)))
const nodeAt = (tree: HashMap.HashMap<string, JournalRecord>, level: number, offset: number) => {
  for (const observer of observers) observer("UnresolvedNodeRead")
  return Option.getOrUndefined(HashMap.get(tree, nodeKey(level, offset)))
}
const putNode = (tree: HashMap.HashMap<string, JournalRecord>, key: string, record: JournalRecord | undefined) =>
  record === undefined ? HashMap.remove(tree, key) : HashMap.set(tree, key, record)
const setUnresolved = (
  tree: HashMap.HashMap<string, JournalRecord>,
  offset: number,
  count: number,
  record: JournalRecord | undefined
) => {
  let updated = putNode(tree, nodeKey(0, offset), record)
  let parent = offset
  for (let level = 1; level <= depthFor(count); level += 1) {
    parent = Math.floor(parent / branchingFactor)
    const left = parent * branchingFactor
    updated = putNode(
      updated,
      nodeKey(level, parent),
      nodeAt(updated, level - 1, left + 1) ?? nodeAt(updated, level - 1, left)
    )
  }
  return updated
}
const appendIntent = (
  prior: CycleState,
  record: JournalRecord,
  operationId: OperationId,
  ordinal: number
): CycleState => {
  const intentCount = prior.intentCount + 1
  const priorOffset = Option.getOrUndefined(HashMap.get(prior.unresolvedOffsets, operationId))
  const withoutDuplicate =
    priorOffset === undefined
      ? prior.unresolvedTree
      : setUnresolved(prior.unresolvedTree, priorOffset, intentCount, undefined)
  const pending = !HashSet.has(prior.observedOperations, operationId)
  const tree = setUnresolved(withoutDuplicate, prior.intentCount, intentCount, pending ? record : undefined)
  return {
    ...prior,
    intentCount,
    maximumOrdinal: Math.max(prior.maximumOrdinal, ordinal),
    latestIntent: record,
    latestUnresolvedIntent: nodeAt(tree, depthFor(intentCount), 0),
    unresolvedOffsets: pending
      ? HashMap.set(prior.unresolvedOffsets, operationId, prior.intentCount)
      : HashMap.remove(prior.unresolvedOffsets, operationId),
    unresolvedTree: tree
  }
}
const appendOutcome = (prior: CycleState, record: JournalRecord, operationId: OperationId): CycleState => {
  const offset = Option.getOrUndefined(HashMap.get(prior.unresolvedOffsets, operationId))
  const tree =
    offset === undefined
      ? prior.unresolvedTree
      : setUnresolved(prior.unresolvedTree, offset, prior.intentCount, undefined)
  return {
    ...prior,
    latestOutcome: record,
    latestUnresolvedIntent: nodeAt(tree, depthFor(prior.intentCount), 0),
    observedOperations: HashSet.add(prior.observedOperations, operationId),
    unresolvedOffsets: HashMap.remove(prior.unresolvedOffsets, operationId),
    unresolvedTree: tree
  }
}

/** A later observation settles its exact operation; earlier observations remain visible when diagnosing out-of-order input. */
export const appendCompletionReadCycleEvidence = (
  index: CompletionReadCycles,
  record: JournalRecord
): CompletionReadCycles => {
  const event = record.event
  const read =
    event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadCompletionTaskFacts"
      ? {
          kind: "Intent" as const,
          operationId: event.operation.operationId,
          purpose: event.operation.purpose,
          request: event.operation.request
        }
      : event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskCompletionFacts"
        ? {
            kind: "Outcome" as const,
            operationId: event.operationId,
            purpose: event.observation.purpose,
            request: event.observation.request
          }
        : undefined
  if (read === undefined) return index
  const key = keyFor(read.request, read.purpose.attemptOrdinal, read.purpose._tag)
  if (key === undefined || read.request.claim.plannedAttempt.runId !== record.runId) return index
  const roots = rootsOf(index)
  const history = Option.getOrElse(
    HashMap.get(roots, key),
    (): CycleHistory => ({ length: 0, entries: HashMap.empty() })
  )
  const prior = Option.getOrUndefined(HashMap.get(history.entries, history.length - 1))?.state ?? emptyState()
  const ordinal =
    read.purpose._tag === "Authorization" ? read.purpose.authorizationOrdinal : read.purpose.confirmationOrdinal
  const state =
    read.kind === "Intent"
      ? appendIntent(prior, record, read.operationId, ordinal)
      : appendOutcome(prior, record, read.operationId)
  return retain(
    HashMap.set(roots, key, {
      length: history.length + 1,
      entries: HashMap.set(history.entries, history.length, { position: record.position, state })
    })
  )
}

type CompletionReadCycleOperation = "SnapshotLookup" | "UnresolvedNodeRead"
const observers = new Set<(operation: CompletionReadCycleOperation) => void>()
/** Test-only operation observer, intentionally not part of the production barrel. */
export const observeCompletionReadCycleOperations = (observer: (operation: CompletionReadCycleOperation) => void) => {
  observers.add(observer)
  return () => {
    observers.delete(observer)
  }
}
const entryAt = (history: CycleHistory, offset: number) => {
  for (const observer of observers) observer("SnapshotLookup")
  return Option.getOrUndefined(HashMap.get(history.entries, offset))
}
export const completionReadCycleAt = (
  index: CompletionReadCycles,
  query: {
    readonly request: CompletionTaskRequest
    readonly attemptOrdinal: CompletionTaskRequestOrdinal
    readonly purpose: CompletionTaskFocusedReadPurpose["_tag"]
    readonly throughPosition: number
  }
): CompletionReadCycleState => {
  const key = keyFor(query.request, query.attemptOrdinal, query.purpose)
  const history = key === undefined ? undefined : Option.getOrUndefined(HashMap.get(rootsOf(index), key))
  if (history === undefined) return emptyState()
  const latest = entryAt(history, history.length - 1)
  if (latest === undefined || latest.position <= query.throughPosition) return latest?.state ?? emptyState()
  let low = 0
  let high = history.length
  while (low < high) {
    const middle = Math.floor((low + high) / branchingFactor)
    const entry = entryAt(history, middle)
    if (entry !== undefined && entry.position <= query.throughPosition) low = middle + 1
    else high = middle
  }
  return low === 0 ? emptyState() : (entryAt(history, low - 1)?.state ?? emptyState())
}

/** All cutoff snapshots and persistent unresolved-tree roots are reachable here; no predecessor projection is retained. */
export const inspectCompletionReadCycleStorage = (index: CompletionReadCycles): ReadonlyArray<object> => [
  rootsOf(index)
]
