import type { AuthoredDeliveryFrame } from "../../../packages/dalph/src/cassettes/authored-runner.ts"
import type { AttemptId } from "../../../packages/contracts/src/planned-attempt.ts"
import { TaskId } from "../../../packages/contracts/src/task-identity.ts"
import type { RunId } from "../../../packages/contracts/src/workflow-identity.ts"
import { Match } from "effect"
import {
  deliveryGraphEncoding,
  deliveryGraphInterpretationNotes,
  deliveryGraphTag,
  type DeliveryGraphElement,
  type DeliveryGraphProjection
} from "./delivery-graph-element.ts"
import type { maintainedCassetteRows } from "./cassette-lab.ts"
import type { CassetteState } from "./cassette-lab-view.ts"
import {
  DeliveryFrameIndex,
  deliveryPlaybackShortcutMessage,
  deliveryPlaybackViewContract,
  deliveryPlaybackFramesFrom,
  type DeliveryPlaybackCommand,
  type DeliveryPlaybackMessage,
  type DeliveryPlaybackModel,
  ExactFrameSelected,
  FollowLiveRequested,
  FramesUpdated,
  makeDeliveryPlaybackModel,
  NextFrameRequested,
  NextLandmarkRequested,
  PreviousFrameRequested,
  PreviousLandmarkRequested,
  projectDeliveryPlayback,
  TaskSelectedRequested,
  updateDeliveryPlayback
} from "./delivery-playback.ts"

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
            facts.frontierFact?.standing === "Eligible" ? deliveryGraphEncoding.frontierEligible.className : null,
            facts.ticket.startsWith("Selected") ? deliveryGraphEncoding.selectedTicket.className : null,
            facts.held === "none" ? null : deliveryGraphEncoding.heldPosition.className,
            facts.delivery === undefined ? null : deliveryGraphEncoding.retainedStanding.className
          ].filter((value) => value !== null),
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
  model: DeliveryPlaybackModel
}

export const makeDeliveryWorkbenchPlaybackState = (): DeliveryWorkbenchPlaybackState => ({
  model: makeDeliveryPlaybackModel()
})

interface DeliveryTimelineController {
  readonly destroy: () => void
  readonly update: (frames: ReadonlyArray<AuthoredDeliveryFrame>, running: boolean) => void
}

export interface DeliveryWorkbenchController {
  readonly update: (state: CassetteState) => void
}

type AuthoredObligationDiagnostic = AuthoredDeliveryFrame["deliveries"][number]["obligations"][number]

type ExactCorrelationIdentity =
  | {
      readonly _tag: "HeldPosition"
      readonly attemptId: AttemptId
      readonly runId: RunId
      readonly taskId: TaskId
    }
  | {
      readonly _tag: "Obligation"
      readonly attemptId: AttemptId | null
      readonly exact: AuthoredObligationDiagnostic["exact"]
      readonly kind: AuthoredObligationDiagnostic["kind"]
      readonly taskId: TaskId
    }

interface ExactCorrelationFact {
  readonly identity: ExactCorrelationIdentity
  readonly summary: string
}

const exactCorrelations = (frame: AuthoredDeliveryFrame): ReadonlyArray<ExactCorrelationFact> => [
  ...frame.heldPositions.map(({ attemptId, runId, taskId }) => ({
    identity: { _tag: "HeldPosition" as const, attemptId, runId, taskId },
    summary: `held position · task ${taskId} · attempt ${attemptId} · Run ${runId}`
  })),
  ...frame.deliveries.flatMap(({ obligations, taskId }) =>
    obligations.map(({ attemptId, exact, kind, summary }) =>
      ({
        identity: { _tag: "Obligation" as const, attemptId, exact, kind, taskId },
        summary: `obligation · task ${taskId} · ${summary}`
      })
    )
  )
]

const sameCorrelationIdentity = (
  left: ExactCorrelationIdentity,
  right: ExactCorrelationIdentity
): boolean => {
  if (left._tag !== right._tag || left.taskId !== right.taskId || left.attemptId !== right.attemptId) return false
  return left._tag === "HeldPosition" && right._tag === "HeldPosition"
    ? left.runId === right.runId
    : left._tag === "Obligation" && right._tag === "Obligation"
      && left.kind === right.kind
      && left.exact === right.exact
}

const joinedSummaries = (summaries: ReadonlyArray<string>): string =>
  summaries.length === 0 ? "none" : summaries.join("; ")

