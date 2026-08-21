/* eslint-disable functional/immutable-data, max-lines -- Prefix validation and relationship indexes are private read-side scratch. */
import { Context, Deferred, Effect, Layer, Option, Schema } from "effect"
import { IntegrationTarget, TaskId, RunId } from "@dalph/contracts"
import { TaskDagWire } from "../authorities/task-tracker/graph.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../authorities/task-tracker/target.js"
import { JournalPosition } from "../workflow-journal/identity.js"
import {
  JournalReadSource,
  journalReadSourceLayer,
  type JournalReadSourceService
} from "../workflow-journal/read-source.js"
import type { JournalRecord, JournalStoreError } from "../workflow-journal/store.js"
import { OperationId } from "../workflow/identity.js"
import { WorkflowRunBeganEvent, type WorkflowJournalEvent } from "../workflow/registry/event.js"
import { workflowOperationId, type WorkflowOperation } from "../workflow/registry/operation.js"
import {
  projectWorkflowOccurrences,
  WorkflowOccurrence,
  type WorkflowOccurrence as WorkflowOccurrenceValue
} from "../workflow/registry/occurrence-projection.js"
import type {
  CompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservation,
  UnchangedTaskTrackerFactsReconfirmed
} from "../workflow/task-tracker-facts/observation.js"
import { reconstructedTaskGraphFor } from "../coordination/reconstruction/graph-knowledge.js"
import type { CurrentSignal } from "../coordination/delivery/relations.js"

/** Version of the immutable production trace contract consumed by presentation. */
export const traceReaderSchemaVersion = 1 as const

/**
 * Identifies one exact committed journal position in one Run. Cursors and
 * projected occurrence identities intentionally use this same schema so a
 * presentation value cannot silently substitute a view-local position.
 */
export const TracePositionIdentity = Schema.Struct({ runId: RunId, position: JournalPosition }).pipe(
  Schema.brand("TracePositionIdentity")
)
export type TracePositionIdentity = typeof TracePositionIdentity.Type

/** A fixed historical boundary in the committed Run prefix. */
export const TraceCursor = TracePositionIdentity
export type TraceCursor = TracePositionIdentity

/** Identity retained for every projected workflow occurrence. */
export const TraceItemIdentity = TracePositionIdentity
export type TraceItemIdentity = TracePositionIdentity

/** One task-graph relationship. Prerequisites and grouping are never merged. */
export const TraceTaskGraphEdge = Schema.TaggedUnion({
  Grouping: { childTaskId: TaskId, parentTaskId: TaskId },
  Prerequisite: { dependantTaskId: TaskId, prerequisiteTaskId: TaskId }
})
export type TraceTaskGraphEdge = typeof TraceTaskGraphEdge.Type

/** One explicit workflow OperationId predecessor relationship. */
export const TraceWorkflowCausalEdge = Schema.Struct({
  predecessorOperationId: OperationId,
  successorOperationId: OperationId
})
export type TraceWorkflowCausalEdge = typeof TraceWorkflowCausalEdge.Type

/** One read result acknowledged by the outside authority it queried. */
export const TraceOutsideAuthorityAcknowledgement = Schema.Struct({
  actionOperationId: OperationId,
  action: TraceItemIdentity,
  observation: TraceItemIdentity
})
export type TraceOutsideAuthorityAcknowledgement = typeof TraceOutsideAuthorityAcknowledgement.Type

/** One process-local resource relationship retained separately from workflow causality. */
export const TraceProcessLocalResourceSerialization = Schema.Struct({
  later: TraceItemIdentity,
  earlier: TraceItemIdentity,
  target: IntegrationTarget
})
export type TraceProcessLocalResourceSerialization = typeof TraceProcessLocalResourceSerialization.Type

/** Relationships are grouped by their distinct meaning for presentation consumers. */
export const TraceRelationships = Schema.Struct({
  outsideAuthorityAcknowledgements: Schema.Array(TraceOutsideAuthorityAcknowledgement),
  processLocalResourceSerializations: Schema.Array(TraceProcessLocalResourceSerialization),
  taskGraphEdges: Schema.Array(TraceTaskGraphEdge),
  workflowCausalEdges: Schema.Array(TraceWorkflowCausalEdge)
})
export type TraceRelationships = typeof TraceRelationships.Type

/** Deterministic task order is derived display data and never changes recorded order. */
export const TraceDerivedTaskOrder = Schema.TaggedStruct("DerivedTaskOrder", {
  basis: Schema.Literal("TaskIdCodeUnitAscending"),
  taskIds: Schema.Array(TaskId)
})
export type TraceDerivedTaskOrder = typeof TraceDerivedTaskOrder.Type

/** Graph reconstructed from the latest complete tracker observation at a cursor. */
export const TraceTaskGraph = Schema.Struct({
  edges: Schema.Array(TraceTaskGraphEdge),
  observation: Schema.Struct({ operationId: OperationId, recordedAt: JournalPosition }),
  snapshot: TaskDagWire
})
export type TraceTaskGraph = typeof TraceTaskGraph.Type

const occurrenceRunId = (occurrence: WorkflowOccurrenceValue): RunId =>
  occurrence._tag === "AppliedControlDirection"
    ? occurrence.subject.runId
    : occurrence._tag === "AppliedAttemptChoice"
      ? occurrence.subject.plannedAttempt.runId
      : occurrence.runId

const traceHistoryItemInvariant = (item: {
  readonly identity: TraceItemIdentity
  readonly occurrence: WorkflowOccurrenceValue
}): string | undefined =>
  item.identity.runId === occurrenceRunId(item.occurrence) && item.identity.position === item.occurrence.recordedAt
    ? undefined
    : "A history item identity must equal its occurrence Run and recorded journal position"

/** One occurrence with its durable identity and only identities Dalph can prove. */
export const TraceHistoryItem = Schema.Struct({
  identity: TraceItemIdentity,
  occurrence: WorkflowOccurrence,
  operationIds: Schema.Array(OperationId).check(Schema.isUnique()),
  taskIds: Schema.Array(TaskId).check(Schema.isUnique())
}).check(Schema.makeFilter(traceHistoryItemInvariant))
export type TraceHistoryItem = typeof TraceHistoryItem.Type

