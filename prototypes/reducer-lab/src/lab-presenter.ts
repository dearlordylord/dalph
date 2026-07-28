import { Schema as S } from "effect"
import {
  type ControlledTask,
  type LabAction,
  type LabMove,
  LabMoveId,
  type LabMoveUnavailableReason,
  type LabSnapshot
} from "./lab-engine.ts"

export const LabDisplayAction = S.Struct({
  buttonKind: S.String,
  cssClass: S.String,
  enabled: S.Boolean,
  label: S.String,
  moveId: LabMoveId,
  reason: S.String,
  status: S.String
})
export interface LabDisplayAction extends S.Schema.Type<typeof LabDisplayAction> {}

const LabActionGroup = S.Struct({
  actions: S.Array(LabDisplayAction),
  key: S.String,
  title: S.String
})

const LabJournalRow = S.Struct({
  position: S.Number,
  tag: S.String
})

export const GraphProjectionKey = S.Literals(["Latest", "Authority"])
export type GraphProjectionKey = typeof GraphProjectionKey.Type

export const GraphProjectionSelection = S.Literals([
  "Auto",
  "Latest",
  "Authority",
  "Compare"
])
export type GraphProjectionSelection = typeof GraphProjectionSelection.Type

const GraphTask = S.Struct({
  body: S.String,
  id: S.String,
  lifecycle: S.String,
  parentTaskId: S.NullOr(S.String),
  prerequisiteIds: S.Array(S.String),
  title: S.String
})
export type GraphTask = typeof GraphTask.Type

const GraphEdge = S.Struct({
  from: S.String,
  kind: S.Literals(["Prerequisite", "Grouping"]),
  to: S.String
})
export type GraphEdge = typeof GraphEdge.Type

/**
 * Stable presenter-owned graph contract. Browser renderer layout and event
 * types stay on the view side of this boundary.
 */
export const TaskGraphProjection = S.Struct({
  diagnostics: S.Array(S.String),
  fingerprint: S.String,
  key: GraphProjectionKey,
  label: S.String,
  stale: S.Boolean,
  status: S.String,
  tasks: S.Array(GraphTask),
  edges: S.Array(GraphEdge)
})
export interface TaskGraphProjection extends S.Schema.Type<typeof TaskGraphProjection> {}

const ClaimRow = S.Struct({
  state: S.String,
  taskId: S.String
})

/** Display-ready projection consumed by FoldKit without domain inference. */
export const LabViewModel = S.Struct({
  actionGroups: S.Array(LabActionGroup),
  admittedRows: S.Array(S.String),
  capacityStatus: S.String,
  claimRows: S.Array(ClaimRow),
  coordinatorClass: S.String,
  coordinatorStatus: S.String,
  errors: S.Array(S.String),
  explanationRows: S.Array(S.String),
  finality: S.String,
  frontierRows: S.Array(S.String),
  graphKnowledgeRows: S.Array(S.String),
  graphProjections: S.Array(TaskGraphProjection),
  journal: S.Array(LabJournalRow),
  knownTasksMetric: S.String,
  notes: S.Array(S.String),
  observationStatus: S.String,
  reservedTasksMetric: S.String,
  responsibilityRows: S.Array(S.String),
  workflowRows: S.Array(S.String),
  revision: S.String,
  runPause: S.String,
  status: S.String,
  targetSettlement: S.String,
  taskPause: S.String,
  timelineLabels: S.Array(S.String),
  trackerAuthorityState: S.String
})
export interface LabViewModel extends S.Schema.Type<typeof LabViewModel> {}

const inputLabel = (action: LabAction): string => {
  switch (action._tag) {
    case "ReplacedTrackerTask": return `Save tracker task ${action.task.id}`
    case "DeletedTrackerTask": return `Delete tracker task ${action.taskId}`
    case "SetTrackerClaim": return `Set ${action.taskId} claim to ${action.state}`
    case "ObservedTrackerGraph": return "Observe tracker target closure"
    case "CommittedClaimIntent": return `Commit claim intent for ${action.taskId}`
    case "AdvancedTaskWorkflow": return `Advance production workflow for ${action.taskId}`
    case "SuppliedFreshFact": return `Supply ${action.fact} fact for ${action.taskId}`
    case "CrashedCoordinator": return "Crash coordinator"
    case "RestartedCoordinator": return "Restart coordinator"
    case "ChangedCapacity": return `Set capacity to ${action.capacity}`
    case "ChangedTargetSettlement":
      return `Mark tracker target ${action.settled ? "settled" : "unsettled"}`
  }
}

const subjectTask = (move: LabMove): string =>
  move.subject._tag === "Task" ? move.subject.taskId : ""

