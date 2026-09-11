import { HashMap, Option } from "effect"
import type { PlannedTaskAttempt, TaskId } from "@dalph/contracts"
import {
  appendBlockerClearEvidence,
  blockerClearEpisodeAt,
  emptyBlockerClearEvidence,
  inspectBlockerClearEvidenceStorage,
  type BlockerClearEvidence
} from "./blocker-clear-evidence.js"
import type { TaskDagSnapshot } from "../authorities/task-tracker/graph.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../authorities/task-tracker/target.js"
import type { OperationId } from "../workflow/identity.js"
import type { WorkflowOperation } from "../workflow/registry/operation.js"
import { continuationReadNamesExactPlan } from "../workflow/protocols/planned-attempt-continuation/plan-correlation.js"
import type { CompleteTaskTrackerFactsObserved } from "../workflow/task-tracker-facts/observation.js"
import { projectCompleteTaskGraph } from "../workflow/task-tracker-facts/graph-projection.js"
import { reconfirmationMatchesPriorFullObservation } from "../workflow/task-tracker-facts/reconfirmation.js"
import type { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"
import {
  appendJournalRecord,
  emptyJournalRecords,
  inspectJournalRecordStorage,
  journalRecordAt,
  type JournalRecordSequence
} from "./record-sequence.js"

const GraphEvidenceTypeId: unique symbol = Symbol("GraphEvidence")
const finalOffset = -1
const searchPartitions = 2

/** Chronological complete/unchanged graph observations and their derived selector inputs; never tracker authority. */
export interface GraphEvidence {
  readonly [GraphEvidenceTypeId]: true
}

interface CompleteGraphEvidence {
  readonly observation: CompleteTaskTrackerFactsObserved
  readonly position: JournalPosition
  readonly snapshot: Option.Option<TaskDagSnapshot>
}
interface GraphEvidenceRoots {
  readonly blockerClear: BlockerClearEvidence
  readonly observations: JournalRecordSequence
  readonly byTarget: HashMap.HashMap<string, JournalRecordSequence>
  readonly byPlan: HashMap.HashMap<string, JournalRecordSequence>
  readonly byTargetPlan: HashMap.HashMap<string, JournalRecordSequence>
  readonly completeByOperation: HashMap.HashMap<OperationId, CompleteGraphEvidence>
  readonly snapshots: HashMap.HashMap<JournalPosition, Option.Option<TaskDagSnapshot>>
}
const rootsByEvidence = new WeakMap<GraphEvidence, GraphEvidenceRoots>()
const rootsOf = (evidence: GraphEvidence): GraphEvidenceRoots =>
  Option.getOrThrow(Option.fromUndefinedOr(rootsByEvidence.get(evidence)))
const retain = (roots: GraphEvidenceRoots): GraphEvidence => {
  const evidence: GraphEvidence = { [GraphEvidenceTypeId]: true }
  rootsByEvidence.set(evidence, roots)
  return evidence
}
export const emptyGraphEvidence = (): GraphEvidence =>
  retain({
    blockerClear: emptyBlockerClearEvidence(),
    observations: emptyJournalRecords(),
    byTarget: HashMap.empty(),
    byPlan: HashMap.empty(),
    byTargetPlan: HashMap.empty(),
    completeByOperation: HashMap.empty(),
    snapshots: HashMap.empty()
  })

const planKey = (plan: PlannedTaskAttempt): string =>
  JSON.stringify([
    plan.runId,
    plan.attemptId,
    plan.taskId,
    plan.taskRevision,
    plan.baseSha,
    plan.branch,
    plan.worktree,
    plan.executor
  ])
const targetPlanKey = (target: TrackerTarget, plan: PlannedTaskAttempt): string =>
  JSON.stringify([taskTrackerTargetKey(target), planKey(plan)])
const appendBucket = (map: HashMap.HashMap<string, JournalRecordSequence>, key: string, record: JournalRecord) =>
  HashMap.set(map, key, appendJournalRecord(Option.getOrElse(HashMap.get(map, key), emptyJournalRecords), record))

/** Exact named-plan correlations at this observation, without retaining the lookup callback or consulting future operations. */
const correlatedPlans = (
  operationId: OperationId,
  lookup: (id: OperationId) => WorkflowOperation | undefined
): ReadonlyArray<PlannedTaskAttempt> => {
  const operation = lookup(operationId)
  if (operation?._tag !== "ReadTrackerGraph") return []
  const namedPlans = operation.predecessorOperationIds.flatMap((id) => {
    const predecessor = lookup(id)
    return predecessor?._tag === "RecordTaskAttemptPlan" ? [predecessor] : []
  })
  const unique = new Map<string, PlannedTaskAttempt>()
  for (const plan of namedPlans) {
    if (
      operation.readShape.explicitlyCoveredTaskIds.includes(plan.plannedAttempt.taskId) &&
      continuationReadNamesExactPlan(operation, namedPlans, plan.plannedAttempt)
    )
      unique.set(planKey(plan.plannedAttempt), plan.plannedAttempt)
  }
  return [...unique.values()]
}

/** Shares persistent observation indexes; only a new complete payload is projected, exact reconfirmations reuse its snapshot. */
export const appendGraphEvidence = (
  evidence: GraphEvidence,
  record: JournalRecord,
  operationById: (id: OperationId) => WorkflowOperation | undefined
): GraphEvidence => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return evidence
  const observation = record.event.observation
  if (observation._tag !== "CompleteTaskTrackerFacts" && observation._tag !== "UnchangedTaskTrackerFactsReconfirmed")
    return evidence
  const roots = rootsOf(evidence)
  let completeByOperation = roots.completeByOperation
  let snapshot: Option.Option<TaskDagSnapshot>
  if (observation._tag === "CompleteTaskTrackerFacts") {
    snapshot = projectCompleteTaskGraph(observation)
    if (!HashMap.has(completeByOperation, observation.operationId))
      completeByOperation = HashMap.set(completeByOperation, observation.operationId, {
        observation,
        position: record.position,
        snapshot
      })
  } else {
    const prior = Option.getOrUndefined(HashMap.get(completeByOperation, observation.priorFullObservationOperationId))
    snapshot =
      prior !== undefined &&
      prior.position < record.position &&
      reconfirmationMatchesPriorFullObservation(observation, prior.observation)
        ? prior.snapshot
        : Option.none()
  }
  let byPlan = roots.byPlan
  let byTargetPlan = roots.byTargetPlan
  for (const plan of correlatedPlans(record.event.operationId, operationById)) {
    byPlan = appendBucket(byPlan, planKey(plan), record)
    byTargetPlan = appendBucket(byTargetPlan, targetPlanKey(observation.target, plan), record)
  }
  return retain({
    blockerClear: appendBlockerClearEvidence(roots.blockerClear, observation.target, record.position, snapshot),
    observations: appendJournalRecord(roots.observations, record),
    byTarget: appendBucket(roots.byTarget, taskTrackerTargetKey(observation.target), record),
    byPlan,
    byTargetPlan,
    completeByOperation,
    snapshots: HashMap.set(roots.snapshots, record.position, snapshot)
  })
}

