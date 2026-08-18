import type {
  AuthoredDeliveryFrame,
  AuthoredObservationMoment
} from "../../../packages/dalph/src/cassettes/authored-runner.ts"

export type DeliverySourceStageId =
  | "read"
  | "graph"
  | "frontier"
  | "tickets"
  | "deliveries"
  | "settlements"
  | "trackerReflection"

export type DeliverySourceCellTone = "blocked" | "desired" | "fresh" | "output" | "responsibility" | "rule" | "running" | "settled" | "waiting"

export interface DeliverySourceCell {
  readonly detail: string
  readonly label: string
  readonly taskId: string | null
  readonly tone: DeliverySourceCellTone
  readonly value: string
}

export interface DeliverySourceStageRow {
  readonly changed: boolean
  readonly cells: ReadonlyArray<DeliverySourceCell>
  readonly id: DeliverySourceStageId
  readonly label: string
  readonly taskIds: ReadonlyArray<string>
  readonly value: string
}

export type DeliverySourceExplanation =
  | {
      readonly _tag: "DeliverySourceUnavailable"
      readonly status: "Delivery has not been traversed in the observed chronology."
    }
  | {
      readonly _tag: "DeliverySourceAvailable"
      readonly publicationObservedAtMoment: boolean
      readonly relationSetup: "Acquire the current tracker-graph relation once as composition setup."
      readonly rows: ReadonlyArray<DeliverySourceStageRow>
      readonly status: string
    }

interface StageValue {
  readonly cells: ReadonlyArray<DeliverySourceCell>
  readonly changeTracked: boolean
  readonly id: DeliverySourceStageId
  readonly label: string
  readonly taskIds: ReadonlyArray<string>
  readonly value: unknown
}

const cell = (
  label: string,
  value: string,
  detail: string,
  tone: DeliverySourceCellTone,
  taskId: string | null = null
): DeliverySourceCell => ({ detail, label, taskId, tone, value })

const graphCells = (frame: AuthoredDeliveryFrame): ReadonlyArray<DeliverySourceCell> => {
  if (frame.graph._tag !== "Established") {
    return [cell("GRAPH", "not established", "no coherent tracker graph", "blocked")]
  }
  const taskCount = frame.graph.tasks.length
  return frame.graph.tasks.map((task, index) =>
    cell("GRAPH TASK", task.id, `${task.lifecycle} · ${index + 1}/${taskCount}`, "fresh", task.id)
  )
}

const ticketCells = (frame: AuthoredDeliveryFrame): ReadonlyArray<DeliverySourceCell> => {
  const represented = frame.tickets.map(({ placement, taskId }) => {
    if (placement.kind === "Selected") {
      const ticket = frame.tickets.find((candidate) => candidate.taskId === taskId)
      return cell(`SLOT ${(ticket?.rank ?? 0) + 1}`, taskId, placement.kind, "desired", taskId)
    }
    if (placement.kind === "EligibleOutsideBound") {
      return cell(`WAIT ${(frame.tickets.find((candidate) => candidate.taskId === taskId)?.rank ?? 0) + 1}`, taskId, placement.kind, "waiting", taskId)
    }
    return cell("EXCLUDED", taskId, placement.kind, "blocked", taskId)
  })
  const selectedCount = frame.tickets.filter(({ placement }) => placement.kind === "Selected").length
  const emptySlots = Array.from({ length: Math.max(0, Number(frame.capacity) - selectedCount) }, (_, index) =>
    cell(`SLOT ${selectedCount + index + 1}`, "empty", `capacity ${frame.capacity}`, "waiting")
  )
  return [...represented, ...emptySlots]
}

const deliveryCell = (delivery: AuthoredDeliveryFrame["deliveries"][number]): DeliverySourceCell => {
  if (delivery.obligations.length > 0) {
    const noun = delivery.obligations.length === 1 ? "obligation" : "obligations"
    return cell(
      "RESPONSIBILITY",
      delivery.taskId,
      `${delivery.placement.kind} · ${delivery.obligations.length} live ${noun}`,
      "responsibility",
      delivery.taskId
    )
  }
  const settled = delivery.evidence.some(({ kind }) => kind === "IntegrationFinalitySettlement")
    || delivery.standings.some(({ kind }) => kind === "IntegrationFinalitySettled")
  return cell(
    settled ? "SETTLED EVIDENCE" : "DELIVERY EVIDENCE",
    delivery.taskId,
    `${delivery.placement.kind} · no live obligations`,
    settled ? "settled" : "output",
    delivery.taskId
  )
}