const moveLabel = (move: LabMove): string => {
  const taskId = subjectTask(move)
  switch (move.transition) {
    case "ObserveTrackerTarget": return "Observe tracker authority"
    case "SetTrackerTargetSettlement":
      return move.availability._tag === "Available"
        && move.availability.input._tag === "ChangedTargetSettlement"
        ? `Mark target ${move.availability.input.settled ? "settled" : "unsettled"}`
        : "Change target settlement"
    case "SupplyReadyFact": return `Ready fact · ${taskId}`
    case "SupplyForeignClaimFact": return `Foreign claim fact · ${taskId}`
    case "SupplyMissingClaimFact": return `Missing claim fact · ${taskId}`
    case "SupplyPausedFact": return `Paused fact · ${taskId}`
    case "CrashCoordinator": return "Crash coordinator"
    case "RestartCoordinator": return "Restart coordinator"
    case "SetTaskWorkCapacity":
      return move.subject._tag === "Capacity"
        ? `Set capacity to ${move.subject.capacity}`
        : "Set capacity"
    case "PauseRun": return "Pause run"
    case "PauseTask": return "Pause task"
    case "CommitFreshTaskClaimIntent": return `Commit fresh claim intent · ${taskId}`
    case "AcquireTaskClaim": return `Acquire task claim · ${taskId}`
    case "RecordTaskAttemptPlan": return `Record attempt plan · ${taskId}`
    case "ReconcileTaskWorktree": return `Reconcile worktree · ${taskId}`
    case "EstablishTaskWorkSession": return `Establish work session · ${taskId}`
    case "StartExecutorInvocation": return `Start executor invocation · ${taskId}`
    default: return `${move.transition} · ${taskId}`
  }
}

const unavailableReason = (
  reason: LabMoveUnavailableReason,
  owningIssue?: string
): string => {
  switch (reason) {
    case "WaitingForAdmissionCapacity":
      return "Runnable, but waiting for task-work capacity."
    case "CoordinatorStopped":
      return "The coordinator must be running before the driver can perform this move."
    case "AlreadyCurrent":
      return "The requested process or capacity state is already current."
    case "ProductionTransitionNotDriven":
      return `Production selected this move, but the Lab driver cannot execute it yet (${owningIssue ?? "unowned"}).`
    case "ProductionPauseStateAbsent":
      return `Production reconstruction does not yet represent this pause state (${owningIssue ?? "unowned"}).`
  }
}

const displayAction = (move: LabMove): LabDisplayAction => {
  const status = move.availability._tag
  const reason = status === "Available"
    ? move.origin === "TrackerAuthority"
      ? "Changes or rereads the controlled tracker boundary. Save and Observe remain separate."
      : move.origin === "FrontierTransition"
        ? "Selected by the real frontier and admitted within current capacity."
        : "Changes the controlled coordinator process state recorded in this branch."
    : unavailableReason(
      move.availability.reason,
      "owningIssue" in move.availability ? move.availability.owningIssue : undefined
    )
  return {
    buttonKind: move.origin === "FrontierTransition"
      ? "accent"
      : move.origin === "TrackerAuthority"
        ? "outline"
        : "",
    cssClass: status.toLowerCase(),
    enabled: status === "Available",
    label: moveLabel(move),
    moveId: move.id,
    reason,
    status
  }
}

const actionGroups = [
  { key: "FrontierTransition", title: "Reducer-selected moves" },
  { key: "TrackerAuthority", title: "Tracker observation + target facts" },
  { key: "CoordinatorProcess", title: "Process controls" },
  { key: "LabCapability", title: "Production capability gaps" }
] as const

const edgesFor = (tasks: ReadonlyArray<ControlledTask>): ReadonlyArray<GraphEdge> =>
  tasks.flatMap((task) => [
    ...task.prerequisiteIds.map((prerequisite) => ({
      from: prerequisite,
      kind: "Prerequisite" as const,
      to: task.id
    })),
    ...(task.parentTaskId === null
      ? []
      : [{
        from: task.parentTaskId,
        kind: "Grouping" as const,
        to: task.id
      }])
  ])

const fingerprint = (
  tasks: ReadonlyArray<GraphTask>,
  edges: ReadonlyArray<GraphEdge>,
  diagnostics: ReadonlyArray<string>
): string => JSON.stringify({ diagnostics, edges, tasks })

const projection = (
  key: GraphProjectionKey,
  label: string,
  status: string,
  tasks: ReadonlyArray<GraphTask>,
  edges: ReadonlyArray<GraphEdge>,
  diagnostics: ReadonlyArray<string>,
  stale: boolean
): TaskGraphProjection => ({
  diagnostics,
  edges,
  fingerprint: fingerprint(tasks, edges, diagnostics),
  key,
  label,
  stale,
  status,
  tasks,
})

