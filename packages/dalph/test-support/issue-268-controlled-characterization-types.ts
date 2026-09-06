import type {
  PlannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorObservationPurpose,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  TaskId,
  TaskRevision
} from "@dalph/contracts"
import type {
  ApplyAttemptChoiceRequest,
  ApplicationExitTraceEvent,
  AttemptChoiceApplicationResult,
  DeliveryRelationInputBundle,
  JournalRecord,
  RunControlPolicy,
  RunFinalityDecision,
  SetTaskWorkCapacityRequest,
  TaskClaimAcquisition,
  TraceItem,
  TrackerRevision,
  TrackerTarget
} from "@dalph/orchestrator"
import type { Issue268OccurrenceEvidence } from "./issue-268-controlled-occurrences.js"

export interface Issue268ExecutorCommandCapture {
  readonly attemptId: string
  readonly command: "Begin" | "Resume" | "Suspend"
}

export interface Issue268StartupCharacterization {
  readonly claimReleaseOrder: ReadonlyArray<string>
  readonly claimRequests: ReadonlyArray<TaskClaimAcquisition>
  readonly commands: ReadonlyArray<Issue268ExecutorCommandCapture>
  readonly decision: RunFinalityDecision | undefined
  readonly executedActions: ReadonlyArray<{ readonly stage: string; readonly taskId: string }>
  readonly pendingClaimTaskIds: ReadonlyArray<string>
  readonly plans: ReadonlyArray<PlannedTaskAttempt>
  readonly publications: ReadonlyArray<DeliveryRelationInputBundle>
  readonly records: ReadonlyArray<JournalRecord>
  readonly trace: ReadonlyArray<TraceItem>
  readonly worktreeCreateRequests: ReadonlyArray<PlannedTaskAttempt>
  readonly ds01?: Issue268Ds01CheckpointEvidence
  readonly ds02?: Issue268Ds02CheckpointEvidence
  readonly ds03?: Issue268Ds03Characterization
  readonly ds04?: Issue268Ds04Characterization
  readonly ds05?: Issue268Ds05Characterization
  readonly ds06?: Issue268Ds06Characterization
  readonly ds07?: Issue268Ds07Characterization
  readonly ds08?: Issue268Ds08Characterization
}

/** The selected G0 frontier while A/B/C claim mutations are still held by the fixture. */
export interface Issue268Ds01CheckpointEvidence {
  readonly pendingClaimTaskIds: ReadonlyArray<string>
  readonly snapshot: Issue268Ds03BoundarySnapshot
}

/** The first publication boundary after A1/B1/C1 have each become Executing. */
export interface Issue268Ds02CheckpointEvidence {
  readonly snapshot: Issue268Ds03BoundarySnapshot
}

export interface Issue268Ds03BoundarySnapshot {
  readonly claimRequests: ReadonlyArray<TaskClaimAcquisition>
  readonly commands: ReadonlyArray<Issue268ExecutorCommandCapture>
  readonly executedActions: ReadonlyArray<{ readonly stage: string; readonly taskId: string }>
  readonly plans: ReadonlyArray<PlannedTaskAttempt>
  readonly publications: ReadonlyArray<DeliveryRelationInputBundle>
  readonly records: ReadonlyArray<JournalRecord>
  readonly requestedTargets: ReadonlyArray<TrackerTarget>
  readonly trace: ReadonlyArray<TraceItem>
  readonly worktreeCreateRequests: ReadonlyArray<PlannedTaskAttempt>
}

export interface Issue268Ds03Characterization {
  readonly after: Issue268Ds03BoundarySnapshot
  readonly before: Issue268Ds03BoundarySnapshot
  readonly edit: {
    readonly graphRevision: TrackerRevision
    readonly nextFingerprint: TaskRevision
    readonly priorFingerprint: TaskRevision
    readonly taskId: TaskId
  }
}

type Issue268StartupAfterDs02 = Omit<
  Issue268StartupCharacterization,
  "ds01" | "ds02" | "ds03" | "ds04" | "ds05" | "ds06" | "ds07"
> & { readonly ds01: Issue268Ds01CheckpointEvidence; readonly ds02: Issue268Ds02CheckpointEvidence }

export type Issue268Ds03StartupCharacterization = Issue268StartupAfterDs02 & {
  readonly ds03: Issue268Ds03Characterization
}

