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

/** One semantic input accepted by the reducer Lab driver. */
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

/** The complete semantic input history from which the Lab reconstructs state. */
export const LabInput = S.Struct({ actions: S.Array(LabAction) })
export interface LabInput extends S.Schema.Type<typeof LabInput> {}

/** Opaque process-local identity for the exact input prefix represented by a snapshot. */
export const LabSnapshotRevision = S.String.pipe(S.brand("LabSnapshotRevision"))
export type LabSnapshotRevision = typeof LabSnapshotRevision.Type

/** Stable semantic identity used to request one move without exposing its input to FoldKit. */
export const LabMoveId = S.String.pipe(S.brand("LabMoveId"))
export type LabMoveId = typeof LabMoveId.Type

export const LabMoveOrigin = S.Literals([
  "FrontierTransition",
  "TrackerAuthority",
  "CoordinatorProcess",
  "LabCapability"
])
export type LabMoveOrigin = typeof LabMoveOrigin.Type

export const LabMoveSubject = S.Union([
  S.TaggedStruct("Task", { task: TaskName }),
  S.TaggedStruct("TrackerTarget", {}),
  S.TaggedStruct("Coordinator", {}),
  S.TaggedStruct("Capacity", { capacity: S.Number }),
  S.TaggedStruct("Run", {})
])
export type LabMoveSubject = typeof LabMoveSubject.Type

export const LabMoveUnavailableReason = S.Literals([
  "WaitingForAdmissionCapacity",
  "CoordinatorStopped",
  "AlreadyCurrent",
  "ProductionTransitionNotDriven",
  "ProductionPauseStateAbsent"
])
export type LabMoveUnavailableReason = typeof LabMoveUnavailableReason.Type

/** Availability keeps executable input out of unavailable and capability-gap states. */
export const LabMoveAvailability = S.Union([
  S.TaggedStruct("Available", { input: LabAction }),
  S.TaggedStruct("Waiting", { reason: LabMoveUnavailableReason }),
  S.TaggedStruct("NotCurrent", { reason: LabMoveUnavailableReason }),
  S.TaggedStruct("DriverMissing", {
    owningIssue: S.String,
    reason: LabMoveUnavailableReason
  }),
  S.TaggedStruct("Planned", {
    owningIssue: S.String,
    reason: LabMoveUnavailableReason
  })
])
export type LabMoveAvailability = typeof LabMoveAvailability.Type

/** A label-free semantic move emitted by the driver for one exact snapshot. */
export const LabMove = S.Struct({
  availability: LabMoveAvailability,
  id: LabMoveId,
  origin: LabMoveOrigin,
  subject: LabMoveSubject,
  transition: S.String
})
export interface LabMove extends S.Schema.Type<typeof LabMove> {}

const Decision = S.Struct({ tag: S.String, task: TaskName })
const Responsibility = S.Struct({
  beganAt: S.Number,
  kind: S.String,
  task: TaskName
})
const JournalRow = S.Struct({ position: S.Number, tag: S.String })
const FrontierExplanation = S.Struct({
  tag: S.String,
  task: S.NullOr(TaskName)
})
const GraphKnowledge = S.Struct({
  kind: S.String,
  observationCount: S.Number,
  tasks: S.Array(TaskName)
})

/** Semantic result reconstructed by real production reducers plus controlled Lab inputs. */
export const LabSnapshot = S.Struct({
  admitted: S.Array(Decision),
  capacity: S.Number,
  coordinatorRunning: S.Boolean,
  errors: S.Array(S.String),
  explanations: S.Array(FrontierExplanation),
  finalityReason: S.NullOr(S.String),
  finalityTag: S.String,
  frontier: S.Array(Decision),
  graphKnowledge: S.Array(GraphKnowledge),
  input: LabInput,
  journal: S.Array(JournalRow),
  knownTasks: S.Array(TaskName),
  moves: S.Array(LabMove),
  reservedTasks: S.Array(TaskName),
  responsibilities: S.Array(Responsibility),
  revision: LabSnapshotRevision,
  runPause: S.String,
  status: S.String,
  taskPause: S.String,
  trackerTasks: S.Array(TaskName)
})
export interface LabSnapshot extends S.Schema.Type<typeof LabSnapshot> {}

export class StaleLabSnapshot extends S.TaggedErrorClass<StaleLabSnapshot>()(
  "StaleLabSnapshot",
  {
    actualRevision: LabSnapshotRevision,
    expectedRevision: LabSnapshotRevision,
    moveId: LabMoveId
  }
) {}

export class UnknownLabMove extends S.TaggedErrorClass<UnknownLabMove>()(
  "UnknownLabMove",
  { moveId: LabMoveId }
) {}

export class UnavailableLabMove extends S.TaggedErrorClass<UnavailableLabMove>()(
  "UnavailableLabMove",
  {
    availability: S.String,
    moveId: LabMoveId
  }
) {}

export const LabMoveExecution = S.Struct({
  input: LabAction,
  snapshot: LabSnapshot
})
export interface LabMoveExecution extends S.Schema.Type<typeof LabMoveExecution> {}

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

