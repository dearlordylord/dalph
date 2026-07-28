import { Effect, Schema as S } from "effect"
import { Command, Runtime } from "foldkit"
import { type Document, html } from "foldkit/html"
import { m } from "foldkit/message"
import { reducerLabGraph } from "./graph-element.ts"
import {
  ControlledTask,
  executeLabCommand,
  executeLabMove,
  LabAction,
  LabInput,
  LabMoveExecution,
  LabMoveId,
  LabSnapshot,
  LabSnapshotRevision,
  LabTaskLifecycle,
  reconstructLabSnapshot,
  type TrackerClaimState
} from "./lab-engine.ts"
import {
  type GraphProjectionSelection,
  LabViewModel,
  presentLab,
  type GraphTask,
  type LabDisplayAction,
  type TaskGraphProjection
} from "./lab-presenter.ts"

const Branch = S.Struct({
  actions: S.Array(LabAction),
  cursor: S.Number,
  id: S.Number,
  name: S.String
})
type Branch = typeof Branch.Type

const TaskDraft = S.Struct({
  body: S.String,
  id: S.String,
  lifecycle: LabTaskLifecycle,
  originalTaskId: S.NullOr(S.String),
  parentTaskId: S.String,
  prerequisiteIds: S.String,
  title: S.String
})
type TaskDraft = typeof TaskDraft.Type

export const Model = S.Struct({
  activeBranchId: S.Number,
  branches: S.Array(Branch),
  editorError: S.NullOr(S.String),
  graphSelection: S.Literals(["Auto", "Latest", "Authority", "Durable", "Compare"]),
  interactionError: S.NullOr(S.String),
  nextBranchId: S.Number,
  requestId: S.Number,
  selectedTaskId: S.NullOr(S.String),
  snapshot: S.NullOr(LabSnapshot),
  taskDraft: S.NullOr(TaskDraft),
  viewModel: LabViewModel
})
export type Model = typeof Model.Type

const ForkedAtCursor = m("ForkedAtCursor")
const MovedCursor = m("MovedCursor", { cursor: S.Number })
const SnapshotReady = m("SnapshotReady", {
  requestId: S.Number,
  snapshot: LabSnapshot,
  viewModel: LabViewModel
})
const SelectedBranch = m("SelectedBranch", { branchId: S.Number })
const SelectedGraphProjection = m("SelectedGraphProjection", {
  selection: S.Literals(["Auto", "Latest", "Authority", "Durable", "Compare"])
})
const SelectedGraphTask = m("SelectedGraphTask", { taskId: S.String })
const StartedNewTask = m("StartedNewTask")
const StartedEditingTask = m("StartedEditingTask", { taskId: S.String })
const CancelledTaskEdit = m("CancelledTaskEdit")
const ChangedTaskDraft = m("ChangedTaskDraft", {
  field: S.Literals(["body", "id", "lifecycle", "parentTaskId", "prerequisiteIds", "title"]),
  value: S.String
})
const SavedTaskDraft = m("SavedTaskDraft")
const TriggeredLabMove = m("TriggeredLabMove", {
  moveId: LabMoveId,
  snapshotRevision: LabSnapshotRevision
})
const TriggeredLabCommand = m("TriggeredLabCommand", {
  input: LabAction,
  snapshotRevision: LabSnapshotRevision
})

const LabExecutionResult = S.Union([
  S.TaggedStruct("Executed", { execution: LabMoveExecution }),
  S.TaggedStruct("Rejected", { reason: S.String })
])

const LabExecutionFinished = m("LabExecutionFinished", {
  requestId: S.Number,
  result: LabExecutionResult
})

export const Message = S.Union([
  CancelledTaskEdit,
  ChangedTaskDraft,
  ForkedAtCursor,
  LabExecutionFinished,
  MovedCursor,
  SavedTaskDraft,
  SelectedBranch,
  SelectedGraphProjection,
  SelectedGraphTask,
  SnapshotReady,
  StartedEditingTask,
  StartedNewTask,
  TriggeredLabCommand,
  TriggeredLabMove
])
export type Message = typeof Message.Type

