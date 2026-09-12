import type { AttemptId, PlannedTaskAttempt, RunId } from "@dalph/contracts"
import { HashMap, HashSet, Option } from "effect"
import type { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"

const RetainedExecutorResponsibilitySubjectsTypeId: unique symbol = Symbol("RetainedExecutorResponsibilitySubjects")

/** Currently retained executor responsibilities, distinct from historical origins and from permission to refresh executing work. Safe or ambiguous work remains retained; accepted terminal results, replacement, and abandonment remove it. */
export interface RetainedExecutorResponsibilitySubjects {
  readonly [RetainedExecutorResponsibilitySubjectsTypeId]: true
}

/** One exact retained attempt and the journal position where Dalph assumed its executor responsibility. */
export interface RetainedExecutorResponsibilitySubject {
  readonly plannedAttempt: PlannedTaskAttempt
  readonly beganAt: JournalPosition
}

interface SubjectSnapshot {
  readonly position: JournalPosition
  readonly subjects: HashMap.HashMap<AttemptId, RetainedExecutorResponsibilitySubject>
}
interface RunHistory {
  readonly count: number
  readonly snapshots: HashMap.HashMap<number, SubjectSnapshot>
  readonly latest: SubjectSnapshot
}
const rootsByIndex = new WeakMap<RetainedExecutorResponsibilitySubjects, HashMap.HashMap<RunId, RunHistory>>()
const retain = (roots: HashMap.HashMap<RunId, RunHistory>): RetainedExecutorResponsibilitySubjects => {
  const index: RetainedExecutorResponsibilitySubjects = { [RetainedExecutorResponsibilitySubjectsTypeId]: true }
  rootsByIndex.set(index, roots)
  return index
}
const rootsOf = (index: RetainedExecutorResponsibilitySubjects) =>
  Option.getOrThrow(Option.fromUndefinedOr(rootsByIndex.get(index)))
export const emptyRetainedExecutorResponsibilitySubjects = (): RetainedExecutorResponsibilitySubjects =>
  retain(HashMap.empty())

type RetentionChange =
  | { readonly _tag: "Retain"; readonly plannedAttempt: PlannedTaskAttempt }
  | { readonly _tag: "Release"; readonly runId: RunId; readonly attemptId: AttemptId }
const changeFor = ({ event }: JournalRecord): RetentionChange | undefined => {
  if (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")
    return { _tag: "Retain", plannedAttempt: event.plannedAttempt }
  if (event._tag === "PlannedAttemptReplaced" || event._tag === "AttemptImplementationAbandoned")
    return {
      _tag: "Release",
      runId: event.subject.plannedAttempt.runId,
      attemptId: event.subject.plannedAttempt.attemptId
    }
  if (event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal")
    return { _tag: "Release", ...event.report.correlation }
  return undefined
}

const applyRetentionChange = (
  subjects: HashMap.HashMap<AttemptId, RetainedExecutorResponsibilitySubject>,
  change: RetentionChange,
  position: JournalPosition
) => {
  if (change._tag === "Retain")
    return HashMap.set(subjects, change.plannedAttempt.attemptId, {
      plannedAttempt: change.plannedAttempt,
      beganAt: position
    })
  return HashMap.has(subjects, change.attemptId) ? HashMap.remove(subjects, change.attemptId) : undefined
}

const appendSubjectSnapshot = (prior: RunHistory | undefined, latest: SubjectSnapshot): RunHistory => {
  const count = prior?.count ?? 0
  return { count: count + 1, latest, snapshots: HashMap.set(prior?.snapshots ?? HashMap.empty(), count, latest) }
}

/** One chronological record changes only its exact subject; mere observations, Safe reports, and foreign envelopes cannot retire responsibility. Historical snapshots structurally share the retained-subject maps. */
export const appendRetainedExecutorResponsibilitySubjects = (
  index: RetainedExecutorResponsibilitySubjects,
  record: JournalRecord
): RetainedExecutorResponsibilitySubjects => {
  const change = changeFor(record)
  if (change === undefined) return index
  const correlation = change._tag === "Retain" ? change.plannedAttempt : change
  if (correlation.runId !== record.runId) return index
  const roots = rootsOf(index)
  const prior = Option.getOrUndefined(HashMap.get(roots, record.runId))
  const previousSubjects = prior?.latest.subjects ?? HashMap.empty<AttemptId, RetainedExecutorResponsibilitySubject>()
  const subjects = applyRetentionChange(previousSubjects, change, record.position)
  if (subjects === undefined) return index
  const latest: SubjectSnapshot = { position: record.position, subjects }
  return retain(HashMap.set(roots, record.runId, appendSubjectSnapshot(prior, latest)))
}

let observers = HashSet.empty<(operation: "TimelineVisit" | "SubjectVisit") => void>()
const visit = (operation: "TimelineVisit" | "SubjectVisit"): void => {
  for (const observer of observers) observer(operation)
}
const searchPartitions = 2
const subjectsThrough = (history: RunHistory, cutoff: number): SubjectSnapshot | undefined => {
  visit("TimelineVisit")
  if (history.latest.position <= cutoff) return history.latest
  let low = 0
  let high = history.count
  while (low < high) {
    const middle = Math.floor((low + high) / searchPartitions)
    visit("TimelineVisit")
    const snapshot = Option.getOrThrow(HashMap.get(history.snapshots, middle))
    if (snapshot.position <= cutoff) low = middle + 1
    else high = middle
  }
  return low === 0 ? undefined : Option.getOrThrow(HashMap.get(history.snapshots, low - 1))
}

/** Exports only the currently retained subjects, not historical origins. Cutoff lookup is logarithmic; warm lookup visits no retired subjects, then orders the R returned subjects in O(R log R). */
export const retainedExecutorResponsibilitySubjectsAt = (
  index: RetainedExecutorResponsibilitySubjects,
  query: { readonly runId: RunId; readonly throughPosition: number }
): ReadonlyArray<RetainedExecutorResponsibilitySubject> => {
  const history = Option.getOrUndefined(HashMap.get(rootsOf(index), query.runId))
  if (history === undefined) return []
  const snapshot = subjectsThrough(history, query.throughPosition)
  if (snapshot === undefined) return []
  return Array.from(HashMap.values(snapshot.subjects), (subject) => {
    visit("SubjectVisit")
    return subject
  }).sort((left, right) => left.beganAt - right.beganAt)
}

/** Test-only roots expose all cutoff snapshots and their shared HAMT roots, never a chain of predecessor evidence objects. */
export const inspectRetainedExecutorResponsibilityStorage = (
  index: RetainedExecutorResponsibilitySubjects
): ReadonlyArray<object> => [rootsOf(index)]
/** Test-only deterministic visits; never consulted by retention decisions. */
export const observeRetainedExecutorResponsibilityProjection = (
  observer: (operation: "TimelineVisit" | "SubjectVisit") => void
): (() => void) => {
  observers = HashSet.add(observers, observer)
  return () => {
    observers = HashSet.remove(observers, observer)
  }
}
