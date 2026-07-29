import { Schema } from "effect"

/** Locates the configured executor that will receive one planned task attempt. */
export const TaskExecutorLocator = Schema.NonEmptyString.pipe(Schema.brand("TaskExecutorLocator"))
export type TaskExecutorLocator = typeof TaskExecutorLocator.Type
