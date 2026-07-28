/* eslint-disable max-lines -- Exact admission correlations and their atomic state transitions remain one domain owner. */
import { Data, Effect, Option, Ref, Schema } from "effect"
import {
  ExecutorOuterInvocationId as ExecutorOuterInvocationIdSchema,
  SelectedTransitionIdentity as SelectedTransitionIdentitySchema,
  TaskId as TaskIdSchema
} from "./domain.js"
import type {
  ExecutorOuterInvocationId,
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
  runnableTransitionTaskId
} from "./runnable-frontier.js"
import { makeSelectedTransitionIdentity, selectedTransitionKey } from "./selected-transition.js"

/** The latest normalized executor report that one outer invocation is active. */
interface LatestExecutorActiveReport {
  readonly observationId: ProviderObservationId
  readonly invocationId: ExecutorOuterInvocationId
  readonly taskId: TaskId
}

type FreshInvocationCapacityObservation =
  | {
    readonly _tag: "FreshCapacityConsumed"
    readonly observationId: ProviderObservationId
    readonly invocationId: ExecutorOuterInvocationId
    readonly taskId: TaskId
  }
  | {
    readonly _tag: "FreshCapacityAbsent"
    readonly observationId: ProviderObservationId
    readonly invocationId: ExecutorOuterInvocationId
    readonly taskId: TaskId
  }
  | {
    readonly _tag: "FreshCapacityInterrupted"
    readonly observationId: ProviderObservationId
    readonly invocationId: ExecutorOuterInvocationId
    readonly taskId: TaskId
  }
  | {
    readonly _tag: "FreshCapacityReleased"
    readonly observationId: ProviderObservationId
    readonly invocationId: ExecutorOuterInvocationId
    readonly taskId: TaskId
  }
  | {
    readonly _tag: "FreshCapacityUnknown"
    readonly observationId: ProviderObservationId
    readonly invocationId: ExecutorOuterInvocationId
    readonly taskId: TaskId
  }

type AdmissionAvailabilityChange = Data.TaggedEnum<{
  AdmissionAvailabilityUnchanged: Record<never, never>
  AdmissionMayNowBePossible: Record<never, never>
}>

const AdmissionAvailabilityChange = Data.taggedEnum<AdmissionAvailabilityChange>()

/** The exact pre-intent reservation was absent when outer intent tried to bind it. */
class TaskAdmissionPositionBindingIssue extends Schema.TaggedErrorClass<TaskAdmissionPositionBindingIssue>()(
  "TaskAdmissionPositionBindingIssue",
  {
    invocationId: ExecutorOuterInvocationIdSchema,
    selected: SelectedTransitionIdentitySchema
  }
) {}

/** The exact pre-intent reservation was absent when cancellation tried to free it. */
class TaskAdmissionPositionCancellationIssue extends Schema.TaggedErrorClass<TaskAdmissionPositionCancellationIssue>()(
  "TaskAdmissionPositionCancellationIssue",
  { selected: SelectedTransitionIdentitySchema }
) {}

/** The exact post-intent position was absent when its outer invocation released it. */
class TaskAdmissionPositionReleaseIssue extends Schema.TaggedErrorClass<TaskAdmissionPositionReleaseIssue>()(
  "TaskAdmissionPositionReleaseIssue",
  { invocationId: ExecutorOuterInvocationIdSchema }
) {}

/**
 * Two unfinished outer executor invocations cannot both hold the one task-local
 * admission position. Reconstruction rejects this history before admission.
 */
export class MultipleUnfinishedExecutorInvocationsForTask
  extends Schema.TaggedErrorClass<MultipleUnfinishedExecutorInvocationsForTask>()(
    "MultipleUnfinishedExecutorInvocationsForTask",
    {
      invocationIds: Schema.Array(ExecutorOuterInvocationIdSchema),
      taskId: TaskIdSchema
    }
  )
{}

/** The latest normalized executor reports name more than one outer invocation for one task. */
export class MultipleLatestExecutorReportsForTask
  extends Schema.TaggedErrorClass<MultipleLatestExecutorReportsForTask>()(
    "MultipleLatestExecutorReportsForTask",
    {
      invocationIds: Schema.Array(ExecutorOuterInvocationIdSchema),
      taskId: TaskIdSchema
    }
  )
{}

/**
 * One task's process-local capacity evidence. Absence from the controller is
 * `NotUsing`; every represented variant consumes exactly one position.
 */
export type TaskWorkPosition = Data.TaggedEnum<{
  AwaitingExecutorReport: {
    readonly invocationId: ExecutorOuterInvocationId
  }
  ExecutorInvocationMismatch: {
    readonly expectedInvocationId: ExecutorOuterInvocationId
    readonly observationId: ProviderObservationId
    readonly reportedInvocationId: ExecutorOuterInvocationId
  }
  Reserved: {
    readonly selected: SelectedTransitionIdentity
  }
  Working: {
    readonly observationId: ProviderObservationId
    readonly invocationId: ExecutorOuterInvocationId
  }
}>

