import { Effect, Schema } from "effect"
import type { DeliveryProposalFrontier } from "./relations.js"

/** One fixed evaluation reported more successful admission starts than its frontier can contain. */
export class DeliveryRuntimeAdmissionProgressContradiction extends Schema.TaggedError<DeliveryRuntimeAdmissionProgressContradiction>()(
  "DeliveryRuntimeAdmissionProgressContradiction",
  { maximumSuccessfulStarts: Schema.Int, successfulStarts: Schema.Int }
) {}

type AdmissionPass<E> = () => Effect.Effect<boolean, E>

const maximumSuccessfulStartsOf = (frontier: DeliveryProposalFrontier): number =>
  frontier._tag === "DeliveryProposalsAvailable" ? frontier.proposals.length + frontier.freshTaskCandidates.length : 0

/** Runs one finite admission sweep and fails closed when a pass exceeds its fixed frontier budget. */
export const runDeliveryRuntimeAdmissionSweep = Effect.fn("DeliveryRuntime.runAdmissionSweep")(function* <E>(
  frontier: DeliveryProposalFrontier,
  admitPass: AdmissionPass<E>
): Effect.fn.Return<void, E | DeliveryRuntimeAdmissionProgressContradiction> {
  const maximumSuccessfulStarts = maximumSuccessfulStartsOf(frontier)
  const maximumPasses = maximumSuccessfulStarts + 1
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const started = yield* admitPass()
    if (!started) return
    const successfulStarts = pass + 1
    if (successfulStarts > maximumSuccessfulStarts) {
      return yield* new DeliveryRuntimeAdmissionProgressContradiction({ maximumSuccessfulStarts, successfulStarts })
    }
    yield* Effect.yieldNow
  }
})