const identityOutsideCursor = (identity: TracePositionIdentity, cursor: TraceCursor): boolean =>
  identity.runId !== cursor.runId || identity.position > cursor.position

const traceItemIssue = (item: TraceHistoryItem, runId: RunId, through: JournalPosition): string | undefined => {
  if (item.identity.runId !== runId) return "Every history item must belong to the history Run"
  if (item.identity.position > through) return "Every history item must be at or before the committed prefix"
  return traceHistoryItemInvariant(item)
}

const traceItemsAreStrictlyIncreasing = (items: ReadonlyArray<TraceHistoryItem>): boolean => {
  let previous: JournalPosition | undefined
  for (const item of items) {
    if (previous !== undefined && item.identity.position <= previous) return false
    previous = item.identity.position
  }
  return true
}

const traceItemsIssue = (
  items: ReadonlyArray<TraceHistoryItem>,
  runId: RunId,
  through: JournalPosition
): string | undefined => {
  const invalidItem = items.find((item) => traceItemIssue(item, runId, through) !== undefined)
  if (invalidItem !== undefined) return traceItemIssue(invalidItem, runId, through)
  return traceItemsAreStrictlyIncreasing(items) ? undefined : "Trace items must have distinct increasing positions"
}

const traceHistoryInvariant = (history: {
  readonly committedThrough: JournalPosition
  readonly items: ReadonlyArray<TraceHistoryItem>
  readonly runId: RunId
}): string | undefined => traceItemsIssue(history.items, history.runId, history.committedThrough)

/** The schema-versioned complete committed history used for replay and redelivery. */
export const TraceHistory = Schema.Struct({
  committedThrough: JournalPosition,
  items: Schema.Array(TraceHistoryItem),
  runId: RunId,
  version: Schema.Literal(traceReaderSchemaVersion)
}).check(Schema.makeFilter(traceHistoryInvariant))
export type TraceHistory = typeof TraceHistory.Type

const traceGraphObservationIssue = (
  graph: TraceTaskGraph | null,
  cursor: TraceCursor,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  if (graph === null) return undefined
  if (graph.observation.recordedAt > cursor.position) {
    return "The graph observation must be recorded at or before the cursor position"
  }
  const item = items.find(
    ({ identity }) => identity.runId === cursor.runId && identity.position === graph.observation.recordedAt
  )
  if (item === undefined) return "The graph observation must identify an item in the cursor prefix"
  return item.operationIds.includes(graph.observation.operationId)
    ? undefined
    : "The graph observation operation must identify its cursor-prefix item"
}

const graphEdgesOf = (snapshot: TaskDagWire): ReadonlyArray<TraceTaskGraphEdge> =>
  snapshot.tasks.flatMap((task) => [
    ...task.prerequisiteIds.map((prerequisiteTaskId) =>
      TraceTaskGraphEdge.cases.Prerequisite.make({ dependantTaskId: task.id, prerequisiteTaskId })
    ),
    ...(task.parentTaskId === null
      ? []
      : [TraceTaskGraphEdge.cases.Grouping.make({ childTaskId: task.id, parentTaskId: task.parentTaskId })])
  ])

const traceTaskGraphEdgeEqual = (actual: TraceTaskGraphEdge, expected: TraceTaskGraphEdge): boolean =>
  JSON.stringify(actual) === JSON.stringify(expected)

const traceTaskGraphEdgesEqual = (
  actual: ReadonlyArray<TraceTaskGraphEdge>,
  expected: ReadonlyArray<TraceTaskGraphEdge>
): boolean =>
  actual.length === expected.length &&
  actual.every((edge, index) => {
    const expectedEdge = expected[index]
    return expectedEdge !== undefined && traceTaskGraphEdgeEqual(edge, expectedEdge)
  })

const traceGraphEdgesIssue = (graph: TraceTaskGraph | null): string | undefined => {
  if (graph === null) return undefined
  return traceTaskGraphEdgesEqual(graph.edges, graphEdgesOf(graph.snapshot))
    ? undefined
    : "Graph edges must exactly match the prerequisite and grouping edges of its snapshot"
}

const traceTaskGraphRelationshipIssue = (
  graph: TraceTaskGraph | null,
  taskGraphEdges: ReadonlyArray<TraceTaskGraphEdge>
): string | undefined =>
  traceTaskGraphEdgesEqual(taskGraphEdges, graph?.edges ?? [])
    ? undefined
    : "Task-graph relationships must exactly match the graph edges or be empty without a graph"

const sortedTaskIds = (taskIds: ReadonlyArray<TaskId>): ReadonlyArray<TaskId> => [...taskIds].sort()

const valuesEqual = <A>(actual: ReadonlyArray<A>, expected: ReadonlyArray<A>): boolean =>
  actual.length === expected.length && actual.every((value, index) => value === expected[index])

const traceDerivedTaskOrderIssue = (
  derivedTaskOrder: TraceDerivedTaskOrder,
  graph: TraceTaskGraph | null
): string | undefined => {
  const expectedTaskIds = graph === null ? [] : sortedTaskIds(graph.snapshot.tasks.map(({ id }) => id))
  return valuesEqual(derivedTaskOrder.taskIds, expectedTaskIds)
    ? undefined
    : "Derived task order must exactly match the sorted graph snapshot task IDs"
}

const historyItemAt = (
  items: ReadonlyArray<TraceHistoryItem>,
  identity: TraceItemIdentity
): TraceHistoryItem | undefined =>
  items.find(
    ({ identity: itemIdentity }) => itemIdentity.runId === identity.runId && itemIdentity.position === identity.position
  )

const traceProcessSerializationIssue = (
  serialization: TraceProcessLocalResourceSerialization,
  cursor: TraceCursor,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  if (identityOutsideCursor(serialization.earlier, cursor) || identityOutsideCursor(serialization.later, cursor)) {
    return "Every process-local relationship identity must belong to the cursor prefix"
  }
  if (
    historyItemAt(items, serialization.earlier) === undefined ||
    historyItemAt(items, serialization.later) === undefined
  ) {
    return "Every process-local relationship identity must resolve to a history item"
  }
  return serialization.earlier.position < serialization.later.position
    ? undefined
    : "A process-local serialization must point from an earlier item to a later item"
}