const emptyViewModel: LabViewModel = {
  actionGroups: [],
  admittedRows: [],
  capacityStatus: "computing · capacity 1",
  claimRows: [],
  coordinatorClass: "good",
  coordinatorStatus: "Coordinator state computing",
  errors: [],
  explanationRows: [],
  finality: "computing",
  frontierRows: [],
  graphKnowledgeRows: [],
  graphProjections: [],
  journal: [],
  knownTasksMetric: "Known tasks: computing",
  notes: [],
  observationStatus: "computing",
  reservedTasksMetric: "Reserved: computing",
  responsibilityRows: [],
  workflowRows: [],
  revision: "computing",
  runPause: "computing",
  status: "computing",
  targetSettlement: "computing",
  taskPause: "computing",
  timelineLabels: [],
  trackerAuthorityState: "Tracker authority and Dalph observation are computing."
}

const ComputeSnapshot = Command.define(
  "ComputeSnapshot",
  {
    input: LabInput,
    requestId: S.Number
  },
  SnapshotReady
)(({ input, requestId }) =>
  reconstructLabSnapshot(input).pipe(
    Effect.map((snapshot) =>
      SnapshotReady({
        requestId,
        snapshot,
        viewModel: presentLab(snapshot)
      })
    )
  )
)

const rejection = (failure: { readonly _tag: string; readonly availability?: string }) =>
  failure._tag === "StaleLabSnapshot"
    ? "Command rejected: the displayed snapshot is stale."
    : failure._tag === "UnknownLabMove"
      ? "Move rejected: it is not present in this snapshot."
      : failure._tag === "UnavailableLabMove"
        ? `Move rejected: its availability is ${failure.availability}.`
        : "The graph-editor command is not accepted by this driver."

const ExecuteLabMove = Command.define(
  "ExecuteLabMove",
  {
    expectedRevision: LabSnapshotRevision,
    moveId: LabMoveId,
    requestId: S.Number,
    snapshot: LabSnapshot
  },
  LabExecutionFinished
)(({ expectedRevision, moveId, requestId, snapshot }) =>
  executeLabMove(snapshot, moveId, expectedRevision).pipe(
    Effect.match({
      onFailure: (failure) =>
        LabExecutionFinished({
          requestId,
          result: { _tag: "Rejected", reason: rejection(failure) }
        }),
      onSuccess: (execution) =>
        LabExecutionFinished({
          requestId,
          result: { _tag: "Executed", execution }
        })
    })
  )
)

const ExecuteLabCommand = Command.define(
  "ExecuteLabCommand",
  {
    expectedRevision: LabSnapshotRevision,
    input: LabAction,
    requestId: S.Number,
    snapshot: LabSnapshot
  },
  LabExecutionFinished
)(({ expectedRevision, input, requestId, snapshot }) =>
  executeLabCommand(snapshot, input, expectedRevision).pipe(
    Effect.match({
      onFailure: (failure) =>
        LabExecutionFinished({
          requestId,
          result: { _tag: "Rejected", reason: rejection(failure) }
        }),
      onSuccess: (execution) =>
        LabExecutionFinished({
          requestId,
          result: { _tag: "Executed", execution }
        })
    })
  )
)

const activeBranch = (model: Model): Branch =>
  model.branches.find(({ id }) => id === model.activeBranchId) ?? model.branches[0]!

const replaceBranch = (model: Model, nextBranch: Branch): ReadonlyArray<Branch> =>
  model.branches.map((branch) => branch.id === nextBranch.id ? nextBranch : branch)

const recompute = (
  model: Model,
  branches: ReadonlyArray<Branch> = model.branches,
  activeBranchId: number = model.activeBranchId
): readonly [Model, ReadonlyArray<Command.Command<Message>>] => {
  const branch = branches.find(({ id }) => id === activeBranchId) ?? branches[0]!
  const requestId = model.requestId + 1
  return [
    {
      ...model,
      activeBranchId,
      branches,
      editorError: null,
      interactionError: null,
      requestId,
      taskDraft: null
    },
    [ComputeSnapshot({
      input: { actions: branch.actions.slice(0, branch.cursor) },
      requestId
    })]
  ]
}

