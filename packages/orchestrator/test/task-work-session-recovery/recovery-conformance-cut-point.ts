import { Schema } from "effect"

/**
 * Conformance-test labels for retained journal cut points. These labels must
 * never be used as production workflow stages, states, events, priorities, or
 * runtime terminology.
 *
 * P1: establishment intent; P2: request attempt; P3: request acknowledgement
 * or typed request failure; P4: fresh-check intent; P5: fresh report or typed
 * lookup failure; P6: established outcome.
 */
const DurableRecoveryConformanceCutPoint = Schema.Literals(["P1", "P2", "P3", "P4", "P5", "P6"])

/** Adds P0: recovery before any establishment intent was durably recorded. */
export const TaskWorkSessionRecoveryConformanceCutPoint = Schema.Union([
  Schema.Literal("P0"),
  DurableRecoveryConformanceCutPoint
])
export type TaskWorkSessionRecoveryConformanceCutPoint = typeof TaskWorkSessionRecoveryConformanceCutPoint.Type
