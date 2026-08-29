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
  | { readonly _tag: "ActiveRefreshPostG2RuntimePhase"; readonly subjects: ReadonlyArray<ActiveRefreshPreG2Subject> }

export const DeliveryRuntimePhase = {
  Ordinary: { _tag: "OrdinaryDeliveryRuntimePhase" } satisfies DeliveryRuntimePhase,
  ActiveRefreshPreG2: (subjects: ReadonlyArray<ActiveRefreshPreG2Subject>): DeliveryRuntimePhase => ({
    _tag: "ActiveRefreshPreG2RuntimePhase",
    subjects
  }),
  ActiveRefreshPostG2: (subjects: ReadonlyArray<ActiveRefreshPreG2Subject>): DeliveryRuntimePhase => ({
    _tag: "ActiveRefreshPostG2RuntimePhase",
    subjects
  })
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

/**
 * Once the mandatory G2 is accepted, these transitions would reread or act
 * on a captured Running attempt a second time. The subject set remains in the
 * phase so a restart before G2 can still replay the exact active opportunity.
 */
const postG2ActiveTransitionTags: ReadonlySet<string> = new Set<string>([
  ...preG2ActiveTransitionTags,
  "ContinuePlannedAttemptExecutorWork",
  "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts"
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

/** Applies the selected G2 admission boundary to one descriptive evaluation. */
export const evaluationForPhase = (
  phase: DeliveryRuntimePhase,
  evaluation: DeliveryRuntimeEvaluation
): DeliveryRuntimeEvaluation => {
  if (phase._tag === "OrdinaryDeliveryRuntimePhase") return evaluation
  if (evaluation.proposedActions._tag === "DeliveryProposalOwnershipConflict") return evaluation
  if (phase._tag === "ActiveRefreshPostG2RuntimePhase") {
    return {
      ...evaluation,
      proposedActions: {
        ...evaluation.proposedActions,
        proposals: evaluation.proposedActions.proposals.filter((proposal) => {
          const subject = proposalPlannedAttemptOf(proposal)
          const transition = proposalTransitionTagOf(proposal)
          return !(
            subject !== undefined &&
            transition !== undefined &&
            postG2ActiveTransitionTags.has(transition) &&
            activeRefreshSubjectContains(phase.subjects, subject)
          )
        })
      }
    }
  }
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
