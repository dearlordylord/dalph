import type { RunId } from "@dalph/contracts"
import { HashMap, Option } from "effect"
import type { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"

const WorkflowFinalityPremiseChangesTypeId: unique symbol = Symbol("WorkflowFinalityPremiseChanges")
const binarySearchPartitions = 2

/**
 * Positions where a Run's journal records something that may invalidate an
 * earlier workflow-finality proof. Capacity-only bookkeeping is deliberately
 * excluded; this index does not assert whether finality currently holds.
 * Positions are immutable derived evidence, never persisted authority. A
 * capacity-only append shares this exact projection, and earlier cutoffs use
 * the ordered positions rather than reconstructing a historical journal.
 */
export interface WorkflowFinalityPremiseChanges {
  readonly [WorkflowFinalityPremiseChangesTypeId]: true
}
interface PositionTimeline {
  readonly length: number
  readonly positions: HashMap.HashMap<number, JournalPosition>
}
type Timelines = HashMap.HashMap<RunId, PositionTimeline>
const timelinesByEvidence = new WeakMap<WorkflowFinalityPremiseChanges, Timelines>()
const timelinesOf = (evidence: WorkflowFinalityPremiseChanges): Timelines =>
  Option.getOrThrow(Option.fromUndefinedOr(timelinesByEvidence.get(evidence)))
const retain = (timelines: Timelines): WorkflowFinalityPremiseChanges => {
  const evidence: WorkflowFinalityPremiseChanges = { [WorkflowFinalityPremiseChangesTypeId]: true }
  timelinesByEvidence.set(evidence, timelines)
  return evidence
}
export const emptyWorkflowFinalityPremiseChanges = (): WorkflowFinalityPremiseChanges => retain(HashMap.empty())

export const appendWorkflowFinalityPremiseChanges = (
  evidence: WorkflowFinalityPremiseChanges,
  record: JournalRecord
): WorkflowFinalityPremiseChanges => {
  if (record.event._tag === "TaskWorkCapacityChanged") return evidence
  const timelines = timelinesOf(evidence)
  const prior = Option.getOrElse(
    HashMap.get(timelines, record.runId),
    (): PositionTimeline => ({ length: 0, positions: HashMap.empty() })
  )
  return retain(
    HashMap.set(timelines, record.runId, {
      length: prior.length + 1,
      positions: HashMap.set(prior.positions, prior.length, record.position)
    })
  )
}

const observers = new Set<(event: "PositionLookup") => void>()
/** Test-only deterministic operation observation, excluded from the production barrel. */
export const observeWorkflowFinalityPremiseChangeLookup = (observer: (event: "PositionLookup") => void) => {
  observers.add(observer)
  return () => {
    observers.delete(observer)
  }
}
const positionAt = (timeline: PositionTimeline, offset: number): JournalPosition | undefined => {
  for (const observer of observers) observer("PositionLookup")
  return Option.getOrUndefined(HashMap.get(timeline.positions, offset))
}

/** O(1) warm/latest work; earlier windows binary-search only the matching Run's position timeline. */
export const lastWorkflowFinalityPremiseChangeAt = (
  evidence: WorkflowFinalityPremiseChanges,
  query: { readonly runId: RunId; readonly throughPosition: number }
): JournalPosition | undefined => {
  const timeline = Option.getOrUndefined(HashMap.get(timelinesOf(evidence), query.runId))
  if (timeline === undefined) return undefined
  const latest = positionAt(timeline, timeline.length - 1)
  if (latest === undefined || latest <= query.throughPosition) return latest
  let low = 0
  let high = timeline.length
  while (low < high) {
    const middle = Math.floor((low + high) / binarySearchPartitions)
    const position = positionAt(timeline, middle)
    if (position !== undefined && position <= query.throughPosition) low = middle + 1
    else high = middle
  }
  return low === 0 ? undefined : positionAt(timeline, low - 1)
}

/** Includes the Run map and every persistent position-map root; no predecessor projection is retained. */
export const inspectWorkflowFinalityPremiseChangesStorage = (
  evidence: WorkflowFinalityPremiseChanges
): ReadonlyArray<object> => [timelinesOf(evidence)]
