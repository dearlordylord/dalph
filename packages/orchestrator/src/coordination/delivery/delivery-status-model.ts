import { RunId, TaskId, type IntegrationTarget, type PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Schema } from "effect"
import type { OperationId } from "../../workflow/identity.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { TrackerRevision } from "../../authorities/task-tracker/task.js"
import type { DeliveryActionProposal, DeliveryProposalDerivationIssue } from "./delivery-action-proposal.js"
import type { DeliveryRuntimeLiveOwnerSnapshot } from "./delivery-runtime-observation.js"
import type {
  DeliverySettlement,
  ExactWorkflowObligation,
  TicketDeliveryPlacement,
  TicketDeliveryStanding
} from "./relations.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import type { IntegrationDeliveryWait } from "../frontier/integration-frontier.js"
import type { FrontierExplanation } from "../frontier/frontier.js"
import type { TaskWorkCapacity } from "../admission/capacity.js"

/** The public subject of a current delivery read; it is not a control subject. */
export const DeliveryStatusSubject = Schema.TaggedUnion({
  Run: { runId: RunId },
  Task: { runId: RunId, taskId: TaskId }
})
export type DeliveryStatusSubject = typeof DeliveryStatusSubject.Type

/** The exact observable classification of one current status entry. */
export type DeliveryStatusClassification = "Waiting" | "Progressing" | "Blocked" | "Settled" | "Relinquished"

/** A tracker fact that is not present, readable, or complete enough to advance one responsibility. */
export type DeliveryStatusTrackerFact =
  | { readonly _tag: "Missing"; readonly boundary: "TaskTracker" }
  | { readonly _tag: "Unreadable"; readonly boundary: "TaskTracker" }
  | { readonly _tag: "Unobserved"; readonly boundary: "TaskTracker" }

/** Wake conditions already owned by frontier explanations; status does not invent scheduler vocabulary. */
export type DeliveryStatusWakeCondition = Extract<
  FrontierExplanation,
  { readonly wakeCondition: string }
>["wakeCondition"]

/** A tracker-fact wait either names its exact responsibility or explicitly names an unestablished graph. */
export type DeliveryStatusTrackerFactWait =
  | {
      readonly _tag: "TrackerFactWait"
      readonly classification: "Waiting"
      readonly subject: DeliveryStatusSubject
      readonly responsibility: ExactWorkflowObligation
      readonly fact: DeliveryStatusTrackerFact
      readonly wakeCondition: DeliveryStatusWakeCondition
      readonly standing: TicketDeliveryStanding
    }
  | {
      readonly _tag: "TrackerFactWait"
      readonly classification: "Waiting"
      readonly subject: DeliveryStatusSubject
      readonly responsibility: null
      readonly fact: Extract<DeliveryStatusTrackerFact, { readonly _tag: "Unobserved" }>
      readonly wakeCondition: Extract<DeliveryStatusWakeCondition, "TaskTrackerFactsObserved">
      readonly standing: { readonly _tag: "GraphNotEstablished" }
    }

/** A process or authority observation needed to explain why one exact responsibility cannot advance. */
export type DeliveryStatusUnavailableEvidence =
  | { readonly _tag: "ProposalDerivationIssue"; readonly issue: DeliveryProposalDerivationIssue }
  | { readonly _tag: "ResponsibilityFacts"; readonly facts: ResponsibilityFreshFacts }

/** Unavailable evidence either names the blocked responsibility or explicitly has no responsibility yet. */
export type DeliveryStatusEvidenceUnavailableEntry =
  | {
      readonly _tag: "EvidenceUnavailable"
      readonly classification: "Blocked"
      readonly subject: DeliveryStatusSubject
      readonly responsibility: null
      readonly evidence: Extract<DeliveryStatusUnavailableEvidence, { readonly _tag: "ProposalDerivationIssue" }>
    }
  | {
      readonly _tag: "EvidenceUnavailable"
      readonly classification: "Blocked"
      readonly subject: DeliveryStatusSubject
      readonly responsibility: ExactWorkflowObligation
      readonly evidence: Extract<DeliveryStatusUnavailableEvidence, { readonly _tag: "ResponsibilityFacts" }>
    }

/** Evidence conflicts retain their exact identities and tie responsibility to the conflict-bearing delivery. */
export type DeliveryStatusEvidenceConflictEntry =
  | {
      readonly _tag: "EvidenceConflict"
      readonly classification: "Blocked"
      readonly subject: DeliveryStatusSubject
      readonly responsibility: ExactWorkflowObligation
      readonly evidenceIdentities: readonly [string, ...ReadonlyArray<string>]
      readonly standing: Extract<TicketDeliveryStanding, { readonly _tag: "ExactEvidenceConflict" }>
    }
  | {
      readonly _tag: "EvidenceConflict"
      readonly classification: "Blocked"
      readonly subject: DeliveryStatusSubject
      readonly responsibility: null
      readonly evidenceIdentities: readonly [string, ...ReadonlyArray<string>]
      readonly standing: Extract<TicketDeliveryStanding, { readonly _tag: "ExactEvidenceConflict" }>
    }

/** A graph observation identity carried with a task-absent result. */
export interface DeliveryStatusGraphSource {
  readonly _tag: "EstablishedGraph"
  readonly revision: TrackerRevision
  readonly operationId: OperationId
  readonly freshnessOperationId: OperationId
  readonly contentIdentity: TrackerRevision
  readonly recordedAt: JournalPosition
}

