import { Schema } from "effect"

/** Zero-based durable identity slot for one task's immutable planned attempts. */
export const PlannedTaskAttemptOrdinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("PlannedTaskAttemptOrdinal")
)
export type PlannedTaskAttemptOrdinal = typeof PlannedTaskAttemptOrdinal.Type