const TaskWorkPosition = Data.taggedEnum<TaskWorkPosition>()

export interface TaskAdmissionControllerSnapshot {
  readonly capacity: TaskWorkCapacity
  /** One entry for each task using task-work capacity; absence means `NotUsing`. */
  readonly taskWorkPositions: ReadonlyMap<TaskId, TaskWorkPosition>
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
    invocationId: ExecutorOuterInvocationId
  ) => Effect.Effect<void, TaskAdmissionPositionBindingIssue>
  readonly cancelReservedPosition: (
    selected: SelectedTransitionIdentity
  ) => Effect.Effect<
    AdmissionAvailabilityChange,
    TaskAdmissionPositionCancellationIssue
  >
  readonly releaseTaskAdmissionPosition: (
    invocationId: ExecutorOuterInvocationId
  ) => Effect.Effect<AdmissionAvailabilityChange, TaskAdmissionPositionReleaseIssue>
  readonly snapshot: () => Effect.Effect<TaskAdmissionControllerSnapshot>
  readonly taskWorkPositions: () => Effect.Effect<ReadonlyMap<TaskId, TaskWorkPosition>>
}

interface MakeTaskAdmissionControllerInput {
  readonly capacity: TaskWorkCapacity
  readonly latestExecutorActiveReports: ReadonlyArray<LatestExecutorActiveReport>
  readonly freshlyReleasedInvocationIds?: ReadonlySet<ExecutorOuterInvocationId>
  readonly unfinishedRecordedExecutorInvocations: ReadonlyArray<{
    readonly invocationId: ExecutorOuterInvocationId
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
  readonly releasedInvocationIds: ReadonlySet<ExecutorOuterInvocationId>
  readonly taskWorkPositions: ReadonlyMap<TaskId, TaskWorkPosition>
}

const stateForTask = (
  state: TaskAdmissionControllerState,
  taskId: TaskId
): TaskWorkPosition | undefined => state.taskWorkPositions.get(taskId)

const replaceTaskState = (
  current: TaskAdmissionControllerState,
  taskId: TaskId,
  taskState: TaskWorkPosition | undefined
): TaskAdmissionControllerState => {
  const entries = [
    ...[...current.taskWorkPositions]
      .filter(([entryTaskId]) => entryTaskId !== taskId),
    ...(taskState === undefined ? [] : [[taskId, taskState] as const])
  ]
  return {
    ...current,
    taskWorkPositions: new Map(
      entries.toSorted(([left], [right]) => left.localeCompare(right))
    )
  }
}

const expectedInvocationId = (
  taskState: TaskWorkPosition
): ExecutorOuterInvocationId | undefined => {
  switch (taskState._tag) {
    case "AwaitingExecutorReport":
    case "Working":
      return taskState.invocationId
    case "ExecutorInvocationMismatch":
      return taskState.expectedInvocationId
    case "Reserved":
      return undefined
  }
}

const positionMatchesTransition = (
  taskState: TaskWorkPosition,
  transition: RunnableFrontierTransition,
  runId: RunId
): boolean => {
  if (transition._tag === "ContinueExecutorInvocation") {
    return expectedInvocationId(taskState)
      === transition.invocation.correlation.invocationId
  }
  return taskState._tag === "Reserved"
    && selectedTransitionKey(taskState.selected)
      === selectedTransitionKey(makeSelectedTransitionIdentity(runId, transition))
}

const usedPositions = (state: TaskAdmissionControllerState): number => state.taskWorkPositions.size

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
  return {
    _tag: "TransitionAdmitted",
    state: replaceTaskState(
      current,
      taskId,
      transition._tag === "ContinueExecutorInvocation"
        ? TaskWorkPosition.AwaitingExecutorReport({
          invocationId: transition.invocation.correlation.invocationId
        })
        : TaskWorkPosition.Reserved({
          selected: makeSelectedTransitionIdentity(runId, transition)
        })
    )
  }
}

const duplicateCurrentOperations = (
  positions: MakeTaskAdmissionControllerInput["unfinishedRecordedExecutorInvocations"]
): MultipleUnfinishedExecutorInvocationsForTask | undefined => {
  for (const position of positions) {
    const invocationIds = positions
      .filter(({ taskId }) => taskId === position.taskId)
      .map(({ invocationId }) => invocationId)
    if (invocationIds.length > 1) {
      return new MultipleUnfinishedExecutorInvocationsForTask({
        invocationIds,
        taskId: position.taskId
      })
    }
  }
  return undefined
}

