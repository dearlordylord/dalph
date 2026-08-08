import { Schema } from "effect"

/** Identifies a fixture locator, not a task, run, or execution resource. */
export const FixtureTarget = Schema.NonEmptyString.pipe(Schema.brand("FixtureTarget"))
export type FixtureTarget = typeof FixtureTarget.Type
