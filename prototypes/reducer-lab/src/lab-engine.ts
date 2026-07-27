import { Effect, Schema as S } from "effect"
import {
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  JournalPosition,
  OperationId,
  RunId,
  TaskId,
  TaskWorkCapacity,
  TrackerRevision
} from "../../../packages/orchestrator/src/domain.ts"
import { workflowJournalEventVersion } from "../../../packages/orchestrator/src/journal-event-version.ts"
import {
  intentRecordKey,
  outcomeRecordKey,
  TaskClaimAcquisitionIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved,
  type JournalRecord
} from "../../../packages/orchestrator/src/journal-store.ts"
import { reduceManagedHistory } from "../../../packages/orchestrator/src/managed-history.ts"
import {
  deriveRunFinalityDecision,
  deriveRunnableFrontier,
  ResponsibilityDisposition
} from "../../../packages/orchestrator/src/runnable-frontier.ts"
import { makeTaskAdmissionController } from "../../../packages/orchestrator/src/task-admission-controller.ts"
import { TaskClaimAcquisition } from "../../../packages/orchestrator/src/tracker-mutation.ts"
import {
  makeTaskClaimAcquisitionOperation,
  makeTrackerGraphObservationOperation
} from "../../../packages/orchestrator/src/workflow-operation.ts"

export const TaskName = S.Literals(["A", "B", "C", "D"])
export type TaskName = typeof TaskName.Type
export const FreshFact = S.Literals(["Ready", "ForeignClaim", "MissingClaim", "Paused"])
export type FreshFact = typeof FreshFact.Type

export const LabAction = S.Union([
  S.TaggedStruct("EditedTrackerTask", { present: S.Boolean, task: TaskName }),
  S.TaggedStruct("ObservedTrackerGraph", {}),
  S.TaggedStruct("CommittedClaimIntent", { task: TaskName }),
  S.TaggedStruct("SuppliedFreshFact", { fact: FreshFact, task: TaskName }),
  S.TaggedStruct("CrashedCoordinator", {}),
  S.TaggedStruct("RestartedCoordinator", {}),
  S.TaggedStruct("ChangedCapacity", { capacity: S.Number })
])
export type LabAction = typeof LabAction.Type

export const ActionOrigin = S.Literals([
  "Reducer",
  "ExternalAuthority",
  "Process",
  "Planned"
])
export type ActionOrigin = typeof ActionOrigin.Type
export const ActionStatus = S.Literals([
  "Available",
  "Waiting",
  "NotCurrent",
  "DriverMissing",
  "Planned"
])
export type ActionStatus = typeof ActionStatus.Type
export const DriverAction = S.Struct({
  command: S.NullOr(LabAction),
  id: S.String,
  label: S.String,
  origin: ActionOrigin,
  reason: S.String,
  status: ActionStatus
})
export type DriverAction = typeof DriverAction.Type

const Decision = S.Struct({ tag: S.String, task: TaskName })
const Responsibility = S.Struct({
  beganAt: S.Number,
  kind: S.String,
  task: TaskName
})
const JournalRow = S.Struct({ position: S.Number, tag: S.String })

export const Projection = S.Struct({
  actions: S.Array(DriverAction),
  admitted: S.Array(Decision),
  capacity: S.Number,
  coordinatorRunning: S.Boolean,
  errors: S.Array(S.String),
  explanations: S.Array(S.String),
  finality: S.String,
  frontier: S.Array(Decision),
  graphKnowledge: S.Array(S.String),
  journal: S.Array(JournalRow),
  knownTasks: S.Array(TaskName),
  notes: S.Array(S.String),
  reservedTasks: S.Array(TaskName),
  responsibilities: S.Array(Responsibility),
  runPause: S.String,
  status: S.String,
  taskPause: S.String,
  trackerTasks: S.Array(TaskName)
})
export type Projection = typeof Projection.Type

const runId = RunId.make("reducer-lab-run")
const target = FixtureTarget.make("reducer-lab-target")
const owner = ClaimOwner.make("reducer-lab-owner")
const taskIds = {
  A: TaskId.make("task-A"),
  B: TaskId.make("task-B"),
  C: TaskId.make("task-C"),
  D: TaskId.make("task-D")
} as const
const namesByTaskId = new Map<string, TaskName>(
  Object.entries(taskIds).map(([name, taskId]) => [taskId, name as TaskName])
)
const taskName = (taskId: TaskId): TaskName => namesByTaskId.get(taskId) ?? "A"

const appendRecord = (
  records: Array<JournalRecord>,
  key: JournalRecord["key"],
  event: JournalRecord["event"]
): void => {
  records.push({
    event,
    key,
    position: JournalPosition.make(records.length + 1),
    runId
  })
}