const validateCurrentTaskCapacityOperations = (
  positions: MakeTaskAdmissionControllerInput["unfinishedRecordedExecutorInvocations"]
): Effect.Effect<void, MultipleUnfinishedExecutorInvocationsForTask> => {
  const duplicate = duplicateCurrentOperations(positions)
  return duplicate === undefined ? Effect.void : Effect.fail(duplicate)
}

export const unfinishedRecordedExecutorInvocationsFor = (
  facts: ReadonlyArray<ResponsibilityFreshFacts>
): MakeTaskAdmissionControllerInput["unfinishedRecordedExecutorInvocations"] =>
  facts.flatMap(({ disposition, responsibility }) =>
    disposition._tag !== "ExecutorInvocationSettled"
      && responsibility._tag === "ExecutorInvocationResponsibility"
      && responsibility.capacityRequirement._tag === "OneTaskWorkPosition"
      ? [{
        invocationId: ExecutorOuterInvocationIdSchema.make(
          responsibility.invocation.correlation.invocationId
        ),
        taskId: responsibility.invocation.correlation.taskId
      }]
      : []
  )

export const validateCurrentTaskCapacityFacts = (
  facts: ReadonlyArray<ResponsibilityFreshFacts>
): Effect.Effect<void, MultipleUnfinishedExecutorInvocationsForTask> =>
  validateCurrentTaskCapacityOperations(unfinishedRecordedExecutorInvocationsFor(facts))

const validateLatestExecutorReports = (
  observations: ReadonlyArray<LatestExecutorActiveReport>
): Effect.Effect<void, MultipleLatestExecutorReportsForTask> => {
  for (const observation of observations) {
    const invocationIds = observations
      .filter(({ taskId }) => taskId === observation.taskId)
      .map(({ invocationId }) => invocationId)
    if (invocationIds.length > 1) {
      return Effect.fail(
        new MultipleLatestExecutorReportsForTask({
          invocationIds,
          taskId: observation.taskId
        })
      )
    }
  }
  return Effect.void
}

const reconstructedTaskWorkPositions = (
  input: MakeTaskAdmissionControllerInput
): ReadonlyMap<TaskId, TaskWorkPosition> => {
  const released = input.freshlyReleasedInvocationIds ?? new Set()
  const reconstructed = input.unfinishedRecordedExecutorInvocations.flatMap(
    ({ invocationId, taskId }): ReadonlyArray<readonly [TaskId, TaskWorkPosition]> => {
      const observed = input.latestExecutorActiveReports.find(
        (invocation) => invocation.taskId === taskId
      )
      if (observed === undefined) {
        return released.has(invocationId)
          ? []
          : [[taskId, TaskWorkPosition.AwaitingExecutorReport({ invocationId })]]
      }
      return [[
        taskId,
        observed.invocationId === invocationId
          ? TaskWorkPosition.Working({
            observationId: observed.observationId,
            invocationId
          })
          : TaskWorkPosition.ExecutorInvocationMismatch({
            expectedInvocationId: invocationId,
            observationId: observed.observationId,
            reportedInvocationId: observed.invocationId
          })
      ]]
    }
  )
  return new Map(reconstructed.toSorted(([left], [right]) => left.localeCompare(right)))
}

