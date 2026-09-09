import {
  IntegrationTarget,
  PlannedAttemptExecutorCorrelation,
  PlannedTaskAttempt,
  RunId,
  TaskId
} from "@dalph/contracts"
import type { CurrentDeliveryStatus } from "@dalph/orchestrator"
import {
  DeliveryProposalId,
  DeliveryStatusEntryIdentity,
  DeliveryStatusEvidenceIdentity,
  DeliveryStatusSubject,
  JournalPosition,
  OperationId,
  TaskWorkCapacity,
  TrackerRevision
} from "@dalph/orchestrator"
import { Schema } from "effect"
import { ObligationReference } from "./production-cli-status-identity-schema.js"
import { publicDeliveryStatusEntryOf } from "./production-cli-status-projection.js"

const ProposalOrdinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand("DeliveryProposalOrdinal"))
const ProposalOrder = Schema.TaggedUnion({
  FreshWorkflowOrder: { frontierOrdinal: ProposalOrdinal, step: Schema.NonEmptyString, taskId: TaskId },
  RecoveredWorkflowOrder: {
    acceptedAt: Schema.NullOr(JournalPosition),
    frontierOrdinal: ProposalOrdinal,
    responsibilityBeganAt: Schema.NullOr(JournalPosition),
    taskId: TaskId,
    transition: Schema.NonEmptyString
  },
  IntegrationOrder: {
    frontierOrdinal: ProposalOrdinal,
    queuedAt: JournalPosition,
    startedAt: Schema.NullOr(JournalPosition),
    taskId: TaskId
  },
  UnqueuedAcceptedResultOrder: { frontierOrdinal: ProposalOrdinal, taskId: TaskId, terminalAt: JournalPosition },
  TrackerGraphOrder: { acceptedAt: Schema.NullOr(JournalPosition) }
})
const ActionIdentity = Schema.TaggedUnion({
  ExistingOperationId: {},
  FreshOperationAndAttemptIdsRequired: {},
  NoWorkflowOperationIdentity: {},
  FreshOperationIdRequired: {
    source: Schema.TaggedUnion({
      Allocate: {},
      Preserve: { operationId: OperationId },
      ExternalSuccessReleaseClaim: { claimOperationId: OperationId },
      TaskClaimReacquisitionRequest: { requestId: Schema.NonEmptyString }
    })
  }
})
const ownerLifecycle = Schema.Literals([
  "AdmittedDeliveryAction",
  "MaterializedDeliveryAction",
  "SettledBeforeMaterialization",
  "SettledMaterializedDeliveryAction"
])
const standingKind = Schema.Literals([
  "GraphExcluded",
  "PromotedPrerequisiteReleasePending",
  "ResponsibilitySituation",
  "IntegrationWait",
  "ExactEvidenceConflict",
  "GraphNotEstablished"
])
const entryBase = {
  classification: Schema.Literals(["Waiting", "Progressing", "Blocked", "Settled", "Relinquished"]),
  entryIdentity: DeliveryStatusEntryIdentity,
  subject: DeliveryStatusSubject
}

