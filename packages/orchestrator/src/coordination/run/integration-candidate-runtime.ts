import { Effect } from "effect"
import type { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import type { IntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import type { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import {
  type CandidateContinuationLimit,
  type CandidateCorrectionLimit,
  continueIntegrationCandidateConstruction
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"

/** Continues one started integration and releases its target only after durable non-convergence. */
export const runIntegrationCandidateConstruction = Effect.fn("IntegrationCandidateConstruction.run")(function* (
  responsibility: StartedIntegrationResponsibility,
  lineage: TargetLineageObservation,
  correctionLimit: CandidateCorrectionLimit,
  continuationLimit: CandidateContinuationLimit,
  integrationResources: IntegrationTargetResourceController
) {
  return yield* integrationResources.withPermit(
    responsibility,
    Effect.gen(function* () {
      const state = yield* continueIntegrationCandidateConstruction(
        responsibility,
        lineage,
        correctionLimit,
        continuationLimit
      )
      if (state._tag === "CandidateCorrectionLimitReached" || state._tag === "CandidateContinuationLimitReached") {
        yield* integrationResources.release(responsibility)
      }
      return state
    })
  )
})
