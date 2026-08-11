import { strict as assert } from "node:assert"
import { Schema } from "effect"
import { TaskId } from "../../../packages/contracts/src/task-identity.ts"
import { AuthoredRunActivationOrdinal } from "../../../packages/dalph/src/cassettes/authored-domain.ts"
import {
  DeliveryFrameIndex,
  deliveryPlaybackShortcutMessage,
  deliveryPlaybackViewContract,
  deliveryPlaybackFramesFrom,
  DeliveryPlaybackModel,
  ExactFrameSelected,
  FollowLiveRequested,
  FramesUpdated,
  makeDeliveryPlaybackModel,
  NextFrameRequested,
  NextLandmarkRequested,
  PlaybackRunStarted,
  PreviousFrameRequested,
  PreviousLandmarkRequested,
  projectDeliveryPlayback,
  TaskSelectedRequested,
  updateDeliveryPlayback
} from "./delivery-playback.ts"

const frame = (
  activationOrdinal: number,
  eligibleTaskIds: ReadonlyArray<string>,
  label: string,
  heldTaskIds: ReadonlyArray<string> = []
) => ({
  activationOrdinal: AuthoredRunActivationOrdinal.make(activationOrdinal),
  capacity: 2,
  eligibleTaskIds: eligibleTaskIds.map((taskId) => TaskId.make(taskId)),
  heldTaskIds: heldTaskIds.map((taskId) => TaskId.make(taskId)),
  label
})

const frames = deliveryPlaybackFramesFrom([
  frame(1, ["A"], "1. initial"),
  frame(1, ["B", "C"], "2. frontier B+C begins"),
  frame(1, ["B", "C"], "3. stable frontier B+C"),
  frame(2, [], "4. restart and terminal")
], false)

const following = makeDeliveryPlaybackModel(frames, false)

{
  const [reset] = updateDeliveryPlayback(following, PlaybackRunStarted.make({}))
  assert.equal(reset._tag, "EmptyDeliveryPlayback")
  assert.equal(reset.running, true)
  assert.equal(projectDeliveryPlayback(reset).selectedTaskId, null)
}

{
  const staggered = deliveryPlaybackFramesFrom([
    frame(1, ["B", "C"], "B admitted", ["B"]),
    frame(1, ["B", "C"], "B and C admitted", ["B", "C"]),
    frame(1, ["B", "C"], "B released", ["C"]),
    frame(1, ["B", "C"], "C released")
  ], true)
  assert.deepEqual(
    staggered.map(({ landmarks }) => landmarks.flatMap((landmark) =>
      landmark._tag === "HeldPositionsChanged" ? [landmark.taskIds.join("+")] : []
    )),
    [[], ["B+C"], ["C"], []]
  )
}

assert.deepEqual(deliveryPlaybackViewContract, {
  groupLabel: "Delivery playback controls",
  help: "Frame = adjacent production publication · Jump = frontier wave, held-position change, restart, or end · Live = follow newest · Keys: ←/→ and [/].",
  nextFrame: { accessibleName: "Next frame", label: "Frame →", shortcut: "ArrowRight" },
  nextLandmark: { accessibleName: "Next delivery landmark", label: "Jump →", shortcut: "]" },
  previousFrame: { accessibleName: "Previous frame", label: "← Frame", shortcut: "ArrowLeft" },
  previousLandmark: { accessibleName: "Previous delivery landmark", label: "← Jump", shortcut: "[" },
  followLive: { accessibleName: "Follow live", activeLabel: "Live: on", label: "Live" },
  frameSelectorLabel: "Delivery frame",
  statusLabel: "Delivery playback position"
})
assert.equal(deliveryPlaybackShortcutMessage("ArrowLeft")?._tag, "PreviousFrameRequested")
assert.equal(deliveryPlaybackShortcutMessage("ArrowRight")?._tag, "NextFrameRequested")
assert.equal(deliveryPlaybackShortcutMessage("[")?._tag, "PreviousLandmarkRequested")
assert.equal(deliveryPlaybackShortcutMessage("]")?._tag, "NextLandmarkRequested")
assert.equal(deliveryPlaybackShortcutMessage("Enter"), null)

