import { Schema } from "effect"
import type { TaskWorkCapacity } from "../../src/domain.js"
import type { JournalRecord, JournalStoreService } from "../../src/journal-store.js"
import type {
  BestAvailableDurableGraphKnowledge,
  ReconstructedPauseState,
  WorkflowResponsibilityState
} from "../../src/reconstructed-managed-run-state.js"

interface FrontierRecoveryTargetClosureReadEvidence {
  readonly completeness: "Complete"
  readonly consistency: "PotentiallyMixedTime"
  readonly explicitlyCoveredModelTaskIds: ReadonlyArray<bigint>
  readonly factFamily: "TargetMembership"
  readonly freshness: "FreshAtReadBoundary"
  readonly modelOperationId: bigint
  readonly modelPredecessorOperationIds: ReadonlyArray<bigint>
  readonly modelRevision: bigint
  readonly readShape: "TargetClosureMembership"
  readonly returnedModelTaskIds: ReadonlyArray<bigint>
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
    }
    | {
      readonly observationProfile: "ProvenAbsence"
    }
  )

export interface FrontierRecoveryAdmissionExplanation {
  readonly modelTaskId: bigint
  readonly tag: "CapacityWait"
  readonly wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
}

export interface FrontierRecoveryReconstructionProjection {
  readonly admissionCapacity: bigint
  readonly admittedModelOperationIds: ReadonlyArray<bigint>
  readonly admittedModelTaskIds: ReadonlyArray<bigint>
  readonly admittedTransitionTags: ReadonlyArray<string>
  readonly admissionExplanations: ReadonlyArray<FrontierRecoveryAdmissionExplanation>
  readonly admissionReservedModelTaskIds: ReadonlyArray<bigint>
  readonly coordinatorRunning: boolean
  readonly frontierModelTaskIds: ReadonlyArray<bigint>
  readonly frontierModelOperationIds: ReadonlyArray<bigint>
  readonly frontierTransitionTags: ReadonlyArray<string>
  readonly graphEvidence: FrontierRecoveryReconstructionGraphEvidence
  readonly graphKnowledge: BestAvailableDurableGraphKnowledge
  readonly knownModelTaskIds: ReadonlyArray<bigint>
  readonly occupiedModelTaskIds: ReadonlyArray<bigint>
  readonly pause: ReconstructedPauseState
  readonly responsibility: WorkflowResponsibilityState
  readonly responsibleModelTaskIds: ReadonlyArray<bigint>
  readonly workflowHistory: ReadonlyArray<JournalRecord>
  readonly workflowEventTags: ReadonlyArray<string>
}

export interface MakeFrontierRecoveryReconstructionControlsOptions {
  readonly capacity: TaskWorkCapacity
  readonly coordinatorRunning: boolean
  /** Fresh tracker eligibility supplied to this adapter invocation. */
  readonly freshEligibleModelTaskIds?: ReadonlyArray<bigint>
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
