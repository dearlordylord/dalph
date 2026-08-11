import { Match, Schema } from "effect"
import { m } from "foldkit/message"
import { ts } from "foldkit/schema"
import { TaskId, type TaskId as TaskIdType } from "../../../packages/contracts/src/task-identity.ts"
import {
  AuthoredRunActivationOrdinal,
  type AuthoredRunActivationOrdinal as AuthoredRunActivationOrdinalType
} from "../../../packages/dalph/src/cassettes/authored-domain.ts"

/**
 * Stable renderer contract for every playback control. A new FoldKit, React,
 * or DOM view consumes these values instead of rediscovering labels, keyboard
 * meaning, or accessibility names from event handlers.
 */
export const deliveryPlaybackViewContract = {
  groupLabel: "Delivery playback controls",
  help: "Frame = adjacent production publication · Jump = frontier wave, held-position change, restart, or end · Live = follow newest · Keys: ←/→ and [/].",
  nextFrame: { accessibleName: "Next frame", label: "Frame →", shortcut: "ArrowRight" },
  nextLandmark: { accessibleName: "Next delivery landmark", label: "Jump →", shortcut: "]" },
  previousFrame: { accessibleName: "Previous frame", label: "← Frame", shortcut: "ArrowLeft" },
  previousLandmark: { accessibleName: "Previous delivery landmark", label: "← Jump", shortcut: "[" },
  followLive: { accessibleName: "Follow live", activeLabel: "Live: on", label: "Live" },
  frameSelectorLabel: "Delivery frame",
  statusLabel: "Delivery playback position"
} as const

/** Zero-based position of one captured delivery publication in the Lab timeline. */
export const DeliveryFrameIndex = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("DeliveryFrameIndex")
)
export type DeliveryFrameIndex = typeof DeliveryFrameIndex.Type

/** Why one production publication is useful as a semantic playback stop. */
export const DeliveryLandmark = Schema.Union([
  ts("InitialPublication"),
  ts("CoordinatorRestart", { activationOrdinal: AuthoredRunActivationOrdinal }),
  ts("EligibleFrontierWave", { taskIds: Schema.NonEmptyArray(TaskId) }),
  ts("HeldPositionsChanged", { taskIds: Schema.Array(TaskId) }),
  ts("TerminalPublication")
])
export type DeliveryLandmark = typeof DeliveryLandmark.Type

/** Framework-neutral facts needed to derive playback stops from production frames. */
export interface DeliveryPlaybackFrameInput {
  readonly activationOrdinal: AuthoredRunActivationOrdinalType
  readonly capacity: number
  readonly eligibleTaskIds: ReadonlyArray<TaskIdType>
  readonly heldTaskIds: ReadonlyArray<TaskIdType>
  readonly label: string
}

/** Display-ready identity and semantic landmarks for one delivery publication. */
export const DeliveryPlaybackFrame = Schema.Struct({
  label: Schema.NonEmptyString,
  landmarks: Schema.Array(DeliveryLandmark)
})
export type DeliveryPlaybackFrame = typeof DeliveryPlaybackFrame.Type

const frontierIdentity = (taskIds: ReadonlyArray<string>): string | undefined =>
  taskIds.length === 0 ? undefined : JSON.stringify(taskIds.toSorted())

/**
 * Derives the stable stops promised by Jump: initial publication, coordinator
 * restart, stable non-empty frontier wave, and settled terminal publication.
 */
