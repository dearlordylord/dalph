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
import type { ControlledOccurrenceEvidence } from "./controlled-occurrences.js"

export interface ControlledExecutorCommandCapture {
  readonly attemptId: string
  readonly command: "Begin" | "Resume" | "Suspend"
}

export interface ControlledStartupCharacterization {
  readonly claimReleaseOrder: ReadonlyArray<string>
  readonly claimRequests: ReadonlyArray<TaskClaimAcquisition>
  readonly commands: ReadonlyArray<ControlledExecutorCommandCapture>
  readonly decision: RunFinalityDecision | undefined
  readonly executedActions: ReadonlyArray<{ readonly stage: string; readonly taskId: string }>
  readonly pendingClaimTaskIds: ReadonlyArray<string>
  readonly plans: ReadonlyArray<PlannedTaskAttempt>
  readonly publications: ReadonlyArray<DeliveryRelationInputBundle>
  readonly records: ReadonlyArray<JournalRecord>
  readonly trace: ReadonlyArray<TraceItem>
  readonly worktreeCreateRequests: ReadonlyArray<PlannedTaskAttempt>
  readonly ds01?: ControlledDs01CheckpointEvidence
  readonly ds02?: ControlledDs02CheckpointEvidence
  readonly ds03?: ControlledDs03Characterization
  readonly ds04?: ControlledDs04Characterization
  readonly ds05?: ControlledDs05Characterization
  readonly ds06?: ControlledDs06Characterization
  readonly ds07?: ControlledDs07Characterization
  readonly ds08?: ControlledDs08Characterization
}

/** The selected G0 frontier while A/B/C claim mutations are still held by the fixture. */
export interface ControlledDs01CheckpointEvidence {
  readonly pendingClaimTaskIds: ReadonlyArray<string>
  readonly snapshot: ControlledDs03BoundarySnapshot
}

/** The first publication boundary after A1/B1/C1 have each become Executing. */
export interface ControlledDs02CheckpointEvidence {
  readonly snapshot: ControlledDs03BoundarySnapshot
}

export interface ControlledDs03BoundarySnapshot {
  readonly claimRequests: ReadonlyArray<TaskClaimAcquisition>
  readonly commands: ReadonlyArray<ControlledExecutorCommandCapture>
  readonly executedActions: ReadonlyArray<{ readonly stage: string; readonly taskId: string }>
  readonly plans: ReadonlyArray<PlannedTaskAttempt>
  readonly publications: ReadonlyArray<DeliveryRelationInputBundle>
  readonly records: ReadonlyArray<JournalRecord>
  readonly requestedTargets: ReadonlyArray<TrackerTarget>
  readonly trace: ReadonlyArray<TraceItem>
  readonly worktreeCreateRequests: ReadonlyArray<PlannedTaskAttempt>
}

export interface ControlledDs03Characterization {
  readonly after: ControlledDs03BoundarySnapshot
  readonly before: ControlledDs03BoundarySnapshot
  readonly edit: {
    readonly graphRevision: TrackerRevision
    readonly nextFingerprint: TaskRevision
    readonly priorFingerprint: TaskRevision
    readonly taskId: TaskId
  }
}

type ControlledStartupAfterDs02 = Omit<
  ControlledStartupCharacterization,
  "ds01" | "ds02" | "ds03" | "ds04" | "ds05" | "ds06" | "ds07"
> & { readonly ds01: ControlledDs01CheckpointEvidence; readonly ds02: ControlledDs02CheckpointEvidence }

export type ControlledDs03StartupCharacterization = ControlledStartupAfterDs02 & {
  readonly ds03: ControlledDs03Characterization
}

export interface ControlledDs04Characterization {
  readonly activeRefreshCount: number
  readonly activeRefreshSources: ReadonlyArray<"TrackerNotification" | "Timer">
  readonly after: ControlledDs03BoundarySnapshot
  readonly beforeTimer: ControlledDs03BoundarySnapshot
}

export type ControlledDs04StartupCharacterization = ControlledStartupAfterDs02 & {
  readonly ds03: ControlledDs03Characterization
  readonly ds04: ControlledDs04Characterization
}

export interface ControlledDs05Characterization {
  readonly after: ControlledDs03BoundarySnapshot
  readonly beforeSafe: ControlledDs03BoundarySnapshot
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly lifecycleAttachAttemptIds: ReadonlyArray<string>
}

export type ControlledDs05StartupCharacterization = ControlledStartupAfterDs02 & {
  readonly ds03: ControlledDs03Characterization
  readonly ds04: ControlledDs04Characterization
  readonly ds05: ControlledDs05Characterization
}

export interface ControlledDs06Characterization {
  readonly after: ControlledDs03BoundarySnapshot
  readonly beforeD: ControlledDs03BoundarySnapshot
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly dActionAbsentBeforeBRelease: boolean
  readonly r5ReleaseCount: number
}

export type ControlledDs06StartupCharacterization = ControlledStartupAfterDs02 & {
  readonly ds03: ControlledDs03Characterization
  readonly ds04: ControlledDs04Characterization
  readonly ds05: ControlledDs05Characterization
  readonly ds06: ControlledDs06Characterization
}

export interface ControlledDs07Characterization {
  readonly after: ControlledDs03BoundarySnapshot
  readonly beforeCapacity: ControlledDs03BoundarySnapshot
  readonly capacityRecord: JournalRecord
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly p1: RunControlPolicy
  readonly p2Publication: DeliveryRelationInputBundle
  readonly readback: RunControlPolicy
  readonly request: SetTaskWorkCapacityRequest
  readonly returned: RunControlPolicy
}

