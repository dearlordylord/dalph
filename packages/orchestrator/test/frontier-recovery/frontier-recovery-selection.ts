import { Effect } from "effect"
import { TaskRevision } from "../../src/domain.js"
import type { OperationId, TaskId, TaskWorkCapacity } from "../../src/domain.js"
import type { WorkflowResponsibilityState } from "../../src/reconstructed-managed-run-state.js"
import {
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  type RunnableFrontierTransition
} from "../../src/runnable-frontier.js"
import { makeTaskAdmissionController } from "../../src/task-admission-controller.js"
import {
  FrontierRecoveryConformanceIssue,
  FrontierRecoveryModelCapacity,
  type FrontierRecoveryModelOperationId,
  type FrontierRecoveryModelTaskId
} from "./frontier-recovery-conformance.js"
import { frontierRecoveryRunId } from "./frontier-recovery-fixture-identities.js"
import type {
  FrontierRecoveryAdmissionExplanation,
  FrontierRecoveryTransitionOperation
} from "./frontier-recovery-projection.js"

interface FrontierRecoveryTaskEntry {
  readonly branded: TaskId
  readonly model: FrontierRecoveryModelTaskId
}

interface FrontierRecoveryTaskIdentityMapping {
  readonly operationToModel: (
    operationId: OperationId
  ) => Effect.Effect<FrontierRecoveryModelOperationId, FrontierRecoveryConformanceIssue>
  readonly taskToModel: (
    taskId: TaskId
  ) => Effect.Effect<FrontierRecoveryModelTaskId, FrontierRecoveryConformanceIssue>
}

interface SelectFrontierRecoveryAdmissionInput {
  readonly capacity: TaskWorkCapacity
  readonly eligibleModelTaskIds: ReadonlyArray<FrontierRecoveryModelTaskId>
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
    freshEligibleTasks: input.taskEntries
      .filter(({ model }) => input.eligibleModelTaskIds.includes(model))
      .map(({ branded, model }) => ({
        taskId: branded,
        taskRevision: TaskRevision.make(`M2-revision:${model}`)
      })),
    responsibility: input.responsibility,
    responsibilityFacts
  })
  const controller = yield* makeTaskAdmissionController({
    capacity: input.capacity,
    freshOccupiedInvocations: [],
    reconstructedReservedPositions: responsibilityFacts.map(
      ({ responsibility }) => ({
        operationId: responsibility.acquisition.operationId,
        taskId: responsibility.taskId
      })
    )
  })
  let admittedProductionTransitions: ReadonlyArray<RunnableFrontierTransition> = []
  let remainingTransitions = [...frontier.transitions]
  let passAdmissionExplanations = [...frontier.explanations]
  for (;;) {
    const pass = yield* controller.admit(
      {
        explanations: frontier.explanations,
        transitions: remainingTransitions
      },
      frontierRecoveryRunId
    )
    const admitted = pass.transitions[0]
    if (admitted === undefined) {
      passAdmissionExplanations = [...pass.explanations]
      break
    }
    admittedProductionTransitions = [...admittedProductionTransitions, admitted]
    remainingTransitions = remainingTransitions.filter(
      (transition) => transition !== admitted
    )
  }
  const admission = {
    explanations: passAdmissionExplanations,
    transitions: admittedProductionTransitions
  }
  const controllerSnapshot = yield* controller.snapshot()
  const operationToModel = (transition: RunnableFrontierTransition) =>
    "operationId" in transition
      ? input.identityMapping.operationToModel(transition.operationId).pipe(
        Effect.map((modelOperationId) => ({
          _tag: "DurableTransitionOperation" as const,
          modelOperationId
        }))
      )
      : Effect.succeed(
        {
          _tag: "FreshTransitionWithoutOperation" as const
        } satisfies FrontierRecoveryTransitionOperation
      )
  const projectTransitions = (
    transitions: ReadonlyArray<RunnableFrontierTransition>
  ) =>
    Effect.forEach(
      transitions.toSorted((left, right) => left.taskId.localeCompare(right.taskId)),
      (transition) =>
        Effect.all({
          transitionOperation: operationToModel(transition),
          modelTaskId: input.identityMapping.taskToModel(transition.taskId)
        }).pipe(
          Effect.map(({ modelTaskId, transitionOperation }) => ({
            modelTaskId,
            tag: transition._tag,
            transitionOperation
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
    admissionCapacity: FrontierRecoveryModelCapacity.make(
      BigInt(controllerSnapshot.capacity)
    ),
    admittedModelTaskIds: admittedTransitions.map(({ modelTaskId }) => modelTaskId),
    admittedTransitionTags: admittedTransitions.map(({ tag }) => tag),
    admittedTransitionOperations: admittedTransitions.map(
      ({ transitionOperation }) => transitionOperation
    ),
    admissionExplanations,
    admissionReservedModelTaskIds: yield* Effect.forEach(
      controllerSnapshot.reservedTaskIds,
      input.identityMapping.taskToModel
    ),
    admission,
    frontierModelTaskIds: frontierTransitions.map(({ modelTaskId }) => modelTaskId),
    frontierTransitionOperations: frontierTransitions.map(
      ({ transitionOperation }) => transitionOperation
    ),
    frontierTransitionTags: frontierTransitions.map(({ tag }) => tag),
    occupiedModelTaskIds: yield* Effect.forEach(
      controllerSnapshot.occupied.map(({ taskId }) => taskId),
      input.identityMapping.taskToModel
    )
  }
})
