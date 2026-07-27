import { Effect, Schema as S } from "effect"
import { Command, Runtime } from "foldkit"
import { type Document, html } from "foldkit/html"
import { m } from "foldkit/message"
import {
  executeLabMove,
  LabAction,
  LabInput,
  LabMoveExecution,
  LabMoveId,
  LabSnapshot,
  LabSnapshotRevision,
  reconstructLabSnapshot
} from "./lab-engine.ts"
import {
  type LabDisplayAction,
  LabViewModel,
  presentLab
} from "./lab-presenter.ts"

const Branch = S.Struct({
  actions: S.Array(LabAction),
  cursor: S.Number,
  id: S.Number,
  name: S.String
})
type Branch = typeof Branch.Type

export const Model = S.Struct({
  activeBranchId: S.Number,
  branches: S.Array(Branch),
  interactionError: S.NullOr(S.String),
  nextBranchId: S.Number,
  requestId: S.Number,
  snapshot: S.NullOr(LabSnapshot),
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
const TriggeredLabMove = m("TriggeredLabMove", {
  moveId: LabMoveId,
  snapshotRevision: LabSnapshotRevision
})

const LabMoveResult = S.Union([
  S.TaggedStruct("Executed", { execution: LabMoveExecution }),
  S.TaggedStruct("Rejected", { reason: S.String })
])

const LabMoveFinished = m("LabMoveFinished", {
  requestId: S.Number,
  result: LabMoveResult
})

export const Message = S.Union([
  ForkedAtCursor,
  LabMoveFinished,
  MovedCursor,
  SelectedBranch,
  SnapshotReady,
  TriggeredLabMove
])
export type Message = typeof Message.Type

const emptyViewModel: LabViewModel = {
  actionGroups: [],
  admittedRows: [],
  capacityStatus: "computing · capacity 1",
  coordinatorClass: "good",
  coordinatorStatus: "Coordinator state computing",
  errors: [],
  explanationRows: [],
  finality: "computing",
  frontierRows: [],
  graphKnowledgeRows: [],
  journal: [],
  knownTasksMetric: "Known tasks: computing",
  notes: [],
  reservedTasksMetric: "Reserved: computing",
  responsibilityRows: [],
  revision: "computing",
  runPause: "computing",
  status: "computing",
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

const ExecuteLabMove = Command.define(
  "ExecuteLabMove",
  {
    expectedRevision: LabSnapshotRevision,
    moveId: LabMoveId,
    requestId: S.Number,
    snapshot: LabSnapshot
  },
  LabMoveFinished
)(({ expectedRevision, moveId, requestId, snapshot }) =>
  executeLabMove(snapshot, moveId, expectedRevision).pipe(
    Effect.match({
      onFailure: (failure) =>
        LabMoveFinished({
          requestId,
          result: {
            _tag: "Rejected",
            reason: failure._tag === "StaleLabSnapshot"
              ? "Move rejected: the displayed snapshot is stale."
              : failure._tag === "UnknownLabMove"
                ? "Move rejected: it is not present in this snapshot."
                : `Move rejected: its availability is ${failure.availability}.`
          }
        }),
      onSuccess: (execution) =>
        LabMoveFinished({
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
      interactionError: null,
      requestId
    },
    [ComputeSnapshot({
      input: { actions: branch.actions.slice(0, branch.cursor) },
      requestId
    })]
  ]
}

export const update = (
  model: Model,
  message: Message
): readonly [Model, ReadonlyArray<Command.Command<Message>>] => {
  switch (message._tag) {
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
    case "LabMoveFinished": {
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
        interactionError: null,
        snapshot,
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
    interactionError: null,
    nextBranchId: 2,
    requestId: 1,
    snapshot: null,
    viewModel: emptyViewModel
  }
  return [
    model,
    [ComputeSnapshot({ input: { actions: [] }, requestId: 1 })]
  ]
}

type HtmlFactory = ReturnType<typeof html<Message>>

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

export const view = (model: Model): Document => {
  const h = html<Message>()
  const branch = activeBranch(model)
  const atTip = branch.cursor === branch.actions.length
  const viewModel = model.viewModel
  const snapshotRevision = model.snapshot?.revision ?? null

  return {
    title: "Dalph reducer lab",
    body: h.main([h.Class("shell")], [
      h.header([h.Class("hero")], [
        h.div([], [
          h.p([h.Class("kicker")], ["THROWAWAY PROTOTYPE · BROWSER ONLY"]),
          h.h1([], ["Reducer lab"]),
          h.p([h.Class("lede")], [
            "Trigger semantic moves, rewind to any prefix, fork, and compare what Dalph’s current reducers actually derive."
          ])
        ]),
        h.div([h.Class("status-stack")], [
          h.span([h.Class(`status ${viewModel.coordinatorClass}`)], [
            viewModel.coordinatorStatus
          ]),
          h.span([h.Class("status")], [viewModel.capacityStatus])
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
              button(h, "0 · Empty journal", MovedCursor({ cursor: 0 }), branch.cursor === 0, "step")
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
          h.section([h.Class("card controls")], [
            h.p([h.Class("eyebrow")], ["SEMANTIC MOVE PALETTE"]),
            h.h2([], ["What can happen from this state?"]),
            h.p([h.Class("authority-state")], [viewModel.trackerAuthorityState]),
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
                "No authoritative graph observation yet."
              )
            ]), "REAL reconstructManagedRunState"),
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
              h.dt([], ["Finality"]),
              h.dd([], [viewModel.finality])
            ]), "THE GAP IS PART OF THE RESULT")
          ]),

          h.section([h.Class("card journal")], [
            h.p([h.Class("eyebrow")], ["EXACT INPUT TO THE FOLD"]),
            h.h2([], ["Workflow journal"]),
            viewModel.journal.length === 0
              ? h.p([h.Class("empty")], ["No records."])
              : h.table([], [
                h.thead([], [h.tr([], [h.th([], ["#"]), h.th([], ["Event"])])]),
                h.tbody([], viewModel.journal.map(({ position, tag }) =>
                  h.tr([], [h.td([], [String(position)]), h.td([], [tag])])
                ))
              ]),
            ...viewModel.errors.map((error) => h.p([h.Class("error")], [error]))
          ]),

          h.section([h.Class("card notes")], [
            h.p([h.Class("eyebrow")], ["WHAT THIS REVEALS"]),
            h.h2([], ["Reducer boundary notes"]),
            h.ul([], viewModel.notes.map((note) => h.li([], [note]))),
            h.p([], [
              "All state and computation stay in this browser tab. FoldKit owns navigation and rendering; the driver owns semantic execution and revalidation."
            ])
          ])
        ])
      ])
    ])
  }
}
