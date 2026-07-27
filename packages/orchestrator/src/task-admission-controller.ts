/* eslint-disable max-lines -- Exact admission correlations and their atomic state transitions remain one domain owner. */
import { Data, Effect, Ref, Schema } from "effect"
import {
  OperationId as OperationIdSchema,
  SelectedTransitionIdentity as SelectedTransitionIdentitySchema
} from "./domain.js"
import type {
  OperationId,
  ProviderObservationId,
  RunId,
  SelectedTransitionIdentity,
  TaskId,
  TaskWorkCapacity
} from "./domain.js"
import { FrontierExplanation, type RunnableFrontier, type RunnableFrontierTransition } from "./runnable-frontier.js"
import { makeSelectedTransitionIdentity, selectedTransitionKey } from "./selected-transition.js"

/** A fresh provider observation that one task invocation currently occupies capacity. */
interface FreshCapacityConsumingInvocation {
  readonly observationId: ProviderObservationId
  readonly operationId: OperationId
  readonly taskId: TaskId
}

type FreshInvocationCapacityObservation =
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

type AdmissionAvailabilityChange = Data.TaggedEnum<{
  AdmissionAvailabilityUnchanged: Record<never, never>
  AdmissionMayNowBePossible: Record<never, never>
}>

const AdmissionAvailabilityChange = Data.taggedEnum<AdmissionAvailabilityChange>()

/** The exact pre-intent reservation was absent when operation intent tried to bind it. */
class TaskAdmissionPositionBindingIssue extends Schema.TaggedErrorClass<TaskAdmissionPositionBindingIssue>()(
  "TaskAdmissionPositionBindingIssue",
  {
    operationId: OperationIdSchema,
    selected: SelectedTransitionIdentitySchema
  }
) {}

/** The exact pre-intent reservation was absent when cancellation tried to free it. */
class TaskAdmissionPositionCancellationIssue extends Schema.TaggedErrorClass<TaskAdmissionPositionCancellationIssue>()(
  "TaskAdmissionPositionCancellationIssue",
  { selected: SelectedTransitionIdentitySchema }
) {}

/** The exact post-intent position was absent when its operation tried to release it. */
class TaskAdmissionPositionReleaseIssue extends Schema.TaggedErrorClass<TaskAdmissionPositionReleaseIssue>()(
  "TaskAdmissionPositionReleaseIssue",
  { operationId: OperationIdSchema }
) {}

export interface TaskAdmissionControllerSnapshot {
  readonly capacity: TaskWorkCapacity
  readonly occupied: ReadonlyArray<FreshCapacityConsumingInvocation>
  readonly reservedPositions: ReadonlyArray<{
    readonly correlation: TaskAdmissionReservationCorrelation
    readonly taskId: TaskId
  }>
  readonly reservedTaskIds: ReadonlyArray<TaskId>
}

interface TaskAdmission {
  readonly explanations: ReadonlyArray<FrontierExplanation>
  readonly transitions: ReadonlyArray<RunnableFrontierTransition>
}

export interface TaskAdmissionController {
  readonly admit: (
    frontier: RunnableFrontier,
    runId: RunId
  ) => Effect.Effect<TaskAdmission>
  readonly applyFreshInvocationObservation: (
    observation: FreshInvocationCapacityObservation
  ) => Effect.Effect<AdmissionAvailabilityChange>
  readonly bindReservedPosition: (
    selected: SelectedTransitionIdentity,
    operationId: OperationId
  ) => Effect.Effect<void, TaskAdmissionPositionBindingIssue>
  readonly cancelReservedPosition: (
    selected: SelectedTransitionIdentity
  ) => Effect.Effect<
    AdmissionAvailabilityChange,
    TaskAdmissionPositionCancellationIssue
  >
  readonly releaseTaskAdmissionPosition: (
    operationId: OperationId
  ) => Effect.Effect<AdmissionAvailabilityChange, TaskAdmissionPositionReleaseIssue>
  readonly snapshot: () => Effect.Effect<TaskAdmissionControllerSnapshot>
}

