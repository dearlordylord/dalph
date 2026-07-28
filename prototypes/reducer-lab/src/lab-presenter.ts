import { Schema as S } from "effect"
import {
  type ControlledTask,
  type LabAction,
  type LabMove,
  LabMoveId,
  LabMoveOrigin,
  type LabMoveUnavailableReason,
  type LabSnapshot
} from "./lab-engine.ts"

export const LabDisplayActionStatus = S.Literals([
  "PRODUCTION FRONTIER MOVE EXECUTABLE",
  "LAB TRACKER INPUT AVAILABLE",
  "LAB WORKFLOW CONTROL AVAILABLE",
  "LAB SELECTOR INPUT AVAILABLE",
  "PRODUCTION RECOVERY CONTROL EXECUTABLE",
  "LAB FINALITY INPUT AVAILABLE",
  "LAB SCENARIO INPUT AVAILABLE",
  "LAB BOUNDARY SETUP AVAILABLE",
  "REQUEST CAN BE RECORDED",
  "WAITING",
  "CURRENT VALUE",
  "NOT EXECUTABLE IN LAB",
  "PLANNED, NOT EXECUTABLE"
])
export type LabDisplayActionStatus = typeof LabDisplayActionStatus.Type

export const LabDisplayAction = S.Struct({
  buttonKind: S.String,
  cssClass: S.String,
  enabled: S.Boolean,
  label: S.String,
  moveId: LabMoveId,
  reason: S.String,
  status: LabDisplayActionStatus
})
export interface LabDisplayAction extends S.Schema.Type<typeof LabDisplayAction> {}

