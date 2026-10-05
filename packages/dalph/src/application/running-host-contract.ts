import { LocalHostAddress } from "./running-host-address.js"
import {
  AttemptId,
  ExecutorGuidanceRequestId,
  ExecutorGuidanceTransmission,
  PlannedAttemptExecutorCorrelation,
  PlannedTaskAttempt,
  RunId,
  TaskId,
  TaskRevision
} from "@dalph/contracts"
import {
  ApplyResultRecoveryRequest,
  ResultRecoveryRequestId,
  BoundedTicketRank,
  ControlDirectionApplicationOrdinal,
  RunControlPolicy,
  RunTerminationDisposition,
  TaskDagWire,
  TraceCursor,
  TrackerTarget
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import { ObligationReference } from "./production-cli-status-identity-schema.js"
import { ProductionCliCurrentDeliveryStatus } from "./production-cli-status-schema.js"

export { LocalHostAddress } from "./running-host-address.js"

const SafeInteger = Schema.Int.check(
  Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER })
)
const Count = SafeInteger.check(Schema.isGreaterThanOrEqualTo(0))
const PositiveCount = SafeInteger.check(Schema.isGreaterThanOrEqualTo(1))
/** Process-local watch identity, with no replay or workflow authority. */
export const SubscriptionId = Schema.NonEmptyString.pipe(Schema.brand("RunningHostSubscriptionId"))
export type SubscriptionId = typeof SubscriptionId.Type
/** Counts emitted frames only, independently of accepted journal positions. */
export const WatchSequence = Count.pipe(Schema.brand("WatchSequence"))
/** A particular listening process, never a durable Run or command receipt. */
export const HostInstanceId = Schema.NonEmptyString.pipe(Schema.brand("HostInstanceId"))
export type HostInstanceId = typeof HostInstanceId.Type
/** Correlates one client invocation; it confers no durable replay identity. */
export const RequestId = Schema.NonEmptyString.pipe(Schema.brand("RunningHostRequestId"))
export type RequestId = typeof RequestId.Type

export const runningHostLimits = {
  requestBytes: 65536,
  resultBytes: 2097152,
  frameBytes: 8388608,
  hostSubscriptions: 32,
  mcpSessionWatches: 8,
  writeDeadlineMillis: 5000,
  unreadWatchMillis: 30000,
  closedResourceMillis: 30000,
  connectDeadlineMillis: 5000,
  responseDeadlineMillis: 30000
} as const
const Limits = Schema.Struct({
  requestBytes: Schema.Literal(runningHostLimits.requestBytes),
  resultBytes: Schema.Literal(runningHostLimits.resultBytes),
  frameBytes: Schema.Literal(runningHostLimits.frameBytes),
  hostSubscriptions: Schema.Literal(runningHostLimits.hostSubscriptions),
  mcpSessionWatches: Schema.Literal(runningHostLimits.mcpSessionWatches),
  writeDeadlineMillis: Schema.Literal(runningHostLimits.writeDeadlineMillis),
  unreadWatchMillis: Schema.Literal(runningHostLimits.unreadWatchMillis),
  closedResourceMillis: Schema.Literal(runningHostLimits.closedResourceMillis),
  connectDeadlineMillis: Schema.Literal(runningHostLimits.connectDeadlineMillis),
  responseDeadlineMillis: Schema.Literal(runningHostLimits.responseDeadlineMillis)
})
export const RunningHostDescriptor = Schema.TaggedStruct("HostDescriptor", {
  protocolVersion: Schema.Literal(1),
  hostInstanceId: HostInstanceId,
  selectedRun: Schema.Struct({ runId: RunId, target: TrackerTarget }),
  limits: Limits
})
export type RunningHostDescriptor = typeof RunningHostDescriptor.Type
export const RunningHostReady = Schema.TaggedStruct("HostReady", {
  address: LocalHostAddress,
  descriptor: RunningHostDescriptor
})

