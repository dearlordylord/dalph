import {
  ExecutorGuidanceRequestId,
  ExecutorGuidanceTarget,
  ExecutorGuidanceTransmission,
  PlannedTaskAttempt
} from "@dalph/contracts"
import { Schema } from "effect"
import { workflowJournalEventVersion } from "../../kernel/event.js"

/** Digest of ephemeral input bytes; no evidence object or durable payload is created. */
export const ExecutorGuidancePayloadDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(
  Schema.brand("ExecutorGuidancePayloadDigest")
)
/** Original UTF-8 length, including oversized refusal metadata; never persisted input bytes. */
export const ExecutorGuidancePayloadBytes = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("ExecutorGuidancePayloadBytes")
)
export const ExecutorGuidanceMetadata = Schema.Struct({
  requestId: ExecutorGuidanceRequestId,
  plannedAttempt: PlannedTaskAttempt,
  payloadDigest: ExecutorGuidancePayloadDigest,
  payloadBytes: ExecutorGuidancePayloadBytes
})
export type ExecutorGuidanceMetadata = typeof ExecutorGuidanceMetadata.Type

/** Admission retains request identity only; a crash can permanently lose the unsent text. */
export const ExecutorGuidanceAdmittedEvent = Schema.TaggedStruct("ExecutorGuidanceAdmitted", {
  metadata: ExecutorGuidanceMetadata,
  version: Schema.Literal(workflowJournalEventVersion)
})
/** Permission for exactly one possible transmission, before the provider effect. */
export const ExecutorGuidanceDispatchIntendedEvent = Schema.TaggedStruct("ExecutorGuidanceDispatchIntended", {
  requestId: ExecutorGuidanceRequestId,
  target: ExecutorGuidanceTarget,
  version: Schema.Literal(workflowJournalEventVersion)
})
/** Observed acknowledgement or uncertainty; never model comprehension or workflow authority. */
export const ExecutorGuidanceObservedEvent = Schema.TaggedStruct("ExecutorGuidanceObserved", {
  requestId: ExecutorGuidanceRequestId,
  disposition: ExecutorGuidanceTransmission,
  version: Schema.Literal(workflowJournalEventVersion)
})
