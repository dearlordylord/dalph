import { it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { expect } from "vitest"
import type { TrackerTarget } from "../../src/authorities/task-tracker/target.js"
import { OperationId } from "../../src/workflow/identity.js"
import {
  CompletionTaskBoundary,
  type CompletionTaskRequest,
  type CompletionTaskRequestLookup,
  type FocusedTaskCompletionFacts,
  FocusedTaskCompletionReadRequest
} from "../../src/workflow/protocols/integration-finality/events.js"

interface CompletionBoundaryContractInput<E> {
  readonly expectedOpenFacts: FocusedTaskCompletionFacts
  readonly layer: Layer.Layer<CompletionTaskBoundary, E, never>
  readonly name: string
  readonly request: CompletionTaskRequest
  readonly target: TrackerTarget
}

/** Shared public completion contract used by the controlled boundary and any host-owned adapter. */
export const completionBoundaryContract = <E>({
  expectedOpenFacts,
  layer,
  name,
  request,
  target
}: CompletionBoundaryContractInput<E>): void => {
  it.effect(`${name} CompletionTaskBoundary reads, completes, and rereads one exact request`, () =>
    Effect.gen(function* () {
      const boundary = yield* CompletionTaskBoundary
      const initialOperationId = OperationId.make(`${name}:completion-contract:initial`)
      const initial = yield* boundary.readFocusedTaskCompletion(
        FocusedTaskCompletionReadRequest.make({
          expectedClaim: request.claim,
          operationId: initialOperationId,
          target,
          taskId: request.taskId
        })
      )
      expect(initial).toEqual({ ...expectedOpenFacts, operationId: initialOperationId })

      const acknowledgement = yield* boundary.completeTask(request)
      expect(acknowledgement).toEqual({ operationId: request.operationId, taskId: request.taskId })

      const lookup: CompletionTaskRequestLookup = yield* boundary.readCompletionRequest(request)
      expect(lookup).toMatchObject({ _tag: "Applied", request })

      const confirmationOperationId = OperationId.make(`${name}:completion-contract:confirmation`)
      const confirmed = yield* boundary.readFocusedTaskCompletion(
        FocusedTaskCompletionReadRequest.make({
          expectedClaim: request.claim,
          operationId: confirmationOperationId,
          target,
          taskId: request.taskId
        })
      )
      expect(confirmed).toEqual({
        ...expectedOpenFacts,
        lifecycle: "CompletedSuccessfully",
        operationId: confirmationOperationId
      })
    }).pipe(Effect.provide(layer))
  )
}
