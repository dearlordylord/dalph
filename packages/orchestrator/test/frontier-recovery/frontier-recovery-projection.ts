import { Schema } from "effect"
import type { OperationId, ProviderObservationId, TaskId, TaskWorkCapacity } from "../../src/domain.js"
import type { JournalRecord, JournalStoreService } from "../../src/journal-store.js"
import type {
  BestAvailableDurableGraphKnowledge,
  ReconstructedPauseState,
  WorkflowResponsibilityState
} from "../../src/reconstructed-managed-run-state.js"
import type {
  FrontierRecoveryModelCapacity,
  FrontierRecoveryModelJournalPosition,
  FrontierRecoveryModelOperationId,
  FrontierRecoveryModelRevision,
  FrontierRecoveryModelTaskId
} from "./frontier-recovery-conformance.js"

interface FrontierRecoveryNormalizedTargetClosureObservation {
  readonly completeness: "Complete"
  readonly consistency: "PotentiallyMixedTime"
  readonly explicitlyCoveredModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly factFamily: "TargetMembership"
  readonly freshness: "FreshAtReadBoundary"
  readonly modelObservedAt: FrontierRecoveryModelJournalPosition
  readonly modelOperationId: FrontierRecoveryModelOperationId
  readonly modelRevision: FrontierRecoveryModelRevision
  readonly provenAbsentModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly returnedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly target: "FrontierRecoveryTargetClosure"
}

export type FrontierRecoveryGraphKnowledgeProjection =
  | {
    readonly _tag: "TargetClosureObserved"
    readonly observation: FrontierRecoveryNormalizedTargetClosureObservation
  }
  | {
    readonly _tag: "TargetClosureConflict"
    readonly observations: ReadonlyArray<FrontierRecoveryNormalizedTargetClosureObservation>
  }

export type FrontierRecoveryWorkflowRecordProjection =
  | {
    readonly _tag: "GraphObservationIntent"
    readonly explicitlyCoveredModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
    readonly modelOperationId: FrontierRecoveryModelOperationId
    readonly modelPosition: FrontierRecoveryModelJournalPosition
    readonly modelPredecessorOperationIds: ReadonlyArray<FrontierRecoveryModelOperationId>
  }
  | {
    readonly _tag: "GraphOutcome"
    readonly modelOperationId: FrontierRecoveryModelOperationId
    readonly modelPosition: FrontierRecoveryModelJournalPosition
    readonly modelRevision: FrontierRecoveryModelRevision
    readonly returnedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  }
  | {
    readonly _tag: "ClaimIntent"
    readonly modelOperationId: FrontierRecoveryModelOperationId
    readonly modelPosition: FrontierRecoveryModelJournalPosition
    readonly modelPredecessorOperationIds: ReadonlyArray<FrontierRecoveryModelOperationId>
    readonly modelTaskId: FrontierRecoveryModelTaskId
    readonly owner: "FrontierRecoveryClaimOwner"
    readonly token: {
      readonly modelTaskId: FrontierRecoveryModelTaskId
    }
  }

export interface FrontierRecoveryResponsibilityProjection {
  readonly beganAt: FrontierRecoveryModelJournalPosition
  readonly modelOperationId: FrontierRecoveryModelOperationId
  readonly modelTaskId: FrontierRecoveryModelTaskId
  readonly owner: "FrontierRecoveryClaimOwner"
  readonly token: {
    readonly modelTaskId: FrontierRecoveryModelTaskId
  }
}

interface FrontierRecoveryTargetClosureReadEvidence {
  readonly completeness: "Complete"
  readonly consistency: "PotentiallyMixedTime"
  readonly factFamily: "TargetMembership"
  readonly freshness: "FreshAtReadBoundary"
  readonly modelOperationId: FrontierRecoveryModelOperationId
  readonly modelRevision: FrontierRecoveryModelRevision
  readonly readShape: "TargetClosureMembership"
  readonly returnedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
}

export type FrontierRecoveryReconstructionGraphEvidence =
  & FrontierRecoveryTargetClosureReadEvidence
  & (
    | {
      readonly observationProfile: "InitialObservation"
    }
    | {
      readonly observationProfile: "CompatibleReplacement"
    }
    | {
      readonly observationProfile: "IncomparableMembership"
      readonly modelPredecessorOperationIds: ReadonlyArray<FrontierRecoveryModelOperationId>
    }
    | {
      readonly explicitlyCoveredModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
      readonly observationProfile: "ProvenAbsence"
    }
  )

