/* eslint-disable max-lines -- The flat delivery relation algebra, service colours, and composition vocabulary stay co-located for auditability. */
import {
  PlannedAttemptExecutorReport,
  type AttemptId,
  type PlannedAttemptExecutorCorrelation,
  type PlannedTaskAttempt,
  type TaskId,
  type TaskRevision
} from "@dalph/contracts"
import { Context, Effect, Schema, Stream } from "effect"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { TrackerRevision } from "../../authorities/task-tracker/task.js"
import type { RunControlPolicy } from "../../control/policy.js"
import type { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import type { OperationId } from "../../workflow/identity.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import type {
  QueuedIntegrationResponsibility,
  StartedIntegrationResponsibility,
  UnqueuedAcceptedResult
} from "../../workflow/protocols/integration-admission/protocol.js"
import type { IntegrationCandidateConstructionState } from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import type { IntegrationDeliveryWait } from "../frontier/integration-frontier.js"
import { RunFinalityDecision, type RunFinalityDecision as RunFinalityDecisionType } from "../frontier/run-finality.js"
import type { TaskWorkCapacity } from "../admission/capacity.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { DeliveryActionResult } from "./delivery-action-executor.js"
import type {
  DeliveryActionProposal,
  DeliveryProposalContributions,
  DeliveryProposalDerivationIssue,
  DeliveryProposalId,
  DeliveryProposalOwner,
  TrackerGraphActionProposal
} from "./delivery-proposal.js"

export type {
  DeliveryActionProposal,
  DeliveryAdmissionRequirements,
  DeliveryProposalId,
  DeliveryProposalOrderEvidence,
  DeliveryProposalOwner,
  TrackerGraphActionProposal
} from "./delivery-proposal.js"

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

/**
 * One accepted complete tracker read that is safe to use as the source of a
 * descriptive delivery value. The logical-read identity and journal position
 * remain part of the observation even when a later read has equal graph
 * contents.
 */
const AcceptedTrackerGraphObservationTypeId: unique symbol = Symbol("AcceptedTrackerGraphObservation")

export interface AcceptedTrackerGraphObservation {
  readonly [AcceptedTrackerGraphObservationTypeId]: typeof AcceptedTrackerGraphObservationTypeId
  readonly _tag: "AcceptedTrackerGraphObservation"
  readonly snapshot: TaskDagSnapshot
  readonly operationId: OperationId
  readonly contentIdentity: TrackerRevision
  readonly acceptedAt: JournalPosition
  readonly freshness: { readonly _tag: "ObservedDuringLogicalRead"; readonly operationId: OperationId }
}

/** Constructs accepted graph authority with content identity and freshness derived from one operation. */
export const makeAcceptedTrackerGraphObservation = (input: {
  readonly snapshot: TaskDagSnapshot
  readonly operationId: OperationId
  readonly acceptedAt: JournalPosition
}): AcceptedTrackerGraphObservation => ({
  [AcceptedTrackerGraphObservationTypeId]: AcceptedTrackerGraphObservationTypeId,
  _tag: "AcceptedTrackerGraphObservation",
  snapshot: input.snapshot,
  operationId: input.operationId,
  contentIdentity: input.snapshot.revision,
  acceptedAt: input.acceptedAt,
  freshness: { _tag: "ObservedDuringLogicalRead", operationId: input.operationId }
})

/** The current usable graph is either absent or already normalized and structurally validated. */
export type TrackerGraphState =
  | { readonly _tag: "GraphEstablished"; readonly observation: AcceptedTrackerGraphObservation }
  | { readonly _tag: "GraphNotEstablished" }

