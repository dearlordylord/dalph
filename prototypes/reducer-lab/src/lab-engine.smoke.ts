import { Effect } from "effect"
import {
  executeLabCommand,
  executeLabMove,
  type LabAction,
  type LabMoveId,
  type LabSnapshot,
  reconstructLabSnapshot
} from "./lab-engine.ts"
import { presentLab } from "./lab-presenter.ts"
import { type Model, update, view } from "./main.ts"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const reconstruct = (actions: LabSnapshot["input"]["actions"]) =>
  Effect.runPromise(reconstructLabSnapshot({ actions }))

const availableMoveId = (
  snapshot: LabSnapshot,
  transition: string,
  taskId?: string
): LabMoveId => {
  const candidate = snapshot.moves.find((move) =>
    move.transition === transition
    && move.availability._tag === "Available"
    && (taskId === undefined || (
      move.subject._tag === "Task" && move.subject.taskId === taskId
    ))
  )
  if (candidate === undefined) throw new Error(`Missing available ${transition} move`)
  return candidate.id
}

const executeCommand = (snapshot: LabSnapshot, input: LabAction) =>
  Effect.runPromise(executeLabCommand(snapshot, input, snapshot.revision))

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
assert(initial.latestObservation.length === 0, "Initial state must have no observed tasks")
assert(initial.trackerTasks.length === 4, "Initial controlled tracker must contain A–D")
assert(initial.authorityIssues.length === 0, "Initial tracker authority must be valid")
assertPresenterParity(initial)

const initialModel: Model = {
  activeBranchId: 1,
  branches: [{ actions: [], cursor: 0, id: 1, name: "main" }],
  editorError: null,
  graphSelection: "Auto",
  interactionError: null,
  nextBranchId: 2,
  requestId: 1,
  selectedTaskId: null,
  snapshot: initial,
  taskDraft: null,
  viewModel: presentLab(initial)
}
const [editingModel] = update(initialModel, {
  _tag: "StartedEditingTask",
  taskId: "B"
})
assert(editingModel.taskDraft?.id === "B", "FoldKit Model must own the task-card draft")
const rendered = view(editingModel)
assert(rendered.title === "Dalph reducer lab", "The complete graph-editor view must render")

const observation = await Effect.runPromise(executeLabMove(
  initial,
  availableMoveId(initial, "ObserveTrackerTarget"),
  initial.revision
))
assert(observation.snapshot.latestObservation.length === 4, "Observation must reveal A–D")
assert(observation.snapshot.journal.length === 2, "Success must append intent and outcome")
assert(observation.snapshot.frontier.some(({ taskId }) => taskId === "A"), "A must be runnable")
assert(observation.snapshot.frontier.some(({ taskId }) => taskId === "C"), "C must be runnable")
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
  availableMoveId(observation.snapshot, "CommitFreshTaskClaimIntent", "A"),
  observation.snapshot.revision
))
assert(claim.snapshot.responsibilities.length === 1, "Claim intent must create responsibility")
assert(
  claim.snapshot.moves.some(({ transition, availability }) =>
    transition === "RecordTaskAttemptPlan" && availability._tag === "Available"
  ),
  "The production attempt-plan stage must be reachable after claim selection"
)
assertPresenterParity(claim.snapshot)

let completedWorkflow = claim.snapshot
for (const operation of [
  "RecordTaskAttemptPlan",
  "ReconcileTaskWorktree",
  "EstablishTaskWorkSession",
  "StartExecutorInvocation",
  "StartExecutorInvocation",
  "StartExecutorInvocation",
  "StartExecutorInvocation"
] as const) {
  const execution = await Effect.runPromise(executeLabMove(
    completedWorkflow,
    availableMoveId(completedWorkflow, operation, "A"),
    completedWorkflow.revision
  ))
  completedWorkflow = execution.snapshot
}
assert(
  completedWorkflow.workflowProgress[0]?.completedOperations.length === 8,
  "The Lab must reach the complete production path through opaque executor invocations"
)
assert(
  completedWorkflow.workflowProgress[0]?.nextOperation === null,
  "The production-parity path must stop after the selected executor completes"
)
assertPresenterParity(completedWorkflow)

