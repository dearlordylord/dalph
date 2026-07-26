import { Deferred, Effect, Ref, Semaphore } from "effect"
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
  readonly releaseReservation: (
    taskId: TaskId,
    operationId: OperationId | null
  ) => Effect.Effect<void>
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

interface WaitingAdmission {
  readonly deferred: Deferred.Deferred<void>
  readonly transition: RunnableFrontierTransition
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
  const waitingAdmissions = yield* Ref.make<ReadonlyArray<WaitingAdmission>>([])
  const arbitration = yield* Semaphore.make(1)

  const admit = Effect.fn("TaskAdmissionController.admit")(
    (frontier: RunnableFrontier) =>
      Ref.modify(state, (current) => {
        let reservations = [...current.reservations]
        const transitions = frontier.transitions.filter((transition) => {
          if (!requiresAdmissionPosition(transition)) return true
          const operationId = transitionOperationId(transition)
          if (
            reservations.some((reservation) =>
              reservation.taskId === transition.taskId
              && reservation.operationId === operationId
            )
          ) return true
          if (reservations.some(({ taskId }) => taskId === transition.taskId)) return false
          if (current.occupied.some(({ taskId }) => taskId === transition.taskId)) return false
          if (current.occupied.length + reservations.length >= current.capacity) return false
          reservations = [...reservations, { operationId, taskId: transition.taskId }]
          return true
        })
        const next = {
          ...current,
          reservations: reservations.toSorted((left, right) => left.taskId.localeCompare(right.taskId))
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

  const drainWaitingAdmissions = arbitration.withPermit(Effect.gen(function*() {
    const waiting = [...(yield* Ref.get(waitingAdmissions))].sort((left, right) =>
      `${left.transition.taskId}\u0000${String(transitionOperationId(left.transition))}`
        .localeCompare(
          `${right.transition.taskId}\u0000${String(transitionOperationId(right.transition))}`
        )
    )
    if (waiting.length === 0) return
    const admission = yield* admit({
      explanations: [],
      transitions: waiting.map(({ transition }) => transition)
    })
    const admitted = waiting.filter(({ transition }) => admission.transitions.includes(transition))
    if (admitted.length === 0) return
    const admittedDeferreds = new Set(admitted.map(({ deferred }) => deferred))
    yield* Ref.update(
      waitingAdmissions,
      (current) => current.filter(({ deferred }) => !admittedDeferreds.has(deferred))
    )
    yield* Effect.forEach(
      admitted,
      ({ deferred }) => Deferred.succeed(deferred, undefined),
      { discard: true }
    )
  }))

  const awaitAdmission = (
    transition: RunnableFrontierTransition
  ): Effect.Effect<void> =>
    Effect.gen(function*() {
      const deferred = yield* Deferred.make<void>()
      return yield* Effect.gen(function*() {
        yield* Ref.update(waitingAdmissions, (current) => [
          ...current,
          { deferred, transition }
        ])
        yield* drainWaitingAdmissions
        yield* Deferred.await(deferred)
      }).pipe(
        Effect.onInterrupt(() =>
          arbitration.withPermit(
            Ref.update(
              waitingAdmissions,
              (current) => current.filter((waiting) => waiting.deferred !== deferred)
            )
          )
        )
      )
    })

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
      }).pipe(
        Effect.andThen(drainWaitingAdmissions)
      ),
    bindReservation: (taskId, operationId) =>
      Ref.update(state, (current) => ({
        ...current,
        reservations: current.reservations.map((reservation) =>
          reservation.taskId === taskId && reservation.operationId === null
            ? { operationId, taskId }
            : reservation
        )
      })).pipe(
        Effect.andThen(drainWaitingAdmissions)
      ),
    awaitAdmission,
    releaseReservation: (taskId, operationId) =>
      Ref.update(state, (current) => ({
        ...current,
        reservations: current.reservations.filter((reservation) =>
          reservation.taskId !== taskId || reservation.operationId !== operationId
        )
      })).pipe(
        Effect.andThen(drainWaitingAdmissions)
      ),
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
