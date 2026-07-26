import { Effect } from "effect"
import type { OperationId, TaskId, TaskWorkCapacity } from "../../src/domain.js"
import type { WorkflowResponsibilityState } from "../../src/reconstructed-managed-run-state.js"
import {
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  type RunnableFrontierTransition
} from "../../src/runnable-frontier.js"
import { makeTaskAdmissionController } from "../../src/task-admission-controller.js"
import type { FrontierRecoveryConformanceIssue } from "./frontier-recovery-conformance.js"

interface FrontierRecoveryTaskEntry {
  readonly branded: TaskId
  readonly model: bigint
}

interface FrontierRecoveryTaskIdentityMapping {
  readonly operationToModel: (
    operationId: OperationId
  ) => Effect.Effect<bigint, FrontierRecoveryConformanceIssue>
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

// Model identity for a fresh transition that has no durable operation yet.
const freshOperationIdentity = -1n

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
  const operationToModel = (transition: RunnableFrontierTransition) =>
    "operationId" in transition
      ? input.identityMapping.operationToModel(transition.operationId)
      : Effect.succeed(freshOperationIdentity)
  return {
    admissionCapacity: BigInt(controllerSnapshot.capacity),
    admittedModelTaskIds: yield* Effect.forEach(
      admission.transitions.map(({ taskId }) => taskId),
      input.identityMapping.taskToModel
    ),
    admittedTransitionTags: admission.transitions.map(({ _tag }) => _tag),
    admittedModelOperationIds: yield* Effect.forEach(
      admission.transitions,
      operationToModel
    ),
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
    frontierModelOperationIds: yield* Effect.forEach(
      frontier.transitions,
      operationToModel
    ),
    frontierTransitionTags: frontier.transitions.map(({ _tag }) => _tag),
    occupiedModelTaskIds: yield* Effect.forEach(
      controllerSnapshot.occupied.map(({ taskId }) => taskId),
      input.identityMapping.taskToModel
    )
  }
})