interface MakeTaskAdmissionControllerInput {
  readonly capacity: TaskWorkCapacity
  readonly freshOccupiedInvocations: ReadonlyArray<FreshCapacityConsumingInvocation>
  readonly freshlyReleasedOperationIds?: ReadonlySet<OperationId>
  readonly reconstructedReservedPositions: ReadonlyArray<{
    readonly operationId: OperationId
    readonly taskId: TaskId
  }>
}

/**
 * Issue #133 replaces review-name-based capacity classification with capacity
 * use declared by an executor's outer invocation protocol.
 */
export const transitionRequiresTaskAdmissionPosition = (
  transition: RunnableFrontierTransition
): boolean =>
  transition._tag === "CommitFreshTaskClaimIntent"
  || (
    transition._tag === "ContinueFreshWorkflowOperation"
    && transition.requiresTaskAdmission
  )
  || transition._tag === "ContinueTaskExecution"
  || transition._tag === "ContinueImplementationReview"
  || transition._tag === "ContinueReviewFindingsHandback"

interface TaskAdmissionReservation {
  readonly correlation: TaskAdmissionReservationCorrelation
  readonly taskId: TaskId
}

type TaskAdmissionReservationCorrelation =
  | {
    readonly _tag: "SelectedTransitionReservation"
    readonly selected: SelectedTransitionIdentity
  }
  | {
    readonly _tag: "OperationReservation"
    readonly operationId: OperationId
  }

const operationReservation = (
  operationId: OperationId
): TaskAdmissionReservationCorrelation => ({
  _tag: "OperationReservation",
  operationId
})

const transitionReservation = (
  transition: RunnableFrontierTransition,
  runId: RunId
): TaskAdmissionReservationCorrelation =>
  "operationId" in transition
    && transition._tag !== "ContinueFreshWorkflowOperation"
    ? operationReservation(transition.operationId)
    : {
      _tag: "SelectedTransitionReservation",
      selected: makeSelectedTransitionIdentity(runId, transition)
    }
interface TaskAdmissionControllerState {
  readonly capacity: TaskWorkCapacity
  readonly occupied: ReadonlyArray<FreshCapacityConsumingInvocation>
  readonly releasedOperationIds: ReadonlySet<OperationId>
  readonly reservations: ReadonlyArray<TaskAdmissionReservation>
}

const sameReservation = (
  reservation: TaskAdmissionReservation,
  transition: RunnableFrontierTransition,
  runId: RunId
): boolean =>
  reservation.taskId === transition.taskId
  && (
    "operationId" in transition
      && transition._tag !== "ContinueFreshWorkflowOperation"
      ? reservation.correlation._tag === "OperationReservation"
        && reservation.correlation.operationId === transition.operationId
      : reservation.correlation._tag === "SelectedTransitionReservation"
        && selectedTransitionKey(reservation.correlation.selected)
          === selectedTransitionKey(makeSelectedTransitionIdentity(runId, transition))
  )

const usedPositions = (state: TaskAdmissionControllerState): number => state.occupied.length + state.reservations.length

const changeAfterUsageDecrease = (
  before: TaskAdmissionControllerState,
  after: TaskAdmissionControllerState
): AdmissionAvailabilityChange =>
  usedPositions(after) < usedPositions(before)
    ? AdmissionAvailabilityChange.AdmissionMayNowBePossible()
    : AdmissionAvailabilityChange.AdmissionAvailabilityUnchanged()

type AdmissionAttempt =
  | {
    readonly _tag: "TransitionAdmitted"
    readonly state: TaskAdmissionControllerState
  }
  | { readonly _tag: "CapacityUnavailable" }