const appendGraphObservation = (
  records: Array<JournalRecord>,
  operationId: OperationId,
  returnedTasks: ReadonlyArray<TaskId>,
  explicitlyCoveredTasks: ReadonlyArray<TaskId>
): void => {
  const operation = makeTrackerGraphObservationOperation(
    operationId,
    target,
    [],
    explicitlyCoveredTasks
  )
  appendRecord(records, intentRecordKey(operationId), trackerGraphObservationIntent(operation))
  appendRecord(
    records,
    outcomeRecordKey(operationId),
    trackerGraphOutcomeObserved(operationId, {
      _tag: "TrackerGraphObserved",
      revision: TrackerRevision.make(`revision-${records.length}`),
      taskIds: returnedTasks
    })
  )
}

const appendClaimIntent = (
  records: Array<JournalRecord>,
  task: TaskName,
  predecessorOperationId: OperationId
): void => {
  const operationId = OperationId.make(`claim-${task}`)
  const acquisition = TaskClaimAcquisition.make({
    operationId,
    owner,
    taskId: taskIds[task],
    token: ClaimToken.make(`claim-token-${task}`)
  })
  const operation = makeTaskClaimAcquisitionOperation({
    acquisition,
    predecessorOperationIds: [predecessorOperationId]
  })
  appendRecord(
    records,
    intentRecordKey(operationId),
    TaskClaimAcquisitionIntendedEvent.make({
      operation,
      version: workflowJournalEventVersion
    })
  )
}

const buildInput = (actions: ReadonlyArray<LabAction>) => {
  const records = new Array<JournalRecord>()
  const freshFacts = new Map<TaskName, FreshFact>()
  const trackerTasks = new Set<TaskName>(["A", "B", "C", "D"])
  let coordinatorRunning = true
  let capacity = 1
  let observationOrdinal = 0
  let latestGraphOperationId = OperationId.make("graph-observation-unavailable")
  for (const action of actions) {
    switch (action._tag) {
      case "EditedTrackerTask":
        if (action.present) trackerTasks.add(action.task)
        else trackerTasks.delete(action.task)
        break
      case "ObservedTrackerGraph":
        observationOrdinal += 1
        latestGraphOperationId = OperationId.make(`graph-observation-${observationOrdinal}`)
        appendGraphObservation(
          records,
          latestGraphOperationId,
          [...trackerTasks].map((task) => taskIds[task]),
          Object.values(taskIds)
        )
        break
      case "CommittedClaimIntent":
        appendClaimIntent(records, action.task, latestGraphOperationId)
        break
      case "SuppliedFreshFact":
        freshFacts.set(action.task, action.fact)
        break
      case "CrashedCoordinator":
        coordinatorRunning = false
        break
      case "RestartedCoordinator":
        coordinatorRunning = true
        break
      case "ChangedCapacity":
        capacity = action.capacity
        break
    }
  }
  return { capacity, coordinatorRunning, freshFacts, records, trackerTasks: [...trackerTasks] }
}

const dispositionFor = (fact: FreshFact) => {
  switch (fact) {
    case "Ready": return ResponsibilityDisposition.Ready()
    case "ForeignClaim": return ResponsibilityDisposition.ForeignClaimIsolation()
    case "MissingClaim": return ResponsibilityDisposition.MissingClaim()
    case "Paused": return ResponsibilityDisposition.Paused()
  }
}

const decision = (transition: { readonly _tag: string; readonly taskId: TaskId }) => ({
  tag: transition._tag,
  task: taskName(transition.taskId)
})

const invalidProjection = (
  records: ReadonlyArray<JournalRecord>,
  coordinatorRunning: boolean,
  capacity: number,
  trackerTasks: ReadonlyArray<TaskName>,
  errors: ReadonlyArray<string>
): Projection => ({
  actions: [],
  admitted: [],
  capacity,
  coordinatorRunning,
  errors,
  explanations: [],
  finality: "unsafe to decide",
  frontier: [],
  graphKnowledge: [],
  journal: records.map(({ event, position }) => ({ position, tag: event._tag })),
  knownTasks: [],
  notes: ["The production managed-history fold rejected this prefix and retained every issue."],
  reservedTasks: [],
  responsibilities: [],
  runPause: "unknown",
  status: "InvalidManagedHistory",
  taskPause: "unknown",
  trackerTasks
})

const driverAction = (
  id: string,
  label: string,
  origin: ActionOrigin,
  status: ActionStatus,
  reason: string,
  command: LabAction | null
): DriverAction => ({ command, id, label, origin, reason, status })

