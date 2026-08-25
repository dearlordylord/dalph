/* eslint-disable functional/immutable-data -- local projection scratch state never escapes the read. */
import {
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorCorrelation,
  type TaskId
} from "@dalph/contracts"
import { Match, Schema } from "effect"
import type {
  DeliveryActionProposal,
  DeliveryProposalDerivationIssue,
  DeliveryProposalOrdinal,
  DeliveryProposalOrderEvidence
} from "./delivery-action-proposal.js"
import type {
  BoundedTicketRank,
  DeliveryRuntimeEvaluation,
  ExactWorkflowObligation,
  TicketDelivery,
  TicketDeliveryStanding
} from "./relations.js"
import { type DeliveryStatusEntry, type DeliveryStatusSubject } from "./delivery-status-model.js"
import { workflowResponsibilityKey, type WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"

type IdentityPart = string | number

/** Non-negative position of a task in the accepted delivery order. */
const DeliveryTaskPosition = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("DeliveryTaskPosition")
)
type DeliveryTaskPosition = typeof DeliveryTaskPosition.Type

export type StatusTaskOrder =
  | { readonly _tag: "RunWideTaskOrder" }
  | { readonly _tag: "TaskOrder"; readonly position: DeliveryTaskPosition }

export type StatusTaskOrderLookup = StatusTaskOrder | { readonly _tag: "MissingTaskOrder"; readonly taskId: TaskId }

export const runWideTaskOrder: StatusTaskOrder = { _tag: "RunWideTaskOrder" }

export const deliveryTaskPositionAt = (index: number): DeliveryTaskPosition => DeliveryTaskPosition.make(index)

export const taskOrderAt = (position: DeliveryTaskPosition): StatusTaskOrder => ({ _tag: "TaskOrder", position })

/** Injective identity encoding: every typed component carries its own length. */
export const canonicalIdentity = (parts: ReadonlyArray<IdentityPart>): string =>
  parts
    .map((part) => {
      const value =
        typeof part === "number" ? (Object.is(part, -0) ? "-0" : Number.isNaN(part) ? "NaN" : String(part)) : part
      return `${typeof part === "number" ? "n" : "s"}${value.length}:${value}`
    })
    .join("")

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)])
    )
  }
  return value
}

/** Stable structural encoding for values built from the same exact evidence. */
export const canonicalEncodingOf = (value: unknown): string => JSON.stringify(canonicalValue(value))

const subjectKey = (subject: DeliveryStatusSubject): string =>
  subject._tag === "Run"
    ? canonicalIdentity(["Run", subject.runId])
    : canonicalIdentity(["Task", subject.runId, subject.taskId])

const obligationIdentity = (obligation: ExactWorkflowObligation): string => {
  if (obligation._tag === "WorkflowResponsibility")
    return canonicalIdentity(["workflow", workflowResponsibilityKey(obligation.responsibility)])
  if (obligation._tag === "AcceptedAwaitingIntegration") {
    return canonicalIdentity([
      "attempt",
      plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(obligation.accepted.plannedAttempt))
    ])
  }
  if (obligation._tag === "QueuedIntegration") {
    return canonicalIdentity([
      "queued",
      obligation.responsibility.queuedAt,
      plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(obligation.responsibility.plannedAttempt))
    ])
  }
  return canonicalIdentity([
    "started",
    obligation.responsibility.startedAt,
    plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(obligation.responsibility.plannedAttempt))
  ])
}

const evidenceIdentityForObligation = (obligation: ExactWorkflowObligation): string => {
  if (obligation._tag === "WorkflowResponsibility")
    return `workflow:${workflowResponsibilityKey(obligation.responsibility)}`
  const plannedAttempt =
    obligation._tag === "AcceptedAwaitingIntegration"
      ? obligation.accepted.plannedAttempt
      : obligation.responsibility.plannedAttempt
  return canonicalEncodingOf([
    "integration",
    plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(plannedAttempt))
  ])
}

/** Finds an exact responsibility only when one of the conflicting source identities names it. */
export const obligationForEvidenceConflict = (
  delivery: TicketDelivery,
  standing: Extract<TicketDeliveryStanding, { readonly _tag: "ExactEvidenceConflict" }>
): ExactWorkflowObligation | null => {
  const identities = new Set(standing.evidenceIdentities)
  const matches = delivery.obligations.filter((obligation) => identities.has(evidenceIdentityForObligation(obligation)))
  const first = matches[0]
  if (first === undefined) return null
  const identity = obligationIdentity(first)
  return matches.every((candidate) => obligationIdentity(candidate) === identity) ? first : null
}

