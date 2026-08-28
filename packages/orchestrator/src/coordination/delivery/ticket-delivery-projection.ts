import {
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedTaskAttempt,
  type TaskId
} from "@dalph/contracts"
import { Match } from "effect"
import { taskRevisionFor } from "../../authorities/task-tracker/graph.js"
import type { TrackerTask } from "../../authorities/task-tracker/task.js"
import { isDependencySatisfied, isTaskOpen } from "../../authorities/task-tracker/task.js"
import { targetPromotionCorrelationEquals } from "../../workflow/protocols/target-promotion/events.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import { workflowResponsibilityKey } from "../reconstruction/state.js"
import {
  BoundedTicketRank,
  type BoundedParallelTickets,
  type BoundedTicketPlacement,
  type DeliveryFrontier,
  type DeliveryFrontierExclusion,
  type DeliveryFrontierStanding,
  type DeliveryGraphPublication,
  type ExactWorkflowObligation,
  type TicketDeliveryEvidence,
  type TicketDeliveries,
  type TicketDelivery,
  type TicketDeliveryPlacement,
  type TicketDeliveryStanding,
  makeDeliverySettlement,
  makeDeliverySettlements,
  type DeliverySettlements
} from "./relations.js"
import type { DeliveryActionProposal, DeliveryProposalContributions } from "./delivery-proposal.js"

const compareTaskIds = (left: { readonly taskId: TaskId }, right: { readonly taskId: TaskId }): number =>
  left.taskId.localeCompare(right.taskId)

const exclusionsFor = (
  task: TrackerTask,
  tasks: ReadonlyMap<TaskId, TrackerTask>
): ReadonlyArray<DeliveryFrontierExclusion> => {
  const lifecycle: ReadonlyArray<DeliveryFrontierExclusion> = isTaskOpen(task.lifecycle)
    ? []
    : task.lifecycle._tag === "CompletedSuccessfully"
      ? [{ _tag: "SuccessfulCompletion" }]
      : [{ _tag: "TerminalWithoutSuccess" }]
  const prerequisiteTaskIds = task.prerequisiteIds
    .filter((taskId) => {
      const prerequisite = tasks.get(taskId)
      return prerequisite === undefined || !isDependencySatisfied(prerequisite.lifecycle)
    })
    .toSorted((left, right) => left.localeCompare(right))
  return prerequisiteTaskIds.length === 0
    ? lifecycle
    : [...lifecycle, { _tag: "PrerequisitesIncomplete", prerequisiteTaskIds }]
}

type PromotedIntegrationFinality = Extract<TicketDeliveryEvidence, { readonly _tag: "TargetPromotion" }> & {
  readonly state: Extract<
    Extract<TicketDeliveryEvidence, { readonly _tag: "TargetPromotion" }>["state"],
    { readonly _tag: "PromotionSucceeded" }
  >
}

const isPromotedIntegrationFinality = (evidence: TicketDeliveryEvidence): evidence is PromotedIntegrationFinality =>
  evidence._tag === "TargetPromotion" && evidence.state._tag === "PromotionSucceeded"

const samePlannedAttempt = (left: PlannedTaskAttempt, right: PlannedTaskAttempt): boolean =>
  exactAttemptIdentity(left) === exactAttemptIdentity(right)

const promotedFinalityChronologiesFor = (
  taskId: TaskId,
  evidence: ReadonlyArray<TicketDeliveryEvidence>
): ReadonlyArray<PromotedIntegrationFinality> => {
  const started = evidence.flatMap((item) => (item._tag === "StartedIntegration" ? [item.responsibility] : []))
  return evidence
    .filter(isPromotedIntegrationFinality)
    .filter(
      (promotion) =>
        promotion.responsibility.plannedAttempt.taskId === taskId &&
        started.some((responsibility) =>
          samePlannedAttempt(responsibility.plannedAttempt, promotion.responsibility.plannedAttempt)
        )
    )
}

