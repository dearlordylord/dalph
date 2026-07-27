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
  S.TaggedStruct("ObservedInitialGraph", {}),
  S.TaggedStruct("ObservedProvenAbsence", {}),
  S.TaggedStruct("CommittedClaimIntent", { task: TaskName }),
  S.TaggedStruct("SuppliedFreshFact", { fact: FreshFact, task: TaskName }),
  S.TaggedStruct("CrashedCoordinator", {}),
  S.TaggedStruct("RestartedCoordinator", {})
])
export type LabAction = typeof LabAction.Type

const Decision = S.Struct({ tag: S.String, task: TaskName })
const Responsibility = S.Struct({
  beganAt: S.Number,
  kind: S.String,
  task: TaskName
})
const JournalRow = S.Struct({ position: S.Number, tag: S.String })

export const Projection = S.Struct({
  admitted: S.Array(Decision),
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
  taskPause: S.String
})
export type Projection = typeof Projection.Type

const runId = RunId.make("reducer-lab-run")
const target = FixtureTarget.make("reducer-lab-target")
const owner = ClaimOwner.make("reducer-lab-owner")
const initialGraphOperationId = OperationId.make("graph-observation-initial")
const absenceGraphOperationId = OperationId.make("graph-observation-proven-absence")
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

const appendClaimIntent = (records: Array<JournalRecord>, task: TaskName): void => {
  const operationId = OperationId.make(`claim-${task}`)
  const acquisition = TaskClaimAcquisition.make({
    operationId,
    owner,
    taskId: taskIds[task],
    token: ClaimToken.make(`claim-token-${task}`)
  })
  const operation = makeTaskClaimAcquisitionOperation({
    acquisition,
    predecessorOperationIds: [initialGraphOperationId]
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
  let coordinatorRunning = true
  for (const action of actions) {
    switch (action._tag) {
      case "ObservedInitialGraph":
        appendGraphObservation(records, initialGraphOperationId, Object.values(taskIds), [])
        break
      case "ObservedProvenAbsence":
        appendGraphObservation(
          records,
          absenceGraphOperationId,
          [taskIds.A, taskIds.C, taskIds.D],
          [taskIds.B]
        )
        break
      case "CommittedClaimIntent":
        appendClaimIntent(records, action.task)
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
    }
  }
  return { coordinatorRunning, freshFacts, records }
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
  errors: ReadonlyArray<string>
): Projection => ({
  admitted: [],
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
  taskPause: "unknown"
})

/** Runs the real Dalph fold, reconstructed-run reducers, selector, and admission controller. */
export const projectLab = (
  actions: ReadonlyArray<LabAction>,
  capacity: number
): Effect.Effect<Projection> =>
  Effect.gen(function*() {
    const { coordinatorRunning, freshFacts, records } = buildInput(actions)
    const reduced = reduceManagedHistory(runId, records)
    if (reduced._tag === "InvalidManagedHistory") {
      return invalidProjection(
        records,
        coordinatorRunning,
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

    return {
      admitted: admitted.map(decision),
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
      responsibilities: run.responsibility.entries.map((entry) => ({
        beganAt: entry.beganAt,
        kind: entry._tag,
        task: taskName(entry.taskId)
      })),
      runPause: run.pause.run._tag,
      status: reduced._tag,
      taskPause: run.pause.tasks._tag
    }
  })

export const actionLabel = (action: LabAction): string => {
  switch (action._tag) {
    case "ObservedInitialGraph": return "Observe target closure: A, B, C, D"
    case "ObservedProvenAbsence": return "Observe B proven absent"
    case "CommittedClaimIntent": return `Commit claim intent for ${action.task}`
    case "SuppliedFreshFact": return `Supply ${action.fact} fact for ${action.task}`
    case "CrashedCoordinator": return "Crash coordinator"
    case "RestartedCoordinator": return "Restart coordinator"
  }
}