const tryAdmitTransition = (
  current: TaskAdmissionControllerState,
  transition: RunnableFrontierTransition,
  runId: RunId
): AdmissionAttempt => {
  if (!transitionRequiresTaskAdmissionPosition(transition)) {
    return { _tag: "TransitionAdmitted", state: current }
  }
  if (
    current.reservations.some((reservation) => sameReservation(reservation, transition, runId))
  ) {
    return { _tag: "TransitionAdmitted", state: current }
  }
  if (
    "operationId" in transition
    && current.occupied.some(({ operationId, taskId }) =>
      taskId === transition.taskId
      && operationId === transition.operationId
    )
  ) {
    // A provider-observed invocation is the post-intent position for this
    // exact operation. Restart resumes its responsibility without reserving
    // another position or waiting for itself to release capacity.
    return { _tag: "TransitionAdmitted", state: current }
  }
  const taskAlreadyUsesPosition = current.reservations.some(({ taskId }) => taskId === transition.taskId)
    || current.occupied.some(({ taskId }) => taskId === transition.taskId)
  if (taskAlreadyUsesPosition || usedPositions(current) >= current.capacity) {
    return { _tag: "CapacityUnavailable" }
  }
  return {
    _tag: "TransitionAdmitted",
    state: {
      ...current,
      reservations: [
        ...current.reservations,
        {
          correlation: transitionReservation(transition, runId),
          taskId: transition.taskId
        }
      ].toSorted((left, right) => left.taskId.localeCompare(right.taskId))
    }
  }
}

