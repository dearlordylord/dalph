import { Effect } from "effect"
import { runAuthoredScenarioCassetteWithCandidateRuntime } from "./authored-runner.js"

/**
 * Package-private #183 seam. Tests import this leaf directly; no package barrel
 * or production command can select the candidate runtime before #184.
 */
export const runCandidateDeliveryRuntimeCassette = Effect.fn("AuthoredCassette.runCandidateRuntime")((input: unknown) =>
  runAuthoredScenarioCassetteWithCandidateRuntime(input)
)
