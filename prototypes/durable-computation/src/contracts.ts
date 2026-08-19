import { Schema } from "effect"

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
  attemptId: "attempt-232-ambiguity-0001",
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