/** Requested interest only: never tracker facts, graph coverage, root expansion or task selection. */
export const RefreshInterest = Schema.TaggedUnion({
  WholeGraph: {},
  AdvisoryTasks: {
    taskIds: Schema.NonEmptyArray(TaskId).check(
      Schema.makeFilter((ids) => new Set(ids).size === ids.length || "advisory task IDs must be distinct")
    )
  }
})
export type RefreshInterest = typeof RefreshInterest.Type
const Operation = Schema.TaggedUnion({
  ReadSnapshot: {},
  ReadRunControl: {},
  ReadResultRecoveryDirection: { recoveryRequestId: ResultRecoveryRequestId },
  ApplyResultRecoveryDirection: { recovery: ApplyResultRecoveryRequest },
  SendExecutorGuidance: {
    attemptId: AttemptId,
    guidanceRequestId: ExecutorGuidanceRequestId,
    textBase64: Schema.String
  },
  StartWork: {},
  Unpause: {},
  Refresh: { interest: RefreshInterest },
  WatchSnapshots: {}
})
const CommandOperation = Schema.Literals([
  "StartWork",
  "Unpause",
  "Refresh",
  "ApplyResultRecoveryDirection",
  "SendExecutorGuidance"
])
const requestFields = { hostInstanceId: HostInstanceId, requestId: RequestId, runId: RunId, operation: Operation }
export const RunningHostRequest = Schema.Struct({ protocolVersion: Schema.Literal(1), ...requestFields })
export type RunningHostRequest = typeof RunningHostRequest.Type
/** Only explicit commands may acquire host operation ownership. */
export type RunningHostCommandRequest = Omit<RunningHostRequest, "operation"> & {
  readonly operation: Extract<
    RunningHostRequest["operation"],
    { readonly _tag: "StartWork" | "Unpause" | "Refresh" | "ApplyResultRecoveryDirection" | "SendExecutorGuidance" }
  >
}
const VersionedRequest = Schema.Struct({ protocolVersion: SafeInteger, ...requestFields })

export const RunningHostError = Schema.TaggedUnion({
  InvalidRequest: { fieldPath: Schema.String, code: Schema.NonEmptyString },
  RunMismatch: { requestedRunId: RunId, selectedRunId: RunId },
  HostInstanceMismatch: { requestedHostInstanceId: HostInstanceId, actualHostInstanceId: HostInstanceId },
  HostUnavailable: { address: LocalHostAddress, reason: Schema.NonEmptyString },
  ProtocolVersionUnsupported: { requestedVersion: SafeInteger, supportedVersions: Schema.Tuple([Schema.Literal(1)]) },
  HostClosing: { hostInstanceId: HostInstanceId, cutoff: Schema.Literal("AdmissionClosed") },
  RunClosed: { runId: RunId, disposition: RunTerminationDisposition, terminatedAt: TraceCursor },
  CommandFailed: {
    operation: CommandOperation,
    causeTag: Schema.NonEmptyString,
    detail: Schema.NonEmptyString,
    stage: Schema.Literals(["PreAdmission", "BeforeApplication"])
  },
  UnpausePartiallyApplied: {
    ordinal: ControlDirectionApplicationOrdinal,
    acceptedAt: TraceCursor,
    causeTag: Schema.NonEmptyString,
    detail: Schema.NonEmptyString
  },
  CommandOutcomeUnknown: {
    guidanceRequestId: Schema.optionalKey(ExecutorGuidanceRequestId),
    operation: CommandOperation,
    requestId: RequestId,
    phase: Schema.Literals(["AdmissionUnconfirmed", "AdmittedCompletionUnconfirmed"]),
    acceptedAt: Schema.NullOr(TraceCursor)
  },
  ReadFailed: { causeTag: Schema.NonEmptyString, detail: Schema.NonEmptyString },
  ProjectionFailed: { causeTag: Schema.NonEmptyString, detail: Schema.NonEmptyString },
  FrameTooLarge: {
    direction: Schema.Literals(["Incoming", "Outgoing"]),
    maximumBytes: PositiveCount,
    measuredBytes: Schema.NullOr(Count)
  },
  SubscriptionLimitExceeded: { scope: Schema.Literals(["Host", "McpSession"]), limit: PositiveCount, current: Count },
  WriteTimedOut: {
    subject: Schema.Union([
      Schema.TaggedStruct("Request", { requestId: RequestId }),
      Schema.TaggedStruct("Subscription", { subscriptionId: SubscriptionId })
    ]),
    deadlineMillis: PositiveCount
  },
  TransportFailed: {
    phase: Schema.Literals(["Connect", "Handshake", "Response", "Watch", "Write"]),
    reason: Schema.NonEmptyString
  }
})
export type RunningHostError = typeof RunningHostError.Type

