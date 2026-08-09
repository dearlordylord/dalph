import { Schema } from "effect"

/** Zero-based position of one captured delivery publication in the Lab timeline. */
export const DeliveryFrameIndex = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("DeliveryFrameIndex")
)
export type DeliveryFrameIndex = typeof DeliveryFrameIndex.Type

/** Display-ready identity and landmark classification for one delivery publication. */
export const DeliveryPlaybackFrame = Schema.Struct({
  label: Schema.NonEmptyString,
  landmark: Schema.Boolean
})
export type DeliveryPlaybackFrame = typeof DeliveryPlaybackFrame.Type

/** The Lab either follows the newest publication or inspects one exact historical publication. */
export const FollowingLive = Schema.TaggedStruct("FollowingLive", {})
export const InspectingFrame = Schema.TaggedStruct("InspectingFrame", { frameIndex: DeliveryFrameIndex })
export const DeliveryPlaybackPosition = Schema.Union([FollowingLive, InspectingFrame])
export type DeliveryPlaybackPosition = typeof DeliveryPlaybackPosition.Type

/** Framework-neutral playback state; every rendered value is projected from this model. */
export const DeliveryPlaybackModel = Schema.Struct({
  frames: Schema.Array(DeliveryPlaybackFrame),
  position: DeliveryPlaybackPosition,
  running: Schema.Boolean
})
export type DeliveryPlaybackModel = typeof DeliveryPlaybackModel.Type

export const PlaybackNavigationSource = Schema.Literals(["PlaybackControl", "WorkbenchShortcut"])
export type PlaybackNavigationSource = typeof PlaybackNavigationSource.Type

export const PreviousFrameRequested = Schema.TaggedStruct("PreviousFrameRequested", {
  source: PlaybackNavigationSource
})
export const NextFrameRequested = Schema.TaggedStruct("NextFrameRequested", {
  source: PlaybackNavigationSource
})
export const PreviousLandmarkRequested = Schema.TaggedStruct("PreviousLandmarkRequested", {
  source: PlaybackNavigationSource
})
export const NextLandmarkRequested = Schema.TaggedStruct("NextLandmarkRequested", {
  source: PlaybackNavigationSource
})
export const ExactFrameSelected = Schema.TaggedStruct("ExactFrameSelected", { frameIndex: DeliveryFrameIndex })
export const FollowLiveRequested = Schema.TaggedStruct("FollowLiveRequested", {})
export const FramesUpdated = Schema.TaggedStruct("FramesUpdated", {
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
  FramesUpdated
])
export type DeliveryPlaybackMessage = typeof DeliveryPlaybackMessage.Type

/** Browser adapters interpret this command by focusing the persistent playback group. */
export const FocusDeliveryPlaybackControls = Schema.TaggedStruct("FocusDeliveryPlaybackControls", {})
export type FocusDeliveryPlaybackControls = typeof FocusDeliveryPlaybackControls.Type
export type DeliveryPlaybackCommand = FocusDeliveryPlaybackControls

export const makeDeliveryPlaybackModel = (
  frames: ReadonlyArray<DeliveryPlaybackFrame> = [],
  running = false
): DeliveryPlaybackModel => DeliveryPlaybackModel.make({
  frames,
  position: FollowingLive.make({}),
  running
})

const currentFrameIndex = (model: DeliveryPlaybackModel): DeliveryFrameIndex | null => {
  if (model.frames.length === 0) return null
  if (model.position._tag === "FollowingLive") return DeliveryFrameIndex.make(model.frames.length - 1)
  return DeliveryFrameIndex.make(Math.min(model.position.frameIndex, model.frames.length - 1))
}

const landmarkIndexes = (model: DeliveryPlaybackModel): ReadonlyArray<DeliveryFrameIndex> => {
  if (model.frames.length === 0) return []
  const indexes = new Set<number>([0])
  for (const [index, frame] of model.frames.entries()) {
    if (frame.landmark) indexes.add(index)
  }
  if (!model.running) indexes.add(model.frames.length - 1)
  return [...indexes].toSorted((left, right) => left - right).map(DeliveryFrameIndex.make)
}

export interface DeliveryPlaybackFrameOption {
  readonly frameIndex: DeliveryFrameIndex
  readonly label: string
  readonly landmark: boolean
  readonly selected: boolean
}

/** Everything a FoldKit or React view needs to render playback without inferring behavior. */
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
}

