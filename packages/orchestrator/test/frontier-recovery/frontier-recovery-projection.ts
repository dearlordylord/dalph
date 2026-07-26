import { Schema } from "effect"
import type { TaskWorkCapacity } from "../../src/domain.js"
import type { JournalRecord, JournalStoreService } from "../../src/journal-store.js"
import type {
  BestAvailableDurableGraphKnowledge,
  ReconstructedPauseState,
  WorkflowResponsibilityState
} from "../../src/reconstructed-managed-run-state.js"
import type {
  FrontierRecoveryModelCapacity,
  FrontierRecoveryModelOperationId,
  FrontierRecoveryModelRevision,
  FrontierRecoveryModelTaskId
} from "./frontier-recovery-conformance.js"

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

export interface FrontierRecoveryReconstructionProjection {
  readonly admissionCapacity: FrontierRecoveryModelCapacity
  readonly admittedModelOperationIds: ReadonlyArray<FrontierRecoveryModelOperationId>
  readonly admittedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly admittedTransitionTags: ReadonlyArray<string>
  readonly admissionExplanations: ReadonlyArray<FrontierRecoveryAdmissionExplanation>
  readonly admissionReservedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly coordinatorRunning: boolean
  readonly frontierModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly frontierModelOperationIds: ReadonlyArray<FrontierRecoveryModelOperationId>
  readonly frontierTransitionTags: ReadonlyArray<string>
  readonly graphEvidence: FrontierRecoveryReconstructionGraphEvidence
  readonly graphKnowledge: BestAvailableDurableGraphKnowledge
  readonly knownModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly occupiedModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly pause: ReconstructedPauseState
  readonly responsibility: WorkflowResponsibilityState
  readonly responsibleModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
  readonly workflowHistory: ReadonlyArray<JournalRecord>
  readonly workflowEventTags: ReadonlyArray<string>
}

export interface MakeFrontierRecoveryReconstructionControlsOptions {
  readonly capacity: TaskWorkCapacity
  readonly coordinatorRunning: boolean
  /** Fresh tracker eligibility supplied to this adapter invocation. */
  readonly freshEligibleModelTaskIds?: ReadonlyArray<FrontierRecoveryModelTaskId>
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
