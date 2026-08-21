/* eslint-disable max-lines -- The closed proposal relation keeps every transition-to-admission mapping exhaustive. */
import { plannedAttemptExecutorCorrelation } from "@dalph/contracts"
import type { OperationId } from "../../workflow/identity.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type {
  IntegrationResponsibility,
  StartedIntegrationResponsibility
} from "../../workflow/protocols/integration-admission/protocol.js"
import { makeSelectedTransitionIdentity, selectedTransitionKey } from "../activation/selected-transition.js"
import {
  runnableTransitionOperationId,
  runnableTransitionTaskId,
  type RunnableFrontierTransition
} from "../frontier/frontier.js"
import { transitionTaskWorkPosition } from "../frontier/transition-task-work.js"
import { workflowResponsibilityOperationId, type WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import {
  DeliveryProposalOrdinal,
  deliveryProposalIdOf,
  type AcceptedWorkflowRoute,
  type AcceptedWorkflowTransition,
  type DeliveryActionProposal,
  type DeliveryAdmissionRequirements,
  type DeliveryProposalContributions,
  type DeliveryProposalOrderEvidence,
  type DeliveryProposalOwner,
  type DeliveryProposalsInput,
  type FreshDecision,
  type FreshOperationRoute,
  type IdentityFreeWorkflowRoute,
  type IntegrationTargetResourceRequirement,
  type NewRecoveredWorkflowAction,
  type PlannedAttemptProtocolRequirement,
  type TaskWorkPositionRequirement
} from "./delivery-action-proposal.js"
import { freshOperationIdentity, recoveredIdentityFor } from "./delivery-proposal-identity.js"
import type { FreshWorkflowStep } from "./fresh-workflow-step.js"
import { isFreshProvenanceTransition, newRecoveredActionOf, operationIdOf } from "./delivery-proposal-route.js"
import {
  deliveryTransitionPolicy,
  type TransitionForRoute,
  usesPlannedAttemptProtocol,
  usesStopSubjectProtocol
} from "./delivery-transition-policy.js"

const freshDecisionKey = (runId: DeliveryProposalsInput["runId"], decision: FreshDecision): string =>
  selectedTransitionKey(makeSelectedTransitionIdentity(runId, decision.transition))

const transitionKey = (runId: DeliveryProposalsInput["runId"], transition: RunnableFrontierTransition): string =>
  selectedTransitionKey(makeSelectedTransitionIdentity(runId, transition))

const taskWorkPositionFor = (transition: RunnableFrontierTransition): TaskWorkPositionRequirement => {
  const mode = transitionTaskWorkPosition(transition)
  if (mode === null) return { _tag: "NoTaskWorkPosition" }
  const taskId = runnableTransitionTaskId(transition)
  return { _tag: "TaskWorkPositionRequired", mode, taskId }
}

const plannedAttemptProtocolFor = (transition: RunnableFrontierTransition): PlannedAttemptProtocolRequirement => {
  if (usesStopSubjectProtocol(transition)) {
    return {
      _tag: "PlannedAttemptProtocolRequired",
      correlation: plannedAttemptExecutorCorrelation(transition.subject.plannedAttempt)
    }
  }
  if (usesPlannedAttemptProtocol(transition)) {
    return {
      _tag: "PlannedAttemptProtocolRequired",
      correlation: plannedAttemptExecutorCorrelation(transition.plannedAttempt)
    }
  }
  return { _tag: "NoPlannedAttemptProtocol" }
}

const admissionFor = (
  transition: RunnableFrontierTransition,
  integrationResponsibilities: ReadonlyArray<IntegrationResponsibility>
): DeliveryAdmissionRequirements | undefined => {
  const integrationTarget = integrationTargetFor(transition, integrationResponsibilities)
  const plannedAttemptProtocol = plannedAttemptProtocolFor(transition)
  const taskWorkPosition = taskWorkPositionFor(transition)
  if (plannedAttemptProtocol._tag === "PlannedAttemptProtocolRequired") {
    return { integrationTarget, plannedAttemptProtocol, taskWorkPosition }
  }
  /* v8 ignore start -- the closed transition maps assign Existing only to guarded executor suspension. */
  if (taskWorkPosition._tag === "TaskWorkPositionRequired" && taskWorkPosition.mode === "Existing") {
    return undefined
  }
  /* v8 ignore stop */
  return { integrationTarget, plannedAttemptProtocol, taskWorkPosition }
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

const transitionsWithoutIntegrationTarget = new Set<RunnableFrontierTransition["_tag"]>([
  "RecordInitialConclusiveIntegrationQuarantine",
  "RecordProviderRunFailureIntegrationQuarantine",
  "RecordRetryConclusiveIntegrationQuarantine",
  "ObservePromotedCandidateAncestryAfterBlockerClear",
  "ReplacePromotedTaskClaim",
  "CompletePromotedTask",
  "ObserveFocusedTaskCompletion",
  "DeleteCompletedTaskCompletionClaim"
])

const startedIntegrationTargetAccessFor = (
  transition: RunnableFrontierTransition
): Extract<IntegrationTargetResourceRequirement, { readonly _tag: "IntegrationTargetResourceRequired" }>["access"] => {
  if (transition._tag === "AcquireStartedIntegrationTarget") return "Acquire"
  if (transition._tag === "ReleaseStartedIntegrationTarget") return "Release"
  return "UseHeld"
}

const integrationTargetFor = (
  transition: RunnableFrontierTransition,
  responsibilities: ReadonlyArray<IntegrationResponsibility>
): IntegrationTargetResourceRequirement => {
  if (transitionsWithoutIntegrationTarget.has(transition._tag)) {
    return { _tag: "NoIntegrationTargetResource" }
  }
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
    access: startedIntegrationTargetAccessFor(transition),
    integrationTarget: started.integrationTarget,
    queuedAt: started.queuedAt
  }
}

const settlementTransitionTags = new Set<RunnableFrontierTransition["_tag"]>([
  "RelinquishCancelledAttemptImplementation",
  "ObserveCancelledAttemptClaim",
  "RecordCancelledAttemptClaimNoRelease",
  "ReleaseCancelledAttemptClaim",
  "RetryCancelledAttemptClaimRelease",
  "QueueAcceptedResultIntegrationResponsibility",
  "StartQueuedIntegration",
  "AcquireStartedIntegrationTarget",
  "RunTargetPromotion",
  "ObservePromotedCandidateAncestryAfterBlockerClear",
  "ReplacePromotedTaskClaim",
  "DeleteCompletedTaskCompletionClaim",
  "ReleaseStartedIntegrationTarget"
])

const isSettlementTransition = (
  transition: RunnableFrontierTransition,
  responsibilities: ReadonlyArray<IntegrationResponsibility>
): boolean =>
  settlementTransitionTags.has(transition._tag) ||
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
  readonly waitsForLiveOperationId: OperationId | null
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
  owner: context.owner,
  waitsForLiveOperationId: context.waitsForLiveOperationId
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
  if (fresh.step._tag === "RecordTaskAttemptPlan") {
    const route: FreshOperationRoute = { _tag: "FreshWorkflowRoute", step: fresh.step }
    return {
      _tag: "ProposalDerived",
      proposal: {
        ...proposalBase(context, route),
        actionIdentity: { _tag: "FreshOperationAndAttemptIdsRequired" },
        route
      }
    }
  }
  const route: FreshOperationRoute = { _tag: "FreshWorkflowRoute", step: fresh.step }
  return {
    _tag: "ProposalDerived",
    proposal: { ...proposalBase(context, route), actionIdentity: freshOperationIdentity(), route }
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

/* v8 ignore start -- the closed transition route policy makes this typed diagnostic unreachable. */
const routePolicyContradiction = (
  transition: RunnableFrontierTransition
): Extract<DerivedProposal, { readonly _tag: "ProposalIssue" }> => ({
  _tag: "ProposalIssue",
  issue: {
    _tag: "TypedRoutePolicyContradiction",
    taskId: runnableTransitionTaskId(transition),
    transition: transition._tag
  }
})
/* v8 ignore stop */

type AcceptedOperationTransition = TransitionForRoute<"AcceptedOperation">

type IdentityFreeTransition = TransitionForRoute<"IdentityFree">

const isAcceptedOperationTransition = (
  transition: RunnableFrontierTransition
): transition is AcceptedOperationTransition => deliveryTransitionPolicy[transition._tag].route === "AcceptedOperation"

const isIdentityFreeTransition = (transition: RunnableFrontierTransition): transition is IdentityFreeTransition =>
  deliveryTransitionPolicy[transition._tag].route === "IdentityFree"

const isAcceptedRouteTransition = (transition: RunnableFrontierTransition): transition is AcceptedWorkflowTransition =>
  deliveryTransitionPolicy[transition._tag].route === "AcceptedOperation" ||
  deliveryTransitionPolicy[transition._tag].route === "Observation"

const recoveredRouteProposalOf = (
  context: ProposalContext,
  newAction: NewRecoveredWorkflowAction | undefined,
  operationId: OperationId | undefined,
  transition: RunnableFrontierTransition
): DerivedProposal => {
  if (newAction !== undefined) {
    const route: FreshOperationRoute = { _tag: "RecoveredNewActionRoute", action: newAction }
    return {
      _tag: "ProposalDerived",
      proposal: { ...proposalBase(context, route), actionIdentity: recoveredIdentityFor(newAction), route }
    }
  }
  if (operationId !== undefined) {
    /* v8 ignore start -- operation identity is derived only for accepted-route transition tags. */
    if (!isAcceptedRouteTransition(transition)) {
      return routePolicyContradiction(transition)
    }
    /* v8 ignore stop */
    const route: AcceptedWorkflowRoute = { _tag: "AcceptedWorkflowRoute", transition }
    return {
      _tag: "ProposalDerived",
      proposal: { ...proposalBase(context, route), actionIdentity: { _tag: "ExistingOperationId" }, route }
    }
  }
  /* v8 ignore start -- identity-free selection is derived only for identity-free transition tags. */
  if (!isIdentityFreeTransition(transition)) {
    return routePolicyContradiction(transition)
  }
  /* v8 ignore stop */
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
    const operationId = operationIdOf(transition)
    /* v8 ignore start -- every accepted-operation transition carries its identity in one closed typed location. */
    if (operationId === undefined) return routePolicyContradiction(transition)
    /* v8 ignore stop */
    return acceptedOperationIds.has(operationId)
      ? recoveredRouteProposalOf(context, undefined, operationId, transition)
      : missingAcceptedOperation(operationId, transition)
  }
  const operationId = operationIdOf(transition)
  const isAcceptedOperation = operationId !== undefined && acceptedOperationIds.has(operationId)
  const newAction = isAcceptedOperation ? undefined : newRecoveredActionOf(transition)
  return recoveredRouteProposalOf(context, newAction, operationId, transition)
}

interface MutableDeliveryProposalContributions {
  readonly deliverySettlement: Array<DeliveryActionProposal>
  readonly issues: Array<DeliveryProposalContributions["issues"][number]>
  readonly ticketDelivery: Array<DeliveryActionProposal>
}

const appendDerived = (contributions: MutableDeliveryProposalContributions, derived: DerivedProposal): void => {
  if (derived._tag === "ProposalIssue") {
    contributions.issues.push(derived.issue)
    return
  }
  if (derived.proposal.owner === "DeliverySettlement") contributions.deliverySettlement.push(derived.proposal)
  else contributions.ticketDelivery.push(derived.proposal)
}

interface DeliveryProposalDerivationFrame {
  readonly acceptedAt: DeliveryProposalsInput["acceptedAt"]
  readonly acceptedOperationIds: DeliveryProposalsInput["acceptedOperationIds"]
  readonly freshByTransition: ReadonlyMap<string, FreshDecision>
  readonly integrationResponsibilities: ReadonlyArray<IntegrationResponsibility>
  readonly responsibilities: ReadonlyArray<WorkflowResponsibilityEntry>
  readonly runId: DeliveryProposalsInput["runId"]
}

const appendContributionForTransition = (
  contributions: MutableDeliveryProposalContributions,
  frame: DeliveryProposalDerivationFrame,
  index: number,
  transition: RunnableFrontierTransition
): void => {
  const fresh = frame.freshByTransition.get(transitionKey(frame.runId, transition))
  const admission = admissionFor(transition, frame.integrationResponsibilities)
  /* v8 ignore start -- the closed transition maps make an uncorrelated Existing requirement unreachable. */
  if (admission === undefined) {
    appendDerived(contributions, routePolicyContradiction(transition))
    return
  }
  /* v8 ignore stop */
  const integrationResponsibility = integrationResponsibilityFor(transition, frame.integrationResponsibilities)
  const owner: DeliveryProposalOwner = isSettlementTransition(transition, frame.integrationResponsibilities)
    ? "DeliverySettlement"
    : "TicketDelivery"
  const context: ProposalContext = {
    admission,
    order: orderFor(
      transition,
      fresh?.step,
      DeliveryProposalOrdinal.make(index),
      frame.acceptedAt,
      responsibilityBeganAtFor(transition, frame.responsibilities),
      integrationResponsibility
    ),
    owner,
    runId: frame.runId,
    waitsForLiveOperationId: runnableTransitionOperationId(transition) ?? null
  }
  appendDerived(
    contributions,
    fresh === undefined
      ? recoveredProposalOf(frame.acceptedOperationIds, context, transition)
      : freshProposalOf(context, fresh)
  )
}

/** Converts one already-reconciled transition order into immutable action routes without performing an action. */
export const deliveryProposalsOf = (input: DeliveryProposalsInput): DeliveryProposalContributions => {
  const frame: DeliveryProposalDerivationFrame = {
    acceptedAt: input.acceptedAt,
    acceptedOperationIds: input.acceptedOperationIds,
    freshByTransition: new Map(input.fresh.map((decision) => [freshDecisionKey(input.runId, decision), decision])),
    integrationResponsibilities: input.integrationResponsibilities ?? [],
    responsibilities: input.responsibilities ?? [],
    runId: input.runId
  }
  const contributions: MutableDeliveryProposalContributions = { deliverySettlement: [], issues: [], ticketDelivery: [] }

  for (const [index, transition] of input.transitions.entries()) {
    appendContributionForTransition(contributions, frame, index, transition)
  }
  return contributions
}
