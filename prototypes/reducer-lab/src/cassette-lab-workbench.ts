import type { AuthoredDeliveryFrame } from "../../../packages/dalph/src/cassettes/authored-runner.ts"
import {
  deliveryGraphTag,
  type DeliveryGraphElement,
  type DeliveryGraphProjection
} from "./delivery-graph-element.ts"
import type { maintainedCassetteRows } from "./cassette-lab.ts"
import type { CassetteState } from "./cassette-lab-view.ts"

type CassetteRow = (typeof maintainedCassetteRows)[number]
type AuthoredRow = CassetteRow & {
  readonly surface: Extract<CassetteRow["surface"], { readonly _tag: "AuthoredDeliverySurface" }>
}

const appendText = <K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  content: string,
  className?: string
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag)
  element.textContent = content
  if (className !== undefined) element.className = className
  parent.append(element)
  return element
}

const graphEdges = (
  tasks: ReadonlyArray<{
    readonly id: string
    readonly parentTaskId: string | null
    readonly prerequisiteIds: ReadonlyArray<string>
  }>
) => tasks.flatMap((task) => [
  ...task.prerequisiteIds.map((prerequisiteId) => ({
    from: prerequisiteId,
    kind: "Prerequisite" as const,
    to: task.id
  })),
  ...(task.parentTaskId === null
    ? []
    : [{ from: task.parentTaskId, kind: "Grouping" as const, to: task.id }])
])

const declaredProjection = (row: AuthoredRow): DeliveryGraphProjection => ({
  edges: graphEdges(row.surface.declaredGraph.tasks),
  fingerprint: `declared:${row.catalogKey}:${JSON.stringify(row.surface.declaredGraph)}`,
  key: `declared:${row.catalogKey}`,
  status: "Controlled cassette input. Production has not observed this graph.",
  tasks: row.surface.declaredGraph.tasks.map(({ id, lifecycle, title }) => ({ id, lifecycle, title }))
})

const frameLabel = (frame: AuthoredDeliveryFrame, index: number): string => {
  const graph = frame.graph._tag === "Established" ? frame.graph.revision : "graph not established"
  const accepted = frame.acceptedAt === null ? "no accepted facts" : `facts through journal ${frame.acceptedAt}`
  return `${index + 1}. ${frame.activation} · ${frame.storyPosition} authored items consumed · graph ${graph} · ${accepted}`
}

const deliverySummary = (delivery: AuthoredDeliveryFrame["deliveries"][number] | undefined): string =>
  delivery === undefined
    ? "none"
    : `placement: ${delivery.placement.kind} · standings: ${delivery.standings.map(({ kind }) => kind).join(" + ")}`
      + `${delivery.evidence.length === 0 ? "" : ` · evidence: ${delivery.evidence.map(({ kind }) => kind).join(", ")}`}`
      + `${delivery.obligations.length === 0 ? "" : ` · obligations: ${delivery.obligations.map(({ kind }) => kind).join(", ")}`}`

const taskFacts = (frame: AuthoredDeliveryFrame, taskId: string) => {
  const frontier = frame.frontier.find((item) => item.taskId === taskId)
  const ticket = frame.tickets.find((item) => item.taskId === taskId)
  const delivery = frame.deliveries.find((item) => item.taskId === taskId)
  const held = frame.heldPositions.filter((item) => item.taskId === taskId)
  const settlements = frame.settlements.filter((item) => item.taskId === taskId)
  return {
    delivery,
    deliverySummary: deliverySummary(delivery),
    frontierFact: frontier,
    frontier: frontier === undefined
      ? "not represented"
      : frontier.standing === "Eligible"
        ? "eligible"
        : `excluded: ${frontier.reasons.map(({ kind }) => kind).join(", ")}`,
    held: held.length === 0 ? "none" : held.map(({ attemptId, runId }) => `${runId} / ${attemptId}`).join("; "),
    settlement: settlements.length === 0 ? "none" : settlements.map(({ attemptId }) => attemptId).join("; "),
    ticketFact: ticket,
    ticket: ticket === undefined
      ? "none"
      : `${ticket.placement.kind}${ticket.rank === null ? "" : ` #${ticket.rank}`}${ticket.reasons.length === 0 ? "" : `: ${ticket.reasons.map(({ kind }) => kind).join(", ")}`}`
  }
}

