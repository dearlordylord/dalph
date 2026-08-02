import {
  PlannedAttemptExecutorReport,
  type AttemptId,
  type PlannedTaskAttempt,
  type TaskId,
  type TaskRevision
} from "@dalph/contracts"
import { Context, Effect, Schema, Stream } from "effect"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { TrackerRevision } from "../../authorities/task-tracker/task.js"
import type { RunControlPolicy } from "../../control/policy.js"
import type { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import type {
  QueuedIntegrationResponsibility,
  StartedIntegrationResponsibility,
  UnqueuedAcceptedResult
} from "../../workflow/protocols/integration-admission/protocol.js"
import type { IntegrationCandidateConstructionState } from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import type { IntegrationDeliveryWait } from "../frontier/integration-frontier.js"

/** A descriptive latest-value source. Observing it never performs a Dalph action. */
export interface CurrentSignal<A, E = never> {
  readonly changes: Stream.Stream<A, E>
}

/** Creates a deterministic current-first signal for controlled compositions. */
export const currentSignalOf = <A>(value: A): CurrentSignal<A> => ({ changes: Stream.make(value) })

/** Projects every current value without changing the signal's descriptive colour. */
export const mapCurrentSignal = <A, E, B>(
  signal: CurrentSignal<A, E>,
  project: (value: A) => B
): CurrentSignal<B, E> => ({ changes: signal.changes.pipe(Stream.map(project)) })

/** Relates two current sources so a revision of either recomputes their shared projection. */
export const zipCurrentSignals = <A, EA, B, EB>(
  left: CurrentSignal<A, EA>,
  right: CurrentSignal<B, EB>
): CurrentSignal<readonly [A, B], EA | EB> => ({ changes: Stream.zipLatest(left.changes, right.changes) })

/** The current usable graph is either absent or already normalized and structurally validated. */
export type TrackerGraphState =
  | { readonly _tag: "GraphEstablished"; readonly snapshot: TaskDagSnapshot }
  | { readonly _tag: "GraphNotEstablished" }

export const TrackerGraphState = {
  cases: {
    GraphEstablished: {
      make: (fields: { readonly snapshot: TaskDagSnapshot }): TrackerGraphState => ({
        _tag: "GraphEstablished",
        ...fields
      })
    },
    GraphNotEstablished: {
      make: (_fields: Record<never, never>): TrackerGraphState => ({ _tag: "GraphNotEstablished" })
    }
  }
}

/** One graph-owned reason that a present ticket is not currently eligible. */
export type DeliveryFrontierExclusion =
  | { readonly _tag: "PrerequisitesIncomplete"; readonly prerequisiteTaskIds: ReadonlyArray<TaskId> }
  | { readonly _tag: "SuccessfulCompletion" }
  | { readonly _tag: "TerminalWithoutSuccess" }

/** The exhaustive graph-only placement of one task in an established graph. */
export type DeliveryFrontierStanding =
  | { readonly _tag: "Eligible"; readonly taskId: TaskId; readonly taskRevision: TaskRevision }
  | {
      readonly _tag: "Excluded"
      readonly reasons: readonly [DeliveryFrontierExclusion, ...ReadonlyArray<DeliveryFrontierExclusion>]
      readonly taskId: TaskId
    }

/** Graph-only delivery evidence; workflow responsibility and runtime ownership are excluded. */
export interface DeliveryFrontier {
  readonly _tag: "DeliveryFrontier"
  readonly source: TrackerGraphState
  readonly standings: ReadonlyArray<DeliveryFrontierStanding>
}

/** Zero-based position in the deterministic graph-candidate order. */
export const BoundedTicketRank = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("BoundedTicketRank")
)
export type BoundedTicketRank = typeof BoundedTicketRank.Type

/** Why one graph task is or is not in the current deterministic desired set. */
export type BoundedTicketPlacement =
  | { readonly _tag: "Selected"; readonly rank: BoundedTicketRank }
  | { readonly _tag: "EligibleOutsideBound"; readonly rank: BoundedTicketRank }
  | {
      readonly _tag: "GraphExcluded"
      readonly reasons: Extract<DeliveryFrontierStanding, { readonly _tag: "Excluded" }>["reasons"]
    }