const graphFollowsFocusedSuccess = (
  promotion: PromotedIntegrationFinality,
  publication: DeliveryGraphPublication
): boolean => {
  if (publication.graph._tag !== "GraphEstablished") return false
  const graphRecordedAt = publication.graph.observation.recordedAt
  return publication.exactEvidence.some(
    (evidence) =>
      evidence._tag === "FocusedTaskCompletionSuccess" &&
      evidence.recordedAt < graphRecordedAt &&
      samePlannedAttempt(
        evidence.observed.observation.request.claim.plannedAttempt,
        promotion.responsibility.plannedAttempt
      ) &&
      targetPromotionCorrelationEquals(
        evidence.observed.observation.request.claim.promotionCorrelation,
        promotion.state.correlation
      )
  )
}

/** Exhaustively classifies the journaled graph inside one coherent descriptive publication. */
export const frontierOf = (publication: DeliveryGraphPublication): DeliveryFrontier => {
  const graph = publication.graph
  if (graph._tag === "GraphNotEstablished") {
    return { _tag: "DeliveryFrontier", publication, source: graph, standings: [] }
  }
  const tasks = new Map(graph.observation.snapshot.toWire().tasks.map((task) => [task.id, task] as const))
  const standings = [...tasks.values()]
    .map((task): DeliveryFrontierStanding => {
      const reasons = exclusionsFor(task, tasks)
      const firstReason = reasons[0]
      return firstReason === undefined
        ? { _tag: "Eligible", taskId: task.id, taskRevision: taskRevisionFor(task) }
        : { _tag: "Excluded", reasons: [firstReason, ...reasons.slice(1)], taskId: task.id }
    })
    .toSorted(compareTaskIds)
  return { _tag: "DeliveryFrontier", publication, source: graph, standings }
}

/** Applies only deterministic graph ordering and configured policy; live positions are not an input. */
export const boundedParallelTicketsOf = (source: DeliveryFrontier): BoundedParallelTickets => {
  const policy = source.publication.policy
  let eligibleRank = 0
  const placements = source.standings.map(({ taskId, ...standing }) => {
    if (standing._tag === "Excluded") {
      return { placement: { _tag: "GraphExcluded", reasons: standing.reasons } as const, taskId }
    }
    const rank = BoundedTicketRank.make(eligibleRank++)
    const placement: BoundedTicketPlacement =
      rank < policy.taskExecutionCapacity ? { _tag: "Selected", rank } : { _tag: "EligibleOutsideBound", rank }
    return { placement, taskId }
  })
  return { _tag: "BoundedParallelTickets", placements, policy, publication: source.publication, source }
}

/** Reads only the selected positive space from the exhaustive bounded placements. */
export const selectedTicketIds = (tickets: BoundedParallelTickets): ReadonlyArray<TaskId> =>
  tickets.placements.flatMap(({ placement, taskId }) => (placement._tag === "Selected" ? [taskId] : []))

const responsibilityTaskId = (facts: ResponsibilityFreshFacts): TaskId =>
  facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
    ? facts.responsibility.plannedAttempt.taskId
    : facts.responsibility.taskId

const exactAttemptIdentity = (plannedAttempt: PlannedTaskAttempt): string =>
  plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(plannedAttempt))

const integrationWaitTaskId = (
  wait: Extract<TicketDeliveryEvidence, { readonly _tag: "IntegrationWait" }>["wait"]
): TaskId => wait.plannedAttempt.taskId

const evidenceTaskId = (evidence: TicketDeliveryEvidence): TaskId =>
  Match.valueTags(evidence, {
    AcceptedAwaitingIntegration: ({ accepted }) => accepted.plannedAttempt.taskId,
    FocusedTaskCompletionSuccess: ({ observed }) => observed.observation.facts.taskId,
    IntegratorPreparation: ({ responsibility }) => responsibility.plannedAttempt.taskId,
    IntegrationWait: ({ wait }) => integrationWaitTaskId(wait),
    IntegrationFinalitySettlement: ({ settlement }) => settlement.claim.plannedAttempt.taskId,
    QueuedIntegration: ({ responsibility }) => responsibility.plannedAttempt.taskId,
    ResponsibilityFacts: ({ facts }) => responsibilityTaskId(facts),
    StartedIntegration: ({ responsibility }) => responsibility.plannedAttempt.taskId,
    TargetPromotion: ({ responsibility }) => responsibility.plannedAttempt.taskId
  })