export interface Issue268Ds04Characterization {
  readonly activeRefreshCount: number
  readonly activeRefreshSources: ReadonlyArray<"TrackerNotification" | "Timer">
  readonly after: Issue268Ds03BoundarySnapshot
  readonly beforeTimer: Issue268Ds03BoundarySnapshot
}

export type Issue268Ds04StartupCharacterization = Issue268StartupAfterDs02 & {
  readonly ds03: Issue268Ds03Characterization
  readonly ds04: Issue268Ds04Characterization
}

export interface Issue268Ds05Characterization {
  readonly after: Issue268Ds03BoundarySnapshot
  readonly beforeSafe: Issue268Ds03BoundarySnapshot
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly lifecycleAttachAttemptIds: ReadonlyArray<string>
}

export type Issue268Ds05StartupCharacterization = Issue268StartupAfterDs02 & {
  readonly ds03: Issue268Ds03Characterization
  readonly ds04: Issue268Ds04Characterization
  readonly ds05: Issue268Ds05Characterization
}

export interface Issue268Ds06Characterization {
  readonly after: Issue268Ds03BoundarySnapshot
  readonly beforeD: Issue268Ds03BoundarySnapshot
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly dActionAbsentBeforeBRelease: boolean
  readonly r5ReleaseCount: number
}

export type Issue268Ds06StartupCharacterization = Issue268StartupAfterDs02 & {
  readonly ds03: Issue268Ds03Characterization
  readonly ds04: Issue268Ds04Characterization
  readonly ds05: Issue268Ds05Characterization
  readonly ds06: Issue268Ds06Characterization
}

export interface Issue268Ds07Characterization {
  readonly after: Issue268Ds03BoundarySnapshot
  readonly beforeCapacity: Issue268Ds03BoundarySnapshot
  readonly capacityRecord: JournalRecord
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly p1: RunControlPolicy
  readonly p2Publication: DeliveryRelationInputBundle
  readonly readback: RunControlPolicy
  readonly request: SetTaskWorkCapacityRequest
  readonly returned: RunControlPolicy
}

export type Issue268Ds07StartupCharacterization = Issue268StartupAfterDs02 & {
  readonly ds03: Issue268Ds03Characterization
  readonly ds04: Issue268Ds04Characterization
  readonly ds05: Issue268Ds05Characterization
  readonly ds06: Issue268Ds06Characterization
  readonly ds07: Issue268Ds07Characterization
}

export interface Issue268Ds08BeforeLoss {
  readonly ds01: Issue268Ds01CheckpointEvidence
  readonly ds02: Issue268Ds02CheckpointEvidence
  readonly ds03: Issue268Ds03Characterization
  readonly ds04: Issue268Ds04Characterization
  readonly ds05: Issue268Ds05Characterization
  readonly ds06: Issue268Ds06Characterization
  readonly ds07: Issue268Ds07Characterization
  readonly executorObserveCalls: number
  readonly projectedReports: ReadonlyMap<string, PlannedAttemptExecutorReport>
  readonly snapshot: Issue268Ds03BoundarySnapshot
}

export interface Issue268Ds08Characterization {
  readonly afterLoss: Issue268Ds03BoundarySnapshot
  readonly applicationBuildCount: number
  readonly applicationExitTrace: ReadonlyArray<ApplicationExitTraceEvent>
  readonly beforeLoss: Issue268Ds08BeforeLoss
  readonly childScopeFinalizationCount: number
  readonly executorObserveCallsAfterLoss: number
  readonly executorObserveCallsBeforeLoss: number
  readonly firstProcessInterruptionCount: number
  readonly projectedReports: ReadonlyMap<string, PlannedAttemptExecutorReport>
}

export type Issue268Ds08StartupCharacterization = { readonly ds08: Issue268Ds08Characterization }

export interface Issue268ExecutorObservationCapture {
  readonly admission: {
    readonly plannedAttemptProtocolCorrelation: PlannedAttemptExecutorCorrelation
    readonly taskWorkPosition: {
      readonly _tag: "TaskWorkPositionRequired"
      readonly mode: "ReserveOrReuse"
      readonly taskId: TaskId
    }
  }
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly currentGraphPublication: DeliveryRelationInputBundle | undefined
  readonly plannedAttempt: PlannedTaskAttempt
  readonly process: "DS09"
  readonly projection: PlannedAttemptExecutorProjection
  readonly purpose: PlannedAttemptExecutorObservationPurpose
}