const lastVisible = (records: JournalRecordSequence, throughPosition: number): JournalRecord | undefined => {
  const latest = journalRecordAt(records, finalOffset)
  if (latest === undefined || latest.position <= throughPosition) return latest
  let low = 0
  let high = records.length
  while (low < high) {
    const middle = Math.floor((low + high) / searchPartitions)
    const record = journalRecordAt(records, middle)
    if (record !== undefined && record.position <= throughPosition) low = middle + 1
    else high = middle
  }
  return low === 0 ? undefined : journalRecordAt(records, low - 1)
}

/** Latest graph observation through an exact cutoff, optionally bound to its tracker target and named immutable plan. */
export const lastGraphObservationAt = (
  evidence: GraphEvidence,
  query: {
    readonly throughPosition: number
    readonly target?: TrackerTarget
    readonly plannedAttempt?: PlannedTaskAttempt
  }
): JournalRecord | undefined => {
  const roots = rootsOf(evidence)
  const { target, plannedAttempt } = query
  const records =
    plannedAttempt === undefined
      ? target === undefined
        ? roots.observations
        : Option.getOrElse(HashMap.get(roots.byTarget, taskTrackerTargetKey(target)), emptyJournalRecords)
      : target === undefined
        ? Option.getOrElse(HashMap.get(roots.byPlan, planKey(plannedAttempt)), emptyJournalRecords)
        : Option.getOrElse(HashMap.get(roots.byTargetPlan, targetPlanKey(target, plannedAttempt)), emptyJournalRecords)
  return lastVisible(records, query.throughPosition)
}

/** Derived graph for this exact observation; an unresolved reconfirmation stays unresolved even if a full payload appears later. */
export const graphSnapshotForObservation = (
  evidence: GraphEvidence,
  position: JournalPosition,
  throughPosition: number
): Option.Option<TaskDagSnapshot> =>
  position > throughPosition
    ? Option.none()
    : Option.getOrElse(HashMap.get(rootsOf(evidence).snapshots, position), () => Option.none())

/** Blocker/clear chronology is derived from the selected graph snapshots, not from tracker authority outside the journal. */
export const graphBlockerClearEpisodeAt = (
  evidence: GraphEvidence,
  query: {
    readonly target: TrackerTarget
    readonly taskId: TaskId
    readonly afterPosition: number
    readonly throughPosition: number
  }
) => blockerClearEpisodeAt(rootsOf(evidence).blockerClear, query)

/** Test-only complete retained roots, including every ordered sequence and shared projected snapshot. */
export const inspectGraphEvidenceStorage = (evidence: GraphEvidence): ReadonlyArray<object> => {
  const roots = rootsOf(evidence)
  return [
    roots,
    ...inspectBlockerClearEvidenceStorage(roots.blockerClear),
    inspectJournalRecordStorage(roots.observations),
    ...[roots.byTarget, roots.byPlan, roots.byTargetPlan].flatMap((map) =>
      Array.from(map, ([, records]) => inspectJournalRecordStorage(records))
    )
  ]
}