const graphProjections = (snapshot: LabSnapshot): ReadonlyArray<TaskGraphProjection> => {
  const authorityTasks = snapshot.trackerTasks
  const authorityEdges = edgesFor(authorityTasks)
  const latestTasks = snapshot.latestObservation
  const latestEdges = edgesFor(latestTasks)
  const authorityFingerprint = fingerprint(authorityTasks, authorityEdges, snapshot.authorityIssues)
  const latestFingerprint = fingerprint(latestTasks, latestEdges, [])
  const latestExists = snapshot.hasSuccessfulObservation
  const observationFailed = snapshot.observationAttempt._tag === "Failed"
  return [
    projection(
      "Latest",
      "Latest successful normalized observation",
      latestExists
        ? observationFailed
          ? "Prior successful read; latest attempt failed"
          : "Most recently seen successfully by Dalph"
        : "No successful observation",
      latestTasks,
      latestEdges,
      [],
      !latestExists || authorityFingerprint !== latestFingerprint
    ),
    projection(
      "Authority",
      "Controlled tracker authority",
      snapshot.authorityIssues.length === 0
        ? "Current fake external authority"
        : "Current fake authority is intentionally invalid",
      authorityTasks,
      authorityEdges,
      snapshot.authorityIssues,
      false
    )
  ]
}

/** Converts one semantic snapshot into all wording, grouping, ordering, and styling intent. */
export const presentLab = (snapshot: LabSnapshot): LabViewModel => ({
  actionGroups: actionGroups.map(({ key, title }) => ({
    actions: snapshot.moves
      .filter(({ origin }) => origin === key)
      .map(displayAction),
    key,
    title
  })),
  admittedRows: snapshot.admitted.map(({ tag, taskId }) => `${taskId} · ${tag}`),
  capacityStatus: `${snapshot.status} · capacity ${snapshot.capacity}`,
  claimRows: snapshot.trackerClaims,
  coordinatorClass: snapshot.coordinatorRunning ? "good" : "stopped",
  coordinatorStatus: snapshot.coordinatorRunning
    ? "Coordinator running"
    : "Coordinator crashed",
  errors: snapshot.errors,
  explanationRows: snapshot.explanations.map(({ tag, taskId }) =>
    taskId === null ? tag : `${tag} · ${taskId}`
  ),
  finality: snapshot.finalityReason === null
    ? snapshot.finalityTag
    : `${snapshot.finalityTag} · ${snapshot.finalityReason}`,
  frontierRows: snapshot.frontier.map(({ tag, taskId }) => `${taskId} · ${tag}`),
  graphKnowledgeRows: snapshot.graphKnowledge.map(({ kind, observationCount, taskIds }) =>
    taskIds.length > 0
      ? `${kind} · [${taskIds.join(", ")}]`
      : `${kind} · ${observationCount} observations`
  ),
  graphProjections: graphProjections(snapshot),
  journal: snapshot.journal,
  knownTasksMetric: `Retained membership: ${
    [...new Set(snapshot.graphKnowledge.flatMap(({ taskIds }) => taskIds))].join(", ") || "none"
  }`,
  notes: [
    "Task-card Save changes the controlled tracker only. Observe crosses the read boundary.",
    "The orchestrator sees opaque executor invocations. Review strategy and review events stay inside the selected executor protocol.",
    "Invalid tracker topology records observation intent and a typed failure, but no successful outcome.",
    "Journal-reconstructed observation coverage is a membership set, not a graph; it retains no topology.",
    "The browser build still uses the documented temporary Node-platform shim."
  ],
  observationStatus: snapshot.observationAttempt._tag === "NeverAttempted"
    ? "No observation attempted"
    : snapshot.observationAttempt._tag === "Succeeded"
      ? `Successful observation · ${snapshot.observationAttempt.revision}`
      : `Observation failed · ${snapshot.observationAttempt.issues.join("; ")}`,
  reservedTasksMetric: `Reserved: ${snapshot.reservedTaskIds.join(", ") || "none"}`,
  responsibilityRows: snapshot.responsibilities.map(({ beganAt, kind, taskId }) =>
    `${taskId} · ${kind} · began at journal #${beganAt}`
  ),
  workflowRows: snapshot.workflowProgress.flatMap((progress) => [
    `${progress.taskId} · completed: ${progress.completedOperations.join(" → ") || "none"}`,
    progress.nextOperation === null
      ? `${progress.taskId} · selected executor returned its completed outer outcome`
      : `${progress.taskId} · next: ${progress.nextOperation}`,
    ...progress.trace.map((row) => `${progress.taskId} · ${row}`)
  ]),
  revision: snapshot.revision,
  runPause: snapshot.runPause,
  status: snapshot.status,
  targetSettlement: snapshot.targetSettled ? "Settled" : "Unsettled",
  taskPause: snapshot.taskPause,
  timelineLabels: snapshot.input.actions.map(inputLabel),
  trackerAuthorityState:
    `Authority: [${snapshot.trackerTasks.map(({ id }) => id).join(", ") || "empty"}]. ` +
    `Observed: [${snapshot.latestObservation.map(({ id }) => id).join(", ") || "nothing"}].`
})
