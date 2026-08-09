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

const proposalSummary = (fact: { readonly summary: string }): string => fact.summary

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

const activationLabel = (ordinal: number): string =>
  ordinal === 1 ? "Initial activation 1" : `Later activation ${ordinal}`

const frameLabel = (frame: AuthoredDeliveryFrame, index: number): string => {
  const graph = frame.graph._tag === "Established" ? `observed graph ${frame.graph.revision}` : "graph not established"
  const accepted = frame.acceptedAt === null ? "no accepted facts" : `facts through journal ${frame.acceptedAt}`
  return `${index + 1}. ${activationLabel(frame.activationOrdinal)} · ${frame.storyPosition} declared interactions consumed · ${graph} · ${accepted}`
}

const deliverySummary = (delivery: AuthoredDeliveryFrame["deliveries"][number] | undefined): string =>
  delivery === undefined
    ? "none"
    : `placement: ${delivery.placement.kind} · standings: ${delivery.standings.map(({ kind }) => kind).join(" + ")}`
      + `${delivery.evidence.length === 0 ? "" : ` · evidence: ${delivery.evidence.map(({ kind }) => kind).join(", ")}`}`
      + `${delivery.obligations.length === 0 ? "" : ` · obligations: ${delivery.obligations.map(({ summary }) => summary).join(", ")}`}`

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
    heldFacts: held,
    held: held.length === 0 ? "none" : held.map(({ attemptId }) => attemptId).join("; "),
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
            `Obligations: ${facts.delivery?.obligations.map(({ summary }) => summary).join(", ") || "none"}`
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
      frame.activationOrdinal === 1
        ? "Initial activation 1 · first coordinator process"
        : `Later activation ${frame.activationOrdinal} · coordinator restarted from accepted journal history`
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
    [
      "Tracker lifecycle authority",
      "Task lifecycle comes from the tracker observation. A CompletedSuccessfully node does not prove Dalph executed or delivery-settled that task; exact Dalph settlements are counted separately below."
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
  delivery: AuthoredDeliveryFrame["deliveries"][number] | undefined,
  taskId: string
): void => {
  if (delivery === undefined) {
    parent.textContent = "none"
    return
  }
  const placement = document.createElement("details")
  appendText(placement, "summary", `Task ${taskId} broad placement: ${delivery.placement.kind}`)
  appendText(placement, "pre", delivery.placement.exact)
  parent.append(placement)
  for (const [label, values] of [
    ["Evidence", delivery.evidence],
    ["Standings", delivery.standings]
  ] as const) {
    if (values.length === 0) continue
    const details = document.createElement("details")
    appendText(details, "summary", `Task ${taskId} ${label.toLowerCase()}: ${values.map(({ kind }) => kind).join(", ")}`)
    appendText(details, "pre", values.map(({ exact }) => exact).join("\n"))
    parent.append(details)
  }
  if (delivery.obligations.length > 0) {
    const obligations = document.createElement("details")
    appendText(
      obligations,
      "summary",
      `Task ${taskId} exact obligations: ${delivery.obligations.map(({ summary }) => summary).join(", ")}`
    )
    appendText(obligations, "pre", delivery.obligations.map(({ exact }) => exact).join("\n"))
    parent.append(obligations)
  }
}

const selectedTaskSummary = (frame: AuthoredDeliveryFrame, taskId: string): string => {
  const facts = taskFacts(frame, taskId)
  const planningValues = frame.actionPlanning._tag === "DeliveryProposalsAvailable"
    ? [...frame.actionPlanning.proposals, ...frame.actionPlanning.isolatedIssues]
    : frame.actionPlanning.conflicts
  const linkedPlanning = planningValues.filter((fact) => fact.taskId === taskId)
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
        appendText(details, "summary", `Task ${taskId} exact ${reason.kind}`)
        appendText(details, "pre", reason.exact)
        frontierCell.append(details)
      }
    }
    const ticketCell = appendText(row, "td", facts.ticket)
    ticketCell.dataset.label = "Does it fit the bounded desired set?"
    if (facts.ticketFact !== undefined) {
      const details = document.createElement("details")
      appendText(details, "summary", `Task ${taskId} exact ${facts.ticketFact.placement.kind} placement`)
      appendText(details, "pre", facts.ticketFact.placement.exact)
      ticketCell.append(details)
    }
    const heldCell = appendText(row, "td", facts.held)
    heldCell.dataset.label = "Does it occupy task-work capacity?"
    if (facts.heldFacts.length > 0) {
      const details = document.createElement("details")
      appendText(details, "summary", `Task ${taskId} exact Run and attempt correlation`)
      appendText(details, "pre", JSON.stringify(facts.heldFacts, null, 2))
      heldCell.append(details)
    }
    const deliveryCell = document.createElement("td")
    deliveryCell.dataset.label = "What responsibility or obligation exists?"
    renderDeliveryFacts(deliveryCell, facts.delivery, taskId)
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
  if (previous.activationOrdinal !== frame.activationOrdinal) {
    changes.push(
      `${activationLabel(previous.activationOrdinal)} → ${activationLabel(frame.activationOrdinal)}`
    )
  }
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
    obligations.map(({ exact, kind, summary }) =>
      ({
        key: `obligation:${taskId}:${kind}:${exact}`,
        summary: `obligation · task ${taskId} · ${summary}`
      })
    )
  )
]