const blankTaskDraft = (): TaskDraft => ({
  body: "",
  id: "",
  lifecycle: "Open",
  originalTaskId: null,
  parentTaskId: "",
  prerequisiteIds: "",
  title: ""
})

const taskDraftFor = (task: ControlledTask): TaskDraft => ({
  body: task.body,
  id: task.id,
  lifecycle: task.lifecycle,
  originalTaskId: task.id,
  parentTaskId: task.parentTaskId ?? "",
  prerequisiteIds: task.prerequisiteIds.join(", "),
  title: task.title
})

const normalizedTask = (draft: TaskDraft): ControlledTask => ({
  body: draft.body.trim(),
  id: draft.id.trim(),
  lifecycle: draft.lifecycle,
  parentTaskId: draft.parentTaskId.trim() === "" ? null : draft.parentTaskId.trim(),
  prerequisiteIds: draft.prerequisiteIds
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== ""),
  title: draft.title.trim()
})

const atBranchTip = (model: Model): boolean => {
  const branch = activeBranch(model)
  return branch.cursor === branch.actions.length
}

const triggerCommand = (
  model: Model,
  input: LabAction,
  expectedRevision: LabSnapshotRevision
): readonly [Model, ReadonlyArray<Command.Command<Message>>] => {
  if (!atBranchTip(model) || model.snapshot === null) return [model, []]
  const requestId = model.requestId + 1
  return [
    { ...model, editorError: null, interactionError: null, requestId },
    [ExecuteLabCommand({
      expectedRevision,
      input,
      requestId,
      snapshot: model.snapshot
    })]
  ]
}

export const update = (
  model: Model,
  message: Message
): readonly [Model, ReadonlyArray<Command.Command<Message>>] => {
  switch (message._tag) {
    case "StartedNewTask":
      return atBranchTip(model)
        ? [{ ...model, editorError: null, taskDraft: blankTaskDraft() }, []]
        : [model, []]
    case "StartedEditingTask": {
      const task = model.snapshot?.trackerTasks.find(({ id }) => id === message.taskId)
      return task === undefined || !atBranchTip(model)
        ? [model, []]
        : [{
          ...model,
          editorError: null,
          selectedTaskId: task.id,
          taskDraft: taskDraftFor(task)
        }, []]
    }
    case "CancelledTaskEdit":
      return [{ ...model, editorError: null, taskDraft: null }, []]
    case "ChangedTaskDraft":
      if (model.taskDraft === null) return [model, []]
      if (message.field === "lifecycle" && !LabTaskLifecycle.literals.includes(
        message.value as LabTaskLifecycle
      )) return [model, []]
      return [{
        ...model,
        editorError: null,
        taskDraft: {
          ...model.taskDraft,
          [message.field]: message.value
        } as TaskDraft
      }, []]
    case "SavedTaskDraft": {
      if (model.taskDraft === null || model.snapshot === null) return [model, []]
      const task = normalizedTask(model.taskDraft)
      if (task.id === "" || task.title === "") {
        return [{
          ...model,
          editorError: "Task ID and normalized title are required."
        }, []]
      }
      const duplicate = model.taskDraft.originalTaskId === null
        && model.snapshot.trackerTasks.some(({ id }) => id === task.id)
      if (duplicate) {
        return [{ ...model, editorError: `Task ID ${task.id} already exists.` }, []]
      }
      return triggerCommand(
        model,
        { _tag: "ReplacedTrackerTask", task },
        model.snapshot.revision
      )
    }
    case "SelectedGraphProjection":
      return [{ ...model, graphSelection: message.selection }, []]
    case "SelectedGraphTask":
      return [{ ...model, selectedTaskId: message.taskId }, []]
    case "TriggeredLabCommand":
      return triggerCommand(model, message.input, message.snapshotRevision)
    case "TriggeredLabMove": {
      const branch = activeBranch(model)
      if (branch.cursor !== branch.actions.length || model.snapshot === null) {
        return [model, []]
      }
      const requestId = model.requestId + 1
      return [
        { ...model, interactionError: null, requestId },
        [ExecuteLabMove({
          expectedRevision: message.snapshotRevision,
          moveId: message.moveId,
          requestId,
          snapshot: model.snapshot
        })]
      ]
    }
    case "LabExecutionFinished": {
      if (message.requestId !== model.requestId) return [model, []]
      if (message.result._tag === "Rejected") {
        return [{ ...model, interactionError: message.result.reason }, []]
      }
      const branch = activeBranch(model)
      const { input, snapshot } = message.result.execution
      const nextBranch = {
        ...branch,
        actions: [...branch.actions, input],
        cursor: branch.cursor + 1
      }
      return [{
        ...model,
        branches: replaceBranch(model, nextBranch),
        editorError: null,
        interactionError: null,
        selectedTaskId: input._tag === "DeletedTrackerTask"
          ? null
          : input._tag === "ReplacedTrackerTask"
            ? input.task.id
            : model.selectedTaskId,
        snapshot,
        taskDraft: input._tag === "ReplacedTrackerTask"
          || input._tag === "DeletedTrackerTask"
          ? null
          : model.taskDraft,
        viewModel: presentLab(snapshot)
      }, []]
    }
    case "ForkedAtCursor": {
      const branch = activeBranch(model)
      const fork: Branch = {
        actions: branch.actions.slice(0, branch.cursor),
        cursor: branch.cursor,
        id: model.nextBranchId,
        name: `branch ${model.nextBranchId}`
      }
      return recompute(
        { ...model, nextBranchId: model.nextBranchId + 1 },
        [...model.branches, fork],
        fork.id
      )
    }
    case "MovedCursor": {
      const branch = activeBranch(model)
      const cursor = Math.max(0, Math.min(message.cursor, branch.actions.length))
      return recompute(model, replaceBranch(model, { ...branch, cursor }))
    }
    case "SnapshotReady":
      return message.requestId === model.requestId
        ? [{
          ...model,
          snapshot: message.snapshot,
          viewModel: message.viewModel
        }, []]
        : [model, []]
    case "SelectedBranch":
      return recompute(model, model.branches, message.branchId)
  }
}