const Reason = Schema.TaggedUnion({
  PrerequisitesIncomplete: { prerequisiteTaskIds: Schema.Array(TaskId) },
  SuccessfulCompletion: {},
  TerminalWithoutSuccess: {}
})
const Standing = Schema.TaggedUnion({
  Eligible: { taskId: TaskId, taskRevision: TaskRevision },
  Excluded: { taskId: TaskId, reasons: Schema.NonEmptyArray(Reason) }
})
const Placement = Schema.TaggedUnion({
  Selected: { rank: BoundedTicketRank },
  EligibleOutsideBound: { rank: BoundedTicketRank },
  GraphExcluded: { reasons: Schema.NonEmptyArray(Reason) }
})
const ReadySnapshotShape = Schema.TaggedStruct("Ready", {
  runId: RunId,
  acceptedAt: Schema.NullOr(TraceCursor),
  graph: Schema.TaggedUnion({ GraphNotEstablished: {}, GraphEstablished: { snapshot: TaskDagWire } }),
  frontier: Schema.Struct({
    policy: RunControlPolicy,
    standings: Schema.Array(Standing),
    placements: Schema.Array(Schema.Struct({ taskId: TaskId, placement: Placement }))
  }),
  delivery: ProductionCliCurrentDeliveryStatus,
  retained: Schema.Array(
    Schema.Struct({
      taskId: TaskId,
      obligationReference: ObligationReference,
      kind: Schema.Literals([
        "WorkflowResponsibility",
        "AcceptedAwaitingIntegration",
        "QueuedIntegration",
        "StartedIntegration"
      ]),
      plannedAttempt: Schema.NullOr(PlannedTaskAttempt)
    })
  ),
  held: Schema.Array(Schema.Struct({ taskId: TaskId, correlation: PlannedAttemptExecutorCorrelation }))
})
/** Reject inconsistent identities or unsafe numeric encodings anywhere in a public value. */
const coherentWire = (value: unknown, runId: RunId | null): boolean => {
  if (typeof value === "number") return Number.isSafeInteger(value)
  if (value === null || typeof value !== "object") return true
  if (runId !== null && "runId" in value && value.runId !== runId) return false
  return Object.values(value).every((nested) => coherentWire(nested, runId))
}
const ReadySnapshot = ReadySnapshotShape.check(
  Schema.makeFilter(
    (value) =>
      (coherentWire(value, value.runId) &&
        value.delivery._tag === "DeliveryStatusAvailable" &&
        value.delivery.subject._tag === "Run" &&
        value.delivery.acceptedAt === (value.acceptedAt?.position ?? null) &&
        new Set(value.retained.map(({ obligationReference }) => obligationReference)).size === value.retained.length &&
        value.retained.every(
          ({ plannedAttempt, taskId }) => plannedAttempt === null || plannedAttempt.taskId === taskId
        )) ||
      "snapshot identities, accepted position and exact retained obligations must agree"
  )
)
export const RunningHostSnapshot = Schema.Union([
  Schema.TaggedStruct("NotReady", { runId: RunId }),
  ReadySnapshot,
  Schema.TaggedStruct("Closed", { runId: RunId, final: Schema.NullOr(ReadySnapshot) }).check(
    Schema.makeFilter((value) => coherentWire(value, value.runId) || "closed publication belongs to another Run")
  )
])
export type RunningHostSnapshot = typeof RunningHostSnapshot.Type
export const RunningHostWatchFrame = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  requestId: RequestId,
  runId: RunId,
  subscriptionId: SubscriptionId,
  sequence: WatchSequence,
  frame: Schema.TaggedUnion({ Snapshot: { value: RunningHostSnapshot }, Failure: { error: RunningHostError } })
}).check(
  Schema.makeFilter((value) => coherentWire(value.frame, value.runId) || "watch publication belongs to another Run")
)
export type RunningHostWatchFrame = typeof RunningHostWatchFrame.Type
export const watchFrameEnds = (value: RunningHostWatchFrame) =>
  value.frame._tag === "Failure" || value.frame.value._tag === "Closed"
