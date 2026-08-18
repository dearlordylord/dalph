import type {
  AuthoredDeliveryFrame,
  AuthoredObservationMoment
} from "../../../packages/dalph/src/cassettes/authored-runner.ts"

export type DeliverySourceStageId =
  | "graph"
  | "frontier"
  | "tickets"
  | "deliveries"
  | "settlements"
  | "trackerReflection"

export interface DeliverySourceStageRow {
  readonly changed: boolean
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
  readonly id: DeliverySourceStageId
  readonly label: string
  readonly taskIds: ReadonlyArray<string>
  readonly value: unknown
}

const valuesOf = (frame: AuthoredDeliveryFrame): ReadonlyArray<StageValue> => [
  {
    id: "graph",
    label: "graph = trackerGraph.signal",
    taskIds: frame.graph._tag === "Established" ? frame.graph.tasks.map(({ id }) => id) : [],
    value: frame.graph
  },
  {
    id: "frontier",
    label: "frontier = mapCurrentSignal(graph, frontierOf)",
    taskIds: frame.frontier.map(({ taskId }) => taskId),
    value: frame.frontier
  },
  {
    id: "tickets",
    label: "tickets = boundedParallelTickets(frontier)",
    taskIds: frame.tickets.map(({ taskId }) => taskId),
    value: frame.tickets
  },
  {
    id: "deliveries",
    label: "responsibilities = executorResponsibilities(tickets)",
    taskIds: frame.deliveries.map(({ taskId }) => taskId),
    value: frame.deliveries
  },
  {
    id: "settlements",
    label: "settlements = deliverySettlements(responsibilities)",
    taskIds: frame.settlements.map(({ taskId }) => taskId),
    value: frame.settlements
  },
  {
    id: "trackerReflection",
    label: "return reflectDeliverySettlements(settlements)",
    taskIds: frame.settlements.map(({ taskId }) => taskId),
    value: frame.trackerReflection
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
      changed: publicationObservedAtMoment && previousValues !== undefined
        && JSON.stringify(previousById.get(row.id)?.value) !== JSON.stringify(row.value),
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
