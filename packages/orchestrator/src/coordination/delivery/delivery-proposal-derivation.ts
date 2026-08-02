import type { OperationId } from "../../workflow/identity.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type {
  IntegrationResponsibility,
  StartedIntegrationResponsibility
} from "../../workflow/protocols/integration-admission/protocol.js"
import { makeSelectedTransitionIdentity, selectedTransitionKey } from "../activation/selected-transition.js"
import { runnableTransitionTaskId, type RunnableFrontierTransition } from "../frontier/frontier.js"
import { transitionTaskWorkPosition } from "../frontier/transition-task-work.js"
import { workflowResponsibilityOperationId, type WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import {
  DeliveryProposalOrdinal,
  deliveryProposalIdOf,
  type AcceptedWorkflowRoute,
  type DeliveryActionProposal,
  type DeliveryAdmissionRequirements,
  type DeliveryProposalContributions,
  type DeliveryProposalOrderEvidence,
  type DeliveryProposalOwner,
  type DeliveryProposalsInput,
  type FreshDecision,
  type FreshIdentityDeliveryProposal,
  type FreshOperationRoute,
  type FreshOperationStep,
  type IdentityFreeWorkflowRoute,
  type IntegrationTargetResourceRequirement,
  type NewRecoveredWorkflowAction,
  type TaskWorkPositionRequirement
} from "./delivery-action-proposal.js"
import type { FreshWorkflowStep } from "./fresh-workflow-step.js"
import {
  isFreshProvenanceTransition,
  newRecoveredActionOf,
  operationIdOf,
  transitionRoutePolicy
} from "./delivery-proposal-route.js"

const freshIdentityFor = (step: FreshOperationStep): FreshIdentityDeliveryProposal["actionIdentity"] =>
  step._tag === "RecordTaskAttemptPlan"
    ? { _tag: "FreshOperationAndAttemptIdsRequired" }
    : { _tag: "FreshOperationIdRequired" }

const freshDecisionKey = (runId: DeliveryProposalsInput["runId"], decision: FreshDecision): string =>
  selectedTransitionKey(makeSelectedTransitionIdentity(runId, decision.transition))

const transitionKey = (runId: DeliveryProposalsInput["runId"], transition: RunnableFrontierTransition): string =>
  selectedTransitionKey(makeSelectedTransitionIdentity(runId, transition))

const taskWorkPositionFor = (transition: RunnableFrontierTransition): TaskWorkPositionRequirement => {
  const mode = transitionTaskWorkPosition(transition)
  return mode === null
    ? { _tag: "NoTaskWorkPosition" }
    : { _tag: "TaskWorkPositionRequired", mode, taskId: runnableTransitionTaskId(transition) }
}

const integrationResponsibilityFor = (
  transition: RunnableFrontierTransition,
  responsibilities: ReadonlyArray<IntegrationResponsibility>
): StartedIntegrationResponsibility | undefined => {
  if ("responsibility" in transition && transition.responsibility._tag === "StartedIntegrationResponsibility") {
    return transition.responsibility
  }
  if (transition._tag !== "ObservePlannedAttemptContinuationTargetLineage") return undefined
  return responsibilities.find(
    (responsibility): responsibility is StartedIntegrationResponsibility =>
      responsibility._tag === "StartedIntegrationResponsibility" &&
      responsibility.plannedAttempt.attemptId === transition.plannedAttempt.attemptId &&
      responsibility.plannedAttempt.runId === transition.plannedAttempt.runId
  )
}

const integrationTargetFor = (
  transition: RunnableFrontierTransition,
  responsibilities: ReadonlyArray<IntegrationResponsibility>
): IntegrationTargetResourceRequirement => {
  if (transition._tag === "StartQueuedIntegration") {
    return {
      _tag: "IntegrationTargetResourceRequired",
      access: "Acquire",
      integrationTarget: transition.responsibility.integrationTarget,
      queuedAt: transition.responsibility.queuedAt
    }
  }
  const started = integrationResponsibilityFor(transition, responsibilities)
  if (started === undefined) return { _tag: "NoIntegrationTargetResource" }
  return {
    _tag: "IntegrationTargetResourceRequired",
    access:
      transition._tag === "AcquireStartedIntegrationTarget"
        ? "Acquire"
        : transition._tag === "ReleaseStartedIntegrationTarget"
          ? "Release"
          : "UseHeld",
    integrationTarget: started.integrationTarget,
    queuedAt: started.queuedAt
  }
}

const isSettlementTransition = (
  transition: RunnableFrontierTransition,
  responsibilities: ReadonlyArray<IntegrationResponsibility>
): boolean =>
  transition._tag === "QueueAcceptedResultIntegrationResponsibility" ||
  transition._tag === "StartQueuedIntegration" ||
  transition._tag === "AcquireStartedIntegrationTarget" ||
  transition._tag === "ContinueStartedIntegrationCandidate" ||
  transition._tag === "ReleaseStartedIntegrationTarget" ||
  integrationResponsibilityFor(transition, responsibilities) !== undefined

const orderFor = (
  transition: RunnableFrontierTransition,
  step: FreshWorkflowStep | undefined,
  ordinal: DeliveryProposalOrdinal,
  acceptedAt: DeliveryProposalsInput["acceptedAt"],
  responsibilityBeganAt: JournalPosition | null,
  integrationResponsibility: StartedIntegrationResponsibility | undefined
): DeliveryProposalOrderEvidence => {
  const taskId = runnableTransitionTaskId(transition)
  if (step !== undefined) return { _tag: "FreshWorkflowOrder", frontierOrdinal: ordinal, step: step._tag, taskId }
  if (transition._tag === "QueueAcceptedResultIntegrationResponsibility") {
    return {
      _tag: "UnqueuedAcceptedResultOrder",
      frontierOrdinal: ordinal,
      taskId,
      terminalAt: transition.accepted.terminalAt
    }
  }
  if (integrationResponsibility !== undefined) {
    return {
      _tag: "IntegrationOrder",
      frontierOrdinal: ordinal,
      queuedAt: integrationResponsibility.queuedAt,
      startedAt: integrationResponsibility.startedAt,
      taskId
    }
  }
  if ("responsibility" in transition) {
    return {
      _tag: "IntegrationOrder",
      frontierOrdinal: ordinal,
      queuedAt: transition.responsibility.queuedAt,
      startedAt: null,
      taskId
    }
  }
  return {
    _tag: "RecoveredWorkflowOrder",
    acceptedAt: acceptedAt ?? null,
    frontierOrdinal: ordinal,
    responsibilityBeganAt,
    taskId,
    transition: transition._tag
  }
}

const responsibilityBeganAtFor = (
  transition: RunnableFrontierTransition,
  responsibilities: ReadonlyArray<WorkflowResponsibilityEntry>
): JournalPosition | null => {
  const operationId = operationIdOf(transition)
  const plannedAttempt = "plannedAttempt" in transition ? transition.plannedAttempt : undefined
  const found = responsibilities.find((responsibility) => {
    if (plannedAttempt !== undefined && responsibility._tag === "PlannedAttemptExecutorWorkResponsibility") {
      return (
        responsibility.plannedAttempt.attemptId === plannedAttempt.attemptId &&
        responsibility.plannedAttempt.runId === plannedAttempt.runId
      )
    }
    if (operationId !== undefined && responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility") {
      return workflowResponsibilityOperationId(responsibility) === operationId
    }
    return false
  })
  return found?.beganAt ?? null
}

interface ProposalContext {
  readonly admission: DeliveryAdmissionRequirements
  readonly order: DeliveryProposalOrderEvidence
  readonly owner: DeliveryProposalOwner
  readonly runId: DeliveryProposalsInput["runId"]
}

type DerivedProposal =
  | { readonly _tag: "ProposalDerived"; readonly proposal: DeliveryActionProposal }
  | { readonly _tag: "ProposalIssue"; readonly issue: DeliveryProposalContributions["issues"][number] }

const proposalBase = (
  context: ProposalContext,
  route: DeliveryActionProposal["route"]
): Omit<DeliveryActionProposal, "actionIdentity" | "route"> => ({
  _tag: "DeliveryActionProposal",
  admission: context.admission,
  id: deliveryProposalIdOf(context.runId, route),
  order: context.order,
  owner: context.owner
})

const freshProposalOf = (
  context: ProposalContext,
  fresh: FreshDecision
): Extract<DerivedProposal, { readonly _tag: "ProposalDerived" }> => {
  if (
    fresh.step._tag === "StartPlannedAttemptExecutorWork" ||
    fresh.step._tag === "ContinuePlannedAttemptExecutorWork"
  ) {
    const route: IdentityFreeWorkflowRoute = { _tag: "FreshExecutorWorkflowRoute", step: fresh.step }
    return {
      _tag: "ProposalDerived",
      proposal: { ...proposalBase(context, route), actionIdentity: { _tag: "NoWorkflowOperationIdentity" }, route }
    }
  }
  const route: FreshOperationRoute = { _tag: "FreshWorkflowRoute", step: fresh.step }
  return {
    _tag: "ProposalDerived",
    proposal: { ...proposalBase(context, route), actionIdentity: freshIdentityFor(fresh.step), route }
  }
}

const missingProvenance = (
  transition: Extract<
    RunnableFrontierTransition,
    {
      readonly _tag: "CommitFreshTaskClaimIntent" | "ContinueFreshWorkflowOperation" | "StartPlannedAttemptExecutorWork"
    }
  >
): Extract<DerivedProposal, { readonly _tag: "ProposalIssue" }> => ({
  _tag: "ProposalIssue",
  issue: {
    _tag: "FreshRouteProvenanceMissing",
    taskId: runnableTransitionTaskId(transition),
    transition: transition._tag
  }
})

const missingAcceptedOperation = (
  operationId: OperationId,
  transition: RunnableFrontierTransition
): Extract<DerivedProposal, { readonly _tag: "ProposalIssue" }> => ({
  _tag: "ProposalIssue",
  issue: {
    _tag: "AcceptedOperationEvidenceMissing",
    operationId,
    taskId: runnableTransitionTaskId(transition),
    transition: transition._tag
  }
})

type AcceptedOperationTransition = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "CheckTaskClaim" | "ReconcileTaskClaim" | "ReconcileTaskClaimRelease" | "ReconcileTaskWorktree" }
>

