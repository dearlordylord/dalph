import { Schema } from "effect"
import { ControlDirection, ControlDirectionSubject } from "./events.js"

/** Ephemeral input to the application boundary; receipt is not a workflow occurrence. */
export const ApplyControlDirectionRequest = Schema.Struct({
  direction: ControlDirection,
  subject: ControlDirectionSubject
})
export type ApplyControlDirectionRequest = typeof ApplyControlDirectionRequest.Type