const proposalDerivationIssueIdentity = (issue: DeliveryProposalDerivationIssue): string =>
  issue._tag === "AcceptedOperationEvidenceMissing"
    ? canonicalIdentity([issue._tag, issue.operationId, issue.taskId, issue.transition])
    : canonicalIdentity([issue._tag, issue.taskId, issue.transition])

const statusEntryPrefix = (entry: DeliveryStatusEntry): string =>
  canonicalIdentity([entry._tag, subjectKey(entry.subject)])

/** Internal category/ranking value used only while comparing status entries. */
const StatusComparisonRank = Schema.Int.pipe(Schema.brand("StatusComparisonRank"))
type StatusComparisonRank = typeof StatusComparisonRank.Type

const comparisonRank = (value: number): StatusComparisonRank => StatusComparisonRank.make(value)

type StructuralOrderValue =
  | BoundedTicketRank
  | DeliveryProposalOrdinal
  | DeliveryTaskPosition
  | JournalPosition
  | StatusComparisonRank

type StructuralOrderPosition =
  | { readonly _tag: "OrderPosition"; readonly value: StructuralOrderValue }
  | { readonly _tag: "MissingOrderPosition" }

type StructuralOrderToken = StructuralOrderValue | string | StructuralOrderPosition

const orderPosition = (value: StructuralOrderValue): StructuralOrderPosition => ({ _tag: "OrderPosition", value })
const missingOrderPosition: StructuralOrderPosition = { _tag: "MissingOrderPosition" }

const optionalJournalPosition = (value: JournalPosition | null | undefined): StructuralOrderPosition =>
  value === null || value === undefined ? missingOrderPosition : orderPosition(value)

const responsibilityPosition = (responsibility: WorkflowResponsibilityEntry): JournalPosition => responsibility.beganAt

const obligationPosition = (obligation: ExactWorkflowObligation): JournalPosition => {
  if (obligation._tag === "WorkflowResponsibility") return responsibilityPosition(obligation.responsibility)
  if (obligation._tag === "AcceptedAwaitingIntegration") return obligation.accepted.terminalAt
  if (obligation._tag === "QueuedIntegration") return obligation.responsibility.queuedAt
  return obligation.responsibility.startedAt
}

const dependencyEntryPosition = (
  standing: Extract<DeliveryStatusEntry, { readonly _tag: "DependencyWait" }>["standing"]
): StructuralOrderPosition =>
  standing._tag === "ResponsibilitySituation"
    ? orderPosition(standing.facts.responsibility.beganAt)
    : missingOrderPosition

const optionalObligationPosition = (obligation: ExactWorkflowObligation | null): StructuralOrderPosition =>
  obligation === null ? missingOrderPosition : orderPosition(obligationPosition(obligation))

type NonActionStatusEntry = Exclude<
  DeliveryStatusEntry,
  { readonly _tag: "ProposedDeliveryAction" | "LiveDeliveryAction" | "AcceptedFactPublicationWait" }
>

const statusEntryPosition = Match.typeTags<NonActionStatusEntry, StructuralOrderPosition>()({
  DependencyWait: (entry) => dependencyEntryPosition(entry.standing),
  TrackerFactWait: (entry) => optionalObligationPosition(entry.responsibility),
  TaskWorkCapacityWait: (entry) => orderPosition(entry.placement.rank),
  IntegrationTargetWait: (entry) => orderPosition(obligationPosition(entry.responsibility)),
  EvidenceUnavailable: (entry) => optionalObligationPosition(entry.responsibility),
  EvidenceConflict: (entry) => optionalObligationPosition(entry.responsibility),
  Settlement: () => missingOrderPosition,
  Relinquishment: (entry) => orderPosition(entry.responsibility.responsibility.beganAt)
})

const dependencyStandingIdentity = (
  standing: Extract<DeliveryStatusEntry, { readonly _tag: "DependencyWait" }>["standing"]
): string => {
  if (standing._tag === "GraphExcluded")
    return canonicalIdentity(["graph", ...standing.reasons.map(({ _tag }) => _tag)])
  if (standing._tag === "PromotedPrerequisiteReleasePending") {
    return canonicalIdentity(["promoted", ...standing.prerequisiteTaskIds])
  }
  if (standing._tag === "IntegrationWait") {
    return canonicalIdentity([
      "integration",
      standing.wait._tag,
      plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(standing.wait.plannedAttempt))
    ])
  }
  return canonicalIdentity(["responsibility", workflowResponsibilityKey(standing.facts.responsibility)])
}

