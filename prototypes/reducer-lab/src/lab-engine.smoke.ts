import { Effect, Option } from "effect"
import { Scene } from "foldkit/test"
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
import {
  dispositionCoverage,
  responsibilityCoverage,
  transitionCoverage,
  workflowJournalEventCoverage,
  workflowOperationCoverage
} from "./reducer-surface.ts"

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

const setBoundaryBehavior = (
  snapshot: LabSnapshot,
  behavior: Extract<LabAction, { readonly _tag: "ChangedBoundaryBehavior" }>["behavior"]
) => {
  const candidate = snapshot.moves.find((move) =>
    move.availability._tag === "Available"
    && move.availability.input._tag === "ChangedBoundaryBehavior"
    && move.availability.input.behavior === behavior
  )
  if (candidate === undefined) throw new Error(`Missing ${behavior} boundary control`)
  return Effect.runPromise(executeLabMove(snapshot, candidate.id, snapshot.revision))
}

const setTrackerTarget = (
  snapshot: LabSnapshot,
  target: Extract<LabAction, { readonly _tag: "ChangedTrackerTarget" }>["target"]
) => {
  const candidate = snapshot.moves.find((move) =>
    move.availability._tag === "Available"
    && move.availability.input._tag === "ChangedTrackerTarget"
    && move.availability.input.target === target
  )
  if (candidate === undefined) throw new Error(`Missing ${target} tracker-target control`)
  return Effect.runPromise(executeLabMove(snapshot, candidate.id, snapshot.revision))
}

const assertPresenterParity = (snapshot: LabSnapshot): void => {
  const displayed = presentLab(snapshot).actionGroups.flatMap(({ actions }) =>
    actions.map(({ moveId }) => moveId)
  )
  assert(displayed.length === snapshot.moves.length, "Presenter omitted or duplicated a move")
  assert(
    new Set(displayed).size === displayed.length,
    `Presenter emitted a move more than once: ${displayed.join(", ")}`
  )
  for (const move of snapshot.moves) {
    assert(displayed.includes(move.id), `Presenter omitted ${move.id}`)
  }
}

const initial = await reconstruct([])
assert(initial.latestObservation.length === 0, "Initial state must have no observed tasks")
assert(initial.trackerTasks.length === 4, "Initial controlled tracker must contain A–D")
assert(initial.authorityIssues.length === 0, "Initial tracker authority must be valid")
assertPresenterParity(initial)

const secondaryTarget = await setTrackerTarget(initial, "Secondary")
assert(
  secondaryTarget.snapshot.trackerTasks.length === 0,
  "Independent controlled tracker targets must not share task authority"
)
const secondaryTask = await executeCommand(secondaryTarget.snapshot, {
  _tag: "ReplacedTrackerTask",
  task: {
    body: "Independent secondary-target work.",
    id: "X",
    lifecycle: "Open",
    parentTaskId: null,
    prerequisiteIds: [],
    title: "Prepare X"
  }
})
const secondaryObserved = await Effect.runPromise(executeLabMove(
  secondaryTask.snapshot,
  availableMoveId(secondaryTask.snapshot, "ObserveTrackerTarget"),
  secondaryTask.snapshot.revision
))
const primaryAgain = await setTrackerTarget(secondaryObserved.snapshot, "Primary")
assert(
  primaryAgain.snapshot.trackerTasks.length === 4,
  "Switching targets must restore that target's independent controlled authority"
)
assert(
  primaryAgain.snapshot.latestObservation.length === 0,
  "Switching targets must not present another target's latest observation"
)
assert(
  !primaryAgain.snapshot.trackerClaims.some(({ taskId }) => taskId === "X"),
  "Switching targets must not present another target's claims"
)
const bothTargetsObserved = await Effect.runPromise(executeLabMove(
  primaryAgain.snapshot,
  availableMoveId(primaryAgain.snapshot, "ObserveTrackerTarget"),
  primaryAgain.snapshot.revision
))
assert(
  bothTargetsObserved.snapshot.graphKnowledge.length === 2,
  "Production reconstruction must retain both independently observed target closures"
)

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
const observedView = presentLab(observation.snapshot)
assert(
  observedView.graphProjections.map(({ key }) => key).join(",") === "Latest,Authority",
  "Only topology-bearing Latest and Authority projections may be rendered as graphs"
)
assert(
  observedView.graphKnowledgeRows.some((row) => row.includes("[A, B, C, D]")),
  "Journal-reconstructed observation coverage must remain visible as a membership row"
)
assert(
  observedView.graphKnowledgeRows.some((row) => row.includes("revision tracker-revision-1")),
  "Durable graph knowledge must expose its exact tracker revision"
)
assert(
  observation.snapshot.appliedThrough === 2,
  "The Lab must expose the exact journal position applied by production reconstruction"
)
assertPresenterParity(observation.snapshot)

