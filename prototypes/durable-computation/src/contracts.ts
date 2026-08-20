import { GitCommitSha, RunId } from "@dalph/contracts"
import { OperationId } from "@dalph/orchestrator"
import { Schema } from "effect"

/** Identity of one delivery action crossing the experiment's process boundary. */
export const DeliveryLoopOperationId = OperationId
export type DeliveryLoopOperationId = OperationId

/** One-based position of a boundary call in the controlled outside world. */
export const DeliveryLoopBoundaryOrdinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("DeliveryLoopBoundaryOrdinal")
)

/** Revision of tracker facts returned by the controlled outside world. */
export const DeliveryLoopTrackerRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("DeliveryLoopTrackerRevision")
)

/** Provider-neutral task-tracker target used by the delivery-loop experiment. */
export const DeliveryLoopTarget = Schema.NonEmptyString.pipe(Schema.brand("DeliveryLoopTarget"))

/** OS process instance participating in one crash/restart scenario. */
export const DeliveryLoopProcessInstance = Schema.NonEmptyString.pipe(Schema.brand("DeliveryLoopProcessInstance"))

/** Durable Workflow execution identity observed by the parent harness. */
export const DeliveryLoopExecutionId = Schema.NonEmptyString.pipe(Schema.brand("DeliveryLoopExecutionId"))
export type DeliveryLoopExecutionId = typeof DeliveryLoopExecutionId.Type

/** Attempt reserved by the #232 fixture but deliberately not established by this experiment. */
export const DeliveryLoopReservedAttemptId = Schema.NonEmptyString.pipe(Schema.brand("DeliveryLoopReservedAttemptId"))
export type DeliveryLoopReservedAttemptId = typeof DeliveryLoopReservedAttemptId.Type

export const CurrentTaskDecision = Schema.Literals(["ContinueEligible", "StopOutsideTarget"])
export type CurrentTaskDecision = typeof CurrentTaskDecision.Type

export const AdapterName = Schema.Literals(["journal-baseline", "effect-workflow-v1", "effect-workflow-v2"])
export type AdapterName = typeof AdapterName.Type

export const FaultPoint = Schema.Literals([
  "AfterExecutionStored",
  "AfterClaimIntentBeforeRequest",
  "AfterClaimAppliedBeforeReplyRecorded",
  "AfterClaimReplyDurableBeforeNextRead",
  "AfterCleanCheckpoint",
  "AfterExitCutoff",
  "WithIncompatibleExecutionCode"
])
export type FaultPoint = typeof FaultPoint.Type

export const RecoveredDecision = Schema.Literals(["ContinueSameRun", "Wait", "FailClosed"])
export type RecoveredDecision = typeof RecoveredDecision.Type

export const ExactClaim = Schema.Struct({
  operationId: Schema.NonEmptyString,
  owner: Schema.NonEmptyString,
  taskId: Schema.NonEmptyString,
  token: Schema.NonEmptyString
})
export type ExactClaim = typeof ExactClaim.Type

export const OutsideWorld = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  applicationExitAdmission: Schema.Literals(["Open", "Closed"]),
  clockEpochMilliseconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  executorObservation: Schema.Literals(["Absent", "Running", "SafelySuspended", "Terminal"]),
  plannedBaseSha: Schema.NonEmptyString,
  task: Schema.Struct({
    claim: Schema.NullOr(ExactClaim),
    id: Schema.NonEmptyString,
    lifecycle: Schema.Literals(["Open", "Closed"]),
    targetMember: Schema.Boolean
  }),
  trackerRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
})
export type OutsideWorld = typeof OutsideWorld.Type

export const ProviderRequest = Schema.Literals([
  "GitHub.ReadClaim",
  "GitHub.CreateClaim",
  "GitHub.ReadCurrentTaskFacts",
  "GitHub.ReadTrackerGraph",
  "Git.ReadPlannedBase",
  "Executor.ObservePlannedAttempt",
  "ApplicationExit.CutoffObserved"
])
export type ProviderRequest = typeof ProviderRequest.Type