export const projectDeliveryPlayback = (model: DeliveryPlaybackModel): DeliveryPlaybackProjection => {
  const selectedIndex = currentFrameIndex(model)
  const landmarks = landmarkIndexes(model)
  const previousFrameAvailable = selectedIndex !== null && selectedIndex > 0
  const nextFrameAvailable = selectedIndex !== null && selectedIndex < model.frames.length - 1
  const previousLandmarkAvailable = selectedIndex !== null && landmarks.some((index) => index < selectedIndex)
  const nextLandmarkAvailable = selectedIndex !== null && landmarks.some((index) => index > selectedIndex)
  const status = selectedIndex === null
    ? `0 / 0 · ${model.running ? "running · waiting for first frame" : "settled · no frames"}`
    : `${selectedIndex + 1} / ${model.frames.length} · ${model.running ? "running" : "settled"}`
      + `${model.position._tag === "FollowingLive"
        ? " · live"
        : ` · history · ${model.frames.length - selectedIndex - 1} newer`}`
  return {
    currentFrameIndex: selectedIndex,
    followingLive: model.position._tag === "FollowingLive",
    frameOptions: model.frames.map((frame, index) => ({
      frameIndex: DeliveryFrameIndex.make(index),
      label: frame.label,
      landmark: landmarks.some((landmark) => landmark === index),
      selected: selectedIndex === index
    })),
    landmarkIndexes: landmarks,
    nextFrameAvailable,
    nextLandmarkAvailable,
    previousFrameAvailable,
    previousLandmarkAvailable,
    status
  }
}

export type DeliveryPlaybackUpdate = readonly [DeliveryPlaybackModel, ReadonlyArray<DeliveryPlaybackCommand>]

const inspect = (
  model: DeliveryPlaybackModel,
  frameIndex: DeliveryFrameIndex
): DeliveryPlaybackModel => ({
  ...model,
  position: InspectingFrame.make({ frameIndex })
})

const focusWhenControlBecameUnavailable = (
  source: PlaybackNavigationSource,
  available: boolean
): ReadonlyArray<DeliveryPlaybackCommand> =>
  source === "PlaybackControl" && !available ? [FocusDeliveryPlaybackControls.make({})] : []

const moveTo = (
  model: DeliveryPlaybackModel,
  target: DeliveryFrameIndex | undefined,
  source: PlaybackNavigationSource,
  remainsAvailable: (projection: DeliveryPlaybackProjection) => boolean
): DeliveryPlaybackUpdate => {
  if (target === undefined) return [model, []]
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
  switch (message._tag) {
    case "PreviousFrameRequested":
      return selectedIndex === null || !projection.previousFrameAvailable
        ? [model, []]
        : moveTo(
          model,
          DeliveryFrameIndex.make(selectedIndex - 1),
          message.source,
          (next) => next.previousFrameAvailable
        )
    case "NextFrameRequested":
      return selectedIndex === null || !projection.nextFrameAvailable
        ? [model, []]
        : moveTo(
          model,
          DeliveryFrameIndex.make(selectedIndex + 1),
          message.source,
          (next) => next.nextFrameAvailable
        )
    case "PreviousLandmarkRequested": {
      const target = selectedIndex === null
        ? undefined
        : projection.landmarkIndexes.filter((index) => index < selectedIndex).at(-1)
      return moveTo(model, target, message.source, (next) => next.previousLandmarkAvailable)
    }
    case "NextLandmarkRequested": {
      const target = selectedIndex === null
        ? undefined
        : projection.landmarkIndexes.find((index) => index > selectedIndex)
      return moveTo(model, target, message.source, (next) => next.nextLandmarkAvailable)
    }
    case "ExactFrameSelected":
      return model.frames.length === 0
        ? [model, []]
        : [inspect(model, DeliveryFrameIndex.make(Math.min(message.frameIndex, model.frames.length - 1))), []]
    case "FollowLiveRequested":
      return [{ ...model, position: FollowingLive.make({}) }, []]
    case "FramesUpdated": {
      const frames = message.frames
      const position = frames.length === 0 || model.position._tag === "FollowingLive"
        ? FollowingLive.make({})
        : InspectingFrame.make({
          frameIndex: DeliveryFrameIndex.make(Math.min(model.position.frameIndex, frames.length - 1))
        })
      return [{ frames, position, running: message.running }, []]
    }
  }
}