const traceAcknowledgementIssue = (
  acknowledgement: TraceOutsideAuthorityAcknowledgement,
  cursor: TraceCursor,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  if (
    identityOutsideCursor(acknowledgement.action, cursor) ||
    identityOutsideCursor(acknowledgement.observation, cursor)
  ) {
    return "Every outside-authority relationship identity must belong to the cursor prefix"
  }
  const action = historyItemAt(items, acknowledgement.action)
  const observation = historyItemAt(items, acknowledgement.observation)
  if (action === undefined || observation === undefined) {
    return "Every outside-authority relationship identity must resolve to a history item"
  }
  return action.operationIds.includes(acknowledgement.actionOperationId)
    ? undefined
    : "An outside-authority acknowledgement operation must belong to its action item"
}

const traceRelationshipIssue = (view: {
  readonly cursor: TraceCursor
  readonly items: ReadonlyArray<TraceHistoryItem>
  readonly relationships: TraceRelationships
}): string | undefined => {
  const invalidAcknowledgement = view.relationships.outsideAuthorityAcknowledgements.find(
    (acknowledgement) => traceAcknowledgementIssue(acknowledgement, view.cursor, view.items) !== undefined
  )
  if (invalidAcknowledgement !== undefined) {
    return traceAcknowledgementIssue(invalidAcknowledgement, view.cursor, view.items)
  }
  const invalidSerialization = view.relationships.processLocalResourceSerializations.find(
    (serialization) => traceProcessSerializationIssue(serialization, view.cursor, view.items) !== undefined
  )
  if (invalidSerialization !== undefined) {
    return traceProcessSerializationIssue(invalidSerialization, view.cursor, view.items)
  }
  return undefined
}

const traceAtCursorInvariant = (view: {
  readonly cursor: TraceCursor
  readonly derivedTaskOrder: TraceDerivedTaskOrder
  readonly graph: TraceTaskGraph | null
  readonly items: ReadonlyArray<TraceHistoryItem>
  readonly relationships: TraceRelationships
}): string | undefined =>
  traceItemsIssue(view.items, view.cursor.runId, view.cursor.position) ??
  traceGraphObservationIssue(view.graph, view.cursor, view.items) ??
  traceGraphEdgesIssue(view.graph) ??
  traceDerivedTaskOrderIssue(view.derivedTaskOrder, view.graph) ??
  traceTaskGraphRelationshipIssue(view.graph, view.relationships.taskGraphEdges) ??
  traceRelationshipIssue(view)

/** A fixed historical cursor view. Current status is intentionally not stored here. */
export const TraceAtCursor = Schema.Struct({
  cursor: TraceCursor,
  derivedTaskOrder: TraceDerivedTaskOrder,
  graph: Schema.NullOr(TraceTaskGraph),
  items: Schema.Array(TraceHistoryItem),
  relationships: TraceRelationships,
  version: Schema.Literal(traceReaderSchemaVersion)
}).check(Schema.makeFilter(traceAtCursorInvariant))
export type TraceAtCursor = typeof TraceAtCursor.Type

/** Prefix validation reports concrete storage facts instead of silently dropping history. */
export const TracePrefixIssue = Schema.TaggedUnion({
  FirstRecordNotRunBeginning: { position: JournalPosition },
  PositionGap: { actualPosition: JournalPosition, expectedPosition: JournalPosition },
  RunMismatch: { actualRunId: RunId, expectedRunId: RunId, position: JournalPosition }
})
export type TracePrefixIssue = typeof TracePrefixIssue.Type

/** The committed records cannot form one coherent Run prefix for presentation. */
export class TraceJournalPrefixInvalid extends Schema.TaggedError<TraceJournalPrefixInvalid>()(
  "TraceJournalPrefixInvalid",
  { issues: Schema.Array(TracePrefixIssue), runId: RunId }
) {}

/** The requested Run has no committed beginning and is not a trace. */
export class TraceRunNotFound extends Schema.TaggedError<TraceRunNotFound>()("TraceRunNotFound", { runId: RunId }) {}

/** A cursor must name one position committed in the requested Run. */
export class TraceCursorNotCommitted extends Schema.TaggedError<TraceCursorNotCommitted>()("TraceCursorNotCommitted", {
  cursor: TraceCursor
}) {}

/** The journal occurrence projection failed closed instead of returning a partial trace. */
export class TraceProjectionInvalid extends Schema.TaggedError<TraceProjectionInvalid>()("TraceProjectionInvalid", {
  detail: Schema.String,
  runId: RunId
}) {}

/** One explicit predecessor OperationId is absent from the validated prefix. */
export class TraceCausalPredecessorMissing extends Schema.TaggedError<TraceCausalPredecessorMissing>()(
  "TraceCausalPredecessorMissing",
  { predecessorOperationId: OperationId, runId: RunId, successorOperationId: OperationId }
) {}

/** One predecessor relationship is contradictory: duplicate identity or non-earlier position. */
export class TraceCausalPredecessorContradiction extends Schema.TaggedError<TraceCausalPredecessorContradiction>()(
  "TraceCausalPredecessorContradiction",
  {
    predecessorOperationId: OperationId,
    reason: Schema.Literals(["DuplicateOperation", "NotEarlier"]),
    runId: RunId,
    successorOperationId: OperationId
  }
) {}

/** The operation exists but no semantic occurrence was projected for presentation. */
export class TraceCausalPredecessorNotProjected extends Schema.TaggedError<TraceCausalPredecessorNotProjected>()(
  "TraceCausalPredecessorNotProjected",
  { predecessorOperationId: OperationId, runId: RunId, successorOperationId: OperationId }
) {}

export type TraceReaderError =
  | TraceCausalPredecessorContradiction
  | TraceCausalPredecessorMissing
  | TraceCausalPredecessorNotProjected
  | TraceCursorNotCommitted
  | TraceJournalPrefixInvalid
  | TraceProjectionInvalid
  | TraceRunNotFound

/** Read-only journal capability required by the production trace reader. */
export type TraceJournalReadSource = JournalReadSourceService

