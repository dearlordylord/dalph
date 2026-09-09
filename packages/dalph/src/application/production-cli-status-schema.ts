import { IntegrationTarget, PlannedAttemptExecutorCorrelation, RunId, TaskId } from "@dalph/contracts"
import {
  DeliveryStatusEvidenceIdentity,
  DeliveryStatusSubject,
  JournalPosition,
  OperationId,
  TaskWorkCapacity,
  TrackerRevision
} from "@dalph/orchestrator"
import { Schema } from "effect"

const ProductionCliDeliveryStatusTrackerFact = Schema.TaggedUnion({
  Foreign: { boundary: Schema.Literal("TaskTracker") },
  Missing: { boundary: Schema.Literal("TaskTracker") },
  Unobserved: { boundary: Schema.Literal("TaskTracker") },
  Unreadable: { boundary: Schema.Literal("TaskTracker") }
})

type TaggedJson = Schema.Json & { readonly _tag: string }

const TaggedJson = Schema.Json.pipe(
  Schema.refine(
    (value): value is TaggedJson =>
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      "_tag" in value &&
      typeof value["_tag"] === "string",
    { message: "a tagged public status fact is required" }
  )
)

const ProductionCliDeliveryStatusUnavailableEvidence = Schema.TaggedUnion({
  IntegrationConfigurationWait: { standing: TaggedJson, wait: TaggedJson },
  ProposalDerivationIssue: { issue: TaggedJson },
  ResponsibilityFacts: { facts: TaggedJson },
  TargetPromotionConfigurationWait: { standing: TaggedJson, wait: TaggedJson }
})

const ProductionCliDeliveryStatusEntry = Schema.TaggedUnion({
  AcceptedFactPublicationWait: {
    acceptedAt: Schema.NullOr(JournalPosition),
    classification: Schema.Literal("Waiting"),
    owner: TaggedJson,
    subject: DeliveryStatusSubject
  },
  DependencyWait: {
    classification: Schema.Literal("Waiting"),
    prerequisiteTaskIds: Schema.NonEmptyArray(TaskId),
    standing: TaggedJson,
    subject: DeliveryStatusSubject,
    taskId: TaskId
  },
  EvidenceConflict: {
    classification: Schema.Literal("Blocked"),
    evidenceIdentities: Schema.NonEmptyArray(DeliveryStatusEvidenceIdentity),
    responsibility: Schema.NullOr(TaggedJson),
    standing: TaggedJson,
    subject: DeliveryStatusSubject
  },
  EvidenceUnavailable: {
    classification: Schema.Literal("Blocked"),
    evidence: ProductionCliDeliveryStatusUnavailableEvidence,
    responsibility: Schema.NullOr(TaggedJson),
    subject: DeliveryStatusSubject
  },
  IntegrationTargetWait: {
    classification: Schema.Literal("Waiting"),
    integrationTarget: IntegrationTarget,
    plannedAttempt: Schema.Json,
    responsibility: TaggedJson,
    standing: TaggedJson,
    subject: DeliveryStatusSubject,
    wait: TaggedJson
  },
  LiveDeliveryAction: {
    classification: Schema.Literal("Progressing"),
    owner: TaggedJson,
    subject: DeliveryStatusSubject
  },
  ProposedDeliveryAction: {
    classification: Schema.Literal("Waiting"),
    proposal: TaggedJson,
    subject: DeliveryStatusSubject
  },
  Relinquishment: {
    classification: Schema.Literal("Relinquished"),
    reason: Schema.Literals(["AuthorizedHandoff", "FreshAuthorityRevocation"]),
    responsibility: TaggedJson,
    subject: DeliveryStatusSubject,
    supporting: TaggedJson
  },
  Settlement: {
    classification: Schema.Literal("Settled"),
    settlement: TaggedJson,
    subject: DeliveryStatusSubject.cases.Task
  },
  TaskWorkCapacityWait: {
    classification: Schema.Literal("Waiting"),
    holders: Schema.Array(Schema.Struct({ correlation: PlannedAttemptExecutorCorrelation, taskId: TaskId })),
    placement: TaggedJson,
    scope: Schema.TaggedStruct("RunTaskWorkCapacityScope", { capacity: TaskWorkCapacity, runId: RunId }),
    subject: DeliveryStatusSubject,
    taskId: TaskId
  },
  TrackerFactWait: {
    classification: Schema.Literal("Waiting"),
    fact: ProductionCliDeliveryStatusTrackerFact,
    responsibility: Schema.NullOr(TaggedJson),
    standing: TaggedJson,
    subject: DeliveryStatusSubject,
    wakeCondition: Schema.NonEmptyString
  }
}).pipe(
  Schema.refine(
    (entry): entry is typeof entry => {
      if (entry._tag === "TrackerFactWait" && entry.responsibility === null) {
        return (
          entry.fact._tag === "Unobserved" &&
          entry.wakeCondition === "TaskTrackerFactsObserved" &&
          entry.standing["_tag"] === "GraphNotEstablished"
        )
      }
      if (entry._tag !== "EvidenceUnavailable") return true
      switch (entry.evidence._tag) {
        case "ProposalDerivationIssue":
          return entry.responsibility === null
        case "ResponsibilityFacts":
          return entry.responsibility !== null
        case "IntegrationConfigurationWait":
          return entry.responsibility?.["_tag"] === "AcceptedAwaitingIntegration"
        case "TargetPromotionConfigurationWait":
          return entry.responsibility?.["_tag"] === "StartedIntegration"
      }
    },
    { message: "status evidence must match its exact responsibility and wait relationship" }
  )
)

const ProductionCliDeliveryStatusSnapshot = Schema.TaggedUnion({
  DeliveryStatusAvailable: {
    acceptedAt: Schema.NullOr(JournalPosition),
    entries: Schema.Array(ProductionCliDeliveryStatusEntry),
    subject: DeliveryStatusSubject
  },
  DeliveryStatusNotReady: { subject: DeliveryStatusSubject },
  TaskAbsentFromCurrentGraph: {
    graphSource: Schema.TaggedStruct("EstablishedGraph", {
      contentIdentity: TrackerRevision,
      freshnessOperationId: OperationId,
      operationId: OperationId,
      recordedAt: JournalPosition,
      revision: TrackerRevision
    }),
    subject: DeliveryStatusSubject.cases.Task
  }
})

const sameSubject = (left: DeliveryStatusSubject, right: DeliveryStatusSubject): boolean =>
  left._tag === right._tag &&
  left.runId === right.runId &&
  (left._tag === "Run" || (right._tag === "Task" && left.taskId === right.taskId))

const entryBelongsTo = (entry: DeliveryStatusSubject, status: DeliveryStatusSubject): boolean =>
  entry.runId === status.runId && (status._tag === "Run" || (entry._tag === "Task" && entry.taskId === status.taskId))

/** Exhaustive version-one presentation wire for the canonical passive status algebra. */
export const ProductionCliCurrentDeliveryStatus = Schema.Union([
  ProductionCliDeliveryStatusSnapshot,
  Schema.TaggedStruct("DeliveryStatusClosed", {
    final: Schema.NullOr(ProductionCliDeliveryStatusSnapshot),
    subject: DeliveryStatusSubject
  })
]).pipe(
  Schema.refine(
    (status): status is typeof status =>
      status._tag === "DeliveryStatusAvailable"
        ? status.entries.every((entry) => entryBelongsTo(entry.subject, status.subject))
        : status._tag !== "DeliveryStatusClosed" ||
          status.final === null ||
          sameSubject(status.final.subject, status.subject),
    { message: "status, entry, and final subjects must identify the same Run or task" }
  )
)
