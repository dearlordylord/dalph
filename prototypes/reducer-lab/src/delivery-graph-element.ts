/** The two tracker-owned relationships displayed by the delivery graph. */
export type DeliveryGraphEdgeKind = "Prerequisite" | "Grouping"

/** One registry owns each visual encoding and the sentence that explains it. */
export const deliveryGraphEncoding = {
  frontierEligible: { className: "frontier", legend: "Blue border: frontier eligible" },
  heldPosition: { className: "held", legend: "Double border: actual held task-work position" },
  retainedStanding: { className: "standing", legend: "Gold fill: retained ticket-delivery standing" },
  selectedTask: {
    className: "selected-task",
    legend: "Cyan outer outline: selected task correlated with the facts below"
  },
  selectedTicket: { className: "placement", legend: "Purple halo: selected bounded ticket" }
} as const

export type DeliveryGraphDisplayClass =
  (typeof deliveryGraphEncoding)[keyof typeof deliveryGraphEncoding]["className"]

export const deliveryGraphInterpretationNotes = [
  "Excluded tasks remain visible with their exact graph reason in task facts",
  "Settlement appears only from established settlement evidence, never from executor Terminal alone"
] as const

/**
 * Presentation hints derived by the caller from one coherent delivery frame.
 * They are labels and CSS-safe class tokens, not another source of workflow
 * truth.
 */
export interface DeliveryGraphTaskDisplay {
  readonly classes?: ReadonlyArray<DeliveryGraphDisplayClass>
  readonly labels?: ReadonlyArray<string>
}

/** One task in a production-observed or controlled-input task graph. */
export interface DeliveryGraphTask {
  readonly display?: DeliveryGraphTaskDisplay
  readonly id: string
  readonly lifecycle: string
  readonly title?: string
}

export interface DeliveryGraphEdge {
  readonly from: string
  readonly kind: DeliveryGraphEdgeKind
  readonly to: string
}

/**
 * Minimal renderer input. `key` identifies the source/frame, `fingerprint`
 * identifies its graph content, and `status` explains the observation state to
 * people using the non-canvas summary.
 */
export interface DeliveryGraphProjection {
  readonly edges: ReadonlyArray<DeliveryGraphEdge>
  readonly fingerprint: string
  readonly key: string
  readonly status: string
  readonly tasks: ReadonlyArray<DeliveryGraphTask>
}

export interface DeliveryGraphTaskSelectedDetail {
  readonly taskId: string
}

export const deliveryGraphTag = "dalph-delivery-graph"

export interface DeliveryGraphElement extends HTMLElement {
  projection: DeliveryGraphProjection | null
  resetView: () => void
  selectedTaskId: string | null
}

declare global {
  interface HTMLElementTagNameMap {
    [deliveryGraphTag]: DeliveryGraphElement
  }

  interface HTMLElementEventMap {
    "task-selected": CustomEvent<DeliveryGraphTaskSelectedDetail>
  }
}
