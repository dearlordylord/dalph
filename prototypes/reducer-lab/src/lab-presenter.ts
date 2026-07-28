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
  operationTag: S.NullOr(S.String),
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
  appliedThrough: S.String,
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
    case "RecheckedTaskBeforeClaim":
      return `Reread current tracker graph before claiming ${action.taskId}`
    case "CommittedClaimIntent": return `Commit claim intent for ${action.taskId}`
    case "AdvancedTaskWorkflow": return `Advance production workflow for ${action.taskId}`
    case "AdvancedExecutorProtocol":
      return `Let the coordinator finish executor invocations for ${action.taskId}`
    case "ActivatedRecoveredResponsibilities":
      return `Activate recovered responsibilities for ${action.taskId}`
    case "SuppliedFreshFact":
      return `Supply ${action.fact} fact for ${action.taskId} · ${action.operationId}`
    case "SuppliedFreshFactCardinality":
      return `Supply ${action.cardinality.toLowerCase()} fresh facts for ${
        action.taskId
      } · ${action.operationId}`
    case "CrashedCoordinator": return "Crash coordinator"
    case "RestartedCoordinator": return "Restart coordinator"
    case "ChangedCapacity": return `Set capacity to ${action.capacity}`
    case "ChangedBoundaryBehavior":
      return `Set controlled boundary behavior to ${action.behavior}`
    case "ChangedTrackerTarget":
      return `Select controlled tracker target ${action.target}`
    case "ChangedTargetSettlement":
      return `Mark tracker target ${action.settled ? "settled" : "unsettled"}`
    case "RequestedRunPause": return "Request run pause"
    case "RequestedRunUnpause": return "Request run unpause"
    case "RequestedTaskPause": return `Request ${action.taskId} pause`
    case "RequestedTaskUnpause": return `Request ${action.taskId} unpause`
  }
}

const subjectTask = (move: LabMove): string =>
  move.subject._tag === "Task" ? move.subject.taskId : ""

