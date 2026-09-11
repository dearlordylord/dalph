import { HashMap, Option } from "effect"
import type { TaskId } from "@dalph/contracts"
import { isExactTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import type { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"
import {
  appendJournalRecord,
  emptyJournalRecords,
  inspectJournalRecordStorage,
  journalRecordAt,
  type JournalRecordSequence
} from "./record-sequence.js"

const ClaimObservationEpisodeIndexTypeId: unique symbol = Symbol("ClaimObservationEpisodeIndex")
const lastSequenceEntryOffset = -1
const binarySearchPartitionCount = 2

/** Decoded consecutive equal focused claim observations; this index grants no reacquisition authority. */
export interface ClaimObservationEpisodeIndex {
  readonly [ClaimObservationEpisodeIndexTypeId]: true
}

interface EpisodeRoots {
  readonly byTask: HashMap.HashMap<TaskId, JournalRecordSequence>
  readonly startedAt: HashMap.HashMap<JournalPosition, JournalPosition>
}

const rootsByIndex = new WeakMap<ClaimObservationEpisodeIndex, EpisodeRoots>()
const retain = (roots: EpisodeRoots): ClaimObservationEpisodeIndex => {
  const index: ClaimObservationEpisodeIndex = { [ClaimObservationEpisodeIndexTypeId]: true }
  rootsByIndex.set(index, roots)
  return index
}
const rootsOf = (index: ClaimObservationEpisodeIndex): EpisodeRoots =>
  Option.getOrThrow(Option.fromUndefinedOr(rootsByIndex.get(index)))

export const emptyClaimObservationEpisodes = (): ClaimObservationEpisodeIndex =>
  retain({ byTask: HashMap.empty(), startedAt: HashMap.empty() })

const focusedObservation = (record: JournalRecord) => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return undefined
  const observation = record.event.observation
  return observation._tag === "FocusedTaskClaimFacts" || observation._tag === "FocusedTaskClaimFactsUnreadable"
    ? observation
    : undefined
}

const sameObservation = (left: JournalRecord, right: JournalRecord): boolean => {
  const before = focusedObservation(left)
  const after = focusedObservation(right)
  if (before?._tag !== "FocusedTaskClaimFacts" || after?._tag !== "FocusedTaskClaimFacts") return false
  if (before.observation._tag === "UnclaimedTask") return after.observation._tag === "UnclaimedTask"
  return after.observation._tag === "ActiveTaskClaim" && isExactTaskClaim(before.observation, after.observation)
}

/** Adds only a newly decoded focused observation, sharing earlier task sequences and episode positions. */
export const appendClaimObservationEpisode = (
  index: ClaimObservationEpisodeIndex,
  record: JournalRecord
): ClaimObservationEpisodeIndex => {
  const observation = focusedObservation(record)
  if (observation === undefined) return index
  const roots = rootsOf(index)
  const taskId = observation.coverage.taskId
  const prior = Option.getOrElse(HashMap.get(roots.byTask, taskId), emptyJournalRecords)
  const latest = journalRecordAt(prior, lastSequenceEntryOffset)
  const startedAt =
    latest !== undefined && sameObservation(latest, record)
      ? Option.getOrElse(HashMap.get(roots.startedAt, latest.position), () => record.position)
      : record.position
  return retain({
    byTask: HashMap.set(roots.byTask, taskId, appendJournalRecord(prior, record)),
    startedAt: HashMap.set(roots.startedAt, record.position, startedAt)
  })
}

/** Latest focused claim observation visible through an exact journal position, with its uninterrupted episode start. */
export const claimObservationEpisodeAt = (
  index: ClaimObservationEpisodeIndex,
  taskId: TaskId,
  throughPosition: number
): { readonly record: JournalRecord; readonly episodeStartedAt: JournalPosition } | undefined => {
  const roots = rootsOf(index)
  const records = Option.getOrElse(HashMap.get(roots.byTask, taskId), emptyJournalRecords)
  let low = 0
  let high = records.length
  while (low < high) {
    const middle = Math.floor((low + high) / binarySearchPartitionCount)
    const record = journalRecordAt(records, middle)
    if (record !== undefined && record.position <= throughPosition) low = middle + 1
    else high = middle
  }
  const record = low === 0 ? undefined : journalRecordAt(records, low - 1)
  if (record === undefined) return undefined
  const episodeStartedAt = Option.getOrUndefined(HashMap.get(roots.startedAt, record.position))
  return episodeStartedAt === undefined ? undefined : { record, episodeStartedAt }
}

/** Test-only complete retained roots, including private ordered sequence storage. */
export const inspectClaimObservationEpisodeStorage = (index: ClaimObservationEpisodeIndex): ReadonlyArray<object> => {
  const roots = rootsOf(index)
  return [roots, ...Array.from(roots.byTask, ([, records]) => inspectJournalRecordStorage(records))]
}
