// @effect-diagnostics lazyEffect:off
import { Data, Effect, Option, Ref, Schema } from "effect"
import {
  SelectedTransitionIdentity as SelectedTransitionIdentitySchema,
  makeSelectedTransitionIdentity,
  selectedTransitionKey
} from "../activation/selected-transition.js"
import { type AttemptId, type RunId, type TaskId, type PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { type SelectedTransitionIdentity } from "../activation/selected-transition.js"
import { type TaskWorkCapacity } from "./capacity.js"
import {
  FrontierExplanation,
  type RunnableFrontier,
  type RunnableFrontierTransition,
  runnableTransitionTaskId
} from "../frontier/frontier.js"
import { transitionTaskWorkPosition } from "../frontier/transition-task-work.js"

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
  readonly reservedPositions: ReadonlyArray<{ readonly correlation: TaskWorkPosition; readonly taskId: TaskId }>
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
  readonly resize: (capacity: TaskWorkCapacity) => Effect.Effect<AdmissionAvailabilityChange>
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
  transitionTaskWorkPosition(transition) === "ReserveOrReuse"

/** One task's process-local use of task-work capacity before or after its planned attempt is known. */
type TaskWorkPosition =
  | { readonly _tag: "SelectedTransitionReservation"; readonly selected: SelectedTransitionIdentity }
  | { readonly _tag: "PlannedAttemptReservation"; readonly attemptId: AttemptId; readonly runId: RunId }

interface TaskAdmissionControllerState {
  readonly capacity: TaskWorkCapacity
  readonly positions: ReadonlyMap<TaskId, TaskWorkPosition>
}

const plannedAttemptReservation = (correlation: PlannedAttemptExecutorCorrelation): TaskWorkPosition => ({
  _tag: "PlannedAttemptReservation",
  attemptId: correlation.attemptId,
  runId: correlation.runId
})

const transitionReservation = (transition: RunnableFrontierTransition, runId: RunId): TaskWorkPosition =>
  transition._tag === "ContinuePlannedAttemptExecutorWork"
    ? plannedAttemptReservation({
        attemptId: transition.plannedAttempt.attemptId,
        runId: transition.plannedAttempt.runId
      })
    : { _tag: "SelectedTransitionReservation", selected: makeSelectedTransitionIdentity(runId, transition) }

const sameReservation = (
  position: TaskWorkPosition | undefined,
  transition: RunnableFrontierTransition,
  runId: RunId
): boolean =>
  position !== undefined &&
  (transition._tag === "ContinuePlannedAttemptExecutorWork"
    ? position._tag === "PlannedAttemptReservation" &&
      position.attemptId === transition.plannedAttempt.attemptId &&
      position.runId === transition.plannedAttempt.runId
    : position._tag === "SelectedTransitionReservation" &&
      selectedTransitionKey(position.selected) ===
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
  const taskId = runnableTransitionTaskId(transition)
  if (sameReservation(current.positions.get(taskId), transition, runId)) {
    return { _tag: "TransitionAdmitted", state: current }
  }
  if (current.positions.has(taskId) || current.positions.size >= current.capacity) {
    return { _tag: "CapacityUnavailable" }
  }
  return {
    _tag: "TransitionAdmitted",
    state: { ...current, positions: new Map(current.positions).set(taskId, transitionReservation(transition, runId)) }
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
    positions: new Map(
      (input.reconstructedPlannedAttemptPositions ?? [])
        .toSorted((left, right) => left.taskId.localeCompare(right.taskId))
        .map(({ attemptId, runId, taskId }) => [taskId, plannedAttemptReservation({ attemptId, runId })] as const)
    )
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
          const position = current.positions.get(selected.subjectTaskId)
          const matched =
            position !== undefined &&
            (position._tag === "SelectedTransitionReservation"
              ? selectedTransitionKey(position.selected) === key
              : position.attemptId === correlation.attemptId && position.runId === correlation.runId)
          return [
            matched,
            matched
              ? {
                  ...current,
                  positions: new Map(current.positions).set(
                    selected.subjectTaskId,
                    plannedAttemptReservation(correlation)
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
        const found = [...current.positions].find(
          ([, position]) =>
            position._tag === "SelectedTransitionReservation" && selectedTransitionKey(position.selected) === key
        )
        if (found === undefined) return [false, current] as const
        const nextPositions = new Map(current.positions)
        nextPositions.delete(found[0])
        return [true, { ...current, positions: nextPositions }] as const
      })
      if (!removed) {
        return yield* new TaskAdmissionPositionCancellationIssue({ selected })
      }
      return availabilityAfterRemoval()
    }),
    releasePlannedAttemptPosition: Effect.fn("TaskAdmissionController.releasePlannedAttemptPosition")(
      function* (correlation) {
        const removed = yield* Ref.modify(state, (current) => {
          const found = [...current.positions].find(
            ([, position]) =>
              position._tag === "PlannedAttemptReservation" &&
              position.attemptId === correlation.attemptId &&
              position.runId === correlation.runId
          )
          if (found === undefined) return [false, current] as const
          const nextPositions = new Map(current.positions)
          nextPositions.delete(found[0])
          return [true, { ...current, positions: nextPositions }] as const
        })
        if (!removed) {
          return yield* new PlannedAttemptPositionReleaseIssue()
        }
        return availabilityAfterRemoval()
      }
    ),
    resize: Effect.fn("TaskAdmissionController.resize")((capacity) =>
      Ref.update(state, (current) => ({ ...current, capacity })).pipe(Effect.as(availabilityAfterRemoval()))
    ),
    snapshot: () =>
      Ref.get(state).pipe(
        Effect.map((current) => ({
          capacity: current.capacity,
          reservedPositions: [...current.positions]
            .map(([taskId, correlation]) => ({ correlation, taskId }))
            .toSorted((left, right) => left.taskId.localeCompare(right.taskId)),
          reservedTaskIds: [...current.positions.keys()].toSorted((left, right) => left.localeCompare(right))
        }))
      )
  } satisfies TaskAdmissionController
})