/** Desired graph tickets under policy, not admitted work or held runtime positions. */
export interface BoundedParallelTickets {
  readonly _tag: "BoundedParallelTickets"
  readonly placements: ReadonlyArray<{ readonly placement: BoundedTicketPlacement; readonly taskId: TaskId }>
  readonly policy: RunControlPolicy
  readonly source: DeliveryFrontier
}

/** One exact journal-established obligation retained beneath broad ticket delivery. */
export type ExactWorkflowObligation =
  | { readonly _tag: "WorkflowResponsibility"; readonly responsibility: WorkflowResponsibilityEntry }
  | { readonly _tag: "AcceptedAwaitingIntegration"; readonly accepted: UnqueuedAcceptedResult }
  | { readonly _tag: "QueuedIntegration"; readonly responsibility: QueuedIntegrationResponsibility }
  | { readonly _tag: "StartedIntegration"; readonly responsibility: StartedIntegrationResponsibility }

/** Process-local delivery standing derived from exact accepted protocol facts. */
export type TicketDeliveryStanding =
  | { readonly _tag: "ProposedDelivery" }
  | { readonly _tag: "ResponsibilitySituation"; readonly facts: ResponsibilityFreshFacts }
  | { readonly _tag: "ExactEvidenceConflict"; readonly evidenceIdentities: readonly [string, ...ReadonlyArray<string>] }
  | { readonly _tag: "AcceptedAwaitingIntegrationQueue"; readonly accepted: UnqueuedAcceptedResult }
  | { readonly _tag: "QueuedIntegration"; readonly responsibility: QueuedIntegrationResponsibility }
  | { readonly _tag: "StartedIntegration"; readonly responsibility: StartedIntegrationResponsibility }
  | { readonly _tag: "CandidateWorkActive"; readonly state: IntegrationCandidateConstructionState }
  | {
      readonly _tag: "CandidateConstructedUnsettled"
      readonly state: Extract<IntegrationCandidateConstructionState, { readonly _tag: "CandidateConstructed" }>
    }
  | { readonly _tag: "IntegrationNonConvergencePreserved"; readonly state: IntegrationCandidateConstructionState }
  | { readonly _tag: "IntegrationWait"; readonly wait: IntegrationDeliveryWait }
  | {
      readonly _tag: "SyntheticExecutorSituation"
      readonly plannedAttempt: PlannedTaskAttempt
      readonly report: PlannedAttemptExecutorReport
    }

/** Graph/bound evidence for a retained broad delivery, including its negative space. */
export type TicketDeliveryPlacement =
  | BoundedTicketPlacement
  | { readonly _tag: "AbsentFromCurrentGraph"; readonly graphRevision: TrackerRevision }
  | { readonly _tag: "GraphNotEstablished" }

/** Exact lower accepted evidence supplied to the pure broad-delivery projection. */
export type ExactTicketDeliveryEvidence =
  | { readonly _tag: "ResponsibilityFacts"; readonly facts: ResponsibilityFreshFacts }
  | { readonly _tag: "AcceptedAwaitingIntegration"; readonly accepted: UnqueuedAcceptedResult }
  | { readonly _tag: "QueuedIntegration"; readonly responsibility: QueuedIntegrationResponsibility }
  | { readonly _tag: "StartedIntegration"; readonly responsibility: StartedIntegrationResponsibility }
  | {
      readonly _tag: "IntegrationCandidate"
      readonly responsibility: StartedIntegrationResponsibility
      readonly state: IntegrationCandidateConstructionState
    }

/** Exact accepted evidence plus non-authoritative regional and synthetic observations. */
export type TicketDeliveryEvidence =
  | ExactTicketDeliveryEvidence
  | { readonly _tag: "IntegrationWait"; readonly wait: IntegrationDeliveryWait }
  | {
      readonly _tag: "SyntheticExecutorFacts"
      readonly plannedAttempt: PlannedTaskAttempt
      readonly report: PlannedAttemptExecutorReport
    }

