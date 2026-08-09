import { Schema } from "effect"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"

/**
 * Values Dalph captures when Run establishment creates a new Run.
 *
 * Establishment records revision one. Later Operator changes use the
 * revision-checked task-work-capacity protocol; an already-established Run
 * accepts no replacement initial copy.
 */
export const InitialControlPolicy = Schema.Struct({ taskExecutionCapacity: TaskWorkCapacity })
export type InitialControlPolicy = typeof InitialControlPolicy.Type

/** Monotonic durable revision of one Run's applied control policy. */
export const RunPolicyRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("RunPolicyRevision")
)
export type RunPolicyRevision = typeof RunPolicyRevision.Type

export const initialRunPolicyRevision = RunPolicyRevision.make(1)

/** Latest task-work capacity that Dalph durably applied to one Run. */
export const RunControlPolicy = Schema.Struct({ revision: RunPolicyRevision, taskExecutionCapacity: TaskWorkCapacity })
export type RunControlPolicy = typeof RunControlPolicy.Type
