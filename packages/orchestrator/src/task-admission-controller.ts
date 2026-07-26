import { Effect, Ref } from "effect"
import type { OperationId, ProviderObservationId, TaskId, TaskWorkCapacity } from "./domain.js"
import { FrontierExplanation, type RunnableFrontier, type RunnableFrontierTransition } from "./runnable-frontier.js"

/** A fresh provider observation that one task invocation currently occupies capacity. */
export interface FreshCapacityConsumingInvocation {
  readonly observationId: ProviderObservationId
  readonly operationId: OperationId
  readonly taskId: TaskId
}

export type FreshInvocationCapacityObservation =
  | {
    readonly _tag: "FreshCapacityConsumed"
    readonly observationId: ProviderObservationId
    readonly operationId: OperationId
    readonly taskId: TaskId
  }
  | {
    readonly _tag: "FreshCapacityReleased"
    readonly observationId: ProviderObservationId
    readonly operationId: OperationId
    readonly taskId: TaskId
  }

export interface TaskAdmissionControllerSnapshot {
  readonly capacity: TaskWorkCapacity
  readonly occupied: ReadonlyArray<FreshCapacityConsumingInvocation>
  readonly reservedTaskIds: ReadonlyArray<TaskId>
}

export interface TaskAdmission {
  readonly explanations: ReadonlyArray<FrontierExplanation>
  readonly transitions: ReadonlyArray<RunnableFrontierTransition>
}

export interface TaskAdmissionController {
  readonly admit: (frontier: RunnableFrontier) => Effect.Effect<TaskAdmission>
  readonly applyFreshInvocationObservation: (
    observation: FreshInvocationCapacityObservation
  ) => Effect.Effect<void>
  readonly bindReservation: (
    taskId: TaskId,
    operationId: OperationId
  ) => Effect.Effect<void>
  readonly awaitAdmission: (
    transition: RunnableFrontierTransition
  ) => Effect.Effect<void>
  readonly releaseReservation: (taskId: TaskId) => Effect.Effect<void>
  readonly snapshot: () => Effect.Effect<TaskAdmissionControllerSnapshot>
}

export interface MakeTaskAdmissionControllerInput {
  readonly capacity: TaskWorkCapacity
  readonly freshOccupiedInvocations: ReadonlyArray<FreshCapacityConsumingInvocation>
  readonly reconstructedReservedTaskIds: ReadonlyArray<TaskId>
}

const requiresAdmissionPosition = (
  transition: RunnableFrontierTransition
): boolean =>
  transition._tag === "CommitFreshTaskClaimIntent"
  || transition._tag === "ContinueTaskExecution"
  || transition._tag === "ContinueImplementationReview"
  || transition._tag === "ContinueReviewFindingsHandback"

interface TaskAdmissionReservation {
  readonly operationId: OperationId | null
  readonly taskId: TaskId
}

interface TaskAdmissionControllerState {
  readonly capacity: TaskWorkCapacity
  readonly occupied: ReadonlyArray<FreshCapacityConsumingInvocation>
  readonly reservations: ReadonlyArray<TaskAdmissionReservation>
}

const transitionOperationId = (
  transition: RunnableFrontierTransition
): OperationId | null => "operationId" in transition ? transition.operationId : null