const LabActionGroup = S.Struct({
  actions: S.Array(LabDisplayAction),
  description: S.String,
  key: LabMoveOrigin,
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
  recoveryDiagnosticsSummary: S.String,
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
      return `Fast-forward executor replay for ${action.taskId}`
    case "ActivatedRecoveredResponsibilities":
      return `Activate recovered responsibilities for ${action.taskId}`
    case "SuppliedFreshFact":
      return `Choose ${action.fact} selector case for ${action.taskId} · ${action.operationId}`
    case "SuppliedFreshFactCardinality":
      return `Choose ${action.cardinality.toLowerCase()}-input cardinality case for ${
        action.taskId
      } · ${action.operationId}`
    case "CrashedCoordinator": return "Crash coordinator"
    case "RestartedCoordinator": return "Restart coordinator"
    case "ChangedCapacity": return `Set capacity to ${action.capacity}`
    case "ChangedBoundaryBehavior":
      return `Set fake boundary outcome to ${action.behavior}`
    case "ChangedTrackerTarget":
      return `Select fake tracker target ${action.target}`
    case "ChangedTargetSettlement":
      return `Supply finality input: target ${action.settled ? "settled" : "unsettled"}`
    case "RequestedRunPause": return "Record run pause request"
    case "RequestedRunUnpause": return "Record run unpause request"
    case "RequestedTaskPause": return `Record ${action.taskId} pause request`
    case "RequestedTaskUnpause": return `Record ${action.taskId} unpause request`
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
    case "ObserveTrackerTarget": return "Ask Dalph to observe fake tracker"
    case "SelectControlledTrackerTarget":
      return move.availability._tag === "Available"
        && move.availability.input._tag === "ChangedTrackerTarget"
        ? `Fake tracker target · ${move.availability.input.target}`
        : "Select fake tracker target"
    case "SetTrackerTargetSettlement":
      return move.availability._tag === "Available"
        && move.availability.input._tag === "ChangedTargetSettlement"
        ? `Supply finality input · target ${
          move.availability.input.settled ? "settled" : "unsettled"
        }`
        : "Supply target settlement to finality selector"
    case "SupplyReadyFact": return `Selector case · Ready · ${taskId}${responsibilityOperation}`
    case "SupplyForeignClaimFact":
      return `Selector case · Foreign claim · ${taskId}${responsibilityOperation}`
    case "SupplyMissingClaimFact":
      return `Selector case · Missing claim · ${taskId}${responsibilityOperation}`
    case "SupplyPausedFact": return `Selector case · Paused · ${taskId}${responsibilityOperation}`
    case "SupplyDependencyWaitFact":
      return `Selector case · Dependency wait · ${taskId}${responsibilityOperation}`
    case "SupplyCompletedFact":
      return `Selector case · Completed · ${taskId}${responsibilityOperation}`
    case "SupplyFailedFact": return `Selector case · Failed · ${taskId}${responsibilityOperation}`
    case "SupplyBlockedFact": return `Selector case · Blocked · ${taskId}${responsibilityOperation}`
    case "SupplyCancelledFact":
      return `Selector case · Cancelled · ${taskId}${responsibilityOperation}`
    case "SupplyRelinquishedFact":
      return `Selector case · Relinquished · ${taskId}${responsibilityOperation}`
    case "SupplySettledFact":
      return `Selector case · Settled · ${taskId}${responsibilityOperation}`
    case "SupplyUnreadableFact":
      return `Selector case · Unreadable · ${taskId}${responsibilityOperation}`
    case "SupplyExecutorWaitFact":
      return `Selector case · Executor wait · ${taskId}${responsibilityOperation}`
    case "SupplyExecutorSettledFact":
      return `Selector case · Executor settled · ${taskId}${responsibilityOperation}`
    case "SupplyMissingFreshFacts":
      return `Selector cardinality · Missing input · ${taskId}${responsibilityOperation}`
    case "SupplyDuplicateFreshFacts":
      return `Selector cardinality · Duplicate inputs · ${taskId}${responsibilityOperation}`
    case "CrashCoordinator": return "Crash Lab coordinator process"
    case "RestartCoordinator": return "Restart Lab coordinator process"
    case "RunExecutorInvocationsToCompletion":
      return `Fast-forward executor replay to outer outcome · ${taskId}`
    case "RunRecoveredResponsibilitiesToQuiescence":
      return "Activate recovered responsibilities to quiescence"
    case "SetTaskWorkCapacity":
      return move.subject._tag === "Capacity"
        ? `Set Lab task-work capacity to ${move.subject.capacity}`
        : "Set Lab task-work capacity"
    case "SetBoundaryBehavior":
      return move.availability._tag === "Available"
        && move.availability.input._tag === "ChangedBoundaryBehavior"
        ? `Fake boundary outcome · ${move.availability.input.behavior}`
        : "Change fake boundary outcome"
    case "RequestRunPause": return "Record run pause request"
    case "RequestRunUnpause": return "Record run unpause request"
    case "RequestTaskPause": return `Record task pause request · ${taskId}`
    case "RequestTaskUnpause": return `Record task unpause request · ${taskId}`
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
      return "This Lab input already matches the current value."
    case "ProductionTransitionNotDriven":
      return `Production selected this move, but the Lab driver cannot execute it yet (${owningIssue ?? "unowned"}).`
    case "ProductionPauseStateAbsent":
      return `Production reconstruction does not yet represent this pause state (${owningIssue ?? "unowned"}).`
  }
}

const availableReason = (move: LabMove): string => {
  switch (move.origin) {
    case "ProductionFrontierSelection":
      return "The production frontier selected this move and current capacity admits it."
    case "FakeTaskTracker":
      return move.transition === "SelectControlledTrackerTarget"
        ? "Changes which Lab fake task-tracker target is controlled. It does not edit either target's authority."
        : "Asks production to read the selected Lab fake task-tracker authority. Saving a task remains a separate input."
    case "LabProductionStageControl":
      return move.transition === "RecheckTaskBeforeClaim"
        ? "The Lab offers this control to invoke production's fresh task-graph stage before the frontier-selected claim intent."
        : move.transition === "RunExecutorInvocationsToCompletion"
          ? "This Lab convenience advances the replay through the remaining executor invocations to one outer outcome; it is not production coordinator activation."
          : `The Lab's fixed prototype driver selected ${move.transition} as the next production stage to invoke. Production executes the stage but did not select this UI move.`
    case "LabResponsibilitySelectorInput":
      return "Supplies a synthetic Lab scenario input directly to production's responsibility selector. It is not task-tracker or executor evidence."
    case "ProductionCoordinator":
      return "Runs the real production recovery activation over the currently reconstructed responsibilities."
    case "LabFinalityInput":
      return "Supplies a direct Lab input to the run-finality selector. It does not change task-tracker authority."
    case "LabCoordinatorSimulation":
      return "Changes only the Lab's in-memory coordinator scenario: process lifetime or task-work capacity."
    case "FakeBoundarySetup":
      return "Configures what a later fake task-runner, executor, reviewer, or handback boundary returns. This is Lab setup, not a production move."
    case "OperatorControlRequest":
      return move.subject._tag === "Task"
        ? "The task identity comes from fake tracker authority. Production records the operator request; this does not prove the task pause state changed."
        : "Production records the operator request; this does not prove the run pause state changed."
  }
}

