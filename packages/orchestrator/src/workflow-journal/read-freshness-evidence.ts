import { HashMap, Option } from "effect"
import type { PlannedTaskAttempt, TaskId } from "@dalph/contracts"
import { taskTrackerTargetKey, type TrackerTarget } from "../authorities/task-tracker/target.js"
import type { WorkflowOperation } from "../workflow/registry/operation.js"
import type { JournalRecord } from "./store.js"
import {
  appendJournalRecord,
  emptyJournalRecords,
  inspectJournalRecordStorage,
  journalRecordAt,
  type JournalRecordSequence
} from "./record-sequence.js"

const ReadFreshnessEvidenceTypeId: unique symbol = Symbol("ReadFreshnessEvidence")
const lastOffset = -1
const partitions = 2
/** Chronological read/observation families are distinct freshness phenomena: a later graph refresh cannot hide the latest focused claim/specification, nor can a target read hide a worktree read. This index is derived evidence only. */
export interface ReadFreshnessEvidence {
  readonly [ReadFreshnessEvidenceTypeId]: true
}
type TaskReadKind = "ReadTrackerGraph" | "ReadTaskWorkSpecification" | "ReadTaskClaim"
type TaskObservationKind =
  | "FocusedTaskWorkSpecificationFacts"
  | "FocusedTaskClaimFacts"
  | "FocusedTaskClaimFactsUnreadable"
type AttemptReadKind = "ReadTaskWorktree" | "ReadTargetLineage"
type IntegrationTarget = Extract<WorkflowOperation, { readonly _tag: "ReadTargetLineage" }>["integrationTarget"]
const rootsByIndex = new WeakMap<ReadFreshnessEvidence, HashMap.HashMap<string, JournalRecordSequence>>()
const retain = (roots: HashMap.HashMap<string, JournalRecordSequence>): ReadFreshnessEvidence => {
  const index: ReadFreshnessEvidence = { [ReadFreshnessEvidenceTypeId]: true }
  rootsByIndex.set(index, roots)
  return index
}
const rootsOf = (index: ReadFreshnessEvidence) => Option.getOrThrow(Option.fromUndefinedOr(rootsByIndex.get(index)))
export const emptyReadFreshnessEvidence = (): ReadFreshnessEvidence => retain(HashMap.empty())
const taskKey = (family: "Read" | "Observation", taskId: TaskId, target: TrackerTarget, kind: string) =>
  JSON.stringify([family, taskId, taskTrackerTargetKey(target), kind])
const attemptKey = (plan: PlannedTaskAttempt, kind: AttemptReadKind, target?: IntegrationTarget) =>
  JSON.stringify([
    "AttemptRead",
    plan.runId,
    plan.attemptId,
    plan.taskId,
    plan.taskRevision,
    plan.baseSha,
    plan.branch,
    plan.worktree,
    plan.executor,
    kind,
    target?.repository,
    target?.ref
  ])
const observationKeys = (
  facts: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>["observation"]
): ReadonlyArray<string> => {
  if (
    facts._tag === "FocusedTaskWorkSpecificationFacts" ||
    facts._tag === "FocusedTaskClaimFacts" ||
    facts._tag === "FocusedTaskClaimFactsUnreadable"
  )
    return [
      taskKey(
        "Observation",
        facts._tag === "FocusedTaskWorkSpecificationFacts" ? facts.factFamily.taskId : facts.coverage.taskId,
        facts.target,
        facts._tag
      )
    ]
  return []
}
const trackerIntentKeys = (
  operation: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }>["operation"]
): ReadonlyArray<string> => {
  if (operation._tag === "ReadTrackerGraph")
    return operation.readShape.explicitlyCoveredTaskIds.map((taskId) =>
      taskKey("Read", taskId, operation.target, operation._tag)
    )
  if (operation._tag === "ReadTaskWorkSpecification" || operation._tag === "ReadTaskClaim")
    return [taskKey("Read", operation.taskId, operation.target, operation._tag)]
  return []
}
const gitIntentKeys = (
  operation: Extract<JournalRecord["event"], { readonly _tag: "GitReadIntentRecorded" }>["operation"]
): ReadonlyArray<string> => {
  if (operation._tag === "ReadTaskWorktree") return [attemptKey(operation.plannedAttempt, operation._tag)]
  return [
    attemptKey(operation.plannedAttempt, operation._tag),
    attemptKey(operation.plannedAttempt, operation._tag, operation.integrationTarget)
  ]
}
const keysOf = ({ event }: JournalRecord): ReadonlyArray<string> => {
  if (event._tag === "TaskTrackerFactsObserved") return observationKeys(event.observation)
  if (event._tag === "TaskTrackerReadIntentRecorded") return trackerIntentKeys(event.operation)
  if (event._tag === "GitReadIntentRecorded") return gitIntentKeys(event.operation)
  return []
}

export const appendReadFreshnessEvidence = (
  index: ReadFreshnessEvidence,
  record: JournalRecord
): ReadFreshnessEvidence => {
  const keys = keysOf(record)
  if (keys.length === 0) return index
  let roots = rootsOf(index)
  for (const key of keys)
    roots = HashMap.set(
      roots,
      key,
      appendJournalRecord(Option.getOrElse(HashMap.get(roots, key), emptyJournalRecords), record)
    )
  return retain(roots)
}
const latest = (index: ReadFreshnessEvidence, key: string, cutoff: number): JournalRecord | undefined => {
  const records = Option.getOrElse(HashMap.get(rootsOf(index), key), emptyJournalRecords)
  const last = journalRecordAt(records, lastOffset)
  if (last === undefined || last.position <= cutoff) return last
  let low = 0
  let high = records.length
  while (low < high) {
    const middle = Math.floor((low + high) / partitions)
    const record = journalRecordAt(records, middle)
    if (record !== undefined && record.position <= cutoff) low = middle + 1
    else high = middle
  }
  return low === 0 ? undefined : journalRecordAt(records, low - 1)
}
export const latestTaskObservationAt = (
  index: ReadFreshnessEvidence,
  query: {
    readonly taskId: TaskId
    readonly target: TrackerTarget
    readonly kind: TaskObservationKind
    readonly throughPosition: number
  }
): JournalRecord | undefined =>
  latest(index, taskKey("Observation", query.taskId, query.target, query.kind), query.throughPosition)
export const latestTaskReadAt = (
  index: ReadFreshnessEvidence,
  query: {
    readonly taskId: TaskId
    readonly target: TrackerTarget
    readonly kind: TaskReadKind
    readonly throughPosition: number
  }
): JournalRecord | undefined =>
  latest(index, taskKey("Read", query.taskId, query.target, query.kind), query.throughPosition)
export const latestAttemptReadAt = (
  index: ReadFreshnessEvidence,
  query: {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly kind: AttemptReadKind
    readonly integrationTarget?: IntegrationTarget
    readonly throughPosition: number
  }
): JournalRecord | undefined =>
  latest(index, attemptKey(query.plannedAttempt, query.kind, query.integrationTarget), query.throughPosition)
/** Test-only complete retained roots, including private sequence storage. */
export const inspectReadFreshnessEvidenceStorage = (index: ReadFreshnessEvidence): ReadonlyArray<object> => {
  const roots = rootsOf(index)
  return [roots, ...Array.from(roots, ([, records]) => inspectJournalRecordStorage(records))]
}