/** Evidence that the executor reported a terminal result for one exact planned attempt. */
export const PlannedAttemptExecutorTerminalEvidence = Schema.TaggedStruct("PlannedAttemptExecutorTerminal", {
  report: PlannedAttemptExecutorReport.cases.Terminal
})
export type PlannedAttemptExecutorTerminalEvidence = typeof PlannedAttemptExecutorTerminalEvidence.Type

/** Current broad delivery knowledge for one ticket; it is never journal authority. */
export interface TicketDelivery {
  readonly _tag: "TicketDelivery"
  readonly evidence: ReadonlyArray<TicketDeliveryEvidence>
  readonly obligations: ReadonlyArray<ExactWorkflowObligation>
  readonly placement: TicketDeliveryPlacement
  readonly standings: readonly [TicketDeliveryStanding, ...ReadonlyArray<TicketDeliveryStanding>]
  readonly taskId: TaskId
}

/** Current ticket deliveries derived from desired tickets and exact lower obligations. */
export interface TicketDeliveries {
  readonly _tag: "TicketDeliveries"
  readonly deliveries: ReadonlyArray<TicketDelivery>
  readonly source: BoundedParallelTickets
}

const DeliverySettlementTypeId: unique symbol = Symbol("DeliverySettlement")

/** Established terminal delivery fact; an executor terminal report is not one. */
export interface DeliverySettlement {
  readonly [DeliverySettlementTypeId]: typeof DeliverySettlementTypeId
  readonly _tag: "DeliverySettlement"
  readonly attemptId: AttemptId
  readonly taskId: TaskId
}

const DeliverySettlementsTypeId: unique symbol = Symbol("DeliverySettlements")

/** Established settlements only; current production honestly supplies none. */
export interface DeliverySettlements {
  readonly [DeliverySettlementsTypeId]: typeof DeliverySettlementsTypeId
  readonly _tag: "DeliverySettlements"
  readonly settlements: ReadonlyArray<DeliverySettlement>
  readonly source: TicketDeliveries
}

/** Constructs the current set of established settlements. */
export const makeDeliverySettlements = (
  source: TicketDeliveries,
  settlements: ReadonlyArray<DeliverySettlement>
): DeliverySettlements => ({
  [DeliverySettlementsTypeId]: DeliverySettlementsTypeId,
  _tag: "DeliverySettlements",
  settlements,
  source
})

const DeliveryReflectionTypeId: unique symbol = Symbol("DeliveryReflection")

/** Current tracker-reflection meaning projected only from established settlements. */
export interface DeliveryReflection {
  readonly [DeliveryReflectionTypeId]: typeof DeliveryReflectionTypeId
  readonly _tag: "DeliveryReflection"
  readonly source: DeliverySettlements
}

/** Constructs current tracker-reflection meaning from established settlements only. */
export const makeDeliveryReflection = (source: DeliverySettlements): DeliveryReflection => ({
  [DeliveryReflectionTypeId]: DeliveryReflectionTypeId,
  _tag: "DeliveryReflection",
  source
})

const DeliveryActionProposalTypeId: unique symbol = Symbol("DeliveryActionProposal")

/** Pure next-action description; constructing or observing it performs no action. */
export interface DeliveryActionProposal {
  readonly [DeliveryActionProposalTypeId]: typeof DeliveryActionProposalTypeId
  readonly _tag: "DeliveryActionProposal"
}

export class TrackerGraphRelationError extends Schema.TaggedErrorClass<TrackerGraphRelationError>()(
  "TrackerGraphRelationError",
  { summary: Schema.String }
) {}

export class TicketDeliveryError extends Schema.TaggedErrorClass<TicketDeliveryError>()("TicketDeliveryError", {
  summary: Schema.String
}) {}

export class DeliverySettlementError extends Schema.TaggedErrorClass<DeliverySettlementError>()(
  "DeliverySettlementError",
  { summary: Schema.String }
) {}

export class DeliveryReflectionError extends Schema.TaggedErrorClass<DeliveryReflectionError>()(
  "DeliveryReflectionError",
  { summary: Schema.String }
) {}

export interface TrackerGraphRelationService {
  readonly proposedActions: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, TrackerGraphRelationError>
  readonly signal: CurrentSignal<TrackerGraphState, TrackerGraphRelationError>
}