const decodedEmpty = Schema.decodeUnknownSync(DeliveryPlaybackModel)({
  _tag: "EmptyDeliveryPlayback",
  frames: [],
  position: { _tag: "InspectingFrame", frameIndex: 0 },
  running: false,
  taskSelection: { _tag: "NoTaskSelected" }
})
assert.equal(decodedEmpty._tag, "EmptyDeliveryPlayback")
assert.equal("position" in decodedEmpty, false)
assert.throws(() => Schema.decodeUnknownSync(DeliveryPlaybackModel)({
  _tag: "PopulatedDeliveryPlayback",
  frames,
  position: { _tag: "InspectingFrame", frameIndex: frames.length },
  running: false,
  taskSelection: { _tag: "NoTaskSelected" }
}))

{
  const projection = projectDeliveryPlayback(following)
  assert.equal(projection.currentFrameIndex, 3)
  assert.equal(projection.followingLive, true)
  assert.deepEqual(projection.landmarkIndexes, [0, 1, 3])
  assert.equal(projection.nextFrameAvailable, false)
  assert.equal(projection.selectedTaskId, null)
  assert.equal(projection.status, "4 / 4 · settled · live")
  assert.deepEqual(projection.frameOptions.map(({ label, landmarkLabel, selected }) => ({
    label,
    landmarkLabel,
    selected
  })), [
    { label: "1. initial", landmarkLabel: "initial publication", selected: false },
    { label: "2. frontier B+C begins", landmarkLabel: "eligible frontier B+C", selected: false },
    { label: "3. stable frontier B+C", landmarkLabel: null, selected: false },
    {
      label: "4. restart and terminal",
      landmarkLabel: "coordinator restart into activation 2; settled terminal publication",
      selected: true
    }
  ])
}

{
  const [selected] = updateDeliveryPlayback(
    following,
    TaskSelectedRequested.make({ taskId: TaskId.make("B") })
  )
  assert.equal(projectDeliveryPlayback(selected).selectedTaskId, "B")
  const [updated] = updateDeliveryPlayback(
    selected,
    FramesUpdated.make({ frames, running: false })
  )
  assert.equal(projectDeliveryPlayback(updated).selectedTaskId, "B")
}

{
  const [nearFirst] = updateDeliveryPlayback(
    following,
    ExactFrameSelected.make({ frameIndex: DeliveryFrameIndex.make(1) })
  )
  const [endpoint, commands] = updateDeliveryPlayback(
    nearFirst,
    PreviousFrameRequested.make({ source: "PlaybackControl" })
  )
  assert.equal(projectDeliveryPlayback(endpoint).currentFrameIndex, 0)
  assert.deepEqual(commands.map(({ _tag }) => _tag), ["FocusDeliveryPlaybackControls"])
  const [away, awayCommands] = updateDeliveryPlayback(
    endpoint,
    NextFrameRequested.make({ source: "WorkbenchShortcut" })
  )
  assert.equal(projectDeliveryPlayback(away).currentFrameIndex, 1)
  assert.deepEqual(awayCommands, [])
}

{
  const [penultimate] = updateDeliveryPlayback(
    following,
    ExactFrameSelected.make({ frameIndex: DeliveryFrameIndex.make(2) })
  )
  const [endpoint, commands] = updateDeliveryPlayback(
    penultimate,
    NextFrameRequested.make({ source: "PlaybackControl" })
  )
  assert.equal(projectDeliveryPlayback(endpoint).currentFrameIndex, 3)
  assert.deepEqual(commands.map(({ _tag }) => _tag), ["FocusDeliveryPlaybackControls"])
}

