import type {
  AuthoredDeliveryFrame,
  AuthoredObservationMoment
} from "../../../packages/dalph/src/cassettes/authored-runner.ts"
import type { AttemptId } from "../../../packages/contracts/src/planned-attempt.ts"
import { TaskId, type TaskId as TaskIdType } from "../../../packages/contracts/src/task-identity.ts"
import type { RunId } from "../../../packages/contracts/src/workflow-identity.ts"
import { deliveryProposalOrderTaskId, type TraceAtCursor } from "@dalph/orchestrator"
import { Match } from "effect"
import {
  deliveryGraphEncoding,
  deliveryGraphInterpretationNotes,
  deliveryGraphTag,
  type DeliveryGraphElement,
  type DeliveryGraphProjection
} from "./delivery-graph-element.ts"
import {
  deliverySourceExplanationAt,
  type DeliverySourceStageId
} from "./delivery-source-explanation.ts"
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
import {
  NextTraceCursorRequested,
  PreviousTraceCursorRequested,
  TraceCursorFollowingLive,
  TraceCursorSelected,
  auxiliaryTraceCorrelation,
  historyAtCursor,
  makeTraceCursorSelectionModel,
  projectTraceCursorSelection,
  resolveTraceCausalPredecessor,
  updateTraceCursorSelection
} from "./trace-cursor-selection.ts"

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

const appendExactJson = (parent: HTMLElement, label: string, value: unknown, role?: string): void => {
  const details = document.createElement("details")
  if (role !== undefined) details.dataset.role = role
  appendText(details, "summary", label)
  appendText(details, "pre", JSON.stringify(value, null, 2) ?? String(value))
  parent.append(details)
}