export const ProviderCall = Schema.Struct({
  adapter: AdapterName,
  ordinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  processInstance: Schema.NonEmptyString,
  replyDelivered: Schema.Boolean,
  request: ProviderRequest,
  result: Schema.NonEmptyString,
  trackerRevision: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)))
})
export type ProviderCall = typeof ProviderCall.Type

export const DeliveryLoopBoundaryCall = Schema.Struct({
  operationId: DeliveryLoopOperationId,
  ordinal: DeliveryLoopBoundaryOrdinal,
  processInstance: DeliveryLoopProcessInstance,
  target: DeliveryLoopTarget,
  trackerRevision: DeliveryLoopTrackerRevision
})
export type DeliveryLoopBoundaryCall = typeof DeliveryLoopBoundaryCall.Type

export const DeliveryLoopPublication = Schema.Struct({
  acceptedOperationId: DeliveryLoopOperationId,
  operationId: DeliveryLoopOperationId,
  processInstance: DeliveryLoopProcessInstance,
  target: DeliveryLoopTarget,
  trackerRevision: DeliveryLoopTrackerRevision
})
export type DeliveryLoopPublication = typeof DeliveryLoopPublication.Type

export const DeliveryLoopProposalObservation = Schema.Literals([
  "PresentBeforeCrash",
  "PresentAfterRestartBeforePublication",
  "AbsentAfterAcceptedFactPublication"
])
export type DeliveryLoopProposalObservation = typeof DeliveryLoopProposalObservation.Type

export const DeliveryLoopChildMessage = Schema.TaggedUnion({
  DeliveryLoopChildReady: {
    attemptIds: Schema.Array(Schema.NonEmptyString),
    executionId: DeliveryLoopExecutionId,
    plannedBaseSha: GitCommitSha,
    reservedAttemptId: DeliveryLoopReservedAttemptId,
    runId: RunId
  },
  DeliveryLoopCompleted: { currentTaskDecision: CurrentTaskDecision, runId: RunId },
  DeliveryLoopFaultReached: { runId: RunId },
  DeliveryLoopPublicationSuppressed: { runId: RunId },
  DeliveryLoopProtocolFailure: { detail: Schema.NonEmptyString }
})
export type DeliveryLoopChildMessage = typeof DeliveryLoopChildMessage.Type

export interface DeliveryLoopScenarioRequest {
  readonly actionCount: 1 | 2
  readonly adapter: "effect-workflow-v1" | "journal-baseline"
  readonly activityIdentityMode?: "ExactOperationId" | "Generic"
  readonly publicationMode?: "Publish" | "Suppress"
}

export interface DeliveryLoopScenarioResult {
  readonly attemptIds: ReadonlyArray<string>
  readonly boundaryCalls: ReadonlyArray<DeliveryLoopBoundaryCall>
  readonly canonicalTrace: ReadonlyArray<CanonicalDeliveryLoopEvent>
  readonly currentTaskDecisions: ReadonlyArray<CurrentTaskDecision>
  readonly executionIds: ReadonlyArray<DeliveryLoopExecutionId>
  readonly proposalObservations: ReadonlyArray<DeliveryLoopProposalObservation>
  readonly providerCalls: ReadonlyArray<ProviderCall>
  readonly publications: ReadonlyArray<DeliveryLoopPublication>
  readonly publicationSuppressed: boolean
  readonly reservedAttemptIds: ReadonlyArray<DeliveryLoopReservedAttemptId>
}

