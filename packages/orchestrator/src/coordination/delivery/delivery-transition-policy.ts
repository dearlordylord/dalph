import type { RunnableFrontierTransition } from "../frontier/frontier.js"

export type DeliveryTransitionRoute =
  | "AcceptedOperation"
  | "FreshProvenance"
  | "IdentityFree"
  | "NewOperation"
  | "Observation"

export type AcceptedTransitionExecution = "Observation" | "Recovery" | "StoppedClaimReleaseRetry"
type PlannedAttemptProtocolSource = "None" | "PlannedAttempt" | "StopSubject"

type DeliveryTransitionPolicy = {
  readonly acceptedExecution?: AcceptedTransitionExecution
  readonly plannedAttemptProtocol: PlannedAttemptProtocolSource
  readonly route: DeliveryTransitionRoute
}

const policy = <const Route extends DeliveryTransitionRoute, const Protocol extends PlannedAttemptProtocolSource>(
  route: Route,
  plannedAttemptProtocol: Protocol
) => ({ plannedAttemptProtocol, route })

const acceptedPolicy = <
  const Route extends "AcceptedOperation" | "Observation",
  const Execution extends AcceptedTransitionExecution
>(
  route: Route,
  acceptedExecution: Execution
) => ({ acceptedExecution, plannedAttemptProtocol: "None" as const, route })

/** One closed classification drives proposal identity, admission, accepted execution, and adapter transition types. */
export const deliveryTransitionPolicy = {
  AcquireStartedIntegrationTarget: policy("IdentityFree", "None"),
  AdvanceAttemptRestart: policy("IdentityFree", "PlannedAttempt"),
  AdvanceAttemptStoppage: policy("IdentityFree", "StopSubject"),
  CheckTaskClaim: acceptedPolicy("AcceptedOperation", "Recovery"),
  CommitFreshTaskClaimIntent: policy("FreshProvenance", "None"),
  CommitTaskClaimReacquisitionIntent: policy("NewOperation", "None"),
  ContinueFreshWorkflowOperation: policy("FreshProvenance", "None"),
  ContinuePlannedAttemptExecutorWork: policy("IdentityFree", "PlannedAttempt"),
  ContinuePlannedAttemptExecutorWorkAfterCurrentFacts: policy("IdentityFree", "PlannedAttempt"),
  ObservePlannedAttemptContinuationExecutor: policy("IdentityFree", "PlannedAttempt"),
  ObserveAttemptStoppageExecutor: policy("IdentityFree", "StopSubject"),
  ContinueStartedIntegrationCandidate: policy("IdentityFree", "None"),
  RunTargetVerification: policy("IdentityFree", "None"),
  RunTargetPromotion: policy("IdentityFree", "None"),
  ReplacePromotedTaskClaim: policy("IdentityFree", "None"),
  CompletePromotedTask: policy("IdentityFree", "None"),
  ObserveFocusedTaskCompletion: policy("IdentityFree", "None"),
  DeleteCompletedTaskCompletionClaim: policy("IdentityFree", "None"),
  ObservePlannedAttemptContinuationClaim: acceptedPolicy("Observation", "Observation"),
  ObservePlannedAttemptContinuationGraph: acceptedPolicy("Observation", "Observation"),
  ObservePlannedAttemptContinuationSpecification: acceptedPolicy("Observation", "Observation"),
  ObservePlannedAttemptContinuationTargetLineage: acceptedPolicy("Observation", "Observation"),
  ObservePlannedAttemptContinuationWorktree: acceptedPolicy("Observation", "Observation"),
  ObserveResponsibleTaskClaim: acceptedPolicy("Observation", "Observation"),
  ObserveStoppedAttemptClaim: acceptedPolicy("Observation", "Observation"),
  QueueAcceptedResultIntegrationResponsibility: policy("IdentityFree", "None"),
  ReconcileTaskClaim: acceptedPolicy("AcceptedOperation", "Recovery"),
  ReconcileTaskClaimRelease: acceptedPolicy("AcceptedOperation", "Recovery"),
  ReconcileTaskWorktree: acceptedPolicy("AcceptedOperation", "Recovery"),
  RecordStoppedAttemptClaimNoRelease: policy("IdentityFree", "None"),
  ReleaseExternallyCompletedTaskClaim: policy("NewOperation", "None"),
  ReleaseStoppedAttemptClaim: policy("NewOperation", "None"),
  RetryStoppedAttemptClaimRelease: acceptedPolicy("AcceptedOperation", "StoppedClaimReleaseRetry"),
  ReleaseStartedIntegrationTarget: policy("IdentityFree", "None"),
  StartPlannedAttemptExecutorWork: policy("FreshProvenance", "PlannedAttempt"),
  StartQueuedIntegration: policy("IdentityFree", "None"),
  SuspendPlannedAttemptExecutorWork: policy("IdentityFree", "PlannedAttempt")
} as const satisfies Record<RunnableFrontierTransition["_tag"], DeliveryTransitionPolicy>

type TransitionTagForRoute<Route extends DeliveryTransitionRoute> = {
  [Tag in keyof typeof deliveryTransitionPolicy]: (typeof deliveryTransitionPolicy)[Tag]["route"] extends Route
    ? Tag
    : never
}[keyof typeof deliveryTransitionPolicy]

type TransitionTagForAcceptedExecution<Execution extends AcceptedTransitionExecution> = {
  [Tag in keyof typeof deliveryTransitionPolicy]: (typeof deliveryTransitionPolicy)[Tag] extends {
    readonly acceptedExecution: Execution
  }
    ? Tag
    : never
}[keyof typeof deliveryTransitionPolicy]

type TransitionTagForPlannedAttemptProtocol<Protocol extends PlannedAttemptProtocolSource> = {
  [Tag in keyof typeof deliveryTransitionPolicy]: (typeof deliveryTransitionPolicy)[Tag]["plannedAttemptProtocol"] extends Protocol
    ? Tag
    : never
}[keyof typeof deliveryTransitionPolicy]

export type TransitionForRoute<Route extends DeliveryTransitionRoute> = Extract<
  RunnableFrontierTransition,
  { readonly _tag: TransitionTagForRoute<Route> }
>

export type TransitionForAcceptedExecution<Execution extends AcceptedTransitionExecution> = Extract<
  RunnableFrontierTransition,
  { readonly _tag: TransitionTagForAcceptedExecution<Execution> }
>

type TransitionForPlannedAttemptProtocol<Protocol extends PlannedAttemptProtocolSource> = Extract<
  RunnableFrontierTransition,
  { readonly _tag: TransitionTagForPlannedAttemptProtocol<Protocol> }
>

export const acceptedTransitionExecutionOf = (
  transition: RunnableFrontierTransition
): AcceptedTransitionExecution | undefined => {
  const transitionPolicy: DeliveryTransitionPolicy = deliveryTransitionPolicy[transition._tag]
  return transitionPolicy.acceptedExecution
}

export const usesPlannedAttemptProtocol = (
  transition: RunnableFrontierTransition
): transition is TransitionForPlannedAttemptProtocol<"PlannedAttempt"> =>
  deliveryTransitionPolicy[transition._tag].plannedAttemptProtocol === "PlannedAttempt"

export const usesStopSubjectProtocol = (
  transition: RunnableFrontierTransition
): transition is TransitionForPlannedAttemptProtocol<"StopSubject"> =>
  deliveryTransitionPolicy[transition._tag].plannedAttemptProtocol === "StopSubject"
