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
  ApplicationExitTraceEvent,
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
  readonly ds03?: Issue268Ds03Characterization
  readonly ds04?: Issue268Ds04Characterization
  readonly ds05?: Issue268Ds05Characterization
  readonly ds06?: Issue268Ds06Characterization
  readonly ds07?: Issue268Ds07Characterization
  readonly ds08?: Issue268Ds08Characterization
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

export type Issue268Ds03StartupCharacterization = Omit<
  Issue268StartupCharacterization,
  "ds03" | "ds04" | "ds05" | "ds06" | "ds07"
> & { readonly ds03: Issue268Ds03Characterization }

export interface Issue268Ds04Characterization {
  readonly activeRefreshCount: number
  readonly activeRefreshSources: ReadonlyArray<"TrackerNotification" | "Timer">
  readonly after: Issue268Ds03BoundarySnapshot
  readonly beforeTimer: Issue268Ds03BoundarySnapshot
}

export type Issue268Ds04StartupCharacterization = Omit<
  Issue268StartupCharacterization,
  "ds03" | "ds04" | "ds05" | "ds06" | "ds07"
> & { readonly ds03: Issue268Ds03Characterization; readonly ds04: Issue268Ds04Characterization }

export interface Issue268Ds05Characterization {
  readonly after: Issue268Ds03BoundarySnapshot
  readonly beforeSafe: Issue268Ds03BoundarySnapshot
  readonly checkpointPublication: DeliveryRelationInputBundle
  readonly lifecycleAttachAttemptIds: ReadonlyArray<string>
}

export type Issue268Ds05StartupCharacterization = Omit<
  Issue268StartupCharacterization,
  "ds03" | "ds04" | "ds05" | "ds06" | "ds07"
> & {
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

export type Issue268Ds06StartupCharacterization = Omit<
  Issue268StartupCharacterization,
  "ds03" | "ds04" | "ds05" | "ds06" | "ds07"
> & {
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

export type Issue268Ds07StartupCharacterization = Omit<
  Issue268StartupCharacterization,
  "ds03" | "ds04" | "ds05" | "ds06" | "ds07"
> & {
  readonly ds03: Issue268Ds03Characterization
  readonly ds04: Issue268Ds04Characterization
  readonly ds05: Issue268Ds05Characterization
  readonly ds06: Issue268Ds06Characterization
  readonly ds07: Issue268Ds07Characterization
}

export interface Issue268Ds08BeforeLoss {
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
