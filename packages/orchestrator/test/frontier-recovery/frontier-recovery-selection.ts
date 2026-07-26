import { Effect } from "effect"
import type { OperationId, TaskId, TaskWorkCapacity } from "../../src/domain.js"
import type { WorkflowResponsibilityState } from "../../src/reconstructed-managed-run-state.js"
import {
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  type RunnableFrontierTransition
} from "../../src/runnable-frontier.js"
import { makeTaskAdmissionController } from "../../src/task-admission-controller.js"
import { FrontierRecoveryConformanceIssue } from "./frontier-recovery-conformance.js"
import type { FrontierRecoveryAdmissionExplanation } from "./frontier-recovery-projection.js"

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
  const projectTransitions = (
    transitions: ReadonlyArray<RunnableFrontierTransition>
  ) =>
    Effect.forEach(
      transitions.toSorted((left, right) => left.taskId.localeCompare(right.taskId)),
      (transition) =>
        Effect.all({
          modelOperationId: operationToModel(transition),
          modelTaskId: input.identityMapping.taskToModel(transition.taskId)
        }).pipe(
          Effect.map(({ modelOperationId, modelTaskId }) => ({
            modelOperationId,
            modelTaskId,
            tag: transition._tag
          }))
        )
    )
  const admittedTransitions = yield* projectTransitions(admission.transitions)
  const frontierTransitions = yield* projectTransitions(frontier.transitions)
  const admissionExplanations = yield* Effect.forEach(
    admission.explanations,
    (explanation) =>
      explanation._tag === "CapacityWait"
        ? input.identityMapping.taskToModel(explanation.taskId).pipe(
          Effect.map((modelTaskId) => ({
            modelTaskId,
            tag: explanation._tag,
            wakeCondition: explanation.wakeCondition
          } satisfies FrontierRecoveryAdmissionExplanation))
        )
        : Effect.fail(
          new FrontierRecoveryConformanceIssue({
            detail: `M2 reconstruction cannot project ${explanation._tag} as a capacity explanation`,
            reason: "LossyProjection"
          })
        )
  )
  return {
    admissionCapacity: BigInt(controllerSnapshot.capacity),
    admittedModelTaskIds: admittedTransitions.map(({ modelTaskId }) => modelTaskId),
    admittedTransitionTags: admittedTransitions.map(({ tag }) => tag),
    admittedModelOperationIds: admittedTransitions.map(({ modelOperationId }) => modelOperationId),
    admissionExplanations,
    admissionReservedModelTaskIds: yield* Effect.forEach(
      controllerSnapshot.reservedTaskIds,
      input.identityMapping.taskToModel
    ),
    admission,
    frontierModelTaskIds: frontierTransitions.map(({ modelTaskId }) => modelTaskId),
    frontierModelOperationIds: frontierTransitions.map(({ modelOperationId }) => modelOperationId),
    frontierTransitionTags: frontierTransitions.map(({ tag }) => tag),
    occupiedModelTaskIds: yield* Effect.forEach(
      controllerSnapshot.occupied.map(({ taskId }) => taskId),
      input.identityMapping.taskToModel
    )
  }
})