const restartContinuity = (
  previous: AuthoredDeliveryFrame | undefined,
  frame: AuthoredDeliveryFrame
): string | undefined => {
  if (
    previous === undefined ||
    frame.activationOrdinal === 1 ||
    previous.activationOrdinal === frame.activationOrdinal
  ) return undefined
  const before = new Map(exactCorrelations(previous).map((fact) => [fact.key, fact]))
  const after = new Map(exactCorrelations(frame).map((fact) => [fact.key, fact]))
  const retained = [...before].filter(([key]) => after.has(key)).map(([, fact]) => fact.summary)
  const removed = [...before.keys()].filter((key) => !after.has(key))
  const added = [...after.keys()].filter((key) => !before.has(key))
  return `Coordinator restarted: ${activationLabel(previous.activationOrdinal)} → ${activationLabel(frame.activationOrdinal)}. Survived unchanged: ${retained.length === 0 ? "none" : retained.join("; ")}. ${removed.length} correlations disappeared; ${added.length} appeared after restart.`
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
  const settlementCoverage = document.createElement("p")
  settlementCoverage.className = "delivery-settlement-coverage"
  const legend = document.createElement("ul")
  legend.className = "delivery-graph-legend"
  for (const value of [
    "Blue border: frontier eligible",
    "Purple halo: selected bounded ticket",
    "Double border: actual held task-work position",
    "Gold fill: retained ticket-delivery standing",
    "Cyan outer outline: selected task correlated with the facts below",
    "Excluded tasks remain visible with their exact graph reason in task facts",
    "Settlement appears only from established settlement evidence, never from executor Terminal alone"
  ]) appendText(legend, "li", value)
  parent.append(legend)
  const controls = document.createElement("div")
  controls.className = "delivery-timeline-controls"
  const previousLandmark = appendText(controls, "button", "← Jump")
  previousLandmark.type = "button"
  previousLandmark.dataset.role = "previous-landmark"
  previousLandmark.setAttribute("aria-label", "Previous delivery landmark")
  const previous = appendText(controls, "button", "← Frame")
  previous.type = "button"
  previous.dataset.role = "previous-frame"
  previous.setAttribute("aria-label", "Previous frame")
  const follow = appendText(controls, "button", "Live")
  follow.type = "button"
  follow.dataset.role = "follow-live"
  follow.setAttribute("aria-label", "Follow live")
  const selectLabel = appendText(controls, "label", "Delivery frame")
  const select = document.createElement("select")
  selectLabel.append(select)
  const next = appendText(controls, "button", "Frame →")
  next.type = "button"
  next.dataset.role = "next-frame"
  next.setAttribute("aria-label", "Next frame")
  const nextLandmark = appendText(controls, "button", "Jump →")
  nextLandmark.type = "button"
  nextLandmark.dataset.role = "next-landmark"
  nextLandmark.setAttribute("aria-label", "Next delivery landmark")
  const status = document.createElement("output")
  controls.append(status)
  const frameHost = document.createElement("div")
  frameHost.dataset.role = "delivery-frame"
  const graph = document.createElement(deliveryGraphTag) as DeliveryGraphElement
  const change = appendText(frameHost, "p", "", "delivery-frame-change")
  const restart = appendText(frameHost, "p", "", "delivery-restart-boundary")
  restart.hidden = true
  const factsHost = document.createElement("div")
  const selectedTask = appendText(frameHost, "aside", "", "selected-task-facts")
  selectedTask.dataset.role = "selected-task-facts"
  const taskFactsDisclosure = document.createElement("details")
  taskFactsDisclosure.className = "all-task-facts"
  taskFactsDisclosure.dataset.role = "all-task-facts"
  const taskFactsSummary = appendText(taskFactsDisclosure, "summary", "All task delivery facts")
  const taskFactsHost = document.createElement("div")
  taskFactsDisclosure.append(taskFactsHost)
  frameHost.prepend(graph, settlementCoverage)
  frameHost.append(factsHost, taskFactsDisclosure)
  let frames = initialFrames
  let running = initiallyRunning
  let renderedFrame: AuthoredDeliveryFrame | undefined

  const refreshSettlementCoverage = (): void => {
    const distinctSettlementCount = new Set(
      frames.flatMap(({ settlements }) =>
        settlements.map(({ attemptId, taskId }) => JSON.stringify([taskId, attemptId]))
      )
    ).size
    const settlementBearingPublicationCount = frames.filter(({ settlements }) => settlements.length > 0).length
    const settlementNoun = distinctSettlementCount === 1 ? "settlement" : "settlements"
    const publicationNoun = settlementBearingPublicationCount === 1 ? "publication" : "publications"
    const reflectionPossessive = distinctSettlementCount === 1 ? "its" : "their"
    settlementCoverage.textContent = distinctSettlementCount > 0
      ? `This timeline contains ${distinctSettlementCount} distinct established delivery ${settlementNoun}`
        + ` across ${settlementBearingPublicationCount} production ${publicationNoun};`
        + ` ${reflectionPossessive} tracker-reflection meaning remains visible in every carrying frame.`
      : running
        ? "No established delivery settlement has appeared in this running timeline yet."
        : "This cassette publishes no non-empty graph-level settlement frame. Direct integration-finality cassettes execute that protocol without fabricating graph delivery state here."
  }

  const refreshFollow = (): void => {
    follow.setAttribute("aria-pressed", String(playback.followLive))
    follow.textContent = playback.followLive ? "Live: on" : "Live"
  }

  const eligibleFrontierSignature = (frame: AuthoredDeliveryFrame): string | undefined => {
    if (frame.graph._tag !== "Established") return undefined
    const eligible = frame.graph.tasks
      .filter(({ id }) => taskFacts(frame, id).frontierFact?.standing === "Eligible")
      .map(({ id }) => id)
      .toSorted()
    return eligible.length === 0 ? undefined : JSON.stringify(eligible)
  }

  const landmarkIndexes = (): ReadonlyArray<number> => {
    const landmarks = [0]
    const firstFrame = frames[0]
    let lastEligibleFrontier = firstFrame === undefined ? undefined : eligibleFrontierSignature(firstFrame)
    for (let index = 1; index < frames.length; index += 1) {
      const frame = frames[index]
      const previousFrame = frames[index - 1]
      if (frame === undefined || previousFrame === undefined) continue
      if (previousFrame.activationOrdinal !== frame.activationOrdinal) {
        landmarks.push(index)
        continue
      }
      const eligibleFrontier = eligibleFrontierSignature(frame)
      const nextFrame = frames[index + 1]
      const nextEligibleFrontier = nextFrame === undefined ? undefined : eligibleFrontierSignature(nextFrame)
      if (
        eligibleFrontier !== undefined
        && eligibleFrontier !== lastEligibleFrontier
        && eligibleFrontier === nextEligibleFrontier
      ) {
        landmarks.push(index)
        lastEligibleFrontier = eligibleFrontier
      }
    }
    const terminalIndex = frames.length - 1
    if (!running && terminalIndex >= 0 && landmarks.at(-1) !== terminalIndex) landmarks.push(terminalIndex)
    return landmarks
  }

  const refreshNavigation = (index: number): void => {
    const newerCount = Math.max(0, frames.length - index - 1)
    status.textContent = `${index + 1} / ${frames.length} · ${running ? "running" : "settled"}`
      + `${playback.followLive ? " · live" : ` · history · ${newerCount} newer`}`
    previous.disabled = index === 0
    next.disabled = index === frames.length - 1
    const landmarks = landmarkIndexes()
    previousLandmark.disabled = !landmarks.some((landmark) => landmark < index)
    nextLandmark.disabled = !landmarks.some((landmark) => landmark > index)
  }

  const applyTaskSelection = (): void => {
    graph.selectedTaskId = playback.selectedTaskId
    for (const taskRow of taskFactsHost.querySelectorAll<HTMLTableRowElement>("tr[data-task-id]")) {
      const selected = taskRow.dataset.taskId === playback.selectedTaskId
      taskRow.classList.toggle("selected-task-row", selected)
      if (selected) taskRow.setAttribute("aria-current", "true")
      else taskRow.removeAttribute("aria-current")
    }
  }

  const show = (index: number): void => {
    const frame = frames[index]
    if (frame === undefined) return
    playback.selectedFrameIndex = index
    graph.projection = frameProjection(row, frame, index)
    change.textContent = frameChangeSummary(frames[index - 1], frame, row)
    const restartSummary = restartContinuity(frames[index - 1], frame)
    restart.hidden = restartSummary === undefined
    restart.textContent = restartSummary ?? ""
    factsHost.replaceChildren()
    renderFrameFacts(factsHost, row, frame, running)
    selectedTask.textContent = playback.selectedTaskId === null
      ? frame.graph._tag === "Established"
        ? "Select a task in the graph summary to correlate its graph state with exact delivery facts."
        : "No production-observed task is selectable in this frame because the graph is not established. Journal-recovered positions and obligations remain in the delivery facts below."
      : selectedTaskSummary(frame, playback.selectedTaskId)
    taskFactsHost.replaceChildren()
    renderTaskTable(taskFactsHost, frame)
    const taskCount = taskFactsHost.querySelectorAll("tr[data-task-id]").length
    taskFactsSummary.textContent = `All task delivery facts · ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`
    applyTaskSelection()
    renderedFrame = frame
    refreshNavigation(index)
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
  previousLandmark.addEventListener("click", () => {
    const target = landmarkIndexes().filter((index) => index < playback.selectedFrameIndex).at(-1)
    if (target !== undefined) inspectFrame(target)
  })
  nextLandmark.addEventListener("click", () => {
    const target = landmarkIndexes().find((index) => index > playback.selectedFrameIndex)
    if (target !== undefined) inspectFrame(target)
  })
  select.addEventListener("change", () => inspectFrame(Number(select.value)))
  graph.addEventListener("task-selected", (event) => {
    playback.selectedTaskId = (event as CustomEvent<{ readonly taskId: string }>).detail.taskId
    const frame = frames[playback.selectedFrameIndex]
    if (frame === undefined) return
    selectedTask.textContent = selectedTaskSummary(frame, playback.selectedTaskId)
    applyTaskSelection()
  })
  parent.append(controls, frameHost)
  const update = (nextFrames: ReadonlyArray<AuthoredDeliveryFrame>, nextRunning: boolean): void => {
    frames = nextFrames
    running = nextRunning
    refreshSettlementCoverage()
    for (let index = select.options.length; index < frames.length; index += 1) {
      const frame = frames[index]
      if (frame === undefined) continue
      const option = document.createElement("option")
      option.value = String(index)
      option.textContent = frameLabel(frame, index)
      select.append(option)
    }
    const selectedIndex = playback.followLive
      ? frames.length - 1
      : Math.min(playback.selectedFrameIndex, frames.length - 1)
    refreshFollow()
    const nextIndex = Math.max(0, selectedIndex)
    if (frames[nextIndex] !== renderedFrame) selectFrame(nextIndex)
    else refreshNavigation(nextIndex)
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
  playback: DeliveryWorkbenchPlaybackState = makeDeliveryWorkbenchPlaybackState()
): DeliveryWorkbenchController => {
  host.replaceChildren()
  if (row.surface._tag !== "AuthoredDeliverySurface") return { update: () => undefined }
  const authoredRow: AuthoredRow = { ...row, surface: row.surface }
  let currentState = state
  let timeline: DeliveryTimelineController | undefined
  const section = document.createElement("section")
  section.className = "delivery-workbench"
  section.dataset.role = "delivery-workbench"
  const heading = appendText(section, "h3", "Delivery workbench")
  heading.id = `delivery-workbench-${row.catalogKey.replaceAll(":", "-")}`
  section.setAttribute("aria-labelledby", heading.id)
  appendText(
    section,
    "p",
    "Production graph, frontier, desired tickets, held task-work positions, obligations, and settlements for the selected cassette.",
    "delivery-workbench-purpose"
  )
  host.append(section)
  const content = document.createElement("div")
  content.className = "delivery-workbench-content"
  section.append(content)
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
  renderContents()
  return {
    update: (nextState) => {
      currentState = nextState
      renderContents()
    }
  }
}
