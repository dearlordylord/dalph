import type { PlannedTaskAttempt } from "@dalph/contracts"
import { Effect } from "effect"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import type {
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorResumeRedeliveryOrdinal
} from "./events.js"

const AcceptedExecutorCommandDeliveryTypeId: unique symbol = Symbol("@dalph/AcceptedExecutorCommandDelivery")
const acceptedDeliveries = new WeakSet<object>()

/** An exact append receipt transferring a reserved position to durable executor command-delivery responsibility. */
export interface AcceptedExecutorCommandDelivery {
  readonly [AcceptedExecutorCommandDeliveryTypeId]: typeof AcceptedExecutorCommandDeliveryTypeId
  readonly acceptedAt: JournalPosition
  readonly plannedAttempt: PlannedTaskAttempt
  readonly commandOrdinal: PlannedAttemptExecutorCommandOrdinal
  readonly delivery:
    | { readonly _tag: "InitialCommandDelivery"; readonly command: "Begin" | "Resume" | "Suspend" }
    | {
        readonly _tag: "ResumeRedelivery"
        readonly ordinal: PlannedAttemptExecutorResumeRedeliveryOrdinal
        readonly projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal
        readonly safeProjectionObservedAt: JournalPosition
      }
}

export const isAcceptedExecutorCommandDelivery = (value: unknown): value is AcceptedExecutorCommandDelivery =>
  typeof value === "object" && value !== null && acceptedDeliveries.has(value)

/** Only the command protocol calls this after its exact Journal append succeeds. */
export const acceptedExecutorCommandDelivery = Effect.fn("ExecutorCommandDelivery.acceptedReceipt")(function* (
  record: JournalRecord
) {
  const event = record.event
  if (
    event._tag !== "PlannedAttemptExecutorCommandIntended" &&
    event._tag !== "PlannedAttemptExecutorResumeRedeliveryIntended"
  ) {
    return yield* Effect.die("executor command delivery requires an accepted command-delivery intent")
  }
  const receipt = Object.freeze<AcceptedExecutorCommandDelivery>({
    [AcceptedExecutorCommandDeliveryTypeId]: AcceptedExecutorCommandDeliveryTypeId,
    acceptedAt: record.position,
    plannedAttempt: event.plannedAttempt,
    commandOrdinal: event._tag === "PlannedAttemptExecutorCommandIntended" ? event.ordinal : event.commandOrdinal,
    delivery:
      event._tag === "PlannedAttemptExecutorCommandIntended"
        ? Object.freeze({ _tag: "InitialCommandDelivery" as const, command: event.command })
        : Object.freeze({
            _tag: "ResumeRedelivery" as const,
            ordinal: event.redeliveryOrdinal,
            projectionOrdinal: event.projectionOrdinal,
            safeProjectionObservedAt: event.authorization.safeProjectionObservedAt
          })
  })
  acceptedDeliveries.add(receipt)
  return receipt
})