export interface FrontierRecoveryAdmissionExplanation {
  readonly modelTaskId: FrontierRecoveryModelTaskId
  readonly tag: "CapacityWait"
  readonly wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
}

export type FrontierRecoveryTransitionOperation =
  | {
    readonly _tag: "FreshTransitionWithoutOperation"
  }
  | {
    readonly _tag: "DurableTransitionOperation"
    readonly modelOperationId: FrontierRecoveryModelOperationId
  }

export interface FrontierRecoveryActivationProjection {
  readonly activationInProgressModelTaskIds: ReadonlyArray<
    FrontierRecoveryModelTaskId
  >
  readonly derivedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly freshlyObservedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly isolatedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly owners: ReadonlyArray<{
    readonly modelOperationId?: FrontierRecoveryModelOperationId
    readonly modelTaskId: FrontierRecoveryModelTaskId
    readonly phase: "PostIntent" | "PreIntent"
  }>
  readonly postIntentExitedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly preIntentInterruptedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly providerConsumingModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly reservedPositions: ReadonlyArray<{
    readonly correlation: "Operation" | "SelectedTransition"
    readonly modelOperationId?: FrontierRecoveryModelOperationId
    readonly modelTaskId: FrontierRecoveryModelTaskId
  }>
  readonly resultsRecordedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly runnerModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly selectedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly triggerPending: boolean
}

export interface FrontierRecoveryReconstructionProjection {
  readonly activation: FrontierRecoveryActivationProjection
  readonly admissionCapacity: FrontierRecoveryModelCapacity
  readonly admittedTransitionOperations: ReadonlyArray<FrontierRecoveryTransitionOperation>
  readonly admittedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly admittedTransitionTags: ReadonlyArray<string>
  readonly admissionExplanations: ReadonlyArray<FrontierRecoveryAdmissionExplanation>
  readonly admissionReservedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly coordinatorRunning: boolean
  readonly frontierModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly frontierTransitionOperations: ReadonlyArray<FrontierRecoveryTransitionOperation>
  readonly frontierTransitionTags: ReadonlyArray<string>
  readonly graphEvidence: FrontierRecoveryReconstructionGraphEvidence
  readonly graphKnowledgeProjection: FrontierRecoveryGraphKnowledgeProjection
  readonly graphKnowledge: BestAvailableDurableGraphKnowledge
  readonly knownModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly occupiedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly pause: ReconstructedPauseState
  readonly responsibility: WorkflowResponsibilityState
  readonly responsibilityProjection: ReadonlyArray<FrontierRecoveryResponsibilityProjection>
  readonly responsibleModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly workflowHistory: ReadonlyArray<JournalRecord>
  readonly workflowHistoryProjection: ReadonlyArray<FrontierRecoveryWorkflowRecordProjection>
  readonly workflowEventTags: ReadonlyArray<string>
}

export interface MakeFrontierRecoveryReconstructionControlsOptions {
  readonly capacity: TaskWorkCapacity
  readonly coordinatorRunning: boolean
  /** Fresh tracker eligibility supplied to this adapter invocation. */
  readonly freshEligibleModelTaskIds?: ReadonlyArray<FrontierRecoveryModelTaskId>
  /** Fresh provider evidence supplied at this reconstruction boundary. */
  readonly freshOccupiedInvocations?: ReadonlyArray<{
    readonly observationId: ProviderObservationId
    readonly operationId: OperationId
    readonly taskId: TaskId
  }>
  readonly journal: JournalStoreService
}

/** The conformance harness cannot safely continue from this reconstructed prefix. */
export class FrontierRecoveryReconstructionIssue extends Schema.TaggedErrorClass<FrontierRecoveryReconstructionIssue>()(
  "FrontierRecoveryReconstructionIssue",
  {
    detail: Schema.String,
    reason: Schema.Literals(["CoordinatorStopped", "InvalidManagedHistory"])
  }
) {}

export const frontierRecoveryReconstructionIssue = (
  reason: FrontierRecoveryReconstructionIssue["reason"],
  detail: string
) => new FrontierRecoveryReconstructionIssue({ detail, reason })