/** Read-only trace service; it exposes projection reads only. */
export interface TraceReaderService {
  readonly causalPredecessor: (
    cursor: TraceCursor,
    successorOperationId: OperationId,
    predecessorOperationId: OperationId
  ) => Effect.Effect<TraceHistoryItem, TraceReaderError | JournalStoreError>
  readonly read: (runId: RunId) => Effect.Effect<TraceHistory, TraceReaderError | JournalStoreError>
  readonly readAt: (cursor: TraceCursor) => Effect.Effect<TraceAtCursor, TraceReaderError | JournalStoreError>
}

/** Production trace reader service installed over the committed journal read seam. */
export class TraceReader extends Context.Service<TraceReader, TraceReaderService>()("@dalph/TraceReader") {}

const itemIdentity = (runId: RunId, position: JournalPosition): TraceItemIdentity =>
  TracePositionIdentity.make({ runId, position })

const sortedUniqueTaskIds = (taskIds: ReadonlyArray<TaskId>): ReadonlyArray<TaskId> => [...new Set(taskIds)].sort()

const operationOfEvent = (event: WorkflowJournalEvent): WorkflowOperation | undefined => {
  if (
    event._tag === "TaskTrackerReadIntentRecorded" ||
    event._tag === "TaskClaimAcquisitionIntended" ||
    event._tag === "TaskClaimReleaseIntended" ||
    event._tag === "TaskAttemptPlanned" ||
    event._tag === "TaskWorktreeReconciliationIntended" ||
    event._tag === "GitReadIntentRecorded"
  ) {
    return event.operation
  }
  return event._tag === "PlannedAttemptReplaced" ? event.successorPlan : undefined
}

const operationIdsOfOccurrence = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<OperationId> => {
  if (occurrence._tag === "TaskTrackerReadInitiated" || occurrence._tag === "GitReadInitiated") {
    return [workflowOperationId(occurrence.operation)]
  }
  if (
    occurrence._tag === "TaskTrackerFactsObserved" ||
    occurrence._tag === "PlannedAttemptWorktreeObserved" ||
    occurrence._tag === "TargetLineageObserved" ||
    occurrence._tag === "AttemptRestartAuthorityReadFailed"
  ) {
    return [occurrence.originatingActionOperationId]
  }
  return occurrence._tag === "PlannedAttemptReplaced" ? [workflowOperationId(occurrence.successorPlan)] : []
}

const taskIdsOfObservation = (observation: TaskTrackerFactsObservation): ReadonlyArray<TaskId> => {
  switch (observation._tag) {
    case "CompleteTaskTrackerFacts":
      return observation.factFamilies[0].taskIds
    case "UnchangedTaskTrackerFactsReconfirmed":
      return observation.factFamilies[1].subjectTaskIds
    case "FocusedTaskWorkSpecificationFacts":
      return [observation.factFamily.taskId]
    case "FocusedTaskClaimFacts":
    case "FocusedTaskClaimFactsUnreadable":
      return [observation.coverage.taskId]
    case "FocusedTaskCompletionFacts":
      return [observation.facts.taskId]
    case "TaskTrackerFactsReadFailed":
      return []
  }
}

const taskIdsOfObservationOccurrence = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined =>
  occurrence._tag === "TaskTrackerFactsObserved" ? taskIdsOfObservation(occurrence.evidence) : undefined

const taskIdsOfDirectPlannedAttemptOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<TaskId> | undefined =>
  "plannedAttempt" in occurrence ? [occurrence.plannedAttempt.taskId] : undefined

const taskIdsOfSubjectPlannedAttemptOccurrence = (
  occurrence: WorkflowOccurrenceValue
): ReadonlyArray<TaskId> | undefined =>
  occurrence._tag === "AppliedAttemptChoice" ||
  occurrence._tag === "PlannedAttemptReplaced" ||
  occurrence._tag === "AttemptRestartAuthorityReadFailed"
    ? [occurrence.subject.plannedAttempt.taskId]
    : undefined

const taskIdsOfWorktreeObservation = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined =>
  occurrence._tag === "PlannedAttemptWorktreeObserved"
    ? occurrence.observation._tag === "AttemptWorktreeLost"
      ? [occurrence.observation.plannedAttempt.taskId]
      : []
    : undefined

const taskIdsOfControlOccurrence = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined => {
  if (occurrence._tag === "AppliedControlDirection") {
    return occurrence.subject._tag === "Task" ? [occurrence.subject.taskId] : []
  }
  return occurrence._tag === "AppliedTaskClaimReacquisitionDirection" ? [occurrence.taskId] : undefined
}

const taskIdsOfOccurrence = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> =>
  [
    taskIdsOfObservationOccurrence(occurrence),
    taskIdsOfDirectPlannedAttemptOccurrence(occurrence),
    taskIdsOfSubjectPlannedAttemptOccurrence(occurrence),
    taskIdsOfWorktreeObservation(occurrence),
    taskIdsOfControlOccurrence(occurrence)
  ].find((taskIds): taskIds is ReadonlyArray<TaskId> => taskIds !== undefined) ?? []

const itemFromOccurrence = (runId: RunId, occurrence: WorkflowOccurrenceValue): TraceHistoryItem =>
  TraceHistoryItem.make({
    identity: itemIdentity(runId, occurrence.recordedAt),
    occurrence,
    operationIds: operationIdsOfOccurrence(occurrence),
    taskIds: sortedUniqueTaskIds(taskIdsOfOccurrence(occurrence))
  })

const prefixIssues = (runId: RunId, records: ReadonlyArray<JournalRecord>): ReadonlyArray<TracePrefixIssue> => {
  const issues: Array<TracePrefixIssue> = []
  for (const [index, record] of records.entries()) {
    const expectedPosition = JournalPosition.make(index + 1)
    if (record.runId !== runId) {
      issues.push(
        TracePrefixIssue.cases.RunMismatch.make({
          actualRunId: record.runId,
          expectedRunId: runId,
          position: record.position
        })
      )
    }
    if (record.position !== expectedPosition) {
      issues.push(TracePrefixIssue.cases.PositionGap.make({ actualPosition: record.position, expectedPosition }))
    }
    if (index === 0 && record.event._tag !== "WorkflowRunBegan") {
      issues.push(TracePrefixIssue.cases.FirstRecordNotRunBeginning.make({ position: record.position }))
    }
  }
  return issues
}

