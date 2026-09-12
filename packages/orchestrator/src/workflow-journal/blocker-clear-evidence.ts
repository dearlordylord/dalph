import { HashMap, HashSet, Option } from "effect"
import type { TaskId } from "@dalph/contracts"
import type { TaskDagSnapshot } from "../authorities/task-tracker/graph.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../authorities/task-tracker/target.js"
import type { JournalPosition } from "./identity.js"

const BlockerClearEvidenceTypeId: unique symbol = Symbol("BlockerClearEvidence")
const partitions = 2

/** A task's latest blocked and later-clear observations, not completion authority. Reconfirming the selected snapshot shares task state; switching to a different historical snapshot updates its semantic task fanout even when encoded as Unchanged. */
export interface BlockerClearEvidence {
  readonly [BlockerClearEvidenceTypeId]: true
}
interface Boundaries {
  readonly blocked?: JournalPosition
  readonly cleared?: JournalPosition
}
interface GraphState {
  readonly snapshot: Option.Option<TaskDagSnapshot>
  readonly active: HashMap.HashMap<TaskId, boolean>
  readonly settled: HashMap.HashMap<TaskId, Boundaries>
  readonly observedAt: JournalPosition
}
interface TargetHistory {
  readonly count: number
  readonly positions: HashMap.HashMap<number, JournalPosition>
  readonly states: HashMap.HashMap<JournalPosition, GraphState>
  readonly latest: GraphState
}
const rootsByEvidence = new WeakMap<BlockerClearEvidence, HashMap.HashMap<string, TargetHistory>>()
const retain = (roots: HashMap.HashMap<string, TargetHistory>): BlockerClearEvidence => {
  const evidence: BlockerClearEvidence = { [BlockerClearEvidenceTypeId]: true }
  rootsByEvidence.set(evidence, roots)
  return evidence
}
const rootsOf = (index: BlockerClearEvidence) => Option.getOrThrow(Option.fromUndefinedOr(rootsByEvidence.get(index)))
export const emptyBlockerClearEvidence = (): BlockerClearEvidence => retain(HashMap.empty())

let observers = HashSet.empty<() => void>()
/** Test-only semantic task visits; never an authority input. */
export const observeBlockerClearProjection = (observer: () => void): (() => void) => {
  observers = HashSet.add(observers, observer)
  return () => {
    observers = HashSet.remove(observers, observer)
  }
}
const visitTask = (): void => {
  for (const observer of observers) observer()
}
const boundariesAt = (state: GraphState, taskId: TaskId): Boundaries => {
  const settled = Option.getOrElse(HashMap.get(state.settled, taskId), (): Boundaries => ({}))
  const active = Option.getOrUndefined(HashMap.get(state.active, taskId))
  return active === undefined
    ? settled
    : active
      ? { ...settled, blocked: state.observedAt }
      : { ...settled, cleared: state.observedAt }
}

const settlePriorBoundaries = (prior: GraphState | undefined): HashMap.HashMap<TaskId, Boundaries> => {
  let settled = prior?.settled ?? HashMap.empty<TaskId, Boundaries>()
  if (prior !== undefined)
    for (const [taskId] of prior.active) {
      visitTask()
      settled = HashMap.set(settled, taskId, boundariesAt(prior, taskId))
    }
  return settled
}
const blockerMembership = (snapshot: Option.Option<TaskDagSnapshot>): HashMap.HashMap<TaskId, boolean> => {
  let active = HashMap.empty<TaskId, boolean>()
  if (Option.isSome(snapshot))
    for (const taskId of snapshot.value.taskIds()) {
      visitTask()
      active = HashMap.set(
        active,
        taskId,
        snapshot.value
          .prerequisitesOf(taskId)
          .some((id) => Option.getOrUndefined(snapshot.value.lifecycleOf(id))?._tag !== "CompletedSuccessfully")
      )
    }
  return active
}

/** Finalizes only the prior selected snapshot's task fanout, then derives the new snapshot's task statuses. Unknown/omitted tasks keep their earlier boundaries. */
const switchGraph = (
  prior: GraphState | undefined,
  snapshot: Option.Option<TaskDagSnapshot>,
  position: JournalPosition
): GraphState => {
  if (prior !== undefined && Option.getOrUndefined(prior.snapshot) === Option.getOrUndefined(snapshot))
    return { ...prior, observedAt: position }
  const settled = settlePriorBoundaries(prior)
  const active = blockerMembership(snapshot)
  return { snapshot, active, settled, observedAt: position }
}

export const appendBlockerClearEvidence = (
  index: BlockerClearEvidence,
  target: TrackerTarget,
  position: JournalPosition,
  snapshot: Option.Option<TaskDagSnapshot>
): BlockerClearEvidence => {
  const roots = rootsOf(index)
  const key = taskTrackerTargetKey(target)
  const prior = Option.getOrUndefined(HashMap.get(roots, key))
  const state = switchGraph(prior?.latest, snapshot, position)
  const count = prior?.count ?? 0
  return retain(
    HashMap.set(roots, key, {
      count: count + 1,
      positions: HashMap.set(prior?.positions ?? HashMap.empty(), count, position),
      states: HashMap.set(prior?.states ?? HashMap.empty(), position, state),
      latest: state
    })
  )
}

const visibleState = (history: TargetHistory, cutoff: number): GraphState | undefined => {
  if (history.latest.observedAt <= cutoff) return history.latest
  let low = 0
  let high = history.count
  while (low < high) {
    const middle = Math.floor((low + high) / partitions)
    const position = Option.getOrThrow(HashMap.get(history.positions, middle))
    if (position <= cutoff) low = middle + 1
    else high = middle
  }
  return low === 0
    ? undefined
    : Option.getOrUndefined(HashMap.get(history.states, Option.getOrThrow(HashMap.get(history.positions, low - 1))))
}

/** Exact latest blocked-then-clear episode after a promotion cutoff; later re-blocking denies the episode. */
export const blockerClearEpisodeAt = (
  index: BlockerClearEvidence,
  query: {
    readonly target: TrackerTarget
    readonly taskId: TaskId
    readonly afterPosition: number
    readonly throughPosition: number
  }
): { readonly blockerObservedAt: JournalPosition; readonly blockerClearedAt: JournalPosition } | undefined => {
  const history = Option.getOrUndefined(HashMap.get(rootsOf(index), taskTrackerTargetKey(query.target)))
  const state = history === undefined ? undefined : visibleState(history, query.throughPosition)
  if (state === undefined) return undefined
  const { blocked, cleared } = boundariesAt(state, query.taskId)
  return blocked === undefined || cleared === undefined || blocked <= query.afterPosition || cleared <= blocked
    ? undefined
    : { blockerObservedAt: blocked, blockerClearedAt: cleared }
}

/** Test-only complete persistent roots, including shared snapshot and task maps at historical cutoffs. */
export const inspectBlockerClearEvidenceStorage = (index: BlockerClearEvidence): ReadonlyArray<object> => [
  rootsOf(index)
]
