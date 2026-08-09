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

const objectRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null ? value as Readonly<Record<string, unknown>> : undefined

const firstNamedString = (value: unknown, names: ReadonlySet<string>): string | undefined => {
  const record = objectRecord(value)
  if (record === undefined) return undefined
  for (const [key, child] of Object.entries(record)) {
    if (names.has(key) && typeof child === "string") return child
    const nested = firstNamedString(child, names)
    if (nested !== undefined) return nested
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const nested = firstNamedString(child, names)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

const proposalSummary = (fact: { readonly exact: string; readonly kind: string }): string => {
  try {
    const value: unknown = JSON.parse(fact.exact)
    const route = firstNamedString(value, new Set(["transition", "step"]))
      ?? firstNamedString(objectRecord(value)?.route, new Set(["_tag"]))
      ?? fact.kind
    const action = route === "TrackerGraphReadRoute"
      ? "Read the tracker graph again"
      : route.replace(/Route$/u, "").replace(/(?<=[a-z])(?=[A-Z])/gu, " ")
    const taskId = firstNamedString(value, new Set(["taskId"]))
    const attemptId = firstNamedString(value, new Set(["attemptId"]))
    const owner = firstNamedString(value, new Set(["owner"]))
    const ownerText = owner?.replace(/(?<=[a-z])(?=[A-Z])/gu, " ").toLowerCase()
    return `${action}${taskId === undefined ? "" : ` for task ${taskId}`}${attemptId === undefined ? "" : ` · attempt ${attemptId}`}${ownerText === undefined ? "" : ` · planned by the ${ownerText} layer`}`
  } catch {
    return fact.kind
  }
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
  const graph = frame.graph._tag === "Established" ? `observed graph ${frame.graph.revision}` : "graph not established"
  const accepted = frame.acceptedAt === null ? "no accepted facts" : `facts through journal ${frame.acceptedAt}`
  return `${index + 1}. ${frame.activation} · ${frame.storyPosition} declared interactions consumed · ${graph} · ${accepted}`
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
        ? `eligible at task revision ${frontier.taskRevision}`
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
            facts.frontierFact?.standing === "Eligible" ? "frontier" : "",
            facts.ticket.startsWith("Selected") ? "placement" : "",
            facts.held === "none" ? "" : "held",
            facts.delivery === undefined ? "" : "standing"
          ].filter((value) => value.length > 0),
          labels: [
            `Frontier: ${facts.frontierFact?.standing === "Eligible" ? "eligible" : facts.frontier}`,
            `Desired ticket: ${facts.ticket}`,
            `Held: ${facts.held === "none" ? "no" : "yes"}`,
            `Obligations: ${facts.delivery?.obligations.map(({ kind }) => kind).join(", ") || "none"}`
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
      ? "Production is consuming the cassette now. The declared graph remains controlled input until the first production delivery publication arrives."
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

const renderFrameFacts = (
  parent: HTMLElement,
  row: AuthoredRow,
  frame: AuthoredDeliveryFrame,
  running: boolean
): void => {
  const facts = document.createElement("dl")
  facts.className = "delivery-frame-facts"
  const descriptions: ReadonlyArray<readonly [string, string]> = [
    [
      "Production activation",
      frame.activation === "Fresh"
        ? "Fresh · initial coordinator process"
        : "Recovered · coordinator restarted from accepted journal history"
    ],
    [
      "Authored input consumed",
      row.storyItemSummaries[frame.storyPosition] === undefined
        ? `${frame.storyPosition} items; declared story end reached`
        : `${frame.storyPosition} interactions consumed at this production publication; next declared item #${frame.storyPosition + 1}: ${row.storyItemSummaries[frame.storyPosition]}${running ? "" : ". The terminal assertion subsequently completed."}`
    ],
    [
      "Observed graph",
      frame.graph._tag === "Established"
        ? `${frame.graph.revision} · exact tracker-read correlation is available below`
        : "not established"
    ],
    ["Task-work capacity", String(frame.capacity)],
    [
      "Quiescence disposition",
      frame.quiescence._tag === "QuiescencePassive"
        ? `passive because ${frame.quiescence.reason}; selected tickets remain desired graph work, not permission to start`
        : "if no delivery action is ready, Dalph may read the tracker graph again"
    ],
    ["Desired selected tickets", String(frame.tickets.filter(({ placement }) => placement.kind === "Selected").length)],
    ["Actual held positions", String(frame.heldPositions.length)],
    [
      "Planned next actions",
      frame.actionPlanning._tag === "DeliveryProposalsAvailable"
        ? `${frame.actionPlanning.proposals.length} planned action proposals and ${frame.actionPlanning.isolatedIssues.length} isolated derivation issues; nothing is executed by this view`
        : `${frame.actionPlanning.conflicts.length} proposal ownership conflicts; planning fails closed`
    ]
  ]
  for (const [term, description] of descriptions) {
    appendText(facts, "dt", term)
    appendText(facts, "dd", description)
  }
  parent.append(facts)

  const secondary = document.createElement("details")
  secondary.dataset.role = "delivery-secondary-facts"
  appendText(secondary, "summary", "Publication watermark, settlements, and tracker reflection")
  const secondaryFacts = document.createElement("dl")
  secondaryFacts.className = "delivery-frame-facts"
  for (const [term, description] of [
    ["Publication facts accepted through", frame.acceptedAt === null ? "no journal position yet" : `journal position ${frame.acceptedAt}`],
    [
      "Exact observed-graph correlation",
      frame.graph._tag === "Established"
        ? `read ${frame.graph.observation.operationId} recorded at journal ${frame.graph.observation.recordedAt} · content ${frame.graph.observation.contentIdentity}`
        : "no established graph observation"
    ],
    ["Established settlements", String(frame.settlements.length)],
    ["Tracker reflection", `${frame.trackerReflection._tag} derived from ${frame.trackerReflection.settlementCount} settlements; no tracker request is proved`]
  ] as const) {
    appendText(secondaryFacts, "dt", term)
    appendText(secondaryFacts, "dd", description)
  }
  secondary.append(secondaryFacts)
  parent.append(secondary)

  const planning = document.createElement("details")
  planning.dataset.role = "delivery-action-planning"
  appendText(planning, "summary", "Proposed delivery actions and isolated planning issues")
  appendText(
    planning,
    "p",
    "This is the downstream production action plan for the same coherent publication. It describes what the runtime may try next; opening it performs nothing."
  )
  const values = frame.actionPlanning._tag === "DeliveryProposalsAvailable"
    ? [...frame.actionPlanning.proposals, ...frame.actionPlanning.isolatedIssues]
    : frame.actionPlanning.conflicts
  if (values.length === 0) {
    appendText(planning, "p", "No proposed actions or isolated issues.")
  } else {
    const list = document.createElement("ul")
    for (const value of values) {
      const item = document.createElement("li")
      appendText(item, "span", proposalSummary(value))
      const raw = document.createElement("details")
      appendText(raw, "summary", `Raw ${value.kind}`)
      appendText(raw, "pre", value.exact)
      item.append(raw)
      list.append(item)
    }
    planning.append(list)
  }
  parent.append(planning)
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

const selectedTaskSummary = (frame: AuthoredDeliveryFrame, taskId: string): string => {
  const facts = taskFacts(frame, taskId)
  const planningValues = frame.actionPlanning._tag === "DeliveryProposalsAvailable"
    ? [...frame.actionPlanning.proposals, ...frame.actionPlanning.isolatedIssues]
    : frame.actionPlanning.conflicts
  const linkedPlanning = planningValues.filter(({ exact }) =>
    exact.includes(`"taskId": "${taskId}"`) || exact.includes(`"taskId":"${taskId}"`)
  )
  const heldAttempts = frame.heldPositions.filter(({ taskId: heldTaskId }) => heldTaskId === taskId)
    .map(({ attemptId }) => attemptId)
  return `Selected task ${taskId}. Graph: ${facts.frontier}. Desired ticket: ${facts.ticket}. Held position: ${heldAttempts.length === 0 ? "none" : heldAttempts.join(", ")}. Settlement: ${facts.settlement}.${linkedPlanning.length === 0 ? " No planned action is correlated to this task in this frame." : ` Planned actions: ${linkedPlanning.map(proposalSummary).join("; ")}.`}`
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
    const taskCell = appendText(row, "td", taskId)
    taskCell.dataset.label = "Task"
    const frontierCell = appendText(row, "td", facts.frontier)
    frontierCell.dataset.label = "Graph-only eligibility"
    if (facts.frontierFact?.standing === "Excluded") {
      for (const reason of facts.frontierFact.reasons) {
        const details = document.createElement("details")
        appendText(details, "summary", `Exact ${reason.kind}`)
        appendText(details, "pre", reason.exact)
        frontierCell.append(details)
      }
    }
    const ticketCell = appendText(row, "td", facts.ticket)
    ticketCell.dataset.label = "Does it fit the bounded desired set?"
    if (facts.ticketFact !== undefined) {
      const details = document.createElement("details")
      appendText(details, "summary", `Exact ${facts.ticketFact.placement.kind} placement`)
      appendText(details, "pre", facts.ticketFact.placement.exact)
      ticketCell.append(details)
    }
    const heldCell = appendText(row, "td", facts.held)
    heldCell.dataset.label = "Does it occupy task-work capacity?"
    const deliveryCell = document.createElement("td")
    deliveryCell.dataset.label = "What responsibility or obligation exists?"
    renderDeliveryFacts(deliveryCell, facts.delivery)
    row.append(deliveryCell)
    const settlementCell = appendText(row, "td", facts.settlement)
    settlementCell.dataset.label = "What has settled?"
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
  frame: AuthoredDeliveryFrame,
  row: AuthoredRow
): string => {
  if (previous === undefined) return "Initial current-first production publication."
  const changes: Array<string> = []
  if (previous.activation !== frame.activation) changes.push(`${previous.activation} → ${frame.activation} activation`)
  if (JSON.stringify(previous.quiescence) !== JSON.stringify(frame.quiescence)) {
    changes.push(`quiescence ${previous.quiescence._tag} → ${frame.quiescence._tag}`)
  }
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
  if (JSON.stringify(previous.actionPlanning) !== JSON.stringify(frame.actionPlanning)) {
    changes.push("proposed delivery actions or planning issues changed")
  }
  if (previous.storyPosition !== frame.storyPosition) {
    const consumed = frame.storyPosition - previous.storyPosition
    changes.push(`${consumed} declared ${consumed === 1 ? "interaction" : "interactions"} consumed`)
    const landmarks = row.storyItemLandmarks
      .slice(previous.storyPosition, frame.storyPosition)
      .flatMap((landmark) => landmark === null ? [] : [landmark])
    if (landmarks.length > 0) {
      changes.push(...landmarks)
    } else {
      const reached = row.storyItemSummaries[frame.storyPosition - 1]
      if (reached !== undefined) changes.push(`reached #${frame.storyPosition}: ${reached}`)
    }
  }
  return changes.length === 0 ? "No descriptive delivery fact changed; production republished the coherent input." : changes.join(" · ")
}

export interface DeliveryWorkbenchPlaybackState {
  followLive: boolean
  selectedFrameIndex: number
  selectedTaskId: string | null
}

export const makeDeliveryWorkbenchPlaybackState = (): DeliveryWorkbenchPlaybackState => ({
  followLive: true,
  selectedFrameIndex: 0,
  selectedTaskId: null
})

interface DeliveryTimelineController {
  readonly update: (frames: ReadonlyArray<AuthoredDeliveryFrame>, running: boolean) => void
}

export interface DeliveryWorkbenchController {
  readonly update: (state: CassetteState) => void
}

interface ExactCorrelationFact {
  readonly key: string
  readonly summary: string
}

const exactCorrelations = (frame: AuthoredDeliveryFrame): ReadonlyArray<ExactCorrelationFact> => [
  ...frame.heldPositions.map(({ attemptId, runId, taskId }) => ({
    key: `held:${taskId}:${runId}:${attemptId}`,
    summary: `held position · task ${taskId} · attempt ${attemptId} · Run ${runId}`
  })),
  ...frame.deliveries.flatMap(({ obligations, taskId }) =>
    obligations.map(({ exact, kind }) => {
      let attemptId: string | undefined
      try {
        attemptId = firstNamedString(JSON.parse(exact), new Set(["attemptId"]))
      } catch {
        // The exact JSON remains available in the task facts when it cannot be summarized.
      }
      return {
        key: `obligation:${taskId}:${kind}:${exact}`,
        summary: `obligation · task ${taskId} · ${kind}${attemptId === undefined ? "" : ` · attempt ${attemptId}`}`
      }
    })
  )
]

const restartContinuity = (
  previous: AuthoredDeliveryFrame | undefined,
  frame: AuthoredDeliveryFrame
): string | undefined => {
  if (previous?.activation !== "Fresh" || frame.activation !== "Recovered") return undefined
  const before = new Map(exactCorrelations(previous).map((fact) => [fact.key, fact]))
  const after = new Map(exactCorrelations(frame).map((fact) => [fact.key, fact]))
  const retained = [...before].filter(([key]) => after.has(key)).map(([, fact]) => fact.summary)
  const removed = [...before.keys()].filter((key) => !after.has(key))
  const added = [...after.keys()].filter((key) => !before.has(key))
  return `Coordinator restarted: Fresh → Recovered. Survived unchanged: ${retained.length === 0 ? "none" : retained.join("; ")}. ${removed.length} correlations disappeared; ${added.length} appeared after recovery.`
}

const renderTimeline = (
  parent: HTMLElement,
  row: AuthoredRow,
  initialFrames: ReadonlyArray<AuthoredDeliveryFrame>,
  playback: DeliveryWorkbenchPlaybackState,
  initiallyRunning: boolean
): DeliveryTimelineController => {
  appendText(
    parent,
    "p",
    "Each frame was captured from the production reactive delivery publication during the cassette run, then projected through the literal production delivery composition. Desired bounded tickets and actual held task-work positions remain separate.",
    "delivery-provenance"
  )
  appendText(
    parent,
    "p",
    "Production layer chain: observed graph → exhaustive frontier → bounded desired tickets → ticket deliveries → settlements → descriptive tracker reflection → downstream action planning. Reflection does not prove a tracker mutation, and a proposal does not prove an action ran.",
    "delivery-layer-chain"
  )
  const legend = document.createElement("ul")
  legend.className = "delivery-graph-legend"
  for (const value of [
    "Blue border: frontier eligible",
    "Purple fill: selected bounded ticket",
    "Double border: actual held task-work position",
    "Gold fill: retained ticket-delivery standing",
    "Excluded tasks remain visible with their exact graph reason in task facts",
    "Settlement appears only from established settlement evidence, never from executor Terminal alone"
  ]) appendText(legend, "li", value)
  parent.append(legend)
  const controls = document.createElement("div")
  controls.className = "delivery-timeline-controls"
  const follow = appendText(controls, "button", "Follow live")
  follow.type = "button"
  follow.dataset.role = "follow-live"
  const previous = appendText(controls, "button", "Previous frame")
  previous.type = "button"
  const selectLabel = appendText(controls, "label", "Delivery frame")
  const select = document.createElement("select")
  selectLabel.append(select)
  const next = appendText(controls, "button", "Next frame")
  next.type = "button"
  const status = document.createElement("output")
  controls.append(status)
  const frameHost = document.createElement("div")
  frameHost.dataset.role = "delivery-frame"
  let frames = initialFrames
  let running = initiallyRunning

  const refreshFollow = (): void => {
    follow.setAttribute("aria-pressed", String(playback.followLive))
    follow.textContent = playback.followLive ? "Following live" : "Follow live"
  }

  const show = (index: number): void => {
    const frame = frames[index]
    if (frame === undefined) return
    frameHost.replaceChildren()
    playback.selectedFrameIndex = index
    status.textContent = `${index + 1} of ${frames.length} · ${running ? "production still running" : "run settled"}${playback.followLive ? " · following newest frame" : " · inspecting history"}`
    previous.disabled = index === 0
    next.disabled = index === frames.length - 1
    const graph = document.createElement(deliveryGraphTag) as DeliveryGraphElement
    graph.projection = frameProjection(row, frame, index)
    graph.selectedTaskId = playback.selectedTaskId
    appendText(frameHost, "p", frameChangeSummary(frames[index - 1], frame, row), "delivery-frame-change")
    const restart = restartContinuity(frames[index - 1], frame)
    if (restart !== undefined) appendText(frameHost, "p", restart, "delivery-restart-boundary")
    frameHost.append(graph)
    renderFrameFacts(frameHost, row, frame, running)
    const selectedTask = appendText(
      frameHost,
      "aside",
      playback.selectedTaskId === null
        ? "Select a task in the graph summary to correlate its graph state with exact delivery facts."
        : selectedTaskSummary(frame, playback.selectedTaskId),
      "selected-task-facts"
    )
    selectedTask.dataset.role = "selected-task-facts"
    renderTaskTable(frameHost, frame)
    for (const taskRow of frameHost.querySelectorAll<HTMLTableRowElement>("tr[data-task-id]")) {
      const selected = taskRow.dataset.taskId === playback.selectedTaskId
      taskRow.classList.toggle("selected-task-row", selected)
      if (selected) taskRow.setAttribute("aria-current", "true")
    }
    graph.addEventListener("task-selected", (event) => {
      playback.selectedTaskId = (event as CustomEvent<{ readonly taskId: string }>).detail.taskId
      graph.selectedTaskId = playback.selectedTaskId
      selectedTask.textContent = selectedTaskSummary(frame, playback.selectedTaskId)
      for (const taskRow of frameHost.querySelectorAll<HTMLTableRowElement>("tr[data-task-id]")) {
        taskRow.classList.toggle("selected-task-row", taskRow.dataset.taskId === playback.selectedTaskId)
        if (taskRow.dataset.taskId === playback.selectedTaskId) taskRow.setAttribute("aria-current", "true")
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
  const inspectFrame = (index: number): void => {
    playback.followLive = false
    refreshFollow()
    selectFrame(index)
  }
  follow.addEventListener("click", () => {
    playback.followLive = true
    refreshFollow()
    selectFrame(frames.length - 1)
  })
  previous.addEventListener("click", () => inspectFrame(Math.max(0, playback.selectedFrameIndex - 1)))
  next.addEventListener("click", () => inspectFrame(Math.min(frames.length - 1, playback.selectedFrameIndex + 1)))
  select.addEventListener("change", () => inspectFrame(Number(select.value)))
  parent.append(controls, frameHost)
  const update = (nextFrames: ReadonlyArray<AuthoredDeliveryFrame>, nextRunning: boolean): void => {
    frames = nextFrames
    running = nextRunning
    select.replaceChildren()
    for (const [index, frame] of frames.entries()) {
      const option = document.createElement("option")
      option.value = String(index)
      option.textContent = frameLabel(frame, index)
      select.append(option)
    }
    const selectedIndex = playback.followLive
      ? frames.length - 1
      : Math.min(playback.selectedFrameIndex, frames.length - 1)
    refreshFollow()
    selectFrame(Math.max(0, selectedIndex))
  }
  update(initialFrames, initiallyRunning)
  return { update }
}

const deliveryFramesFrom = (state: CassetteState): ReadonlyArray<AuthoredDeliveryFrame> | null => {
  if (state._tag === "Running") return state.deliveryFrames
  return state._tag === "Settled" && state.result._tag === "Completed" ? state.result.deliveryFrames : null
}

export const renderCassetteDeliveryWorkbench = (
  host: HTMLElement,
  row: CassetteRow,
  state: CassetteState,
  open: boolean,
  playback: DeliveryWorkbenchPlaybackState = makeDeliveryWorkbenchPlaybackState()
): DeliveryWorkbenchController => {
  host.replaceChildren()
  if (row.surface._tag !== "AuthoredDeliverySurface") return { update: () => undefined }
  const authoredRow: AuthoredRow = { ...row, surface: row.surface }
  let currentState = state
  let timeline: DeliveryTimelineController | undefined
  const details = document.createElement("details")
  details.className = "delivery-workbench"
  details.dataset.role = "delivery-workbench"
  details.open = open
  appendText(details, "summary", "Delivery workbench · graph, frontier, bounded tickets, held positions, obligations, and settlements")
  host.append(details)
  const content = document.createElement("div")
  details.append(content)
  const renderContents = (): void => {
    const frames = deliveryFramesFrom(currentState)
    if (timeline !== undefined && frames !== null && frames.length > 0) {
      timeline.update(frames, currentState._tag === "Running")
      return
    }
    content.replaceChildren()
    timeline = undefined
    const heading = appendText(content, "h4", "Production delivery timeline")
    heading.tabIndex = -1
    if (frames !== null && frames.length > 0) {
      timeline = renderTimeline(content, authoredRow, frames, playback, currentState._tag === "Running")
    } else {
      renderNotObserved(content, authoredRow, currentState)
    }
  }
  if (open) renderContents()
  details.addEventListener("toggle", () => {
    if (details.open) renderContents()
  })
  return {
    update: (nextState) => {
      currentState = nextState
      if (details.open) renderContents()
    }
  }
}
