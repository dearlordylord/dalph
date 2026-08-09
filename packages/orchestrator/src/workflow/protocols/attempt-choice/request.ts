import { Schema } from "effect"
import { AttemptChoice, AttemptChoiceRequestId, AttemptChoiceSubject } from "./events.js"

/** Ephemeral Operator input; only a successfully applied choice becomes history. */
export const ApplyAttemptChoiceRequest = Schema.Struct({
  choice: AttemptChoice,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
})
export type ApplyAttemptChoiceRequest = typeof ApplyAttemptChoiceRequest.Type
