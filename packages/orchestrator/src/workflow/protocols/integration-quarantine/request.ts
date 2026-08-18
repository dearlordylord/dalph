import { Schema } from "effect"
import { IntegrationQuarantineDirectionRequestId } from "./events.js"

/** Ephemeral read input for one durable quarantine-direction request identity. */
export const ReadIntegrationQuarantineDirectionRequest = Schema.Struct({
  requestId: IntegrationQuarantineDirectionRequestId
})
export type ReadIntegrationQuarantineDirectionRequest = typeof ReadIntegrationQuarantineDirectionRequest.Type
