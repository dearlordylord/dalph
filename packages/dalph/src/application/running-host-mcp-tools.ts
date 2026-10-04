import { Schema } from "effect"
import { RunId } from "@dalph/contracts"
import { RefreshInterest, RunningHostEnvelope } from "./running-host-contract.js"
const document = Schema.toJsonSchemaDocument(RunningHostEnvelope, { additionalProperties: false })
const outputSchema = { ...document.schema, type: "object", $defs: document.definitions }
const inputSchema = {
  type: "object",
  properties: { runId: { type: "string", minLength: 1 } },
  required: ["runId"],
  additionalProperties: false
}
const refreshInput = Schema.toJsonSchemaDocument(Schema.Struct({ runId: RunId, interest: RefreshInterest }), {
  additionalProperties: false
})
export const runningHostMcpTools = [
  {
    name: "dalph_refresh",
    description:
      "Ask the running host to check tracker changes; preserve Pause. Interest is advisory and submission does not prove a completed read.",
    inputSchema: { ...refreshInput.schema, $defs: refreshInput.definitions },
    outputSchema
  },
  {
    name: "dalph_watch_snapshots",
    description: "Attach to current then latest complete snapshots.",
    inputSchema,
    outputSchema
  },
  {
    name: "dalph_close_watch",
    description: "Release only one client watch.",
    inputSchema: {
      ...inputSchema,
      properties: { ...inputSchema.properties, subscriptionId: { type: "string", minLength: 1 } },
      required: ["runId", "subscriptionId"]
    },
    outputSchema
  },
  {
    name: "dalph_read_snapshot",
    description: "Read one coherent passive publication from the selected Run.",
    inputSchema,
    outputSchema
  },
  {
    name: "dalph_read_run_control",
    description: "Read accepted Run control and separately labelled termination evidence.",
    inputSchema,
    outputSchema
  },
  {
    name: "dalph_start_work",
    description: "Submit a request to check for work; preserve Pause.",
    inputSchema,
    outputSchema
  },
  {
    name: "dalph_unpause",
    description: "Explicitly apply Run Unpause and await its owner callback; never automatically replay.",
    inputSchema,
    outputSchema
  }
]
