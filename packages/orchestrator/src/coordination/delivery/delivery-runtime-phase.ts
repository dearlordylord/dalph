import type { AttemptId, RunId } from "@dalph/contracts"
import type { DeliveryActionProposal } from "./delivery-action-proposal.js"
import type { DeliveryRuntimeEvaluation } from "./relations.js"

/** The exact Running subjects retained while an active refresh waits for G2. */
export interface ActiveRefreshPreG2Subject {
  readonly attemptId: AttemptId
  readonly runId: RunId
}

/** Runtime admission phase selected by the enclosing Run activation. */
export type DeliveryRuntimePhase =
  | { readonly _tag: "OrdinaryDeliveryRuntimePhase" }
  | { readonly _tag: "ActiveRefreshPreG2RuntimePhase"; readonly subjects: ReadonlyArray<ActiveRefreshPreG2Subject> }
  | { readonly _tag: "ActiveRefreshPostG2RuntimePhase" }

export const DeliveryRuntimePhase = {
  Ordinary: { _tag: "OrdinaryDeliveryRuntimePhase" } satisfies DeliveryRuntimePhase,
  ActiveRefreshPreG2: (subjects: ReadonlyArray<ActiveRefreshPreG2Subject>): DeliveryRuntimePhase => ({
    _tag: "ActiveRefreshPreG2RuntimePhase",
    subjects
  }),
  ActiveRefreshPostG2: { _tag: "ActiveRefreshPostG2RuntimePhase" } satisfies DeliveryRuntimePhase
} as const

type PreG2TransitionTag =
  | "ObservePlannedAttemptContinuationClaim"
  | "ObservePlannedAttemptContinuationExecutor"
  | "ObservePlannedAttemptContinuationGraph"
  | "ObservePlannedAttemptContinuationSpecification"
  | "ObservePlannedAttemptContinuationTargetLineage"
  | "ObservePlannedAttemptContinuationWorktree"
  | "SuspendPlannedAttemptExecutorWork"

const preG2ActiveTransitionTags: ReadonlySet<string> = new Set<PreG2TransitionTag>([
  "ObservePlannedAttemptContinuationClaim",
  "ObservePlannedAttemptContinuationExecutor",
  "ObservePlannedAttemptContinuationGraph",
  "ObservePlannedAttemptContinuationSpecification",
  "ObservePlannedAttemptContinuationTargetLineage",
  "ObservePlannedAttemptContinuationWorktree",
  "SuspendPlannedAttemptExecutorWork"
])

const isActiveRefreshPreG2Subject = (value: unknown): value is ActiveRefreshPreG2Subject => {
  if (typeof value !== "object" || value === null) return false
  return (
    "attemptId" in value && "runId" in value && typeof value.attemptId === "string" && typeof value.runId === "string"
  )
}

const plannedAttemptOfTransition = (transition: unknown): ActiveRefreshPreG2Subject | undefined => {
  if (typeof transition !== "object" || transition === null) return undefined
  if ("plannedAttempt" in transition && isActiveRefreshPreG2Subject(transition.plannedAttempt)) {
    return transition.plannedAttempt
  }
  if (
    "subject" in transition &&
    typeof transition.subject === "object" &&
    transition.subject !== null &&
    "plannedAttempt" in transition.subject &&
    isActiveRefreshPreG2Subject(transition.subject.plannedAttempt)
  ) {
    return transition.subject.plannedAttempt
  }
  return undefined
}

const proposalTransitionTagOf = (proposal: DeliveryActionProposal): string | undefined => {
  const route = proposal.route
  if (route._tag === "IdentityFreeWorkflowRoute") return route.transition._tag
  if (route._tag === "AcceptedWorkflowRoute") return route.transition._tag
  if (route._tag === "RecoveredNewActionRoute" && proposal.order._tag === "RecoveredWorkflowOrder") {
    return proposal.order.transition
  }
  return undefined
}

const proposalPlannedAttemptOf = (proposal: DeliveryActionProposal): ActiveRefreshPreG2Subject | undefined => {
  const route = proposal.route
  if (route._tag === "FreshExecutorWorkflowRoute") return route.step.plannedAttempt
  if (route._tag === "IdentityFreeWorkflowRoute") return plannedAttemptOfTransition(route.transition)
  if (route._tag === "AcceptedWorkflowRoute") return plannedAttemptOfTransition(route.transition)
  if (route._tag === "RecoveredNewActionRoute") {
    const action = route.action
    return "plannedAttempt" in action && action.plannedAttempt !== null ? action.plannedAttempt : undefined
  }
  return undefined
}

const activeRefreshSubjectContains = (
  subjects: ReadonlyArray<ActiveRefreshPreG2Subject>,
  candidate: ActiveRefreshPreG2Subject
): boolean => subjects.some(({ attemptId, runId }) => attemptId === candidate.attemptId && runId === candidate.runId)

/** Holds old-graph fresh work until G2 while allowing captured authority reads. */
export const preG2EvaluationOf = (
  phase: DeliveryRuntimePhase,
  evaluation: DeliveryRuntimeEvaluation
): DeliveryRuntimeEvaluation => {
  if (phase._tag !== "ActiveRefreshPreG2RuntimePhase") return evaluation
  if (evaluation.proposedActions._tag === "DeliveryProposalOwnershipConflict") return evaluation
  return {
    ...evaluation,
    proposedActions: {
      ...evaluation.proposedActions,
      proposals: evaluation.proposedActions.proposals.filter((proposal) => {
        if (proposal.route._tag === "TrackerGraphReadRoute") return true
        const transition = proposalTransitionTagOf(proposal)
        const subject = proposalPlannedAttemptOf(proposal)
        return (
          transition !== undefined &&
          preG2ActiveTransitionTags.has(transition) &&
          subject !== undefined &&
          activeRefreshSubjectContains(phase.subjects, subject)
        )
      })
    }
  }
}
