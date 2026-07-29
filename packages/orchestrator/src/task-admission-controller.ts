import { Data, Effect, Option, Ref, Schema } from "effect"
import { SelectedTransitionIdentity as SelectedTransitionIdentitySchema } from "./domain.js"
import type { AttemptId, RunId, SelectedTransitionIdentity, TaskId, TaskWorkCapacity } from "./domain.js"
import type { PlannedAttemptExecutorCorrelation } from "./planned-attempt-executor.js"
import {
  FrontierExplanation,
  type RunnableFrontier,
  type RunnableFrontierTransition,
  runnableTransitionTaskId
} from "./runnable-frontier.js"
import { makeSelectedTransitionIdentity, selectedTransitionKey } from "./selected-transition.js"

type AdmissionAvailabilityChange = Data.TaggedEnum<{ AdmissionMayNowBePossible: Record<never, never> }>

const AdmissionAvailabilityChange = Data.taggedEnum<AdmissionAvailabilityChange>()

/** The exact selected transition reservation was absent during cancellation. */
class TaskAdmissionPositionCancellationIssue extends Schema.TaggedErrorClass<TaskAdmissionPositionCancellationIssue>()(
  "TaskAdmissionPositionCancellationIssue",
  { selected: SelectedTransitionIdentitySchema }
) {}

/** No selected transition reservation existed to bind to the planned attempt. */
class PlannedAttemptPositionBindingIssue extends Schema.TaggedErrorClass<PlannedAttemptPositionBindingIssue>()(
  "PlannedAttemptPositionBindingIssue",
  { selected: SelectedTransitionIdentitySchema }
) {}

/** The planned-attempt position was absent at terminal result or safe suspension. */
class PlannedAttemptPositionReleaseIssue extends Schema.TaggedErrorClass<PlannedAttemptPositionReleaseIssue>()(
  "PlannedAttemptPositionReleaseIssue",
  {}
) {}

export interface TaskAdmissionControllerSnapshot {
  readonly capacity: TaskWorkCapacity
  readonly reservedPositions: ReadonlyArray<{
    readonly correlation: TaskAdmissionReservationCorrelation
    readonly taskId: TaskId
  }>
  readonly reservedTaskIds: ReadonlyArray<TaskId>
}

/** The controller reserves at most one exact transition for this admission pass. */
export interface NextAdmissionDecision {
  readonly explanations: ReadonlyArray<FrontierExplanation>
  readonly transition: Option.Option<RunnableFrontierTransition>
}