export interface Issue268Ds09Characterization {
  readonly afterLoss: Issue268Ds03BoundarySnapshot
  readonly after: Issue268Ds03BoundarySnapshot
  readonly applicationBuildCount: number
  readonly applicationExitTrace: ReadonlyArray<ApplicationExitTraceEvent>
  readonly beforeLoss: Issue268Ds08BeforeLoss
  readonly decision: Extract<RunFinalityDecision, { readonly _tag: "RunMustRemainActive" }> & {
    readonly reason: "RunnableTransition"
  }
  readonly executorObservations: ReadonlyArray<Issue268ExecutorObservationCapture>
  readonly firstProcessInterruptionCount: number
  readonly ordinaryOwnerActivationCount: number
  readonly ordinaryOwnerActivationOpportunities: ReadonlyArray<"OrdinaryRunEntry">
  readonly projectedReports: ReadonlyMap<string, PlannedAttemptExecutorReport>
  readonly reconstructedPublication: DeliveryRelationInputBundle
}

export type Issue268Ds09StartupCharacterization = { readonly ds09: Issue268Ds09Characterization }

export interface Issue268Ds10Characterization {
  readonly activeRefreshCount: number
  readonly activeRefreshDecision: undefined
  readonly activeRefreshSources: ReadonlyArray<"TrackerNotification">
  readonly after: Issue268Ds03BoundarySnapshot
  readonly before: Issue268Ds09Characterization
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly executorObserveCallCount: number
  readonly idleHandoffCount: number
  readonly notificationCount: number
  readonly trailingActivationCount: number
}

export interface Issue268Ds10StartupCharacterization {
  readonly ds09: Issue268Ds09Characterization
  readonly ds10: Issue268Ds10Characterization
}

export interface Issue268Ds11Characterization {
  readonly activeRefreshCount: number
  readonly activeRefreshDecision: undefined
  readonly after: Issue268Ds03BoundarySnapshot
  readonly before: Issue268Ds10Characterization
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly executorObserveCallCount: number
}

export interface Issue268Ds11StartupCharacterization {
  readonly ds09: Issue268Ds09Characterization
  readonly ds10: Issue268Ds10Characterization
  readonly ds11: Issue268Ds11Characterization
}

export interface Issue268Ds12Characterization {
  readonly activeRefreshCount: number
  readonly activeRefreshDecision: undefined
  readonly after: Issue268Ds03BoundarySnapshot
  readonly applicationBuildCount: number
  readonly before: Issue268Ds11Characterization
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly choice: Extract<AttemptChoiceApplicationResult, { readonly _tag: "ContinueApplied" }>
  readonly executorObserveCallCount: number
  readonly ordinaryOwnerActivationCount: number
  readonly request: ApplyAttemptChoiceRequest
}

export interface Issue268Ds12StartupCharacterization {
  readonly ds09: Issue268Ds09Characterization
  readonly ds10: Issue268Ds10Characterization
  readonly ds11: Issue268Ds11Characterization
  readonly ds12: Issue268Ds12Characterization
}

export interface Issue268Ds13Characterization {
  readonly activeRefreshCount: number
  readonly activeRefreshDecision: undefined
  readonly after: Issue268Ds03BoundarySnapshot
  readonly afterProcessStop: Issue268Ds03BoundarySnapshot
  readonly applicationBuildCount: number
  readonly before: Issue268Ds12Characterization
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly executorObserveCallCount: number
  readonly integrationQueueActionCount: number
  readonly ordinaryOwnerActivationCount: number
  readonly terminalReport: Extract<PlannedAttemptExecutorReport, { readonly _tag: "ExecutorWorkTerminal" }>
}

export interface Issue268Ds13StartupCharacterization {
  readonly ds09: Issue268Ds09Characterization
  readonly ds10: Issue268Ds10Characterization
  readonly ds11: Issue268Ds11Characterization
  readonly ds12: Issue268Ds12Characterization
  readonly ds13: Issue268Ds13Characterization
  readonly occurrenceEvidence: Issue268OccurrenceEvidence
}
