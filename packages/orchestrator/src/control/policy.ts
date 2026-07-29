import { Schema } from "effect"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"

/**
 * Values Dalph captures when it creates a fresh coordinator.
 *
 * This startup boundary does not authorize later policy changes. Recovery and
 * live policy revision remain separate, future production protocols.
 */
export const InitialControlPolicy = Schema.Struct({ taskExecutionCapacity: TaskWorkCapacity })
export type InitialControlPolicy = typeof InitialControlPolicy.Type
