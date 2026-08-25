import type { RunnableFrontierTransition } from "../frontier/frontier.js"

type DeliveryTransitionRoute = "AcceptedOperation" | "FreshProvenance" | "IdentityFree" | "NewOperation" | "Observation"

type PlannedAttemptProtocolSource = "None" | "PlannedAttempt" | "StopSubject"

type DeliveryTransitionPolicy = {
  readonly plannedAttemptProtocol: PlannedAttemptProtocolSource
  readonly route: DeliveryTransitionRoute
}

const policy = <const Route extends DeliveryTransitionRoute, const Protocol extends PlannedAttemptProtocolSource>(
  route: Route,
  plannedAttemptProtocol: Protocol
) => ({ plannedAttemptProtocol, route })

/** One closed classification drives proposal identity, admission, and adapter transition types. */
export const deliveryTransitionPolicy = {
  AcquireStartedIntegrationTarget: policy("IdentityFree", "None"),
  AdvanceAttemptRestart: policy("IdentityFree", "PlannedAttempt"),
  AdvanceAttemptStoppage: policy("IdentityFree", "StopSubject"),
  RelinquishCancelledAttemptImplementation: policy("IdentityFree", "PlannedAttempt"),
  CheckTaskClaim: policy("AcceptedOperation", "None"),
  CommitFreshTaskClaimIntent: policy("FreshProvenance", "None"),
  CommitTaskClaimReacquisitionIntent: policy("NewOperation", "None"),
  ContinueFreshWorkflowOperation: policy("FreshProvenance", "None"),
  ContinuePlannedAttemptExecutorWork: policy("IdentityFree", "PlannedAttempt"),
  ContinuePlannedAttemptExecutorWorkAfterCurrentFacts: policy("IdentityFree", "PlannedAttempt"),
  ObservePlannedAttemptContinuationExecutor: policy("IdentityFree", "PlannedAttempt"),
  ObserveAttemptStoppageExecutor: policy("IdentityFree", "StopSubject"),
  ObserveCancelledAttemptClaim: policy("Observation", "None"),
  FixIntegratorSuccessorSession: policy("IdentityFree", "None"),
  RecordChangedHeadRetryQuarantine: policy("IdentityFree", "None"),
  RecordInitialConclusiveIntegrationQuarantine: policy("IdentityFree", "None"),
  RecordPromotionStaleIntegrationQuarantine: policy("IdentityFree", "None"),
  RecordProviderRunFailureIntegrationQuarantine: policy("IdentityFree", "None"),
  RecordRetryConclusiveIntegrationQuarantine: policy("IdentityFree", "None"),
  RunIntegrator: policy("IdentityFree", "None"),
  RunTargetPromotion: policy("IdentityFree", "None"),
  ObservePromotedCandidateAncestryAfterBlockerClear: policy("IdentityFree", "None"),
  ReplacePromotedTaskClaim: policy("IdentityFree", "None"),
  CompletePromotedTask: policy("IdentityFree", "None"),
  ObserveFocusedTaskCompletion: policy("IdentityFree", "None"),
  DeleteCompletedTaskCompletionClaim: policy("IdentityFree", "None"),
  ObservePlannedAttemptContinuationClaim: policy("Observation", "None"),
  ObservePlannedAttemptContinuationGraph: policy("Observation", "None"),
  ObservePlannedAttemptContinuationSpecification: policy("Observation", "None"),
  ObservePlannedAttemptContinuationTargetLineage: policy("Observation", "None"),
  ObservePlannedAttemptContinuationWorktree: policy("Observation", "None"),
  ObserveResponsibleTaskClaim: policy("Observation", "None"),
  ObserveStoppedAttemptClaim: policy("Observation", "None"),
  QueueAcceptedResultIntegrationResponsibility: policy("IdentityFree", "None"),
  ReconcileTaskClaim: policy("AcceptedOperation", "None"),
  ReconcileTaskClaimRelease: policy("AcceptedOperation", "None"),
  ReconcileTaskWorktree: policy("AcceptedOperation", "None"),
  RecordStoppedAttemptClaimNoRelease: policy("IdentityFree", "None"),
  RecordCancelledAttemptClaimNoRelease: policy("IdentityFree", "None"),
  ReleaseExternallyCompletedTaskClaim: policy("NewOperation", "None"),
  ReleaseCancelledAttemptClaim: policy("NewOperation", "None"),
  ReleaseStoppedAttemptClaim: policy("NewOperation", "None"),
  RetryCancelledAttemptClaimRelease: policy("AcceptedOperation", "None"),
  RetryStoppedAttemptClaimRelease: policy("AcceptedOperation", "None"),
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

type TransitionTagForPlannedAttemptProtocol<Protocol extends PlannedAttemptProtocolSource> = {
  [Tag in keyof typeof deliveryTransitionPolicy]: (typeof deliveryTransitionPolicy)[Tag]["plannedAttemptProtocol"] extends Protocol
    ? Tag
    : never
}[keyof typeof deliveryTransitionPolicy]

export type TransitionForRoute<Route extends DeliveryTransitionRoute> = Extract<
  RunnableFrontierTransition,
  { readonly _tag: TransitionTagForRoute<Route> }
>

type TransitionForPlannedAttemptProtocol<Protocol extends PlannedAttemptProtocolSource> = Extract<
  RunnableFrontierTransition,
  { readonly _tag: TransitionTagForPlannedAttemptProtocol<Protocol> }
>

export const usesPlannedAttemptProtocol = (
  transition: RunnableFrontierTransition
): transition is TransitionForPlannedAttemptProtocol<"PlannedAttempt"> =>
  deliveryTransitionPolicy[transition._tag].plannedAttemptProtocol === "PlannedAttempt"

export const usesStopSubjectProtocol = (
  transition: RunnableFrontierTransition
): transition is TransitionForPlannedAttemptProtocol<"StopSubject"> =>
  deliveryTransitionPolicy[transition._tag].plannedAttemptProtocol === "StopSubject"
