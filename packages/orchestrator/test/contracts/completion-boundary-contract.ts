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
  readonly expectedOpenFacts: Omit<FocusedTaskCompletionFacts, "operationId" | "trackerRevision">
  readonly expectedRequestLookup: CompletionTaskRequestLookup["_tag"]
  readonly expectedTrackerRevision?: FocusedTaskCompletionFacts["trackerRevision"]
  readonly layer: Layer.Layer<CompletionTaskBoundary, E, never>
  readonly name: string
  readonly request: CompletionTaskRequest
  readonly target: TrackerTarget
}

/** Shared public completion contract used by the controlled boundary and any host-owned adapter. */
export const completionBoundaryContract = <E>({
  expectedOpenFacts,
  expectedRequestLookup,
  expectedTrackerRevision,
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
      const expectedInitial = {
        ...expectedOpenFacts,
        operationId: initialOperationId,
        ...(expectedTrackerRevision === undefined ? {} : { trackerRevision: expectedTrackerRevision })
      }
      if (expectedTrackerRevision !== undefined) {
        expect(initial).toEqual(expectedInitial)
      } else {
        expect(initial).toMatchObject({
          currentClaim: expectedInitial.currentClaim,
          lifecycle: expectedInitial.lifecycle,
          operationId: expectedInitial.operationId,
          target: expectedInitial.target,
          targetMembership: expectedInitial.targetMembership,
          taskId: expectedInitial.taskId,
          taskRevision: expectedInitial.taskRevision,
          unfinishedPrerequisiteTaskIds: expectedInitial.unfinishedPrerequisiteTaskIds
        })
      }

      const acknowledgement = yield* boundary.completeTask(request)
      expect(acknowledgement).toEqual({ operationId: request.operationId, taskId: request.taskId })

      const confirmationOperationId = OperationId.make(`${name}:completion-contract:confirmation`)
      const confirmed = yield* boundary.readFocusedTaskCompletion(
        FocusedTaskCompletionReadRequest.make({
          expectedClaim: request.claim,
          operationId: confirmationOperationId,
          target,
          taskId: request.taskId
        })
      )
      const expectedConfirmation = {
        currentClaim: expectedOpenFacts.currentClaim,
        lifecycle: "CompletedSuccessfully",
        operationId: confirmationOperationId,
        target: expectedOpenFacts.target,
        targetMembership: expectedOpenFacts.targetMembership,
        taskId: expectedOpenFacts.taskId,
        taskRevision: expectedOpenFacts.taskRevision,
        unfinishedPrerequisiteTaskIds: expectedOpenFacts.unfinishedPrerequisiteTaskIds,
        ...(expectedTrackerRevision === undefined ? {} : { trackerRevision: expectedTrackerRevision })
      } as const
      if (expectedTrackerRevision !== undefined) {
        expect(confirmed).toEqual(expectedConfirmation)
      } else {
        expect(confirmed).toMatchObject(expectedConfirmation)
      }

      const lookup: CompletionTaskRequestLookup = yield* boundary.readCompletionRequest(request)
      expect(lookup).toMatchObject({ _tag: expectedRequestLookup, request })
    }).pipe(Effect.provide(layer))
  )
}