const completedBeforeClaimAuthority = await executeCommand(observation.snapshot, {
  _tag: "ReplacedTrackerTask",
  task: {
    body: "Independent runnable work.",
    id: "A",
    lifecycle: "CompletedSuccessfully",
    parentTaskId: null,
    prerequisiteIds: [],
    title: "Prepare A"
  }
})
const completedBeforeClaimRead = await Effect.runPromise(executeLabMove(
  completedBeforeClaimAuthority.snapshot,
  availableMoveId(
    completedBeforeClaimAuthority.snapshot,
    "RecheckTaskBeforeClaim",
    "A"
  ),
  completedBeforeClaimAuthority.snapshot.revision
))
assert(
  completedBeforeClaimRead.snapshot.latestObservation
    .find(({ id }) => id === "A")?.lifecycle === "CompletedSuccessfully",
  "The coordinator must reread a fresh task before committing its claim intent"
)
assert(
  !completedBeforeClaimRead.snapshot.moves.some(({ transition, subject }) =>
    transition === "CommitFreshTaskClaimIntent"
    && subject._tag === "Task"
    && subject.taskId === "A"
  ),
  "A task completed before claim selection must never reach claim intent"
)

const capacityTwo = await Effect.runPromise(executeLabMove(
  observation.snapshot,
  availableMoveId(observation.snapshot, "SetTaskWorkCapacity"),
  observation.snapshot.revision
))
assert(capacityTwo.snapshot.capacity === 2, "Capacity move must reconstruct capacity two")
assert(capacityTwo.snapshot.admitted.length === 2, "Capacity two must admit A and C")
assertPresenterParity(capacityTwo.snapshot)

const preclaimRead = await Effect.runPromise(executeLabMove(
  observation.snapshot,
  availableMoveId(observation.snapshot, "RecheckTaskBeforeClaim", "A"),
  observation.snapshot.revision
))
const tipModel: Model = {
  ...initialModel,
  branches: [{
    actions: [observation.input, preclaimRead.input],
    cursor: 2,
    id: 1,
    name: "main"
  }],
  snapshot: preclaimRead.snapshot,
  viewModel: presentLab(preclaimRead.snapshot)
}
const [recomputingHistoricalModel] = update(tipModel, {
  _tag: "MovedCursor",
  cursor: 1
})
const recomputingBody = view(recomputingHistoricalModel).body
assert(
  recomputingHistoricalModel.snapshot === null,
  "Undo must remove the later snapshot until the displayed input prefix is reconstructed"
)
assert(
  recomputingBody !== null
    && Option.isSome(Scene.getByRole("button", {
      disabled: true,
      name: "New tracker task"
    })(recomputingBody)),
  "Task editing must be unavailable while Undo reconstructs the selected prefix"
)
const [stillRecomputingModel, prematureCommands] = update(recomputingHistoricalModel, {
  _tag: "TriggeredLabMove",
  moveId: availableMoveId(preclaimRead.snapshot, "RecheckTaskBeforeClaim", "C"),
  snapshotRevision: preclaimRead.snapshot.revision
})
assert(
  prematureCommands.length === 0 && stillRecomputingModel.branches.length === 1,
  "A click during Undo reconstruction must neither execute a later move nor create a branch"
)
const reconstructedHistoricalSnapshot = await reconstruct(
  tipModel.branches[0]!.actions.slice(0, 1)
)
const [historicalModel] = update(recomputingHistoricalModel, {
  _tag: "SnapshotReady",
  requestId: recomputingHistoricalModel.requestId,
  snapshot: reconstructedHistoricalSnapshot,
  viewModel: presentLab(reconstructedHistoricalSnapshot)
})
const rereadCMoveId = availableMoveId(
  observation.snapshot,
  "RecheckTaskBeforeClaim",
  "C"
)
const historicalView = view(historicalModel)
const historicalBody = historicalView.body
const hasEnabledHistoricalButton = (name: string): boolean =>
  historicalBody !== null
  && Option.isSome(Scene.getByRole("button", { disabled: false, name })(historicalBody))
