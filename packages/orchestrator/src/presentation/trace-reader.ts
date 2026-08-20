/* eslint-disable functional/immutable-data, max-lines -- Prefix validation and relationship indexes are private read-side scratch. */
import { Context, Effect, Layer, Option, Schema } from "effect"
import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
  IntegrationTarget,
  PlannedTaskAttempt,
  RunId,
  TaskId,
  plannedTaskAttemptEquivalence
} from "@dalph/contracts"
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
import {
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorSessionCorrelation
} from "../workflow/protocols/integrator/events.js"
import { acceptedResultEquivalence } from "../workflow/protocols/integration-admission/responsibility.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionFingerprint
} from "../workflow/protocols/integration-quarantine/events.js"
import { IntegrationFinalityJournalEvent } from "../workflow/protocols/integration-finality/events.js"
import {
  TargetPromotionAttemptOrdinal,
  TargetPromotionCorrelation,
  TargetPromotionNonConvergenceObservation,
  TargetPromotionStaleObservation,
  TargetPromotionSuccessObservation,
  TargetPromotionTerminalBasis,
  targetPromotionCorrelationEquals
} from "../workflow/protocols/target-promotion/events.js"
import { AttemptRestartAuthorityReadFailure } from "../workflow/protocols/attempt-choice/replacement-events.js"
import { AttemptChoiceSubject } from "../workflow/protocols/attempt-choice/events.js"
import { ActiveTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import { PlannedAttemptWorktreeObservation } from "../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import { PlannedWorktreeReady } from "../authorities/git/worktree.js"
import type {
  CompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservation,
  UnchangedTaskTrackerFactsReconfirmed
} from "../workflow/task-tracker-facts/observation.js"
import { reconstructedTaskGraphFor } from "../coordination/reconstruction/graph-knowledge.js"
import type { CurrentSignal } from "../coordination/delivery/relations.js"

/** Version of the immutable production trace contract consumed by presentation. */
export const traceReaderSchemaVersion = 2 as const // eslint-disable-line no-magic-numbers

const exactCandidateParentCount = 2 // eslint-disable-line no-magic-numbers
const latestSameTargetResponsibilityIndex = -1 // eslint-disable-line no-magic-numbers

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

/** A committed action whose owning boundary observation is absent at a cursor. */
export const TraceObservationGap = Schema.TaggedUnion({
  CandidateQualification: {
    action: TraceItemIdentity,
    candidateText: IntegratorCandidateText,
    run: IntegratorRunCorrelation
  },
  ExecutorReport: { action: TraceItemIdentity, attemptId: AttemptId },
  GitObservation: {
    action: TraceItemIdentity,
    operationId: OperationId,
    required: Schema.Literals(["PlannedAttemptWorktreeObserved", "TargetLineageObserved"]),
    taskIds: Schema.Array(TaskId)
  },
  IntegratorResult: { action: TraceItemIdentity, run: IntegratorRunCorrelation },
  PromotionResult: {
    action: TraceItemIdentity,
    attemptOrdinal: TargetPromotionAttemptOrdinal,
    correlation: TargetPromotionCorrelation
  },
  TrackerObservation: {
    action: TraceItemIdentity,
    operationId: OperationId,
    required: Schema.Literals(["TaskClaimAcquired", "TaskClaimReleased", "TaskTrackerFactsObserved"]),
    taskIds: Schema.Array(TaskId)
  }
})
export type TraceObservationGap = typeof TraceObservationGap.Type

/** One exact responsibility still retained by the committed prefix. */
export const TraceRetainedResponsibility = Schema.TaggedUnion({
  ExecutorWork: { plannedAttempt: PlannedTaskAttempt, source: TraceItemIdentity },
  TaskClaim: { claim: ActiveTaskClaim, source: TraceItemIdentity },
  TaskAttempt: { plannedAttempt: PlannedTaskAttempt, source: TraceItemIdentity },
  Worktree: { plannedAttempt: PlannedTaskAttempt, proof: PlannedWorktreeReady, source: TraceItemIdentity }
})
export type TraceRetainedResponsibility = typeof TraceRetainedResponsibility.Type

/** A concrete historical preservation disposition, never a generic archive state. */
export const TracePreservationDisposition = Schema.TaggedUnion({
  IntegrationQuarantined: {
    basis: IntegrationQuarantineBasis,
    correlation: IntegratorSessionCorrelation,
    source: TraceItemIdentity
  },
  NonConvergentPromotion: {
    correlation: TargetPromotionCorrelation,
    lastObservation: TargetPromotionNonConvergenceObservation,
    source: TraceItemIdentity
  },
  ReplacementPending: { choice: AttemptChoiceSubject, source: TraceItemIdentity },
  TaskAuthorityConflict: {
    failure: AttemptRestartAuthorityReadFailure,
    source: TraceItemIdentity,
    subject: AttemptChoiceSubject
  },
  WorktreeLost: {
    observation: PlannedAttemptWorktreeObservation,
    plannedAttempt: PlannedTaskAttempt,
    source: TraceItemIdentity
  }
})
export type TracePreservationDisposition = typeof TracePreservationDisposition.Type

/** Generic recovery explanation derived from one validated immutable prefix. */
export const TraceRecoveryFacet = Schema.Struct({
  observationGaps: Schema.Array(TraceObservationGap),
  preservationDispositions: Schema.Array(TracePreservationDisposition),
  retainedResponsibilities: Schema.Array(TraceRetainedResponsibility)
})
export type TraceRecoveryFacet = typeof TraceRecoveryFacet.Type

/** Integration facts retain the exact source identity for every presentation claim. */
export const TraceIntegrationFact = Schema.TaggedUnion({
  AcceptedResult: { acceptedResult: AcceptedResult, plannedAttempt: PlannedTaskAttempt, source: TraceItemIdentity },
  CandidateObserved: {
    candidateText: IntegratorCandidateText,
    observation: IntegratorGitObservation,
    run: IntegratorRunCorrelation,
    source: TraceItemIdentity
  },
  CandidateQualification: {
    candidateCommit: GitCommitSha,
    candidateText: IntegratorCandidateText,
    directParents: Schema.Tuple([GitCommitSha, GitCommitSha]),
    run: IntegratorRunCorrelation,
    source: TraceItemIdentity
  },
  Completion: { event: IntegrationFinalityJournalEvent, source: TraceItemIdentity },
  IntegratorResult: { result: IntegratorResult, run: IntegratorRunCorrelation, source: TraceItemIdentity },
  Quarantine: {
    basis: IntegrationQuarantineBasis,
    correlation: IntegratorSessionCorrelation,
    source: TraceItemIdentity
  },
  Responsibility: {
    acceptedResult: AcceptedResult,
    plannedAttempt: PlannedTaskAttempt,
    sameTargetPredecessor: Schema.NullOr(TraceItemIdentity),
    source: TraceItemIdentity,
    target: IntegrationTarget
  },
  Session: { correlation: IntegratorSessionCorrelation, source: TraceItemIdentity },
  SessionStarted: { responsibility: TraceItemIdentity, source: TraceItemIdentity, target: IntegrationTarget },
  Promotion: {
    basis: TargetPromotionTerminalBasis,
    correlation: TargetPromotionCorrelation,
    kind: Schema.Literals(["Attempt", "NonConvergent", "Requested", "Stale", "Succeeded"]),
    observation: Schema.NullOr(
      Schema.Union([
        TargetPromotionSuccessObservation,
        TargetPromotionStaleObservation,
        TargetPromotionNonConvergenceObservation
      ])
    ),
    source: TraceItemIdentity
  },
  ProviderActivityAbsent: {
    correlation: IntegratorSessionCorrelation,
    run: IntegratorRunCorrelation,
    source: TraceItemIdentity
  },
  QuarantineDirection: { fingerprint: IntegrationQuarantineDirectionFingerprint, source: TraceItemIdentity }
})
export type TraceIntegrationFact = typeof TraceIntegrationFact.Type

/** One shared versioned envelope consumed by console and Reducer Lab. */
export const TraceHistoricalFacets = Schema.Struct({
  integration: Schema.Struct({ facts: Schema.Array(TraceIntegrationFact) }),
  recovery: TraceRecoveryFacet
})
export type TraceHistoricalFacets = typeof TraceHistoricalFacets.Type

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

const traceHistoricalFacetsIssue = (view: {
  readonly cursor: TraceCursor
  readonly items: ReadonlyArray<TraceHistoryItem>
  readonly facets: TraceHistoricalFacets
}): string | undefined => {
  const identities: ReadonlyArray<TraceItemIdentity> = [
    ...view.facets.recovery.observationGaps.map(({ action }) => action),
    ...view.facets.recovery.preservationDispositions.map(({ source }) => source),
    ...view.facets.recovery.retainedResponsibilities.map(({ source }) => source),
    ...view.facets.integration.facts.flatMap((fact) =>
      fact._tag === "SessionStarted"
        ? [fact.source, fact.responsibility]
        : fact._tag === "Responsibility" && fact.sameTargetPredecessor !== null
          ? [fact.source, fact.sameTargetPredecessor]
          : [fact.source]
    )
  ]
  const invalid = identities.find(
    (identity) => identityOutsideCursor(identity, view.cursor) || historyItemAt(view.items, identity) === undefined
  )
  if (invalid !== undefined) return "Every historical facet source must resolve to an item in the cursor prefix"
  const invalidFact = view.facets.integration.facts.find(
    (fact) => traceHistoricalFactIssue(fact, view.items) !== undefined
  )
  return invalidFact === undefined ? undefined : traceHistoricalFactIssue(invalidFact, view.items)
}

const traceAtCursorInvariant = (view: {
  readonly cursor: TraceCursor
  readonly derivedTaskOrder: TraceDerivedTaskOrder
  readonly graph: TraceTaskGraph | null
  readonly items: ReadonlyArray<TraceHistoryItem>
  readonly relationships: TraceRelationships
  readonly facets: TraceHistoricalFacets
}): string | undefined =>
  traceItemsIssue(view.items, view.cursor.runId, view.cursor.position) ??
  traceGraphObservationIssue(view.graph, view.cursor, view.items) ??
  traceGraphEdgesIssue(view.graph) ??
  traceDerivedTaskOrderIssue(view.derivedTaskOrder, view.graph) ??
  traceTaskGraphRelationshipIssue(view.graph, view.relationships.taskGraphEdges) ??
  traceRelationshipIssue(view) ??
  traceHistoricalFacetsIssue(view)

/** A fixed historical cursor view. Current status is intentionally not stored here. */
export const TraceAtCursor = Schema.Struct({
  cursor: TraceCursor,
  derivedTaskOrder: TraceDerivedTaskOrder,
  graph: Schema.NullOr(TraceTaskGraph),
  items: Schema.Array(TraceHistoryItem),
  relationships: TraceRelationships,
  facets: TraceHistoricalFacets,
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
    occurrence._tag === "TaskClaimAcquisitionInitiated" ||
    occurrence._tag === "TaskClaimReleaseInitiated" ||
    occurrence._tag === "TaskAttemptPlanned" ||
    occurrence._tag === "TaskWorktreeReady"
  ) {
    return [workflowOperationId(occurrence.operation)]
  }
  if (
    occurrence._tag === "TaskTrackerFactsObserved" ||
    occurrence._tag === "PlannedAttemptWorktreeObserved" ||
    occurrence._tag === "TargetLineageObserved" ||
    occurrence._tag === "AttemptRestartAuthorityReadFailed" ||
    occurrence._tag === "TaskClaimAcquired" ||
    occurrence._tag === "TaskClaimReleased" ||
    occurrence._tag === "StoppedAttemptClaimPreserved"
  ) {
    return [
      occurrence._tag === "StoppedAttemptClaimPreserved"
        ? occurrence.observationOperationId
        : occurrence.originatingActionOperationId
    ]
  }
  if (occurrence._tag === "PlannedAttemptReplaced") return [workflowOperationId(occurrence.successorPlan)]
  if (occurrence._tag === "IntegrationFinalityOccurred") {
    const event = occurrence.event
    if ("operationId" in event) return [event.operationId]
    return []
  }
  return []
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
    taskIdsOfControlOccurrence(occurrence),
    taskIdsOfHistoricalOccurrence(occurrence)
  ].find((taskIds): taskIds is ReadonlyArray<TaskId> => taskIds !== undefined) ?? []

const taskIdsOfHistoricalOccurrence = (occurrence: WorkflowOccurrenceValue): ReadonlyArray<TaskId> | undefined => {
  if (occurrence._tag === "TaskClaimAcquisitionInitiated" || occurrence._tag === "TaskClaimReleaseInitiated")
    return [
      occurrence.operation._tag === "AcquireTaskClaim"
        ? occurrence.operation.acquisition.taskId
        : occurrence.operation.release.claim.taskId
    ]
  if (occurrence._tag === "TaskClaimAcquired") return [occurrence.claim.taskId]
  if (occurrence._tag === "TaskClaimReleased") return [occurrence.release.claim.taskId]
  if (
    occurrence._tag === "TaskAttemptPlanned" ||
    occurrence._tag === "TaskWorktreeReady" ||
    occurrence._tag === "AttemptStoppageIntended" ||
    occurrence._tag === "AttemptImplementationAbandoned" ||
    occurrence._tag === "StoppedAttemptClaimPreserved"
  )
    return [
      occurrence._tag === "TaskWorktreeReady"
        ? occurrence.operation.plannedAttempt.taskId
        : occurrence._tag === "TaskAttemptPlanned"
          ? occurrence.plannedAttempt.taskId
          : occurrence.subject.plannedAttempt.taskId
    ]
  if (
    occurrence._tag === "IntegratorSessionFixed" ||
    occurrence._tag === "IntegratorSuccessorSessionFixed" ||
    occurrence._tag === "IntegratorRunStarted" ||
    occurrence._tag === "IntegratorRunResultRecorded" ||
    occurrence._tag === "IntegratorCandidateQualificationInitiated" ||
    occurrence._tag === "IntegratorCandidateQualificationObserved"
  ) {
    if (occurrence._tag === "IntegratorSuccessorSessionFixed") return [occurrence.successor.plannedAttempt.taskId]
    if (occurrence._tag === "IntegratorSessionFixed") return [occurrence.correlation.plannedAttempt.taskId]
    if (occurrence._tag === "IntegratorCandidateQualificationObserved") {
      return [occurrence.originatingActionRun.session.plannedAttempt.taskId]
    }
    return [occurrence.run.session.plannedAttempt.taskId]
  }
  if (
    occurrence._tag === "TargetPromotionRequested" ||
    occurrence._tag === "TargetPromotionAttemptRequested" ||
    occurrence._tag === "TargetPromotionSucceeded" ||
    occurrence._tag === "TargetPromotionStale" ||
    occurrence._tag === "TargetPromotionNonConvergent"
  )
    return [occurrence.correlation.qualifiedCandidate.run.session.plannedAttempt.taskId]
  if (occurrence._tag === "IntegrationQuarantined" || occurrence._tag === "IntegrationProviderRunActivityAbsent")
    return [occurrence.correlation.plannedAttempt.taskId]
  if (occurrence._tag === "IntegrationQuarantineDirectionApplied") return undefined
  if (occurrence._tag === "IntegrationFinalityOccurred") {
    const event = occurrence.event
    if ("claim" in event) return [event.claim.plannedAttempt.taskId]
    if ("request" in event && "claim" in event.request) return [event.request.claim.plannedAttempt.taskId]
    if ("authorization" in event) return [event.authorization.claim.plannedAttempt.taskId]
    return []
  }
  return undefined
}

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

const traceItemAt = (
  items: ReadonlyArray<TraceHistoryItem>,
  position: JournalPosition
): TraceItemIdentity | undefined => items.find(({ identity }) => identity.position === position)?.identity

const itemForOccurrence = (
  items: ReadonlyArray<TraceHistoryItem>,
  predicate: (occurrence: WorkflowOccurrenceValue) => boolean
): TraceHistoryItem | undefined => items.find(({ occurrence }) => predicate(occurrence))

const sameIntegratorRun = (left: IntegratorRunCorrelation, right: IntegratorRunCorrelation): boolean =>
  Schema.toEquivalence(IntegratorRunCorrelation)(left, right)

const samePromotion = targetPromotionCorrelationEquals

const sameIntegrationTarget = (left: IntegrationTarget, right: IntegrationTarget): boolean =>
  left.repository === right.repository && left.ref === right.ref

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const traceHistoricalFactIssue = (
  fact: TraceIntegrationFact,
  items: ReadonlyArray<TraceHistoryItem>
): string | undefined => {
  const sourceItem = historyItemAt(items, fact.source)
  if (sourceItem === undefined) return "Every integration fact source must resolve to a history item"
  const source = sourceItem.occurrence
  if (fact._tag === "AcceptedResult") {
    return source._tag === "PlannedAttemptExecutorWorkReported" &&
      source.report._tag === "Terminal" &&
      source.report.result._tag === "Accepted" &&
      (fact.plannedAttempt.attemptId !== source.report.correlation.attemptId ||
        fact.plannedAttempt.runId !== source.report.correlation.runId)
      ? "Accepted result fact must retain the source executor report's planned attempt"
      : source._tag !== "PlannedAttemptExecutorWorkReported" ||
          source.report._tag !== "Terminal" ||
          source.report.result._tag !== "Accepted" ||
          !acceptedResultEquivalence(fact.acceptedResult, source.report.result.acceptedResult)
        ? "Accepted result fact must identify one exact terminal executor report"
        : undefined
  }
  if (fact._tag === "Responsibility") {
    if (
      source._tag !== "IntegrationResponsibilityBegan" ||
      !acceptedResultEquivalence(fact.acceptedResult, source.acceptedResult) ||
      !plannedTaskAttemptEquivalence(fact.plannedAttempt, source.plannedAttempt) ||
      !sameIntegrationTarget(fact.target, source.integrationTarget)
    ) {
      return "Integration responsibility fact must identify its exact source occurrence"
    }
    if (fact.sameTargetPredecessor === null) return undefined
    const predecessor = historyItemAt(items, fact.sameTargetPredecessor)
    return predecessor?.occurrence._tag === "IntegrationResponsibilityBegan" &&
      predecessor.occurrence.recordedAt < source.recordedAt &&
      sameIntegrationTarget(predecessor.occurrence.integrationTarget, source.integrationTarget)
      ? undefined
      : "Same-target responsibility order must point to one earlier responsibility for that target"
  }
  if (fact._tag === "SessionStarted") {
    const responsibility = historyItemAt(items, fact.responsibility)
    return source._tag === "IntegrationStarted" &&
      source.responsibilityBeganAt === fact.responsibility.position &&
      responsibility?.occurrence._tag === "IntegrationResponsibilityBegan" &&
      responsibility.occurrence.recordedAt < source.recordedAt &&
      sameIntegrationTarget(responsibility.occurrence.integrationTarget, source.integrationTarget)
      ? undefined
      : "Integration session start must point to its exact earlier responsibility occurrence"
  }
  if (fact._tag === "Session") {
    return source._tag === "IntegratorSessionFixed" &&
      Schema.toEquivalence(IntegratorSessionCorrelation)(fact.correlation, source.correlation)
      ? undefined
      : "Integrator session fact must identify its exact fixed-session occurrence"
  }
  if (fact._tag === "IntegratorResult") {
    return source._tag === "IntegratorRunResultRecorded" &&
      sameIntegratorRun(fact.run, source.run) &&
      sameJson(fact.result, source.result)
      ? undefined
      : "Integrator result fact must identify its exact outer result occurrence"
  }
  if (fact._tag === "CandidateObserved") {
    return source._tag === "IntegratorCandidateQualificationObserved" &&
      source.candidateText === fact.candidateText &&
      sameIntegratorRun(source.originatingActionRun, fact.run) &&
      sameJson(source.observation, fact.observation)
      ? undefined
      : "Candidate observation fact must identify its exact Git observation occurrence"
  }
  if (fact._tag === "CandidateQualification") {
    return source._tag === "IntegratorCandidateQualificationObserved" &&
      source.observation._tag === "Commit" &&
      source.candidateText === fact.candidateText &&
      source.observation.commit === fact.candidateCommit &&
      sameJson(source.observation.directParents, fact.directParents) &&
      source.observation.directParents[0] === source.originatingActionRun.session.expectedTargetHead &&
      source.observation.directParents[1] === source.originatingActionRun.session.acceptedResult.commit &&
      sameIntegratorRun(source.originatingActionRun, fact.run)
      ? undefined
      : "Candidate qualification fact must preserve the exact ordered Git parents [H, C]"
  }
  if (fact._tag === "Promotion") {
    if (source._tag === "TargetPromotionRequested" && fact.kind === "Requested") {
      return targetPromotionCorrelationEquals(source.correlation, fact.correlation) &&
        fact.basis._tag === "BeforeFirstAttempt" &&
        fact.observation === null
        ? undefined
        : "Promotion request fact must identify its exact request occurrence"
    }
    if (source._tag === "TargetPromotionAttemptRequested" && fact.kind === "Attempt") {
      return targetPromotionCorrelationEquals(source.correlation, fact.correlation) &&
        fact.basis._tag === "AfterAttempt" &&
        fact.basis.attemptOrdinal === source.attemptOrdinal &&
        fact.observation === null
        ? undefined
        : "Promotion attempt fact must identify its exact numbered attempt occurrence"
    }
    if (source._tag === "TargetPromotionSucceeded" && fact.kind === "Succeeded") {
      return targetPromotionCorrelationEquals(source.correlation, fact.correlation) &&
        sameJson(source.basis, fact.basis) &&
        sameJson(source.observation, fact.observation)
        ? undefined
        : "Promotion success fact must identify its exact Git success occurrence"
    }
    if (source._tag === "TargetPromotionStale" && fact.kind === "Stale") {
      return targetPromotionCorrelationEquals(source.correlation, fact.correlation) &&
        sameJson(source.basis, fact.basis) &&
        sameJson(source.observation, fact.observation)
        ? undefined
        : "Promotion stale fact must identify its exact Git stale occurrence"
    }
    if (source._tag === "TargetPromotionNonConvergent" && fact.kind === "NonConvergent") {
      return targetPromotionCorrelationEquals(source.correlation, fact.correlation) &&
        sameJson(source.lastObservation, fact.observation) &&
        fact.basis._tag === "AfterAttempt" &&
        fact.basis.attemptOrdinal === source.attemptOrdinal
        ? undefined
        : "Promotion non-convergence fact must identify its exact terminal occurrence"
    }
    return "Promotion fact kind must identify the matching source occurrence"
  }
  if (fact._tag === "Quarantine") {
    return source._tag === "IntegrationQuarantined" &&
      Schema.toEquivalence(IntegratorSessionCorrelation)(fact.correlation, source.correlation) &&
      sameJson(fact.basis, source.basis)
      ? undefined
      : "Quarantine fact must identify its exact preservation occurrence"
  }
  if (fact._tag === "ProviderActivityAbsent") {
    return source._tag === "IntegrationProviderRunActivityAbsent" &&
      sameIntegratorRun(fact.run, source.run) &&
      Schema.toEquivalence(IntegratorSessionCorrelation)(fact.correlation, source.correlation)
      ? undefined
      : "Provider-activity fact must identify its exact observation occurrence"
  }
  if (fact._tag === "QuarantineDirection") {
    return source._tag === "IntegrationQuarantineDirectionApplied" && sameJson(fact.fingerprint, source.fingerprint)
      ? undefined
      : "Quarantine direction fact must identify its exact operator occurrence"
  }
  return source._tag === "IntegrationFinalityOccurred" && sameJson(fact.event, source.event)
    ? undefined
    : "Finality fact must identify its exact stored finality occurrence"
}

const traceHistoricalFacetsAt = (items: ReadonlyArray<TraceHistoryItem>): TraceHistoricalFacets => {
  const observationGaps: Array<TraceObservationGap> = []
  const retainedResponsibilities: Array<TraceRetainedResponsibility> = []
  const preservationDispositions: Array<TracePreservationDisposition> = []
  const integrationFacts: Array<TraceIntegrationFact> = []
  const hasObservationFor = (operationId: OperationId, tags: ReadonlyArray<string>): boolean =>
    items.some(
      ({ occurrence }) => tags.includes(occurrence._tag) && operationIdsOfOccurrence(occurrence).includes(operationId)
    )
  const taskIdsOfTrackerOperation = (
    operation: Extract<WorkflowOccurrenceValue, { readonly _tag: "TaskTrackerReadInitiated" }>["operation"]
  ): ReadonlyArray<TaskId> => {
    if (operation._tag === "ReadTrackerGraph") return operation.readShape.explicitlyCoveredTaskIds
    return operation._tag === "ReadCompletionTaskFacts" ? [operation.request.taskId] : [operation.taskId]
  }

  for (const item of items) {
    const occurrence = item.occurrence
    if (occurrence._tag === "TaskTrackerReadInitiated") {
      if (
        !hasObservationFor(workflowOperationId(occurrence.operation), [
          "TaskTrackerFactsObserved",
          "AttemptRestartAuthorityReadFailed"
        ])
      ) {
        observationGaps.push(
          TraceObservationGap.cases.TrackerObservation.make({
            action: item.identity,
            operationId: workflowOperationId(occurrence.operation),
            required: "TaskTrackerFactsObserved",
            taskIds: taskIdsOfTrackerOperation(occurrence.operation)
          })
        )
      }
    }
    if (occurrence._tag === "GitReadInitiated") {
      const operationId = workflowOperationId(occurrence.operation)
      if (
        !hasObservationFor(operationId, [
          "PlannedAttemptWorktreeObserved",
          "TargetLineageObserved",
          "AttemptRestartAuthorityReadFailed"
        ])
      ) {
        observationGaps.push(
          TraceObservationGap.cases.GitObservation.make({
            action: item.identity,
            operationId,
            required:
              occurrence.operation._tag === "ReadTaskWorktree"
                ? "PlannedAttemptWorktreeObserved"
                : "TargetLineageObserved",
            taskIds: [occurrence.operation.plannedAttempt.taskId]
          })
        )
      }
    }
    if (occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
      const report = itemForOccurrence(
        items,
        (candidate) =>
          candidate._tag === "PlannedAttemptExecutorWorkReported" &&
          candidate.report.correlation.attemptId === occurrence.plannedAttempt.attemptId
      )
      if (report === undefined) {
        observationGaps.push(
          TraceObservationGap.cases.ExecutorReport.make({
            action: item.identity,
            attemptId: occurrence.plannedAttempt.attemptId
          })
        )
        retainedResponsibilities.push(
          TraceRetainedResponsibility.cases.ExecutorWork.make({
            plannedAttempt: occurrence.plannedAttempt,
            source: item.identity
          })
        )
      }
    }
    if (occurrence._tag === "TaskClaimAcquisitionInitiated") {
      const operationId = occurrence.operation.acquisition.operationId
      if (!hasObservationFor(operationId, ["TaskClaimAcquired"])) {
        observationGaps.push(
          TraceObservationGap.cases.TrackerObservation.make({
            action: item.identity,
            operationId,
            required: "TaskClaimAcquired",
            taskIds: [occurrence.operation.acquisition.taskId]
          })
        )
      }
    }
    if (occurrence._tag === "TaskClaimReleaseInitiated") {
      const operationId = occurrence.operation.release.operationId
      if (!hasObservationFor(operationId, ["TaskClaimReleased"])) {
        observationGaps.push(
          TraceObservationGap.cases.TrackerObservation.make({
            action: item.identity,
            operationId,
            required: "TaskClaimReleased",
            taskIds: [occurrence.operation.release.claim.taskId]
          })
        )
      }
    }
    if (occurrence._tag === "TaskAttemptPlanned") {
      retainedResponsibilities.push(
        TraceRetainedResponsibility.cases.TaskAttempt.make({
          plannedAttempt: occurrence.plannedAttempt,
          source: item.identity
        })
      )
    }
    if (occurrence._tag === "TaskClaimAcquired") {
      retainedResponsibilities.push(
        TraceRetainedResponsibility.cases.TaskClaim.make({ claim: occurrence.claim, source: item.identity })
      )
    }
    if (occurrence._tag === "TaskWorktreeReady") {
      retainedResponsibilities.push(
        TraceRetainedResponsibility.cases.Worktree.make({
          plannedAttempt: occurrence.operation.plannedAttempt,
          proof: occurrence.proof,
          source: item.identity
        })
      )
    }
    if (occurrence._tag === "PlannedAttemptWorktreeObserved" && occurrence.observation._tag === "AttemptWorktreeLost") {
      preservationDispositions.push(
        TracePreservationDisposition.cases.WorktreeLost.make({
          observation: occurrence.observation,
          plannedAttempt: occurrence.observation.plannedAttempt,
          source: item.identity
        })
      )
    }
    if (occurrence._tag === "AttemptRestartAuthorityReadFailed") {
      preservationDispositions.push(
        TracePreservationDisposition.cases.TaskAuthorityConflict.make({
          failure: occurrence.failure,
          source: item.identity,
          subject: occurrence.subject
        })
      )
    }
    if (occurrence._tag === "AppliedAttemptChoice" && occurrence.choice === "RestartTaskImplementation") {
      const replacement = itemForOccurrence(
        items,
        (candidate) =>
          candidate._tag === "PlannedAttemptReplaced" && candidate.requestId.nonce === occurrence.requestId.nonce
      )
      if (replacement === undefined) {
        preservationDispositions.push(
          TracePreservationDisposition.cases.ReplacementPending.make({
            choice: occurrence.subject,
            source: item.identity
          })
        )
      }
    }
    if (occurrence._tag === "IntegrationQuarantined") {
      preservationDispositions.push(
        TracePreservationDisposition.cases.IntegrationQuarantined.make({
          basis: occurrence.basis,
          correlation: occurrence.correlation,
          source: item.identity
        })
      )
    }
    if (occurrence._tag === "TargetPromotionNonConvergent") {
      preservationDispositions.push(
        TracePreservationDisposition.cases.NonConvergentPromotion.make({
          correlation: occurrence.correlation,
          lastObservation: occurrence.lastObservation,
          source: item.identity
        })
      )
    }
    if (
      occurrence._tag === "PlannedAttemptExecutorWorkReported" &&
      occurrence.report._tag === "Terminal" &&
      occurrence.report.result._tag === "Accepted"
    ) {
      const responsibility = itemForOccurrence(
        items,
        (candidate) =>
          candidate._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
          candidate.plannedAttempt.attemptId === occurrence.report.correlation.attemptId
      )
      if (responsibility?.occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
        integrationFacts.push(
          TraceIntegrationFact.cases.AcceptedResult.make({
            acceptedResult: occurrence.report.result.acceptedResult,
            plannedAttempt: responsibility.occurrence.plannedAttempt,
            source: item.identity
          })
        )
      }
    }
    if (occurrence._tag === "IntegrationResponsibilityBegan") {
      const sameTargetPredecessor = items
        .filter(
          ({ occurrence: candidate }) =>
            candidate._tag === "IntegrationResponsibilityBegan" &&
            candidate.recordedAt < occurrence.recordedAt &&
            sameIntegrationTarget(candidate.integrationTarget, occurrence.integrationTarget)
        )
        .at(latestSameTargetResponsibilityIndex)
      integrationFacts.push(
        TraceIntegrationFact.cases.Responsibility.make({
          acceptedResult: occurrence.acceptedResult,
          plannedAttempt: occurrence.plannedAttempt,
          sameTargetPredecessor: sameTargetPredecessor?.identity ?? null,
          source: item.identity,
          target: occurrence.integrationTarget
        })
      )
    }
    if (occurrence._tag === "IntegrationStarted") {
      const responsibility = traceItemAt(items, occurrence.responsibilityBeganAt)
      if (responsibility !== undefined)
        integrationFacts.push(
          TraceIntegrationFact.cases.SessionStarted.make({
            responsibility,
            source: item.identity,
            target: occurrence.integrationTarget
          })
        )
    }
    if (occurrence._tag === "IntegratorSessionFixed") {
      integrationFacts.push(
        TraceIntegrationFact.cases.Session.make({ correlation: occurrence.correlation, source: item.identity })
      )
    }
    if (occurrence._tag === "IntegratorRunStarted") {
      const result = itemForOccurrence(
        items,
        (candidate) =>
          candidate._tag === "IntegratorRunResultRecorded" && sameIntegratorRun(candidate.run, occurrence.run)
      )
      if (result === undefined)
        observationGaps.push(
          TraceObservationGap.cases.IntegratorResult.make({ action: item.identity, run: occurrence.run })
        )
    }
    if (occurrence._tag === "IntegratorRunResultRecorded") {
      integrationFacts.push(
        TraceIntegrationFact.cases.IntegratorResult.make({
          result: occurrence.result,
          run: occurrence.run,
          source: item.identity
        })
      )
    }
    if (occurrence._tag === "IntegratorCandidateQualificationInitiated") {
      const observed = itemForOccurrence(
        items,
        (candidate) =>
          candidate._tag === "IntegratorCandidateQualificationObserved" &&
          candidate.candidateText === occurrence.candidateText &&
          sameIntegratorRun(candidate.originatingActionRun, occurrence.run)
      )
      if (observed === undefined)
        observationGaps.push(
          TraceObservationGap.cases.CandidateQualification.make({
            action: item.identity,
            candidateText: occurrence.candidateText,
            run: occurrence.run
          })
        )
    }
    if (occurrence._tag === "IntegratorCandidateQualificationObserved") {
      integrationFacts.push(
        TraceIntegrationFact.cases.CandidateObserved.make({
          candidateText: occurrence.candidateText,
          observation: occurrence.observation,
          run: occurrence.originatingActionRun,
          source: item.identity
        })
      )
      if (
        occurrence.observation._tag === "Commit" &&
        occurrence.observation.directParents.length === exactCandidateParentCount &&
        occurrence.observation.directParents[0] === occurrence.originatingActionRun.session.expectedTargetHead &&
        occurrence.observation.directParents[1] === occurrence.originatingActionRun.session.acceptedResult.commit
      ) {
        const first = occurrence.observation.directParents[0]
        const second = occurrence.observation.directParents[1]
        integrationFacts.push(
          TraceIntegrationFact.cases.CandidateQualification.make({
            candidateCommit: occurrence.observation.commit,
            candidateText: occurrence.candidateText,
            directParents: [first, second],
            run: occurrence.originatingActionRun,
            source: item.identity
          })
        )
      }
    }
    if (occurrence._tag === "TargetPromotionRequested")
      integrationFacts.push(
        TraceIntegrationFact.cases.Promotion.make({
          basis: { _tag: "BeforeFirstAttempt" },
          correlation: occurrence.correlation,
          kind: "Requested",
          observation: null,
          source: item.identity
        })
      )
    if (occurrence._tag === "TargetPromotionAttemptRequested") {
      const terminal = items.find(
        ({ occurrence: candidate }) =>
          (candidate._tag === "TargetPromotionSucceeded" ||
            candidate._tag === "TargetPromotionStale" ||
            candidate._tag === "TargetPromotionNonConvergent") &&
          samePromotion(candidate.correlation, occurrence.correlation)
      )
      if (terminal === undefined)
        observationGaps.push(
          TraceObservationGap.cases.PromotionResult.make({
            action: item.identity,
            attemptOrdinal: occurrence.attemptOrdinal,
            correlation: occurrence.correlation
          })
        )
      integrationFacts.push(
        TraceIntegrationFact.cases.Promotion.make({
          basis: { _tag: "AfterAttempt", attemptOrdinal: occurrence.attemptOrdinal },
          correlation: occurrence.correlation,
          kind: "Attempt",
          observation: null,
          source: item.identity
        })
      )
    }
    if (
      occurrence._tag === "TargetPromotionSucceeded" ||
      occurrence._tag === "TargetPromotionStale" ||
      occurrence._tag === "TargetPromotionNonConvergent"
    ) {
      const kind =
        occurrence._tag === "TargetPromotionSucceeded"
          ? "Succeeded"
          : occurrence._tag === "TargetPromotionStale"
            ? "Stale"
            : "NonConvergent"
      const basis =
        occurrence._tag === "TargetPromotionNonConvergent"
          ? TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal: occurrence.attemptOrdinal })
          : occurrence.basis
      const observation =
        occurrence._tag === "TargetPromotionNonConvergent" ? occurrence.lastObservation : occurrence.observation
      integrationFacts.push(
        TraceIntegrationFact.cases.Promotion.make({
          basis,
          correlation: occurrence.correlation,
          kind,
          observation,
          source: item.identity
        })
      )
    }
    if (occurrence._tag === "IntegrationQuarantined")
      integrationFacts.push(
        TraceIntegrationFact.cases.Quarantine.make({
          basis: occurrence.basis,
          correlation: occurrence.correlation,
          source: item.identity
        })
      )
    if (occurrence._tag === "IntegrationProviderRunActivityAbsent")
      integrationFacts.push(
        TraceIntegrationFact.cases.ProviderActivityAbsent.make({
          correlation: occurrence.correlation,
          run: occurrence.run,
          source: item.identity
        })
      )
    if (occurrence._tag === "IntegrationQuarantineDirectionApplied")
      integrationFacts.push(
        TraceIntegrationFact.cases.QuarantineDirection.make({
          fingerprint: occurrence.fingerprint,
          source: item.identity
        })
      )
    if (occurrence._tag === "IntegrationFinalityOccurred")
      integrationFacts.push(
        TraceIntegrationFact.cases.Completion.make({ event: occurrence.event, source: item.identity })
      )
  }
  return TraceHistoricalFacets.make({
    integration: { facts: integrationFacts },
    recovery: { observationGaps, preservationDispositions, retainedResponsibilities }
  })
}

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
  const facets = traceHistoricalFacetsAt(items)
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
    facets,
    version: traceReaderSchemaVersion
  })
})

/** Builds a reader over a read-only committed-prefix capability. */
export const makeTraceReader = (source: TraceJournalReadSource): TraceReaderService => {
  const readRecords = (runId: RunId) => source.read(runId)
  const read = (runId: RunId) =>
    readRecords(runId).pipe(Effect.flatMap((records) => historyFromRecords(runId, records)))
  const readAt = (cursor: TraceCursor) =>
    readRecords(cursor.runId).pipe(Effect.flatMap((records) => atCursorFromRecords(cursor, records)))
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
