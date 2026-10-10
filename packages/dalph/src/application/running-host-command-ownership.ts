import type { ApplicationExitAdmissionService } from "@dalph/orchestrator"
import { Effect, Fiber } from "effect"
import {
  type HostInstanceId,
  type RunningHostCommandRequest,
  type RunningHostCommandValue,
  type RunningHostError
} from "./running-host-contract.js"

/** Admitted operations belong to the host scope. Connections own only their result wait. */
export const makeRunningHostCommandOwnership = Effect.fn("RunningHostCommand.makeOwnership")(function* (
  hostInstanceId: HostInstanceId,
  admission: ApplicationExitAdmissionService,
  exitFinished: Effect.Effect<void>,
  execute: (request: RunningHostCommandRequest) => Effect.Effect<RunningHostCommandValue, RunningHostError>
) {
  const scope = yield* Effect.scope
  return Effect.fn("RunningHostCommand.admit")((request: RunningHostCommandRequest) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const owner = yield* admission
          .acquireForwardOwner("InterruptibleBoundary", { _tag: "Run", runId: request.runId })
          .pipe(
            Effect.mapError(
              (): RunningHostError => ({ _tag: "HostClosing", hostInstanceId, cutoff: "AdmissionClosed" })
            )
          )
        const operation = yield* Effect.raceFirst(
          execute(request),
          exitFinished.pipe(
            Effect.andThen(
              Effect.fail<RunningHostError>({
                _tag: "CommandOutcomeUnknown",
                operation: request.operation._tag,
                requestId: request.requestId,
                phase: "AdmittedCompletionUnconfirmed",
                acceptedAt: null,
                ...(request.operation._tag === "SendExecutorGuidance"
                  ? { guidanceRequestId: request.operation.guidanceRequestId }
                  : {})
              })
            )
          )
        ).pipe(Effect.interruptible, Effect.ensuring(owner.release), Effect.forkIn(scope, { startImmediately: true }))
        return yield* restore(Fiber.join(operation))
      })
    )
  )
})