const moveLabel = (move: LabMove, snapshot: LabSnapshot): string => {
  const taskId = subjectTask(move)
  const responsibilityOperation = move.availability._tag === "Available"
    && (
      move.availability.input._tag === "SuppliedFreshFact"
      || move.availability.input._tag === "SuppliedFreshFactCardinality"
    )
    ? ` · ${move.availability.input.operationId}`
    : ""
  switch (move.transition) {
    case "ObserveTrackerTarget": return "Observe tracker authority"
    case "SelectControlledTrackerTarget":
      return move.availability._tag === "Available"
        && move.availability.input._tag === "ChangedTrackerTarget"
        ? `Tracker target · ${move.availability.input.target}`
        : "Select controlled tracker target"
    case "SetTrackerTargetSettlement":
      return move.availability._tag === "Available"
        && move.availability.input._tag === "ChangedTargetSettlement"
        ? `Mark target ${move.availability.input.settled ? "settled" : "unsettled"}`
        : "Change target settlement"
    case "SupplyReadyFact": return `Ready fact · ${taskId}${responsibilityOperation}`
    case "SupplyForeignClaimFact": return `Foreign claim fact · ${taskId}${responsibilityOperation}`
    case "SupplyMissingClaimFact": return `Missing claim fact · ${taskId}${responsibilityOperation}`
    case "SupplyPausedFact": return `Paused fact · ${taskId}${responsibilityOperation}`
    case "SupplyDependencyWaitFact": return `Dependency wait · ${taskId}${responsibilityOperation}`
    case "SupplyCompletedFact": return `Tracker completed · ${taskId}${responsibilityOperation}`
    case "SupplyFailedFact": return `Tracker failed · ${taskId}${responsibilityOperation}`
    case "SupplyBlockedFact": return `Tracker blocked · ${taskId}${responsibilityOperation}`
    case "SupplyCancelledFact": return `Tracker cancelled · ${taskId}${responsibilityOperation}`
    case "SupplyRelinquishedFact": return `Relinquished · ${taskId}${responsibilityOperation}`
    case "SupplySettledFact": return `Responsibility settled · ${taskId}${responsibilityOperation}`
    case "SupplyUnreadableFact": return `Task-tracker unreadable · ${taskId}${responsibilityOperation}`
    case "SupplyExecutorWaitFact": return `Executor retry wait · ${taskId}${responsibilityOperation}`
    case "SupplyExecutorSettledFact":
      return `Executor invocation settled · ${taskId}${responsibilityOperation}`
    case "SupplyMissingFreshFacts":
      return `Omit fresh facts · ${taskId}${responsibilityOperation}`
    case "SupplyDuplicateFreshFacts":
      return `Duplicate fresh facts · ${taskId}${responsibilityOperation}`
    case "CrashCoordinator": return "Crash coordinator"
    case "RestartCoordinator": return "Restart coordinator"
    case "RunExecutorInvocationsToCompletion":
      return `Run executor invocations to completion · ${taskId}`
    case "RunRecoveredResponsibilitiesToQuiescence":
      return "Activate recovered responsibilities to quiescence"
    case "SetTaskWorkCapacity":
      return move.subject._tag === "Capacity"
        ? `Set capacity to ${move.subject.capacity}`
        : "Set capacity"
    case "SetBoundaryBehavior":
      return move.availability._tag === "Available"
        && move.availability.input._tag === "ChangedBoundaryBehavior"
        ? `Boundary behavior · ${move.availability.input.behavior}`
        : "Change controlled boundary behavior"
    case "RequestRunPause": return "Request run pause"
    case "RequestRunUnpause": return "Request run unpause"
    case "RequestTaskPause": return `Request task pause · ${taskId}`
    case "RequestTaskUnpause": return `Request task unpause · ${taskId}`
    case "CommitFreshTaskClaimIntent": return `Commit fresh claim intent · ${taskId}`
    case "RecheckTaskBeforeClaim":
      return `Reread current task before claim · ${taskId}`
    case "AcquireTaskClaim": return `Acquire task claim · ${taskId}`
    case "ObserveClaimedTaskEligibility":
      return `Re-check claimed task eligibility · ${taskId}`
    case "RecordTaskAttemptPlan": return `Record attempt plan · ${taskId}`
    case "ReconcileTaskWorktree": return `Reconcile worktree · ${taskId}`
    case "EstablishTaskWorkSession": return `Establish work session · ${taskId}`
    case "StartExecutorInvocation": {
      const progress = snapshot.workflowProgress.find(
        (candidate) => candidate.taskId === taskId
      )
      return progress === undefined
        ? `Start executor invocation · ${taskId}`
        : `Start executor invocation ${
          progress.completedExecutorInvocations + 1
        } of ${progress.executorInvocationCount} · ${taskId}`
    }
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

const displayAction = (move: LabMove, snapshot: LabSnapshot): LabDisplayAction => {
  const status = move.availability._tag
  const reason = status === "Available"
    ? move.transition === "RunExecutorInvocationsToCompletion"
      ? "Lets the coordinator activate each immediately legal opaque executor invocation until the selected executor returns an outer outcome."
      : move.transition === "RecheckTaskBeforeClaim"
        ? "Runs production's fresh task-graph stage before any state-changing claim request."
      : move.origin === "TrackerAuthority"
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
    label: moveLabel(move, snapshot),
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

const workflowStatusLabel = (
  progress: LabSnapshot["workflowProgress"][number]
): string => {
  switch (progress.status) {
    case "InProgress": return "workflow has another selected move"
    case "ClaimedTaskNotEligible":
      return "fresh tracker read stopped the attempt before planning"
    case "TrackerReadFailed":
      return "tracker read failed; no later workflow move is authorized"
    case "ClaimAuthorityChanged":
      return "the exact owned claim changed; no graph read or later move is authorized"
    case "BoundaryFailed":
      return "the selected production boundary returned a typed failure"
    case "ExecutorCompleted":
      return "selected executor returned its completed outer outcome"
    case "RecoveryIncomplete":
      return "recovery stopped without durable proof of terminal convergence"
    case "TaskSelectionUnavailable":
      return "the claimed task was unavailable when the workflow was selected"
  }
}

/** Converts one semantic snapshot into all wording, grouping, ordering, and styling intent. */
export const presentLab = (snapshot: LabSnapshot): LabViewModel => ({
  actionGroups: actionGroups.map(({ key, title }) => ({
    actions: snapshot.moves
      .filter(({ origin }) => origin === key)
      .map((move) => displayAction(move, snapshot)),
    key,
    title
  })),
  admittedRows: snapshot.admitted.map(({ operationId, tag, taskId }) =>
    `${taskId} · ${tag}${operationId === null ? "" : ` · ${operationId}`}`
  ),
  appliedThrough: snapshot.appliedThrough === null
    ? "No journal record applied"
    : `Applied through journal #${snapshot.appliedThrough}`,
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
  frontierRows: snapshot.frontier.map(({ operationId, tag, taskId }) =>
    `${taskId} · ${tag}${operationId === null ? "" : ` · ${operationId}`}`
  ),
  graphKnowledgeRows: snapshot.graphKnowledge.flatMap(({
    details,
    kind,
    observationCount,
    taskIds
  }) => [
    taskIds.length > 0
      ? `${kind} · [${taskIds.join(", ")}]`
      : `${kind} · ${observationCount} observations`,
    ...details.map((detail) => `↳ ${detail}`)
  ]
  ),
  graphProjections: graphProjections(snapshot),
  journal: snapshot.journal,
  knownTasksMetric: `Retained membership: ${
    [...new Set(snapshot.graphKnowledge.flatMap(({ taskIds }) => taskIds))].join(", ") || "none"
  }`,
  notes: [
    "Task-card Save changes the controlled tracker only. Observe crosses the read boundary.",
    "The journaled controlled adapter records an exact fake claim; Dalph checks it and rereads current tracker authority before planning.",
    "The orchestrator sees opaque executor invocations. Review strategy and review events stay inside the selected executor protocol.",
    "Opaque executor invocations cross journaled production boundaries and are shown by ordinal; the coordinator control runs the current path to completion without repeated clicks.",
    "Pause and unpause controls record production ControlCommandRecorded events. Production reconstruction still reports RunUnpaused / NoTaskPauses until the later pause-state issues land.",
    "Production has not implemented the specified active-continuation reread before every later executor invocation; the Lab does not fabricate it.",
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
  responsibilityRows: snapshot.responsibilities.map(({ beganAt, kind, operationId, taskId }) =>
    `${taskId} · ${kind} · ${operationId} · began at journal #${beganAt}`
  ),
  workflowRows: snapshot.workflowProgress.flatMap((progress) => [
    `${progress.taskId} · selected task revision: ${progress.taskRevision ?? "unavailable"}`,
    `${progress.taskId} · completed: ${progress.completedOperations.join(" → ") || "none"}`,
    `${progress.taskId} · production transition: ${progress.nextTransition ?? "none"}`,
    progress.nextOperation === null
      ? `${progress.taskId} · ${workflowStatusLabel(progress)}`
      : progress.nextOperation === "StartExecutorInvocation"
        ? `${progress.taskId} · next: opaque executor invocation ${
          progress.completedExecutorInvocations + 1
        } of ${progress.executorInvocationCount}`
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
    `${snapshot.controlledTrackerTarget} authority: [${
      snapshot.trackerTasks.map(({ id }) => id).join(", ") || "empty"
    }]. ` +
    `Observed: [${snapshot.latestObservation.map(({ id }) => id).join(", ") || "nothing"}].`
})
