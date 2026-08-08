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
import type { IntegrationCandidateConstructionState } from "../../workflow/protocols/integration-candidate-construction/protocol.js"
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
  type TicketDeliveryStanding
} from "./relations.js"

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
    IntegrationCandidate: ({ responsibility }) => responsibility.plannedAttempt.taskId,
    IntegrationWait: ({ wait }) => integrationWaitTaskId(wait),
    QueuedIntegration: ({ responsibility }) => responsibility.plannedAttempt.taskId,
    ResponsibilityFacts: ({ facts }) => responsibilityTaskId(facts),
    StartedIntegration: ({ responsibility }) => responsibility.plannedAttempt.taskId,
    TargetPromotion: ({ responsibility }) => responsibility.plannedAttempt.taskId,
    TargetVerification: ({ responsibility }) => responsibility.plannedAttempt.taskId
  })

const targetVerificationIdentity = (
  state: Extract<TicketDeliveryEvidence, { readonly _tag: "TargetVerification" }>["state"]
): string => {
  const requestId = "correlation" in state ? state.correlation.requestId : state.expected.requestId
  return JSON.stringify(["target-verification", state._tag, requestId])
}

const targetPromotionIdentity = (
  state: Extract<TicketDeliveryEvidence, { readonly _tag: "TargetPromotion" }>["state"]
): string => JSON.stringify(["target-promotion", state._tag, state.correlation.requestId])

const evidenceIdentity = (evidence: TicketDeliveryEvidence): string =>
  Match.valueTags(evidence, {
    AcceptedAwaitingIntegration: ({ accepted }) =>
      JSON.stringify(["integration", exactAttemptIdentity(accepted.plannedAttempt)]),
    IntegrationCandidate: ({ responsibility }) =>
      JSON.stringify(["candidate", exactAttemptIdentity(responsibility.plannedAttempt), responsibility.startedAt]),
    IntegrationWait: ({ wait }) => JSON.stringify(["integration-wait", integrationWaitTaskId(wait), wait._tag]),
    QueuedIntegration: ({ responsibility }) =>
      JSON.stringify(["integration", exactAttemptIdentity(responsibility.plannedAttempt)]),
    ResponsibilityFacts: ({ facts }) => `workflow:${workflowResponsibilityKey(facts.responsibility)}`,
    StartedIntegration: ({ responsibility }) =>
      JSON.stringify(["integration", exactAttemptIdentity(responsibility.plannedAttempt)]),
    TargetPromotion: ({ state }) => targetPromotionIdentity(state),
    TargetVerification: ({ state }) => targetVerificationIdentity(state)
  })

const endedDispositionTags: ReadonlySet<ResponsibilityFreshFacts["disposition"]["_tag"]> = new Set([
  "FinalOutcome",
  "PlannedAttemptExecutorWorkTerminal",
  "Relinquished",
  "Settled",
  "TaskExternalSuccessSettled"
])

const responsibilityEnded = (facts: ResponsibilityFreshFacts): boolean =>
  endedDispositionTags.has(facts.disposition._tag)

const responsibilityRetainsTerminalKnowledge = (facts: ResponsibilityFreshFacts): boolean =>
  facts.disposition._tag === "FinalOutcome" ||
  facts.disposition._tag === "PlannedAttemptExecutorWorkTerminal" ||
  facts.disposition._tag === "Relinquished"

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
    IntegrationCandidate: () => [],
    IntegrationWait: () => [],
    QueuedIntegration: ({ responsibility }) => [{ _tag: "QueuedIntegration" as const, responsibility }],
    ResponsibilityFacts: ({ facts }) => responsibilityObligationFrom(facts),
    StartedIntegration: ({ responsibility }) => [{ _tag: "StartedIntegration" as const, responsibility }],
    TargetPromotion: () => [],
    TargetVerification: () => []
  })

const candidateStandingFrom = (state: IntegrationCandidateConstructionState): ReadonlyArray<TicketDeliveryStanding> => {
  if (state._tag === "CandidateConstructed") return [{ _tag: "CandidateConstructedUnsettled", state }]
  if (state._tag === "CandidateCorrectionLimitReached" || state._tag === "CandidateContinuationLimitReached") {
    return [{ _tag: "IntegrationNonConvergencePreserved", state }]
  }
  return [{ _tag: "CandidateWorkActive", state }]
}

const targetVerificationStandingFrom = (
  state: Extract<TicketDeliveryEvidence, { readonly _tag: "TargetVerification" }>["state"]
): ReadonlyArray<TicketDeliveryStanding> => {
  switch (state._tag) {
    case "VerificationPending":
      return [{ _tag: "TargetVerificationPending", state }]
    case "VerificationPassed":
      return [{ _tag: "TargetVerificationPassed", state }]
    case "VerificationStopped":
      return [{ _tag: "TargetVerificationStopped", state }]
    case "VerificationContradicted":
      return [{ _tag: "TargetVerificationContradicted", state }]
  }
}

const targetPromotionStandingFrom = (
  state: Extract<TicketDeliveryEvidence, { readonly _tag: "TargetPromotion" }>["state"]
): ReadonlyArray<TicketDeliveryStanding> => {
  switch (state._tag) {
    case "PromotionPending":
      return [{ _tag: "TargetPromotionPending", state }]
    case "PromotionSucceeded":
      return [{ _tag: "TargetPromotionSucceeded", state }]
    case "PromotionStale":
      return [{ _tag: "TargetPromotionStale", state }]
    case "PromotionNonConvergent":
      return [{ _tag: "TargetPromotionNonConvergent", state }]
  }
}

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
    IntegrationCandidate: ({ state }) => candidateStandingFrom(state),
    IntegrationWait: ({ wait }) => [{ _tag: "IntegrationWait" as const, wait }],
    QueuedIntegration: ({ responsibility }) => [{ _tag: "QueuedIntegration" as const, responsibility }],
    ResponsibilityFacts: ({ facts }) => responsibilityStandingFrom(facts, placement),
    StartedIntegration: ({ responsibility }) => [{ _tag: "StartedIntegration" as const, responsibility }],
    TargetPromotion: ({ state }) => targetPromotionStandingFrom(state),
    TargetVerification: ({ state }) => targetVerificationStandingFrom(state)
  })

const placementFor = (tickets: BoundedParallelTickets, taskId: TaskId): TicketDeliveryPlacement => {
  const current = tickets.placements.find((placement) => placement.taskId === taskId)?.placement
  if (current !== undefined) return current
  return tickets.source.source._tag === "GraphNotEstablished"
    ? { _tag: "GraphNotEstablished" }
    : { _tag: "AbsentFromCurrentGraph", graphRevision: tickets.source.source.observation.snapshot.revision }
}

/**
 * Relates desired placement to exact retained evidence. A task exists here iff
 * it is selected now or exact lower evidence still gives Dalph work to settle.
 */
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
    const desiredStanding: ReadonlyArray<TicketDeliveryStanding> =
      placement._tag === "Selected" && evidence.length === 0 ? [{ _tag: "ProposedDelivery" }] : []
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
      ...desiredStanding,
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