const isAcceptedOperationTransition = (
  transition: RunnableFrontierTransition
): transition is AcceptedOperationTransition => transitionRoutePolicy[transition._tag] === "AcceptedOperation"

const recoveredRouteProposalOf = (
  context: ProposalContext,
  newAction: NewRecoveredWorkflowAction | undefined,
  operationId: OperationId | undefined,
  transition: RunnableFrontierTransition
): Extract<DerivedProposal, { readonly _tag: "ProposalDerived" }> => {
  if (newAction !== undefined) {
    const route: FreshOperationRoute = { _tag: "RecoveredNewActionRoute", action: newAction }
    return {
      _tag: "ProposalDerived",
      proposal: { ...proposalBase(context, route), actionIdentity: { _tag: "FreshOperationIdRequired" }, route }
    }
  }
  if (operationId !== undefined) {
    const route: AcceptedWorkflowRoute = { _tag: "AcceptedWorkflowRoute", transition }
    return {
      _tag: "ProposalDerived",
      proposal: { ...proposalBase(context, route), actionIdentity: { _tag: "ExistingOperationId", operationId }, route }
    }
  }
  const route: IdentityFreeWorkflowRoute = { _tag: "IdentityFreeWorkflowRoute", transition }
  return {
    _tag: "ProposalDerived",
    proposal: { ...proposalBase(context, route), actionIdentity: { _tag: "NoWorkflowOperationIdentity" }, route }
  }
}