export const deliveryPlaybackFramesFrom = (
  inputs: ReadonlyArray<DeliveryPlaybackFrameInput>,
  running: boolean
): ReadonlyArray<DeliveryPlaybackFrame> => {
  let lastFrontier = inputs[0] === undefined ? undefined : frontierIdentity(inputs[0].eligibleTaskIds)
  return inputs.map((input, index) => {
    const landmarks: Array<DeliveryLandmark> = []
    if (index === 0) landmarks.push({ _tag: "InitialPublication" })
    const previous = inputs[index - 1]
    if (previous !== undefined && previous.activationOrdinal !== input.activationOrdinal) {
      landmarks.push({ _tag: "CoordinatorRestart", activationOrdinal: input.activationOrdinal })
    } else if (index > 0) {
      const frontier = frontierIdentity(input.eligibleTaskIds)
      const nextFrontier = inputs[index + 1] === undefined
        ? undefined
        : frontierIdentity(inputs[index + 1]?.eligibleTaskIds ?? [])
      if (frontier !== undefined && frontier !== lastFrontier && frontier === nextFrontier) {
        const sortedTaskIds = input.eligibleTaskIds.toSorted()
        const firstTaskId = sortedTaskIds[0]
        if (firstTaskId !== undefined) {
          landmarks.push({
            _tag: "EligibleFrontierWave",
            taskIds: [firstTaskId, ...sortedTaskIds.slice(1)]
          })
        }
        lastFrontier = frontier
      }
    }
    const heldChanged = previous !== undefined
      && JSON.stringify(previous.heldTaskIds.toSorted()) !== JSON.stringify(input.heldTaskIds.toSorted())
    const fullCapacityReached = input.capacity > 0 && input.heldTaskIds.length === input.capacity
    const oneHolderRemainsAfterRelease = previous !== undefined
      && input.heldTaskIds.length > 0
      && input.heldTaskIds.length < previous.heldTaskIds.length
    if (heldChanged && (fullCapacityReached || oneHolderRemainsAfterRelease)) {
      landmarks.push({ _tag: "HeldPositionsChanged", taskIds: input.heldTaskIds.toSorted() })
    }
    if (!running && index === inputs.length - 1) landmarks.push({ _tag: "TerminalPublication" })
    return DeliveryPlaybackFrame.make({ label: input.label, landmarks })
  })
}

/** The Lab either follows the newest publication or inspects one exact historical publication. */
const FollowingLive = ts("FollowingLive")
const InspectingFrame = ts("InspectingFrame", { frameIndex: DeliveryFrameIndex })
export const DeliveryPlaybackPosition = Schema.Union([FollowingLive, InspectingFrame])
export type DeliveryPlaybackPosition = typeof DeliveryPlaybackPosition.Type

/** The task whose graph node and exact delivery facts the maintainer is correlating. */
const NoTaskSelected = ts("NoTaskSelected")
const TaskSelected = ts("TaskSelected", { taskId: TaskId })
export const DeliveryTaskSelection = Schema.Union([NoTaskSelected, TaskSelected])
export type DeliveryTaskSelection = typeof DeliveryTaskSelection.Type

const EmptyDeliveryPlayback = ts("EmptyDeliveryPlayback", {
  running: Schema.Boolean,
  taskSelection: DeliveryTaskSelection
})
const PopulatedDeliveryPlaybackShape = ts("PopulatedDeliveryPlayback", {
  frames: Schema.NonEmptyArray(DeliveryPlaybackFrame),
  position: DeliveryPlaybackPosition,
  running: Schema.Boolean,
  taskSelection: DeliveryTaskSelection
})
const PopulatedDeliveryPlayback = PopulatedDeliveryPlaybackShape.check(
  Schema.makeFilter((model: typeof PopulatedDeliveryPlaybackShape.Type) =>
    model.position._tag === "InspectingFrame" && model.position.frameIndex >= model.frames.length
      ? "the inspected delivery frame must exist in the populated timeline"
      : undefined)
)

/**
 * Framework-neutral playback state. Empty timelines cannot inspect a frame;
 * populated timelines cannot retain an index outside their exact frame set.
 */
export const DeliveryPlaybackModel = Schema.Union([EmptyDeliveryPlayback, PopulatedDeliveryPlayback])
export type DeliveryPlaybackModel = typeof DeliveryPlaybackModel.Type