const buildProductionInput = (input: LabInput) => {
  const records = new Array<JournalRecord>()
  const freshFacts = new Map<TaskName, FreshFact>()
  const trackerTasks = new Set<TaskName>(["A", "B", "C", "D"])
  let coordinatorRunning = true
  let capacity = 1
  let observationOrdinal = 0
  let latestGraphOperationId = OperationId.make("graph-observation-unavailable")
  for (const action of input.actions) {
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

const revisionFor = (input: LabInput): LabSnapshotRevision => {
  const source = JSON.stringify(input.actions)
  let hash = 2_166_136_261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return LabSnapshotRevision.make(`snapshot-${input.actions.length}-${(hash >>> 0).toString(16)}`)
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

const move = (
  id: string,
  origin: LabMoveOrigin,
  transition: string,
  subject: LabMoveSubject,
  availability: LabMoveAvailability
): LabMove => ({
  availability,
  id: LabMoveId.make(id),
  origin,
  subject,
  transition
})

const frontierMove = (
  transition: { readonly _tag: string; readonly taskId: TaskId },
  admitted: ReadonlyArray<{ readonly _tag: string; readonly taskId: TaskId }>,
  coordinatorRunning: boolean
): LabMove => {
  const task = taskName(transition.taskId)
  if (transition._tag !== "CommitFreshTaskClaimIntent") {
    return move(
      `frontier:${transition._tag}:${task}`,
      "FrontierTransition",
      transition._tag,
      { _tag: "Task", task },
      {
        _tag: "DriverMissing",
        owningIssue: "#132",
        reason: "ProductionTransitionNotDriven"
      }
    )
  }
  const isAdmitted = admitted.some((candidate) =>
    candidate._tag === transition._tag && candidate.taskId === transition.taskId
  )
  const availability: LabMoveAvailability = !coordinatorRunning
    ? { _tag: "Waiting", reason: "CoordinatorStopped" }
    : isAdmitted
      ? { _tag: "Available", input: { _tag: "CommittedClaimIntent", task } }
      : { _tag: "Waiting", reason: "WaitingForAdmissionCapacity" }
  return move(
    `frontier:CommitFreshTaskClaimIntent:${task}`,
    "FrontierTransition",
    transition._tag,
    { _tag: "Task", task },
    availability
  )
}

const driverMoves = (
  coordinatorRunning: boolean,
  capacity: number,
  trackerTasks: ReadonlyArray<TaskName>,
  responsibilities: LabSnapshot["responsibilities"]
): ReadonlyArray<LabMove> => [
  ...(["A", "B", "C", "D"] as const).map((task) => {
    const present = trackerTasks.includes(task)
    return move(
      `tracker:set-presence:${task}:${!present}`,
      "TrackerAuthority",
      "SetTrackerTaskPresence",
      { _tag: "Task", task },
      {
        _tag: "Available",
        input: { _tag: "EditedTrackerTask", present: !present, task }
      }
    )
  }),
  move(
    "tracker:observe-target",
    "TrackerAuthority",
    "ObserveTrackerTarget",
    { _tag: "TrackerTarget" },
    coordinatorRunning
      ? { _tag: "Available", input: { _tag: "ObservedTrackerGraph" } }
      : { _tag: "Waiting", reason: "CoordinatorStopped" }
  ),
  ...responsibilities.flatMap(({ task }) =>
    (["Ready", "ForeignClaim", "MissingClaim", "Paused"] as const).map((fact) =>
      move(
        `tracker:supply-fact:${task}:${fact}`,
        "TrackerAuthority",
        `Supply${fact}Fact`,
        { _tag: "Task", task },
        {
          _tag: "Available",
          input: { _tag: "SuppliedFreshFact", fact, task }
        }
      )
    )
  ),
  move(
    "coordinator:crash",
    "CoordinatorProcess",
    "CrashCoordinator",
    { _tag: "Coordinator" },
    coordinatorRunning
      ? { _tag: "Available", input: { _tag: "CrashedCoordinator" } }
      : { _tag: "NotCurrent", reason: "AlreadyCurrent" }
  ),
  move(
    "coordinator:restart",
    "CoordinatorProcess",
    "RestartCoordinator",
    { _tag: "Coordinator" },
    coordinatorRunning
      ? { _tag: "NotCurrent", reason: "AlreadyCurrent" }
      : { _tag: "Available", input: { _tag: "RestartedCoordinator" } }
  ),
  ...([1, 2] as const).map((nextCapacity) =>
    move(
      `coordinator:set-capacity:${nextCapacity}`,
      "CoordinatorProcess",
      "SetTaskWorkCapacity",
      { _tag: "Capacity", capacity: nextCapacity },
      capacity === nextCapacity
        ? { _tag: "NotCurrent", reason: "AlreadyCurrent" }
        : {
          _tag: "Available",
          input: { _tag: "ChangedCapacity", capacity: nextCapacity }
        }
    )
  ),
  move(
    "capability:pause-run",
    "LabCapability",
    "PauseRun",
    { _tag: "Run" },
    {
      _tag: "Planned",
      owningIssue: "#134",
      reason: "ProductionPauseStateAbsent"
    }
  ),
  move(
    "capability:pause-task",
    "LabCapability",
    "PauseTask",
    { _tag: "Task", task: "A" },
    {
      _tag: "Planned",
      owningIssue: "#135",
      reason: "ProductionPauseStateAbsent"
    }
  )
]

const invalidSnapshot = (
  input: LabInput,
  records: ReadonlyArray<JournalRecord>,
  coordinatorRunning: boolean,
  capacity: number,
  trackerTasks: ReadonlyArray<TaskName>,
  errors: ReadonlyArray<string>
): LabSnapshot => ({
  admitted: [],
  capacity,
  coordinatorRunning,
  errors,
  explanations: [],
  finalityReason: null,
  finalityTag: "UnsafeToDecide",
  frontier: [],
  graphKnowledge: [],
  input,
  journal: records.map(({ event, position }) => ({ position, tag: event._tag })),
  knownTasks: [],
  moves: [],
  reservedTasks: [],
  responsibilities: [],
  revision: revisionFor(input),
  runPause: "Unknown",
  status: "InvalidManagedHistory",
  taskPause: "Unknown",
  trackerTasks
})

/**
 * Narrow temporary adapter around current production reconstruction and selection.
 * Issue #132 can replace this one-pass boundary without changing Lab moves or presentation.
 */
const reconstructThroughProduction = (
  input: LabInput
): Effect.Effect<LabSnapshot> =>
  Effect.gen(function*() {
    const { capacity, coordinatorRunning, freshFacts, records, trackerTasks } =
      buildProductionInput(input)
    const reduced = reduceManagedHistory(runId, records)
    if (reduced._tag === "InvalidManagedHistory") {
      return invalidSnapshot(
        input,
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
    const admissionSnapshot = yield* controller.snapshot()
    const admitted = coordinatorRunning ? preview.transitions : []
    const finality = deriveRunFinalityDecision(frontier, run.responsibility, false)
    const responsibilities = run.responsibility.entries.map((entry) => ({
      beganAt: entry.beganAt,
      kind: entry._tag,
      task: taskName(entry.taskId)
    }))

    return {
      admitted: admitted.map(decision),
      capacity,
      coordinatorRunning,
      errors: [],
      explanations: preview.explanations.map((explanation) => ({
        tag: explanation._tag,
        task: "taskId" in explanation ? taskName(explanation.taskId) : null
      })),
      finalityReason: finality._tag === "RunMayTerminate" ? null : finality.reason,
      finalityTag: finality._tag,
      frontier: frontier.transitions.map(decision),
      graphKnowledge: run.graphKnowledge.targetClosures.map((knowledge) =>
        knowledge._tag === "TaskTrackerTargetClosureObserved"
          ? {
            kind: knowledge._tag,
            observationCount: 1,
            tasks: knowledge.taskIds.map(taskName)
          }
          : {
            kind: knowledge._tag,
            observationCount: knowledge.observations.length,
            tasks: []
          }
      ),
      input,
      journal: records.map(({ event, position }) => ({ position, tag: event._tag })),
      knownTasks,
      moves: [
        ...frontier.transitions.map((transition) =>
          frontierMove(transition, admitted, coordinatorRunning)
        ),
        ...driverMoves(coordinatorRunning, capacity, trackerTasks, responsibilities)
      ],
      reservedTasks: admissionSnapshot.reservedTaskIds.map(taskName),
      responsibilities,
      revision: revisionFor(input),
      runPause: run.pause.run._tag,
      status: reduced._tag,
      taskPause: run.pause.tasks._tag,
      trackerTasks
    }
  })

/** Reconstructs one semantic snapshot from an exact Lab input prefix. */
export const reconstructLabSnapshot = (
  input: LabInput
): Effect.Effect<LabSnapshot> => reconstructThroughProduction(input)

/**
 * Revalidates a semantic move against the exact snapshot before applying it.
 * FoldKit never receives or appends the move's hidden Lab input directly.
 */
export const executeLabMove = (
  snapshot: LabSnapshot,
  moveId: LabMoveId,
  expectedRevision: LabSnapshotRevision
): Effect.Effect<
  LabMoveExecution,
  StaleLabSnapshot | UnknownLabMove | UnavailableLabMove
> =>
  Effect.gen(function*() {
    if (snapshot.revision !== expectedRevision) {
      return yield* new StaleLabSnapshot({
        actualRevision: snapshot.revision,
        expectedRevision,
        moveId
      })
    }
    const selected = snapshot.moves.find((candidate) => candidate.id === moveId)
    if (selected === undefined) return yield* new UnknownLabMove({ moveId })
    if (selected.availability._tag !== "Available") {
      return yield* new UnavailableLabMove({
        availability: selected.availability._tag,
        moveId
      })
    }
    const input = selected.availability.input
    const nextSnapshot = yield* reconstructThroughProduction({
      actions: [...snapshot.input.actions, input]
    })
    return { input, snapshot: nextSnapshot }
  })