export type CanonicalDeliveryLoopEvent =
  | { readonly _tag: "DeliveryProposalPresent" }
  | {
      readonly _tag: "DeliveryActionAccepted"
      readonly acceptedOperationId: DeliveryLoopOperationId
      readonly operationId: DeliveryLoopOperationId
      readonly target: typeof DeliveryLoopTarget.Type
    }
  | { readonly _tag: "DeliveryProposalAbsent" }
  | {
      readonly _tag: "CurrentTaskFactsObserved"
      readonly result: string
      readonly trackerRevision: typeof DeliveryLoopTrackerRevision.Type
    }
  | { readonly _tag: "CurrentTaskDecisionMade"; readonly decision: CurrentTaskDecision }

export const ChildMessage = Schema.TaggedUnion({
  ChildProtocolFailure: { detail: Schema.NonEmptyString },
  ChildReady: {
    adapter: AdapterName,
    attemptIds: Schema.Array(Schema.NonEmptyString),
    executionId: Schema.NonEmptyString,
    plannedBaseSha: Schema.NonEmptyString,
    runId: Schema.NonEmptyString
  },
  ExecutionCompleted: {
    adapter: AdapterName,
    recoveredDecision: RecoveredDecision,
    runId: Schema.NonEmptyString
  },
  ExecutionFailedClosed: { adapter: AdapterName, detail: Schema.NonEmptyString, runId: Schema.NonEmptyString },
  FaultReached: { faultPoint: FaultPoint, runId: Schema.NonEmptyString }
})
export type ChildMessage = typeof ChildMessage.Type

export interface ScenarioRequest {
  readonly adapter: AdapterName
  readonly faultPoint: FaultPoint
}

export interface ScenarioResult {
  readonly attemptIds: ReadonlyArray<string>
  readonly canonicalTrace: ReadonlyArray<CanonicalTraceEvent>
  readonly executionIds: ReadonlyArray<string>
  readonly failureDetail?: string
  readonly operationalMetrics: {
    readonly cleanupMilliseconds: number
    readonly firstProcessResidentKiB: number
    readonly firstProcessToFaultMilliseconds: number
    readonly restartToProgressMilliseconds: number
  }
  readonly providerCalls: ReadonlyArray<ProviderCall>
  readonly recoveredDecision: RecoveredDecision
}

export type CanonicalTraceEvent =
  | { readonly _tag: "RunExecutionEstablished"; readonly plannedBaseSha: string; readonly runId: string }
  | {
      readonly _tag: "TaskClaimAcquisitionIntended"
      readonly owner: string
      readonly taskId: string
      readonly token: string
    }
  | { readonly _tag: "TaskClaimObserved"; readonly result: string; readonly trackerRevision: number }
  | { readonly _tag: "TaskClaimRequestApplied"; readonly trackerRevision: number }
  | { readonly _tag: "CurrentTaskFactsObserved"; readonly result: string; readonly trackerRevision: number }
  | { readonly _tag: "ApplicationExitCutoffApplied" }
  | {
      readonly _tag: "ExecutionCodeRejected"
      readonly changedStep: "ReconcileExactTaskClaimV2"
      readonly found: "v1"
      readonly requested: "v2"
    }
  | { readonly _tag: "RunDecisionRecovered"; readonly decision: RecoveredDecision }

export const fixture = {
  attemptId: DeliveryLoopReservedAttemptId.make("attempt-232-ambiguity-0001"),
  claim: ExactClaim.make({
    operationId: "claim-operation-232-0001",
    owner: "dalph-evaluation-owner",
    taskId: "github:dearlordylord/dalph#232-fixture-task",
    token: "claim-token-232-0001"
  }),
  plannedBaseSha: "d4128e475ddfdda6970ac7951ce7696d7736685a",
  clockEpochMilliseconds: 1_786_665_600_000,
  runId: "run-232-ambiguity-0001"
} as const

export const deliveryLoopFixture = {
  journalRunId: RunId.make("run-233-delivery-loop-journal-0001"),
  plannedBaseSha: GitCommitSha.make(fixture.plannedBaseSha),
  runId: RunId.make("run-233-delivery-loop-0001")
} as const