export const encodeRunningHostWatchFrame = Effect.fn("RunningHost.encodeWatchFrame")(function* (
  frame: RunningHostWatchFrame
) {
  const encoded = yield* Schema.encodeUnknownEffect(RunningHostWatchFrame)(frame, { onExcessProperty: "error" }).pipe(
    Effect.mapError(
      (): RunningHostError => ({
        _tag: "ProjectionFailed",
        causeTag: "WatchSchemaInvalid",
        detail: "The watch does not satisfy the public schema."
      })
    )
  )
  const text = JSON.stringify(encoded)
  const measuredBytes = new TextEncoder().encode(text).byteLength
  if (measuredBytes > runningHostLimits.resultBytes)
    return yield* Effect.fail<RunningHostError>({
      _tag: "FrameTooLarge",
      direction: "Outgoing",
      maximumBytes: runningHostLimits.resultBytes,
      measuredBytes
    })
  return text
})
const PendingEvidence = Schema.TaggedUnion({
  Pending: {},
  FinalityFailed: {
    failure: Schema.TaggedStruct("WorkflowRunTerminationEvidenceInvalid", { runId: RunId, detail: Schema.String })
  }
})
export const RunningHostRunControl = Schema.TaggedUnion({
  RunPaused: { controlObservedAt: TraceCursor, terminationEvidence: PendingEvidence },
  RunUnpaused: { controlObservedAt: TraceCursor, terminationEvidence: PendingEvidence },
  RunTerminated: {
    terminationEvidence: Schema.TaggedStruct("Accepted", {
      disposition: RunTerminationDisposition,
      terminatedAt: TraceCursor
    })
  }
})
export type RunningHostRunControl = typeof RunningHostRunControl.Type
const Value = Schema.Union([
  RunningHostSnapshot,
  RunningHostRunControl,
  Schema.TaggedStruct("ResultRecoveryDirectionRecorded", {
    recovery: ApplyResultRecoveryRequest,
    acceptedAt: TraceCursor
  }),
  Schema.TaggedStruct("ResultRecoveryDirectionNotRecorded", { recoveryRequestId: ResultRecoveryRequestId }),
  Schema.TaggedStruct("ExecutorGuidanceResult", {
    guidanceRequestId: ExecutorGuidanceRequestId,
    disposition: ExecutorGuidanceTransmission
  }),
  Schema.TaggedStruct("WakeSubmitted", {}),
  Schema.TaggedStruct("RefreshSubmitted", { interest: RefreshInterest }),
  Schema.TaggedStruct("WatchOpened", { subscriptionId: SubscriptionId, uri: Schema.NonEmptyString }),
  Schema.TaggedStruct("WatchClosed", { subscriptionId: SubscriptionId }),
  Schema.TaggedStruct("UnpauseApplied", { ordinal: ControlDirectionApplicationOrdinal, acceptedAt: TraceCursor })
])
export type RunningHostValue = typeof Value.Type
export type RunningHostCommandValue = Extract<
  RunningHostValue,
  {
    readonly _tag:
      | "WakeSubmitted"
      | "UnpauseApplied"
      | "RefreshSubmitted"
      | "ResultRecoveryDirectionRecorded"
      | "ExecutorGuidanceResult"
  }
