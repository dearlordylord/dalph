import type { RunId } from "@dalph/contracts"
import type { JournaledRunBootstrap } from "@dalph/orchestrator"
import { Effect } from "effect"
import type { ProductionRunningHostObservation, ProductionPassiveRunControl } from "./production-host.js"
import type { RunningHostCommandRequest, RunningHostError } from "./running-host-contract.js"

/** Capacity belongs to an active runtime lease. Accepted history only proves termination. */
export const makeRunningHostCapacity = (
  runId: RunId,
  controls: Pick<JournaledRunBootstrap["Service"]["operatorControl"], "readTaskWorkCapacity" | "setTaskWorkCapacity">,
  readRunControl: Effect.Effect<ProductionPassiveRunControl, unknown>
) => {
  const inactive = Effect.fn("RunningHostCapacity.inactive")(function* (operation: "ReadCapacity" | "SetCapacity") {
    const control = yield* readRunControl.pipe(
      Effect.mapError(
        (): RunningHostError =>
          operation === "ReadCapacity"
            ? { _tag: "ReadFailed", causeTag: "RunControlUnavailable", detail: "Accepted Run control is unavailable." }
            : {
                _tag: "CommandFailed",
                operation,
                stage: "BeforeApplication",
                causeTag: "RunControlUnavailable",
                detail: "Accepted Run control is unavailable."
              }
      )
    )
    return yield* Effect.fail<RunningHostError>(
      control.termination !== null
        ? { _tag: "RunClosed", runId, ...control.termination }
        : { _tag: "RunInactive", runId, operation }
    )
  })
  const read = Effect.suspend(() => controls.readTaskWorkCapacity(runId)).pipe(
    Effect.map((policy) => ({ _tag: "CapacityRead" as const, policy })),
    Effect.catchTag("JournaledRunNotActive", () => inactive("ReadCapacity")),
    Effect.mapError(
      (error): RunningHostError =>
        error._tag === "RunInactive" || error._tag === "RunClosed" || error._tag === "ReadFailed"
          ? error
          : { _tag: "ReadFailed", causeTag: error._tag, detail: "The active capacity policy could not be read." }
    )
  )
  const set = Effect.fn("RunningHostCapacity.set")(function* (
    request: RunningHostCommandRequest & {
      readonly operation: Extract<RunningHostCommandRequest["operation"], { readonly _tag: "SetCapacity" }>
    }
  ) {
    return yield* controls
      .setTaskWorkCapacity({
        runId,
        capacity: request.operation.capacity,
        expectedRevision: request.operation.expectedRevision
      })
      .pipe(
        Effect.map((policy) => ({ _tag: "CapacityApplied" as const, policy })),
        Effect.catchTag("JournaledRunNotActive", () => inactive("SetCapacity")),
        Effect.catch((error) => {
          if (error._tag === "RunInactive" || error._tag === "RunClosed" || error._tag === "CommandFailed")
            return Effect.fail<RunningHostError>(error)
          if (error._tag === "TaskWorkCapacityPolicyRevisionConflict")
            return Effect.fail<RunningHostError>({
              _tag: "PolicyRevisionConflict",
              runId,
              expectedRevision: error.expectedRevision,
              current: error.current
            })
          if (
            error._tag === "ApplicationExiting" ||
            error._tag === "SchemaError" ||
            error._tag === "WorkflowRunNotBegan" ||
            error._tag === "InvalidWorkflowJournalHistory"
          )
            return Effect.fail<RunningHostError>({
              _tag: "CommandFailed",
              operation: "SetCapacity",
              stage: "BeforeApplication",
              causeTag: error._tag,
              detail: "The capacity change was refused before application."
            })
          return Effect.fail<RunningHostError>({
            _tag: "CommandOutcomeUnknown",
            operation: "SetCapacity",
            requestId: request.requestId,
            phase: "AdmittedCompletionUnconfirmed",
            acceptedAt: null
          })
        })
      )
  })
  return { read, set }
}

/** Passive attachment never activates an inactive runtime or reconstructs its capacity. */
export const readRunningHostCapacity = Effect.fn("RunningHostCapacity.readAttached")(function* <E>(
  observation: ProductionRunningHostObservation<E>
) {
  const runId = observation.selection.runId
  const control = yield* observation.readRunControl.pipe(
    Effect.mapError(
      (): RunningHostError => ({
        _tag: "ReadFailed",
        causeTag: "RunControlUnavailable",
        detail: "Accepted Run control is unavailable."
      })
    )
  )
  if (control.termination !== null)
    return yield* Effect.fail<RunningHostError>({ _tag: "RunClosed", runId, ...control.termination })
  if (observation.readAttachedCapacity === undefined)
    return yield* Effect.fail<RunningHostError>({ _tag: "RunInactive", runId, operation: "ReadCapacity" })
  return yield* observation.readAttachedCapacity
})