/** One Run-wide or task-local status entry. Every variant keeps its exact supporting fact. */
export type DeliveryStatusEntry =
  | {
      readonly _tag: "DependencyWait"
      readonly classification: "Waiting"
      readonly subject: DeliveryStatusSubject
      readonly taskId: TaskId
      readonly prerequisiteTaskIds: readonly [TaskId, ...ReadonlyArray<TaskId>]
      readonly standing: Extract<TicketDeliveryPlacement, { readonly _tag: "GraphExcluded" }>
    }
  | DeliveryStatusTrackerFactWait
  | {
      readonly _tag: "TaskWorkCapacityWait"
      readonly classification: "Waiting"
      readonly subject: DeliveryStatusSubject
      readonly taskId: TaskId
      readonly scope: {
        readonly _tag: "RunTaskWorkCapacityScope"
        readonly runId: RunId
        readonly capacity: TaskWorkCapacity
      }
      readonly holders: ReadonlyArray<{
        readonly taskId: TaskId
        readonly correlation: PlannedAttemptExecutorCorrelation
      }>
      readonly placement: Extract<TicketDeliveryPlacement, { readonly _tag: "Selected" }>
    }
  | {
      readonly _tag: "ProposedDeliveryAction"
      readonly classification: "Waiting"
      readonly subject: DeliveryStatusSubject
      readonly proposal: DeliveryActionProposal
    }
  | {
      readonly _tag: "LiveDeliveryAction"
      readonly classification: "Progressing"
      readonly subject: DeliveryStatusSubject
      readonly owner: DeliveryRuntimeLiveOwnerSnapshot
      readonly proposal: DeliveryActionProposal
      readonly operationId: OperationId | null
    }
  | {
      readonly _tag: "AcceptedFactPublicationWait"
      readonly classification: "Waiting"
      readonly subject: DeliveryStatusSubject
      readonly owner: Extract<
        DeliveryRuntimeLiveOwnerSnapshot,
        { readonly _tag: "SettledBeforeMaterialization" | "SettledMaterializedDeliveryAction" }
      >
      readonly proposal: DeliveryActionProposal
      readonly operationId: OperationId | null
      readonly acceptedAt: JournalPosition | null
    }
  | {
      readonly _tag: "IntegrationTargetWait"
      readonly classification: "Waiting"
      readonly subject: DeliveryStatusSubject
      readonly plannedAttempt: IntegrationDeliveryWait["plannedAttempt"]
      readonly integrationTarget: IntegrationTarget
      readonly responsibility: Extract<ExactWorkflowObligation, { readonly _tag: "QueuedIntegration" }>
      readonly wait: IntegrationDeliveryWait
      readonly standing: Extract<TicketDeliveryStanding, { readonly _tag: "IntegrationWait" }>
    }
  | DeliveryStatusEvidenceUnavailableEntry
  | DeliveryStatusEvidenceConflictEntry
  | {
      readonly _tag: "Settlement"
      readonly classification: "Settled"
      readonly subject: DeliveryStatusSubject
      readonly taskId: TaskId
      readonly attemptId: DeliverySettlement["attemptId"]
      readonly settlement: DeliverySettlement
    }
  | {
      readonly _tag: "Relinquishment"
      readonly classification: "Relinquished"
      readonly subject: DeliveryStatusSubject
      readonly responsibility: Extract<ExactWorkflowObligation, { readonly _tag: "WorkflowResponsibility" }>
      readonly correlation: PlannedAttemptExecutorCorrelation | null
      readonly operationId: OperationId | null
      readonly reason: "AuthorizedHandoff" | "FreshAuthorityRevocation"
    }

/** A status value that has not yet been closed by its process-local source. */
export type DeliveryStatusSnapshot =
  | { readonly _tag: "DeliveryStatusNotReady"; readonly subject: DeliveryStatusSubject }
  | {
      readonly _tag: "DeliveryStatusAvailable"
      readonly subject: DeliveryStatusSubject
      readonly acceptedAt: JournalPosition | null
      readonly entries: ReadonlyArray<DeliveryStatusEntry>
    }
  | {
      readonly _tag: "TaskAbsentFromCurrentGraph"
      readonly subject: Extract<DeliveryStatusSubject, { readonly _tag: "Task" }>
      readonly graphSource: DeliveryStatusGraphSource
    }

/** The complete passive status source, including the exact final process-local observation on close. */
export type CurrentDeliveryStatus =
  | DeliveryStatusSnapshot
  | {
      readonly _tag: "DeliveryStatusClosed"
      readonly subject: DeliveryStatusSubject
      readonly final: DeliveryStatusSnapshot | null
    }

/** Alice requested another Run than the process-local source can describe. */
export class DeliveryStatusRunMismatch extends Schema.TaggedError<DeliveryStatusRunMismatch>()(
  "DeliveryStatusRunMismatch",
  { expectedRunId: RunId, requestedRunId: RunId }
) {}

/** The coherent runtime state did not carry a RunId, so status refuses to guess one. */
export class DeliveryStatusRunIdentityUnavailable extends Schema.TaggedError<DeliveryStatusRunIdentityUnavailable>()(
  "DeliveryStatusRunIdentityUnavailable",
  { subject: DeliveryStatusSubject }
) {}

/** Two observations claimed the same exact status identity with incompatible values. */
export class DeliveryStatusProjectionConflict extends Schema.TaggedError<DeliveryStatusProjectionConflict>()(
  "DeliveryStatusProjectionConflict",
  { subject: DeliveryStatusSubject, entryIdentity: Schema.String, detail: Schema.String }
) {}

export type DeliveryStatusProjectionError =
  | DeliveryStatusRunMismatch
  | DeliveryStatusRunIdentityUnavailable
  | DeliveryStatusProjectionConflict