const validateRecords = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): Effect.Effect<ReadonlyArray<JournalRecord>, TraceJournalPrefixInvalid | TraceRunNotFound> => {
  if (records.length === 0) return Effect.fail(new TraceRunNotFound({ runId }))
  const issues = prefixIssues(runId, records)
  return issues.length === 0 ? Effect.succeed(records) : Effect.fail(new TraceJournalPrefixInvalid({ issues, runId }))
}

type IndexedOperation = { readonly operation: WorkflowOperation; readonly position: JournalPosition }

const operationIndexOf = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): Effect.Effect<ReadonlyMap<OperationId, IndexedOperation>, TraceReaderError> => {
  const index = new Map<OperationId, IndexedOperation>()
  for (const record of records) {
    const operation = operationOfEvent(record.event)
    if (operation === undefined) continue
    const operationId = workflowOperationId(operation)
    if (index.has(operationId)) {
      return Effect.fail(
        new TraceCausalPredecessorContradiction({
          predecessorOperationId: operationId,
          reason: "DuplicateOperation",
          runId,
          successorOperationId: operationId
        })
      )
    }
    index.set(operationId, { operation, position: record.position })
  }
  for (const { operation, position } of index.values()) {
    const successorOperationId = workflowOperationId(operation)
    for (const predecessorOperationId of operation.predecessorOperationIds) {
      const predecessor = index.get(predecessorOperationId)
      if (predecessor === undefined) {
        return Effect.fail(new TraceCausalPredecessorMissing({ predecessorOperationId, runId, successorOperationId }))
      }
      if (predecessor.position >= position) {
        return Effect.fail(
          new TraceCausalPredecessorContradiction({
            predecessorOperationId,
            reason: "NotEarlier",
            runId,
            successorOperationId
          })
        )
      }
    }
  }
  return Effect.succeed(index)
}

type CompleteGraphObservation = CompleteTaskTrackerFactsObserved | UnchangedTaskTrackerFactsReconfirmed

type CompleteGraphObservationAt = { readonly observation: CompleteGraphObservation; readonly position: JournalPosition }

const completeGraphObservationAt = (
  record: JournalRecord,
  target: TrackerTarget
): CompleteGraphObservationAt | undefined => {
  const event = record.event
  if (event._tag !== "TaskTrackerFactsObserved") return undefined
  if (
    event.observation._tag !== "CompleteTaskTrackerFacts" &&
    event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed"
  ) {
    return undefined
  }
  return taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(target)
    ? { observation: event.observation, position: record.position }
    : undefined
}

const completeGraphObservationsFor = (
  records: ReadonlyArray<JournalRecord>,
  target: TrackerTarget
): ReadonlyArray<CompleteGraphObservationAt> =>
  records.flatMap((record) => {
    const observation = completeGraphObservationAt(record, target)
    return observation === undefined ? [] : [observation]
  })

const graphObservation = (
  records: ReadonlyArray<JournalRecord>,
  target: TrackerTarget
): CompleteGraphObservationAt | undefined => {
  const observations = completeGraphObservationsFor(records, target)
  return observations.length === 0 ? undefined : observations.reduce((_, observation) => observation)
}

const taskGraphAt = (records: ReadonlyArray<JournalRecord>, target: TrackerTarget): TraceTaskGraph | null => {
  const latest = graphObservation(records, target)
  if (latest === undefined) return null
  const knowledge = {
    taskTrackerFacts: completeGraphObservationsFor(records, target).map(({ observation }) => observation)
  }
  const snapshot = reconstructedTaskGraphFor(knowledge, target)
  if (snapshot._tag === "None") return null
  const wire = snapshot.value.toWire()
  return TraceTaskGraph.make({
    edges: graphEdgesOf(wire),
    observation: { operationId: latest.observation.operationId, recordedAt: latest.position },
    snapshot: wire
  })
}

const occurrenceItemAt = (
  items: ReadonlyArray<TraceHistoryItem>,
  position: JournalPosition
): TraceHistoryItem | undefined => items.find(({ identity }) => identity.position === position)

const operationItem = (
  items: ReadonlyArray<TraceHistoryItem>,
  operationId: OperationId
): TraceHistoryItem | undefined => items.find((item) => item.operationIds.includes(operationId))

const workflowCausalEdgesOf = (
  operationIndex: ReadonlyMap<OperationId, IndexedOperation>
): ReadonlyArray<TraceWorkflowCausalEdge> => {
  const edges: Array<TraceWorkflowCausalEdge> = []
  for (const { operation } of operationIndex.values()) {
    const successorOperationId = workflowOperationId(operation)
    for (const predecessorOperationId of operation.predecessorOperationIds) {
      edges.push({ predecessorOperationId, successorOperationId })
    }
  }
  return edges
}

type IndexedWorkflowCausalEdge = { readonly edge: TraceWorkflowCausalEdge; readonly successorPosition: JournalPosition }

const indexedWorkflowCausalEdgesOf = (
  operationIndex: ReadonlyMap<OperationId, IndexedOperation>
): ReadonlyArray<IndexedWorkflowCausalEdge> => {
  const edges: Array<IndexedWorkflowCausalEdge> = []
  for (const { operation, position } of operationIndex.values()) {
    const successorOperationId = workflowOperationId(operation)
    for (const predecessorOperationId of operation.predecessorOperationIds) {
      edges.push({ edge: { predecessorOperationId, successorOperationId }, successorPosition: position })
    }
  }
  return edges
}

const outsideAuthorityObservationOperationId = (event: WorkflowJournalEvent): OperationId | undefined => {
  if (
    event._tag === "TaskTrackerFactsObserved" ||
    event._tag === "PlannedAttemptWorktreeObserved" ||
    event._tag === "TargetLineageObserved" ||
    event._tag === "AttemptRestartAuthorityReadFailed"
  ) {
    return event.operationId
  }
  return undefined
}

const outsideAuthorityAcknowledgementAt = (
  record: JournalRecord,
  items: ReadonlyArray<TraceHistoryItem>
): TraceOutsideAuthorityAcknowledgement | undefined => {
  const observationOperationId = outsideAuthorityObservationOperationId(record.event)
  if (observationOperationId === undefined) return undefined
  const action = operationItem(items, observationOperationId)
  const observation = occurrenceItemAt(items, record.position)
  if (action === undefined || observation === undefined) return undefined
  return { action: action.identity, actionOperationId: observationOperationId, observation: observation.identity }
}

