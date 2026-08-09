import { strict as assert } from "node:assert"
import {
  DeliveryFrameIndex,
  DeliveryPlaybackFrame,
  ExactFrameSelected,
  FollowLiveRequested,
  FramesUpdated,
  makeDeliveryPlaybackModel,
  NextFrameRequested,
  NextLandmarkRequested,
  PreviousFrameRequested,
  PreviousLandmarkRequested,
  projectDeliveryPlayback,
  updateDeliveryPlayback
} from "./delivery-playback.ts"

const frames = [
  DeliveryPlaybackFrame.make({ label: "1. initial", landmark: false }),
  DeliveryPlaybackFrame.make({ label: "2. repeated publication", landmark: false }),
  DeliveryPlaybackFrame.make({ label: "3. frontier B+C", landmark: true }),
  DeliveryPlaybackFrame.make({ label: "4. terminal", landmark: false })
]

const following = makeDeliveryPlaybackModel(frames, false)

{
  const projection = projectDeliveryPlayback(following)
  assert.equal(projection.currentFrameIndex, 3)
  assert.equal(projection.followingLive, true)
  assert.deepEqual(projection.landmarkIndexes, [0, 2, 3])
  assert.equal(projection.nextFrameAvailable, false)
  assert.equal(projection.status, "4 / 4 · settled · live")
  assert.deepEqual(projection.frameOptions.map(({ label, landmark, selected }) => ({ label, landmark, selected })), [
    { label: "1. initial", landmark: true, selected: false },
    { label: "2. repeated publication", landmark: false, selected: false },
    { label: "3. frontier B+C", landmark: true, selected: false },
    { label: "4. terminal", landmark: true, selected: true }
  ])
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
  assert.equal(projectDeliveryPlayback(nextLandmark).currentFrameIndex, 2)
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
  assert.equal(projectDeliveryPlayback(firstLandmark).currentFrameIndex, 2)
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
  const appended = [...frames, DeliveryPlaybackFrame.make({ label: "5. later live frame", landmark: true })]
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
      frames: [...appended, DeliveryPlaybackFrame.make({ label: "6. newest", landmark: false })],
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