export const init: Runtime.ApplicationInit<Model, Message> = () => {
  const model: Model = {
    activeBranchId: 1,
    branches: [{ actions: [], cursor: 0, id: 1, name: "main" }],
    editorError: null,
    graphSelection: "Auto",
    interactionError: null,
    nextBranchId: 2,
    requestId: 1,
    selectedTaskId: null,
    snapshot: null,
    taskDraft: null,
    viewModel: emptyViewModel
  }
  return [
    model,
    [ComputeSnapshot({ input: { actions: [] }, requestId: 1 })]
  ]
}

type HtmlFactory = ReturnType<typeof html<Message>>
const graphElement = reducerLabGraph.withMessage<Message>()

const button = (
  h: HtmlFactory,
  label: string,
  message: Message,
  disabled = false,
  kind = ""
) => h.button(
  [
    h.Class(`button ${kind}`),
    h.Disabled(disabled),
    ...(disabled ? [] : [h.OnClick(message)])
  ],
  [label]
)

const listOrEmpty = (
  h: HtmlFactory,
  values: ReadonlyArray<string>,
  empty: string
) => values.length === 0
  ? h.p([h.Class("empty")], [empty])
  : h.ul([], values.map((value) => h.li([], [value])))

const stateCard = (
  h: HtmlFactory,
  title: string,
  content: ReturnType<HtmlFactory["div"]>,
  eyebrow: string
) => h.section([h.Class("card")], [
  h.p([h.Class("eyebrow")], [eyebrow]),
  h.h2([], [title]),
  content
])

const actionButton = (
  h: HtmlFactory,
  action: LabDisplayAction,
  snapshotRevision: LabSnapshotRevision | null,
  locked: boolean
) => h.div([h.Class(`driver-action ${action.cssClass}`)], [
  button(
    h,
    action.label,
    TriggeredLabMove({
      moveId: action.moveId,
      snapshotRevision: snapshotRevision ?? LabSnapshotRevision.make("snapshot-unavailable")
    }),
    locked || !action.enabled || snapshotRevision === null,
    action.buttonKind
  ),
  h.p([h.Class("action-reason")], [`${action.status} · ${action.reason}`])
])