{
  const [middle] = updateDeliveryPlayback(
    following,
    ExactFrameSelected.make({ frameIndex: DeliveryFrameIndex.make(2) })
  )
  const [nonEndpoint, commands] = updateDeliveryPlayback(
    middle,
    PreviousFrameRequested.make({ source: "PlaybackControl" })
  )
  assert.equal(projectDeliveryPlayback(nonEndpoint).currentFrameIndex, 1)
  assert.deepEqual(commands, [], "A control that remains available must retain its own focus")
}

{
  const [first] = updateDeliveryPlayback(
    following,
    ExactFrameSelected.make({ frameIndex: DeliveryFrameIndex.make(0) })
  )
  const [nextLandmark] = updateDeliveryPlayback(
    first,
    NextLandmarkRequested.make({ source: "WorkbenchShortcut" })
  )
  assert.equal(projectDeliveryPlayback(nextLandmark).currentFrameIndex, 1)
  const [lastLandmark, commands] = updateDeliveryPlayback(
    nextLandmark,
    NextLandmarkRequested.make({ source: "PlaybackControl" })
  )
  assert.equal(projectDeliveryPlayback(lastLandmark).currentFrameIndex, 3)
  assert.deepEqual(commands.map(({ _tag }) => _tag), ["FocusDeliveryPlaybackControls"])
  const [firstLandmark, reverseCommands] = updateDeliveryPlayback(
    lastLandmark,
    PreviousLandmarkRequested.make({ source: "PlaybackControl" })
  )
  assert.equal(projectDeliveryPlayback(firstLandmark).currentFrameIndex, 1)
  assert.deepEqual(reverseCommands, [])
  const [initialLandmark, endpointCommands] = updateDeliveryPlayback(
    firstLandmark,
    PreviousLandmarkRequested.make({ source: "PlaybackControl" })
  )
  assert.equal(projectDeliveryPlayback(initialLandmark).currentFrameIndex, 0)
  assert.deepEqual(endpointCommands.map(({ _tag }) => _tag), ["FocusDeliveryPlaybackControls"])
}

{
  const [historical] = updateDeliveryPlayback(
    following,
    ExactFrameSelected.make({ frameIndex: DeliveryFrameIndex.make(1) })
  )
  const appended = deliveryPlaybackFramesFrom([
    frame(1, ["A"], "1. initial"),
    frame(1, ["B", "C"], "2. frontier B+C begins"),
    frame(1, ["B", "C"], "3. stable frontier B+C"),
    frame(2, [], "4. restart"),
    frame(2, ["D"], "5. later live frame")
  ], true)
  const [retained] = updateDeliveryPlayback(
    historical,
    FramesUpdated.make({ frames: appended, running: true })
  )
  assert.equal(projectDeliveryPlayback(retained).currentFrameIndex, 1)
  assert.equal(projectDeliveryPlayback(retained).status, "2 / 5 · running · history · 3 newer")
  const [live] = updateDeliveryPlayback(retained, FollowLiveRequested.make({}))
  assert.equal(projectDeliveryPlayback(live).currentFrameIndex, 4)
  const [followed] = updateDeliveryPlayback(
    live,
    FramesUpdated.make({
      frames: deliveryPlaybackFramesFrom([
        frame(1, ["A"], "1. initial"),
        frame(1, ["B", "C"], "2. frontier B+C begins"),
        frame(1, ["B", "C"], "3. stable frontier B+C"),
        frame(2, [], "4. restart"),
        frame(2, ["D"], "5. later live frame"),
        frame(2, ["D"], "6. newest")
      ], true),
      running: true
    })
  )
  assert.equal(projectDeliveryPlayback(followed).currentFrameIndex, 5)
}

{
  const empty = makeDeliveryPlaybackModel([], true)
  assert.equal(projectDeliveryPlayback(empty).status, "0 / 0 · running · waiting for first frame")
  const [unchanged, commands] = updateDeliveryPlayback(
    empty,
    PreviousFrameRequested.make({ source: "PlaybackControl" })
  )
  assert.equal(unchanged, empty)
  assert.deepEqual(commands, [])
}

console.log("✓ derives delivery playback controls, landmarks, and endpoint focus from one pure state machine")
