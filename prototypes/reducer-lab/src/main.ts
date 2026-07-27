import { Effect, Schema as S } from "effect"
import { Command, Runtime } from "foldkit"
import { type Document, html } from "foldkit/html"
import { m } from "foldkit/message"
import {
  actionLabel,
  LabAction,
  type LabAction as LabActionType,
  Projection,
  projectLab,
  type TaskName as TaskNameType
} from "./lab-engine.ts"

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
  capacity: S.Number,
  nextBranchId: S.Number,
  projection: Projection,
  requestId: S.Number
})
export type Model = typeof Model.Type

const AppendedAction = m("AppendedAction", { action: LabAction })
const ChangedCapacity = m("ChangedCapacity", { capacity: S.Number })
const ForkedAtCursor = m("ForkedAtCursor")
const MovedCursor = m("MovedCursor", { cursor: S.Number })
const ProjectionReady = m("ProjectionReady", {
  projection: Projection,
  requestId: S.Number
})
const SelectedBranch = m("SelectedBranch", { branchId: S.Number })

export const Message = S.Union([
  AppendedAction,
  ChangedCapacity,
  ForkedAtCursor,
  MovedCursor,
  ProjectionReady,
  SelectedBranch
])
export type Message = typeof Message.Type

const emptyProjection: Projection = {
  admitted: [],
  coordinatorRunning: true,
  errors: [],
  explanations: [],
  finality: "computing",
  frontier: [],
  graphKnowledge: [],
  journal: [],
  knownTasks: [],
  notes: [],
  reservedTasks: [],
  responsibilities: [],
  runPause: "computing",
  status: "computing",
  taskPause: "computing"
}

const ComputeProjection = Command.define(
  "ComputeProjection",
  {
    actions: S.Array(LabAction),
    capacity: S.Number,
    requestId: S.Number
  },
  ProjectionReady
)(({ actions, capacity, requestId }) =>
  projectLab(actions, capacity).pipe(
    Effect.map((projection) => ProjectionReady({ projection, requestId }))
  )
)

const activeBranch = (model: Model): Branch =>
  model.branches.find(({ id }) => id === model.activeBranchId) ?? model.branches[0]!

const replaceBranch = (model: Model, nextBranch: Branch): ReadonlyArray<Branch> =>
  model.branches.map((branch) => branch.id === nextBranch.id ? nextBranch : branch)

const recompute = (
  model: Model,
  branches: ReadonlyArray<Branch> = model.branches,
  activeBranchId: number = model.activeBranchId,
  capacity: number = model.capacity
): readonly [Model, ReadonlyArray<Command.Command<Message>>] => {
  const branch = branches.find(({ id }) => id === activeBranchId) ?? branches[0]!
  const requestId = model.requestId + 1
  return [
    { ...model, activeBranchId, branches, capacity, requestId },
    [ComputeProjection({
      actions: branch.actions.slice(0, branch.cursor),
      capacity,
      requestId
    })]
  ]
}

export const update = (
  model: Model,
  message: Message
): readonly [Model, ReadonlyArray<Command.Command<Message>>] => {
  switch (message._tag) {
    case "AppendedAction": {
      const branch = activeBranch(model)
      if (branch.cursor !== branch.actions.length) return [model, []]
      const nextBranch = {
        ...branch,
        actions: [...branch.actions, message.action],
        cursor: branch.cursor + 1
      }
      return recompute(model, replaceBranch(model, nextBranch))
    }
    case "ChangedCapacity":
      return recompute(model, model.branches, model.activeBranchId, message.capacity)
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
    case "ProjectionReady":
      return message.requestId === model.requestId
        ? [{ ...model, projection: message.projection }, []]
        : [model, []]
    case "SelectedBranch":
      return recompute(model, model.branches, message.branchId)
  }
}

export const init: Runtime.ApplicationInit<Model, Message> = () => {
  const model: Model = {
    activeBranchId: 1,
    branches: [{ actions: [], cursor: 0, id: 1, name: "main" }],
    capacity: 1,
    nextBranchId: 2,
    projection: emptyProjection,
    requestId: 1
  }
  return [model, [ComputeProjection({ actions: [], capacity: 1, requestId: 1 })]]
}

