import { Schema as S } from "effect"
import {
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

/** Display-ready projection consumed by FoldKit without domain inference. */
export const LabViewModel = S.Struct({
  actionGroups: S.Array(LabActionGroup),
  admittedRows: S.Array(S.String),
  capacityStatus: S.String,
  coordinatorClass: S.String,
  coordinatorStatus: S.String,
  errors: S.Array(S.String),
  explanationRows: S.Array(S.String),
  finality: S.String,
  frontierRows: S.Array(S.String),
  graphKnowledgeRows: S.Array(S.String),
  journal: S.Array(LabJournalRow),
  knownTasksMetric: S.String,
  notes: S.Array(S.String),
  reservedTasksMetric: S.String,
  responsibilityRows: S.Array(S.String),
  revision: S.String,
  runPause: S.String,
  status: S.String,
  taskPause: S.String,
  timelineLabels: S.Array(S.String),
  trackerAuthorityState: S.String
})
export interface LabViewModel extends S.Schema.Type<typeof LabViewModel> {}

const inputLabel = (action: LabAction): string => {
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

const subjectTask = (move: LabMove): string =>
  move.subject._tag === "Task" ? move.subject.task : ""

const moveLabel = (move: LabMove): string => {
  const task = subjectTask(move)
  switch (move.transition) {
    case "SetTrackerTaskPresence":
      return move.availability._tag === "Available" &&
          move.availability.input._tag === "EditedTrackerTask"
        ? `${move.availability.input.present ? "Add" : "Remove"} task ${task} in tracker`
        : `Change task ${task} tracker presence`
    case "ObserveTrackerTarget": return "Observe tracker target closure"
    case "SupplyReadyFact": return `Ready fact · ${task}`
    case "SupplyForeignClaimFact": return `Foreign claim fact · ${task}`
    case "SupplyMissingClaimFact": return `Missing claim fact · ${task}`
    case "SupplyPausedFact": return `Paused fact · ${task}`
    case "CrashCoordinator": return "Crash coordinator"
    case "RestartCoordinator": return "Restart coordinator"
    case "SetTaskWorkCapacity":
      return move.subject._tag === "Capacity"
        ? `Set capacity to ${move.subject.capacity}`
        : "Set capacity"
    case "PauseRun": return "Pause run"
    case "PauseTask": return "Pause task"
    case "CommitFreshTaskClaimIntent": return `Commit fresh claim intent · ${task}`
    default: return `${move.transition} · ${task}`
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
      return `The real frontier selected this move, but the Lab driver cannot execute it yet (${owningIssue ?? "unowned"}).`
    case "ProductionPauseStateAbsent":
      return `Production reconstruction does not yet represent this pause state (${owningIssue ?? "unowned"}).`
  }
}

const displayAction = (move: LabMove): LabDisplayAction => {
  const status = move.availability._tag
  const reason = status === "Available"
    ? move.origin === "TrackerAuthority"
      ? "Changes or rereads the controlled tracker boundary; reconstructed state changes only after an observation."
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
  { key: "TrackerAuthority", title: "Controlled tracker boundary" },
  { key: "CoordinatorProcess", title: "Process controls" },
  { key: "LabCapability", title: "Production capability gaps" }
] as const

/** Converts one semantic snapshot into all wording, grouping, ordering, and styling intent. */
export const presentLab = (snapshot: LabSnapshot): LabViewModel => ({
  actionGroups: actionGroups.map(({ key, title }) => ({
    actions: snapshot.moves
      .filter(({ origin }) => origin === key)
      .map(displayAction),
    key,
    title
  })),
  admittedRows: snapshot.admitted.map(({ tag, task }) => `${task} · ${tag}`),
  capacityStatus: `${snapshot.status} · capacity ${snapshot.capacity}`,
  coordinatorClass: snapshot.coordinatorRunning ? "good" : "stopped",
  coordinatorStatus: snapshot.coordinatorRunning
    ? "Coordinator running"
    : "Coordinator crashed",
  errors: snapshot.errors,
  explanationRows: snapshot.explanations.map(({ tag, task }) =>
    task === null ? tag : `${tag} · ${task}`
  ),
  finality: snapshot.finalityReason === null
    ? snapshot.finalityTag
    : `${snapshot.finalityTag} · ${snapshot.finalityReason}`,
  frontierRows: snapshot.frontier.map(({ tag, task }) => `${task} · ${tag}`),
  graphKnowledgeRows: snapshot.graphKnowledge.map(({ kind, observationCount, tasks }) =>
    tasks.length > 0
      ? `${kind} · [${tasks.join(", ")}]`
      : `${kind} · ${observationCount} observations`
  ),
  journal: snapshot.journal,
  knownTasksMetric: `Known tasks: ${snapshot.knownTasks.join(", ") || "none"}`,
  notes: [
    "Eligibility [A, C] is a fresh tracker input to the selector; it is not persisted frontier state.",
    "The pure fold still reaches a Node platform import through the all-events schema; this browser prototype shims that unused adapter.",
    snapshot.coordinatorRunning
      ? "The coordinator is running, so admitted transitions can be triggered."
      : "The coordinator is stopped. Reducers still reconstruct the journal, but no transition is activated.",
    "Pause facts can reach the selector, but production reconstructed pause state remains unimplemented."
  ],
  reservedTasksMetric: `Reserved: ${snapshot.reservedTasks.join(", ") || "none"}`,
  responsibilityRows: snapshot.responsibilities.map(({ beganAt, kind, task }) =>
    `${task} · ${kind} · began at journal #${beganAt}`
  ),
  revision: snapshot.revision,
  runPause: snapshot.runPause,
  status: snapshot.status,
  taskPause: snapshot.taskPause,
  timelineLabels: snapshot.input.actions.map(inputLabel),
  trackerAuthorityState:
    `Tracker authority now: [${snapshot.trackerTasks.join(", ") || "empty"}]. ` +
    `Dalph last observed: [${snapshot.knownTasks.join(", ") || "nothing"}].`
})