const targetPromotionIdentity = (
  state: Extract<TicketDeliveryEvidence, { readonly _tag: "TargetPromotion" }>["state"]
): string => JSON.stringify(["target-promotion", state._tag, state.correlation.requestId])

const evidenceIdentity = (evidence: TicketDeliveryEvidence): string =>
  Match.valueTags(evidence, {
    AcceptedAwaitingIntegration: ({ accepted }) =>
      JSON.stringify(["integration", exactAttemptIdentity(accepted.plannedAttempt)]),
    FocusedTaskCompletionSuccess: ({ observed }) => JSON.stringify(["focused-task-completion", observed.operationId]),
    IntegratorPreparation: ({ responsibility, state }) =>
      JSON.stringify([
        "integrator",
        exactAttemptIdentity(responsibility.plannedAttempt),
        responsibility.startedAt,
        state._tag
      ]),
    IntegrationWait: ({ wait }) => JSON.stringify(["integration-wait", integrationWaitTaskId(wait), wait._tag]),
    IntegrationFinalitySettlement: ({ settlement }) =>
      JSON.stringify(["integration-finality", settlement.claim.promotionCorrelation.requestId]),
    QueuedIntegration: ({ responsibility }) =>
      JSON.stringify(["integration", exactAttemptIdentity(responsibility.plannedAttempt)]),
    ResponsibilityFacts: ({ facts }) => `workflow:${workflowResponsibilityKey(facts.responsibility)}`,
    StartedIntegration: ({ responsibility }) =>
      JSON.stringify(["integration", exactAttemptIdentity(responsibility.plannedAttempt)]),
    TargetPromotion: ({ state }) => targetPromotionIdentity(state)
  })

const endedDispositionTags: ReadonlySet<ResponsibilityFreshFacts["disposition"]["_tag"]> = new Set([
  "CancelledAttemptSettled",
  "FinalOutcome",
  "PlannedAttemptExecutorWorkTerminal",
  "Relinquished",
  "Settled",
  "StoppedAttemptSettled",
  "TaskExternalSuccessSettled"
])

const responsibilityEnded = (facts: ResponsibilityFreshFacts): boolean =>
  endedDispositionTags.has(facts.disposition._tag)

const responsibilityRetainsTerminalKnowledge = (facts: ResponsibilityFreshFacts): boolean =>
  facts.disposition._tag === "FinalOutcome" ||
  facts.disposition._tag === "PlannedAttemptExecutorWorkTerminal" ||
  facts.disposition._tag === "Relinquished" ||
  facts.disposition._tag === "CancelledAttemptSettled" ||
  facts.disposition._tag === "StoppedAttemptSettled"

const evidenceStillDescribesDelivery = (evidence: TicketDeliveryEvidence): boolean =>
  evidence._tag !== "ResponsibilityFacts" ||
  (evidence.facts.disposition._tag !== "Settled" && evidence.facts.disposition._tag !== "TaskExternalSuccessSettled")

const graphAlreadySuccessful = (placement: TicketDeliveryPlacement): boolean =>
  placement._tag === "GraphExcluded" && placement.reasons.some(({ _tag }) => _tag === "SuccessfulCompletion")

const responsibilityObligationFrom = (facts: ResponsibilityFreshFacts): ReadonlyArray<ExactWorkflowObligation> =>
  responsibilityEnded(facts) ? [] : [{ _tag: "WorkflowResponsibility", responsibility: facts.responsibility }]

const obligationFrom = (evidence: TicketDeliveryEvidence): ReadonlyArray<ExactWorkflowObligation> =>
  Match.valueTags(evidence, {
    AcceptedAwaitingIntegration: ({ accepted }) => [{ _tag: "AcceptedAwaitingIntegration" as const, accepted }],
    FocusedTaskCompletionSuccess: () => [],
    IntegratorPreparation: () => [],
    IntegrationWait: () => [],
    IntegrationFinalitySettlement: () => [],
    QueuedIntegration: ({ responsibility }) => [{ _tag: "QueuedIntegration" as const, responsibility }],
    ResponsibilityFacts: ({ facts }) => responsibilityObligationFrom(facts),
    StartedIntegration: ({ responsibility }) => [{ _tag: "StartedIntegration" as const, responsibility }],
    TargetPromotion: () => []
  })