const actionGroup = (
  h: HtmlFactory,
  title: string,
  actions: ReadonlyArray<LabDisplayAction>,
  snapshotRevision: LabSnapshotRevision | null,
  locked: boolean
) => h.section([h.Class("action-group")], [
  h.p([h.Class("label")], [title]),
  actions.length === 0
    ? h.p([h.Class("empty")], ["No moves in this category."])
    : h.div(
      [h.Class("action-list")],
      actions.map((action) => actionButton(h, action, snapshotRevision, locked))
    )
])

const field = (
  h: HtmlFactory,
  label: string,
  control: ReturnType<HtmlFactory["input"]> | ReturnType<HtmlFactory["textarea"]>
    | ReturnType<HtmlFactory["select"]>,
  hint?: string
) => h.label([h.Class("field")], [
  h.span([h.Class("label")], [label]),
  control,
  hint === undefined ? null : h.span([h.Class("field-hint")], [hint])
])

const taskEditor = (
  h: HtmlFactory,
  model: Model,
  locked: boolean
) => {
  const draft = model.taskDraft
  if (draft === null) {
    return h.div([h.Class("editor-empty")], [
      h.p([], ["Select a tracker-authority task card to edit it, or create a task."]),
      button(h, "New tracker task", StartedNewTask(), locked, "accent")
    ])
  }
  const change = (
    fieldName: "body" | "id" | "lifecycle" | "parentTaskId" | "prerequisiteIds" | "title"
  ) => (value: string) => ChangedTaskDraft({ field: fieldName, value })
  return h.div([h.Class("task-editor")], [
    h.div([h.Class("editor-heading")], [
      h.div([], [
        h.p([h.Class("eyebrow")], [
          draft.originalTaskId === null ? "NEW AUTHORITY RECORD" : "EDIT AUTHORITY RECORD"
        ]),
        h.h3([], [draft.originalTaskId === null ? "Create task" : `Edit ${draft.id}`])
      ]),
      button(h, "Cancel", CancelledTaskEdit(), false, "compact outline")
    ]),
    h.div([h.Class("form-grid")], [
      field(h, "Stable TaskId", h.input([
        h.Type("text"),
        h.Value(draft.id),
        h.Disabled(draft.originalTaskId !== null),
        h.OnInput(change("id"))
      ]), draft.originalTaskId === null ? "Immutable after the first save." : "Task identity is immutable."),
      field(h, "Lifecycle", h.select([
        h.OnChange(change("lifecycle"))
      ], (["Open", "CompletedSuccessfully", "TerminalWithoutSuccess"] as const).map((value) =>
        h.option([h.Value(value), h.Selected(draft.lifecycle === value)], [value])
      ))),
      field(h, "Normalized title", h.input([
        h.Type("text"),
        h.Value(draft.title),
        h.OnInput(change("title"))
      ])),
      field(h, "Parent / group TaskId", h.input([
        h.Type("text"),
        h.Value(draft.parentTaskId),
        h.OnInput(change("parentTaskId"))
      ]), "May intentionally name a missing or self parent."),
      field(h, "Prerequisite TaskIds", h.input([
        h.Type("text"),
        h.Value(draft.prerequisiteIds),
        h.OnInput(change("prerequisiteIds"))
      ]), "Comma-separated; duplicates and missing endpoints are preserved."),
      field(h, "Normalized body", h.textarea([
        h.Value(draft.body),
        h.OnInput(change("body"))
      ], []))
    ]),
    model.editorError === null ? null : h.p([h.Class("error")], [model.editorError]),
    h.div([h.Class("button-row")], [
      button(h, "Save to tracker authority", SavedTaskDraft(), locked, "accent"),
      draft.originalTaskId === null || model.snapshot === null
        ? null
        : button(
          h,
          "Delete task",
          TriggeredLabCommand({
            input: { _tag: "DeletedTrackerTask", taskId: draft.id },
            snapshotRevision: model.snapshot.revision
          }),
          locked,
          "danger"
        )
    ]),
    h.p([h.Class("boundary-note")], [
      "Save appends a replayable Lab command. It does not observe the tracker."
    ])
  ])
}

