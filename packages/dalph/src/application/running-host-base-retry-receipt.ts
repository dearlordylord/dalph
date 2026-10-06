import { TraceCursor } from "@dalph/orchestrator"
import { Effect, Option } from "effect"
import type { ProductionHostObservation } from "./production-host.js"
import type { RunningHostError, RunningHostValue, RunningHostRequest } from "./running-host-contract.js"

/** Reads an exact accepted receipt without command admission, journal writes, or a Run wake. */
export const readRecordedBaseRetryReceipt: (
  control: ProductionHostObservation["taskAttemptBaseRetryControl"],
  request: RunningHostRequest
) => Effect.Effect<
  Option.Option<Extract<RunningHostValue, { readonly _tag: "TaskAttemptBaseRetryRecorded" }>>,
  RunningHostError
> = Effect.fn("RunningHost.readBaseRetryReceipt")(function* (
  control: ProductionHostObservation["taskAttemptBaseRetryControl"],
  request: RunningHostRequest
): Effect.fn.Return<
  Option.Option<Extract<RunningHostValue, { readonly _tag: "TaskAttemptBaseRetryRecorded" }>>,
  RunningHostError
> {
  if (control === undefined || request.operation._tag !== "RetryTaskAttemptBase") return Option.none()
  const receipt = yield* control
    .readTaskAttemptBaseRetryRequest(request.operation.retry)
    .pipe(
      Effect.mapError(
        (error): RunningHostError => ({
          _tag: "CommandFailed",
          operation: "RetryTaskAttemptBase",
          stage: "PreAdmission",
          causeTag: error._tag,
          detail: "The exact Base retry receipt could not be read."
        })
      )
    )
  return receipt._tag === "Recorded"
    ? Option.some({
        _tag: "TaskAttemptBaseRetryRecorded",
        retry: { requestId: receipt.requestId, subject: receipt.subject },
        acceptedAt: TraceCursor.make({ runId: receipt.subject.runId, position: receipt.acceptedAt })
      })
    : Option.none()
})