const processLocalResourceSerializationAt = (
  record: JournalRecord,
  items: ReadonlyArray<TraceHistoryItem>
): TraceProcessLocalResourceSerialization | undefined => {
  if (record.event._tag !== "IntegrationStarted") return undefined
  const earlier = occurrenceItemAt(items, record.event.responsibilityBeganAt)
  const later = occurrenceItemAt(items, record.position)
  if (earlier === undefined || later === undefined) return undefined
  return { earlier: earlier.identity, later: later.identity, target: record.event.integrationTarget }
}

const singletonOrEmpty = <A>(value: A | undefined): ReadonlyArray<A> => (value === undefined ? [] : [value])

const relationshipsAt = (
  records: ReadonlyArray<JournalRecord>,
  items: ReadonlyArray<TraceHistoryItem>,
  graph: TraceTaskGraph | null,
  operationIndex: ReadonlyMap<OperationId, IndexedOperation>
): TraceRelationships => ({
  outsideAuthorityAcknowledgements: records.flatMap((record) =>
    singletonOrEmpty(outsideAuthorityAcknowledgementAt(record, items))
  ),
  processLocalResourceSerializations: records.flatMap((record) =>
    singletonOrEmpty(processLocalResourceSerializationAt(record, items))
  ),
  taskGraphEdges: graph?.edges ?? [],
  workflowCausalEdges: workflowCausalEdgesOf(operationIndex)
})

const cursorPrefixOf = (
  cursor: TraceCursor,
  records: ReadonlyArray<JournalRecord>
): Effect.Effect<ReadonlyArray<JournalRecord>, TraceCursorNotCommitted> =>
  records.some(({ position }) => position === cursor.position)
    ? Effect.succeed(records.filter(({ position }) => position <= cursor.position))
    : Effect.fail(new TraceCursorNotCommitted({ cursor }))

type WorkflowRunBeginning = Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunBegan" }>

const workflowRunBeginningOf = (
  records: ReadonlyArray<JournalRecord>
): Effect.Effect<WorkflowRunBeginning, TraceJournalPrefixInvalid> =>
  Effect.sync(() => Option.getOrThrow(Schema.decodeUnknownOption(WorkflowRunBeganEvent)(records[0]?.event)))

const historyFromRecords = Effect.fn("TraceReader.historyFromRecords")(function* (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
) {
  yield* validateRecords(runId, records)
  yield* operationIndexOf(runId, records)
  const projection = yield* projectWorkflowOccurrences(records).pipe(
    Effect.mapError((cause) => new TraceProjectionInvalid({ detail: String(cause), runId }))
  )
  const items = projection.occurrences.map((occurrence) => itemFromOccurrence(runId, occurrence))
  const committedThrough = Option.getOrThrow(Option.fromUndefinedOr(records[records.length - 1]?.position))
  return TraceHistory.make({ committedThrough, items, runId, version: traceReaderSchemaVersion })
})

/**
 * A complete immutable journal read can serve every earlier cursor. Keeping
 * the projected items and relationship identities once is important because
 * the authored delivery story asks for one trace view at every position.
 * Prefix views still copy their visible arrays, but do not re-filter,
 * re-validate, or re-project the complete journal from scratch.
 */
type CompleteTraceIndex = {
  readonly committedThrough: JournalPosition
  readonly committedPositions: ReadonlySet<JournalPosition>
  readonly graphObservations: ReadonlyArray<CompleteGraphObservationAt>
  readonly items: ReadonlyArray<TraceHistoryItem>
  readonly operationIndex: ReadonlyMap<OperationId, IndexedOperation>
  readonly outsideAuthorityAcknowledgements: ReadonlyArray<TraceOutsideAuthorityAcknowledgement>
  readonly processLocalResourceSerializations: ReadonlyArray<TraceProcessLocalResourceSerialization>
  readonly workflowCausalEdges: ReadonlyArray<IndexedWorkflowCausalEdge>
  readonly runId: RunId
  readonly target: TrackerTarget
}

const completeTraceIndexFromRecords = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): Effect.Effect<CompleteTraceIndex, TraceReaderError> =>
  Effect.gen(function* () {
    yield* validateRecords(runId, records)
    const operationIndex = yield* operationIndexOf(runId, records)
    const projection = yield* projectWorkflowOccurrences(records).pipe(
      Effect.mapError((cause) => new TraceProjectionInvalid({ detail: String(cause), runId }))
    )
    const items = projection.occurrences.map((occurrence) => itemFromOccurrence(runId, occurrence))
    const beginning = yield* workflowRunBeginningOf(records)
    const target = beginning.target
    const graphObservations = completeGraphObservationsFor(records, target)
    const graph = taskGraphAt(records, target)
    const workflowCausalEdges = indexedWorkflowCausalEdgesOf(operationIndex)
    const relationships = relationshipsAt(records, items, graph, operationIndex)
    const committedThrough = Option.getOrThrow(Option.fromUndefinedOr(records[records.length - 1]?.position))
    yield* Schema.decodeUnknownEffect(TraceAtCursor)({
      cursor: TraceCursor.make({ position: committedThrough, runId }),
      derivedTaskOrder: TraceDerivedTaskOrder.make({
        basis: "TaskIdCodeUnitAscending",
        taskIds: sortedUniqueTaskIds(graph?.snapshot.tasks.map(({ id }) => id) ?? [])
      }),
      graph,
      items,
      relationships,
      version: traceReaderSchemaVersion
    }).pipe(Effect.mapError((cause) => new TraceProjectionInvalid({ detail: String(cause), runId })))
    const committedPositions: ReadonlySet<JournalPosition> = new Set(records.map(({ position }) => position))
    return {
      committedThrough,
      committedPositions,
      graphObservations,
      items,
      operationIndex,
      outsideAuthorityAcknowledgements: relationships.outsideAuthorityAcknowledgements,
      processLocalResourceSerializations: relationships.processLocalResourceSerializations,
      runId,
      target,
      workflowCausalEdges
    } satisfies CompleteTraceIndex
  })

const binarySearchSplitDivisor = 2