/** Creates the one process-local owner of reserved and occupied admission positions. */
export const makeTaskAdmissionController = Effect.fn(
  "TaskAdmissionController.make"
)(function*(input: MakeTaskAdmissionControllerInput) {
  const state = yield* Ref.make<TaskAdmissionControllerState>({
    capacity: input.capacity,
    occupied: [...input.freshOccupiedInvocations].sort((left, right) => left.taskId.localeCompare(right.taskId)),
    releasedOperationIds: input.freshlyReleasedOperationIds ?? new Set(),
    reservations: [
      ...input.reconstructedReservedPositions.map(
        ({ operationId, taskId }) => ({
          correlation: operationReservation(operationId),
          taskId
        })
      ).filter(({ correlation, taskId }) =>
        !input.freshOccupiedInvocations.some((invocation) =>
          invocation.taskId === taskId
          && correlation._tag === "OperationReservation"
          && invocation.operationId === correlation.operationId
        )
      )
    ]
      .sort((left, right) => left.taskId.localeCompare(right.taskId))
  })

  const admit = Effect.fn("TaskAdmissionController.admit")(
    (frontier: RunnableFrontier, runId: RunId) =>
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
              taskId: transition.taskId,
              wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
            })
          ]
        }

        return [{
          explanations,
          transitions: admitted === undefined ? [] : [admitted]
        }, next] as const
      })
  )

  return {
    admit,
    applyFreshInvocationObservation: (observation) =>
      Ref.modify(state, (current) => {
        const conflictingReservation = current.reservations.some(
          ({ correlation, taskId }) =>
            taskId === observation.taskId
            && correlation._tag === "OperationReservation"
            && correlation.operationId !== observation.operationId
        )
        if (conflictingReservation) {
          return [
            AdmissionAvailabilityChange.AdmissionAvailabilityUnchanged(),
            current
          ] as const
        }
        const next = {
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
              taskId !== observation.taskId
              || operationId !== observation.operationId
            ),
          releasedOperationIds: observation._tag === "FreshCapacityConsumed"
            ? new Set(
              [...current.releasedOperationIds].filter(
                (operationId) => operationId !== observation.operationId
              )
            )
            : new Set([
              ...current.releasedOperationIds,
              observation.operationId
            ]),
          reservations: current.reservations.filter(({ correlation, taskId }) =>
            taskId !== observation.taskId
            || correlation._tag !== "OperationReservation"
            || correlation.operationId !== observation.operationId
          )
        }
        return [changeAfterUsageDecrease(current, next), next] as const
      }),
    bindReservedPosition: Effect.fn("TaskAdmissionController.bindReservedPosition")(
      function*(selected, operationId) {
        const found = yield* Ref.modify(state, (current) => {
          const key = selectedTransitionKey(selected)
          const matched = current.reservations.some((reservation) =>
            reservation.correlation._tag === "SelectedTransitionReservation"
            && selectedTransitionKey(reservation.correlation.selected) === key
          )
          return [
            matched,
            matched
              ? {
                ...current,
                reservations: current.reservations.map((reservation) =>
                  reservation.correlation._tag
                      === "SelectedTransitionReservation"
                    && selectedTransitionKey(reservation.correlation.selected)
                      === key
                    ? {
                      ...reservation,
                      correlation: operationReservation(operationId)
                    }
                    : reservation
                )
              }
              : current
          ] as const
        })
        if (!found) {
          return yield* new TaskAdmissionPositionBindingIssue({
            operationId,
            selected
          })
        }
      }
    ),
    cancelReservedPosition: Effect.fn("TaskAdmissionController.cancelReservedPosition")(
      function*(selected) {
        const key = selectedTransitionKey(selected)
        const [change, found] = yield* Ref.modify(state, (
          current
        ): readonly [
          readonly [AdmissionAvailabilityChange, boolean],
          TaskAdmissionControllerState
        ] => {
          const matched = current.reservations.some((reservation) =>
            reservation.correlation._tag === "SelectedTransitionReservation"
            && selectedTransitionKey(reservation.correlation.selected) === key
          )
          if (!matched) {
            return [
              [
                AdmissionAvailabilityChange.AdmissionAvailabilityUnchanged(),
                false
              ] as const,
              current
            ] as const
          }
          const next = {
            ...current,
            reservations: current.reservations.filter((reservation) =>
              reservation.correlation._tag !== "SelectedTransitionReservation"
              || selectedTransitionKey(reservation.correlation.selected) !== key
            )
          }
          return [[changeAfterUsageDecrease(current, next), true] as const, next] as const
        })
        if (!found) {
          return yield* new TaskAdmissionPositionCancellationIssue({ selected })
        }
        return change
      }
    ),
    releaseTaskAdmissionPosition: Effect.fn(
      "TaskAdmissionController.releaseTaskAdmissionPosition"
    )(function*(operationId) {
      const [change, found] = yield* Ref.modify(state, (
        current
      ): readonly [
        readonly [AdmissionAvailabilityChange, boolean],
        TaskAdmissionControllerState
      ] => {
        const matched = current.reservations.some(
          (reservation) =>
            reservation.correlation._tag === "OperationReservation"
            && reservation.correlation.operationId === operationId
        ) || current.occupied.some(
          (invocation) => invocation.operationId === operationId
        ) || current.releasedOperationIds.has(operationId)
        if (!matched) {
          return [
            [
              AdmissionAvailabilityChange.AdmissionAvailabilityUnchanged(),
              false
            ] as const,
            current
          ] as const
        }
        const next = {
          ...current,
          occupied: current.occupied.filter(
            (invocation) => invocation.operationId !== operationId
          ),
          // Retain exact release evidence so same-operation finalization is
          // idempotent after an observed release or a duplicate completion.
          releasedOperationIds: new Set([
            ...current.releasedOperationIds,
            operationId
          ]),
          reservations: current.reservations.filter((reservation) =>
            reservation.correlation._tag !== "OperationReservation"
            || reservation.correlation.operationId !== operationId
          )
        }
        return [[changeAfterUsageDecrease(current, next), true] as const, next] as const
      })
      if (!found) {
        return yield* new TaskAdmissionPositionReleaseIssue({ operationId })
      }
      return change
    }),
    snapshot: () =>
      Ref.get(state).pipe(
        Effect.map((current) => ({
          capacity: current.capacity,
          occupied: current.occupied,
          reservedPositions: current.reservations,
          reservedTaskIds: current.reservations.map(({ taskId }) => taskId)
        }))
      )
  } satisfies TaskAdmissionController
})