assert(
  hasEnabledHistoricalButton("Reread current task before claim · C")
    && hasEnabledHistoricalButton("Reread current task before claim · A"),
  "Semantic controls must be enabled after Undo reconstruction"
)
assert(
  hasEnabledHistoricalButton("New tracker task"),
  "Task creation must be enabled after Undo reconstruction"
)
const [historicalAuthorityModel] = update(historicalModel, {
  _tag: "SelectedGraphProjection",
  selection: "Authority"
})
const historicalAuthorityBody = view(historicalAuthorityModel).body
assert(
  historicalAuthorityBody !== null
    && Option.isSome(Scene.getByRole("button", {
      disabled: false,
      name: "Edit tracker record"
    })(historicalAuthorityBody)),
  "Task editing must be enabled after Undo reconstruction"
)
assert(
  hasEnabledHistoricalButton("Foreign"),
  "Claim controls must be enabled after Undo reconstruction"
)
const [editingHistoricalModel] = update(historicalModel, {
  _tag: "StartedEditingTask",
  taskId: "A"
})
const [savingHistoricalModel, saveCommands] = update(editingHistoricalModel, {
  _tag: "SavedTaskDraft"
})
const [claimingHistoricalModel, claimCommands] = update(historicalModel, {
  _tag: "TriggeredLabCommand",
  input: { _tag: "SetTrackerClaim", state: "Foreign", taskId: "A" },
  snapshotRevision: observation.snapshot.revision
})
assert(
  saveCommands.length === 1
    && savingHistoricalModel.branches.length === 2
    && savingHistoricalModel.activeBranchId === 2
    && claimCommands.length === 1
    && claimingHistoricalModel.branches.length === 2
    && claimingHistoricalModel.activeBranchId === 2,
  "Task editing and claim changes after Undo must use the same immutable prefix-fork seam"
)
const taskA = observation.snapshot.trackerTasks.find(({ id }) => id === "A")
if (taskA === undefined) throw new Error("Missing task A")
const savedHistoricalExecution = await executeCommand(observation.snapshot, {
  _tag: "ReplacedTrackerTask",
  task: taskA
})
const [savedHistoricalModel] = update(savingHistoricalModel, {
  _tag: "LabExecutionFinished",
  requestId: savingHistoricalModel.requestId,
  result: { _tag: "Executed", execution: savedHistoricalExecution }
})
const claimedHistoricalExecution = await executeCommand(observation.snapshot, {
  _tag: "SetTrackerClaim",
  state: "Foreign",
  taskId: "A"
})
const [claimedHistoricalModel] = update(claimingHistoricalModel, {
  _tag: "LabExecutionFinished",
  requestId: claimingHistoricalModel.requestId,
  result: { _tag: "Executed", execution: claimedHistoricalExecution }
})
assert(
  savedHistoricalModel.branches[0]?.actions[1] === preclaimRead.input
    && savedHistoricalModel.branches[1]?.actions[1]?._tag === "ReplacedTrackerTask"
    && claimedHistoricalModel.branches[0]?.actions[1] === preclaimRead.input
    && claimedHistoricalModel.branches[1]?.actions[1]?._tag === "SetTrackerClaim"
    && savedHistoricalModel.snapshot?.latestObservation.length
      === observation.snapshot.latestObservation.length
    && claimedHistoricalModel.snapshot?.latestObservation.length
      === observation.snapshot.latestObservation.length,
  "Completed task and claim commands must append only to their forks without observing again"
)
const [forkingModel, forkCommands] = update(historicalModel, {
  _tag: "TriggeredLabMove",
  moveId: rereadCMoveId,
  snapshotRevision: observation.snapshot.revision
})
assert(
  forkCommands.length === 1,
  "Choosing a reread after Undo must execute without a separate manual Fork click"
)
assert(
  forkingModel.branches.length === 2
    && forkingModel.activeBranchId === 2
    && forkingModel.branches[0]?.actions.length === 2
    && forkingModel.branches[1]?.actions.length === 1,
  "Choosing a reread after Undo must fork the immutable prefix and preserve the original future"
)
const rereadC = await Effect.runPromise(executeLabMove(
  observation.snapshot,
  rereadCMoveId,
  observation.snapshot.revision
))
const [forkedResultModel] = update(forkingModel, {
  _tag: "LabExecutionFinished",
  requestId: forkingModel.requestId,
  result: { _tag: "Executed", execution: rereadC }
})
assert(
  forkingModel.branches[0]?.actions[1]?._tag === "RecheckedTaskBeforeClaim"
    && forkingModel.branches[0]?.actions[1]?.taskId === "A"
    && forkedResultModel.branches[1]?.actions[1]?._tag === "RecheckedTaskBeforeClaim"
    && forkedResultModel.branches[1]?.actions[1]?.taskId === "C",
  "The original branch must retain reread A while the new branch appends reread C"
)
const [originalBranchModel] = update(forkedResultModel, {
  _tag: "SelectedBranch",
  branchId: 1
})
const [redoingOriginalModel] = update(originalBranchModel, {
  _tag: "MovedCursor",
  cursor: 2
})
const reconstructedOriginalSnapshot = await reconstruct(
  forkedResultModel.branches.find(({ id }) => id === 1)!.actions.slice(0, 2)
)
const [redoneOriginalModel] = update(redoingOriginalModel, {
  _tag: "SnapshotReady",
  requestId: redoingOriginalModel.requestId,
  snapshot: reconstructedOriginalSnapshot,
  viewModel: presentLab(reconstructedOriginalSnapshot)
})
assert(
  redoneOriginalModel.snapshot?.revision === preclaimRead.snapshot.revision,
  "Selecting the original branch and redoing must reconstruct its original reread A"
)
const claim = await Effect.runPromise(executeLabMove(
  preclaimRead.snapshot,
  availableMoveId(preclaimRead.snapshot, "CommitFreshTaskClaimIntent", "A"),
  preclaimRead.snapshot.revision
))
assert(claim.snapshot.responsibilities.length === 1, "Claim intent must create responsibility")
assert(
  claim.snapshot.moves.some(({ transition, availability }) =>
    transition === "ObserveClaimedTaskEligibility" && availability._tag === "Available"
  ),
  "The production claimed-task eligibility read must follow claim selection"
)
assertPresenterParity(claim.snapshot)