const groupPresentationByOrigin = {
  ProductionFrontierSelection: {
    availableStatus: "PRODUCTION FRONTIER MOVE EXECUTABLE",
    buttonKind: "accent",
    description: "Moves selected by the real production runnable frontier. Disabled rows identify frontier selections the Lab cannot drive.",
    title: "Production frontier selections"
  },
  FakeTaskTracker: {
    availableStatus: "LAB TRACKER INPUT AVAILABLE",
    buttonKind: "outline",
    description: "Select which Lab fake task-tracker target is controlled, or ask production to read it. Task editing and saving happen separately.",
    title: "Fake task-tracker selection and read"
  },
  LabProductionStageControl: {
    availableStatus: "LAB WORKFLOW CONTROL AVAILABLE",
    buttonKind: "",
    description: "The Lab's fixed prototype driver selects which production stage to invoke next, including fresh-read and executor-replay conveniences. Production executes those stages but does not select these UI moves.",
    title: "Lab workflow-driver controls"
  },
  LabResponsibilitySelectorInput: {
    availableStatus: "LAB SELECTOR INPUT AVAILABLE",
    buttonKind: "",
    description: "Synthetic Lab scenario inputs for production's responsibility selector, including disposition and fact-cardinality cases. They are not authoritative evidence.",
    title: "Lab responsibility-selector inputs"
  },
  ProductionCoordinator: {
    availableStatus: "PRODUCTION RECOVERY CONTROL EXECUTABLE",
    buttonKind: "accent",
    description: "The real production recovery activation over responsibilities reconstructed after a coordinator restart.",
    title: "Production recovery activation"
  },
  LabFinalityInput: {
    availableStatus: "LAB FINALITY INPUT AVAILABLE",
    buttonKind: "",
    description: "Direct Lab input to the run-finality selector. It does not edit the fake task tracker.",
    title: "Lab run-finality inputs"
  },
  LabCoordinatorSimulation: {
    availableStatus: "LAB SCENARIO INPUT AVAILABLE",
    buttonKind: "",
    description: "Change only the Lab's in-memory exploration scenario: coordinator process lifetime or task-work capacity.",
    title: "Lab coordinator simulation"
  },
  FakeBoundarySetup: {
    availableStatus: "LAB BOUNDARY SETUP AVAILABLE",
    buttonKind: "",
    description: "Choose what a later fake task-runner, executor, reviewer, or handback boundary returns. These are setup inputs, not production-selected moves.",
    title: "Fake boundary outcomes"
  },
  OperatorControlRequest: {
    availableStatus: "REQUEST CAN BE RECORDED",
    buttonKind: "",
    description: "Invoke production command recording. Task IDs come from fake tracker authority, even before observation; a recorded request does not prove pause state changed.",
    title: "Recorded operator control requests"
  }
} as const satisfies Record<typeof LabMoveOrigin.Type, {
  readonly availableStatus: LabDisplayActionStatus
  readonly buttonKind: string
  readonly description: string
  readonly title: string
}>

const statusLabel = (move: LabMove): LabDisplayActionStatus => {
  switch (move.availability._tag) {
    case "Available":
      return groupPresentationByOrigin[move.origin].availableStatus
    case "Waiting": return "WAITING"
    case "NotCurrent": return "CURRENT VALUE"
    case "DriverMissing": return "NOT EXECUTABLE IN LAB"
    case "Planned": return "PLANNED, NOT EXECUTABLE"
  }
}