const transitionCommand = (
  transition: { readonly _tag: string; readonly taskId: TaskId },
  admitted: ReadonlyArray<{ readonly _tag: string; readonly taskId: TaskId }>,
  coordinatorRunning: boolean
): DriverAction => {
  const task = taskName(transition.taskId)
  if (transition._tag !== "CommitFreshTaskClaimIntent") {
    return driverAction(
      `reducer:${transition._tag}:${task}`,
      `${transition._tag} · ${task}`,
      "Reducer",
      "DriverMissing",
      "The real reducer selected this move, but this prototype driver cannot execute it yet.",
      null
    )
  }
  const isAdmitted = admitted.some((candidate) =>
    candidate._tag === transition._tag && candidate.taskId === transition.taskId
  )
  return driverAction(
    `reducer:claim:${task}`,
    `Commit fresh claim intent · ${task}`,
    "Reducer",
    coordinatorRunning && isAdmitted ? "Available" : "Waiting",
    coordinatorRunning
      ? isAdmitted
        ? "Selected by the frontier and admitted within current capacity."
        : "Runnable, but waiting for capacity."
      : "Runnable, but the coordinator is crashed.",
    coordinatorRunning && isAdmitted
      ? { _tag: "CommittedClaimIntent", task }
      : null
  )
}

const staticDriverActions = (
  coordinatorRunning: boolean,
  capacity: number,
  trackerTasks: ReadonlyArray<TaskName>,
  responsibilities: Projection["responsibilities"]
): ReadonlyArray<DriverAction> => [
  ...(["A", "B", "C", "D"] as const).map((task) => {
    const present = trackerTasks.includes(task)
    return driverAction(
      `authority:toggle:${task}`,
      `${present ? "Remove" : "Add"} task ${task} in tracker`,
      "ExternalAuthority",
      "Available",
      "Changes the controlled tracker authority only; Dalph state changes after a later observation.",
      { _tag: "EditedTrackerTask", present: !present, task }
    )
  }),
  driverAction(
    "authority:observe",
    "Observe tracker target closure",
    "ExternalAuthority",
    coordinatorRunning ? "Available" : "Waiting",
    coordinatorRunning
      ? "Reads the current controlled tracker membership through the real graph observation fold."
      : "The coordinator must be running to perform this read.",
    coordinatorRunning ? { _tag: "ObservedTrackerGraph" } : null
  ),
  ...responsibilities.flatMap(({ task }) =>
    (["Ready", "ForeignClaim", "MissingClaim", "Paused"] as const).map((fact) =>
      driverAction(
        `authority:fact:${task}:${fact}`,
        `${fact} fact · ${task}`,
        "ExternalAuthority",
        "Available",
        "Supplies a fresh authority fact to the real frontier selector; it is not a journal command.",
        { _tag: "SuppliedFreshFact", fact, task }
      )
    )
  ),
  driverAction(
    "process:crash",
    "Crash coordinator",
    "Process",
    coordinatorRunning ? "Available" : "NotCurrent",
    coordinatorRunning ? "Stops activation while preserving journal history." : "Coordinator is already crashed.",
    coordinatorRunning ? { _tag: "CrashedCoordinator" } : null
  ),
  driverAction(
    "process:restart",
    "Restart coordinator",
    "Process",
    coordinatorRunning ? "NotCurrent" : "Available",
    coordinatorRunning ? "Coordinator is already running." : "Reconstructs from the retained journal prefix.",
    coordinatorRunning ? null : { _tag: "RestartedCoordinator" }
  ),
  ...([1, 2] as const).map((nextCapacity) =>
    driverAction(
      `process:capacity:${nextCapacity}`,
      `Set capacity to ${nextCapacity}`,
      "Process",
      capacity === nextCapacity ? "NotCurrent" : "Available",
      capacity === nextCapacity ? `Capacity is already ${nextCapacity}.` : "Changes bounded admission for subsequent projections.",
      capacity === nextCapacity ? null : { _tag: "ChangedCapacity", capacity: nextCapacity }
    )
  ),
  driverAction(
    "planned:pause-run",
    "Pause run",
    "Planned",
    "Planned",
    "The production reconstructed pause reducer currently has no paused-run state.",
    null
  ),
  driverAction(
    "planned:pause-task",
    "Pause task",
    "Planned",
    "Planned",
    "The production reconstructed pause reducer currently has no paused-task state.",
    null
  )
]