const PublicDeliveryStatusEntryShape = Schema.TaggedUnion({
  DependencyWait: {
    ...entryBase,
    classification: Schema.Literal("Waiting"),
    taskId: TaskId,
    prerequisiteTaskIds: Schema.NonEmptyArray(TaskId),
    standingKind,
    obligationReference: Schema.NullOr(ObligationReference)
  },
  TrackerFactWait: {
    ...entryBase,
    classification: Schema.Literal("Waiting"),
    obligationReference: Schema.NullOr(ObligationReference),
    fact: Schema.TaggedUnion({ Foreign: {}, Missing: {}, Unobserved: {}, Unreadable: {} }),
    standingKind,
    wakeCondition: Schema.NonEmptyString
  },
  TaskWorkCapacityWait: {
    ...entryBase,
    classification: Schema.Literal("Waiting"),
    taskId: TaskId,
    scope: Schema.TaggedStruct("RunTaskWorkCapacityScope", { runId: RunId, capacity: TaskWorkCapacity }),
    rank: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    holders: Schema.Array(Schema.Struct({ taskId: TaskId, correlation: PlannedAttemptExecutorCorrelation }))
  },
  ProposedDeliveryAction: {
    ...entryBase,
    classification: Schema.Literal("Waiting"),
    proposalId: DeliveryProposalId,
    order: ProposalOrder,
    waitsForLiveOperationId: Schema.NullOr(OperationId),
    actionIdentity: ActionIdentity
  },
  LiveDeliveryAction: {
    ...entryBase,
    classification: Schema.Literal("Progressing"),
    proposalId: DeliveryProposalId,
    lifecycle: ownerLifecycle,
    operationId: Schema.NullOr(OperationId)
  },
  AcceptedFactPublicationWait: {
    ...entryBase,
    classification: Schema.Literal("Waiting"),
    proposalId: DeliveryProposalId,
    lifecycle: Schema.Literals(["SettledBeforeMaterialization", "SettledMaterializedDeliveryAction"]),
    operationId: Schema.NullOr(OperationId),
    acceptedAt: Schema.NullOr(JournalPosition)
  },
  IntegrationTargetWait: {
    ...entryBase,
    classification: Schema.Literal("Waiting"),
    plannedAttempt: PlannedTaskAttempt,
    integrationTarget: IntegrationTarget,
    obligationReference: ObligationReference,
    queuedAt: JournalPosition
  },
  EvidenceUnavailable: {
    ...entryBase,
    classification: Schema.Literal("Blocked"),
    obligationReference: Schema.NullOr(ObligationReference),
    evidence: Schema.TaggedUnion({
      ProposalDerivationIssue: { issueKind: Schema.NonEmptyString, taskId: TaskId },
      ResponsibilityFacts: { responsibilityReference: ObligationReference },
      IntegrationConfigurationWait: { plannedAttempt: PlannedTaskAttempt },
      TargetPromotionConfigurationWait: { plannedAttempt: PlannedTaskAttempt }
    })
  },
  EvidenceConflict: {
    ...entryBase,
    classification: Schema.Literal("Blocked"),
    obligationReference: Schema.NullOr(ObligationReference),
    evidenceIdentities: Schema.NonEmptyArray(DeliveryStatusEvidenceIdentity)
  },
  Settlement: {
    ...entryBase,
    classification: Schema.Literal("Settled"),
    taskId: TaskId,
    settlement: Schema.Union([
      Schema.TaggedStruct("DeliverySettlement", { attemptId: Schema.NonEmptyString }),
      Schema.TaggedStruct("CancelledAttemptSettled", {
        obligationReference: ObligationReference,
        claimDisposition: Schema.Literals(["NoRelease", "Released"])
      }),
      Schema.TaggedStruct("StoppedAttemptSettled", {
        obligationReference: ObligationReference,
        claimDisposition: Schema.Literals(["NoRelease", "Released"])
      })
    ])
  },
  Relinquishment: {
    ...entryBase,
    classification: Schema.Literal("Relinquished"),
    obligationReference: ObligationReference,
    supporting: Schema.Union([
      Schema.TaggedStruct("PlannedAttempt", { correlation: PlannedAttemptExecutorCorrelation }),
      Schema.TaggedStruct("WorkflowOperation", { operationId: OperationId })
    ]),
    reason: Schema.Literals(["AuthorizedHandoff", "FreshAuthorityRevocation"])
  }
})
const taskMatchesSubject = (taskId: TaskId, subject: DeliveryStatusSubject): boolean =>
  subject._tag === "Run" || subject.taskId === taskId

