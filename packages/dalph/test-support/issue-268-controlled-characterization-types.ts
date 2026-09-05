import type { PlannedTaskAttempt, TaskId, TaskRevision } from "@dalph/contracts"
import type {
  DeliveryRelationInputBundle,
  JournalRecord,
  RunFinalityDecision,
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

export type Issue268Ds03StartupCharacterization = Omit<Issue268StartupCharacterization, "ds03" | "ds04"> & {
  readonly ds03: Issue268Ds03Characterization
}

export interface Issue268Ds04Characterization {
  readonly activeRefreshCount: number
  readonly activeRefreshSources: ReadonlyArray<"TrackerNotification" | "Timer">
  readonly after: Issue268Ds03BoundarySnapshot
  readonly beforeTimer: Issue268Ds03BoundarySnapshot
}

export type Issue268Ds04StartupCharacterization = Omit<Issue268StartupCharacterization, "ds03" | "ds04"> & {
  readonly ds03: Issue268Ds03Characterization
  readonly ds04: Issue268Ds04Characterization
}