export const TrackerGraphState = {
  cases: {
    GraphEstablished: {
      make: (fields: { readonly observation: AcceptedTrackerGraphObservation }): TrackerGraphState => ({
        _tag: "GraphEstablished",
        observation: fields.observation
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
  /** The accepted graph, policy, and exact evidence published for this revision. */
  readonly publication: DeliveryGraphPublication
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
  /** The same accepted descriptive publication carried through bounded admission. */
  readonly publication: DeliveryGraphPublication
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

const DeliveryConsequencesTypeId: unique symbol = Symbol("DeliveryConsequences")

/**
 * One causally complete descriptive delivery value. Every projection is
 * derived from the same accepted tracker observation carried by `graph`.
 */
export interface DeliveryConsequences {
  readonly [DeliveryConsequencesTypeId]: typeof DeliveryConsequencesTypeId
  readonly _tag: "DeliveryConsequences"
  readonly graph: TrackerGraphState
  readonly frontier: DeliveryFrontier
  readonly tickets: BoundedParallelTickets
  readonly ticketDeliveries: TicketDeliveries
  readonly settlements: DeliverySettlements
  readonly trackerConsequences: DeliveryReflection
}

/** Rebuilds every explanatory field from the one reflection-owned source chain. */
export const makeDeliveryConsequences = (trackerConsequences: DeliveryReflection): DeliveryConsequences => {
  const settlements = trackerConsequences.source
  const ticketDeliveries = settlements.source
  const tickets = ticketDeliveries.source
  const frontier = tickets.source
  const graph = frontier.source
  return {
    [DeliveryConsequencesTypeId]: DeliveryConsequencesTypeId,
    _tag: "DeliveryConsequences",
    graph,
    frontier,
    tickets,
    ticketDeliveries,
    settlements,
    trackerConsequences
  }
}

export class TrackerGraphRelationError extends Schema.TaggedErrorClass<TrackerGraphRelationError>()(
  "TrackerGraphRelationError",
  { cause: Schema.Cause(Schema.Unknown, Schema.Unknown), summary: Schema.String }
) {}

/** Shared delivery reconciliation failed before one coherent relation revision could be published. */
export class DeliveryRelationReconciliationError extends Schema.TaggedErrorClass<DeliveryRelationReconciliationError>()(
  "DeliveryRelationReconciliationError",
  { cause: Schema.Cause(Schema.Unknown, Schema.Unknown) }
) {}

export type DeliveryRelationSourceError = TrackerGraphRelationError | DeliveryRelationReconciliationError

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
  readonly proposedActions: CurrentSignal<ReadonlyArray<TrackerGraphActionProposal>, DeliveryRelationSourceError>
  readonly signal: CurrentSignal<TrackerGraphState, DeliveryRelationSourceError>
}

/** Current accepted tracker-graph relation supplied to the flat delivery composition. */
export class TrackerGraphRelation extends Context.Service<TrackerGraphRelation, TrackerGraphRelationService>()(
  "@dalph/TrackerGraphRelation"
) {}

/** Accepted graph, policy, and exact evidence published as one descriptive delivery revision. */
export interface DeliveryPublicationService {
  readonly signal: CurrentSignal<DeliveryGraphPublication, DeliveryRelationSourceError>
}

export class DeliveryPublication extends Context.Service<DeliveryPublication, DeliveryPublicationService>()(
  "@dalph/DeliveryPublication"
) {}

export interface TicketDeliveryRelation<E = TicketDeliveryError> {
  /** Current broad lifecycle derived from desired tickets and exact lower obligations. */
  readonly current: CurrentSignal<TicketDeliveries, E>
  /** Pure exact next actions; observing them acquires no position and performs no request. */
  readonly proposedActions: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, E>
  /** One coherent derivation supplies both ticket and settlement-owned proposal partitions. */
  readonly proposalContributions: CurrentSignal<DeliveryProposalContributions, E>
  /** The checked desired-ticket relation from which this lifecycle was reconciled. */
  readonly source: CurrentSignal<BoundedParallelTickets, E>
}

export interface DeliverySettlementRelation<E = DeliverySettlementError> {
  /** Current established settlement facts; executor Terminal alone cannot enter this value. */
  readonly current: CurrentSignal<DeliverySettlements, E>
  /** Pure integration/disposition actions that may eventually establish settlement. */
  readonly proposedActions: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, E>
  /** The unchanged coherent partitions inherited from ticket reconciliation. */
  readonly proposalContributions: CurrentSignal<DeliveryProposalContributions, E>
  /** The complete ticket-delivery relation retained for later composition. */
  readonly source: TicketDeliveryRelation<E>
}

export interface DeliveryReflectionRelation<E = DeliveryReflectionError> {
  /** Current reflection meaning derived only from established settlements. */
  readonly current: CurrentSignal<DeliveryReflection, E>
  /** Pure tracker-reflection actions; the current empty settlement set produces none. */
  readonly proposedActions: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, E>
  /** The settlement relation from which tracker reflection was projected. */
  readonly source: DeliverySettlementRelation<E>
}

/** Two lower relations claimed ownership of the same exact proposed action. */
export interface DeliveryProposalOwnershipConflict {
  readonly id: DeliveryProposalId
  readonly owners: readonly [DeliveryProposalOwner, DeliveryProposalOwner, ...ReadonlyArray<DeliveryProposalOwner>]
}

/** The immutable proposal frontier either authorizes its order or fails closed as a value. */
export type DeliveryProposalFrontier =
  | {
      readonly _tag: "DeliveryProposalsAvailable"
      readonly isolatedIssues: ReadonlyArray<DeliveryProposalDerivationIssue>
      readonly proposals: ReadonlyArray<DeliveryActionProposal>
    }
  | {
      readonly _tag: "DeliveryProposalOwnershipConflict"
      readonly conflicts: readonly [
        DeliveryProposalOwnershipConflict,
        ...ReadonlyArray<DeliveryProposalOwnershipConflict>
      ]
    }

/** One coherent current value assembled from every relation visible in the flat Effect. */
export interface DeliveryRuntimeSnapshot {
  readonly _tag: "DeliveryRuntimeSnapshot"
  readonly reflection: DeliveryReflection
  readonly settlements: DeliverySettlements
  readonly ticketDeliveries: TicketDeliveries
  readonly trackerGraph: TrackerGraphState
}

/** Exact process-local admission facts reconstructed below the descriptive relation. */
export interface DeliveryTaskWorkAdmissionBasis {
  readonly capacity: TaskWorkCapacity
  readonly held: ReadonlyArray<{ readonly correlation: PlannedAttemptExecutorCorrelation; readonly taskId: TaskId }>
}

/** Whether an empty relation may ask for one final graph read or must remain passive. */
export type DeliveryQuiescenceDisposition =
  | { readonly _tag: "QuiescenceProbeAllowed" }
  | { readonly _tag: "QuiescencePassive"; readonly reason: "ProbeNotRequired" | "RunPaused" }

/** Monotonic process-local version of one fully reconciled delivery relation value. */
export const DeliveryRelationRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("DeliveryRelationRevision")
)
export type DeliveryRelationRevision = typeof DeliveryRelationRevision.Type

/** Runtime facts are descriptive inputs; the runtime never reconstructs them from route tags. */
export interface DeliveryRuntimeFacts {
  readonly acceptedAt: JournalPosition | null
  readonly quiescence: DeliveryQuiescenceDisposition
  readonly revision: DeliveryRelationRevision
  readonly taskWork: DeliveryTaskWorkAdmissionBasis
}

/** Current descriptive inputs published together for one delivery revision. */
export interface DeliveryGraphPublication {
  /** Exact accepted workflow and executor observations retained by ticket projection. */
  readonly exactEvidence: ReadonlyArray<TicketDeliveryEvidence>
  /** Accepted tracker graph used to construct the graph frontier. */
  readonly graph: TrackerGraphState
  /** Run policy used to bound eligible graph tickets. */
  readonly policy: RunControlPolicy
}

/** Legacy action planning and runtime facts kept outside the descriptive chain. */
export interface DeliveryLegacyInputs {
  readonly proposalContributions: DeliveryProposalContributions
  readonly reflectionProposals: ReadonlyArray<DeliveryActionProposal>
  readonly runtimeFacts: DeliveryRuntimeFacts
  readonly trackerGraphProposals: ReadonlyArray<TrackerGraphActionProposal>
}

/** One current-first bundle containing the descriptive publication and compatibility inputs. */
export interface DeliveryRelationInputBundle {
  readonly legacy: DeliveryLegacyInputs
  readonly publication: DeliveryGraphPublication
}

/** One coherent value consumed by the runtime action owner. */
export interface DeliveryRuntimeEvaluation {
  readonly _tag: "DeliveryRuntimeEvaluation"
  readonly acceptedAt: JournalPosition | null
  readonly current: DeliveryRuntimeSnapshot
  readonly finality: RunFinalityDecisionType
  readonly proposedActions: DeliveryProposalFrontier
  readonly quiescence: DeliveryQuiescenceDisposition
  readonly revision: DeliveryRelationRevision
  readonly taskWork: DeliveryTaskWorkAdmissionBasis
}

/** Process-local reason for the runtime to request a fresh evaluation of descriptive relations. */
export type DeliveryInvalidation =
  | { readonly _tag: "AcceptedFactsChanged" }
  | {
      readonly _tag: "ProposalCompleted"
      readonly proposalId: DeliveryProposalId
      readonly result: DeliveryActionResult | null
    }
  | { readonly _tag: "QuiescenceProbeRequested" }

export interface DeliveryRuntimeRelation<E = DeliveryReflectionError> {
  readonly current: CurrentSignal<DeliveryRuntimeSnapshot, E>
  readonly evaluations: CurrentSignal<DeliveryRuntimeEvaluation, E>
  readonly invalidate: (cause: DeliveryInvalidation) => Effect.Effect<DeliveryRelationRevision>
  readonly proposedActions: CurrentSignal<DeliveryProposalFrontier, E>
}

const trackerTargetIsSettled = (graph: TrackerGraphState): boolean =>
  graph._tag === "GraphEstablished" &&
  graph.observation.snapshot.toWire().tasks.every(({ lifecycle }) => lifecycle._tag === "CompletedSuccessfully")

const standingIsUnsettled = (standing: TicketDeliveryStanding): boolean => {
  if (standing._tag === "ResponsibilitySituation") {
    return ![
      "FinalOutcome",
      "PlannedAttemptExecutorWorkTerminal",
      "Relinquished",
      "Settled",
      "TaskExternalSuccessSettled"
    ].includes(standing.facts.disposition._tag)
  }
  return (
    standing._tag !== "SyntheticExecutorSituation" ||
    standing.report._tag !== "Terminal" ||
    standing.report.result._tag === "Accepted"
  )
}

/** Derives finality from the relation's own lifecycle facts, never from the legacy runnable frontier. */
export const deliveryFinalityOf = (
  current: DeliveryRuntimeSnapshot,
  proposedActions: DeliveryProposalFrontier,
  quiescence: DeliveryQuiescenceDisposition
): RunFinalityDecisionType => {
  if (quiescence._tag === "QuiescencePassive" && quiescence.reason === "RunPaused") {
    return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
  }
  if (proposedActions._tag === "DeliveryProposalOwnershipConflict") {
    return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
  }
  if (proposedActions.proposals.length > 0) {
    return RunFinalityDecision.RunMustRemainActive({ reason: "RunnableTransition" })
  }
  if (
    proposedActions.isolatedIssues.length > 0 ||
    current.ticketDeliveries.deliveries.some(
      ({ obligations, standings }) => obligations.length > 0 || standings.some(standingIsUnsettled)
    )
  )
    return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
  return trackerTargetIsSettled(current.trackerGraph)
    ? RunFinalityDecision.RunMayTerminate()
    : RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
}

const proposalOrdinal = (proposal: DeliveryActionProposal): number =>
  proposal.order._tag === "TrackerGraphOrder" ? Number.MAX_SAFE_INTEGER : proposal.order.frontierOrdinal

const trackerProposalsFor = (
  graph: TrackerGraphState,
  proposals: ReadonlyArray<TrackerGraphActionProposal>
): ReadonlyArray<TrackerGraphActionProposal> =>
  proposals.filter(({ route }) =>
    graph._tag === "GraphNotEstablished"
      ? route.purpose === "EstablishCurrentGraph"
      : route.purpose === "QuiescenceProbe"
  )

/** Combines lower owners without consulting live positions or silently deduplicating identities. */
export const deliveryProposalFrontierOf = (
  contributions: ReadonlyArray<ReadonlyArray<DeliveryActionProposal>>,
  issues: ReadonlyArray<DeliveryProposalDerivationIssue> = []
): DeliveryProposalFrontier => {
  const proposals = contributions.flat().toSorted((left, right) => {
    const byOrdinal = proposalOrdinal(left) - proposalOrdinal(right)
    return byOrdinal !== 0 ? byOrdinal : left.id.localeCompare(right.id)
  })
  const firstById = new Map<DeliveryProposalId, DeliveryActionProposal>()
  const conflictsById = new Map<DeliveryProposalId, DeliveryProposalOwnershipConflict>()
  for (const proposal of proposals) {
    const first = firstById.get(proposal.id)
    if (first === undefined) {
      firstById.set(proposal.id, proposal)
      continue
    }
    const conflict = conflictsById.get(proposal.id)
    conflictsById.set(
      proposal.id,
      conflict === undefined
        ? { id: proposal.id, owners: [first.owner, proposal.owner] }
        : { id: proposal.id, owners: [...conflict.owners, proposal.owner] }
    )
  }
  const conflicts = [...conflictsById.values()]
  const [firstConflict, ...remainingConflicts] = conflicts
  return firstConflict === undefined
    ? { _tag: "DeliveryProposalsAvailable", isolatedIssues: issues, proposals }
    : { _tag: "DeliveryProposalOwnershipConflict", conflicts: [firstConflict, ...remainingConflicts] }
}

/** Assembles the final descriptive value and pure proposal frontier returned by the flat Effect. */
export const makeDeliveryRuntimeRelation = <E>(input: {
  /** Canonical descriptive current; runtime snapshots never reconstruct it from action-plan inputs. */
  readonly delivery: CurrentSignal<DeliveryConsequences, E>
  readonly facts: CurrentSignal<DeliveryRuntimeFacts, E>
  readonly trackerGraph: TrackerGraphRelationService
  /** Legacy action-plan contributions retained outside the descriptive delivery relation. */
  readonly proposalContributions: CurrentSignal<DeliveryProposalContributions, E>
  readonly reflectionProposals: CurrentSignal<ReadonlyArray<DeliveryActionProposal>, E>
  readonly invalidate: DeliveryRuntimeRelation<E>["invalidate"]
}): DeliveryRuntimeRelation<E | DeliveryRelationSourceError> => {
  const snapshot = mapCurrentSignal(input.delivery, (delivery) => ({
    _tag: "DeliveryRuntimeSnapshot" as const,
    reflection: delivery.trackerConsequences,
    settlements: delivery.settlements,
    ticketDeliveries: delivery.ticketDeliveries,
    trackerGraph: delivery.graph
  }))
  const contributions = zipCurrentSignals(
    snapshot,
    zipCurrentSignals(
      input.trackerGraph.proposedActions,
      zipCurrentSignals(input.proposalContributions, input.reflectionProposals)
    )
  )
  const proposedActions = mapCurrentSignal(contributions, ([current, [tracker, [lowerContributions, reflection]]]) => {
    const lower = [lowerContributions.ticketDelivery, lowerContributions.deliverySettlement, reflection]
    const trackerProposals = trackerProposalsFor(current.trackerGraph, tracker)
    return deliveryProposalFrontierOf([trackerProposals, ...lower], lowerContributions.issues)
  })
  const evaluations = mapCurrentSignal(
    zipCurrentSignals(zipCurrentSignals(snapshot, proposedActions), input.facts),
    ([[current, frontier], facts]): DeliveryRuntimeEvaluation => ({
      _tag: "DeliveryRuntimeEvaluation",
      acceptedAt: facts.acceptedAt,
      current,
      finality: deliveryFinalityOf(current, frontier, facts.quiescence),
      proposedActions: frontier,
      quiescence: facts.quiescence,
      revision: facts.revision,
      taskWork: facts.taskWork
    })
  )
  return { current: snapshot, evaluations, invalidate: input.invalidate, proposedActions }
}

export interface BoundedParallelTicketsProjectionService {
  readonly of: <E>(
    frontier: CurrentSignal<DeliveryFrontier, E>
  ) => CurrentSignal<BoundedParallelTickets, E | DeliveryRelationSourceError>
}

export class BoundedParallelTicketsProjection extends Context.Service<
  BoundedParallelTicketsProjection,
  BoundedParallelTicketsProjectionService
>()("@dalph/BoundedParallelTicketsProjection") {}

export interface TicketDeliveryProjectionService {
  readonly of: <E>(
    tickets: CurrentSignal<BoundedParallelTickets, E>
  ) => TicketDeliveryRelation<E | TicketDeliveryError | DeliveryRelationSourceError>
}

export class TicketDeliveryProjection extends Context.Service<
  TicketDeliveryProjection,
  TicketDeliveryProjectionService
>()("@dalph/TicketDeliveryProjection") {}

export interface DeliverySettlementProjectionService {
  readonly of: <E>(
    deliveries: TicketDeliveryRelation<E>
  ) => DeliverySettlementRelation<E | DeliverySettlementError | DeliveryRelationSourceError>
}

export class DeliverySettlementProjection extends Context.Service<
  DeliverySettlementProjection,
  DeliverySettlementProjectionService
>()("@dalph/DeliverySettlementProjection") {}

export interface DeliveryReflectionProjectionService {
  readonly of: <E>(
    settlements: DeliverySettlementRelation<E>
  ) => DeliveryReflectionRelation<E | DeliveryReflectionError | DeliveryRelationSourceError>
}

export class DeliveryReflectionProjection extends Context.Service<
  DeliveryReflectionProjection,
  DeliveryReflectionProjectionService
>()("@dalph/DeliveryReflectionProjection") {}

export interface DeliveryRuntimeAssemblyService {
  readonly of: <E>(input: {
    readonly delivery: CurrentSignal<DeliveryConsequences, E>
    readonly trackerGraph: TrackerGraphRelationService
  }) => DeliveryRuntimeRelation<E | DeliveryRelationSourceError>
}

export class DeliveryRuntimeAssembly extends Context.Service<DeliveryRuntimeAssembly, DeliveryRuntimeAssemblyService>()(
  "@dalph/DeliveryRuntimeAssembly"
) {}

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

/** Projects established settlements into one coherent current-first value. */
export const reflectDeliverySettlements = Effect.fn("Delivery.reflectDeliverySettlements")(function* <E>(
  settlements: DeliverySettlementRelation<E>
): Effect.fn.Return<
  CurrentSignal<DeliveryConsequences, E | DeliveryReflectionError | DeliveryRelationSourceError>,
  never,
  DeliveryReflectionProjection
> {
  const projection = yield* DeliveryReflectionProjection
  const reflection = projection.of(settlements)
  return { changes: reflection.current.changes.pipe(Stream.map(makeDeliveryConsequences)) }
})