const foreignClaimAuthority = await executeCommand(claim.snapshot, {
  _tag: "SetTrackerClaim",
  state: "Foreign",
  taskId: "A"
})
const foreignClaimEligibility = await Effect.runPromise(executeLabMove(
  foreignClaimAuthority.snapshot,
  availableMoveId(
    foreignClaimAuthority.snapshot,
    "ObserveClaimedTaskEligibility",
    "A"
  ),
  foreignClaimAuthority.snapshot.revision
))
assert(
  foreignClaimEligibility.snapshot.workflowProgress[0]?.status
    === "ClaimAuthorityChanged",
  "A changed exact claim must stop before the graph read and attempt plan"
)
assert(
  foreignClaimEligibility.snapshot.journal.length === claim.snapshot.journal.length,
  "A changed exact claim must not fabricate a graph-read outcome"
)

const changedEligibleAuthority = await executeCommand(claim.snapshot, {
  _tag: "ReplacedTrackerTask",
  task: {
    body: "Independent runnable work.",
    id: "A",
    lifecycle: "Open",
    parentTaskId: null,
    prerequisiteIds: ["D"],
    title: "Prepare A"
  }
})
const changedEligibleRead = await Effect.runPromise(executeLabMove(
  changedEligibleAuthority.snapshot,
  availableMoveId(
    changedEligibleAuthority.snapshot,
    "ObserveClaimedTaskEligibility",
    "A"
  ),
  changedEligibleAuthority.snapshot.revision
))
assert(
  changedEligibleRead.snapshot.workflowProgress[0]?.taskRevision
    !== claim.snapshot.workflowProgress[0]?.taskRevision,
  "Attempt planning must use the task revision returned by the fresh eligibility read"
)
assert(
  changedEligibleRead.snapshot.workflowProgress[0]?.nextOperation
    === "RecordTaskAttemptPlan",
  "A changed but still eligible task must plan from the freshly read task"
)