export const PlaybackNavigationSource = Schema.Literals(["PlaybackControl", "WorkbenchShortcut"])
export type PlaybackNavigationSource = typeof PlaybackNavigationSource.Type

export const PreviousFrameRequested = m("PreviousFrameRequested", {
  source: PlaybackNavigationSource
})
export const NextFrameRequested = m("NextFrameRequested", {
  source: PlaybackNavigationSource
})
export const PreviousLandmarkRequested = m("PreviousLandmarkRequested", {
  source: PlaybackNavigationSource
})
export const NextLandmarkRequested = m("NextLandmarkRequested", {
  source: PlaybackNavigationSource
})
export const ExactFrameSelected = m("ExactFrameSelected", { frameIndex: DeliveryFrameIndex })
export const FollowLiveRequested = m("FollowLiveRequested")
export const TaskSelectedRequested = m("TaskSelectedRequested", { taskId: TaskId })
export const PlaybackRunStarted = m("PlaybackRunStarted")
export const FramesUpdated = m("FramesUpdated", {
  frames: Schema.Array(DeliveryPlaybackFrame),
  running: Schema.Boolean
})
export const DeliveryPlaybackMessage = Schema.Union([
  PreviousFrameRequested,
  NextFrameRequested,
  PreviousLandmarkRequested,
  NextLandmarkRequested,
  ExactFrameSelected,
  FollowLiveRequested,
  TaskSelectedRequested,
  PlaybackRunStarted,
  FramesUpdated
])
export type DeliveryPlaybackMessage = typeof DeliveryPlaybackMessage.Type

/** One executable registry binds declared shortcuts to their pure messages. */
export const deliveryPlaybackShortcutMessage = (key: string): DeliveryPlaybackMessage | null => {
  switch (key) {
    case deliveryPlaybackViewContract.previousFrame.shortcut:
      return PreviousFrameRequested({ source: "WorkbenchShortcut" })
    case deliveryPlaybackViewContract.nextFrame.shortcut:
      return NextFrameRequested({ source: "WorkbenchShortcut" })
    case deliveryPlaybackViewContract.previousLandmark.shortcut:
      return PreviousLandmarkRequested({ source: "WorkbenchShortcut" })
    case deliveryPlaybackViewContract.nextLandmark.shortcut:
      return NextLandmarkRequested({ source: "WorkbenchShortcut" })
    default:
      return null
  }
}

/** Browser adapters interpret this command by focusing the persistent playback group. */
export const FocusDeliveryPlaybackControls = ts("FocusDeliveryPlaybackControls")
export type DeliveryPlaybackCommand = typeof FocusDeliveryPlaybackControls.Type

export const makeDeliveryPlaybackModel = (
  frames: ReadonlyArray<DeliveryPlaybackFrame> = [],
  running = false
): DeliveryPlaybackModel => {
  const firstFrame = frames[0]
  return firstFrame === undefined
    ? EmptyDeliveryPlayback({ running, taskSelection: NoTaskSelected() })
    : PopulatedDeliveryPlayback.make({
      frames: [firstFrame, ...frames.slice(1)],
      position: FollowingLive(),
      running,
      taskSelection: NoTaskSelected()
  })
}

const currentFrameIndex = (model: DeliveryPlaybackModel): DeliveryFrameIndex | null => {
  if (model._tag === "EmptyDeliveryPlayback") return null
  if (model.position._tag === "FollowingLive") return DeliveryFrameIndex.make(model.frames.length - 1)
  return model.position.frameIndex
}

const landmarkIndexes = (model: DeliveryPlaybackModel): ReadonlyArray<DeliveryFrameIndex> =>
  model._tag === "EmptyDeliveryPlayback"
    ? []
    : model.frames.flatMap((frame, index) => frame.landmarks.length === 0 ? [] : [DeliveryFrameIndex.make(index)])