const prefixLengthThrough = <A>(
  values: ReadonlyArray<A>,
  positionOf: (value: A) => JournalPosition,
  through: JournalPosition
): number => {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = Math.floor((low + high) / binarySearchSplitDivisor)
    const middleValue = values[middle]
    if (middleValue === undefined) return low
    const position = positionOf(middleValue)
    if (position <= through) low = middle + 1
    else high = middle
  }
  return low
}

const graphAtIndexedPrefix = (
  index: CompleteTraceIndex,
  through: JournalPosition,
  graphByObservationPosition: Map<JournalPosition, TraceTaskGraph | null>
): TraceTaskGraph | null => {
  const latestIndex = prefixLengthThrough(index.graphObservations, ({ position }) => position, through) - 1
  const latest = index.graphObservations[latestIndex]
  if (latest === undefined) return null
  const cached = graphByObservationPosition.get(latest.position)
  if (cached !== undefined) return cached
  const knowledge = {
    taskTrackerFacts: index.graphObservations
      .filter(({ position }) => position <= latest.position)
      .map(({ observation }) => observation)
  }
  const snapshot = reconstructedTaskGraphFor(knowledge, index.target)
  const graph =
    snapshot._tag === "None"
      ? null
      : (() => {
          const wire = snapshot.value.toWire()
          return TraceTaskGraph.make({
            edges: graphEdgesOf(wire),
            observation: { operationId: latest.observation.operationId, recordedAt: latest.position },
            snapshot: wire
          })
        })()
  graphByObservationPosition.set(latest.position, graph)
  return graph
}

/**
 * Constructs a cursor view from the complete index after its full view has
 * passed TraceAtCursor's schema checks. Every field is a prefix slice of an
 * already ordered, relationship-checked value, so checking each cursor again
 * would repeat the same O(prefix) work.
 */
const indexedTraceAtCursor = (
  cursor: TraceCursor,
  graph: TraceTaskGraph | null,
  items: ReadonlyArray<TraceHistoryItem>,
  relationships: TraceRelationships
): TraceAtCursor => ({
  cursor,
  derivedTaskOrder: {
    _tag: "DerivedTaskOrder",
    basis: "TaskIdCodeUnitAscending",
    taskIds: sortedUniqueTaskIds(graph?.snapshot.tasks.map(({ id }) => id) ?? [])
  },
  graph,
  items,
  relationships,
  version: traceReaderSchemaVersion
})

const atCursorFromCompleteIndex = Effect.fn("TraceReader.atCursorFromCompleteIndex")(function* (
  cursor: TraceCursor,
  index: CompleteTraceIndex,
  graphByObservationPosition: Map<JournalPosition, TraceTaskGraph | null>
) {
  const through = cursor.position
  if (!index.committedPositions.has(through)) {
    return yield* new TraceCursorNotCommitted({ cursor })
  }
  const items = index.items.slice(
    0,
    prefixLengthThrough(index.items, ({ identity }) => identity.position, through)
  )
  const graph = graphAtIndexedPrefix(index, through, graphByObservationPosition)
  const relationships: TraceRelationships = {
    outsideAuthorityAcknowledgements: index.outsideAuthorityAcknowledgements.slice(
      0,
      prefixLengthThrough(index.outsideAuthorityAcknowledgements, ({ observation }) => observation.position, through)
    ),
    processLocalResourceSerializations: index.processLocalResourceSerializations.slice(
      0,
      prefixLengthThrough(index.processLocalResourceSerializations, ({ later }) => later.position, through)
    ),
    taskGraphEdges: graph?.edges ?? [],
    workflowCausalEdges: index.workflowCausalEdges
      .slice(
        0,
        prefixLengthThrough(index.workflowCausalEdges, ({ successorPosition }) => successorPosition, through)
      )
      .map(({ edge }) => edge)
  }
  return indexedTraceAtCursor(cursor, graph, items, relationships)
})

const atCursorFromRecords = Effect.fn("TraceReader.atCursorFromRecords")(function* (
  cursor: TraceCursor,
  records: ReadonlyArray<JournalRecord>
) {
  const prefix = yield* cursorPrefixOf(cursor, records)
  yield* validateRecords(cursor.runId, prefix)
  const operationIndex = yield* operationIndexOf(cursor.runId, prefix)
  const projection = yield* projectWorkflowOccurrences(prefix).pipe(
    Effect.mapError((cause) => new TraceProjectionInvalid({ detail: String(cause), runId: cursor.runId }))
  )
  const items = projection.occurrences.map((occurrence) => itemFromOccurrence(cursor.runId, occurrence))
  const beginning = yield* workflowRunBeginningOf(prefix)
  const target = beginning.target
  const graph = taskGraphAt(prefix, target)
  const relationships = relationshipsAt(prefix, items, graph, operationIndex)
  const taskIds = graph?.snapshot.tasks.flatMap(({ id }) => [id]) ?? []
  return TraceAtCursor.make({
    cursor,
    derivedTaskOrder: TraceDerivedTaskOrder.make({
      basis: "TaskIdCodeUnitAscending",
      taskIds: sortedUniqueTaskIds(taskIds)
    }),
    graph,
    items,
    relationships,
    version: traceReaderSchemaVersion
  })
})