const unreadableEligibilityAuthority = await executeCommand(claim.snapshot, {
  _tag: "ReplacedTrackerTask",
  task: {
    body: "Invalid during the claimed-task read.",
    id: "B",
    lifecycle: "Open",
    parentTaskId: null,
    prerequisiteIds: ["missing"],
    title: "Build B"
  }
})
const unreadableEligibility = await Effect.runPromise(executeLabMove(
  unreadableEligibilityAuthority.snapshot,
  availableMoveId(
    unreadableEligibilityAuthority.snapshot,
    "ObserveClaimedTaskEligibility",
    "A"
  ),
  unreadableEligibilityAuthority.snapshot.revision
))
assert(
  unreadableEligibility.snapshot.workflowProgress[0]?.status === "TrackerReadFailed",
  "An invalid claimed-task graph read must fail before later workflow moves"
)
assert(
  !unreadableEligibility.snapshot.workflowProgress[0]?.trace.some(
    (row) => row === "observed · Unreadable"
  ),
  "A failed graph read must not be presented as an observed outcome"
)

const completedAuthority = await executeCommand(claim.snapshot, {
  _tag: "ReplacedTrackerTask",
  task: {
    body: "Independent runnable work.",
    id: "A",
    lifecycle: "CompletedSuccessfully",
    parentTaskId: null,
    prerequisiteIds: [],
    title: "Prepare A"
  }
})
const completedEligibility = await Effect.runPromise(executeLabMove(
  completedAuthority.snapshot,
  availableMoveId(
    completedAuthority.snapshot,
    "ObserveClaimedTaskEligibility",
    "A"
  ),
  completedAuthority.snapshot.revision
))
assert(
  completedEligibility.snapshot.latestObservation
    .find(({ id }) => id === "A")?.lifecycle === "CompletedSuccessfully",
  "Claimed-task eligibility must reread current tracker authority"
)
assert(
  completedEligibility.snapshot.workflowProgress
    .find(({ taskId }) => taskId === "A")?.nextOperation === null,
  "A task completed in the tracker must stop before attempt planning"
)
assert(
  !completedEligibility.snapshot.moves.some(({ transition, subject }) =>
    transition === "StartExecutorInvocation"
    && subject._tag === "Task"
    && subject.taskId === "A"
  ),
  "A completed task must not reach an executor invocation"
)