const restartContinuity = (
  previous: AuthoredDeliveryFrame | undefined,
  frame: AuthoredDeliveryFrame
): string | undefined => {
  if (
    previous === undefined ||
    frame.activationOrdinal === 1 ||
    previous.activationOrdinal === frame.activationOrdinal
  ) return undefined
  const before = exactCorrelations(previous)
  const after = exactCorrelations(frame)
  const matchedAfter = new Set<number>()
  const unchanged: Array<string> = []
  const changed: Array<string> = []
  const disappeared: Array<string> = []
  for (const beforeFact of before) {
    const afterIndex = after.findIndex((afterFact, index) =>
      !matchedAfter.has(index) && sameCorrelationIdentity(beforeFact.identity, afterFact.identity)
    )
    if (afterIndex < 0) {
      disappeared.push(beforeFact.summary)
      continue
    }
    matchedAfter.add(afterIndex)
    const afterFact = after[afterIndex]
    if (afterFact === undefined) continue
    if (afterFact.summary === beforeFact.summary) unchanged.push(beforeFact.summary)
    else changed.push(`${beforeFact.summary} → ${afterFact.summary}`)
  }
  const added = after.flatMap((fact, index) => matchedAfter.has(index) ? [] : [fact.summary])
  return `Coordinator restarted: ${activationLabel(previous.activationOrdinal)} → ${activationLabel(frame.activationOrdinal)}. Unchanged: ${joinedSummaries(unchanged)}. Changed: ${joinedSummaries(changed)}. Disappeared: ${joinedSummaries(disappeared)}. Added: ${joinedSummaries(added)}.`
}