const editedB = await executeCommand(initial, {
  _tag: "ReplacedTrackerTask",
  task: {
    body: "Invalid until the missing endpoint is created.",
    id: "B",
    lifecycle: "Open",
    parentTaskId: null,
    prerequisiteIds: ["missing", "missing"],
    title: "Build B"
  }
})
assert(
  editedB.snapshot.authorityIssues.some((issue) => issue.startsWith("Duplicate prerequisite")),
  "Raw duplicate edges must remain visible in controlled authority"
)
assert(
  editedB.snapshot.authorityIssues.some((issue) => issue.startsWith("Missing prerequisite")),
  "Missing endpoints must remain visible in controlled authority"
)
assert(
  editedB.snapshot.latestObservation.length === 0,
  "Saving a task must not silently observe authority"
)

const failedObservation = await Effect.runPromise(executeLabMove(
  editedB.snapshot,
  availableMoveId(editedB.snapshot, "ObserveTrackerTarget"),
  editedB.snapshot.revision
))
assert(
  failedObservation.snapshot.observationAttempt._tag === "Failed",
  "Invalid topology must fail at the real TaskDag projection boundary"
)
assert(
  failedObservation.snapshot.journal.length === 1,
  "A failed observation must record intent but no successful outcome"
)
assert(
  failedObservation.snapshot.latestObservation.length === 0,
  "A failed first read must not manufacture a successful observation"
)
assert(failedObservation.snapshot.graphKnowledge.length === 0, "Failed read must add no durable facts")

const endpointAdded = await executeCommand(failedObservation.snapshot, {
  _tag: "ReplacedTrackerTask",
  task: {
    body: "Repairs B's missing endpoint.",
    id: "missing",
    lifecycle: "CompletedSuccessfully",
    parentTaskId: null,
    prerequisiteIds: [],
    title: "Recovered prerequisite"
  }
})
const repaired = await executeCommand(endpointAdded.snapshot, {
  _tag: "ReplacedTrackerTask",
  task: {
    body: "Invalid edges repaired.",
    id: "B",
    lifecycle: "Open",
    parentTaskId: null,
    prerequisiteIds: ["missing"],
    title: "Build B"
  }
})
const repairedObservation = await Effect.runPromise(executeLabMove(
  repaired.snapshot,
  availableMoveId(repaired.snapshot, "ObserveTrackerTarget"),
  repaired.snapshot.revision
))
assert(
  repairedObservation.snapshot.observationAttempt._tag === "Succeeded",
  "A repaired authority must become observable after a prior typed failure"
)
assert(
  repairedObservation.snapshot.status !== "InvalidManagedHistory",
  "Retry after a typed graph failure must preserve valid managed history"
)

const claimed = await executeCommand(initial, {
  _tag: "SetTrackerClaim",
  state: "Foreign",
  taskId: "A"
})
assert(
  claimed.snapshot.trackerClaims.find(({ taskId }) => taskId === "A")?.state === "Foreign",
  "Claim control must update the separate fake tracker claim"
)
assert(claimed.snapshot.trackerTasks.length === 4, "Claim control must not edit graph records")

const completedActions: Array<LabAction> = initial.trackerTasks
  .filter(({ lifecycle }) => lifecycle === "Open")
  .map((task) => ({
    _tag: "ReplacedTrackerTask" as const,
    task: { ...task, lifecycle: "CompletedSuccessfully" as const }
  }))
const completed = await reconstruct([
  ...completedActions,
  { _tag: "ObservedTrackerGraph" },
  { _tag: "ChangedTargetSettlement", settled: true }
])
assert(completed.frontier.length === 0, "Completed graph must have no runnable work")
assert(completed.finalityTag === "RunMayTerminate", "Settled empty frontier may terminate")

const staleResult = await Effect.runPromise(
  executeLabMove(
    initial,
    availableMoveId(initial, "ObserveTrackerTarget"),
    observation.snapshot.revision
  ).pipe(Effect.flip)
)
assert(staleResult._tag === "StaleLabSnapshot", "Mismatched revision must reject the move")