const valuesOf = (frame: AuthoredDeliveryFrame): ReadonlyArray<StageValue> => [
  {
    id: "read",
    label: "const trackerGraph = yield* TrackerGraphRelation",
    taskIds: frame.graph._tag === "Established" ? frame.graph.tasks.map(({ id }) => id) : [],
    value: "TrackerGraphRelation",
    changeTracked: false,
    cells: [cell("RELATION", "TrackerGraphRelation", "acquired once for this composition", "rule")]
  },
  {
    id: "graph",
    label: "const graph = trackerGraph.signal",
    taskIds: frame.graph._tag === "Established" ? frame.graph.tasks.map(({ id }) => id) : [],
    value: frame.graph,
    changeTracked: true,
    cells: graphCells(frame)
  },
  {
    id: "frontier",
    label: "const frontier = mapCurrentSignal(graph, frontierOf)",
    taskIds: frame.frontier.map(({ taskId }) => taskId),
    value: frame.frontier,
    changeTracked: true,
    cells: frame.frontier.map(({ reasons, standing, taskId }) => {
      const ticket = frame.tickets.find((candidate) => candidate.taskId === taskId)
      return cell(
        "FRONTIER",
        taskId,
        standing === "Eligible" ? ticket?.placement.kind ?? "eligible" : reasons.map(({ kind }) => kind).join(" · ") || "excluded",
        standing === "Eligible" && ticket?.placement.kind === "Selected"
          ? "desired"
          : standing === "Eligible" ? "waiting" : "blocked",
        taskId
      )
    })
  },
  {
    id: "tickets",
    label: "const tickets = yield* boundedParallelTickets(frontier)",
    taskIds: frame.tickets.map(({ taskId }) => taskId),
    value: frame.tickets,
    changeTracked: true,
    cells: ticketCells(frame)
  },
  {
    id: "deliveries",
    label: "const responsibilities = yield* executorResponsibilities(tickets)",
    taskIds: frame.deliveries.map(({ taskId }) => taskId),
    value: frame.deliveries,
    changeTracked: true,
    cells: frame.deliveries.map(deliveryCell)
  },
  {
    id: "settlements",
    label: "const settlements = yield* deliverySettlements(responsibilities)",
    taskIds: frame.settlements.map(({ taskId }) => taskId),
    value: frame.settlements,
    changeTracked: true,
    cells: frame.settlements.map(({ attemptId, taskId }) => cell("SETTLEMENT", taskId, `attempt ${attemptId}`, "settled", taskId))
  },
  {
    id: "trackerReflection",
    label: "return yield* reflectDeliverySettlements(settlements)",
    taskIds: frame.settlements.map(({ taskId }) => taskId),
    value: frame.trackerReflection,
    changeTracked: true,
    cells: [cell("REFLECTION", `${frame.trackerReflection.settlementCount} settlements`, "descriptive Delivery reflection", "output")]
  }
]

const precedingDeliveryFrame = (
  moments: ReadonlyArray<AuthoredObservationMoment>,
  index: number
): AuthoredDeliveryFrame | undefined => {
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    const moment = moments[candidate]
    if (moment?._tag === "DeliveryPublicationMoment") return moment.deliveryFrame
  }
  return undefined
}

/** Explains the literal production composition without presenting any row as an instruction pointer. */
export const deliverySourceExplanationAt = (
  moments: ReadonlyArray<AuthoredObservationMoment>,
  index: number
): DeliverySourceExplanation => {
  const moment = moments[index]
  if (moment?.deliveryFrame === null || moment === undefined) {
    return {
      _tag: "DeliverySourceUnavailable",
      status: "Delivery has not been traversed in the observed chronology."
    }
  }
  const publicationObservedAtMoment = moment._tag === "DeliveryPublicationMoment"
  const previousValues = publicationObservedAtMoment
    ? precedingDeliveryFrame(moments, index)
    : undefined
  const previousById = new Map((previousValues === undefined ? [] : valuesOf(previousValues)).map((row) => [row.id, row]))
  return {
    _tag: "DeliverySourceAvailable",
    publicationObservedAtMoment,
    relationSetup: "Acquire the current tracker-graph relation once as composition setup.",
    rows: valuesOf(moment.deliveryFrame).map((row) => ({
      changed: row.changeTracked && publicationObservedAtMoment && previousValues !== undefined
        && JSON.stringify(previousById.get(row.id)?.value) !== JSON.stringify(row.value),
      cells: row.cells,
      id: row.id,
      label: row.label,
      taskIds: [...new Set(row.taskIds)].toSorted(),
      value: JSON.stringify(row.value, null, 2)
    })),
    status: publicationObservedAtMoment && previousValues === undefined
      ? "This moment observed the first coherent Delivery publication; there is no preceding Delivery publication to compare."
      : publicationObservedAtMoment
        ? "This moment observed a coherent Delivery publication; highlighted rows changed from the preceding Delivery publication."
      : "No Delivery publication changed the source explanation at this moment."
  }
}