/** Builds a reader over a read-only committed-prefix capability. */
export const makeTraceReader = (source: TraceJournalReadSource): TraceReaderService => {
  const readRecords = (runId: RunId) => source.read(runId)
  const completeTraceIndexes = new WeakMap<ReadonlyArray<JournalRecord>, CompleteTraceIndex>()
  type CompleteTraceIndexBuild = {
    readonly deferred: Deferred.Deferred<CompleteTraceIndex, TraceReaderError>
    readonly runId: RunId
  }
  const completeTraceIndexBuilds = new WeakMap<ReadonlyArray<JournalRecord>, CompleteTraceIndexBuild>()
  const graphByIndex = new WeakMap<CompleteTraceIndex, Map<JournalPosition, TraceTaskGraph | null>>()
  const historiesByIndex = new WeakMap<CompleteTraceIndex, TraceHistory>()
  const viewsByIndex = new WeakMap<CompleteTraceIndex, Map<JournalPosition, TraceAtCursor>>()
  const fallbackViewsByRecords = new WeakMap<ReadonlyArray<JournalRecord>, Map<string, TraceAtCursor>>()
  const cursorCacheKey = (cursor: TraceCursor): string => JSON.stringify([cursor.runId, cursor.position])
  const completeTraceIndexFor = (runId: RunId, records: ReadonlyArray<JournalRecord>) => {
    const cached = completeTraceIndexes.get(records)
    if (cached !== undefined && cached.runId === runId) return Effect.succeed(cached)
    const building = completeTraceIndexBuilds.get(records)
    if (building !== undefined && building.runId === runId) return Deferred.await(building.deferred)
    const deferred = Deferred.makeUnsafe<CompleteTraceIndex, TraceReaderError>()
    completeTraceIndexBuilds.set(records, { deferred, runId })
    return completeTraceIndexFromRecords(runId, records).pipe(
      Effect.tap((index) =>
        Effect.sync(() => {
          completeTraceIndexes.set(records, index)
          graphByIndex.set(index, new Map())
          viewsByIndex.set(index, new Map())
        })
      ),
      Effect.tap((index) => Deferred.succeed(deferred, index)),
      Effect.tapError((error) => Deferred.fail(deferred, error))
    )
  }
  const fallbackViewFor = (cursor: TraceCursor, records: ReadonlyArray<JournalRecord>) => {
    const views = fallbackViewsByRecords.get(records) ?? new Map<string, TraceAtCursor>()
    const key = cursorCacheKey(cursor)
    const cached = views.get(key)
    return cached === undefined
      ? atCursorFromRecords(cursor, records).pipe(
          Effect.tap((view) =>
            Effect.sync(() => {
              views.set(key, view)
              fallbackViewsByRecords.set(records, views)
            })
          )
        )
      : Effect.succeed(cached)
  }
  const historyFromIndex = (index: CompleteTraceIndex): TraceHistory =>
    historiesByIndex.get(index) ??
    (() => {
      const history = TraceHistory.make({
        committedThrough: index.committedThrough,
        items: index.items,
        runId: index.runId,
        version: traceReaderSchemaVersion
      })
      historiesByIndex.set(index, history)
      return history
    })()
  const read = (runId: RunId) =>
    readRecords(runId).pipe(
      Effect.flatMap((records) =>
        completeTraceIndexFor(runId, records).pipe(
          Effect.map(historyFromIndex),
          Effect.catch(() => historyFromRecords(runId, records))
        )
      )
    )
  const readAt = (cursor: TraceCursor) =>
    readRecords(cursor.runId).pipe(
      Effect.flatMap((records) =>
        completeTraceIndexFor(cursor.runId, records).pipe(
          Effect.flatMap((index) => {
            const views = viewsByIndex.get(index) ?? new Map<JournalPosition, TraceAtCursor>()
            const cached = views.get(cursor.position)
            return cached === undefined
              ? atCursorFromCompleteIndex(cursor, index, graphByIndex.get(index) ?? new Map()).pipe(
                  Effect.tap((view) =>
                    Effect.sync(() => {
                      views.set(cursor.position, view)
                      viewsByIndex.set(index, views)
                    })
                  )
                )
              : Effect.succeed(cached)
          }),
          Effect.catch(() => fallbackViewFor(cursor, records))
        )
      )
    )
  const causalPredecessor = (
    cursor: TraceCursor,
    successorOperationId: OperationId,
    predecessorOperationId: OperationId
  ): Effect.Effect<TraceHistoryItem, TraceReaderError | JournalStoreError> =>
    readAt(cursor).pipe(
      Effect.flatMap((view): Effect.Effect<TraceHistoryItem, TraceReaderError> => {
        const edge = view.relationships.workflowCausalEdges.find(
          ({ predecessorOperationId: predecessor, successorOperationId: successor }) =>
            predecessor === predecessorOperationId && successor === successorOperationId
        )
        if (edge === undefined) {
          const failure = new TraceCausalPredecessorMissing({
            predecessorOperationId,
            runId: cursor.runId,
            successorOperationId
          })
          return Effect.fail(failure)
        }
        const item = operationItem(view.items, predecessorOperationId)
        if (item === undefined) {
          const failure = new TraceCausalPredecessorNotProjected({
            predecessorOperationId,
            runId: cursor.runId,
            successorOperationId
          })
          return Effect.fail(failure)
        }
        return Effect.succeed(item)
      })
    )
  return { causalPredecessor, read, readAt }
}

/** Public helper for callers that already hold the read-only service. */
export const readTraceAt = (reader: TraceReaderService, cursor: TraceCursor) => reader.readAt(cursor)

/** Installs the production reader without exposing journal mutation methods to presentation. */
export const TraceReaderLayer = Layer.effect(
  TraceReader,
  Effect.gen(function* () {
    const source = yield* JournalReadSource
    return TraceReader.of(makeTraceReader(source))
  })
).pipe(Layer.provide(journalReadSourceLayer))

/** Read-only current-status composition. Status is a separate value and cannot rewrite history. */
export interface TracePresentation<Status> {
  readonly currentStatus: Status
  readonly history: TraceAtCursor
}

/** Combines one already-fixed historical view with a separately supplied passive status value. */
export const makeTracePresentation = <Status>(
  history: TraceAtCursor,
  currentStatus: Status
): TracePresentation<Status> => ({ currentStatus, history })

/** Keeps the status source passive while preserving the historical cursor as an immutable value. */
export const makeTracePresentationWithStatusSource = <Status>(
  history: TraceAtCursor,
  status: CurrentSignal<Status>
): TracePresentation<CurrentSignal<Status>> => ({ currentStatus: status, history })

/** Narrows the public source to the one passive read capability presentation needs. */
export interface TracePresentationSource<Status> {
  readonly currentStatus: CurrentSignal<Status>
  readonly traceReader: Pick<TraceReaderService, "causalPredecessor" | "read" | "readAt">
}

/** Reads a fixed cursor through presentation's read-only source. */
export const readTracePresentation = <Status>(
  source: TracePresentationSource<Status>,
  cursor: TraceCursor
): Effect.Effect<TracePresentation<CurrentSignal<Status>>, TraceReaderError | JournalStoreError> =>
  source.traceReader
    .readAt(cursor)
    .pipe(Effect.map((history) => makeTracePresentationWithStatusSource(history, source.currentStatus)))
