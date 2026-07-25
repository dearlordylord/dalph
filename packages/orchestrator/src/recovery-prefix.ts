import { Schema } from "effect"

/** Durable M1 endpoint after one session-establishment journal event. */
export const DurableRecoveryPrefix = Schema.Literals(["P1", "P2", "P3", "P4", "P5", "P6"])
export type DurableRecoveryPrefix = typeof DurableRecoveryPrefix.Type

/** M1 reopening endpoint, including the pre-intent P0 recomputation point. */
export const TaskWorkSessionRecoveryPrefix = Schema.Union([
  Schema.Literal("P0"),
  DurableRecoveryPrefix
])
export type TaskWorkSessionRecoveryPrefix = typeof TaskWorkSessionRecoveryPrefix.Type
