import type { PlannedTaskAttempt } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { immutableSnapshot } from "../../../coordination/immutable-snapshot.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import {
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorResumeRedeliveryIntendedRecordKey
} from "../../../workflow-journal/record-key.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorResumeRedeliveryIntendedEvent,
  type PlannedAttemptExecutorCommandOrdinal,
  type PlannedAttemptExecutorCommandProjectionOrdinal,
  type PlannedAttemptExecutorResumeRedeliveryOrdinal
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

const commandDeliveryRecordKey = (
  event: PlannedAttemptExecutorCommandIntendedEvent | PlannedAttemptExecutorResumeRedeliveryIntendedEvent
) =>
  event._tag === "PlannedAttemptExecutorCommandIntended"
    ? plannedAttemptExecutorCommandIntendedRecordKey(event.plannedAttempt.attemptId, event.ordinal)
    : plannedAttemptExecutorResumeRedeliveryIntendedRecordKey(
        event.plannedAttempt.attemptId,
        event.commandOrdinal,
        event.redeliveryOrdinal
      )

const appendedIntentMatches = (
  event: PlannedAttemptExecutorCommandIntendedEvent | PlannedAttemptExecutorResumeRedeliveryIntendedEvent,
  appended: PlannedAttemptExecutorCommandIntendedEvent | PlannedAttemptExecutorResumeRedeliveryIntendedEvent
): boolean =>
  event._tag === "PlannedAttemptExecutorCommandIntended"
    ? appended._tag === event._tag && Schema.toEquivalence(PlannedAttemptExecutorCommandIntendedEvent)(appended, event)
    : appended._tag === event._tag &&
      Schema.toEquivalence(PlannedAttemptExecutorResumeRedeliveryIntendedEvent)(appended, event)

const acceptedDeliveryOf = (
  event: PlannedAttemptExecutorCommandIntendedEvent | PlannedAttemptExecutorResumeRedeliveryIntendedEvent,
  acceptedAt: JournalPosition
): AcceptedExecutorCommandDelivery =>
  Object.freeze<AcceptedExecutorCommandDelivery>({
    [AcceptedExecutorCommandDeliveryTypeId]: AcceptedExecutorCommandDeliveryTypeId,
    acceptedAt,
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

/** Appends the exact delivery intent before issuing its process-local position-handoff receipt. */
export const appendExecutorCommandDeliveryIntent = Effect.fn("ExecutorCommandDelivery.appendIntent")(function* (
  intent: PlannedAttemptExecutorCommandIntendedEvent | PlannedAttemptExecutorResumeRedeliveryIntendedEvent
) {
  const event = immutableSnapshot(intent)
  const journal = yield* InRunJournal
  const key = commandDeliveryRecordKey(event)
  const record = yield* journal.append(event.plannedAttempt.runId, key, event)
  const exactEvent =
    record.event._tag === "PlannedAttemptExecutorCommandIntended" ||
    record.event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended"
      ? appendedIntentMatches(event, record.event)
      : false
  if (record.runId !== event.plannedAttempt.runId || record.key !== key || !exactEvent) {
    return yield* Effect.die("executor command delivery append returned a different Run, key, or intent")
  }
  const receipt = acceptedDeliveryOf(event, record.position)
  acceptedDeliveries.add(receipt)
  return receipt
})