const statusEntryIdentityFor = Match.typeTags<DeliveryStatusEntry, string>()({
  DependencyWait: (entry) =>
    canonicalIdentity([
      statusEntryPrefix(entry),
      entry.taskId,
      ...entry.prerequisiteTaskIds,
      dependencyStandingIdentity(entry.standing)
    ]),
  TrackerFactWait: (entry) =>
    canonicalIdentity([
      statusEntryPrefix(entry),
      entry.responsibility === null ? "subject" : obligationIdentity(entry.responsibility),
      entry.fact._tag
    ]),
  TaskWorkCapacityWait: (entry) => canonicalIdentity([statusEntryPrefix(entry), entry.taskId]),
  ProposedDeliveryAction: (entry) => canonicalIdentity([statusEntryPrefix(entry), entry.proposal.id]),
  LiveDeliveryAction: (entry) => canonicalIdentity([statusEntryPrefix(entry), entry.owner.proposal.id]),
  AcceptedFactPublicationWait: (entry) => canonicalIdentity([statusEntryPrefix(entry), entry.owner.proposal.id]),
  IntegrationTargetWait: (entry) =>
    canonicalIdentity([
      statusEntryPrefix(entry),
      plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(entry.plannedAttempt)),
      entry.wait._tag
    ]),
  EvidenceUnavailable: (entry) =>
    canonicalIdentity([
      statusEntryPrefix(entry),
      entry.evidence._tag,
      entry.evidence._tag === "ProposalDerivationIssue"
        ? proposalDerivationIssueIdentity(entry.evidence.issue)
        : entry.evidence._tag === "ResponsibilityFacts"
          ? entry.responsibility === null
            ? "subject"
            : obligationIdentity(entry.responsibility)
          : canonicalIdentity([
              entry.evidence.wait._tag,
              plannedAttemptExecutorCorrelationKey(
                plannedAttemptExecutorCorrelation(entry.evidence.wait.plannedAttempt)
              )
            ])
    ]),
  EvidenceConflict: (entry) => canonicalIdentity([statusEntryPrefix(entry), ...entry.evidenceIdentities]),
  Settlement: (entry) => canonicalIdentity([statusEntryPrefix(entry), entry.attemptId]),
  Relinquishment: (entry) =>
    canonicalIdentity([statusEntryPrefix(entry), workflowResponsibilityKey(entry.responsibility.responsibility)])
})

export const statusEntryIdentity = statusEntryIdentityFor

export const statusEntryJson: (entry: DeliveryStatusEntry) => string = canonicalEncodingOf

export interface OrderedStatusEntry {
  readonly entry: DeliveryStatusEntry
  readonly taskOrder: StatusTaskOrder
  readonly phenomenonOrder: StatusComparisonRank
  readonly structuralOrder: ReadonlyArray<StructuralOrderToken>
}

const freshOrderKind = comparisonRank(0)
const recoveredOrderKind = comparisonRank(1)
const integrationOrderKindValue = 2
const unqueuedAcceptedOrderKindValue = 3
const trackerGraphOrderKindValue = 4
const integrationOrderKind = comparisonRank(integrationOrderKindValue)
const unqueuedAcceptedOrderKind = comparisonRank(unqueuedAcceptedOrderKindValue)
const trackerGraphOrderKind = comparisonRank(trackerGraphOrderKindValue)

/** The accepted structural tie-breakers do not depend on provider-array order. */
const proposalOrderStructuralOrder = (order: DeliveryProposalOrderEvidence): ReadonlyArray<StructuralOrderToken> => {
  return Match.valueTags(order, {
    FreshWorkflowOrder: ({ frontierOrdinal, step, taskId }) => [freshOrderKind, frontierOrdinal, step, taskId],
    RecoveredWorkflowOrder: ({ acceptedAt, frontierOrdinal, responsibilityBeganAt, taskId, transition }) => [
      recoveredOrderKind,
      optionalJournalPosition(acceptedAt),
      optionalJournalPosition(responsibilityBeganAt),
      frontierOrdinal,
      taskId,
      transition
    ],
    IntegrationOrder: ({ frontierOrdinal, queuedAt, startedAt, taskId }) => [
      integrationOrderKind,
      queuedAt,
      optionalJournalPosition(startedAt),
      frontierOrdinal,
      taskId
    ],
    UnqueuedAcceptedResultOrder: ({ frontierOrdinal, taskId, terminalAt }) => [
      unqueuedAcceptedOrderKind,
      terminalAt,
      frontierOrdinal,
      taskId
    ],
    TrackerGraphOrder: ({ acceptedAt }) => [trackerGraphOrderKind, optionalJournalPosition(acceptedAt)]
  })
}

