import { AttemptId, PlannedAttemptExecutorCorrelation, RunId, TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import { OperationId } from "../../workflow/identity.js"

/** Identifies a registration only within its family and this application incarnation. */
export const ApplicationExitOwnerId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("ApplicationExitOwnerId")
)

/** NoRun means no selected observation; it does not assert absence of a durable Run. */
export const ApplicationExitOwnerSubject = Schema.TaggedUnion({
  NoRun: {},
  Run: { runId: RunId },
  Task: { runId: RunId, taskId: TaskId },
  ExecutorAttempt: { correlation: PlannedAttemptExecutorCorrelation }
})
export type ApplicationExitOwnerSubject = typeof ApplicationExitOwnerSubject.Type

/** Allowlisted role names describe existing owners without exposing private resource paths or provider data. */
export const ApplicationExitOwnerName = Schema.Literals([
  "ForwardProgress",
  "ExecutorWork",
  "HostAcquisition",
  "CodexProvider",
  "RunRuntime",
  "ArchiveMaintenance",
  "Inspection",
  "HostWatch",
  "LocalResources"
])
export type ApplicationExitOwnerName = typeof ApplicationExitOwnerName.Type
export interface ApplicationExitOwnerDescription {
  readonly name: ApplicationExitOwnerName
  readonly subject: ApplicationExitOwnerSubject
}

/** Only exact acknowledged workflow identity is projected, never an entire request or response. */
export const ApplicationExitBoundaryIdentity = Schema.Struct({
  family: Schema.Literals(["Git", "TaskTracker"]),
  operationIds: Schema.Array(OperationId),
  baseline: Schema.NullOr(
    Schema.Struct({
      runId: RunId,
      attemptId: AttemptId,
      round: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)))
    })
  )
})
export type ApplicationExitBoundaryIdentity = typeof ApplicationExitBoundaryIdentity.Type

/** Read-only evidence; none of these values authorizes suspension, retry, finality or custody release. */
export const ApplicationExitOwnerDiagnostic = Schema.Struct({
  ownerId: ApplicationExitOwnerId,
  family: Schema.Literals(["ForwardOwner", "ExecutorDrain", "LocalDrain"]),
  name: ApplicationExitOwnerName,
  kind: Schema.Literals([
    "AtomicBoundary",
    "AuthorizedRunTerminationAppend",
    "InterruptibleBoundary",
    "RunActivation",
    "ExecutorDrain",
    "LocalDrain"
  ]),
  subject: ApplicationExitOwnerSubject,
  evidence: Schema.Literals([
    "Preparing",
    "Registered",
    "AwaitingBoundaryResult",
    "BoundaryResultProduced",
    "BoundaryResultRecorded",
    "RecoverableAmbiguity",
    "DrainRegistered",
    "DrainPending",
    "DrainSucceeded",
    "DrainFailed"
  ]),
  boundary: Schema.NullOr(ApplicationExitBoundaryIdentity),
  missingEvidence: Schema.Literals([
    "OwnerRelease",
    "BoundaryObservation",
    "JournalAcknowledgement",
    "CorrelatedExecutorSettlement",
    "LocalCloseAcknowledgement",
    "None"
  ]),
  nextAction: Schema.Literals([
    "AwaitOwnerRelease",
    "ReconcileOriginalAuthorityBeforeRetry",
    "AwaitJournalAcknowledgement",
    "AwaitCorrelatedExecutorSettlement",
    "AwaitLocalClose",
    "InspectDrainFailure",
    "None"
  ])
})
export type ApplicationExitOwnerDiagnostic = typeof ApplicationExitOwnerDiagnostic.Type
export const ApplicationExitOwners = Schema.Struct({
  cutoffClosed: Schema.Boolean,
  owners: Schema.Array(ApplicationExitOwnerDiagnostic)
})
export type ApplicationExitOwners = typeof ApplicationExitOwners.Type