const landmarkLabel = (landmarks: ReadonlyArray<DeliveryLandmark>): string | null => {
  if (landmarks.length === 0) return null
  return landmarks.map((landmark) =>
    Match.value(landmark).pipe(
      Match.tagsExhaustive({
        CoordinatorRestart: ({ activationOrdinal }) => `coordinator restart into activation ${activationOrdinal}`,
        EligibleFrontierWave: ({ taskIds }) => `eligible frontier ${taskIds.join("+")}`,
        HeldPositionsChanged: ({ taskIds }) =>
          taskIds.length === 0
            ? "all task-work positions released"
            : `held task-work positions ${taskIds.join("+")}`,
        InitialPublication: () => "initial publication",
        TerminalPublication: () => "settled terminal publication"
      })
    )).join("; ")
}

export interface DeliveryPlaybackFrameOption {
  readonly frameIndex: DeliveryFrameIndex
  readonly label: string
  readonly landmarkLabel: string | null
  readonly selected: boolean
}

/** Everything a FoldKit, React, or DOM view needs to render playback without inferring behavior. */
export interface DeliveryPlaybackProjection {
  readonly currentFrameIndex: DeliveryFrameIndex | null
  readonly followingLive: boolean
  readonly frameOptions: ReadonlyArray<DeliveryPlaybackFrameOption>
  readonly landmarkIndexes: ReadonlyArray<DeliveryFrameIndex>
  readonly nextFrameAvailable: boolean
  readonly nextLandmarkAvailable: boolean
  readonly previousFrameAvailable: boolean
  readonly previousLandmarkAvailable: boolean
  readonly status: string
  readonly selectedTaskId: TaskIdType | null
}

export const projectDeliveryPlayback = (model: DeliveryPlaybackModel): DeliveryPlaybackProjection => {
  const selectedIndex = currentFrameIndex(model)
  const frames = model._tag === "EmptyDeliveryPlayback" ? [] : model.frames
  const landmarks = landmarkIndexes(model)
  const previousFrameAvailable = selectedIndex !== null && selectedIndex > 0
  const nextFrameAvailable = selectedIndex !== null && selectedIndex < frames.length - 1
  const previousLandmarkAvailable = selectedIndex !== null && landmarks.some((index) => index < selectedIndex)
  const nextLandmarkAvailable = selectedIndex !== null && landmarks.some((index) => index > selectedIndex)
  const status = selectedIndex === null
    ? `0 / 0 · ${model.running ? "running · waiting for first frame" : "settled · no frames"}`
    : `${selectedIndex + 1} / ${frames.length} · ${model.running ? "running" : "settled"}`
      + `${model._tag === "PopulatedDeliveryPlayback" && model.position._tag === "FollowingLive"
        ? " · live"
        : ` · history · ${frames.length - selectedIndex - 1} newer`}`
  return {
    currentFrameIndex: selectedIndex,
    followingLive: model._tag === "PopulatedDeliveryPlayback" && model.position._tag === "FollowingLive",
    frameOptions: frames.map((frame, index) => ({
      frameIndex: DeliveryFrameIndex.make(index),
      label: frame.label,
      landmarkLabel: landmarkLabel(frame.landmarks),
      selected: selectedIndex === index
    })),
    landmarkIndexes: landmarks,
    nextFrameAvailable,
    nextLandmarkAvailable,
    previousFrameAvailable,
    previousLandmarkAvailable,
    status,
    selectedTaskId: model.taskSelection._tag === "TaskSelected" ? model.taskSelection.taskId : null
  }
}

export type DeliveryPlaybackUpdate = readonly [DeliveryPlaybackModel, ReadonlyArray<DeliveryPlaybackCommand>]

const playbackUpdate = (
  model: DeliveryPlaybackModel,
  commands: ReadonlyArray<DeliveryPlaybackCommand> = []
): DeliveryPlaybackUpdate => [model, commands]