const appendSourceMarkup = (parent: HTMLElement, source: string): void => {
  const calls = new Set([
    "Effect.gen",
    "TrackerGraphRelation",
    "boundedParallelTickets",
    "deliverySettlements",
    "executorResponsibilities",
    "frontierOf",
    "mapCurrentSignal",
    "reflectDeliverySettlements"
  ])
  for (const token of source.split(/(\bconst\b|\breturn\b|yield\*|Effect\.gen|TrackerGraphRelation|boundedParallelTickets|deliverySettlements|executorResponsibilities|frontierOf|mapCurrentSignal|reflectDeliverySettlements)/u)) {
    if (token.length === 0) continue
    const span = document.createElement("span")
    if (token === "const" || token === "return" || token === "yield*") span.className = "delivery-syntax-keyword"
    else if (calls.has(token)) span.className = "delivery-syntax-call"
    span.textContent = token
    parent.append(span)
  }
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

const momentLabel = (moment: AuthoredObservationMoment, index: number): string => {
  const kind = moment._tag === "DeliveryPublicationMoment"
    ? "Delivery publication"
    : moment._tag === "DeliveryRuntimeOwnersMoment"
      ? "runtime owners"
      : `story · ${moment.occurrence._tag}`
  return `${index + 1}. ${activationLabel(moment.activationOrdinal)} · capture ${moment.captureOrder} · ${kind} · story position ${moment.storyPosition}`
}

/** Reads only task-identity-bearing fields from the typed authored occurrence. */
const taskIdsDeclaredByOccurrence = (occurrence: AuthoredObservationMoment & {
  readonly _tag: "AuthoredStoryOccurrenceMoment"
}): ReadonlyArray<string> => {
  const visit = (value: unknown, field: string | undefined): ReadonlyArray<string> => {
    if (typeof value === "string") return field === "taskId" || field === "pausedTaskId" ? [value] : []
    if (Array.isArray(value)) {
      return field?.endsWith("TaskIds") === true
        ? value.filter((item): item is string => typeof item === "string")
        : value.flatMap((item) => visit(item, field))
    }
    if (typeof value !== "object" || value === null) return []
    return Object.entries(value).flatMap(([key, nested]) => visit(nested, key))
  }
  return [...new Set(visit(occurrence.occurrence, undefined))]
}

/** Explicit task or run scope affected by a typed Pause request or failed fresh graph read. */
const constraintTaskIdsAtMoment = (
  moment: AuthoredObservationMoment,
  graphTaskIds: ReadonlyArray<TaskIdType>
): ReadonlyArray<TaskIdType> => {
  if (moment._tag !== "AuthoredStoryOccurrenceMoment") return []
  const occurrence = moment.occurrence
  if (occurrence._tag === "TrackerGraphReadFailed") return graphTaskIds
  if (occurrence._tag === "OperatorControlDirectionFailed") return [occurrence.subject.taskId]
  if (
    occurrence._tag === "OperatorAppliesControlDirection"
    || occurrence._tag === "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission"
    || occurrence._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight"
  ) {
    if (occurrence.direction !== "Pause") return []
    return occurrence.subject._tag === "Task" ? [occurrence.subject.taskId] : graphTaskIds
  }
  return []
}

const liveIntegrationTaskIds = (moment: AuthoredObservationMoment): ReadonlyArray<TaskIdType> =>
  [...new Set(moment.liveOwners.flatMap((owner) => {
    if (owner._tag.startsWith("Settled")) return []
    if (owner.proposal.admission.integrationTarget._tag !== "IntegrationTargetResourceRequired") return []
    const taskId = deliveryProposalOrderTaskId(owner.proposal.order)
    return taskId === null ? [] : [taskId]
  }))].toSorted()

/** Dominant fill tone precedence: settlement, live integration, held work, desired, waiting, explicit constraint, exclusion. */
export const dominantTaskTone = (
  frame: AuthoredDeliveryFrame,
  taskId: string,
  integrationTaskIds: ReadonlyArray<string>,
  constraintTaskIds: ReadonlyArray<string>
) => {
  if (frame.settlements.some((settlement) => settlement.taskId === taskId)) return "settled" as const
  if (integrationTaskIds.includes(taskId)) return "integrating" as const
  if (frame.heldPositions.some((held) => held.taskId === taskId)) return "running" as const
  const ticket = frame.tickets.find((candidate) => candidate.taskId === taskId)
  if (ticket?.placement.kind === "Selected") return "desired" as const
  const frontier = frame.frontier.find((candidate) => candidate.taskId === taskId)
  if (frontier?.standing === "Eligible") return "waiting" as const
  if (constraintTaskIds.includes(taskId)) return "paused" as const
  return "blocked" as const
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

const frameProjection = (
  row: AuthoredRow,
  frame: AuthoredDeliveryFrame,
  index: number,
  integrationTaskIds: ReadonlyArray<string> = [],
  constraintTaskIds: ReadonlyArray<string> = []
): DeliveryGraphProjection => {
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
          ],
          tone: dominantTaskTone(frame, id, integrationTaskIds, constraintTaskIds)
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

/**
 * Presentation-only view of the bounded task-work resource. Positions are
 * anonymous: the production fact identifies a task/Run/attempt holder, never
 * a durable slot number.
 */
const renderTaskWorkCapacity = (parent: HTMLElement, frame: AuthoredDeliveryFrame): void => {
  parent.replaceChildren()
  parent.dataset.role = "delivery-capacity-positions"
  const heldCount = frame.heldPositions.length
  appendText(parent, "h5", `Task-work positions · ${heldCount} held of capacity ${frame.capacity}`)
  appendText(
    parent,
    "p",
    "Anonymous process-local positions. An unheld position is capacity, not permission: a frontier task occupies it only after production selects and admits its responsibility. Dalph reconstructs later-activation holders from unfinished journal responsibilities; no position has a durable identity.",
    "delivery-capacity-explanation"
  )
  const positions = document.createElement("ul")
  positions.className = "delivery-capacity-position-list"
  for (const { attemptId, runId, taskId } of frame.heldPositions) {
    const item = appendText(positions, "li", `${taskId} · ${attemptId}`)
    item.dataset.taskId = taskId
    item.title = `Run ${runId}`
  }
  const available = Math.max(0, frame.capacity - heldCount)
  if (available > 0) {
    appendText(
      positions,
      "li",
      `${available} unheld ${available === 1 ? "position" : "positions"}`,
      "available-capacity-position"
    )
  }
  if (heldCount > frame.capacity) {
    appendText(
      positions,
      "li",
      `${heldCount - frame.capacity} existing ${heldCount - frame.capacity === 1 ? "holder exceeds" : "holders exceed"} the current ceiling; none is evicted.`,
      "contracted-capacity-position"
    )
  }
  parent.append(positions)
}

const integrationTargetKey = (entry: AuthoredDeliveryFrame["integrationOrder"]["responsibilities"][number]): string =>
  JSON.stringify([entry.integrationTarget.repository, entry.integrationTarget.ref])

/**
 * Maintainer-facing merge order derived from durable integration
 * responsibilities. It deliberately does not infer the process-local target
 * holder, whose acquire/use/release requirements remain in action planning.
 */
const renderIntegrationOrder = (parent: HTMLElement, frame: AuthoredDeliveryFrame): void => {
  parent.replaceChildren()
  parent.dataset.role = "delivery-integration-order"
  const { awaitingResponsibility, responsibilities } = frame.integrationOrder
  appendText(
    parent,
    "h5",
    `Integration order · ${responsibilities.length} ordered · ${awaitingResponsibility.length} awaiting responsibility`
  )
  appendText(
    parent,
    "p",
    "Journal position orders each repository/ref target. This is the merge-queue view, not a persisted queue row or proof that this process holds the integration-target position.",
    "delivery-integration-order-explanation"
  )
  if (responsibilities.length === 0 && awaitingResponsibility.length === 0) {
    appendText(parent, "p", "No accepted result has entered integration order in this frame.", "delivery-integration-order-empty")
    return
  }

  if (awaitingResponsibility.length > 0) {
    appendText(parent, "h6", "Accepted results not ordered yet")
    const waiting = document.createElement("ul")
    for (const entry of awaitingResponsibility) {
      const item = appendText(
        waiting,
        "li",
        `Task ${entry.taskId} · accepted commit ${entry.acceptedCommit} · Run ${entry.runId} · attempt ${entry.attemptId} · terminal journal ${entry.terminalAt} · awaiting durable integration responsibility`
      )
      item.dataset.taskId = entry.taskId
    }
    parent.append(waiting)
  }

  const entriesByTarget = new Map<string, Array<(typeof responsibilities)[number]>>()
  for (const entry of responsibilities) {
    const key = integrationTargetKey(entry)
    entriesByTarget.set(key, [...entriesByTarget.get(key) ?? [], entry])
  }
  for (const entries of entriesByTarget.values()) {
    const first = entries[0]
    if (first === undefined) continue
    appendText(parent, "h6", `${first.integrationTarget.repository} · ${first.integrationTarget.ref}`)
    const ordered = document.createElement("ol")
    for (const [index, entry] of entries.entries()) {
      const state = entry.state === "QueuedBeforeCutoff"
        ? "queued before integration cutoff"
        : `started past integration cutoff at journal ${entry.startedAt}`
      const item = appendText(
        ordered,
        "li",
        `#${index + 1} · Task ${entry.taskId} · ${state} · queued journal ${entry.queuedAt} · accepted commit ${entry.acceptedCommit} · Run ${entry.runId} · attempt ${entry.attemptId}`
      )
      item.dataset.taskId = entry.taskId
      item.dataset.queuedAt = String(entry.queuedAt)
      item.dataset.state = entry.state
    }
    parent.append(ordered)
  }
}

const offGraphReason = (
  frame: AuthoredDeliveryFrame,
  taskId: string,
  delivery: AuthoredDeliveryFrame["deliveries"][number] | undefined
): string => {
  if (frame.graph._tag === "NotEstablished") return "graph not established"
  if (delivery?.placement.kind === "AbsentFromCurrentGraph") return "absent from current tracker graph"
  return "not represented by the current tracker graph"
}

/**
 * Journal responsibilities can outlive tracker-graph membership. The rail is
 * deliberately adjacent to, but never merged into, the tracker-owned graph.
 */
const renderOffGraphResponsibilities = (parent: HTMLElement, frame: AuthoredDeliveryFrame): void => {
  parent.replaceChildren()
  const responsibilitiesAlignedWithGraph = new Set(
    frame.graph._tag === "Established" ? frame.graph.tasks.map(({ id }) => id) : []
  )
  const taskIds = [...new Set([
    ...frame.deliveries.map(({ taskId }) => taskId),
    ...frame.heldPositions.map(({ taskId }) => taskId)
  ])].filter((taskId) => !responsibilitiesAlignedWithGraph.has(taskId)).toSorted()
  if (taskIds.length === 0) {
    parent.removeAttribute("data-role")
    parent.hidden = true
    return
  }
  parent.dataset.role = "delivery-off-graph-responsibilities"
  parent.hidden = false
  appendText(parent, "h5", "Responsibilities not aligned with the observed graph")
  appendText(
    parent,
    "p",
    "These journal-owned responsibilities remain real, but they are not tracker nodes and no topology edge is invented for them."
  )
  const list = document.createElement("ul")
  for (const taskId of taskIds) {
    const delivery = frame.deliveries.find(({ taskId: candidate }) => candidate === taskId)
    const held = frame.heldPositions.filter(({ taskId: candidate }) => candidate === taskId)
    const obligations = delivery?.obligations.map(({ summary }) => summary) ?? []
    const correlations = held.map(({ attemptId, runId }) => `Run ${runId} · attempt ${attemptId}`)
    const placement = delivery?.placement.kind ?? "NoDeliveryPlacement"
    appendText(
      list,
      "li",
      `Task ${taskId} · ${offGraphReason(frame, taskId, delivery)} · placement ${placement}`
        + `${correlations.length === 0 ? " · does not occupy capacity" : ` · occupies capacity · ${correlations.join(", ")}`}`
        + `${obligations.length === 0 ? "" : ` · ${obligations.join("; ")}`}`
    ).dataset.taskId = taskId
  }
  parent.append(list)
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
  if (JSON.stringify(previous.integrationOrder) !== JSON.stringify(frame.integrationOrder)) {
    changes.push("integration order changed")
  }
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

export interface DeliveryWorkbenchPlaybackRuntime {
  readonly current: () => DeliveryPlaybackModel
  readonly dispatch: (message: DeliveryPlaybackMessage) => {
    readonly changed: boolean
    readonly commands: ReadonlyArray<DeliveryPlaybackCommand>
  }
}

/**
 * Necessary imperative island for the hand-written DOM adapter. Semantic
 * transitions stay in updateDeliveryPlayback; this closure only remembers the
 * latest immutable model between browser events. A FoldKit or React renderer
 * replaces this adapter, not the model/update/view contract.
 */
export const makeDeliveryWorkbenchPlaybackRuntime = (): DeliveryWorkbenchPlaybackRuntime => {
  let current = makeDeliveryPlaybackModel()
  return {
    current: () => current,
    dispatch: (message) => {
      const previous = current
      const [next, commands] = updateDeliveryPlayback(previous, message)
      current = next
      return { changed: next !== previous, commands }
    }
  }
}

interface DeliveryTimelineController {
  readonly destroy: () => void
  readonly update: (moments: ReadonlyArray<AuthoredObservationMoment>, running: boolean) => void
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

/**
 * Correlates an auxiliary authored/runtime observation only when its carried
 * production Delivery value names an exact committed journal position. The
 * capture order and story position remain display chronology; neither chooses
 * a history cursor.
 */
const auxiliaryTraceCorrelations = (
  moments: ReadonlyArray<AuthoredObservationMoment>,
  histories: ReadonlyArray<TraceAtCursor>
) => moments.flatMap((moment) => {
  const kind = moment._tag === "AuthoredStoryOccurrenceMoment"
    ? "AuthoredStoryOccurrence" as const
    : moment._tag === "DeliveryRuntimeOwnersMoment"
      ? "DeliveryRuntimeOwner" as const
      : undefined
  if (kind === undefined) return []
  const carriedPosition = moment.deliveryFrame === null
    ? null
    : moment.deliveryFrame.graph._tag === "Established"
      ? moment.deliveryFrame.graph.observation.recordedAt
      : moment.deliveryFrame.acceptedAt
  const nearestJournalCursor = carriedPosition === null
    ? null
    : histories.find(({ cursor }) => cursor.position === carriedPosition)?.cursor ?? null
  return [auxiliaryTraceCorrelation(kind, moment.captureOrder, moment.storyPosition, nearestJournalCursor)]
})

const noSelectedTraceCursorIndex = -1

const renderProductionTraceHistory = (
  parent: HTMLElement,
  histories: ReadonlyArray<TraceAtCursor>,
  moments: ReadonlyArray<AuthoredObservationMoment>
): void => {
  const section = document.createElement("section")
  section.className = "production-trace-history"
  section.dataset.role = "trace-history"
  appendText(section, "h4", "Historical journal trace · production TraceReader")
  appendText(
    section,
    "p",
    "Durable history, task graph, and workflow-causal relationships below are read from the schema-versioned production trace reader. Authored story and runtime-owner observations remain auxiliary chronology and never select or renumber a journal cursor.",
    "trace-history-explanation"
  )

  let model = makeTraceCursorSelectionModel(
    histories.map(({ cursor }) => cursor),
    auxiliaryTraceCorrelations(moments, histories)
  )
  const controls = document.createElement("div")
  controls.className = "trace-cursor-controls"
  controls.setAttribute("role", "group")
  controls.setAttribute("aria-label", "Production journal cursor navigation")
  const previous = appendText(controls, "button", "Back")
  previous.type = "button"
  previous.dataset.role = "trace-previous-cursor"
  previous.setAttribute("aria-label", "Select previous production journal cursor")
  const follow = appendText(controls, "button", "Follow live")
  follow.type = "button"
  follow.dataset.role = "trace-follow-live"
  follow.setAttribute("aria-label", "Follow newest production journal cursor")
  const selectorLabel = appendText(controls, "label", "Journal cursor")
  const selector = document.createElement("select")
  selector.dataset.role = "trace-cursor-selector"
  selectorLabel.append(selector)
  const next = appendText(controls, "button", "Forward")
  next.type = "button"
  next.dataset.role = "trace-next-cursor"
  next.setAttribute("aria-label", "Select next production journal cursor")
  const status = document.createElement("output")
  status.dataset.role = "trace-cursor-status"
  status.setAttribute("aria-live", "polite")
  controls.append(status)
  section.append(controls)

  const cursor = appendText(section, "p", "", "trace-selected-cursor")
  cursor.dataset.role = "trace-cursor"
  const graphHost = document.createElement("section")
  graphHost.dataset.role = "trace-graph"
  const causalHost = document.createElement("section")
  causalHost.dataset.role = "trace-causal-edges"
  const itemsHost = document.createElement("section")
  itemsHost.dataset.role = "trace-history-items"
  const facetsHost = document.createElement("section")
  facetsHost.dataset.role = "trace-historical-facets"
  const auxiliaryHost = document.createElement("details")
  auxiliaryHost.dataset.role = "trace-auxiliary-chronology"
  appendText(auxiliaryHost, "summary", "Authored story and runtime-owner chronology (auxiliary)")
  appendText(
    auxiliaryHost,
    "p",
    "Capture order and story position explain the authored observation stream only. A missing carried production cursor is shown as auxiliary-only; no journal position or causal edge is fabricated."
  )
  const auxiliaryList = document.createElement("ul")
  for (const auxiliary of model.auxiliary) {
    appendText(
      auxiliaryList,
      "li",
      `${auxiliary.kind} · capture ${auxiliary.captureOrder} · story position ${auxiliary.storyPosition} · ${auxiliary.nearestJournalCursor === null
        ? "auxiliary-only; no production cursor"
        : `beside Run ${auxiliary.nearestJournalCursor.runId} · journal position ${auxiliary.nearestJournalCursor.position}`}`
    )
  }
  if (model.auxiliary.length === 0) appendText(auxiliaryList, "li", "No authored story or runtime-owner moments were captured.")
  auxiliaryHost.append(auxiliaryList)
  section.append(graphHost, causalHost, itemsHost, facetsHost, auxiliaryHost)
  let causalNavigationError: string | null = null

  const renderSelected = (): void => {
    const projection = projectTraceCursorSelection(model)
    status.textContent = projection.status
    follow.setAttribute("aria-pressed", String(projection.followingLive))
    previous.disabled = projection.cursor === null || projection.options.findIndex(({ cursor: candidate }) =>
      candidate.runId === projection.cursor?.runId && candidate.position === projection.cursor?.position
    ) <= 0
    const selectedIndex = projection.cursor === null
      ? noSelectedTraceCursorIndex
      : projection.options.findIndex(({ cursor: candidate }) =>
          candidate.runId === projection.cursor?.runId && candidate.position === projection.cursor?.position
        )
    next.disabled = selectedIndex < 0 || selectedIndex >= projection.options.length - 1
    selector.replaceChildren()
    for (const [index, optionValue] of projection.options.entries()) {
      const option = document.createElement("option")
      option.value = String(index)
      option.textContent = optionValue.label
      option.selected = optionValue.selected
      option.dataset.runId = optionValue.cursor.runId
      option.dataset.journalPosition = String(optionValue.cursor.position)
      selector.append(option)
    }
    if (projection.cursor === null) {
      cursor.textContent = "No production journal cursor is available."
      graphHost.replaceChildren()
      causalHost.replaceChildren()
      itemsHost.replaceChildren()
      facetsHost.replaceChildren()
      return
    }
    cursor.textContent = `Selected production cursor: Run ${projection.cursor.runId} · JournalPosition ${projection.cursor.position}`
    cursor.dataset.runId = projection.cursor.runId
    cursor.dataset.journalPosition = String(projection.cursor.position)
    const history = historyAtCursor(histories, projection.cursor)
    graphHost.replaceChildren()
    causalHost.replaceChildren()
    itemsHost.replaceChildren()
    facetsHost.replaceChildren()
    if (history === undefined) {
      appendText(graphHost, "p", "The selected exact production cursor has no returned trace view.")
      return
    }

    appendText(graphHost, "h5", "Task graph at exact journal cursor")
    if (history.graph === null) {
      appendText(graphHost, "p", "No complete tracker graph had been observed at this exact cursor.")
    } else {
      appendText(
        graphHost,
        "p",
        `Production graph observation ${history.graph.observation.operationId} recorded at journal position ${history.graph.observation.recordedAt} · revision ${history.graph.snapshot.revision}`
      )
      const graphList = document.createElement("ul")
      for (const task of history.graph.snapshot.tasks) {
        appendText(
          graphList,
          "li",
          `${task.id} · ${task.lifecycle._tag} · prerequisites ${task.prerequisiteIds.length === 0 ? "none" : task.prerequisiteIds.join(", ")}${task.parentTaskId === null ? "" : ` · parent ${task.parentTaskId}`}`
        )
      }
      graphHost.append(graphList)
      appendText(graphHost, "p", `Graph edges: ${history.graph.edges.length}; derived task order: ${history.derivedTaskOrder.taskIds.join(", ") || "none"}.`)
      const edgeList = document.createElement("ul")
      edgeList.dataset.role = "trace-task-graph-edges"
      for (const edge of history.graph.edges) {
        appendText(
          edgeList,
          "li",
          edge._tag === "Prerequisite"
            ? `${edge.prerequisiteTaskId} → ${edge.dependantTaskId} · prerequisite`
            : `${edge.parentTaskId} → ${edge.childTaskId} · grouping`
        )
      }
      if (history.graph.edges.length > 0) graphHost.append(edgeList)
    }

    appendText(causalHost, "h5", "Workflow-causal predecessors at exact cursor")
    if (causalNavigationError !== null) {
      appendText(causalHost, "p", causalNavigationError, "trace-causal-navigation-error").dataset.role = "trace-causal-navigation-error"
    }
    if (history.relationships.workflowCausalEdges.length === 0) {
      appendText(causalHost, "p", "No workflow-causal predecessor edges are proven at this cursor.")
    } else {
      const causalList = document.createElement("ul")
      for (const edge of history.relationships.workflowCausalEdges) {
        const causalItem = appendText(causalList, "li", `${edge.predecessorOperationId} → ${edge.successorOperationId} · `)
        const predecessor = appendText(causalItem, "button", `Go to predecessor ${edge.predecessorOperationId}`)
        predecessor.type = "button"
        predecessor.dataset.role = "trace-causal-predecessor"
        predecessor.dataset.predecessorOperationId = edge.predecessorOperationId
        predecessor.dataset.successorOperationId = edge.successorOperationId
        predecessor.addEventListener("click", () => {
          const resolution = resolveTraceCausalPredecessor(
            histories,
            history,
            edge.successorOperationId,
            edge.predecessorOperationId
          )
          if (resolution._tag === "Missing") {
            causalNavigationError = `Causal predecessor unavailable: ${resolution.reason} · ${resolution.predecessorOperationId} → ${resolution.successorOperationId}`
            renderSelected()
            return
          }
          model = updateTraceCursorSelection(model, TraceCursorSelected.make({ cursor: resolution.cursor }))
          causalNavigationError = null
          renderSelected()
        })
      }
      causalHost.append(causalList)
    }

    appendText(itemsHost, "h5", `Workflow history items · ${history.items.length}`)
    const itemList = document.createElement("ul")
    for (const item of history.items) {
      const historyItem = appendText(
        itemList,
        "li",
        `Run ${item.identity.runId} · journal position ${item.identity.position} · ${item.occurrence._tag} · operations ${item.operationIds.length === 0 ? "none" : item.operationIds.join(", ")}`
      )
      historyItem.dataset.runId = item.identity.runId
      historyItem.dataset.journalPosition = String(item.identity.position)
      appendExactJson(historyItem, "Exact projected occurrence", item.occurrence, "trace-history-item-exact")
    }
    if (history.items.length === 0) appendText(itemList, "li", "No projected workflow occurrence is visible at this cursor.")
    itemsHost.append(itemList)

    appendText(facetsHost, "h5", "Historical recovery and integration facets")
    appendText(
      facetsHost,
      "p",
      `Shared TraceAtCursor envelope · observation gaps ${history.facets.recovery.observationGaps.length} · retained responsibilities ${history.facets.recovery.retainedResponsibilities.length} · preservation dispositions ${history.facets.recovery.preservationDispositions.length} · integration facts ${history.facets.integration.facts.length}.`
    )
    const facetList = document.createElement("ul")
    facetList.dataset.role = "trace-facet-list"
    for (const gap of history.facets.recovery.observationGaps) {
      const item = appendText(facetList, "li", `Recovery gap · ${gap._tag} · source journal ${gap.action.position}`)
      item.dataset.facetTag = gap._tag
      item.dataset.sourceRunId = gap.action.runId
      item.dataset.sourcePosition = String(gap.action.position)
      appendExactJson(item, "Exact recovery gap", gap, "trace-facet-exact")
    }
    for (const retained of history.facets.recovery.retainedResponsibilities) {
      const item = appendText(
        facetList,
        "li",
        `Retained responsibility · ${retained._tag} · source journal ${retained.source.position}`
      )
      item.dataset.facetTag = retained._tag
      item.dataset.sourceRunId = retained.source.runId
      item.dataset.sourcePosition = String(retained.source.position)
      appendExactJson(item, "Exact retained responsibility", retained, "trace-facet-exact")
    }
    for (const disposition of history.facets.recovery.preservationDispositions) {
      const item = appendText(
        facetList,
        "li",
        `Preservation disposition · ${disposition._tag} · source journal ${disposition.source.position}`
      )
      item.dataset.facetTag = disposition._tag
      item.dataset.sourceRunId = disposition.source.runId
      item.dataset.sourcePosition = String(disposition.source.position)
      appendExactJson(item, "Exact preservation disposition", disposition, "trace-facet-exact")
    }
    for (const fact of history.facets.integration.facts) {
      const item = appendText(facetList, "li", `Integration fact · ${fact._tag} · source journal ${fact.source.position}`)
      item.dataset.facetTag = fact._tag
      item.dataset.sourceRunId = fact.source.runId
      item.dataset.sourcePosition = String(fact.source.position)
      appendExactJson(item, "Exact integration fact", fact, "trace-facet-exact")
    }
    if (facetList.childElementCount === 0) appendText(facetList, "li", "No recovery or integration facet is visible at this cursor.")
    facetsHost.append(facetList)
  }

  const dispatch = (message: Parameters<typeof updateTraceCursorSelection>[1]): void => {
    model = updateTraceCursorSelection(model, message)
    causalNavigationError = null
    renderSelected()
  }
  previous.addEventListener("click", () => dispatch(PreviousTraceCursorRequested.make({})))
  next.addEventListener("click", () => dispatch(NextTraceCursorRequested.make({})))
  follow.addEventListener("click", () => dispatch(TraceCursorFollowingLive.make({})))
  selector.addEventListener("change", () => {
    const option = projectTraceCursorSelection(model).options[Number(selector.value)]
    if (option !== undefined) dispatch(TraceCursorSelected.make({ cursor: option.cursor }))
  })
  renderSelected()
  parent.append(section)
}

const renderTimeline = (
  parent: HTMLElement,
  row: AuthoredRow,
  initialMoments: ReadonlyArray<AuthoredObservationMoment>,
  playback: DeliveryWorkbenchPlaybackRuntime,
  initiallyRunning: boolean
): DeliveryTimelineController => {
  const readingGuide = document.createElement("details")
  readingGuide.className = "delivery-reading-guide"
  appendText(readingGuide, "summary", "How to read this delivery graph")
  appendText(
    readingGuide,
    "p",
    "Each moment is a typed authored occurrence, coherent production Delivery publication, or process-local runtime-owner change. Delivery moments are projected through the literal production composition; story-only and runtime-only moments retain the latest values without fabricating a publication. Desired bounded tickets and actual held task-work positions remain separate.",
    "delivery-provenance"
  )
  appendText(
    readingGuide,
    "p",
    "Production layer chain: acquire the tracker-graph relation as composition setup → observed graph → exhaustive frontier → bounded desired tickets → ticket deliveries → settlements → descriptive tracker reflection. No row is a current instruction pointer. Downstream action planning remains descriptive: reflection does not prove a tracker mutation, and a proposal does not prove an action ran.",
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
    "Dominant fill tone: settlement → observed live integration owner → held task work → selected desired work → eligible waiting work → explicit control/fresh-read constraint → graph exclusion",
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
  appendText(graphViewControls, "span", "Drag to pan · pinch, wheel, or trackpad to zoom")
  const resetGraphView = appendText(graphViewControls, "button", "Reset graph view")
  resetGraphView.type = "button"
  const graph = document.createElement(deliveryGraphTag) as DeliveryGraphElement
  graph.tabIndex = 0
  graph.setAttribute("aria-label", "Interactive delivery graph; drag to pan, scroll to zoom")
  const change = appendText(frameHost, "p", "", "delivery-frame-change")
  const momentEvidence = document.createElement("section")
  momentEvidence.className = "delivery-moment-evidence"
  momentEvidence.dataset.layout = "contained"
  const sourceExplanation = document.createElement("section")
  sourceExplanation.className = "delivery-source-explanation delivery-instrument"
  sourceExplanation.dataset.role = "delivery-source-explanation"
  const graphInstrument = document.createElement("section")
  graphInstrument.className = "delivery-graph-instrument delivery-instrument"
  const graphHead = document.createElement("div")
  graphHead.className = "delivery-instrument-head"
  const graphTitle = document.createElement("div")
  appendText(graphTitle, "span", "PRODUCTION OBSERVATION · TRACE FILL", "delivery-instrument-kind")
  appendText(graphTitle, "h5", "Delivery graph")
  const graphFreshness = appendText(graphHead, "span", "captured production frame", "delivery-graph-freshness")
  graphHead.prepend(graphTitle)
  const graphCanvas = document.createElement("div")
  graphCanvas.className = "delivery-graph-canvas"
  graphCanvas.append(graph)
  graphInstrument.append(graphHead, graphViewControls, graphCanvas)
  const instrumentLayout = document.createElement("div")
  instrumentLayout.className = "delivery-instrument-layout"
  instrumentLayout.append(sourceExplanation, graphInstrument)
  const capacityPositions = document.createElement("section")
  capacityPositions.className = "delivery-capacity-positions"
  const integrationOrder = document.createElement("section")
  integrationOrder.className = "delivery-integration-order"
  const offGraphResponsibilities = document.createElement("aside")
  offGraphResponsibilities.className = "delivery-off-graph-responsibilities"
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
  frameHost.prepend(
    capacityPositions,
    instrumentLayout,
    integrationOrder,
    offGraphResponsibilities,
    settlementCoverage
  )
  settlementCoverage.after(readingGuide)
  frameHost.append(factsHost, taskFactsDisclosure, momentEvidence)
  let moments = initialMoments
  let running = initiallyRunning
  let renderedFrame: AuthoredDeliveryFrame | undefined
  let selectedSourceStageId: DeliverySourceStageId | undefined

  const renderMomentEvidence = (moment: AuthoredObservationMoment): void => {
    momentEvidence.replaceChildren()
    appendText(momentEvidence, "h5", "Current observed moment")
    appendText(
      momentEvidence,
      "p",
      `Capture ${moment.captureOrder} · ${activationLabel(moment.activationOrdinal)} · story position ${moment.storyPosition}`
    )
    if (moment._tag === "AuthoredStoryOccurrenceMoment") {
      appendText(momentEvidence, "p", `Typed authored occurrence consumed: ${moment.occurrence._tag}`)
      const graphTaskIds = moment.deliveryFrame?.graph._tag === "Established"
        ? moment.deliveryFrame.graph.tasks.map(({ id }) => id)
        : []
      const mentioned = new Set(taskIdsDeclaredByOccurrence(moment))
      const storyTaskIds = graphTaskIds.filter((taskId) => mentioned.has(taskId))
      if (storyTaskIds.length > 0) {
        const tasks = document.createElement("div")
        tasks.className = "delivery-source-task-buttons"
        appendText(tasks, "span", "Story-relevant graph tasks:")
        for (const taskId of storyTaskIds) {
          const task = appendText(tasks, "button", taskId)
          task.type = "button"
          task.addEventListener("click", () => {
            selectedSourceStageId = undefined
            dispatchPlayback(TaskSelectedRequested({ taskId }))
            applyTaskSelection()
          })
        }
        momentEvidence.append(tasks)
      }
      const details = document.createElement("details")
      appendText(details, "summary", "Declared occurrence data")
      appendText(details, "pre", JSON.stringify(moment.occurrence, null, 2))
      momentEvidence.append(details)
    } else if (moment._tag === "DeliveryPublicationMoment") {
      appendText(momentEvidence, "p", "Observed one coherent production Delivery publication.")
    } else {
      appendText(
        momentEvidence,
        "p",
        `Observed process-local runtime owners: ${moment.liveOwners.length === 0 ? "none" : moment.liveOwners.map(({ _tag }) => _tag).join(", ")}.`
      )
      for (const owner of moment.liveOwners) {
        const taskId = deliveryProposalOrderTaskId(owner.proposal.order)
        const intent = owner._tag === "MaterializedDeliveryAction" || owner._tag === "SettledMaterializedDeliveryAction"
          ? ` · intent ${owner.intent}`
          : ""
        appendText(
          momentEvidence,
          "p",
          `${owner._tag} · task ${taskId ?? "graph-wide"}${intent} · exact proposal / operation correlation:`
        )
        appendText(momentEvidence, "pre", JSON.stringify(owner, null, 2))
      }
    }
  }

  const renderSourceExplanation = (moment: AuthoredObservationMoment, index: number): void => {
    sourceExplanation.replaceChildren()
    const explanation = deliverySourceExplanationAt(moments, index)
    const head = document.createElement("div")
    head.className = "delivery-instrument-head"
    const title = document.createElement("div")
    appendText(title, "span", "PRODUCTION SHAPE · FRONTIER MEMBERSHIP", "delivery-instrument-kind")
    appendText(title, "h5", "delivery.ts")
    appendText(head, "span", `moment ${index + 1} / ${moments.length}`)
    head.prepend(title)
    sourceExplanation.append(head)
    if (explanation._tag === "DeliverySourceUnavailable") {
      appendText(sourceExplanation, "p", explanation.status, "delivery-source-status")
      return
    }
    const window = document.createElement("div")
    window.className = "delivery-code-window"
    const columns = document.createElement("div")
    columns.className = "delivery-code-columns"
    appendText(columns, "span", "")
    appendText(columns, "b", "PRODUCTION SOURCE")
    appendText(columns, "b", "LIVE DATA")
    window.append(columns)
    const opening = document.createElement("div")
    opening.className = "delivery-code-line delivery-code-brace"
    appendText(opening, "span", "")
    const openingCode = document.createElement("code")
    appendSourceMarkup(openingCode, "export const delivery = Effect.gen(function* () {")
    opening.append(openingCode)
    window.append(opening)
    const rows = document.createElement("div")
    rows.className = "delivery-source-stage-rows"
    for (const rowValue of explanation.rows) {
      const item = document.createElement("div")
      item.dataset.sourceStage = rowValue.id
      item.dataset.taskIds = rowValue.taskIds.join(",")
      item.className = "delivery-code-line"
      item.classList.toggle("source-output-changed", rowValue.changed)
      const gutter = document.createElement("span")
      gutter.className = "delivery-code-gutter"
      gutter.append(document.createElement("i"))
      item.append(gutter)
      const selectStage = document.createElement("button")
      selectStage.type = "button"
      selectStage.className = "delivery-source-code-select"
      appendSourceMarkup(selectStage, rowValue.label)
      item.append(selectStage)
      selectStage.setAttribute("aria-pressed", String(selectedSourceStageId === rowValue.id))
      selectStage.addEventListener("click", () => {
        selectedSourceStageId = rowValue.id
        graph.highlightedTaskIds = rowValue.taskIds
        applyTaskSelection()
      })
      const cells = document.createElement("div")
      cells.className = "delivery-source-rectangles"
      for (const cellValue of rowValue.cells) {
        const rectangle = document.createElement(cellValue.taskId === null ? "div" : "button")
        rectangle.className = `delivery-data-rectangle tone-${cellValue.tone}`
        if (rectangle.tagName === "BUTTON") (rectangle as HTMLButtonElement).type = "button"
        if (cellValue.taskId !== null) {
          rectangle.dataset.cellTask = cellValue.taskId
          rectangle.addEventListener("click", () => {
            selectedSourceStageId = undefined
            dispatchPlayback(TaskSelectedRequested({ taskId: TaskId.make(cellValue.taskId!) }))
            applyTaskSelection()
          })
        }
        appendText(rectangle, "small", cellValue.label)
        appendText(rectangle, "b", cellValue.value)
        appendText(rectangle, "em", cellValue.detail)
        cells.append(rectangle)
      }
      if (rowValue.cells.length === 0) appendText(cells, "span", "no values at this moment", "delivery-no-data")
      item.append(cells)
      const data = document.createElement("details")
      appendText(data, "summary", `${rowValue.changed ? "changed" : "stable"} · exact typed diagnostic`)
      const taskButtons = document.createElement("div")
      taskButtons.className = "delivery-source-task-buttons"
      for (const taskId of rowValue.taskIds) {
        const task = appendText(taskButtons, "button", taskId)
        task.type = "button"
        task.addEventListener("click", () => {
          selectedSourceStageId = undefined
          dispatchPlayback(TaskSelectedRequested({ taskId: TaskId.make(taskId) }))
          applyTaskSelection()
        })
      }
      data.append(taskButtons)
      appendText(data, "pre", rowValue.value)
      data.className = "delivery-source-exact"
      item.append(data)
      rows.append(item)
    }
    window.append(rows)
    const closing = document.createElement("div")
    closing.className = "delivery-code-line delivery-code-brace"
    appendText(closing, "span", "")
    appendText(closing, "code", "})")
    window.append(closing)
    sourceExplanation.append(window)
    const key = document.createElement("div")
    key.className = "delivery-code-key"
    appendText(key, "span", "changed at this Delivery publication")
    appendText(key, "span", "selection links source · data · graph")
    sourceExplanation.append(key)
    appendText(sourceExplanation, "p", explanation.status, "delivery-source-status")
    appendText(sourceExplanation, "p", `${explanation.relationSetup} No row is a current instruction pointer.`, "delivery-source-setup")
  }

  const refreshSettlementCoverage = (): void => {
    const frames = moments.flatMap((moment) =>
      moment._tag === "DeliveryPublicationMoment" ? [moment.deliveryFrame] : []
    )
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
      moments.map((moment, index) => {
        const frame = moment.deliveryFrame
        return {
          activationOrdinal: moment.activationOrdinal,
          capacity: frame?.capacity ?? null,
          eligibleTaskIds: frame?.graph._tag === "Established"
            ? frame.graph.tasks
              .filter(({ id }) => taskFacts(frame, id).frontierFact?.standing === "Eligible")
              .map(({ id }) => id)
            : [],
          heldTaskIds: frame?.heldPositions.map(({ taskId }) => taskId) ?? [],
          integrationOwnerTaskIds: liveIntegrationTaskIds(moment),
          label: momentLabel(moment, index),
          responsibilityIdentity: frame === null
            ? "unavailable"
            : JSON.stringify({ deliveries: frame.deliveries, integrationOrder: frame.integrationOrder }),
          responsibilityTaskIds: frame === null
            ? []
            : [...new Set([
                ...frame.integrationOrder.awaitingResponsibility.map(({ taskId }) => taskId),
                ...frame.integrationOrder.responsibilities.map(({ taskId }) => taskId),
                ...frame.deliveries.map(({ taskId }) => taskId)
              ])],
          storyLandmark: moment._tag === "AuthoredStoryOccurrenceMoment"
            ? row.storyItemLandmarks[moment.storyPosition - 1] ?? null
            : null
        }
      }),
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
    const selectedTaskId = projectDeliveryPlayback(playback.current()).selectedTaskId
    graph.selectedTaskId = selectedTaskId
    if (selectedSourceStageId === undefined) graph.highlightedTaskIds = selectedTaskId === null ? [] : [selectedTaskId]
    for (const taskRow of taskFactsHost.querySelectorAll<HTMLTableRowElement>("tr[data-task-id]")) {
      const selected = taskRow.dataset.taskId === selectedTaskId
      taskRow.classList.toggle("selected-task-row", selected)
      if (selected) taskRow.setAttribute("aria-current", "true")
      else taskRow.removeAttribute("aria-current")
    }
    for (const sourceRow of sourceExplanation.querySelectorAll<HTMLElement>("[data-source-stage]")) {
      const taskIds = (sourceRow.dataset.taskIds ?? "").split(",").filter((taskId) => taskId.length > 0)
      const related = sourceRow.dataset.sourceStage === selectedSourceStageId
        || (selectedTaskId !== null && taskIds.includes(selectedTaskId))
      const selectionActive = selectedSourceStageId !== undefined || selectedTaskId !== null
      sourceRow.classList.toggle("source-selection-related", related)
      sourceRow.classList.toggle("source-selection-muted", selectionActive && !related)
      sourceRow.querySelector("button")?.setAttribute(
        "aria-pressed",
        String(sourceRow.dataset.sourceStage === selectedSourceStageId)
      )
      for (const rectangle of sourceRow.querySelectorAll<HTMLElement>("[data-cell-task]")) {
        const cellRelated = selectedTaskId !== null && rectangle.dataset.cellTask === selectedTaskId
        rectangle.classList.toggle("source-selection-related", cellRelated)
        rectangle.classList.toggle("source-selection-muted", selectedTaskId !== null && !cellRelated)
      }
    }
  }

  const show = (index: number): void => {
    const moment = moments[index]
    if (moment === undefined) return
    graphFreshness.textContent = moment.deliveryFrame === null
      ? "declared cassette input"
      : moment._tag === "DeliveryPublicationMoment"
        ? "coherent Delivery publication"
        : "retained Delivery facts"
    graphFreshness.classList.toggle("stale", moment._tag !== "DeliveryPublicationMoment")
    renderMomentEvidence(moment)
    renderSourceExplanation(moment, index)
    const frame = moment.deliveryFrame
    if (frame === null) {
      graph.projection = declaredProjection(row)
      graph.dataset.palette = "trace-fill"
      change.textContent = "No Delivery publication has been observed at this moment."
      factsHost.replaceChildren()
      appendText(factsHost, "p", "Delivery source stages are unavailable until production publishes coherent Delivery consequences.")
      selectedTask.textContent = "The graph is controlled cassette input, not a production-observed Delivery graph."
      taskFactsHost.replaceChildren()
      renderedFrame = undefined
      return
    }
    graph.dataset.palette = "trace-fill"
    const graphTaskIds = frame.graph._tag === "Established" ? frame.graph.tasks.map(({ id }) => id) : []
    graph.projection = frameProjection(
      row,
      frame,
      index,
      liveIntegrationTaskIds(moment),
      constraintTaskIdsAtMoment(moment, graphTaskIds)
    )
    renderTaskWorkCapacity(capacityPositions, frame)
    renderIntegrationOrder(integrationOrder, frame)
    renderOffGraphResponsibilities(offGraphResponsibilities, frame)
    resetGraphView.disabled = frame.graph._tag !== "Established"
    const previousFrame = moments.slice(0, index).findLast((candidate) => candidate.deliveryFrame !== frame)?.deliveryFrame ?? undefined
    change.textContent = moment._tag === "DeliveryPublicationMoment"
      ? frameChangeSummary(previousFrame ?? undefined, frame, row)
      : "No Delivery publication changed the source explanation at this moment."
    const restartSummary = restartContinuity(previousFrame ?? undefined, frame)
    restart.hidden = restartSummary === undefined
    restart.textContent = restartSummary ?? ""
    factsHost.replaceChildren()
    renderFrameFacts(factsHost, row, frame, running)
    const selectedTaskId = projectDeliveryPlayback(playback.current()).selectedTaskId
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
    const projection = projectDeliveryPlayback(playback.current())
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
      show(selectedIndex)
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
    const { changed, commands } = playback.dispatch(message)
    if (!changed && commands.length === 0) return
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
    const source = event.target instanceof HTMLButtonElement && controls.contains(event.target)
      ? "PlaybackControl"
      : "WorkbenchShortcut"
    const message = deliveryPlaybackShortcutMessage(event.key, source)
    if (message === null) return
    if (
      message._tag === "PreviousLandmarkRequested" && previousLandmark.disabled
      || message._tag === "NextLandmarkRequested" && nextLandmark.disabled
      || message._tag === "PreviousFrameRequested" && previous.disabled
      || message._tag === "NextFrameRequested" && next.disabled
    ) {
      event.preventDefault()
      return
    }
    dispatchPlayback(message)
    event.preventDefault()
  }
  keyboardSurface.addEventListener("keydown", handleKeyboard)
  graph.addEventListener("task-selected", (event) => {
    selectedSourceStageId = undefined
    const taskId = TaskId.make((event as CustomEvent<{ readonly taskId: string }>).detail.taskId)
    dispatchPlayback(TaskSelectedRequested({ taskId }))
    const selectedFrameIndex = projectDeliveryPlayback(playback.current()).currentFrameIndex
    const frame = selectedFrameIndex === null ? undefined : moments[selectedFrameIndex]?.deliveryFrame
    if (frame === undefined || frame === null) return
    selectedTask.textContent = selectedTaskSummary(frame, taskId)
    applyTaskSelection()
  })
  resetGraphView.addEventListener("click", () => graph.resetView())
  parent.append(controls, shortcuts, frameHost)
  const update = (nextMoments: ReadonlyArray<AuthoredObservationMoment>, nextRunning: boolean): void => {
    moments = nextMoments
    running = nextRunning
    refreshSettlementCoverage()
    dispatchPlayback(FramesUpdated({ frames: playbackFrames(), running }))
  }
  update(initialMoments, initiallyRunning)
  return {
    destroy: () => keyboardSurface.removeEventListener("keydown", handleKeyboard),
    update
  }
}

const observationMomentsFrom = (state: CassetteState): ReadonlyArray<AuthoredObservationMoment> | null => {
  if (state._tag === "Running") return state.observationMoments
  return state._tag === "Settled" && state.result._tag === "Completed" ? state.result.observationMoments : null
}

const productionTraceHistoriesFrom = (state: CassetteState): ReadonlyArray<TraceAtCursor> | null => {
  if (state._tag !== "Settled" || state.result._tag !== "Completed") return null
  return state.result.traceHistories
}

export const renderCassetteDeliveryWorkbench = (
  host: HTMLElement,
  row: CassetteRow,
  state: CassetteState,
  playback: DeliveryWorkbenchPlaybackRuntime = makeDeliveryWorkbenchPlaybackRuntime(),
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
  const historicalTraceHost = document.createElement("div")
  historicalTraceHost.dataset.role = "trace-history-host"
  const deliveryTimelineHost = document.createElement("div")
  deliveryTimelineHost.dataset.role = "delivery-timeline-host"
  content.append(historicalTraceHost, deliveryTimelineHost)
  const renderContents = (): void => {
    const moments = observationMomentsFrom(currentState)
    const traceHistories = productionTraceHistoriesFrom(currentState)
    historicalTraceHost.replaceChildren()
    if (traceHistories !== null && traceHistories.length > 0) {
      renderProductionTraceHistory(historicalTraceHost, traceHistories, moments ?? [])
    }
    if (timeline !== undefined && moments !== null && moments.length > 0) {
      timeline.update(moments, currentState._tag === "Running")
      return
    }
    timeline?.destroy()
    deliveryTimelineHost.replaceChildren()
    timeline = undefined
    const heading = appendText(deliveryTimelineHost, "h4", "Production delivery timeline · auxiliary chronology")
    heading.tabIndex = -1
    if (moments !== null && moments.length > 0) {
      timeline = renderTimeline(deliveryTimelineHost, authoredRow, moments, playback, currentState._tag === "Running")
    } else {
      renderNotObserved(deliveryTimelineHost, authoredRow, currentState)
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
