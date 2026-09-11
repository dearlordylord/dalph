import { HashMap, Option } from "effect"
import type { TaskId, TaskRevision } from "@dalph/contracts"
import { taskTrackerTargetKey, type TrackerTarget } from "../authorities/task-tracker/target.js"
import type { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"
import {
  appendJournalRecord,
  emptyJournalRecords,
  inspectJournalRecordStorage,
  journalRecordAt,
  type JournalRecordSequence
} from "./record-sequence.js"

const SpecificationDivergenceTypeId: unique symbol = Symbol("SpecificationDivergence")
const lastOffset = -1
const partitions = 2

/** A later differing authored specification permanently invalidates an earlier choice, even if the fingerprint subsequently returns. This derived evidence grants no tracker authority. */
export interface SpecificationDivergence {
  readonly [SpecificationDivergenceTypeId]: true
}
interface SpecificationBucket {
  readonly observations: JournalRecordSequence
  readonly precedingDistinct: HashMap.HashMap<JournalPosition, JournalRecord>
}
const rootsByIndex = new WeakMap<SpecificationDivergence, HashMap.HashMap<string, SpecificationBucket>>()
const rootsOf = (index: SpecificationDivergence) => Option.getOrThrow(Option.fromUndefinedOr(rootsByIndex.get(index)))
const retain = (roots: HashMap.HashMap<string, SpecificationBucket>): SpecificationDivergence => {
  const index: SpecificationDivergence = { [SpecificationDivergenceTypeId]: true }
  rootsByIndex.set(index, roots)
  return index
}
export const emptySpecificationDivergence = (): SpecificationDivergence => retain(HashMap.empty())
const bucketKey = (taskId: TaskId, target?: TrackerTarget): string =>
  JSON.stringify([taskId, target === undefined ? null : taskTrackerTargetKey(target)])
const factsOf = ({ event }: JournalRecord) =>
  event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
    ? event.observation
    : undefined
const emptyBucket = (): SpecificationBucket => ({
  observations: emptyJournalRecords(),
  precedingDistinct: HashMap.empty()
})

/** Each position stores only the previous observation with a distinct fingerprint, not a predecessor index/root. */
export const appendSpecificationDivergence = (
  index: SpecificationDivergence,
  record: JournalRecord
): SpecificationDivergence => {
  const facts = factsOf(record)
  if (facts === undefined) return index
  let roots = rootsOf(index)
  for (const key of [bucketKey(facts.factFamily.taskId), bucketKey(facts.factFamily.taskId, facts.target)]) {
    const bucket = Option.getOrElse(HashMap.get(roots, key), emptyBucket)
    const latest = journalRecordAt(bucket.observations, lastOffset)
    const distinct =
      latest === undefined
        ? undefined
        : factsOf(latest)?.factFamily.fingerprint !== facts.factFamily.fingerprint
          ? latest
          : Option.getOrUndefined(HashMap.get(bucket.precedingDistinct, latest.position))
    roots = HashMap.set(roots, key, {
      observations: appendJournalRecord(bucket.observations, record),
      precedingDistinct:
        distinct === undefined
          ? bucket.precedingDistinct
          : HashMap.set(bucket.precedingDistinct, record.position, distinct)
    })
  }
  return retain(roots)
}

const lastVisible = (records: JournalRecordSequence, cutoff: number): JournalRecord | undefined => {
  const latest = journalRecordAt(records, lastOffset)
  if (latest === undefined || latest.position <= cutoff) return latest
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

/** Answers the chronological existential predicate using the latest two distinct fingerprints visible at the requested cutoff. */
export const specificationDivergedAfter = (
  index: SpecificationDivergence,
  query: {
    readonly taskId: TaskId
    readonly target?: TrackerTarget
    readonly expected: TaskRevision
    readonly afterPosition: number
    readonly throughPosition: number
  }
): boolean => {
  const bucket = Option.getOrUndefined(HashMap.get(rootsOf(index), bucketKey(query.taskId, query.target)))
  if (bucket === undefined) return false
  const latest = lastVisible(bucket.observations, query.throughPosition)
  if (latest === undefined) return false
  const differing =
    factsOf(latest)?.factFamily.fingerprint !== query.expected
      ? latest
      : Option.getOrUndefined(HashMap.get(bucket.precedingDistinct, latest.position))
  return differing !== undefined && differing.position > query.afterPosition
}

/** Test-only roots include the complete persistent buckets and private ordered record storage. */
export const inspectSpecificationDivergenceStorage = (index: SpecificationDivergence): ReadonlyArray<object> => {
  const roots = rootsOf(index)
  return [roots, ...Array.from(roots, ([, bucket]) => inspectJournalRecordStorage(bucket.observations))]
}
