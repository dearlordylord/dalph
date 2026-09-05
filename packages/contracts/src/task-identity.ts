import { Order, Schema } from "effect"

/** Identifies a tracker-owned task, not one of its attempts or operations. */
export const TaskId = Schema.NonEmptyString.pipe(Schema.brand("TaskId"))
export type TaskId = typeof TaskId.Type

/** Compares tracker task identities in stable, case-sensitive code-unit order. */
export const compareTaskIds: Order.Order<TaskId> = Order.String

/** Fingerprints exact tracker-observed task content; it is not a version counter. */
export const TaskRevision = Schema.NonEmptyString.pipe(Schema.brand("TaskRevision"))
export type TaskRevision = typeof TaskRevision.Type