const targetPromotionStandingFrom = (
  state: Extract<TicketDeliveryEvidence, { readonly _tag: "TargetPromotion" }>["state"]
): ReadonlyArray<TicketDeliveryStanding> =>
  Match.valueTags(state, {
    PromotionPending: (state): ReadonlyArray<TicketDeliveryStanding> => [{ _tag: "TargetPromotionPending", state }],
    PromotionReconciliationDeferred: (state): ReadonlyArray<TicketDeliveryStanding> => [
      { _tag: "TargetPromotionReconciliationDeferred", state }
    ],
    PromotionSucceeded: (state): ReadonlyArray<TicketDeliveryStanding> => [{ _tag: "TargetPromotionSucceeded", state }],
    PromotionStale: (state): ReadonlyArray<TicketDeliveryStanding> => [{ _tag: "TargetPromotionStale", state }],
    PromotionNonConvergent: (state): ReadonlyArray<TicketDeliveryStanding> => [
      { _tag: "TargetPromotionNonConvergent", state }
    ]
  })

const responsibilityStandingFrom = (
  facts: ResponsibilityFreshFacts,
  placement: TicketDeliveryPlacement
): ReadonlyArray<TicketDeliveryStanding> =>
  !responsibilityEnded(facts) || (responsibilityRetainsTerminalKnowledge(facts) && !graphAlreadySuccessful(placement))
    ? [{ _tag: "ResponsibilitySituation", facts }]
    : []

const standingFrom = (
  evidence: TicketDeliveryEvidence,
  placement: TicketDeliveryPlacement
): ReadonlyArray<TicketDeliveryStanding> =>
  Match.valueTags(evidence, {
    AcceptedAwaitingIntegration: ({ accepted }) => [{ _tag: "AcceptedAwaitingIntegrationQueue" as const, accepted }],
    FocusedTaskCompletionSuccess: () => [],
    IntegratorPreparation: ({ state }) => [{ _tag: "IntegratorPreparation" as const, state }],
    IntegrationWait: ({ wait }) => [{ _tag: "IntegrationWait" as const, wait }],
    IntegrationFinalitySettlement: ({ settlement }) => [{ _tag: "IntegrationFinalitySettled" as const, settlement }],
    QueuedIntegration: ({ responsibility }) => [{ _tag: "QueuedIntegration" as const, responsibility }],
    ResponsibilityFacts: ({ facts }) => responsibilityStandingFrom(facts, placement),
    StartedIntegration: ({ responsibility }) => [{ _tag: "StartedIntegration" as const, responsibility }],
    TargetPromotion: ({ state }) => targetPromotionStandingFrom(state)
  })

const placementFor = (tickets: BoundedParallelTickets, taskId: TaskId): TicketDeliveryPlacement => {
  const current = tickets.placements.find((placement) => placement.taskId === taskId)?.placement
  if (current !== undefined) return current
  return tickets.source.source._tag === "GraphNotEstablished"
    ? { _tag: "GraphNotEstablished" }
    : { _tag: "AbsentFromCurrentGraph", graphRevision: tickets.source.source.observation.snapshot.revision }
}

const promotedPrerequisiteReleasePendingFor = (
  tickets: BoundedParallelTickets,
  taskId: TaskId
): ReadonlyArray<TaskId> => {
  const graph = tickets.publication.graph
  if (graph._tag !== "GraphEstablished") return []
  const task = graph.observation.snapshot.toWire().tasks.find((candidate) => candidate.id === taskId)
  if (task === undefined) return []
  return task.prerequisiteIds.filter((prerequisiteTaskId) =>
    promotedFinalityChronologiesFor(prerequisiteTaskId, tickets.publication.exactEvidence).some(
      (promotion) => !graphFollowsFocusedSuccess(promotion, tickets.publication)
    )
  )
}

const freshProposalCanEnterFrontier = (tickets: BoundedParallelTickets, proposal: DeliveryActionProposal): boolean =>
  proposal.order._tag !== "FreshWorkflowOrder" ||
  promotedPrerequisiteReleasePendingFor(tickets, proposal.order.taskId).length === 0

/**
 * Keeps a fresh dependant out of the executable proposal frontier while its
 * selected placement still lacks issue-61's exact focused-success chronology.
 * Existing responsibilities and ordinary external successes are unchanged.
 */