const applyActiveObservation = (
  current: TaskAdmissionControllerState,
  observation: Extract<
    FreshInvocationCapacityObservation,
    { readonly _tag: "FreshCapacityConsumed" }
  >
): TaskAdmissionControllerState => {
  const taskState = stateForTask(current, observation.taskId)
  if (taskState === undefined || taskState._tag === "Reserved") return current
  const expected = expectedInvocationId(taskState)
  if (expected === undefined) return current
  if (expected === observation.invocationId) {
    return replaceTaskState(
      current,
      observation.taskId,
      TaskWorkPosition.Working({
        observationId: observation.observationId,
        invocationId: observation.invocationId
      })
    )
  }
  return replaceTaskState(
    current,
    observation.taskId,
    TaskWorkPosition.ExecutorInvocationMismatch({
      expectedInvocationId: expected,
      observationId: observation.observationId,
      reportedInvocationId: observation.invocationId
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
  if (taskState._tag === "ExecutorInvocationMismatch") {
    if (taskState.reportedInvocationId === observation.invocationId) {
      return replaceTaskState(
        current,
        observation.taskId,
        TaskWorkPosition.AwaitingExecutorReport({
          invocationId: taskState.expectedInvocationId
        })
      )
    }
    if (taskState.expectedInvocationId === observation.invocationId) {
      return replaceTaskState(current, observation.taskId, undefined)
    }
    return current
  }
  return taskState.invocationId === observation.invocationId
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
    || taskState._tag === "ExecutorInvocationMismatch"
  ) return current
  return replaceTaskState(
    current,
    observation.taskId,
    TaskWorkPosition.AwaitingExecutorReport({
      invocationId: taskState.invocationId
    })
  )
}

const findTaskWorkPosition = (
  positions: ReadonlyMap<TaskId, TaskWorkPosition>,
  predicate: (position: TaskWorkPosition) => boolean
): readonly [TaskId, TaskWorkPosition] | undefined => [...positions].find(([, position]) => predicate(position))

const derivedSnapshot = (
  current: TaskAdmissionControllerState
): TaskAdmissionControllerSnapshot => ({
  capacity: current.capacity,
  taskWorkPositions: new Map(current.taskWorkPositions)
})

/** Creates the one process-local owner of task-keyed admission positions. */
export const makeTaskAdmissionController = Effect.fn(
  "TaskAdmissionController.make"
)(function*(input: MakeTaskAdmissionControllerInput) {
  yield* validateCurrentTaskCapacityOperations(
    input.unfinishedRecordedExecutorInvocations
  )
  yield* validateLatestExecutorReports(input.latestExecutorActiveReports)
  const state = yield* Ref.make<TaskAdmissionControllerState>({
    capacity: input.capacity,
    releasedInvocationIds: input.freshlyReleasedInvocationIds ?? new Set(),
    taskWorkPositions: reconstructedTaskWorkPositions(input)
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
          releasedInvocationIds: observation._tag === "FreshCapacityConsumed"
            ? new Set(
              [...observed.releasedInvocationIds].filter(
                (invocationId) => invocationId !== observation.invocationId
              )
            )
            : observation._tag === "FreshCapacityUnknown"
            ? observed.releasedInvocationIds
            : new Set([
              ...observed.releasedInvocationIds,
              observation.invocationId
            ])
        }
        return [changeAfterUsageDecrease(current, next), next] as const
      }),
    bindReservedPosition: Effect.fn("TaskAdmissionController.bindReservedPosition")(
      function*(selected, invocationId) {
        const found = yield* Ref.modify(state, (current) => {
          const key = selectedTransitionKey(selected)
          const entry = findTaskWorkPosition(current.taskWorkPositions, (position) =>
            position._tag === "Reserved"
            && selectedTransitionKey(position.selected) === key)
          return [
            entry !== undefined,
            entry === undefined
              ? current
              : replaceTaskState(
                current,
                entry[0],
                TaskWorkPosition.AwaitingExecutorReport({ invocationId })
              )
          ] as const
        })
        if (!found) {
          return yield* new TaskAdmissionPositionBindingIssue({
            invocationId,
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
          const entry = findTaskWorkPosition(current.taskWorkPositions, (position) =>
            position._tag === "Reserved"
            && selectedTransitionKey(position.selected) === key)
          if (entry === undefined) {
            return [
              [
                AdmissionAvailabilityChange.AdmissionAvailabilityUnchanged(),
                false
              ] as const,
              current
            ] as const
          }
          const next = replaceTaskState(current, entry[0], undefined)
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
    )(function*(invocationId) {
      const [change, found] = yield* Ref.modify(state, (
        current
      ): readonly [
        readonly [AdmissionAvailabilityChange, boolean],
        TaskAdmissionControllerState
      ] => {
        const entry = findTaskWorkPosition(current.taskWorkPositions, (position) =>
          position._tag !== "Reserved"
          && (
            expectedInvocationId(position) === invocationId
            || (
              position._tag === "ExecutorInvocationMismatch"
              && position.reportedInvocationId === invocationId
            )
          ))
        if (entry === undefined && !current.releasedInvocationIds.has(invocationId)) {
          return [
            [
              AdmissionAvailabilityChange.AdmissionAvailabilityUnchanged(),
              false
            ] as const,
            current
          ] as const
        }
        const nextTaskState = entry?.[1]._tag === "ExecutorInvocationMismatch"
          ? entry[1].expectedInvocationId === invocationId
            ? undefined
            : TaskWorkPosition.AwaitingExecutorReport({
              invocationId: entry[1].expectedInvocationId
            })
          : undefined
        const next = {
          ...(entry === undefined
            ? current
            : replaceTaskState(current, entry[0], nextTaskState)),
          releasedInvocationIds: new Set([
            ...current.releasedInvocationIds,
            invocationId
          ])
        }
        return [[changeAfterUsageDecrease(current, next), true] as const, next] as const
      })
      if (!found) {
        return yield* new TaskAdmissionPositionReleaseIssue({ invocationId })
      }
      return change
    }),
    snapshot: () => Ref.get(state).pipe(Effect.map(derivedSnapshot)),
    taskWorkPositions: () =>
      Ref.get(state).pipe(
        Effect.map(({ taskWorkPositions }) => new Map(taskWorkPositions))
      )
  } satisfies TaskAdmissionController
})