const append = (action: LabActionType) => AppendedAction({ action })
const hasAction = (branch: Branch, tag: LabActionType["_tag"]): boolean =>
  branch.actions.slice(0, branch.cursor).some(({ _tag }) => _tag === tag)
const hasClaim = (model: Model, task: TaskNameType): boolean =>
  activeBranch(model).actions.slice(0, activeBranch(model).cursor).some((action) =>
    action._tag === "CommittedClaimIntent" && action.task === task
  )

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

const factButtons = (
  h: HtmlFactory,
  task: TaskNameType,
  locked: boolean
) => h.div([h.Class("fact-row")], [
  h.span([h.Class("task-chip")], [`Task ${task}`]),
  ...(["Ready", "ForeignClaim", "MissingClaim", "Paused"] as const).map((fact) =>
    button(
      h,
      fact === "Paused" ? "Supply paused fact" : fact,
      append({ _tag: "SuppliedFreshFact", fact, task }),
      locked,
      fact === "Paused" ? "outline warning" : "outline"
    )
  )
])

export const view = (model: Model): Document => {
  const h = html<Message>()
  const branch = activeBranch(model)
  const atTip = branch.cursor === branch.actions.length
  const projection = model.projection
  const initialObserved = hasAction(branch, "ObservedInitialGraph")
  const absenceObserved = hasAction(branch, "ObservedProvenAbsence")
  const admittedFreshClaims = projection.admitted.filter(({ tag }) =>
    tag === "CommitFreshTaskClaimIntent"
  )

  return {
    title: "Dalph reducer lab",
    body: h.main([h.Class("shell")], [
      h.header([h.Class("hero")], [
        h.div([], [
          h.p([h.Class("kicker")], ["THROWAWAY PROTOTYPE · BROWSER ONLY"]),
          h.h1([], ["Reducer lab"]),
          h.p([h.Class("lede")], [
            "Dispatch controlled inputs, rewind to any prefix, fork, and compare what Dalph’s current reducers actually derive."
          ])
        ]),
        h.div([h.Class("status-stack")], [
          h.span([h.Class(`status ${projection.coordinatorRunning ? "good" : "stopped"}`)], [
            projection.coordinatorRunning ? "Coordinator running" : "Coordinator crashed"
          ]),
          h.span([h.Class("status")], [`${projection.status} · capacity ${model.capacity}`])
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
        h.div([h.Class("toolbar-group")], [
          h.span([h.Class("label")], ["Capacity"]),
          button(h, "1", ChangedCapacity({ capacity: 1 }), model.capacity === 1, "compact"),
          button(h, "2", ChangedCapacity({ capacity: 2 }), model.capacity === 2, "compact")
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
            ...branch.actions.map((action, index) =>
              h.li([], [
                button(
                  h,
                  `${index + 1} · ${actionLabel(action)}`,
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
            h.p([h.Class("eyebrow")], ["EVENT CONSOLE"]),
            h.h2([], ["Give the implementation an input"]),
            h.div([h.Class("command-grid")], [
              button(
                h,
                "1. Observe graph A–D",
                append({ _tag: "ObservedInitialGraph" }),
                !atTip || initialObserved
              ),
              button(
                h,
                "Observe B proven absent",
                append({ _tag: "ObservedProvenAbsence" }),
                !atTip || !initialObserved || absenceObserved,
                "outline"
              ),
              projection.coordinatorRunning
                ? button(h, "Crash coordinator", append({ _tag: "CrashedCoordinator" }), !atTip, "danger")
                : button(h, "Restart coordinator", append({ _tag: "RestartedCoordinator" }), !atTip, "danger")
            ]),
            h.div([h.Class("admission-actions")], [
              h.p([h.Class("label")], ["Admitted now"]),
              admittedFreshClaims.length === 0
                ? h.p([h.Class("empty")], ["No fresh claim intent can be committed from this prefix."])
                : h.div([h.Class("button-row")], admittedFreshClaims.map(({ task }) =>
                  button(
                    h,
                    `Commit claim intent for ${task}`,
                    append({ _tag: "CommittedClaimIntent", task }),
                    !atTip || hasClaim(model, task),
                    "accent"
                  )
                ))
            ]),
            projection.responsibilities.length === 0
              ? null
              : h.div([h.Class("fact-controls")], [
                h.p([h.Class("label")], ["Supply fresh authority facts (selector seam, not journal commands)"]),
                ...projection.responsibilities.map(({ task }) => factButtons(h, task, !atTip))
              ]),
            h.div([h.Class("gap-panel")], [
              h.div([], [
                h.p([h.Class("label warning-text")], ["KNOWN IMPLEMENTATION GAP"]),
                h.p([], [
                  "The production pause reducer always returns ",
                  h.code([], ["RunUnpaused / NoTaskPauses"]),
                  ". These controls stay disabled so the prototype cannot fake a transition."
                ])
              ]),
              h.div([h.Class("button-row")], [
                button(h, "Pause run · #62/#134", ForkedAtCursor(), true, "warning"),
                button(h, "Pause task · #135", ForkedAtCursor(), true, "warning")
              ])
            ])
          ]),

          h.div([h.Class("state-grid")], [
            stateCard(h, "Graph knowledge", h.div([], [
              h.p([h.Class("metric")], [`Known tasks: ${projection.knownTasks.join(", ") || "none"}`]),
              listOrEmpty(h, projection.graphKnowledge, "No authoritative graph observation yet.")
            ]), "REAL reconstructManagedRunState"),
            stateCard(h, "Responsibility", h.div([], [
              listOrEmpty(
                h,
                projection.responsibilities.map(({ beganAt, kind, task }) =>
                  `${task} · ${kind} · began at journal #${beganAt}`
                ),
                "No durable task responsibility."
              ),
              h.p([h.Class("metric")], [`Reserved: ${projection.reservedTasks.join(", ") || "none"}`])
            ]), "REAL RESPONSIBILITY REDUCER"),
            stateCard(h, "Frontier → admission", h.div([], [
              h.p([h.Class("label")], ["Runnable frontier"]),
              listOrEmpty(h, projection.frontier.map(({ tag, task }) => `${task} · ${tag}`), "No runnable transitions."),
              h.p([h.Class("label")], ["Admitted"]),
              listOrEmpty(h, projection.admitted.map(({ tag, task }) => `${task} · ${tag}`), "Nothing admitted."),
              listOrEmpty(h, projection.explanations, "No wait/isolation explanation.")
            ]), "REAL SELECTOR + ADMISSION CONTROLLER"),
            stateCard(h, "Pause + finality", h.dl([], [
              h.dt([], ["Run pause"]),
              h.dd([], [projection.runPause]),
              h.dt([], ["Task pause"]),
              h.dd([], [projection.taskPause]),
              h.dt([], ["Finality"]),
              h.dd([], [projection.finality])
            ]), "THE GAP IS PART OF THE RESULT")
          ]),

          h.section([h.Class("card journal")], [
            h.p([h.Class("eyebrow")], ["EXACT INPUT TO THE FOLD"]),
            h.h2([], ["Workflow journal"]),
            projection.journal.length === 0
              ? h.p([h.Class("empty")], ["No records."])
              : h.table([], [
                h.thead([], [h.tr([], [h.th([], ["#"]), h.th([], ["Event"])])]),
                h.tbody([], projection.journal.map(({ position, tag }) =>
                  h.tr([], [h.td([], [String(position)]), h.td([], [tag])])
                ))
              ]),
            ...projection.errors.map((error) => h.p([h.Class("error")], [error]))
          ]),

          h.section([h.Class("card notes")], [
            h.p([h.Class("eyebrow")], ["WHAT THIS REVEALS"]),
            h.h2([], ["Reducer boundary notes"]),
            h.ul([], projection.notes.map((note) => h.li([], [note]))),
            h.p([], [
              "All state and computation stay in this browser tab. FoldKit owns the Elm-style Model → Message → update → view loop; no Dalph backend is running."
            ])
          ])
        ])
      ])
    ])
  }
}