const visibleProjections = (
  projections: ReadonlyArray<TaskGraphProjection>,
  selection: GraphProjectionSelection
): ReadonlyArray<TaskGraphProjection> => {
  if (selection === "Compare") return projections
  if (selection !== "Auto") return projections.filter(({ key }) => key === selection)
  const seen = new Set<string>()
  return projections.filter(({ fingerprint }) => {
    if (seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  })
}

const graphTaskCard = (
  h: HtmlFactory,
  task: GraphTask,
  projection: TaskGraphProjection,
  selectedTaskId: string | null,
  canEdit: boolean
) => h.article([
  h.Class(`graph-task ${selectedTaskId === task.id ? "selected" : ""}`),
  h.OnClick(SelectedGraphTask({ taskId: task.id }))
], [
  h.div([h.Class("graph-task-heading")], [
    h.div([], [
      h.p([h.Class("task-id")], [task.id]),
      h.h3([], [task.title])
    ]),
    h.span([h.Class(`lifecycle ${task.lifecycle.toLowerCase()}`)], [task.lifecycle])
  ]),
  task.body === "" ? null : h.p([h.Class("task-body")], [task.body]),
  h.dl([h.Class("task-facts")], [
    h.dt([], ["Prerequisites"]),
    h.dd([], [task.prerequisiteIds.join(", ") || "none"]),
    h.dt([], ["Parent"]),
    h.dd([], [task.parentTaskId ?? "none"])
  ]),
  canEdit && projection.key === "Authority"
    ? button(h, "Edit tracker record", StartedEditingTask({ taskId: task.id }), false, "compact outline")
    : null
])

const graphProjection = (
  h: HtmlFactory,
  projection: TaskGraphProjection,
  selectedTaskId: string | null,
  canEdit: boolean
) => h.section([h.Class(`graph-projection projection-${projection.key.toLowerCase()}`)], [
  h.div([h.Class("projection-heading")], [
    h.div([], [
      h.p([h.Class("eyebrow")], [projection.key]),
      h.h3([], [projection.label])
    ]),
    h.span([h.Class(`status ${projection.stale ? "stale" : "good"}`)], [
      projection.stale ? "STALE" : "CURRENT FOR ITS BOUNDARY"
    ])
  ]),
  h.p([h.Class("projection-status")], [projection.status]),
  projection.diagnostics.length === 0
    ? null
    : h.ul([h.Class("diagnostics")], projection.diagnostics.map((diagnostic) =>
      h.li([], [diagnostic])
    )),
  graphElement([
    graphElement.Projection(projection),
    graphElement.SelectedTaskId(selectedTaskId),
    graphElement.OnTaskSelected(({ taskId }) => SelectedGraphTask({ taskId }))
  ], []),
  h.div([h.Class("graph-legend")], [
    h.span([h.Class("legend-prerequisite")], ["→ blocks"]),
    h.span([h.Class("legend-grouping")], ["◇ contains"]),
    h.span([], ["Drag to pan · scroll to zoom · select a node to synchronize projections"])
  ]),
  projection.tasks.length === 0
    ? null
    : h.div([h.Class("task-card-strip")], projection.tasks.map((task) =>
      graphTaskCard(h, task, projection, selectedTaskId, canEdit)
    ))
])

const claimControls = (
  h: HtmlFactory,
  model: Model,
  locked: boolean
) => {
  const revision = model.snapshot?.revision
  return h.div([h.Class("claim-grid")], model.viewModel.claimRows.map(({ state, taskId }) =>
    h.div([h.Class("claim-row")], [
      h.div([], [
        h.strong([], [taskId]),
        h.span([h.Class("claim-state")], [state])
      ]),
      h.div([h.Class("button-row")], (
        ["Unclaimed", "OwnedByLab", "Foreign"] as const
      ).map((nextState: TrackerClaimState) =>
        button(
          h,
          nextState,
          TriggeredLabCommand({
            input: { _tag: "SetTrackerClaim", state: nextState, taskId },
            snapshotRevision: revision ?? LabSnapshotRevision.make("snapshot-unavailable")
          }),
          locked || revision === undefined || state === nextState,
          "compact outline"
        )
      ))
    ])
  ))
}

export const view = (model: Model): Document => {
  const h = html<Message>()
  const branch = activeBranch(model)
  const atTip = branch.cursor === branch.actions.length
  const viewModel = model.viewModel
  const snapshotRevision = model.snapshot?.revision ?? null
  const projections = visibleProjections(viewModel.graphProjections, model.graphSelection)

  return {
    title: "Dalph reducer lab",
    body: h.main([h.Class("shell")], [
      h.header([h.Class("hero")], [
        h.div([], [
          h.p([h.Class("kicker")], ["THROWAWAY PROTOTYPE · BROWSER ONLY"]),
          h.h1([], ["Reducer lab"]),
          h.p([h.Class("lede")], [
            "Edit fake tracker authority, observe it through Dalph’s graph boundary, then inspect production reconstruction, frontier, admission, and finality."
          ])
        ]),
        h.div([h.Class("status-stack")], [
          h.span([h.Class(`status ${viewModel.coordinatorClass}`)], [
            viewModel.coordinatorStatus
          ]),
          h.span([h.Class("status")], [viewModel.capacityStatus]),
          h.span([h.Class("status")], [`Target ${viewModel.targetSettlement}`])
        ])
      ]),

      h.section([h.Class("toolbar")], [
        h.div([h.Class("toolbar-group")], [
          h.span([h.Class("label")], ["Branch"]),
          ...model.branches.map(({ id, name }) =>
            button(h, name, SelectedBranch({ branchId: id }), id === model.activeBranchId, "compact")
          ),
          button(h, "Fork at cursor", ForkedAtCursor(), false, "compact accent")
        ]),
        !atTip
          ? h.p([h.Class("time-travel-note")], [
            "Inspecting history. Fork here before adding another input."
          ])
          : null
      ]),

      h.div([h.Class("workspace")], [
        h.aside([h.Class("timeline card")], [
          h.p([h.Class("eyebrow")], ["INPUT HISTORY"]),
          h.h2([], [`${branch.name} · cursor ${branch.cursor}/${branch.actions.length}`]),
          h.ol([h.Class("steps")], [
            h.li([], [
              button(h, "0 · Empty input history", MovedCursor({ cursor: 0 }), branch.cursor === 0, "step")
            ]),
            ...viewModel.timelineLabels.map((label, index) =>
              h.li([], [
                button(
                  h,
                  `${index + 1} · ${label}`,
                  MovedCursor({ cursor: index + 1 }),
                  branch.cursor === index + 1,
                  "step"
                )
              ])
            )
          ]),
          h.div([h.Class("undo-row")], [
            button(h, "← Undo", MovedCursor({ cursor: branch.cursor - 1 }), branch.cursor === 0, "compact"),
            button(h, "Redo →", MovedCursor({ cursor: branch.cursor + 1 }), branch.cursor === branch.actions.length, "compact")
          ])
        ]),

        h.div([h.Class("main-column")], [
          h.section([h.Class("card graph-workbench")], [
            h.div([h.Class("section-heading")], [
              h.div([], [
                h.p([h.Class("eyebrow")], ["GRAPH WORKBENCH"]),
                h.h2([], ["Tracker task editor + three graph truths"])
              ]),
              h.p([h.Class("observation-status")], [viewModel.observationStatus])
            ]),
            h.p([h.Class("authority-state")], [viewModel.trackerAuthorityState]),
            h.div([h.Class("projection-tabs")], (
              ["Auto", "Latest", "Authority", "Durable", "Compare"] as const
            ).map((selection) =>
              button(
                h,
                selection,
                SelectedGraphProjection({ selection }),
                model.graphSelection === selection,
                "compact outline"
              )
            )),
            h.div([h.Class(`projection-grid projection-count-${projections.length}`)],
              projections.map((projection) =>
                graphProjection(h, projection, model.selectedTaskId, atTip)
              )
            ),
            h.div([h.Class("editor-claims-grid")], [
              h.section([h.Class("editor-panel")], [
                h.p([h.Class("eyebrow")], ["FOLDKIT-OWNED DRAFT"]),
                h.h2([], ["Task-card CRUD"]),
                taskEditor(h, model, !atTip)
              ]),
              h.section([h.Class("claims-panel")], [
                h.p([h.Class("eyebrow")], ["SEPARATE TRACKER FACT"]),
                h.h2([], ["Claims"]),
                h.p([], [
                  "Claims are not task-work content or graph edges. These controls change fake authority only."
                ]),
                claimControls(h, model, !atTip)
              ])
            ])
          ]),

          h.section([h.Class("card controls")], [
            h.p([h.Class("eyebrow")], ["SEMANTIC MOVE PALETTE"]),
            h.h2([], ["What can happen from this state?"]),
            ...viewModel.actionGroups.map(({ actions, title }) =>
              actionGroup(h, title, actions, snapshotRevision, !atTip)
            ),
            model.interactionError === null
              ? null
              : h.p([h.Class("error")], [model.interactionError])
          ]),

          h.div([h.Class("state-grid")], [
            stateCard(h, "Graph knowledge", h.div([], [
              h.p([h.Class("metric")], [viewModel.knownTasksMetric]),
              listOrEmpty(
                h,
                viewModel.graphKnowledgeRows,
                "No successful graph outcome in managed history."
              )
            ]), "REAL MANAGED-HISTORY REDUCER"),
            stateCard(h, "Responsibility", h.div([], [
              listOrEmpty(
                h,
                viewModel.responsibilityRows,
                "No durable task responsibility."
              ),
              h.p([h.Class("metric")], [viewModel.reservedTasksMetric])
            ]), "REAL RESPONSIBILITY REDUCER"),
            stateCard(h, "Frontier → admission", h.div([], [
              h.p([h.Class("label")], ["Runnable frontier"]),
              listOrEmpty(h, viewModel.frontierRows, "No runnable transitions."),
              h.p([h.Class("label")], ["Admitted"]),
              listOrEmpty(h, viewModel.admittedRows, "Nothing admitted."),
              listOrEmpty(h, viewModel.explanationRows, "No wait/isolation explanation.")
            ]), "REAL SELECTOR + ADMISSION CONTROLLER"),
            stateCard(h, "Pause + finality", h.dl([], [
              h.dt([], ["Run pause"]),
              h.dd([], [viewModel.runPause]),
              h.dt([], ["Task pause"]),
              h.dd([], [viewModel.taskPause]),
              h.dt([], ["Target"]),
              h.dd([], [viewModel.targetSettlement]),
              h.dt([], ["Finality"]),
              h.dd([], [viewModel.finality])
            ]), "PRODUCTION STATE + VISIBLE GAPS")
          ]),

          stateCard(h, "Task implementation workflow", h.div([], [
            h.p([], [
              "Operation selections and dry-run results. These rows are not durable workflow-journal events."
            ]),
            listOrEmpty(
              h,
              viewModel.workflowRows,
              "Observe the tracker, then select a claim move to begin a production task workflow."
            )
          ]), "REAL PRODUCTION STAGES + DRY-RUN INTERPRETER"),

          h.section([h.Class("card journal")], [
            h.p([h.Class("eyebrow")], ["EXACT INPUT TO THE FOLD"]),
            h.h2([], ["Workflow journal"]),
            viewModel.journal.length === 0
              ? h.p([h.Class("empty")], ["No records."])
              : h.table([], [
                h.thead([], [h.tr([], [h.th([], ["#"]), h.th([], ["Durable journal event"])])]),
                h.tbody([], viewModel.journal.map(({ position, tag }) =>
                  h.tr([], [h.td([], [String(position)]), h.td([], [tag])])
                ))
              ]),
            ...viewModel.errors.map((error) => h.p([h.Class("error")], [error]))
          ]),

          h.section([h.Class("card notes")], [
            h.p([h.Class("eyebrow")], ["BOUNDARY NOTES"]),
            h.h2([], ["What the Lab is and is not claiming"]),
            h.ul([], viewModel.notes.map((note) => h.li([], [note]))),
            h.p([], [
              "All state stays in this browser tab. FoldKit owns drafts and history navigation; the driver owns replayable commands and move revalidation."
            ])
          ])
        ])
      ])
    ])
  }
}