const renderTimeline = (
  parent: HTMLElement,
  row: AuthoredRow,
  initialFrames: ReadonlyArray<AuthoredDeliveryFrame>,
  playback: DeliveryWorkbenchPlaybackState,
  initiallyRunning: boolean
): DeliveryTimelineController => {
  const readingGuide = document.createElement("details")
  readingGuide.className = "delivery-reading-guide"
  appendText(readingGuide, "summary", "How to read this delivery graph")
  appendText(
    readingGuide,
    "p",
    "Each frame was captured from the production reactive delivery publication during the cassette run, then projected through the literal production delivery composition. Desired bounded tickets and actual held task-work positions remain separate.",
    "delivery-provenance"
  )
  appendText(
    readingGuide,
    "p",
    "Production layer chain: observed graph → exhaustive frontier → bounded desired tickets → ticket deliveries → settlements → descriptive tracker reflection → downstream action planning. Reflection does not prove a tracker mutation, and a proposal does not prove an action ran.",
    "delivery-layer-chain"
  )
  const settlementCoverage = document.createElement("p")
  settlementCoverage.className = "delivery-settlement-coverage"
  const legend = document.createElement("ul")
  legend.className = "delivery-graph-legend"
  for (const value of [
    deliveryGraphEncoding.frontierEligible.legend,
    deliveryGraphEncoding.selectedTicket.legend,
    deliveryGraphEncoding.heldPosition.legend,
    deliveryGraphEncoding.retainedStanding.legend,
    deliveryGraphEncoding.selectedTask.legend,
    ...deliveryGraphInterpretationNotes
  ]) appendText(legend, "li", value)
  readingGuide.append(legend)
  appendText(
    readingGuide,
    "p",
    "Direct integration-finality cassettes run their protocol in the selected cassette surface without fabricating graph delivery state.",
    "delivery-direct-protocol-note"
  )
  const controls = document.createElement("div")
  controls.className = "delivery-timeline-controls"
  controls.tabIndex = -1
  controls.setAttribute("role", "group")
  controls.setAttribute("aria-label", deliveryPlaybackViewContract.groupLabel)
  const previousLandmark = appendText(controls, "button", deliveryPlaybackViewContract.previousLandmark.label)
  previousLandmark.type = "button"
  previousLandmark.dataset.role = "previous-landmark"
  previousLandmark.setAttribute("aria-label", deliveryPlaybackViewContract.previousLandmark.accessibleName)
  const previous = appendText(controls, "button", deliveryPlaybackViewContract.previousFrame.label)
  previous.type = "button"
  previous.dataset.role = "previous-frame"
  previous.setAttribute("aria-label", deliveryPlaybackViewContract.previousFrame.accessibleName)
  const follow = appendText(controls, "button", deliveryPlaybackViewContract.followLive.label)
  follow.type = "button"
  follow.dataset.role = "follow-live"
  follow.setAttribute("aria-label", deliveryPlaybackViewContract.followLive.accessibleName)
  const selectLabel = appendText(controls, "label", deliveryPlaybackViewContract.frameSelectorLabel)
  const select = document.createElement("select")
  selectLabel.append(select)
  const next = appendText(controls, "button", deliveryPlaybackViewContract.nextFrame.label)
  next.type = "button"
  next.dataset.role = "next-frame"
  next.setAttribute("aria-label", deliveryPlaybackViewContract.nextFrame.accessibleName)
  const nextLandmark = appendText(controls, "button", deliveryPlaybackViewContract.nextLandmark.label)
  nextLandmark.type = "button"
  nextLandmark.dataset.role = "next-landmark"
  nextLandmark.setAttribute("aria-label", deliveryPlaybackViewContract.nextLandmark.accessibleName)
  const status = document.createElement("output")
  status.setAttribute("aria-label", deliveryPlaybackViewContract.statusLabel)
  status.setAttribute("aria-live", "polite")
  controls.append(status)
  const shortcuts = document.createElement("p")
  shortcuts.className = "delivery-playback-shortcuts"
  shortcuts.textContent = deliveryPlaybackViewContract.help
  const frameHost = document.createElement("div")
  frameHost.dataset.role = "delivery-frame"
  const graphViewControls = document.createElement("div")
  graphViewControls.className = "delivery-graph-view-controls"
  appendText(graphViewControls, "span", "Drag to pan · wheel or trackpad to zoom")
  const resetGraphView = appendText(graphViewControls, "button", "Reset graph view")
  resetGraphView.type = "button"
  const graph = document.createElement(deliveryGraphTag) as DeliveryGraphElement
  graph.tabIndex = 0
  graph.setAttribute("aria-label", "Interactive delivery graph; drag to pan, scroll to zoom")
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
  frameHost.prepend(graphViewControls, graph, settlementCoverage)
  settlementCoverage.after(readingGuide)
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
      : "Established settlements in this timeline: 0."
  }

  const playbackFrames = (): ReturnType<typeof deliveryPlaybackFramesFrom> =>
    deliveryPlaybackFramesFrom(
      frames.map((frame, index) => ({
        activationOrdinal: frame.activationOrdinal,
        eligibleTaskIds: frame.graph._tag === "Established"
          ? frame.graph.tasks
            .filter(({ id }) => taskFacts(frame, id).frontierFact?.standing === "Eligible")
            .map(({ id }) => id)
          : [],
        label: frameLabel(frame, index)
      })),
      running
    )

  const setNativeSelectedFrame = (index: number): void => {
    for (const option of select.options) {
      if (option.value === String(index)) option.setAttribute("selected", "")
      else option.removeAttribute("selected")
    }
    try {
      select.value = String(index)
    } catch {
      // Linkedom exposes a getter-only value; selected attributes above keep the acceptance DOM deterministic.
    }
  }

  const applyTaskSelection = (): void => {
    const selectedTaskId = projectDeliveryPlayback(playback.model).selectedTaskId
    graph.selectedTaskId = selectedTaskId
    for (const taskRow of taskFactsHost.querySelectorAll<HTMLTableRowElement>("tr[data-task-id]")) {
      const selected = taskRow.dataset.taskId === selectedTaskId
      taskRow.classList.toggle("selected-task-row", selected)
      if (selected) taskRow.setAttribute("aria-current", "true")
      else taskRow.removeAttribute("aria-current")
    }
  }

  const show = (index: number): void => {
    const frame = frames[index]
    if (frame === undefined) return
    graph.projection = frameProjection(row, frame, index)
    resetGraphView.disabled = frame.graph._tag !== "Established"
    change.textContent = frameChangeSummary(frames[index - 1], frame, row)
    const restartSummary = restartContinuity(frames[index - 1], frame)
    restart.hidden = restartSummary === undefined
    restart.textContent = restartSummary ?? ""
    factsHost.replaceChildren()
    renderFrameFacts(factsHost, row, frame, running)
    const selectedTaskId = projectDeliveryPlayback(playback.model).selectedTaskId
    selectedTask.textContent = selectedTaskId === null
      ? frame.graph._tag === "Established"
        ? "Select a task in the graph summary to correlate its graph state with exact delivery facts."
        : "No production-observed task is selectable in this frame because the graph is not established. Journal-recovered positions and obligations remain in the delivery facts below."
      : selectedTaskSummary(frame, selectedTaskId)
    taskFactsHost.replaceChildren()
    renderTaskTable(taskFactsHost, frame)
    const taskCount = taskFactsHost.querySelectorAll("tr[data-task-id]").length
    taskFactsSummary.textContent = `All task delivery facts · ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`
    applyTaskSelection()
    renderedFrame = frame
  }

  const renderPlayback = (commands: ReadonlyArray<DeliveryPlaybackCommand> = []): void => {
    const projection = projectDeliveryPlayback(playback.model)
    follow.setAttribute("aria-pressed", String(projection.followingLive))
    follow.textContent = projection.followingLive
      ? deliveryPlaybackViewContract.followLive.activeLabel
      : deliveryPlaybackViewContract.followLive.label
    status.textContent = projection.status
    previous.disabled = !projection.previousFrameAvailable
    next.disabled = !projection.nextFrameAvailable
    previousLandmark.disabled = !projection.previousLandmarkAvailable
    nextLandmark.disabled = !projection.nextLandmarkAvailable
    for (const frameOption of projection.frameOptions) {
      const index = frameOption.frameIndex
      const option = select.options[index] ?? document.createElement("option")
      option.value = String(index)
      option.textContent = frameOption.landmarkLabel === null
        ? frameOption.label
        : `${frameOption.label} · Landmark: ${frameOption.landmarkLabel}`
      option.dataset.landmark = frameOption.landmarkLabel ?? ""
      if (select.options[index] === undefined) select.append(option)
    }
    const selectedIndex = projection.currentFrameIndex
    if (selectedIndex !== null) {
      setNativeSelectedFrame(selectedIndex)
      if (frames[selectedIndex] !== renderedFrame) show(selectedIndex)
    }
    // Necessary imperative island: browsers drop focus when a focused button
    // becomes disabled. The pure update emits this command only at that edge.
    for (const command of commands) {
      Match.value(command).pipe(
        Match.tagsExhaustive({
          FocusDeliveryPlaybackControls: () => controls.focus({ preventScroll: true })
        })
      )
    }
  }

  const dispatchPlayback = (message: DeliveryPlaybackMessage): void => {
    const [model, commands] = updateDeliveryPlayback(playback.model, message)
    playback.model = model
    renderPlayback(commands)
  }

  follow.addEventListener("click", () => dispatchPlayback(FollowLiveRequested()))
  previous.addEventListener("click", () =>
    dispatchPlayback(PreviousFrameRequested({ source: "PlaybackControl" })))
  next.addEventListener("click", () =>
    dispatchPlayback(NextFrameRequested({ source: "PlaybackControl" })))
  previousLandmark.addEventListener("click", () =>
    dispatchPlayback(PreviousLandmarkRequested({ source: "PlaybackControl" })))
  nextLandmark.addEventListener("click", () =>
    dispatchPlayback(NextLandmarkRequested({ source: "PlaybackControl" })))
  select.addEventListener("change", () =>
    dispatchPlayback(ExactFrameSelected({ frameIndex: DeliveryFrameIndex.make(Number(select.value)) })))
  const keyboardSurface = parent.closest<HTMLElement>("[data-role='delivery-workbench']") ?? parent
  const handleKeyboard = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return
    const message = deliveryPlaybackShortcutMessage(event.key)
    if (message === null) return
    dispatchPlayback(message)
    event.preventDefault()
  }
  keyboardSurface.addEventListener("keydown", handleKeyboard)
  graph.addEventListener("task-selected", (event) => {
    const taskId = TaskId.make((event as CustomEvent<{ readonly taskId: string }>).detail.taskId)
    dispatchPlayback(TaskSelectedRequested({ taskId }))
    const selectedFrameIndex = projectDeliveryPlayback(playback.model).currentFrameIndex
    const frame = selectedFrameIndex === null ? undefined : frames[selectedFrameIndex]
    if (frame === undefined) return
    selectedTask.textContent = selectedTaskSummary(frame, taskId)
    applyTaskSelection()
  })
  resetGraphView.addEventListener("click", () => graph.resetView())
  parent.append(controls, shortcuts, frameHost)
  const update = (nextFrames: ReadonlyArray<AuthoredDeliveryFrame>, nextRunning: boolean): void => {
    frames = nextFrames
    running = nextRunning
    refreshSettlementCoverage()
    dispatchPlayback(FramesUpdated({ frames: playbackFrames(), running }))
  }
  update(initialFrames, initiallyRunning)
  return {
    destroy: () => keyboardSurface.removeEventListener("keydown", handleKeyboard),
    update
  }
}

const deliveryFramesFrom = (state: CassetteState): ReadonlyArray<AuthoredDeliveryFrame> | null => {
  if (state._tag === "Running") return state.deliveryFrames
  return state._tag === "Settled" && state.result._tag === "Completed" ? state.result.deliveryFrames : null
}

export const renderCassetteDeliveryWorkbench = (
  host: HTMLElement,
  row: CassetteRow,
  state: CassetteState,
  playback: DeliveryWorkbenchPlaybackState = makeDeliveryWorkbenchPlaybackState(),
  cassetteControls?: HTMLElement
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
  if (cassetteControls !== undefined) section.append(cassetteControls)
  appendText(section, "p", "Desired tickets are not held capacity.", "delivery-capacity-note")
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
    timeline?.destroy()
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
