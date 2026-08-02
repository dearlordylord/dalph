import { PlannedAttemptExecutorReport, type AttemptId, type TaskId } from "@dalph/contracts"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { TrackerSnapshot } from "../../authorities/task-tracker/task.js"

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

export const TrackerGraphState = Schema.TaggedUnion({
  GraphEstablished: { snapshot: TrackerSnapshot },
  GraphNotEstablished: {}
})
export type TrackerGraphState = typeof TrackerGraphState.Type

const DeliveryFrontierTypeId: unique symbol = Symbol("DeliveryFrontier")

/** Graph-only delivery evidence; workflow responsibility and runtime ownership are excluded. */
export interface DeliveryFrontier {
  readonly [DeliveryFrontierTypeId]: typeof DeliveryFrontierTypeId
  readonly _tag: "DeliveryFrontier"
  readonly source: TrackerGraphState
}

/** The first structural projection; #181 supplies its exhaustive ticket standings. */
export const frontierOf = (graph: TrackerGraphState): DeliveryFrontier => ({
  [DeliveryFrontierTypeId]: DeliveryFrontierTypeId,
  _tag: "DeliveryFrontier",
  source: graph
})

const BoundedParallelTicketsTypeId: unique symbol = Symbol("BoundedParallelTickets")

/** Desired graph tickets under policy, not admitted work or held runtime positions. */
export interface BoundedParallelTickets {
  readonly [BoundedParallelTicketsTypeId]: typeof BoundedParallelTicketsTypeId
  readonly _tag: "BoundedParallelTickets"
  readonly source: DeliveryFrontier
  readonly taskIds: ReadonlyArray<TaskId>
}

/** Evidence that the executor reported a terminal result for one exact planned attempt. */
export const PlannedAttemptExecutorTerminalEvidence = Schema.TaggedStruct("PlannedAttemptExecutorTerminal", {
  report: PlannedAttemptExecutorReport.cases.Terminal
})
export type PlannedAttemptExecutorTerminalEvidence = typeof PlannedAttemptExecutorTerminalEvidence.Type

/** Current broad delivery knowledge for one ticket; it is never journal authority. */
export interface TicketDelivery {
  readonly _tag: "TicketDelivery"
  readonly evidence: ReadonlyArray<PlannedAttemptExecutorTerminalEvidence>
  readonly taskId: TaskId
}

const TicketDeliveriesTypeId: unique symbol = Symbol("TicketDeliveries")

/** Current ticket deliveries derived from desired tickets and exact lower obligations. */
export interface TicketDeliveries {
  readonly [TicketDeliveriesTypeId]: typeof TicketDeliveriesTypeId
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

const DeliveryReflectionTypeId: unique symbol = Symbol("DeliveryReflection")

/** Current tracker-reflection meaning projected only from established settlements. */
export interface DeliveryReflection {
  readonly [DeliveryReflectionTypeId]: typeof DeliveryReflectionTypeId
  readonly _tag: "DeliveryReflection"
  readonly source: DeliverySettlements
}

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

export interface InMemoryDeliveryRelationsInput {
  readonly graph: CurrentSignal<TrackerGraphState>
  readonly executorResponsibilities: (tickets: BoundedParallelTickets) => ReadonlyArray<TicketDelivery>
}

/** Deterministic, action-free Layers used to evaluate the complete relation spine. */
export const makeInMemoryDeliveryRelationsLayer = (input: InMemoryDeliveryRelationsInput) => {
  const noActions = currentSignalOf<ReadonlyArray<DeliveryActionProposal>>([])
  const trackerGraph = Layer.succeed(
    TrackerGraphRelation,
    TrackerGraphRelation.of({ proposedActions: noActions, signal: input.graph })
  )
  const bounded = Layer.succeed(
    BoundedParallelTicketsProjection,
    BoundedParallelTicketsProjection.of({
      of: (frontier) =>
        mapCurrentSignal(frontier, (source) => ({
          [BoundedParallelTicketsTypeId]: BoundedParallelTicketsTypeId,
          _tag: "BoundedParallelTickets",
          source,
          taskIds: []
        }))
    })
  )
  const deliveries = Layer.succeed(
    TicketDeliveryProjection,
    TicketDeliveryProjection.of({
      of: (tickets) => ({
        current: mapCurrentSignal(tickets, (source) => ({
          [TicketDeliveriesTypeId]: TicketDeliveriesTypeId,
          _tag: "TicketDeliveries",
          deliveries: input.executorResponsibilities(source),
          source
        })),
        proposedActions: noActions
      })
    })
  )
  const settlements = Layer.succeed(
    DeliverySettlementProjection,
    DeliverySettlementProjection.of({
      of: (relation) => ({
        current: mapCurrentSignal(relation.current, (source) => ({
          [DeliverySettlementsTypeId]: DeliverySettlementsTypeId,
          _tag: "DeliverySettlements",
          settlements: [],
          source
        })),
        proposedActions: noActions
      })
    })
  )
  const reflection = Layer.succeed(
    DeliveryReflectionProjection,
    DeliveryReflectionProjection.of({
      of: (relation) => ({
        current: mapCurrentSignal(relation.current, (source) => ({
          [DeliveryReflectionTypeId]: DeliveryReflectionTypeId,
          _tag: "DeliveryReflection",
          source
        })),
        proposedActions: noActions
      })
    })
  )

  return Layer.mergeAll(trackerGraph, bounded, deliveries, settlements, reflection)
}
