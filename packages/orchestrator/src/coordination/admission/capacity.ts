import { Schema } from "effect"

// Accepted policy: https://github.com/dearlordylord/dalph/issues/24
// Runtime resizing owner: https://github.com/dearlordylord/dalph/issues/54
// Other future-only run-policy changes: https://github.com/dearlordylord/dalph/issues/64
const defaultTaskWorkCapacityValue = 2
export const maximumTaskWorkCapacityValue = 8

/** The bounded number of runnable tasks that the coordinator may admit for execution. */
export const TaskWorkCapacity = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(maximumTaskWorkCapacityValue)
).pipe(Schema.brand("TaskWorkCapacity"))
export type TaskWorkCapacity = typeof TaskWorkCapacity.Type

export const defaultTaskWorkCapacity = TaskWorkCapacity.make(defaultTaskWorkCapacityValue)