export const PublicDeliveryStatusEntry = PublicDeliveryStatusEntryShape.pipe(
  Schema.refine(
    (entry): entry is typeof entry => {
      if (entry._tag === "LiveDeliveryAction") {
        const materialized =
          entry.lifecycle === "MaterializedDeliveryAction" || entry.lifecycle === "SettledMaterializedDeliveryAction"
        return materialized === (entry.operationId !== null)
      }
      if (entry._tag === "AcceptedFactPublicationWait") {
        return (entry.lifecycle === "SettledMaterializedDeliveryAction") === (entry.operationId !== null)
      }
      if (entry._tag === "EvidenceUnavailable") {
        return (entry.evidence._tag === "ProposalDerivationIssue") === (entry.obligationReference === null)
      }
      if (entry._tag === "EvidenceConflict") {
        return new Set(entry.evidenceIdentities).size === entry.evidenceIdentities.length
      }
      if (entry._tag === "TaskWorkCapacityWait") {
        return entry.scope.runId === entry.subject.runId && taskMatchesSubject(entry.taskId, entry.subject)
      }
      if (entry._tag === "IntegrationTargetWait") {
        return (
          entry.plannedAttempt.runId === entry.subject.runId &&
          taskMatchesSubject(entry.plannedAttempt.taskId, entry.subject)
        )
      }
      if (entry._tag === "Settlement") return taskMatchesSubject(entry.taskId, entry.subject)
      if (entry._tag === "DependencyWait") return taskMatchesSubject(entry.taskId, entry.subject)
      if (entry._tag === "ProposedDeliveryAction" && "taskId" in entry.order) {
        return taskMatchesSubject(entry.order.taskId, entry.subject)
      }
      return true
    },
    { message: "status evidence identities and lifecycle must agree with the entry subject and kind" }
  )
)
export type PublicDeliveryStatusEntry = typeof PublicDeliveryStatusEntry.Type

const SnapshotShape = Schema.TaggedUnion({
  DeliveryStatusAvailable: {
    acceptedAt: Schema.NullOr(JournalPosition),
    entries: Schema.Array(PublicDeliveryStatusEntry),
    subject: DeliveryStatusSubject
  },
  DeliveryStatusNotReady: { subject: DeliveryStatusSubject },
  TaskAbsentFromCurrentGraph: {
    graphSource: Schema.TaggedStruct("EstablishedGraph", {
      revision: TrackerRevision,
      operationId: OperationId,
      freshnessOperationId: OperationId,
      contentIdentity: TrackerRevision,
      recordedAt: JournalPosition
    }),
    subject: DeliveryStatusSubject.cases.Task
  }
})
const belongs = (entry: DeliveryStatusSubject, subject: DeliveryStatusSubject): boolean =>
  entry.runId === subject.runId &&
  (subject._tag === "Run" || (entry._tag === "Task" && entry.taskId === subject.taskId))
const Snapshot = SnapshotShape.pipe(
  Schema.refine(
    (status): status is typeof status =>
      status._tag !== "DeliveryStatusAvailable" ||
      status.entries.every((entry) => belongs(entry.subject, status.subject)),
    { message: "every entry must belong to its status subject" }
  )
)
const sameSubject = (left: DeliveryStatusSubject, right: DeliveryStatusSubject): boolean =>
  left._tag === right._tag &&
  left.runId === right.runId &&
  (left._tag === "Run" || (right._tag === "Task" && left.taskId === right.taskId))

export const ProductionCliCurrentDeliveryStatus = Schema.Union([
  Snapshot,
  Schema.TaggedStruct("DeliveryStatusClosed", { final: Schema.NullOr(Snapshot), subject: DeliveryStatusSubject })
]).pipe(
  Schema.refine(
    (status): status is typeof status =>
      status._tag !== "DeliveryStatusClosed" ||
      status.final === null ||
      sameSubject(status.final.subject, status.subject),
    { message: "closed status and final status must have the same subject" }
  )
)
export type ProductionCliCurrentDeliveryStatus = typeof ProductionCliCurrentDeliveryStatus.Type
type PublicSnapshot = Exclude<ProductionCliCurrentDeliveryStatus, { readonly _tag: "DeliveryStatusClosed" }>
type DeliveryStatusSnapshot = Exclude<CurrentDeliveryStatus, { readonly _tag: "DeliveryStatusClosed" }>
const publicSnapshotOf = (status: DeliveryStatusSnapshot): PublicSnapshot => {
  switch (status._tag) {
    case "DeliveryStatusNotReady":
    case "TaskAbsentFromCurrentGraph":
      return status
    case "DeliveryStatusAvailable":
      return { ...status, entries: status.entries.map(publicDeliveryStatusEntryOf) }
  }
}
export const publicDeliveryStatusOf = (status: CurrentDeliveryStatus): ProductionCliCurrentDeliveryStatus => {
  switch (status._tag) {
    case "DeliveryStatusNotReady":
    case "DeliveryStatusAvailable":
    case "TaskAbsentFromCurrentGraph":
      return publicSnapshotOf(status)
    case "DeliveryStatusClosed":
      return { ...status, final: status.final === null ? null : publicSnapshotOf(status.final) }
  }
}
