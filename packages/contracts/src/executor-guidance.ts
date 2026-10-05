import { Schema } from "effect"
import { PlannedTaskAttempt } from "./planned-attempt.js"

/** Exact deliberate guidance identity; it grants neither replay nor workflow authority. */
export const ExecutorGuidanceRequestId = Schema.NonEmptyString.pipe(Schema.brand("ExecutorGuidanceRequestId"))
export type ExecutorGuidanceRequestId = typeof ExecutorGuidanceRequestId.Type
/** Provider-owned session locator selected internally, never supplied by the model. */
export const ExecutorGuidanceSessionLocator = Schema.NonEmptyString.pipe(Schema.brand("ExecutorGuidanceSessionLocator"))
/** Provider-owned active-turn locator; retained selection forbids future-turn retargeting. */
export const ExecutorGuidanceTurnLocator = Schema.NonEmptyString.pipe(Schema.brand("ExecutorGuidanceTurnLocator"))
export const ExecutorGuidanceTarget = Schema.Struct({
  plannedAttempt: PlannedTaskAttempt,
  session: ExecutorGuidanceSessionLocator,
  turn: ExecutorGuidanceTurnLocator
})
export type ExecutorGuidanceTarget = typeof ExecutorGuidanceTarget.Type
export const ExecutorGuidanceRefusalReason = Schema.Literals([
  "OwnerUnavailable",
  "CapabilityUnavailable",
  "AttemptInactive",
  "CustodyUnproved",
  "TargetChanged",
  "TextTooLarge",
  "PayloadLost"
])
export const ExecutorGuidanceSelection = Schema.TaggedUnion({
  Selected: { target: ExecutorGuidanceTarget },
  Refused: { reason: ExecutorGuidanceRefusalReason }
})
export type ExecutorGuidanceSelection = typeof ExecutorGuidanceSelection.Type
/** Accepted means provider input acknowledgement only; uncertainty never grants a retry. */
export const ExecutorGuidanceTransmission = Schema.TaggedUnion({
  Accepted: {},
  Refused: { reason: ExecutorGuidanceRefusalReason },
  Unknown: {}
})
export type ExecutorGuidanceTransmission = typeof ExecutorGuidanceTransmission.Type
/** The limit applies to original UTF-8 bytes, before JSON or transport escaping. */
const guidanceKilobyteLimit = 16
const bytesPerKilobyte = 1024
export const executorGuidanceTextByteLimit = guidanceKilobyteLimit * bytesPerKilobyte