export type ControlledDs07StartupCharacterization = ControlledStartupAfterDs02 & {
  readonly ds03: ControlledDs03Characterization
  readonly ds04: ControlledDs04Characterization
  readonly ds05: ControlledDs05Characterization
  readonly ds06: ControlledDs06Characterization
  readonly ds07: ControlledDs07Characterization
}

export interface ControlledDs08BeforeLoss {
  readonly ds01: ControlledDs01CheckpointEvidence
  readonly ds02: ControlledDs02CheckpointEvidence
  readonly ds03: ControlledDs03Characterization
  readonly ds04: ControlledDs04Characterization
  readonly ds05: ControlledDs05Characterization
  readonly ds06: ControlledDs06Characterization
  readonly ds07: ControlledDs07Characterization
  readonly executorObserveCalls: number
  readonly projectedReports: ReadonlyMap<string, PlannedAttemptExecutorReport>
  readonly snapshot: ControlledDs03BoundarySnapshot
}

export interface ControlledDs08Characterization {
  readonly afterLoss: ControlledDs03BoundarySnapshot
  readonly applicationBuildCount: number
  readonly applicationExitTrace: ReadonlyArray<ApplicationExitTraceEvent>
  readonly beforeLoss: ControlledDs08BeforeLoss
  readonly childScopeFinalizationCount: number
  readonly executorObserveCallsAfterLoss: number
  readonly executorObserveCallsBeforeLoss: number
  readonly firstProcessInterruptionCount: number
  readonly projectedReports: ReadonlyMap<string, PlannedAttemptExecutorReport>
}

export type ControlledDs08StartupCharacterization = { readonly ds08: ControlledDs08Characterization }

export interface ControlledExecutorObservationCapture {
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

export interface ControlledDs09Characterization {
  readonly afterLoss: ControlledDs03BoundarySnapshot
  readonly after: ControlledDs03BoundarySnapshot
  readonly applicationBuildCount: number
  readonly applicationExitTrace: ReadonlyArray<ApplicationExitTraceEvent>
  readonly beforeLoss: ControlledDs08BeforeLoss
  readonly decision: Extract<RunFinalityDecision, { readonly _tag: "RunMustRemainActive" }> & {
    readonly reason: "RunnableTransition"
  }
  readonly executorObservations: ReadonlyArray<ControlledExecutorObservationCapture>
  readonly firstProcessInterruptionCount: number
  readonly ordinaryOwnerActivationCount: number
  readonly ordinaryOwnerActivationOpportunities: ReadonlyArray<"OrdinaryRunEntry">
  readonly projectedReports: ReadonlyMap<string, PlannedAttemptExecutorReport>
  readonly reconstructedPublication: DeliveryRelationInputBundle
}

export type ControlledDs09StartupCharacterization = { readonly ds09: ControlledDs09Characterization }

export interface ControlledDs10Characterization {
  readonly activeRefreshCount: number
  readonly activeRefreshDecision: undefined
  readonly activeRefreshSources: ReadonlyArray<"TrackerNotification">
  readonly after: ControlledDs03BoundarySnapshot
  readonly before: ControlledDs09Characterization
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly executorObserveCallCount: number
  readonly idleHandoffCount: number
  readonly notificationCount: number
  readonly trailingActivationCount: number
}

export interface ControlledDs10StartupCharacterization {
  readonly ds09: ControlledDs09Characterization
  readonly ds10: ControlledDs10Characterization
}

export interface ControlledDs11Characterization {
  readonly activeRefreshCount: number
  readonly activeRefreshDecision: undefined
  readonly after: ControlledDs03BoundarySnapshot
  readonly before: ControlledDs10Characterization
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly executorObserveCallCount: number
}

export interface ControlledDs11StartupCharacterization {
  readonly ds09: ControlledDs09Characterization
  readonly ds10: ControlledDs10Characterization
  readonly ds11: ControlledDs11Characterization
}

export interface ControlledDs12Characterization {
  readonly activeRefreshCount: number
  readonly activeRefreshDecision: undefined
  readonly after: ControlledDs03BoundarySnapshot
  readonly applicationBuildCount: number
  readonly before: ControlledDs11Characterization
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly choice: Extract<AttemptChoiceApplicationResult, { readonly _tag: "ContinueApplied" }>
  readonly executorObserveCallCount: number
  readonly ordinaryOwnerActivationCount: number
  readonly request: ApplyAttemptChoiceRequest
}

export interface ControlledDs12StartupCharacterization {
  readonly ds09: ControlledDs09Characterization
  readonly ds10: ControlledDs10Characterization
  readonly ds11: ControlledDs11Characterization
  readonly ds12: ControlledDs12Characterization
}

export interface ControlledDs13Characterization {
  readonly activeRefreshCount: number
  readonly activeRefreshDecision: undefined
  readonly after: ControlledDs03BoundarySnapshot
  readonly afterProcessStop: ControlledDs03BoundarySnapshot
  readonly applicationBuildCount: number
  readonly before: ControlledDs12Characterization
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly executorObserveCallCount: number
  readonly integrationQueueActionCount: number
  readonly ordinaryOwnerActivationCount: number
  readonly terminalReport: Extract<PlannedAttemptExecutorReport, { readonly _tag: "ExecutorWorkTerminal" }>
}

export interface ControlledDs13StartupCharacterization {
  readonly ds09: ControlledDs09Characterization
  readonly ds10: ControlledDs10Characterization
  readonly ds11: ControlledDs11Characterization
  readonly ds12: ControlledDs12Characterization
  readonly ds13: ControlledDs13Characterization
  readonly occurrenceEvidence: ControlledOccurrenceEvidence
}