export interface TaskAdmissionController {
  readonly admit: (frontier: RunnableFrontier, runId: RunId) => Effect.Effect<NextAdmissionDecision>
  readonly bindPlannedAttemptPosition: (
    selected: SelectedTransitionIdentity,
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<void, PlannedAttemptPositionBindingIssue>
  readonly cancelReservedPosition: (
    selected: SelectedTransitionIdentity
  ) => Effect.Effect<AdmissionAvailabilityChange, TaskAdmissionPositionCancellationIssue>
  readonly releasePlannedAttemptPosition: (
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<AdmissionAvailabilityChange, PlannedAttemptPositionReleaseIssue>
  readonly snapshot: () => Effect.Effect<TaskAdmissionControllerSnapshot>
}

interface MakeTaskAdmissionControllerInput {
  readonly capacity: TaskWorkCapacity
  readonly reconstructedPlannedAttemptPositions?: ReadonlyArray<{
    readonly attemptId: AttemptId
    readonly runId: RunId
    readonly taskId: TaskId
  }>
}

/** Task-work capacity starts at claim selection and ends at terminal result or safe suspension. */
export const transitionRequiresTaskAdmissionPosition = (transition: RunnableFrontierTransition): boolean =>
  transition._tag === "CommitFreshTaskClaimIntent" ||
  transition._tag === "ContinuePlannedAttemptExecutorWork" ||
  transition._tag === "StartPlannedAttemptExecutorWork"

type TaskAdmissionReservationCorrelation =
  | { readonly _tag: "SelectedTransitionReservation"; readonly selected: SelectedTransitionIdentity }
  | { readonly _tag: "PlannedAttemptReservation"; readonly attemptId: AttemptId; readonly runId: RunId }

interface TaskAdmissionReservation {
  readonly correlation: TaskAdmissionReservationCorrelation
  readonly taskId: TaskId
}

interface TaskAdmissionControllerState {
  readonly capacity: TaskWorkCapacity
  readonly reservations: ReadonlyArray<TaskAdmissionReservation>
}

const plannedAttemptReservation = (
  correlation: PlannedAttemptExecutorCorrelation
): TaskAdmissionReservationCorrelation => ({
  _tag: "PlannedAttemptReservation",
  attemptId: correlation.attemptId,
  runId: correlation.runId
})

const transitionReservation = (
  transition: RunnableFrontierTransition,
  runId: RunId
): TaskAdmissionReservationCorrelation =>
  transition._tag === "ContinuePlannedAttemptExecutorWork"
    ? plannedAttemptReservation({
        attemptId: transition.plannedAttempt.attemptId,
        runId: transition.plannedAttempt.runId
      })
    : { _tag: "SelectedTransitionReservation", selected: makeSelectedTransitionIdentity(runId, transition) }

const sameReservation = (
  reservation: TaskAdmissionReservation,
  transition: RunnableFrontierTransition,
  runId: RunId
): boolean =>
  reservation.taskId === runnableTransitionTaskId(transition) &&
  (transition._tag === "ContinuePlannedAttemptExecutorWork"
    ? reservation.correlation._tag === "PlannedAttemptReservation" &&
      reservation.correlation.attemptId === transition.plannedAttempt.attemptId &&
      reservation.correlation.runId === transition.plannedAttempt.runId
    : reservation.correlation._tag === "SelectedTransitionReservation" &&
      selectedTransitionKey(reservation.correlation.selected) ===
        selectedTransitionKey(makeSelectedTransitionIdentity(runId, transition)))

type AdmissionAttempt =
  | { readonly _tag: "TransitionAdmitted"; readonly state: TaskAdmissionControllerState }
  | { readonly _tag: "CapacityUnavailable" }

const tryAdmitTransition = (
  current: TaskAdmissionControllerState,
  transition: RunnableFrontierTransition,
  runId: RunId
): AdmissionAttempt => {
  if (!transitionRequiresTaskAdmissionPosition(transition)) {
    return { _tag: "TransitionAdmitted", state: current }
  }
  if (current.reservations.some((reservation) => sameReservation(reservation, transition, runId))) {
    return { _tag: "TransitionAdmitted", state: current }
  }
  const taskId = runnableTransitionTaskId(transition)
  if (
    current.reservations.some((reservation) => reservation.taskId === taskId) ||
    current.reservations.length >= current.capacity
  ) {
    return { _tag: "CapacityUnavailable" }
  }
  return {
    _tag: "TransitionAdmitted",
    state: {
      ...current,
      reservations: [
        ...current.reservations,
        { correlation: transitionReservation(transition, runId), taskId }
      ].toSorted((left, right) => left.taskId.localeCompare(right.taskId))
    }
  }
}

const availabilityAfterRemoval = (): AdmissionAvailabilityChange =>
  AdmissionAvailabilityChange.AdmissionMayNowBePossible()

/** Creates the one process-local owner of planned-attempt task-work positions. */
export const makeTaskAdmissionController = Effect.fn("TaskAdmissionController.make")(function* (
  input: MakeTaskAdmissionControllerInput
) {
  const state = yield* Ref.make<TaskAdmissionControllerState>({
    capacity: input.capacity,
    reservations: (input.reconstructedPlannedAttemptPositions ?? [])
      .map(({ attemptId, runId, taskId }) => ({ correlation: plannedAttemptReservation({ attemptId, runId }), taskId }))
      .sort((left, right) => left.taskId.localeCompare(right.taskId))
  })

  const admit = Effect.fn("TaskAdmissionController.admit")((frontier: RunnableFrontier, runId: RunId) =>
    Ref.modify(state, (current) => {
      let next = current
      let admitted: RunnableFrontierTransition | undefined
      let explanations = [...frontier.explanations]
      for (const transition of frontier.transitions) {
        const attempt = tryAdmitTransition(current, transition, runId)
        if (attempt._tag === "TransitionAdmitted") {
          admitted = transition
          next = attempt.state
          break
        }
        explanations = [
          ...explanations,
          FrontierExplanation.CapacityWait({
            taskId: runnableTransitionTaskId(transition),
            wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
          })
        ]
      }
      return [{ explanations, transition: Option.fromUndefinedOr(admitted) }, next] as const
    })
  )

  return {
    admit,
    bindPlannedAttemptPosition: Effect.fn("TaskAdmissionController.bindPlannedAttemptPosition")(
      function* (selected, correlation) {
        const found = yield* Ref.modify(state, (current) => {
          const key = selectedTransitionKey(selected)
          const matches = (reservation: TaskAdmissionReservation): boolean =>
            reservation.correlation._tag === "SelectedTransitionReservation"
              ? selectedTransitionKey(reservation.correlation.selected) === key
              : reservation.correlation.attemptId === correlation.attemptId &&
                reservation.correlation.runId === correlation.runId
          const matched = current.reservations.some(matches)
          return [
            matched,
            matched
              ? {
                  ...current,
                  reservations: current.reservations.map((reservation) =>
                    reservation.correlation._tag === "SelectedTransitionReservation" &&
                    selectedTransitionKey(reservation.correlation.selected) === key
                      ? { ...reservation, correlation: plannedAttemptReservation(correlation) }
                      : reservation
                  )
                }
              : current
          ] as const
        })
        if (!found) {
          return yield* new PlannedAttemptPositionBindingIssue({ selected })
        }
      }
    ),
    cancelReservedPosition: Effect.fn("TaskAdmissionController.cancelReservedPosition")(function* (selected) {
      const key = selectedTransitionKey(selected)
      const removed = yield* Ref.modify(state, (current) => {
        const nextReservations = current.reservations.filter(
          (reservation) =>
            reservation.correlation._tag !== "SelectedTransitionReservation" ||
            selectedTransitionKey(reservation.correlation.selected) !== key
        )
        return [
          nextReservations.length < current.reservations.length,
          { ...current, reservations: nextReservations }
        ] as const
      })
      if (!removed) {
        return yield* new TaskAdmissionPositionCancellationIssue({ selected })
      }
      return availabilityAfterRemoval()
    }),
    releasePlannedAttemptPosition: Effect.fn("TaskAdmissionController.releasePlannedAttemptPosition")(
      function* (correlation) {
        const removed = yield* Ref.modify(state, (current) => {
          const nextReservations = current.reservations.filter(
            (reservation) =>
              reservation.correlation._tag !== "PlannedAttemptReservation" ||
              reservation.correlation.attemptId !== correlation.attemptId ||
              reservation.correlation.runId !== correlation.runId
          )
          return [
            nextReservations.length < current.reservations.length,
            { ...current, reservations: nextReservations }
          ] as const
        })
        if (!removed) {
          return yield* new PlannedAttemptPositionReleaseIssue()
        }
        return availabilityAfterRemoval()
      }
    ),
    snapshot: () =>
      Ref.get(state).pipe(
        Effect.map((current) => ({
          capacity: current.capacity,
          reservedPositions: current.reservations,
          reservedTaskIds: current.reservations.map(({ taskId }) => taskId)
        }))
      )
  } satisfies TaskAdmissionController
})
