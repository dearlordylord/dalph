import { Schema } from "effect"

/**
 * Conformance-test labels for retained journal cut points, not workflow stages
 * or user-facing priority levels.
 *
 * P1: establishment intent; P2: request attempt; P3: request acknowledgement
 * or typed request failure; P4: fresh-check intent; P5: fresh report or typed
 * lookup failure; P6: established outcome.
 */
export const DurableRecoveryPrefix = Schema.Literals(["P1", "P2", "P3", "P4", "P5", "P6"])
export type DurableRecoveryPrefix = typeof DurableRecoveryPrefix.Type

/** Adds P0: recovery before any establishment intent was durably recorded. */
export const TaskWorkSessionRecoveryPrefix = Schema.Union([
  Schema.Literal("P0"),
  DurableRecoveryPrefix
])
export type TaskWorkSessionRecoveryPrefix = typeof TaskWorkSessionRecoveryPrefix.Type
