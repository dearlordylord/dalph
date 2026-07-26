import { Effect } from "effect"
import type { TaskId, TaskWorkCapacity } from "../../src/domain.js"
import type { WorkflowResponsibilityState } from "../../src/reconstructed-managed-run-state.js"
import { deriveRunnableFrontier, ResponsibilityDisposition } from "../../src/runnable-frontier.js"
import { makeTaskAdmissionController } from "../../src/task-admission-controller.js"
import type { FrontierRecoveryConformanceIssue } from "./frontier-recovery-conformance.js"

interface FrontierRecoveryTaskEntry {
  readonly branded: TaskId
  readonly model: bigint
}

interface FrontierRecoveryTaskIdentityMapping {
  readonly taskToModel: (
    taskId: TaskId
  ) => Effect.Effect<bigint, FrontierRecoveryConformanceIssue>
}

interface SelectFrontierRecoveryAdmissionInput {
  readonly capacity: TaskWorkCapacity
  readonly eligibleModelTaskIds: ReadonlyArray<bigint>
  readonly identityMapping: FrontierRecoveryTaskIdentityMapping
  readonly responsibility: WorkflowResponsibilityState
  readonly taskEntries: ReadonlyArray<FrontierRecoveryTaskEntry>
}

/** Applies the production selector to one bounded M2 authority projection. */
export const selectFrontierRecoveryAdmission = Effect.fn(
  "FrontierRecoveryReconstruction.selectFrontier"
)(function*(input: SelectFrontierRecoveryAdmissionInput) {
  const responsibilityFacts = input.responsibility.entries.flatMap((entry) =>
    entry._tag === "TaskClaimResponsibility"
      ? [{
        disposition: ResponsibilityDisposition.Ready(),
        responsibility: entry
      }]
      : []
  )
  const frontier = deriveRunnableFrontier({
    freshEligibleTaskIds: input.taskEntries
      .filter(({ model }) => input.eligibleModelTaskIds.includes(model))
      .map(({ branded }) => branded),
    responsibility: input.responsibility,
    responsibilityFacts
  })
  const controller = yield* makeTaskAdmissionController({
    capacity: input.capacity,
    freshOccupiedInvocations: [],
    reconstructedReservedTaskIds: responsibilityFacts.map(({ responsibility }) => responsibility.taskId)
  })
  const admission = yield* controller.admit(frontier)
  const controllerSnapshot = yield* controller.snapshot()
  return {
    admittedModelTaskIds: yield* Effect.forEach(
      admission.transitions.map(({ taskId }) => taskId),
      input.identityMapping.taskToModel
    ),
    admittedTransitionTags: admission.transitions.map(({ _tag }) => _tag),
    admissionExplanationTags: admission.explanations.map(({ _tag }) => _tag),
    admissionReservedModelTaskIds: yield* Effect.forEach(
      controllerSnapshot.reservedTaskIds,
      input.identityMapping.taskToModel
    ),
    admission,
    frontierModelTaskIds: yield* Effect.forEach(
      frontier.transitions.map(({ taskId }) => taskId),
      input.identityMapping.taskToModel
    ),
    frontierTransitionTags: frontier.transitions.map(({ _tag }) => _tag)
  }
})