const inspect = (
  model: typeof PopulatedDeliveryPlayback.Type,
  frameIndex: DeliveryFrameIndex
): DeliveryPlaybackModel => ({
  ...model,
  position: InspectingFrame({ frameIndex })
})

const focusWhenControlBecameUnavailable = (
  source: PlaybackNavigationSource,
  available: boolean
): ReadonlyArray<DeliveryPlaybackCommand> =>
  source === "PlaybackControl" && !available ? [FocusDeliveryPlaybackControls()] : []

const moveTo = (
  model: DeliveryPlaybackModel,
  target: DeliveryFrameIndex | undefined,
  source: PlaybackNavigationSource,
  remainsAvailable: (projection: DeliveryPlaybackProjection) => boolean
): DeliveryPlaybackUpdate => {
  if (target === undefined || model._tag === "EmptyDeliveryPlayback") return [model, []]
  const next = inspect(model, target)
  return [next, focusWhenControlBecameUnavailable(source, remainsAvailable(projectDeliveryPlayback(next)))]
}

/** Pure Elm-style transition. Commands describe effects; this function never touches the DOM. */
export const updateDeliveryPlayback = (
  model: DeliveryPlaybackModel,
  message: DeliveryPlaybackMessage
): DeliveryPlaybackUpdate => {
  const projection = projectDeliveryPlayback(model)
  const selectedIndex = projection.currentFrameIndex
  return Match.value(message).pipe(
    Match.tagsExhaustive({
      ExactFrameSelected: ({ frameIndex }) =>
        model._tag === "EmptyDeliveryPlayback" || frameIndex >= model.frames.length
          ? playbackUpdate(model)
          : playbackUpdate(inspect(model, frameIndex)),
      FollowLiveRequested: () =>
        model._tag === "EmptyDeliveryPlayback"
          ? playbackUpdate(model)
          : playbackUpdate({ ...model, position: FollowingLive() }),
      PlaybackRunStarted: () => playbackUpdate(makeDeliveryPlaybackModel([], true)),
      FramesUpdated: ({ frames, running }) => {
        const firstFrame = frames[0]
        if (firstFrame === undefined) {
          return playbackUpdate(EmptyDeliveryPlayback({ running, taskSelection: model.taskSelection }))
        }
        const position = model._tag === "EmptyDeliveryPlayback" || model.position._tag === "FollowingLive"
          ? FollowingLive()
          : InspectingFrame({
            frameIndex: DeliveryFrameIndex.make(Math.min(model.position.frameIndex, frames.length - 1))
          })
        return playbackUpdate(PopulatedDeliveryPlayback.make({
          frames: [firstFrame, ...frames.slice(1)],
          position,
          running,
          taskSelection: model.taskSelection
        }))
      },
      NextFrameRequested: ({ source }) =>
        selectedIndex === null || !projection.nextFrameAvailable
          ? playbackUpdate(model)
          : moveTo(model, DeliveryFrameIndex.make(selectedIndex + 1), source, (next) => next.nextFrameAvailable),
      NextLandmarkRequested: ({ source }) => {
        const target = selectedIndex === null
          ? undefined
          : projection.landmarkIndexes.find((index) => index > selectedIndex)
        return moveTo(model, target, source, (next) => next.nextLandmarkAvailable)
      },
      PreviousFrameRequested: ({ source }) =>
        selectedIndex === null || !projection.previousFrameAvailable
          ? playbackUpdate(model)
          : moveTo(model, DeliveryFrameIndex.make(selectedIndex - 1), source, (next) => next.previousFrameAvailable),
      PreviousLandmarkRequested: ({ source }) => {
        const target = selectedIndex === null
          ? undefined
          : projection.landmarkIndexes.filter((index) => index < selectedIndex).at(-1)
        return moveTo(model, target, source, (next) => next.previousLandmarkAvailable)
      },
      TaskSelectedRequested: ({ taskId }) => playbackUpdate({ ...model, taskSelection: TaskSelected({ taskId }) })
    })
  )
}
