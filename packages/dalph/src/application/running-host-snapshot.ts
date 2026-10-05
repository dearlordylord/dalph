import { PlannedAttemptExecutorCorrelation, PlannedTaskAttempt, RunId, TaskId, TaskRevision } from "@dalph/contracts"
import { BoundedTicketRank, RunControlPolicy, TaskDagWire, TraceCursor } from "@dalph/orchestrator"
import { Schema } from "effect"
import { RunningHostInspection } from "./running-host-inspection.js"
import { ObligationReference } from "./production-cli-status-identity-schema.js"
import { ProductionCliCurrentDeliveryStatus } from "./production-cli-status-schema.js"

const Reason = Schema.TaggedUnion({
  PrerequisitesIncomplete: { prerequisiteTaskIds: Schema.Array(TaskId) },
  SuccessfulCompletion: {},
  TerminalWithoutSuccess: {}
})
const Standing = Schema.TaggedUnion({
  Eligible: { taskId: TaskId, taskRevision: TaskRevision },
  Excluded: { taskId: TaskId, reasons: Schema.NonEmptyArray(Reason) }
})
const Placement = Schema.TaggedUnion({
  Selected: { rank: BoundedTicketRank },
  EligibleOutsideBound: { rank: BoundedTicketRank },
  GraphExcluded: { reasons: Schema.NonEmptyArray(Reason) }
})
const ReadySnapshotShape = Schema.TaggedStruct("Ready", {
  runId: RunId,
  acceptedAt: Schema.NullOr(TraceCursor),
  graph: Schema.TaggedUnion({ GraphNotEstablished: {}, GraphEstablished: { snapshot: TaskDagWire } }),
  frontier: Schema.Struct({
    policy: RunControlPolicy,
    standings: Schema.Array(Standing),
    placements: Schema.Array(Schema.Struct({ taskId: TaskId, placement: Placement }))
  }),
  delivery: ProductionCliCurrentDeliveryStatus,
  retained: Schema.Array(
    Schema.Struct({
      taskId: TaskId,
      obligationReference: ObligationReference,
      kind: Schema.Literals([
        "WorkflowResponsibility",
        "AcceptedAwaitingIntegration",
        "QueuedIntegration",
        "StartedIntegration"
      ]),
      plannedAttempt: Schema.NullOr(PlannedTaskAttempt)
    })
  ),
  held: Schema.Array(Schema.Struct({ taskId: TaskId, correlation: PlannedAttemptExecutorCorrelation }))
})
/** Reject inconsistent identities or unsafe numeric encodings anywhere in a public value. */
export const coherentWire = (value: unknown, runId: RunId | null): boolean => {
  if (typeof value === "number") return Number.isSafeInteger(value)
  if (value === null || typeof value !== "object") return true
  if (runId !== null && "runId" in value && value.runId !== runId) return false
  return Object.values(value).every((nested) => coherentWire(nested, runId))
}
const ReadySnapshot = ReadySnapshotShape.check(
  Schema.makeFilter(
    (value) =>
      (coherentWire(value, value.runId) &&
        value.delivery._tag === "DeliveryStatusAvailable" &&
        value.delivery.subject._tag === "Run" &&
        value.delivery.acceptedAt === (value.acceptedAt?.position ?? null) &&
        new Set(value.retained.map(({ obligationReference }) => obligationReference)).size === value.retained.length &&
        value.retained.every(
          ({ plannedAttempt, taskId }) => plannedAttempt === null || plannedAttempt.taskId === taskId
        )) ||
      "snapshot identities, accepted position and exact retained obligations must agree"
  )
)
export const RunningHostSnapshot = Schema.Union([
  Schema.TaggedStruct("NotReady", { runId: RunId }),
  ReadySnapshot,
  Schema.TaggedStruct("Closed", { runId: RunId, final: Schema.NullOr(ReadySnapshot) }).check(
    Schema.makeFilter((value) => coherentWire(value, value.runId) || "closed publication belongs to another Run")
  )
])
export type RunningHostSnapshot = typeof RunningHostSnapshot.Type
/** Joins independently fresh observations for presentation, with no atomic-source claim. */
export const RunningHostInspectionSnapshot = Schema.TaggedStruct("InspectionSnapshot", {
  run: RunningHostSnapshot,
  inspection: RunningHostInspection
})
export type RunningHostInspectionSnapshot = typeof RunningHostInspectionSnapshot.Type
