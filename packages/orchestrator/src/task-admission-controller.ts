/* eslint-disable max-lines -- Exact admission correlations and their atomic state transitions remain one domain owner. */
import { Data, Effect, Option, Ref, Schema } from "effect"
import {
  OperationId as OperationIdSchema,
  SelectedTransitionIdentity as SelectedTransitionIdentitySchema,
  TaskId as TaskIdSchema
} from "./domain.js"
import type {
  OperationId,
  ProviderObservationId,
  RunId,
  SelectedTransitionIdentity,
  TaskId,
  TaskWorkCapacity
} from "./domain.js"
import {
  FrontierExplanation,
  type ResponsibilityFreshFacts,
  type RunnableFrontier,
  type RunnableFrontierTransition,
  runnableTransitionOperationId,
  runnableTransitionTaskId
} from "./runnable-frontier.js"
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
    readonly _tag: "FreshCapacityAbsent"
    readonly observationId: ProviderObservationId
    readonly operationId: OperationId
    readonly taskId: TaskId
  }
  | {
    readonly _tag: "FreshCapacityInterrupted"
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
  | {
    readonly _tag: "FreshCapacityUnknown"
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

/**
 * Two current workflow operations cannot both hold the one task-local
 * admission position. Reconstruction rejects this history before admission.
 */
export class MultipleCurrentTaskCapacityOperations
  extends Schema.TaggedErrorClass<MultipleCurrentTaskCapacityOperations>()(
    "MultipleCurrentTaskCapacityOperations",
    {
      operationIds: Schema.Array(OperationIdSchema),
      taskId: TaskIdSchema
    }
  )
{}

/** Fresh provider input named more than one active operation for one task. */
export class MultipleFreshTaskCapacityObservations
  extends Schema.TaggedErrorClass<MultipleFreshTaskCapacityObservations>()(
    "MultipleFreshTaskCapacityObservations",
    {
      operationIds: Schema.Array(OperationIdSchema),
      taskId: TaskIdSchema
    }
  )
{}

type TaskAdmissionReservationCorrelation =
  | {
    readonly _tag: "SelectedTransitionReservation"
    readonly selected: SelectedTransitionIdentity
  }
  | {
    readonly _tag: "OperationReservation"
    readonly operationId: OperationId
  }

/**
 * One task's process-local capacity evidence. Absence from the controller is
 * `NotUsing`; every represented variant consumes exactly one position.
 */
type TaskCapacityState = Data.TaggedEnum<{
  AwaitingProviderEvidence: {
    readonly operationId: OperationId
  }
  CorrelationConflict: {
    readonly expectedOperationId: OperationId
    readonly observationId: ProviderObservationId
    readonly observedOperationId: OperationId
  }
  Reserved: {
    readonly selected: SelectedTransitionIdentity
  }
  Working: {
    readonly observationId: ProviderObservationId
    readonly operationId: OperationId
  }
}>

const TaskCapacityState = Data.taggedEnum<TaskCapacityState>()

export interface TaskCapacityEntry {
  readonly state: TaskCapacityState
  readonly taskId: TaskId
}

export interface TaskAdmissionControllerSnapshot {
  readonly capacity: TaskWorkCapacity
  /** The authoritative one-entry-per-task capacity projection. */
  readonly taskStates: ReadonlyArray<TaskCapacityEntry>
  /** Fresh active reports, derived from the task-keyed states for presentation. */
  readonly occupied: ReadonlyArray<FreshCapacityConsumingInvocation>
  /** Held expected-operation or pre-intent correlations, derived for activation handoff. */
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
  readonly admit: (
    frontier: RunnableFrontier,
    runId: RunId
  ) => Effect.Effect<NextAdmissionDecision>
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
  readonly taskStates: () => Effect.Effect<ReadonlyArray<TaskCapacityEntry>>
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

/** Applies Dalph's zero-or-one capacity requirement for the selected transition. */
export const transitionRequiresTaskAdmissionPosition = (
  transition: RunnableFrontierTransition
): boolean =>
  transition._tag === "CommitFreshTaskClaimIntent"
  || (
    (
      transition._tag === "ContinueExecutorInvocation"
      || transition._tag === "StartExecutorInvocation"
    )
    && transition.capacityRequirement._tag === "OneTaskWorkPosition"
  )

interface TaskAdmissionControllerState {
  readonly capacity: TaskWorkCapacity
  readonly releasedOperationIds: ReadonlySet<OperationId>
  readonly taskStates: ReadonlyArray<TaskCapacityEntry>
}

const stateForTask = (
  state: TaskAdmissionControllerState,
  taskId: TaskId
): TaskCapacityState | undefined => state.taskStates.find((entry) => entry.taskId === taskId)?.state

const replaceTaskState = (
  current: TaskAdmissionControllerState,
  taskId: TaskId,
  taskState: TaskCapacityState | undefined
): TaskAdmissionControllerState => ({
  ...current,
  taskStates: [
    ...current.taskStates.filter((entry) => entry.taskId !== taskId),
    ...(taskState === undefined ? [] : [{ state: taskState, taskId }])
  ].toSorted((left, right) => left.taskId.localeCompare(right.taskId))
})

const expectedOperationId = (
  taskState: TaskCapacityState
): OperationId | undefined => {
  switch (taskState._tag) {
    case "AwaitingProviderEvidence":
    case "Working":
      return taskState.operationId
    case "CorrelationConflict":
      return taskState.expectedOperationId
    case "Reserved":
      return undefined
  }
}

const positionMatchesTransition = (
  taskState: TaskCapacityState,
  transition: RunnableFrontierTransition,
  runId: RunId
): boolean => {
  const operationId = runnableTransitionOperationId(transition)
  if (operationId !== undefined && transition._tag === "ContinueExecutorInvocation") {
    return expectedOperationId(taskState) === operationId
  }
  return taskState._tag === "Reserved"
    && selectedTransitionKey(taskState.selected)
      === selectedTransitionKey(makeSelectedTransitionIdentity(runId, transition))
}

const usedPositions = (state: TaskAdmissionControllerState): number => state.taskStates.length

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
  const taskId = runnableTransitionTaskId(transition)
  const currentTaskState = stateForTask(current, taskId)
  if (
    currentTaskState !== undefined
    && positionMatchesTransition(currentTaskState, transition, runId)
  ) {
    return { _tag: "TransitionAdmitted", state: current }
  }
  if (currentTaskState !== undefined || usedPositions(current) >= current.capacity) {
    return { _tag: "CapacityUnavailable" }
  }
  const operationId = runnableTransitionOperationId(transition)
  return {
    _tag: "TransitionAdmitted",
    state: replaceTaskState(
      current,
      taskId,
      operationId !== undefined && transition._tag === "ContinueExecutorInvocation"
        ? TaskCapacityState.AwaitingProviderEvidence({
          operationId
        })
        : TaskCapacityState.Reserved({
          selected: makeSelectedTransitionIdentity(runId, transition)
        })
    )
  }
}

const duplicateCurrentOperations = (
  positions: MakeTaskAdmissionControllerInput["reconstructedReservedPositions"]
): MultipleCurrentTaskCapacityOperations | undefined => {
  for (const position of positions) {
    const operationIds = positions
      .filter(({ taskId }) => taskId === position.taskId)
      .map(({ operationId }) => operationId)
    if (operationIds.length > 1) {
      return new MultipleCurrentTaskCapacityOperations({
        operationIds,
        taskId: position.taskId
      })
    }
  }
  return undefined
}

const validateCurrentTaskCapacityOperations = (
  positions: MakeTaskAdmissionControllerInput["reconstructedReservedPositions"]
): Effect.Effect<void, MultipleCurrentTaskCapacityOperations> => {
  const duplicate = duplicateCurrentOperations(positions)
  return duplicate === undefined ? Effect.void : Effect.fail(duplicate)
}

export const currentTaskCapacityPositions = (
  facts: ReadonlyArray<ResponsibilityFreshFacts>
): MakeTaskAdmissionControllerInput["reconstructedReservedPositions"] =>
  facts.flatMap(({ disposition, responsibility }) =>
    disposition._tag !== "ExecutorInvocationSettled"
      && responsibility._tag === "ExecutorInvocationResponsibility"
      && responsibility.capacityRequirement._tag === "OneTaskWorkPosition"
      ? [{
        operationId: responsibility.invocation.correlation.invocationId,
        taskId: responsibility.invocation.correlation.taskId
      }]
      : []
  )

export const validateCurrentTaskCapacityFacts = (
  facts: ReadonlyArray<ResponsibilityFreshFacts>
): Effect.Effect<void, MultipleCurrentTaskCapacityOperations> =>
  validateCurrentTaskCapacityOperations(currentTaskCapacityPositions(facts))

const validateFreshTaskCapacityObservations = (
  observations: ReadonlyArray<FreshCapacityConsumingInvocation>
): Effect.Effect<void, MultipleFreshTaskCapacityObservations> => {
  for (const observation of observations) {
    const operationIds = observations
      .filter(({ taskId }) => taskId === observation.taskId)
      .map(({ operationId }) => operationId)
    if (operationIds.length > 1) {
      return Effect.fail(
        new MultipleFreshTaskCapacityObservations({
          operationIds,
          taskId: observation.taskId
        })
      )
    }
  }
  return Effect.void
}

const reconstructedTaskStates = (
  input: MakeTaskAdmissionControllerInput
): ReadonlyArray<TaskCapacityEntry> => {
  const released = input.freshlyReleasedOperationIds ?? new Set()
  const reconstructed = input.reconstructedReservedPositions.flatMap(
    ({ operationId, taskId }): ReadonlyArray<TaskCapacityEntry> => {
      const observed = input.freshOccupiedInvocations.find(
        (invocation) => invocation.taskId === taskId
      )
      if (observed === undefined) {
        return released.has(operationId)
          ? []
          : [{
            state: TaskCapacityState.AwaitingProviderEvidence({ operationId }),
            taskId
          }]
      }
      return [{
        state: observed.operationId === operationId
          ? TaskCapacityState.Working({
            observationId: observed.observationId,
            operationId
          })
          : TaskCapacityState.CorrelationConflict({
            expectedOperationId: operationId,
            observationId: observed.observationId,
            observedOperationId: observed.operationId
          }),
        taskId
      }]
    }
  )
  const reconstructedTaskIds = new Set(
    input.reconstructedReservedPositions.map(({ taskId }) => taskId)
  )
  return [
    ...reconstructed,
    ...input.freshOccupiedInvocations.flatMap(
      (observed): ReadonlyArray<TaskCapacityEntry> =>
        reconstructedTaskIds.has(observed.taskId)
          ? []
          : [{
            state: TaskCapacityState.Working({
              observationId: observed.observationId,
              operationId: observed.operationId
            }),
            taskId: observed.taskId
          }]
    )
  ].toSorted((left, right) => left.taskId.localeCompare(right.taskId))
}

const applyActiveObservation = (
  current: TaskAdmissionControllerState,
  observation: Extract<
    FreshInvocationCapacityObservation,
    { readonly _tag: "FreshCapacityConsumed" }
  >
): TaskAdmissionControllerState => {
  const taskState = stateForTask(current, observation.taskId)
  if (taskState?._tag === "Reserved") return current
  const expected = taskState === undefined
    ? undefined
    : expectedOperationId(taskState)
  if (expected === undefined || expected === observation.operationId) {
    return replaceTaskState(
      current,
      observation.taskId,
      TaskCapacityState.Working({
        observationId: observation.observationId,
        operationId: observation.operationId
      })
    )
  }
  return replaceTaskState(
    current,
    observation.taskId,
    TaskCapacityState.CorrelationConflict({
      expectedOperationId: expected,
      observationId: observation.observationId,
      observedOperationId: observation.operationId
    })
  )
}

const applyInactiveObservation = (
  current: TaskAdmissionControllerState,
  observation: Exclude<
    FreshInvocationCapacityObservation,
    { readonly _tag: "FreshCapacityConsumed" | "FreshCapacityUnknown" }
  >
): TaskAdmissionControllerState => {
  const taskState = stateForTask(current, observation.taskId)
  if (taskState === undefined || taskState._tag === "Reserved") return current
  if (taskState._tag === "CorrelationConflict") {
    if (taskState.observedOperationId === observation.operationId) {
      return replaceTaskState(
        current,
        observation.taskId,
        TaskCapacityState.AwaitingProviderEvidence({
          operationId: taskState.expectedOperationId
        })
      )
    }
    if (taskState.expectedOperationId === observation.operationId) {
      return replaceTaskState(current, observation.taskId, undefined)
    }
    return current
  }
  return taskState.operationId === observation.operationId
    ? replaceTaskState(current, observation.taskId, undefined)
    : current
}

const applyUnknownObservation = (
  current: TaskAdmissionControllerState,
  observation: Extract<
    FreshInvocationCapacityObservation,
    { readonly _tag: "FreshCapacityUnknown" }
  >
): TaskAdmissionControllerState => {
  const taskState = stateForTask(current, observation.taskId)
  if (
    taskState === undefined
    || taskState._tag === "Reserved"
    || taskState._tag === "CorrelationConflict"
  ) return current
  return replaceTaskState(
    current,
    observation.taskId,
    TaskCapacityState.AwaitingProviderEvidence({
      operationId: taskState.operationId
    })
  )
}

const derivedSnapshot = (
  current: TaskAdmissionControllerState
): TaskAdmissionControllerSnapshot => {
  const occupied = current.taskStates.flatMap(
    ({ state, taskId }): ReadonlyArray<FreshCapacityConsumingInvocation> =>
      state._tag === "Working"
        ? [{
          observationId: state.observationId,
          operationId: state.operationId,
          taskId
        }]
        : []
  )
  const reservedPositions = current.taskStates.flatMap(
    ({ state, taskId }): TaskAdmissionControllerSnapshot["reservedPositions"] =>
      state._tag === "Reserved"
        ? [{
          correlation: {
            _tag: "SelectedTransitionReservation",
            selected: state.selected
          },
          taskId
        }]
        : state._tag === "AwaitingProviderEvidence"
            || state._tag === "CorrelationConflict"
        ? [{
          correlation: {
            _tag: "OperationReservation",
            operationId: state._tag === "CorrelationConflict"
              ? state.expectedOperationId
              : state.operationId
          },
          taskId
        }]
        : []
  )
  return {
    capacity: current.capacity,
    occupied,
    reservedPositions,
    reservedTaskIds: reservedPositions.map(({ taskId }) => taskId),
    taskStates: current.taskStates
  }
}

/** Creates the one process-local owner of task-keyed admission positions. */
export const makeTaskAdmissionController = Effect.fn(
  "TaskAdmissionController.make"
)(function*(input: MakeTaskAdmissionControllerInput) {
  yield* validateCurrentTaskCapacityOperations(
    input.reconstructedReservedPositions
  )
  yield* validateFreshTaskCapacityObservations(input.freshOccupiedInvocations)
  const state = yield* Ref.make<TaskAdmissionControllerState>({
    capacity: input.capacity,
    releasedOperationIds: input.freshlyReleasedOperationIds ?? new Set(),
    taskStates: reconstructedTaskStates(input)
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
              taskId: runnableTransitionTaskId(transition),
              wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
            })
          ]
        }

        return [{
          explanations,
          transition: Option.fromUndefinedOr(admitted)
        }, next] as const
      })
  )

  return {
    admit,
    applyFreshInvocationObservation: (observation) =>
      Ref.modify(state, (current) => {
        const observed = observation._tag === "FreshCapacityConsumed"
          ? applyActiveObservation(current, observation)
          : observation._tag === "FreshCapacityUnknown"
          ? applyUnknownObservation(current, observation)
          : applyInactiveObservation(current, observation)
        const next = {
          ...observed,
          releasedOperationIds: observation._tag === "FreshCapacityConsumed"
            ? new Set(
              [...observed.releasedOperationIds].filter(
                (operationId) => operationId !== observation.operationId
              )
            )
            : observation._tag === "FreshCapacityUnknown"
            ? observed.releasedOperationIds
            : new Set([
              ...observed.releasedOperationIds,
              observation.operationId
            ])
        }
        return [changeAfterUsageDecrease(current, next), next] as const
      }),
    bindReservedPosition: Effect.fn("TaskAdmissionController.bindReservedPosition")(
      function*(selected, operationId) {
        const found = yield* Ref.modify(state, (current) => {
          const key = selectedTransitionKey(selected)
          const entry = current.taskStates.find(({ state }) =>
            state._tag === "Reserved"
            && selectedTransitionKey(state.selected) === key
          )
          return [
            entry !== undefined,
            entry === undefined
              ? current
              : replaceTaskState(
                current,
                entry.taskId,
                TaskCapacityState.AwaitingProviderEvidence({ operationId })
              )
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
          const entry = current.taskStates.find(({ state }) =>
            state._tag === "Reserved"
            && selectedTransitionKey(state.selected) === key
          )
          if (entry === undefined) {
            return [
              [
                AdmissionAvailabilityChange.AdmissionAvailabilityUnchanged(),
                false
              ] as const,
              current
            ] as const
          }
          const next = replaceTaskState(current, entry.taskId, undefined)
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
        const entry = current.taskStates.find(({ state }) =>
          state._tag !== "Reserved"
          && (
            expectedOperationId(state) === operationId
            || (
              state._tag === "CorrelationConflict"
              && state.observedOperationId === operationId
            )
          )
        )
        if (entry === undefined && !current.releasedOperationIds.has(operationId)) {
          return [
            [
              AdmissionAvailabilityChange.AdmissionAvailabilityUnchanged(),
              false
            ] as const,
            current
          ] as const
        }
        const nextTaskState = entry?.state._tag === "CorrelationConflict"
          ? entry.state.expectedOperationId === operationId
            ? undefined
            : TaskCapacityState.AwaitingProviderEvidence({
              operationId: entry.state.expectedOperationId
            })
          : undefined
        const next = {
          ...(entry === undefined
            ? current
            : replaceTaskState(current, entry.taskId, nextTaskState)),
          releasedOperationIds: new Set([
            ...current.releasedOperationIds,
            operationId
          ])
        }
        return [[changeAfterUsageDecrease(current, next), true] as const, next] as const
      })
      if (!found) {
        return yield* new TaskAdmissionPositionReleaseIssue({ operationId })
      }
      return change
    }),
    snapshot: () => Ref.get(state).pipe(Effect.map(derivedSnapshot)),
    taskStates: () => Ref.get(state).pipe(Effect.map(({ taskStates }) => taskStates))
  } satisfies TaskAdmissionController
})
