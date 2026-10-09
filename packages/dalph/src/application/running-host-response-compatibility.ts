import type { RunningHostError, RunningHostRequest, RunningHostEnvelope } from "./running-host-contract.js"

const successTags: Readonly<Record<RunningHostRequest["operation"]["_tag"], ReadonlyArray<string>>> = {
  ReadOccurrencePage: ["OccurrencePage", "OccurrenceTooLarge"],
  ReadSnapshot: ["NotReady", "Ready", "Closed"],
  ReadInspectionSnapshot: ["InspectionSnapshot"],
  RefreshInspection: ["InspectionSnapshot"],
  WatchInspection: [],
  ReadCapacity: ["CapacityRead"],
  SetCapacity: ["CapacityApplied"],
  ReadRunControl: ["RunPaused", "RunUnpaused", "RunTerminated"],
  ReadResultRecoveryDirection: ["ResultRecoveryDirectionRecorded", "ResultRecoveryDirectionNotRecorded"],
  ApplyResultRecoveryDirection: ["ResultRecoveryDirectionRecorded"],
  RetryTaskAttemptBase: ["TaskAttemptBaseRetryRecorded"],
  SendExecutorGuidance: ["ExecutorGuidanceResult"],
  StartWork: ["WakeSubmitted"],
  Refresh: ["RefreshSubmitted"],
  Unpause: ["UnpauseApplied"],
  WatchSnapshots: []
}
const inspectionOperations = [
  "ReadOccurrencePage",
  "ReadInspectionSnapshot",
  "RefreshInspection",
  "WatchInspection"
] as const
const compatibleFailures: Readonly<
  Record<RunningHostError["_tag"], ReadonlyArray<RunningHostRequest["operation"]["_tag"]>>
> = {
  SubscriptionLimitExceeded: ["WatchSnapshots", "WatchInspection"],
  ObserverRetentionExceeded: ["WatchSnapshots", "WatchInspection"],
  RunInactive: ["ReadCapacity", "SetCapacity"],
  PolicyRevisionConflict: ["SetCapacity"],
  UnpausePartiallyApplied: ["Unpause"],
  RunClosed: [
    "ReadCapacity",
    "SetCapacity",
    "StartWork",
    "Unpause",
    "Refresh",
    "ApplyResultRecoveryDirection",
    "RetryTaskAttemptBase",
    "SendExecutorGuidance"
  ],
  ReadFailed: [
    "ReadOccurrencePage",
    "ReadSnapshot",
    "ReadRunControl",
    "ReadCapacity",
    "ReadResultRecoveryDirection",
    "ReadInspectionSnapshot",
    "RefreshInspection",
    "WatchInspection"
  ],
  ProjectionFailed: [
    "ReadOccurrencePage",
    "ReadSnapshot",
    "ReadRunControl",
    "ReadCapacity",
    "ReadResultRecoveryDirection",
    "ReadInspectionSnapshot",
    "RefreshInspection",
    "WatchInspection"
  ],
  CommandFailed: [
    "SetCapacity",
    "StartWork",
    "Unpause",
    "Refresh",
    "ApplyResultRecoveryDirection",
    "RetryTaskAttemptBase",
    "SendExecutorGuidance"
  ],
  CommandOutcomeUnknown: [
    "SetCapacity",
    "StartWork",
    "Unpause",
    "Refresh",
    "ApplyResultRecoveryDirection",
    "RetryTaskAttemptBase",
    "SendExecutorGuidance"
  ],
  FrameTooLarge: [
    ...inspectionOperations,
    "SetCapacity",
    "ReadSnapshot",
    "ReadRunControl",
    "ReadCapacity",
    "StartWork",
    "Unpause",
    "Refresh",
    "ApplyResultRecoveryDirection",
    "RetryTaskAttemptBase",
    "SendExecutorGuidance",
    "ReadResultRecoveryDirection"
  ],
  HostClosing: [
    ...inspectionOperations,
    "SetCapacity",
    "ReadSnapshot",
    "ReadRunControl",
    "ReadCapacity",
    "StartWork",
    "Unpause",
    "Refresh",
    "ApplyResultRecoveryDirection",
    "RetryTaskAttemptBase",
    "SendExecutorGuidance",
    "ReadResultRecoveryDirection"
  ],
  HostInstanceMismatch: [
    ...inspectionOperations,
    "SetCapacity",
    "ReadSnapshot",
    "ReadRunControl",
    "ReadCapacity",
    "StartWork",
    "Unpause",
    "Refresh",
    "ApplyResultRecoveryDirection",
    "RetryTaskAttemptBase",
    "SendExecutorGuidance",
    "ReadResultRecoveryDirection"
  ],
  HostUnavailable: [
    ...inspectionOperations,
    "SetCapacity",
    "ReadSnapshot",
    "ReadRunControl",
    "ReadCapacity",
    "StartWork",
    "Unpause",
    "Refresh",
    "ApplyResultRecoveryDirection",
    "RetryTaskAttemptBase",
    "SendExecutorGuidance",
    "ReadResultRecoveryDirection"
  ],
  InvalidRequest: [
    ...inspectionOperations,
    "SetCapacity",
    "ReadSnapshot",
    "ReadRunControl",
    "ReadCapacity",
    "StartWork",
    "Unpause",
    "Refresh",
    "ApplyResultRecoveryDirection",
    "RetryTaskAttemptBase",
    "SendExecutorGuidance",
    "ReadResultRecoveryDirection"
  ],
  ProtocolVersionUnsupported: [
    ...inspectionOperations,
    "SetCapacity",
    "ReadSnapshot",
    "ReadRunControl",
    "ReadCapacity",
    "StartWork",
    "Unpause",
    "Refresh",
    "ApplyResultRecoveryDirection",
    "RetryTaskAttemptBase",
    "SendExecutorGuidance",
    "ReadResultRecoveryDirection"
  ],
  RunMismatch: [
    ...inspectionOperations,
    "SetCapacity",
    "ReadSnapshot",
    "ReadRunControl",
    "ReadCapacity",
    "StartWork",
    "Unpause",
    "Refresh",
    "ApplyResultRecoveryDirection",
    "RetryTaskAttemptBase",
    "SendExecutorGuidance",
    "ReadResultRecoveryDirection"
  ],
  TransportFailed: [
    ...inspectionOperations,
    "SetCapacity",
    "ReadSnapshot",
    "ReadRunControl",
    "ReadCapacity",
    "StartWork",
    "Unpause",
    "Refresh",
    "ApplyResultRecoveryDirection",
    "RetryTaskAttemptBase",
    "SendExecutorGuidance",
    "ReadResultRecoveryDirection"
  ],
  WriteTimedOut: [
    ...inspectionOperations,
    "SetCapacity",
    "ReadSnapshot",
    "ReadRunControl",
    "ReadCapacity",
    "StartWork",
    "Unpause",
    "Refresh",
    "ApplyResultRecoveryDirection",
    "RetryTaskAttemptBase",
    "SendExecutorGuidance",
    "ReadResultRecoveryDirection"
  ]
}
const compatibleFailure = (request: RunningHostRequest, error: RunningHostError): boolean =>
  (!("operation" in error) || error.operation === request.operation._tag) &&
  compatibleFailures[error._tag].includes(request.operation._tag)

/** Refuse evidence that belongs to another operation. */
export const compatibleRunningHostResponse = (request: RunningHostRequest, envelope: RunningHostEnvelope): boolean =>
  envelope.result._tag === "Success"
    ? successTags[request.operation._tag].includes(envelope.result.value._tag)
    : compatibleFailure(request, envelope.result.error)