const displayAction = (move: LabMove, snapshot: LabSnapshot): LabDisplayAction => {
  const availabilityTag = move.availability._tag
  const reason = move.availability._tag === "Available"
    ? availableReason(move)
    : unavailableReason(
      move.availability.reason,
      "owningIssue" in move.availability ? move.availability.owningIssue : undefined
    )
  return {
    buttonKind: groupPresentationByOrigin[move.origin].buttonKind,
    cssClass: availabilityTag.toLowerCase(),
    enabled: availabilityTag === "Available",
    label: moveLabel(move, snapshot),
    moveId: move.id,
    reason,
    status: statusLabel(move)
  }
}

const actionGroups = LabMoveOrigin.literals.map((key) => ({
  key,
  ...groupPresentationByOrigin[key]
}))

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
  const latestTasks = snapshot.latestObservation._tag === "Available"
    ? snapshot.latestObservation.tasks
    : []
  const latestEdges = edgesFor(latestTasks)
  const authorityFingerprint = fingerprint(authorityTasks, authorityEdges, snapshot.authorityIssues)
  const latestFingerprint = fingerprint(latestTasks, latestEdges, [])
  const latestExists = snapshot.latestObservation._tag === "Available"
  const observationFailed = snapshot.observationAttempt._tag === "Failed"
  const observationDiscarded =
    snapshot.latestObservation._tag === "DiscardedOnCoordinatorCrash"
  return [
    projection(
      "Latest",
      "Latest successful normalized observation",
      latestExists
        ? observationFailed
          ? "Prior successful read; latest attempt failed"
          : "Most recently seen successfully by Dalph"
        : observationDiscarded
          ? "Unavailable after coordinator crash; observe again"
          : "No successful observation",
      latestTasks,
      latestEdges,
      [],
      !latestExists || authorityFingerprint !== latestFingerprint
    ),
    projection(
      "Authority",
      "Lab fake task-tracker authority",
      snapshot.authorityIssues.length === 0
        ? "Current facts in the Lab's fake tracker"
        : "The Lab's current fake tracker facts are intentionally invalid",
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
  actionGroups: actionGroups.map(({ description, key, title }) => ({
    actions: snapshot.moves
      .filter(({ origin }) => origin === key)
      .map((move) => displayAction(move, snapshot)),
    description,
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
  recoveryDiagnosticsSummary: `${
    snapshot.graphKnowledge.length
  } retained target closure${snapshot.graphKnowledge.length === 1 ? "" : "s"}`,
  notes: [
    "Task-card Save changes only the Lab's fake tracker. Observe asks Dalph to cross the task-tracker read boundary.",
    "The Lab's journaled fake claim adapter records an exact claim; Dalph checks it and rereads current fake tracker facts before planning.",
    "The orchestrator sees opaque executor invocations. Review strategy and review events stay inside the selected executor protocol.",
    "Opaque executor invocations cross journaled production boundaries and are shown by ordinal; the coordinator control runs the current path to completion without repeated clicks.",
    "Pause and unpause controls record production ControlCommandRecorded events. Production reconstruction still reports RunUnpaused / NoTaskPauses until the later pause-state issues land.",
    "Production has not implemented the specified active-continuation reread before every later executor invocation; the Lab does not fabricate it.",
    "Invalid tracker topology records observation intent and a typed failure, but no successful outcome.",
    "Durable recovery diagnostics retain membership only, never task topology or current authority.",
    "The browser build still uses the documented temporary Node-platform shim."
  ],
  observationStatus:
    snapshot.latestObservation._tag === "DiscardedOnCoordinatorCrash"
      ? "Volatile observation discarded by coordinator crash · observe again"
      : snapshot.observationAttempt._tag === "NeverAttempted"
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
    `Observed: [${
      snapshot.latestObservation._tag === "Available"
        ? snapshot.latestObservation.tasks.map(({ id }) => id).join(", ")
        : "nothing"
    }].`
})