const frameProjection = (row: AuthoredRow, frame: AuthoredDeliveryFrame, index: number): DeliveryGraphProjection => {
  const tasks = frame.graph._tag === "Established" ? frame.graph.tasks : []
  return {
    edges: graphEdges(tasks),
    fingerprint: `observed:${row.catalogKey}:${index}:${JSON.stringify(frame)}`,
    key: `observed:${row.catalogKey}:${index}`,
    status: frame.graph._tag === "Established"
      ? `Production-observed graph ${frame.graph.revision}`
      : "Production delivery has not established a graph in this frame.",
    tasks: tasks.map(({ id, lifecycle }) => {
      const facts = taskFacts(frame, id)
      return {
        display: {
          classes: [
            facts.frontier === "eligible" ? "frontier" : "",
            facts.ticket.startsWith("Selected") ? "placement" : "",
            facts.held === "none" ? "" : "held",
            facts.delivery === undefined ? "" : "standing"
          ].filter((value) => value.length > 0),
          labels: [
            `Frontier: ${facts.frontier}`,
            `Desired ticket: ${facts.ticket}`,
            `Held position: ${facts.held}`,
            `Delivery: ${facts.deliverySummary}`,
            `Settlement: ${facts.settlement}`
          ]
        },
        id,
        lifecycle
      }
    })
  }
}

const renderNotObserved = (parent: HTMLElement, row: AuthoredRow, state: CassetteState): void => {
  appendText(
    parent,
    "p",
    state._tag === "Running"
      ? "Production is consuming the cassette now. Any earlier delivery frames were cleared; captured frames appear only after this run reaches a terminal result."
      : state._tag === "LabDefect" || state._tag === "Settled"
        ? "No production delivery timeline was returned. The graph below remains declared cassette input, not observed delivery state."
        : "Before execution this is controlled cassette input only. Frontier, desired tickets, held positions, responsibilities, and settlements are not yet observed.",
    "delivery-not-observed"
  )
  const graph = document.createElement(deliveryGraphTag) as DeliveryGraphElement
  graph.projection = declaredProjection(row)
  graph.selectedTaskId = null
  parent.append(graph)
}

const renderFrameFacts = (parent: HTMLElement, row: AuthoredRow, frame: AuthoredDeliveryFrame): void => {
  const facts = document.createElement("dl")
  facts.className = "delivery-frame-facts"
  const descriptions: ReadonlyArray<readonly [string, string]> = [
    ["Production activation", frame.activation],
    [
      "Authored input consumed",
      row.storyItemSummaries[frame.storyPosition] === undefined
        ? `${frame.storyPosition} items; declared story end reached`
        : `${frame.storyPosition} items; next item #${frame.storyPosition + 1}: ${row.storyItemSummaries[frame.storyPosition]}`
    ],
    ["Publication facts accepted through", frame.acceptedAt === null ? "no journal position yet" : `journal position ${frame.acceptedAt}`],
    ["Observed graph", frame.graph._tag === "Established" ? frame.graph.revision : "not established"],
    ["Task-work capacity", String(frame.capacity)],
    ["Desired selected tickets", String(frame.tickets.filter(({ placement }) => placement.kind === "Selected").length)],
    ["Actual held positions", String(frame.heldPositions.length)],
    ["Established settlements", String(frame.settlements.length)],
    [
      "Tracker reflection",
      `${frame.trackerReflection._tag} derived from ${frame.trackerReflection.settlementCount} settlements; no tracker request is proved`
    ]
  ]
  for (const [term, description] of descriptions) {
    appendText(facts, "dt", term)
    appendText(facts, "dd", description)
  }
  parent.append(facts)
}

const renderDeliveryFacts = (
  parent: HTMLElement,
  delivery: AuthoredDeliveryFrame["deliveries"][number] | undefined
): void => {
  if (delivery === undefined) {
    parent.textContent = "none"
    return
  }
  const placement = document.createElement("details")
  appendText(placement, "summary", `Broad placement: ${delivery.placement.kind}`)
  appendText(placement, "pre", delivery.placement.exact)
  parent.append(placement)
  for (const [label, values] of [
    ["Evidence", delivery.evidence],
    ["Standings", delivery.standings],
    ["Exact obligations", delivery.obligations]
  ] as const) {
    if (values.length === 0) continue
    const details = document.createElement("details")
    appendText(details, "summary", `${label}: ${values.map(({ kind }) => kind).join(", ")}`)
    appendText(details, "pre", values.map(({ exact }) => exact).join("\n"))
    parent.append(details)
  }
}