/** Runs the real Dalph fold, reconstructed-run reducers, selector, and admission controller. */
export const projectLab = (
  actions: ReadonlyArray<LabAction>
): Effect.Effect<Projection> =>
  Effect.gen(function*() {
    const { capacity, coordinatorRunning, freshFacts, records, trackerTasks } = buildInput(actions)
    const reduced = reduceManagedHistory(runId, records)
    if (reduced._tag === "InvalidManagedHistory") {
      return invalidProjection(
        records,
        coordinatorRunning,
        capacity,
        trackerTasks,
        reduced.issues.map(({ detail, position }) => `#${position}: ${detail}`)
      )
    }

    const run = reduced.managedRun
    const observations = run.graphKnowledge.targetClosures.flatMap((knowledge) =>
      knowledge._tag === "TaskTrackerTargetClosureObserved"
        ? [knowledge]
        : knowledge.observations
    )
    const latestObservation = observations.at(-1)
    const knownTasks = latestObservation?.taskIds.map(taskName) ?? []
    const eligibleTaskIds = [taskIds.A, taskIds.C].filter((taskId) =>
      latestObservation?.taskIds.includes(taskId) ?? false
    )
    const responsibilityFacts = run.responsibility.entries.map((responsibility) => ({
      disposition: dispositionFor(freshFacts.get(taskName(responsibility.taskId)) ?? "Ready"),
      responsibility
    }))
    const frontier = deriveRunnableFrontier({
      freshEligibleTaskIds: eligibleTaskIds,
      responsibility: run.responsibility,
      responsibilityFacts
    })
    // The repository currently pins Effect beta.99 while FoldKit pins beta.101.
    // Vite aliases both imports to beta.101 at runtime; this cast bridges only
    // the duplicate nominal Effect type identities seen by TypeScript.
    const controller = yield* (makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(capacity),
      freshOccupiedInvocations: [],
      reconstructedReservedTaskIds: run.responsibility.entries.map(({ taskId }) => taskId)
    }) as unknown as Effect.Effect<{
      readonly admit: (frontier: unknown) => Effect.Effect<{
        readonly explanations: ReadonlyArray<{
          readonly _tag: string
          readonly taskId?: TaskId
        }>
        readonly transitions: ReadonlyArray<{
          readonly _tag: string
          readonly taskId: TaskId
        }>
      }>
      readonly snapshot: () => Effect.Effect<{
        readonly reservedTaskIds: ReadonlyArray<TaskId>
      }>
    }>)
    const preview = yield* controller.admit(frontier)
    const snapshot = yield* controller.snapshot()
    const admitted = coordinatorRunning ? preview.transitions : []
    const finality = deriveRunFinalityDecision(frontier, run.responsibility, false)
    const responsibilities = run.responsibility.entries.map((entry) => ({
      beganAt: entry.beganAt,
      kind: entry._tag,
      task: taskName(entry.taskId)
    }))

    return {
      actions: [
        ...frontier.transitions.map((transition) =>
          transitionCommand(transition, admitted, coordinatorRunning)
        ),
        ...staticDriverActions(coordinatorRunning, capacity, trackerTasks, responsibilities)
      ],
      admitted: admitted.map(decision),
      capacity,
      coordinatorRunning,
      errors: [],
      explanations: preview.explanations.map((explanation) =>
        `${explanation._tag}${"taskId" in explanation ? ` · ${taskName(explanation.taskId)}` : ""}`
      ),
      finality: finality._tag === "RunMayTerminate"
        ? finality._tag
        : `${finality._tag} · ${finality.reason}`,
      frontier: frontier.transitions.map(decision),
      graphKnowledge: run.graphKnowledge.targetClosures.map((knowledge) =>
        knowledge._tag === "TaskTrackerTargetClosureObserved"
          ? `${knowledge._tag} · [${knowledge.taskIds.map(taskName).join(", ")}]`
          : `${knowledge._tag} · ${knowledge.observations.length} observations`
      ),
      journal: records.map(({ event, position }) => ({ position, tag: event._tag })),
      knownTasks,
      notes: [
        "Eligibility [A, C] is a fresh tracker input to the selector; it is not persisted frontier state.",
        "Packaging gap: the pure fold currently reaches a static Node platform import through the all-events schema; this prototype shims that unused adapter.",
        coordinatorRunning
          ? "The coordinator is running, so admission is shown."
          : "The coordinator is stopped. Reducers still reconstruct the journal, but no transition is activated.",
        "Pause facts can be supplied to the selector seam, but the reconstructed pause reducer itself always returns unpaused."
      ],
      reservedTasks: snapshot.reservedTaskIds.map(taskName),
      responsibilities,
      runPause: run.pause.run._tag,
      status: reduced._tag,
      taskPause: run.pause.tasks._tag,
      trackerTasks
    }
  })

export const actionLabel = (action: LabAction): string => {
  switch (action._tag) {
    case "EditedTrackerTask": return `${action.present ? "Add" : "Remove"} ${action.task} in tracker`
    case "ObservedTrackerGraph": return "Observe tracker target closure"
    case "CommittedClaimIntent": return `Commit claim intent for ${action.task}`
    case "SuppliedFreshFact": return `Supply ${action.fact} fact for ${action.task}`
    case "CrashedCoordinator": return "Crash coordinator"
    case "RestartedCoordinator": return "Restart coordinator"
    case "ChangedCapacity": return `Set capacity to ${action.capacity}`
  }
}
