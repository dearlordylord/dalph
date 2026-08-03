import {
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedTaskAttempt,
  type TaskId
} from "@dalph/contracts"
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

const evidenceTaskId = (evidence: TicketDeliveryEvidence): TaskId => {
  switch (evidence._tag) {
    case "ResponsibilityFacts":
      return responsibilityTaskId(evidence.facts)
    case "AcceptedAwaitingIntegration":
      return evidence.accepted.plannedAttempt.taskId
    case "QueuedIntegration":
    case "StartedIntegration":
    case "IntegrationCandidate":
      return evidence.responsibility.plannedAttempt.taskId
    case "IntegrationWait":
      return integrationWaitTaskId(evidence.wait)
    case "SyntheticExecutorFacts":
      return evidence.plannedAttempt.taskId
  }
}

const evidenceIdentity = (evidence: TicketDeliveryEvidence): string => {
  switch (evidence._tag) {
    case "ResponsibilityFacts":
      return `workflow:${workflowResponsibilityKey(evidence.facts.responsibility)}`
    case "AcceptedAwaitingIntegration":
      return JSON.stringify(["integration", exactAttemptIdentity(evidence.accepted.plannedAttempt)])
    case "QueuedIntegration":
    case "StartedIntegration":
      return JSON.stringify(["integration", exactAttemptIdentity(evidence.responsibility.plannedAttempt)])
    case "IntegrationCandidate":
      return JSON.stringify([
        "candidate",
        exactAttemptIdentity(evidence.responsibility.plannedAttempt),
        evidence.responsibility.startedAt
      ])
    case "IntegrationWait":
      return JSON.stringify(["integration-wait", evidenceTaskId(evidence), evidence.wait._tag])
    case "SyntheticExecutorFacts":
      return JSON.stringify(["synthetic-executor", exactAttemptIdentity(evidence.plannedAttempt)])
  }
}

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

const obligationFrom = (evidence: TicketDeliveryEvidence): ReadonlyArray<ExactWorkflowObligation> => {
  switch (evidence._tag) {
    case "ResponsibilityFacts":
      return responsibilityObligationFrom(evidence.facts)
    case "AcceptedAwaitingIntegration":
      return [{ _tag: "AcceptedAwaitingIntegration", accepted: evidence.accepted }]
    case "QueuedIntegration":
      return [{ _tag: "QueuedIntegration", responsibility: evidence.responsibility }]
    case "StartedIntegration":
      return [{ _tag: "StartedIntegration", responsibility: evidence.responsibility }]
    case "IntegrationCandidate":
    case "IntegrationWait":
    case "SyntheticExecutorFacts":
      return []
  }
}

const candidateStandingFrom = (state: IntegrationCandidateConstructionState): ReadonlyArray<TicketDeliveryStanding> => {
  if (state._tag === "CandidateConstructed") return [{ _tag: "CandidateConstructedUnsettled", state }]
  if (state._tag === "CandidateCorrectionLimitReached" || state._tag === "CandidateContinuationLimitReached") {
    return [{ _tag: "IntegrationNonConvergencePreserved", state }]
  }
  return [{ _tag: "CandidateWorkActive", state }]
}

const responsibilityStandingFrom = (
  facts: ResponsibilityFreshFacts,
  placement: TicketDeliveryPlacement
): ReadonlyArray<TicketDeliveryStanding> =>
  !responsibilityEnded(facts) || (responsibilityRetainsTerminalKnowledge(facts) && !graphAlreadySuccessful(placement))
    ? [{ _tag: "ResponsibilitySituation", facts }]
    : []

const syntheticExecutorStandingFrom = (
  evidence: Extract<TicketDeliveryEvidence, { readonly _tag: "SyntheticExecutorFacts" }>,
  placement: TicketDeliveryPlacement
): ReadonlyArray<TicketDeliveryStanding> =>
  evidence.report._tag === "Terminal" && evidence.report.result._tag !== "Accepted" && graphAlreadySuccessful(placement)
    ? []
    : [{ _tag: "SyntheticExecutorSituation", plannedAttempt: evidence.plannedAttempt, report: evidence.report }]

const standingFrom = (
  evidence: TicketDeliveryEvidence,
  placement: TicketDeliveryPlacement
): ReadonlyArray<TicketDeliveryStanding> => {
  switch (evidence._tag) {
    case "ResponsibilityFacts":
      return responsibilityStandingFrom(evidence.facts, placement)
    case "AcceptedAwaitingIntegration":
      return [{ _tag: "AcceptedAwaitingIntegrationQueue", accepted: evidence.accepted }]
    case "QueuedIntegration":
      return [{ _tag: "QueuedIntegration", responsibility: evidence.responsibility }]
    case "StartedIntegration":
      return [{ _tag: "StartedIntegration", responsibility: evidence.responsibility }]
    case "IntegrationCandidate":
      return candidateStandingFrom(evidence.state)
    case "IntegrationWait":
      return [{ _tag: "IntegrationWait", wait: evidence.wait }]
    case "SyntheticExecutorFacts":
      return syntheticExecutorStandingFrom(evidence, placement)
  }
}

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
