import { Effect } from "effect"
import {
  executeLabMove,
  type LabMoveId,
  type LabSnapshot,
  reconstructLabSnapshot
} from "./lab-engine.ts"
import { presentLab } from "./lab-presenter.ts"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const reconstruct = (actions: LabSnapshot["input"]["actions"]) =>
  Effect.runPromise(reconstructLabSnapshot({ actions }))

const availableMoveId = (snapshot: LabSnapshot, transition: string): LabMoveId => {
  const candidate = snapshot.moves.find((move) =>
    move.transition === transition && move.availability._tag === "Available"
  )
  if (candidate === undefined) throw new Error(`Missing available ${transition} move`)
  return candidate.id
}

const assertPresenterParity = (snapshot: LabSnapshot): void => {
  const displayed = presentLab(snapshot).actionGroups.flatMap(({ actions }) =>
    actions.map(({ moveId }) => moveId)
  )
  assert(displayed.length === snapshot.moves.length, "Presenter omitted or duplicated a move")
  assert(new Set(displayed).size === displayed.length, "Presenter emitted a move more than once")
  for (const move of snapshot.moves) {
    assert(displayed.includes(move.id), `Presenter omitted ${move.id}`)
  }
}

const initial = await reconstruct([])
assert(initial.knownTasks.length === 0, "Initial state must have no observed tasks")
assert(initial.trackerTasks.length === 4, "Initial controlled tracker must contain A–D")
assertPresenterParity(initial)

const observation = await Effect.runPromise(executeLabMove(
  initial,
  availableMoveId(initial, "ObserveTrackerTarget"),
  initial.revision
))
assert(observation.snapshot.knownTasks.length === 4, "Observation must reveal A–D")
assert(observation.snapshot.journal.length === 2, "Observation must append intent and outcome")
assertPresenterParity(observation.snapshot)

const capacityTwo = await Effect.runPromise(executeLabMove(
  observation.snapshot,
  availableMoveId(observation.snapshot, "SetTaskWorkCapacity"),
  observation.snapshot.revision
))
assert(capacityTwo.snapshot.capacity === 2, "Capacity move must reconstruct capacity two")
assert(capacityTwo.snapshot.admitted.length === 2, "Capacity two must admit A and C")
assertPresenterParity(capacityTwo.snapshot)

const claim = await Effect.runPromise(executeLabMove(
  observation.snapshot,
  availableMoveId(observation.snapshot, "CommitFreshTaskClaimIntent"),
  observation.snapshot.revision
))
assert(claim.snapshot.responsibilities.length === 1, "Claim intent must create responsibility")
assert(
  claim.snapshot.moves.some(({ availability }) => availability._tag === "DriverMissing"),
  "An unimplemented real frontier transition must remain visible"
)
assertPresenterParity(claim.snapshot)

const removeBMove = initial.moves.find((move) =>
  move.transition === "SetTrackerTaskPresence" &&
  move.subject._tag === "Task" &&
  move.subject.task === "B"
)
if (removeBMove === undefined) throw new Error("Missing tracker edit move for B")
const removeB = await Effect.runPromise(executeLabMove(
  initial,
  removeBMove.id,
  initial.revision
))
assert(!removeB.snapshot.trackerTasks.includes("B"), "Tracker edit must remove B immediately")
assert(removeB.snapshot.knownTasks.length === 0, "Tracker edit must not rewrite Dalph knowledge")
const observeWithoutB = await Effect.runPromise(executeLabMove(
  removeB.snapshot,
  availableMoveId(removeB.snapshot, "ObserveTrackerTarget"),
  removeB.snapshot.revision
))
assert(!observeWithoutB.snapshot.knownTasks.includes("B"), "Later observation must reveal B absent")
assertPresenterParity(observeWithoutB.snapshot)

const staleResult = await Effect.runPromise(
  executeLabMove(
    initial,
    availableMoveId(initial, "ObserveTrackerTarget"),
    observation.snapshot.revision
  ).pipe(Effect.flip)
)
assert(staleResult._tag === "StaleLabSnapshot", "Mismatched revision must reject the move")