const renderTaskTable = (parent: HTMLElement, frame: AuthoredDeliveryFrame): void => {
  const taskIds = [...new Set([
    ...(frame.graph._tag === "Established" ? frame.graph.tasks.map(({ id }) => id) : []),
    ...frame.frontier.map(({ taskId }) => taskId),
    ...frame.tickets.map(({ taskId }) => taskId),
    ...frame.deliveries.map(({ taskId }) => taskId),
    ...frame.heldPositions.map(({ taskId }) => taskId),
    ...frame.settlements.map(({ taskId }) => taskId)
  ])].toSorted()
  const table = document.createElement("table")
  table.dataset.role = "delivery-task-state"
  appendText(table, "caption", "Per-task delivery state in this production frame")
  const head = document.createElement("thead")
  const headerRow = document.createElement("tr")
  for (const heading of ["Task", "Frontier", "Desired bounded ticket", "Actual held position", "Ticket-delivery evidence / standing / obligation", "Settlement"]) {
    const cell = appendText(headerRow, "th", heading)
    cell.setAttribute("scope", "col")
  }
  head.append(headerRow)
  const body = document.createElement("tbody")
  for (const taskId of taskIds) {
    const facts = taskFacts(frame, taskId)
    const row = document.createElement("tr")
    row.dataset.taskId = taskId
    appendText(row, "td", taskId)
    const frontierCell = appendText(row, "td", facts.frontier)
    if (facts.frontierFact?.standing === "Excluded") {
      for (const reason of facts.frontierFact.reasons) {
        const details = document.createElement("details")
        appendText(details, "summary", `Exact ${reason.kind}`)
        appendText(details, "pre", reason.exact)
        frontierCell.append(details)
      }
    }
    const ticketCell = appendText(row, "td", facts.ticket)
    if (facts.ticketFact !== undefined) {
      const details = document.createElement("details")
      appendText(details, "summary", `Exact ${facts.ticketFact.placement.kind} placement`)
      appendText(details, "pre", facts.ticketFact.placement.exact)
      ticketCell.append(details)
    }
    appendText(row, "td", facts.held)
    const deliveryCell = document.createElement("td")
    renderDeliveryFacts(deliveryCell, facts.delivery)
    row.append(deliveryCell)
    appendText(row, "td", facts.settlement)
    body.append(row)
  }
  table.append(head, body)
  parent.append(table)
}

const changedTaskIds = (
  before: ReadonlyArray<{ readonly taskId: string }>,
  after: ReadonlyArray<{ readonly taskId: string }>
): ReadonlyArray<string> => {
  const grouped = (values: ReadonlyArray<{ readonly taskId: string }>): Map<string, string> => {
    const byTask = new Map<string, Array<string>>()
    for (const value of values) byTask.set(value.taskId, [...byTask.get(value.taskId) ?? [], JSON.stringify(value)])
    return new Map([...byTask].map(([taskId, facts]) => [taskId, JSON.stringify(facts.toSorted())]))
  }
  const beforeByTask = grouped(before)
  const afterByTask = grouped(after)
  return [...new Set([...beforeByTask.keys(), ...afterByTask.keys()])]
    .filter((taskId) => beforeByTask.get(taskId) !== afterByTask.get(taskId))
    .toSorted()
}

const frameChangeSummary = (
  previous: AuthoredDeliveryFrame | undefined,
  frame: AuthoredDeliveryFrame
): string => {
  if (previous === undefined) return "Initial current-first production publication."
  const changes: Array<string> = []
  if (previous.activation !== frame.activation) changes.push(`${previous.activation} → ${frame.activation} activation`)
  if (previous.capacity !== frame.capacity) changes.push(`capacity ${previous.capacity} → ${frame.capacity}`)
  if (previous.acceptedAt !== frame.acceptedAt) {
    changes.push(`facts accepted through ${previous.acceptedAt ?? "none"} → ${frame.acceptedAt ?? "none"}`)
  }
  const previousRevision = previous.graph._tag === "Established" ? previous.graph.revision : "not established"
  const revision = frame.graph._tag === "Established" ? frame.graph.revision : "not established"
  if (previousRevision !== revision) changes.push(`graph ${previousRevision} → ${revision}`)
  for (const [label, before, after] of [
    ["frontier", previous.frontier, frame.frontier],
    ["bounded tickets", previous.tickets, frame.tickets],
    ["held positions", previous.heldPositions, frame.heldPositions],
    ["ticket deliveries", previous.deliveries, frame.deliveries],
    ["settlements", previous.settlements, frame.settlements]
  ] as const) {
    const tasks = changedTaskIds(before, after)
    if (tasks.length > 0) changes.push(`${label} changed for ${tasks.join(", ")}`)
  }
  if (previous.storyPosition !== frame.storyPosition) {
    changes.push(`${frame.storyPosition - previous.storyPosition} authored items consumed`)
  }
  return changes.length === 0 ? "No descriptive delivery fact changed; production republished the coherent input." : changes.join(" · ")
}

