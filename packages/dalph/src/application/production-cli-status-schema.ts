import {
  AttemptId,
  IntegrationTarget,
  PlannedAttemptExecutorCorrelation,
  PlannedTaskAttempt,
  RunId,
  TaskId
} from "@dalph/contracts"
import type { CurrentDeliveryStatus } from "@dalph/orchestrator"
import {
  BoundedTicketRank,
  DeliveryProposalOrdinal,
  DeliveryProposalId,
  DeliveryStatusEntryIdentity,
  DeliveryStatusEvidenceIdentity,
  DeliveryStatusSubject,
  FreshWorkflowStepTag,
  JournalPosition,
  OperationId,
  RunnableFrontierTransitionTag,
  TaskWorkCapacity,
  TaskClaimReacquisitionRequestId,
  TrackerRevision
} from "@dalph/orchestrator"
import { Match, Schema } from "effect"
import { ObligationReference, PublicTrackerWakeCondition } from "./production-cli-status-identity-schema.js"
import { publicDeliveryStatusEntryOf } from "./production-cli-status-projection.js"

const ProposalOrder = Schema.TaggedUnion({
  FreshWorkflowOrder: { frontierOrdinal: DeliveryProposalOrdinal, step: FreshWorkflowStepTag, taskId: TaskId },
  RecoveredWorkflowOrder: {
    acceptedAt: Schema.NullOr(JournalPosition),
    frontierOrdinal: DeliveryProposalOrdinal,
    responsibilityBeganAt: Schema.NullOr(JournalPosition),
    taskId: TaskId,
    transition: RunnableFrontierTransitionTag
  },
  IntegrationOrder: {
    frontierOrdinal: DeliveryProposalOrdinal,
    queuedAt: JournalPosition,
    startedAt: Schema.NullOr(JournalPosition),
    taskId: TaskId
  },
  UnqueuedAcceptedResultOrder: {
    frontierOrdinal: DeliveryProposalOrdinal,
    taskId: TaskId,
    terminalAt: JournalPosition
  },
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
      TaskClaimReacquisitionRequest: { requestId: TaskClaimReacquisitionRequestId }
    })
  }
})
const ownerLifecycle = Schema.Literals([
  "AdmittedDeliveryAction",
  "MaterializedDeliveryAction",
  "SettledBeforeMaterialization",
  "SettledMaterializedDeliveryAction"
])
const DependencyStandingKind = Schema.Literals([
  "GraphExcluded",
  "PromotedPrerequisiteReleasePending",
  "ResponsibilitySituation",
  "IntegrationWait"
])
const TrackerStandingKind = Schema.Literals(["ResponsibilitySituation", "IntegrationWait", "GraphNotEstablished"])
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
    standingKind: DependencyStandingKind,
    obligationReference: Schema.NullOr(ObligationReference)
  },
  TrackerFactWait: {
    ...entryBase,
    classification: Schema.Literal("Waiting"),
    obligationReference: Schema.NullOr(ObligationReference),
    fact: Schema.TaggedUnion({ Foreign: {}, Missing: {}, Unobserved: {}, Unreadable: {} }),
    standingKind: TrackerStandingKind,
    wakeCondition: PublicTrackerWakeCondition
  },
  TaskWorkCapacityWait: {
    ...entryBase,
    classification: Schema.Literal("Waiting"),
    taskId: TaskId,
    scope: Schema.TaggedStruct("RunTaskWorkCapacityScope", { runId: RunId, capacity: TaskWorkCapacity }),
    rank: BoundedTicketRank,
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
      ProposalDerivationIssue: {
        issueKind: Schema.Literals([
          "AcceptedOperationEvidenceMissing",
          "FreshRouteProvenanceMissing",
          "TypedRoutePolicyContradiction"
        ]),
        taskId: TaskId
      },
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
      Schema.TaggedStruct("DeliverySettlement", { attemptId: AttemptId }),
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

type PublicTrackerFactWait = Extract<typeof PublicDeliveryStatusEntryShape.Type, { readonly _tag: "TrackerFactWait" }>

/** Each standing and observed tracker fact permits only these public wake conditions. */
const trackerFactWakeConditions: Readonly<
  Record<
    PublicTrackerFactWait["standingKind"],
    Readonly<Record<PublicTrackerFactWait["fact"]["_tag"], ReadonlyArray<PublicTrackerFactWait["wakeCondition"]>>>
  >
> = {
  GraphNotEstablished: { Missing: [], Foreign: [], Unreadable: [], Unobserved: ["TaskTrackerFactsObserved"] },
  ResponsibilitySituation: {
    Missing: ["ExplicitAppliedTaskClaimReacquisitionDirection"],
    Foreign: ["ExplicitAppliedTaskClaimReacquisitionDirection"],
    Unreadable: ["TaskClaimFactsObserved", "BoundaryRereadSucceeded"],
    Unobserved: ["TaskClaimFactsObserved"]
  },
  IntegrationWait: {
    Missing: ["ExplicitAppliedTaskClaimReacquisitionDirection"],
    Foreign: ["ExplicitAppliedTaskClaimReacquisitionDirection"],
    Unreadable: ["TaskClaimFactsObserved"],
    Unobserved: ["TaskClaimFactsObserved", "TaskTrackerFactsObserved"]
  }
}
const trackerFactRelationshipIsValid = (entry: PublicTrackerFactWait): boolean =>
  (entry.standingKind === "GraphNotEstablished") === (entry.obligationReference === null) &&
  trackerFactWakeConditions[entry.standingKind][entry.fact._tag].includes(entry.wakeCondition)

const entryRelationshipIsValid = Match.type<typeof PublicDeliveryStatusEntryShape.Type>().pipe(
  Match.tagsExhaustive({
    LiveDeliveryAction: (entry) => {
      const materialized =
        entry.lifecycle === "MaterializedDeliveryAction" || entry.lifecycle === "SettledMaterializedDeliveryAction"
      return materialized === (entry.operationId !== null)
    },
    AcceptedFactPublicationWait: (entry) =>
      (entry.lifecycle === "SettledMaterializedDeliveryAction") === (entry.operationId !== null),
    EvidenceUnavailable: (entry) =>
      (entry.evidence._tag === "ProposalDerivationIssue") === (entry.obligationReference === null),
    EvidenceConflict: (entry) => new Set(entry.evidenceIdentities).size === entry.evidenceIdentities.length,
    DependencyWait: (entry) =>
      taskMatchesSubject(entry.taskId, entry.subject) &&
      (entry.standingKind === "ResponsibilitySituation") === (entry.obligationReference !== null),
    TrackerFactWait: trackerFactRelationshipIsValid,
    TaskWorkCapacityWait: (entry) =>
      entry.scope.runId === entry.subject.runId && taskMatchesSubject(entry.taskId, entry.subject),
    IntegrationTargetWait: (entry) =>
      entry.plannedAttempt.runId === entry.subject.runId &&
      taskMatchesSubject(entry.plannedAttempt.taskId, entry.subject),
    Settlement: (entry) => taskMatchesSubject(entry.taskId, entry.subject),
    ProposedDeliveryAction: (entry) =>
      !("taskId" in entry.order) || taskMatchesSubject(entry.order.taskId, entry.subject),
    Relinquishment: () => true
  })
)

export const PublicDeliveryStatusEntry = PublicDeliveryStatusEntryShape.pipe(
  Schema.refine((entry): entry is typeof entry => entryRelationshipIsValid(entry), {
    message: "status evidence identities and lifecycle must agree with the entry subject and kind"
  })
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