let completedWorkflow = claim.snapshot
let completedExecutorClicks = 0
let worktreeReadySnapshot: LabSnapshot | null = null
let executorReadySnapshot: LabSnapshot | null = null
let executorResponsibilitySnapshot: LabSnapshot | null = null
const reachedProductionTransitions = new Set([
  ...observation.snapshot.frontier.map(({ tag }) => tag),
  ...claim.snapshot.workflowProgress.flatMap(({ nextTransition }) =>
    nextTransition === null ? [] : [nextTransition]
  )
])
for (const operation of [
  "ObserveClaimedTaskEligibility",
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
  for (const progress of completedWorkflow.workflowProgress) {
    if (progress.nextTransition !== null) {
      reachedProductionTransitions.add(progress.nextTransition)
    }
  }
  if (operation === "StartExecutorInvocation") completedExecutorClicks += 1
  const availableLabels = presentLab(completedWorkflow).actionGroups.flatMap(
    ({ actions }) => actions.filter(({ enabled }) => enabled).map(({ label }) => label)
  )
  if (operation === "EstablishTaskWorkSession") {
    executorReadySnapshot = completedWorkflow
    assert(
      availableLabels.includes("Start executor invocation 1 of 4 · A"),
      "The first opaque executor invocation must show its ordinal"
    )
  }
  if (operation === "ReconcileTaskWorktree") {
    worktreeReadySnapshot = completedWorkflow
  }
  if (operation === "StartExecutorInvocation" && completedExecutorClicks < 4) {
    if (completedExecutorClicks === 1) executorResponsibilitySnapshot = completedWorkflow
    assert(
      availableLabels.includes(
        `Start executor invocation ${completedExecutorClicks + 1} of 4 · A`
      ),
      "Each opaque executor invocation must show distinct progress"
    )
  }
}
assert(
  completedWorkflow.workflowProgress[0]?.completedOperations.length === 9,
  "The Lab must reach the complete production path through opaque executor invocations"
)
assert(
  completedWorkflow.workflowProgress[0]?.nextOperation === null,
  "The production-parity path must stop after the selected executor completes"
)
for (const expectedEvent of [
  "TaskClaimAcquired",
  "TaskAttemptPlanned",
  "TaskWorktreeReady",
  "TaskWorkSessionEstablished",
  "TaskExecutionOutcomeObserved",
  "ImplementationEvidenceSealed",
  "ImplementationReviewCompleted",
  "ImplementationConvergenceDispositionRecorded"
] as const) {
  assert(
    completedWorkflow.journal.some(({ tag }) => tag === expectedEvent),
    `The complete production path must journal ${expectedEvent}`
  )
}
assert(
  completedWorkflow.responsibilities.length > 0,
  "Implementation completion must not fabricate tracker settlement"
)
assertPresenterParity(completedWorkflow)

if (worktreeReadySnapshot === null || executorReadySnapshot === null) {
  throw new Error("The workflow did not reach its controlled provider boundaries")
}

const behaviorSnapshots = new Array<LabSnapshot>()
for (const [behavior, expectedEvent] of [
  ["SessionLookupFails", "TaskWorkSessionLookupFailed"],
  ["SessionStartFails", "TaskWorkStartRequestFailed"]
] as const) {
  const configured = await setBoundaryBehavior(worktreeReadySnapshot, behavior)
  const failed = await Effect.runPromise(executeLabMove(
    configured.snapshot,
    availableMoveId(configured.snapshot, "EstablishTaskWorkSession", "A"),
    configured.snapshot.revision
  ))
  behaviorSnapshots.push(failed.snapshot)
  assert(
    failed.snapshot.workflowProgress[0]?.status === "BoundaryFailed",
    `${behavior} must remain visible as a typed production boundary failure`
  )
  assert(
    failed.snapshot.journal.some(({ tag }) => tag === expectedEvent),
    `${behavior} must journal ${expectedEvent}`
  )
}

const executorBehaviorEvents = [
  ["ExecutionRequestFails", "TaskExecutionRequestFailed"],
  ["ExecutionObservationFails", "TaskExecutionObservationFailed"],
  ["ExecutionFails", "ImplementationConvergenceDispositionRecorded"],
  ["ExecutionInterrupted", "ImplementationConvergenceDispositionRecorded"],
  ["ResourceEmergency", "ImplementationConvergenceDispositionRecorded"],
  ["ReviewFindingsThenAccepted", "ReviewFindingsHandbackCompleted"],
  ["ReviewRetriesThenAccepted", "TechnicalRetryDeferralSuperseded"],
  ["HandbackRetriesThenAccepted", "TechnicalRetryDeferralSuperseded"]
] as const
for (const [behavior, expectedEvent] of executorBehaviorEvents) {
  const configured = await setBoundaryBehavior(executorReadySnapshot, behavior)
  const executed = await Effect.runPromise(executeLabMove(
    configured.snapshot,
    availableMoveId(
      configured.snapshot,
      "RunExecutorInvocationsToCompletion",
      "A"
    ),
    configured.snapshot.revision
  ))
  behaviorSnapshots.push(executed.snapshot)
  assert(
    executed.snapshot.journal.some(({ tag }) => tag === expectedEvent),
    `${behavior} must journal ${expectedEvent} through the production workflow`
  )
  if (behavior === "ExecutionObservationFails") {
    assert(
      executed.snapshot.workflowProgress[0]?.status === "BoundaryFailed",
      "An executor observation failure must stay visible and resumable"
    )
  } else {
    assert(
      executed.snapshot.workflowProgress[0]?.status === "ExecutorCompleted",
      `${behavior} must reach the production executor's terminal outer outcome`
    )
  }
}

const trackerCompletedA = await executeCommand(completedWorkflow, {
  _tag: "ReplacedTrackerTask",
  task: {
    body: "Independent runnable work.",
    id: "A",
    lifecycle: "CompletedSuccessfully",
    parentTaskId: null,
    prerequisiteIds: [],
    title: "Prepare A"
  }
})
const observedCompletedA = await Effect.runPromise(executeLabMove(
  trackerCompletedA.snapshot,
  availableMoveId(trackerCompletedA.snapshot, "ObserveTrackerTarget"),
  trackerCompletedA.snapshot.revision
))
assert(
  observedCompletedA.snapshot.latestObservation.find(({ id }) => id === "A")
    ?.lifecycle === "CompletedSuccessfully",
  "Tracker completion must become the latest successful observation"
)
assert(
  observedCompletedA.snapshot.explanations.some(({ tag, taskId }) =>
    tag === "FinalOutcome" && taskId === "A"
  ),
  "Observed tracker completion must settle A's outstanding responsibilities as final outcomes"
)
assert(
  !observedCompletedA.snapshot.frontier.some(({ taskId }) => taskId === "A"),
  "A completed task must have no remaining runnable workflow transition"
)

const pauseRequested = await Effect.runPromise(executeLabMove(
  initial,
  availableMoveId(initial, "RequestRunPause"),
  initial.revision
))
assert(
  pauseRequested.snapshot.journal.some(({ tag }) => tag === "ControlCommandRecorded"),
  "The Lab must invoke production's authenticated pause-command journal boundary"
)
assert(
  pauseRequested.snapshot.runPause === "RunUnpaused",
  "Recording a pause request must not fabricate the still-unimplemented derived pause state"
)

const reachedJournalTags = new Set([
  ...completedWorkflow.journal.map(({ tag }) => tag),
  ...pauseRequested.snapshot.journal.map(({ tag }) => tag),
  ...behaviorSnapshots.flatMap(({ journal }) => journal.map(({ tag }) => tag))
])
for (const [tag, coverage] of Object.entries(workflowJournalEventCoverage)) {
  if (coverage.status === "Interactive") {
    assert(
      reachedJournalTags.has(tag),
      `Interactive journal coverage must have a reachability scenario for ${tag}`
    )
  }
}
const reachedResponsibilityKinds = new Set([
  ...claim.snapshot.responsibilities.map(({ kind }) => kind),
  ...completedWorkflow.responsibilities.map(({ kind }) => kind)
])
for (const [tag, coverage] of Object.entries(responsibilityCoverage)) {
  if (coverage.status === "Interactive") {
    assert(
      reachedResponsibilityKinds.has(tag),
      `Interactive responsibility coverage must have a reachability scenario for ${tag}`
    )
  }
}
for (const [tag, coverage] of Object.entries(transitionCoverage)) {
  if (coverage.status === "Interactive") {
    assert(
      reachedProductionTransitions.has(tag),
      `Interactive transition coverage must have a reachability scenario for ${tag}`
    )
  }
}
const reachedWorkflowOperations = new Set([
  ...observation.snapshot.journal.flatMap(({ operationTag }) =>
    operationTag === null ? [] : [operationTag]
  ),
  ...completedWorkflow.journal.flatMap(({ operationTag }) =>
    operationTag === null ? [] : [operationTag]
  ),
  ...behaviorSnapshots.flatMap(({ journal }) =>
    journal.flatMap(({ operationTag }) =>
      operationTag === null ? [] : [operationTag]
    )
  )
])
for (const [tag, coverage] of Object.entries(workflowOperationCoverage)) {
  if (coverage.status === "Interactive") {
    assert(
      reachedWorkflowOperations.has(tag),
      `Interactive workflow-operation coverage must have a reachability scenario for ${tag}`
    )
  }
}

const dispositionScenarios = [
  ["Ready", "CheckTaskClaim"],
  ["ForeignClaim", "Isolation"],
  ["MissingClaim", "ReconcileTaskClaim"],
  ["Paused", "Pause"],
  ["DependencyWait", "DependencyWait"],
  ["Completed", "FinalOutcome"],
  ["Failed", "FinalOutcome"],
  ["Blocked", "FinalOutcome"],
  ["Cancelled", "FinalOutcome"],
  ["Relinquished", "Relinquishment"],
  ["Settled", "Settlement"],
  ["Unreadable", "UnreadableFactWait"]
] as const
for (const [fact, expected] of dispositionScenarios) {
  const supplied = await Effect.runPromise(executeLabMove(
    claim.snapshot,
    availableMoveId(claim.snapshot, `Supply${fact}Fact`, "A"),
    claim.snapshot.revision
  ))
  assert(
    supplied.snapshot.frontier.some(({ tag }) => tag === expected)
      || supplied.snapshot.explanations.some(({ tag }) => tag === expected),
    `${fact} must reach production ${expected}`
  )
}
for (const cardinality of ["Missing", "Duplicate"] as const) {
  const supplied = await Effect.runPromise(executeLabMove(
    claim.snapshot,
    availableMoveId(claim.snapshot, `Supply${cardinality}FreshFacts`, "A"),
    claim.snapshot.revision
  ))
  assert(
    supplied.snapshot.explanations.some(({ tag }) => tag === "TypedIssue"),
    `${cardinality} fresh facts must reach the production TypedIssue explanation`
  )
}

if (executorResponsibilitySnapshot === null) {
  throw new Error("The workflow did not create an executor responsibility")
}
for (const [fact, expected] of [
  ["ExecutorWait", "ExecutorInvocationWait"],
  ["ExecutorSettled", "ExecutorInvocationSettlement"]
] as const) {
  const supplied = await Effect.runPromise(executeLabMove(
    executorResponsibilitySnapshot,
    availableMoveId(executorResponsibilitySnapshot, `Supply${fact}Fact`, "A"),
    executorResponsibilitySnapshot.revision
  ))
  assert(
    supplied.snapshot.explanations.some(({ tag }) => tag === expected),
    `${fact} must reach production ${expected}`
  )
}
assert(
  Object.values(dispositionCoverage).every(({ status }) => status === "Interactive"),
  "Every production responsibility disposition must remain interactive"
)

if (executorReadySnapshot === null) {
  throw new Error("The workflow did not reach executor readiness")
}
const crashedDuringExecutor = await Effect.runPromise(executeLabMove(
  executorResponsibilitySnapshot,
  availableMoveId(executorResponsibilitySnapshot, "CrashCoordinator"),
  executorResponsibilitySnapshot.revision
))
const restartedDuringExecutor = await Effect.runPromise(executeLabMove(
  crashedDuringExecutor.snapshot,
  availableMoveId(crashedDuringExecutor.snapshot, "RestartCoordinator"),
  crashedDuringExecutor.snapshot.revision
))
const recoveredToQuiescence = await Effect.runPromise(executeLabMove(
  restartedDuringExecutor.snapshot,
  availableMoveId(
    restartedDuringExecutor.snapshot,
    "RunRecoveredResponsibilitiesToQuiescence",
    "A"
  ),
  restartedDuringExecutor.snapshot.revision
))
assert(
  recoveredToQuiescence.snapshot.journal.some(
    ({ tag }) => tag === "ImplementationConvergenceDispositionRecorded"
  ),
  "Restart must route recovered executor work through production activation to quiescence"
)
assert(
  recoveredToQuiescence.snapshot.workflowProgress[0]?.status === "ExecutorCompleted",
  "Recovered production activation must synchronize visible workflow progress"
)
assert(
  recoveredToQuiescence.snapshot.workflowProgress[0]?.completedOperations.length === 9,
  "Recovered progress must count only this task's authoritative operation outcomes"
)

const automaticExecutorRun = await Effect.runPromise(executeLabMove(
  executorReadySnapshot,
  availableMoveId(
    executorReadySnapshot,
    "RunExecutorInvocationsToCompletion",
    "A"
  ),
  executorReadySnapshot.revision
))
assert(
  automaticExecutorRun.snapshot.workflowProgress[0]?.status === "ExecutorCompleted",
  "One coordinator command must run consecutive opaque executor invocations to completion"
)

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