const proposalRouteTieBreaker = (proposal: DeliveryActionProposal): string =>
  Match.valueTags(proposal.route, {
    FreshWorkflowRoute: ({ step }) => `fresh:${step._tag}`,
    RecoveredNewActionRoute: ({ action }) => `recovered:${action._tag}`,
    TrackerGraphReadRoute: ({ purpose }) => `tracker:${purpose}`,
    FreshExecutorWorkflowRoute: ({ step }) => `executor:${step._tag}`,
    IdentityFreeWorkflowRoute: ({ transition }) => `identity-free:${transition._tag}`,
    AcceptedWorkflowRoute: ({ transition }) =>
      "operationId" in transition
        ? `accepted:${transition._tag}:${transition.operationId}`
        : `accepted:${transition._tag}`
  })

const proposalActionIdentityTieBreaker = (proposal: DeliveryActionProposal): string =>
  Match.valueTags(proposal.actionIdentity, {
    FreshOperationAndAttemptIdsRequired: () => "fresh-attempt",
    FreshOperationIdRequired: ({ source }) =>
      Match.valueTags(source, {
        Allocate: () => "fresh-operation:allocate",
        ExternalSuccessReleaseClaim: ({ claimOperationId }) => `fresh-operation:external:${claimOperationId}`,
        TaskClaimReacquisitionRequest: ({ requestId }) => `fresh-operation:reacquisition:${requestId}`
      }),
    ExistingOperationId: () => "existing-operation",
    NoWorkflowOperationIdentity: () => "identity-free"
  })

const proposalOperationTieBreaker = (proposal: DeliveryActionProposal): string =>
  `${proposalActionIdentityTieBreaker(proposal)}:${proposalRouteTieBreaker(proposal)}`

const proposalCorrelationTieBreaker = (proposal: DeliveryActionProposal): string =>
  Match.valueTags(proposal.admission.plannedAttemptProtocol, {
    NoPlannedAttemptProtocol: () => "no-planned-attempt-protocol",
    PlannedAttemptProtocolRequired: ({ correlation }) =>
      `planned-attempt-protocol:${plannedAttemptExecutorCorrelationKey(correlation)}`
  })

const statusEntryStructuralOrder = (entry: DeliveryStatusEntry): ReadonlyArray<StructuralOrderToken> => {
  if (
    entry._tag === "ProposedDeliveryAction" ||
    entry._tag === "LiveDeliveryAction" ||
    entry._tag === "AcceptedFactPublicationWait"
  ) {
    const proposal = entry._tag === "ProposedDeliveryAction" ? entry.proposal : entry.owner.proposal
    return [
      ...proposalOrderStructuralOrder(proposal.order),
      proposalOperationTieBreaker(proposal),
      proposalCorrelationTieBreaker(proposal),
      proposal.id
    ]
  }
  return [statusEntryPosition(entry), statusEntryIdentity(entry)]
}

const trackerFactPhenomenonOrderValue = 2
const taskWorkCapacityPhenomenonOrderValue = 3
const proposedActionPhenomenonOrderValue = 4
const liveActionPhenomenonOrderValue = 5
const publicationWaitPhenomenonOrderValue = 6
const integrationTargetPhenomenonOrderValue = 7
const unavailableEvidencePhenomenonOrderValue = 8
const evidenceConflictPhenomenonOrderValue = 9
const settlementPhenomenonOrderValue = 10
const relinquishmentPhenomenonOrderValue = 11
const phenomenonOrder: Readonly<Record<DeliveryStatusEntry["_tag"], StatusComparisonRank>> = {
  DependencyWait: comparisonRank(1),
  TrackerFactWait: comparisonRank(trackerFactPhenomenonOrderValue),
  TaskWorkCapacityWait: comparisonRank(taskWorkCapacityPhenomenonOrderValue),
  ProposedDeliveryAction: comparisonRank(proposedActionPhenomenonOrderValue),
  LiveDeliveryAction: comparisonRank(liveActionPhenomenonOrderValue),
  AcceptedFactPublicationWait: comparisonRank(publicationWaitPhenomenonOrderValue),
  IntegrationTargetWait: comparisonRank(integrationTargetPhenomenonOrderValue),
  EvidenceUnavailable: comparisonRank(unavailableEvidencePhenomenonOrderValue),
  EvidenceConflict: comparisonRank(evidenceConflictPhenomenonOrderValue),
  Settlement: comparisonRank(settlementPhenomenonOrderValue),
  Relinquishment: comparisonRank(relinquishmentPhenomenonOrderValue)
}