>
const RunningHostEnvelopeShape = Schema.Union([
  Schema.Struct({
    protocolVersion: Schema.Literal(1),
    requestId: RequestId,
    runId: RunId,
    result: Schema.TaggedStruct("Success", { value: Value })
  }),
  Schema.Struct({
    protocolVersion: Schema.Literal(1),
    requestId: Schema.NullOr(RequestId),
    runId: Schema.NullOr(RunId),
    result: Schema.TaggedStruct("Failure", { error: RunningHostError })
  })
])
export const RunningHostEnvelope = RunningHostEnvelopeShape.check(
  Schema.makeFilter(
    (envelope) =>
      (envelope.result._tag === "Failure" &&
        coherentWire(envelope.result.error, envelope.runId) &&
        (envelope.result.error._tag !== "CommandOutcomeUnknown" ||
          envelope.result.error.requestId === envelope.requestId)) ||
      (envelope.result._tag === "Success" &&
        envelope.runId !== null &&
        coherentWire(envelope.result.value, envelope.runId)) ||
      "response evidence must belong to the selected Run and use safe integer positions"
  )
)
export type RunningHostEnvelope = typeof RunningHostEnvelope.Type

export const decodeRunningHostRequest = Effect.fn("RunningHost.decodeRequest")(function* (
  input: unknown,
  descriptor: RunningHostDescriptor
) {
  const request = yield* Schema.decodeUnknownEffect(VersionedRequest)(input, { onExcessProperty: "error" }).pipe(
    Effect.mapError((): RunningHostError => ({ _tag: "InvalidRequest", fieldPath: "", code: "RequestSchemaInvalid" }))
  )
  if (request.protocolVersion !== 1)
    return yield* Effect.fail<RunningHostError>({
      _tag: "ProtocolVersionUnsupported",
      requestedVersion: request.protocolVersion,
      supportedVersions: [1]
    })
  if (request.hostInstanceId !== descriptor.hostInstanceId)
    return yield* Effect.fail<RunningHostError>({
      _tag: "HostInstanceMismatch",
      requestedHostInstanceId: request.hostInstanceId,
      actualHostInstanceId: descriptor.hostInstanceId
    })
  if (request.runId !== descriptor.selectedRun.runId)
    return yield* Effect.fail<RunningHostError>({
      _tag: "RunMismatch",
      requestedRunId: request.runId,
      selectedRunId: descriptor.selectedRun.runId
    })
  if (!coherentWire(request.operation, request.runId))
    return yield* Effect.fail<RunningHostError>({
      _tag: "InvalidRequest",
      fieldPath: "/operation",
      code: "RecoveryRunMismatch"
    })
  return { ...request, protocolVersion: 1 as const }
})

const correlation = (input: unknown) => {
  const record = typeof input === "object" && input !== null ? input : {}
  const requestId = "requestId" in record ? record.requestId : null
  const runId = "runId" in record ? record.runId : null
  return {
    requestId: typeof requestId === "string" && requestId.length > 0 ? RequestId.make(requestId) : null,
    runId: typeof runId === "string" && runId.length > 0 ? RunId.make(runId) : null
  }
}
export const runningHostFailureEnvelope = (input: unknown, error: RunningHostError): RunningHostEnvelope => ({
  protocolVersion: 1,
  ...correlation(input),
  result: { _tag: "Failure", error }
})
export const runningHostSuccessEnvelope = (
  request: RunningHostRequest,
  value: RunningHostValue
): RunningHostEnvelope => ({
  protocolVersion: 1,
  requestId: request.requestId,
  runId: request.runId,
  result: { _tag: "Success", value }
})
export const encodeRunningHostEnvelope = Effect.fn("RunningHost.encodeEnvelope")(function* (
  envelope: RunningHostEnvelope
) {
  const encoded = yield* Schema.encodeUnknownEffect(RunningHostEnvelope)(envelope, { onExcessProperty: "error" }).pipe(
    Effect.mapError(
      (): RunningHostError => ({
        _tag: "ProjectionFailed",
        causeTag: "ResponseSchemaInvalid",
        detail: "The response does not satisfy the public schema."
      })
    )
  )
  const json = JSON.stringify(encoded)
  const measuredBytes = new TextEncoder().encode(json).byteLength
  if (measuredBytes > runningHostLimits.resultBytes)
    return yield* Effect.fail<RunningHostError>({
      _tag: "FrameTooLarge",
      direction: "Outgoing",
      maximumBytes: runningHostLimits.resultBytes,
      measuredBytes
    })
  return json
})