/** Creates the one process-local owner of reserved and occupied admission positions. */
export const makeTaskAdmissionController = Effect.fn(
  "TaskAdmissionController.make"
)(function*(input: MakeTaskAdmissionControllerInput) {
  const state = yield* Ref.make<TaskAdmissionControllerState>({
    capacity: input.capacity,
    occupied: [...input.freshOccupiedInvocations].sort((left, right) => left.taskId.localeCompare(right.taskId)),
    reservations: [...new Set(input.reconstructedReservedTaskIds)]
      .filter((taskId) => !input.freshOccupiedInvocations.some((invocation) => invocation.taskId === taskId))
      .map((taskId) => ({ operationId: null, taskId }))
      .sort()
  })

  const admit = Effect.fn("TaskAdmissionController.admit")(
    (frontier: RunnableFrontier) =>
      Ref.modify(state, (current) => {
        const available = Math.max(
          0,
          current.capacity - current.occupied.length - current.reservations.length
        )
        let positionsRemaining = available
        const transitions = frontier.transitions.filter((transition) => {
          if (!requiresAdmissionPosition(transition)) return true
          const reservation = current.reservations.find(({ taskId }) => taskId === transition.taskId)
          if (reservation !== undefined) {
            return reservation.operationId === null
              || reservation.operationId === transitionOperationId(transition)
          }
          if (current.occupied.some(({ taskId }) => taskId === transition.taskId)) return false
          if (positionsRemaining === 0) return false
          positionsRemaining -= 1
          return true
        })
        const newReservations = transitions
          .filter((transition) =>
            requiresAdmissionPosition(transition)
            && !current.reservations.some(({ taskId }) => taskId === transition.taskId)
            && !current.occupied.some(({ taskId }) => taskId === transition.taskId)
          )
          .map((transition) => ({
            operationId: transitionOperationId(transition),
            taskId: transition.taskId
          }))
        const next = {
          ...current,
          reservations: [...current.reservations, ...newReservations].sort((left, right) =>
            left.taskId.localeCompare(right.taskId)
          )
        }
        const capacityWaits = frontier.transitions
          .filter((transition) =>
            requiresAdmissionPosition(transition)
            && !transitions.includes(transition)
          )
          .map(({ taskId }) =>
            FrontierExplanation.CapacityWait({
              taskId,
              wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
            })
          )
        return [{
          explanations: [...frontier.explanations, ...capacityWaits],
          transitions
        }, next] as const
      })
  )

  const awaitAdmission = (
    transition: RunnableFrontierTransition
  ): Effect.Effect<void> =>
    Effect.suspend(() =>
      admit({
        explanations: [],
        transitions: [transition]
      }).pipe(
        Effect.flatMap((admission) =>
          admission.transitions.includes(transition)
            ? Effect.void
            : Effect.flatMap(Effect.yieldNow, () => awaitAdmission(transition))
        )
      )
    )

  return {
    admit,
    applyFreshInvocationObservation: (observation) =>
      Ref.update(state, (current) => {
        const conflictingReservation = current.reservations.some(({ operationId, taskId }) =>
          taskId === observation.taskId
          && operationId !== null
          && operationId !== observation.operationId
        )
        if (conflictingReservation) return current
        return {
          ...current,
          occupied: observation._tag === "FreshCapacityConsumed"
            ? [
              ...current.occupied.filter(({ taskId }) => taskId !== observation.taskId),
              {
                observationId: observation.observationId,
                operationId: observation.operationId,
                taskId: observation.taskId
              }
            ].sort((left, right) => left.taskId.localeCompare(right.taskId))
            : current.occupied.filter(({ operationId, taskId }) =>
              taskId !== observation.taskId || operationId !== observation.operationId
            ),
          reservations: current.reservations.filter(({ operationId, taskId }) =>
            taskId !== observation.taskId || operationId !== observation.operationId
          )
        }
      }),
    bindReservation: (taskId, operationId) =>
      Ref.update(state, (current) => ({
        ...current,
        reservations: current.reservations.map((reservation) =>
          reservation.taskId === taskId
            ? { operationId, taskId }
            : reservation
        )
      })),
    awaitAdmission,
    releaseReservation: (taskId) =>
      Ref.update(state, (current) => ({
        ...current,
        reservations: current.reservations.filter((reservation) => reservation.taskId !== taskId)
      })),
    snapshot: () =>
      Ref.get(state).pipe(
        Effect.map((current) => ({
          capacity: current.capacity,
          occupied: current.occupied,
          reservedTaskIds: current.reservations.map(({ taskId }) => taskId)
        }))
      )
  } satisfies TaskAdmissionController
})