const structuralOrderBeforeValue = -1
const structuralOrderBefore = comparisonRank(structuralOrderBeforeValue)
const structuralOrderAfter = comparisonRank(1)

const compareOrderPosition = (left: StructuralOrderPosition, right: StructuralOrderPosition): number => {
  if (left._tag === "MissingOrderPosition" && right._tag === "MissingOrderPosition") return 0
  if (left._tag === "MissingOrderPosition") return structuralOrderBefore
  if (right._tag === "MissingOrderPosition") return structuralOrderAfter
  return left.value - right.value
}

const isStructuralOrderPosition = (value: StructuralOrderToken): value is StructuralOrderPosition =>
  typeof value === "object"

type PrimitiveStructuralToken = StructuralOrderValue | string

const comparePrimitiveStructuralToken = (left: PrimitiveStructuralToken, right: PrimitiveStructuralToken): number => {
  if (typeof left === "number" && typeof right === "number") return left - right
  if (typeof left === "number") return structuralOrderBefore
  if (typeof right === "number") return structuralOrderAfter
  if (typeof left === "string" && typeof right === "string") return left.localeCompare(right)
  if (typeof left === "string") return structuralOrderBefore
  return structuralOrderAfter
}

const compareStructuralToken = (left: StructuralOrderToken, right: StructuralOrderToken): number => {
  if (isStructuralOrderPosition(left)) {
    return isStructuralOrderPosition(right) ? compareOrderPosition(left, right) : structuralOrderAfter
  }
  if (isStructuralOrderPosition(right)) return structuralOrderBefore
  return comparePrimitiveStructuralToken(left, right)
}

const compareStructuralOrder = (
  left: ReadonlyArray<StructuralOrderToken>,
  right: ReadonlyArray<StructuralOrderToken>
): number => {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftToken = left[index]
    const rightToken = right[index]
    if (leftToken === undefined) return structuralOrderBefore
    if (rightToken === undefined) return structuralOrderAfter
    const compared = compareStructuralToken(leftToken, rightToken)
    if (compared !== 0) return compared
  }
  return 0
}

const compareTaskOrder = (left: StatusTaskOrder, right: StatusTaskOrder): number => {
  if (left._tag === "RunWideTaskOrder" && right._tag === "RunWideTaskOrder") return 0
  if (left._tag === "RunWideTaskOrder") return structuralOrderBefore
  if (right._tag === "RunWideTaskOrder") return structuralOrderAfter
  return left.position - right.position
}

export const compareOrderedEntries = (left: OrderedStatusEntry, right: OrderedStatusEntry): number => {
  const taskOrder = compareTaskOrder(left.taskOrder, right.taskOrder)
  if (taskOrder !== 0) return taskOrder
  const phenomenon = left.phenomenonOrder - right.phenomenonOrder
  return phenomenon !== 0 ? phenomenon : compareStructuralOrder(left.structuralOrder, right.structuralOrder)
}

export const deliveryTaskOrder = (evaluation: DeliveryRuntimeEvaluation): ReadonlyMap<TaskId, StatusTaskOrder> =>
  new Map(
    evaluation.current.ticketDeliveries.deliveries.map(
      ({ taskId }, index) => [taskId, taskOrderAt(deliveryTaskPositionAt(index))] as const
    )
  )

export const taskOrderFor = (taskOrders: ReadonlyMap<TaskId, StatusTaskOrder>, taskId: TaskId): StatusTaskOrderLookup =>
  taskOrders.get(taskId) ?? { _tag: "MissingTaskOrder", taskId }

export const deliveryHolderOrder = (
  holders: ReadonlyArray<{ readonly taskId: TaskId; readonly correlation: PlannedAttemptExecutorCorrelation }>
): ReadonlyArray<{ readonly taskId: TaskId; readonly correlation: PlannedAttemptExecutorCorrelation }> =>
  holders.toSorted((left, right) => {
    const task = left.taskId.localeCompare(right.taskId)
    return task !== 0
      ? task
      : plannedAttemptExecutorCorrelationKey(left.correlation).localeCompare(
          plannedAttemptExecutorCorrelationKey(right.correlation)
        )
  })

export const addEntry = (
  entries: Array<OrderedStatusEntry>,
  entry: DeliveryStatusEntry,
  taskOrder: StatusTaskOrder
): void => {
  entries.push({
    entry,
    taskOrder,
    phenomenonOrder: phenomenonOrder[entry._tag],
    structuralOrder: statusEntryStructuralOrder(entry)
  })
}
