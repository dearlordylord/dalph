import type { TaskWorkCapacity } from "../../src/domain.js"
import type { JournalRecord, JournalStoreService } from "../../src/journal-store.js"
import type {
  BestAvailableDurableGraphKnowledge,
  ReconstructedPauseState,
  WorkflowResponsibilityState
} from "../../src/reconstructed-managed-run-state.js"

export type FrontierRecoveryReconstructionGraphEvidence =
  | {
    readonly disposition: "InitialObservation"
    readonly returnedModelTaskIds: ReadonlyArray<bigint>
  }
  | {
    readonly disposition: "CompatibleReplacement"
    readonly returnedModelTaskIds: ReadonlyArray<bigint>
  }
  | {
    readonly disposition: "IncomparableMembership"
    readonly predecessorModelOperationIds: ReadonlyArray<bigint>
    readonly returnedModelTaskIds: ReadonlyArray<bigint>
  }
  | {
    readonly disposition: "ProvenAbsence"
    readonly explicitlyCoveredModelTaskIds: ReadonlyArray<bigint>
    readonly returnedModelTaskIds: ReadonlyArray<bigint>
  }

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