export const releaseEligibleProposalContributionsOf = (
  tickets: BoundedParallelTickets,
  contributions: DeliveryProposalContributions
): DeliveryProposalContributions => ({
  ...contributions,
  ticketDelivery: contributions.ticketDelivery.filter((proposal) => freshProposalCanEnterFrontier(tickets, proposal))
})

/**
 * Relates desired placement to exact retained evidence. A task exists here iff
 * it is selected now or exact lower evidence still gives Dalph work to settle.
 */
const freshSelectedStandingsFor = (
  tickets: BoundedParallelTickets,
  taskId: TaskId,
  selectedWithoutEvidence: boolean
): ReadonlyArray<TicketDeliveryStanding> => {
  if (!selectedWithoutEvidence) return []
  const pending = promotedPrerequisiteReleasePendingFor(tickets, taskId)
  const firstPending = pending[0]
  return firstPending === undefined
    ? [{ _tag: "ProposedDelivery" }]
    : [{ _tag: "PromotedPrerequisiteReleasePending", prerequisiteTaskIds: [firstPending, ...pending.slice(1)] }]
}

export const ticketDeliveriesOf = (
  tickets: BoundedParallelTickets,
  exactEvidence: ReadonlyArray<TicketDeliveryEvidence>
): TicketDeliveries => {
  const evidenceByTask = new Map<TaskId, ReadonlyArray<TicketDeliveryEvidence>>()
  for (const evidence of exactEvidence.filter(evidenceStillDescribesDelivery)) {
    const taskId = evidenceTaskId(evidence)
    evidenceByTask.set(taskId, [...(evidenceByTask.get(taskId) ?? []), evidence])
  }
  const desiredTaskIds = tickets.placements.flatMap(({ placement, taskId }) =>
    placement._tag === "Selected" ? [taskId] : []
  )
  const taskIds = [...new Set([...desiredTaskIds, ...evidenceByTask.keys()])].toSorted((left, right) =>
    left.localeCompare(right)
  )
  const deliveries = taskIds.flatMap((taskId): ReadonlyArray<TicketDelivery> => {
    const evidence = evidenceByTask.get(taskId) ?? []
    const placement = placementFor(tickets, taskId)
    const freshSelectedStandings = freshSelectedStandingsFor(
      tickets,
      taskId,
      placement._tag === "Selected" && evidence.length === 0
    )
    const identities = evidence.map(evidenceIdentity)
    const taskConflicts = identities
      .filter((identity, index) => identities.indexOf(identity) !== index)
      .filter((identity, index, conflicts) => conflicts.indexOf(identity) === index)
      .toSorted()
    const firstConflict = taskConflicts[0]
    const conflictStanding: ReadonlyArray<TicketDeliveryStanding> =
      firstConflict === undefined
        ? []
        : [{ _tag: "ExactEvidenceConflict", evidenceIdentities: [firstConflict, ...taskConflicts.slice(1)] }]
    const obligations = evidence.flatMap(obligationFrom)
    const standings = [
      ...freshSelectedStandings,
      ...evidence.flatMap((item) => standingFrom(item, placement)),
      ...conflictStanding
    ]
    const firstStanding = standings[0]
    if (firstStanding === undefined) return []
    const retainedStandings: readonly [TicketDeliveryStanding, ...ReadonlyArray<TicketDeliveryStanding>] = [
      firstStanding,
      ...standings.slice(1)
    ]
    return [{ _tag: "TicketDelivery", evidence, obligations, placement, standings: retainedStandings, taskId }]
  })
  return { _tag: "TicketDeliveries", deliveries, source: tickets }
}

/** Establishes task-scoped settlements only from exact finality journal evidence. */
export const deliverySettlementsOf = (source: TicketDeliveries): DeliverySettlements =>
  makeDeliverySettlements(
    source,
    source.deliveries.flatMap((delivery) =>
      delivery.evidence.flatMap((evidence) =>
        evidence._tag === "IntegrationFinalitySettlement"
          ? [
              makeDeliverySettlement({
                attemptId: evidence.settlement.claim.plannedAttempt.attemptId,
                taskId: evidence.settlement.claim.plannedAttempt.taskId
              })
            ]
          : []
      )
    )
  )