/** Current accepted tracker-graph relation supplied to the flat delivery composition. */
export class TrackerGraphRelation extends Context.Service<TrackerGraphRelation, TrackerGraphRelationService>()(
  "@dalph/TrackerGraphRelation"
) {}

export interface TicketDeliveryRelation<E = TicketDeliveryError> {
  /** Current broad lifecycle derived from desired tickets and exact lower obligations. */
  readonly current: CurrentSignal<TicketDeliveries, E>
  /** Pure exact next actions; observing them acquires no position and performs no request. */
  readonly proposedActions: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, E>
}

export interface DeliverySettlementRelation<E = DeliverySettlementError> {
  /** Current established settlement facts; executor Terminal alone cannot enter this value. */
  readonly current: CurrentSignal<DeliverySettlements, E>
  /** Pure integration/disposition actions that may eventually establish settlement. */
  readonly proposedActions: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, E>
}

export interface DeliveryReflectionRelation<E = DeliveryReflectionError> {
  /** Current reflection meaning derived only from established settlements. */
  readonly current: CurrentSignal<DeliveryReflection, E>
  /** Pure tracker-reflection actions; the current empty settlement set produces none. */
  readonly proposedActions: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, E>
}

export interface BoundedParallelTicketsProjectionService {
  readonly of: <E>(frontier: CurrentSignal<DeliveryFrontier, E>) => CurrentSignal<BoundedParallelTickets, E>
}

export class BoundedParallelTicketsProjection extends Context.Service<
  BoundedParallelTicketsProjection,
  BoundedParallelTicketsProjectionService
>()("@dalph/BoundedParallelTicketsProjection") {}

export interface TicketDeliveryProjectionService {
  readonly of: <E>(tickets: CurrentSignal<BoundedParallelTickets, E>) => TicketDeliveryRelation<E | TicketDeliveryError>
}

export class TicketDeliveryProjection extends Context.Service<
  TicketDeliveryProjection,
  TicketDeliveryProjectionService
>()("@dalph/TicketDeliveryProjection") {}

export interface DeliverySettlementProjectionService {
  readonly of: <E>(deliveries: TicketDeliveryRelation<E>) => DeliverySettlementRelation<E | DeliverySettlementError>
}

export class DeliverySettlementProjection extends Context.Service<
  DeliverySettlementProjection,
  DeliverySettlementProjectionService
>()("@dalph/DeliverySettlementProjection") {}

export interface DeliveryReflectionProjectionService {
  readonly of: <E>(
    settlements: DeliverySettlementRelation<E>
  ) => DeliveryReflectionRelation<E | DeliveryReflectionError>
}

export class DeliveryReflectionProjection extends Context.Service<
  DeliveryReflectionProjection,
  DeliveryReflectionProjectionService
>()("@dalph/DeliveryReflectionProjection") {}

/** Hides policy projection while preserving the flat delivery-level sentence. */
export const boundedParallelTickets = Effect.fn("Delivery.boundedParallelTickets")(function* <E>(
  frontier: CurrentSignal<DeliveryFrontier, E>
) {
  const projection = yield* BoundedParallelTicketsProjection
  return projection.of(frontier)
})

/** Relates desired tickets to every executor responsibility that still follows from them. */
export const executorResponsibilities = Effect.fn("Delivery.executorResponsibilities")(function* <E>(
  tickets: CurrentSignal<BoundedParallelTickets, E>
) {
  const projection = yield* TicketDeliveryProjection
  return projection.of(tickets)
})

/** Establishes delivery settlements without confusing executor Terminal with settlement. */
export const deliverySettlements = Effect.fn("Delivery.deliverySettlements")(function* <E>(
  deliveries: TicketDeliveryRelation<E>
) {
  const projection = yield* DeliverySettlementProjection
  return projection.of(deliveries)
})

/** Projects only established settlements toward tracker reflection. */
export const reflectDeliverySettlements = Effect.fn("Delivery.reflectDeliverySettlements")(function* <E>(
  settlements: DeliverySettlementRelation<E>
) {
  const projection = yield* DeliveryReflectionProjection
  return projection.of(settlements)
})
