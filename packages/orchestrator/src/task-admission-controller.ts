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

/**
 * Issue #133 replaces review-name-based capacity classification with capacity
 * use declared by an executor's outer invocation protocol.
 */
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

/**
 * Issue #132 replaces this task/operation-sorted dormant-waiter queue with
 * coordinator rederivation from the current reconstructed managed-run state
 * and controller snapshot whenever a snapshot change can permit admission.
 * This queue is superseded implementation, not the accepted
 * responsibility-order rule.
 */
interface WaitingAdmission {
  readonly deferred: Deferred.Deferred<void>
  readonly transition: RunnableFrontierTransition
}

const transitionOperationId = (
  transition: RunnableFrontierTransition
): OperationId | null => "operationId" in transition ? transition.operationId : null
const transitionReservationKey = (
  transition: RunnableFrontierTransition
): string => `${transition.taskId}\u0000${String(transitionOperationId(transition))}`

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
  const newlyReservedAdmissions = yield* Ref.make<ReadonlySet<Deferred.Deferred<void>>>(new Set())
  const ownedAdmissionKeys = yield* Ref.make<ReadonlySet<string>>(new Set())
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
      transitionReservationKey(left.transition).localeCompare(
        transitionReservationKey(right.transition)
      )
    )
    if (waiting.length === 0) return
    const before = yield* Ref.get(state)
    const admission = yield* admit({
      explanations: [],
      transitions: waiting.map(({ transition }) => transition)
    })
    const admitted = waiting.filter(({ transition }) => admission.transitions.includes(transition))
    if (admitted.length === 0) return
    const admittedDeferreds = new Set(admitted.map(({ deferred }) => deferred))
    const newlyReserved = admitted.filter(({ transition }) =>
      !before.reservations.some(({ operationId, taskId }) =>
        taskId === transition.taskId
        && operationId === transitionOperationId(transition)
      )
    )
    yield* Ref.update(
      waitingAdmissions,
      (current) => current.filter(({ deferred }) => !admittedDeferreds.has(deferred))
    )
    yield* Ref.update(
      newlyReservedAdmissions,
      (current) => new Set([...current, ...newlyReserved.map(({ deferred }) => deferred)])
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
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function*() {
        const deferred = yield* Deferred.make<void>()
        return yield* Effect.gen(function*() {
          yield* arbitration.withPermit(Effect.gen(function*() {
            const key = transitionReservationKey(transition)
            const waiting = yield* Ref.get(waitingAdmissions)
            const owned = yield* Ref.get(ownedAdmissionKeys)
            if (
              owned.has(key)
              || waiting.some(({ transition: candidate }) => transitionReservationKey(candidate) === key)
            ) {
              return yield* Effect.die(
                new Error(`duplicate admission waiter for exact transition ${key}`)
              )
            }
            yield* Ref.set(waitingAdmissions, [
              ...waiting,
              { deferred, transition }
            ])
          }))
          yield* drainWaitingAdmissions
          yield* restore(Deferred.await(deferred))
          yield* Ref.update(
            newlyReservedAdmissions,
            (current) => new Set([...current].filter((candidate) => candidate !== deferred))
          )
          yield* Ref.update(
            ownedAdmissionKeys,
            (current) => new Set([...current, transitionReservationKey(transition)])
          )
        }).pipe(
          Effect.onInterrupt(() =>
            arbitration.withPermit(Effect.gen(function*() {
              const releasesReservation = (yield* Ref.get(newlyReservedAdmissions)).has(deferred)
              yield* Ref.update(
                waitingAdmissions,
                (current) => current.filter((waiting) => waiting.deferred !== deferred)
              )
              yield* Ref.update(
                newlyReservedAdmissions,
                (current) => new Set([...current].filter((candidate) => candidate !== deferred))
              )
              /* v8 ignore start -- the interrupt-after-grant race is protected
               * by uninterruptible handoff and cannot be scheduled deterministically. */
              if (releasesReservation) {
                yield* Ref.update(state, (current) => ({
                  ...current,
                  reservations: current.reservations.filter(({ operationId, taskId }) =>
                    taskId !== transition.taskId
                    || operationId !== transitionOperationId(transition)
                  )
                }))
              }
              /* v8 ignore stop */
            })).pipe(Effect.andThen(drainWaitingAdmissions))
          )
        )
      })
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
      Effect.all([
        Ref.update(state, (current) => ({
          ...current,
          reservations: current.reservations.filter((reservation) =>
            reservation.taskId !== taskId || reservation.operationId !== operationId
          )
        })),
        Ref.update(
          ownedAdmissionKeys,
          (current) =>
            new Set(
              [...current].filter((key) => key !== `${taskId}\u0000${String(operationId)}`)
            )
        )
      ], { discard: true }).pipe(
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