const renderTimeline = (
  parent: HTMLElement,
  row: AuthoredRow,
  frames: ReadonlyArray<AuthoredDeliveryFrame>
): void => {
  appendText(
    parent,
    "p",
    "Each frame was captured from the production reactive delivery publication during the cassette run, then projected through the literal production delivery composition. Desired bounded tickets and actual held task-work positions remain separate.",
    "delivery-provenance"
  )
  appendText(
    parent,
    "p",
    "Production layer chain: observed graph → exhaustive frontier → bounded tickets → ticket deliveries → settlements → descriptive tracker reflection. Reflection is meaning derived from settlements; it does not prove a tracker mutation.",
    "delivery-layer-chain"
  )
  const legend = document.createElement("ul")
  legend.className = "delivery-graph-legend"
  for (const value of [
    "Blue border: frontier eligible",
    "Purple fill: selected bounded ticket",
    "Double border: actual held task-work position",
    "Gold fill: retained ticket-delivery standing"
  ]) appendText(legend, "li", value)
  parent.append(legend)
  const controls = document.createElement("div")
  controls.className = "delivery-timeline-controls"
  const previous = appendText(controls, "button", "Previous frame")
  previous.type = "button"
  const selectLabel = appendText(controls, "label", "Delivery frame")
  const select = document.createElement("select")
  for (const [index, frame] of frames.entries()) {
    const option = document.createElement("option")
    option.value = String(index)
    option.textContent = frameLabel(frame, index)
    select.append(option)
  }
  selectLabel.append(select)
  const next = appendText(controls, "button", "Next frame")
  next.type = "button"
  const status = document.createElement("output")
  controls.append(status)
  const frameHost = document.createElement("div")
  frameHost.dataset.role = "delivery-frame"
  let selectedTaskId: string | null = null

  const show = (index: number): void => {
    const frame = frames[index]
    if (frame === undefined) return
    frameHost.replaceChildren()
    status.textContent = `${index + 1} of ${frames.length}`
    previous.disabled = index === 0
    next.disabled = index === frames.length - 1
    const graph = document.createElement(deliveryGraphTag) as DeliveryGraphElement
    graph.projection = frameProjection(row, frame, index)
    graph.selectedTaskId = selectedTaskId
    appendText(frameHost, "p", frameChangeSummary(frames[index - 1], frame), "delivery-frame-change")
    frameHost.append(graph)
    renderFrameFacts(frameHost, row, frame)
    renderTaskTable(frameHost, frame)
    for (const taskRow of frameHost.querySelectorAll<HTMLTableRowElement>("tr[data-task-id]")) {
      const selected = taskRow.dataset.taskId === selectedTaskId
      taskRow.classList.toggle("selected-task-row", selected)
      if (selected) taskRow.setAttribute("aria-current", "true")
    }
    graph.addEventListener("task-selected", (event) => {
      selectedTaskId = (event as CustomEvent<{ readonly taskId: string }>).detail.taskId
      graph.selectedTaskId = selectedTaskId
      for (const taskRow of frameHost.querySelectorAll<HTMLTableRowElement>("tr[data-task-id]")) {
        taskRow.classList.toggle("selected-task-row", taskRow.dataset.taskId === selectedTaskId)
        if (taskRow.dataset.taskId === selectedTaskId) taskRow.setAttribute("aria-current", "true")
        else taskRow.removeAttribute("aria-current")
      }
    })
  }
  const selectFrame = (index: number): void => {
    for (const option of select.options) {
      if (option.value === String(index)) option.setAttribute("selected", "")
      else option.removeAttribute("selected")
    }
    try {
      select.value = String(index)
    } catch {
      // Linkedom exposes a getter-only value; selected attributes above keep the acceptance DOM deterministic.
    }
    show(index)
  }
  previous.addEventListener("click", () => selectFrame(Math.max(0, Number(select.value) - 1)))
  next.addEventListener("click", () => selectFrame(Math.min(frames.length - 1, Number(select.value) + 1)))
  select.addEventListener("change", () => show(Number(select.value)))
  parent.append(controls, frameHost)
  selectFrame(0)
}

export const renderCassetteDeliveryWorkbench = (
  host: HTMLElement,
  row: CassetteRow,
  state: CassetteState,
  open: boolean
): void => {
  host.replaceChildren()
  if (row.surface._tag !== "AuthoredDeliverySurface") return
  const authoredRow: AuthoredRow = { ...row, surface: row.surface }
  const details = document.createElement("details")
  details.className = "delivery-workbench"
  details.dataset.role = "delivery-workbench"
  details.open = open
  appendText(details, "summary", "Delivery workbench · graph, frontier, bounded tickets, held positions, obligations, and settlements")
  host.append(details)
  const renderContents = (): void => {
    if (details.querySelector("h4") !== null) return
    const heading = appendText(details, "h4", "Production delivery timeline")
    heading.tabIndex = -1
    const completed = state._tag === "Settled" && state.result._tag === "Completed"
      ? state.result
      : undefined
    if (completed?.deliveryFrames !== null && completed?.deliveryFrames !== undefined && completed.deliveryFrames.length > 0) {
      renderTimeline(details, authoredRow, completed.deliveryFrames)
    } else {
      renderNotObserved(details, authoredRow, state)
    }
  }
  if (open) renderContents()
  details.addEventListener("toggle", () => {
    if (details.open) renderContents()
  })
}