const recoveredProposalOf = (
  acceptedOperationIds: ReadonlySet<OperationId>,
  context: ProposalContext,
  transition: RunnableFrontierTransition
): DerivedProposal => {
  if (isFreshProvenanceTransition(transition)) return missingProvenance(transition)
  if (isAcceptedOperationTransition(transition)) {
    return acceptedOperationIds.has(transition.operationId)
      ? recoveredRouteProposalOf(context, undefined, transition.operationId, transition)
      : missingAcceptedOperation(transition.operationId, transition)
  }
  const operationId = operationIdOf(transition)
  const isAcceptedOperation = operationId !== undefined && acceptedOperationIds.has(operationId)
  const newAction = isAcceptedOperation ? undefined : newRecoveredActionOf(transition)
  return recoveredRouteProposalOf(context, newAction, operationId, transition)
}

const appendDerived = (
  contributions: {
    readonly deliverySettlement: Array<DeliveryActionProposal>
    readonly issues: Array<DeliveryProposalContributions["issues"][number]>
    readonly selectedTransitionKeys: Array<string>
    readonly ticketDelivery: Array<DeliveryActionProposal>
  },
  derived: DerivedProposal,
  selectedKey: string
): void => {
  if (derived._tag === "ProposalIssue") {
    contributions.issues.push(derived.issue)
    return
  }
  contributions.selectedTransitionKeys.push(selectedKey)
  if (derived.proposal.owner === "DeliverySettlement") contributions.deliverySettlement.push(derived.proposal)
  else contributions.ticketDelivery.push(derived.proposal)
}

/** Converts one already-reconciled transition order into immutable action routes without performing an action. */
export const deliveryProposalsOf = (input: DeliveryProposalsInput): DeliveryProposalContributions => {
  const freshByTransition = new Map(input.fresh.map((decision) => [freshDecisionKey(input.runId, decision), decision]))
  const integrationResponsibilities = input.integrationResponsibilities ?? []
  const workflowResponsibilities = input.responsibilities ?? []
  const contributions: {
    deliverySettlement: Array<DeliveryActionProposal>
    issues: Array<DeliveryProposalContributions["issues"][number]>
    selectedTransitionKeys: Array<string>
    ticketDelivery: Array<DeliveryActionProposal>
  } = { deliverySettlement: [], issues: [], selectedTransitionKeys: [], ticketDelivery: [] }

  for (const [index, transition] of input.transitions.entries()) {
    const fresh = freshByTransition.get(transitionKey(input.runId, transition))
    const admission: DeliveryAdmissionRequirements = {
      integrationTarget: integrationTargetFor(transition, integrationResponsibilities),
      taskWorkPosition: taskWorkPositionFor(transition)
    }
    const owner: DeliveryProposalOwner = isSettlementTransition(transition, integrationResponsibilities)
      ? "DeliverySettlement"
      : "TicketDelivery"
    const order = orderFor(
      transition,
      fresh?.step,
      DeliveryProposalOrdinal.make(index),
      input.acceptedAt,
      responsibilityBeganAtFor(transition, workflowResponsibilities),
      integrationResponsibilityFor(transition, integrationResponsibilities)
    )
    const context: ProposalContext = { admission, order, owner, runId: input.runId }
    const derived =
      fresh === undefined
        ? recoveredProposalOf(input.acceptedOperationIds, context, transition)
        : freshProposalOf(context, fresh)
    appendDerived(contributions, derived, transitionKey(input.runId, transition))
  }
  return contributions
}
