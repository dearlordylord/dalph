import cytoscape, {
  type Core,
  type ElementDefinition,
  type EventObjectNode
} from "cytoscape"
import dagre from "cytoscape-dagre"
import {
  type DeliveryGraphEdge,
  type DeliveryGraphProjection,
  type DeliveryGraphTask,
  type DeliveryGraphViewport,
  deliveryGraphEncoding,
  deliveryGraphTag
} from "./delivery-graph-element.ts"

cytoscape.use(dagre)

interface RenderedTask extends DeliveryGraphTask {
  readonly missing: boolean
}

interface CytoscapeTaskData {
  readonly id: string
  readonly label: string
  readonly lifecycle: string
  readonly missing: "false" | "true"
}

type DeliveryGraphPalette = "original" | "trace-fill"

const deliveryGraphPalette = (value: string | undefined): DeliveryGraphPalette =>
  value === "trace-fill" ? value : "original"

const placeholderTask = (id: string): RenderedTask => ({
  id,
  lifecycle: "Missing endpoint",
  missing: true,
  title: "Referenced by an edge but absent from this projection"
})

const renderedTasks = (projection: DeliveryGraphProjection): ReadonlyArray<RenderedTask> => {
  const taskById = new Map<string, RenderedTask>(
    projection.tasks.map((task) => [task.id, { ...task, missing: false }])
  )
  for (const edge of projection.edges) {
    if (!taskById.has(edge.from)) taskById.set(edge.from, placeholderTask(edge.from))
    if (!taskById.has(edge.to)) taskById.set(edge.to, placeholderTask(edge.to))
  }
  return [...taskById.values()]
}

const safeClassToken = (value: string): string | undefined => {
  const token = value.trim().replace(/[^a-zA-Z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "")
  return token.length === 0 ? undefined : `display-${token}`
}

const taskLabel = (task: RenderedTask): string => [
  task.id,
  task.title,
  task.lifecycle,
  ...(task.display?.labels ?? [])
].filter((part): part is string => part !== undefined && part.length > 0).join("\n")

const compactVisualFact = (label: string): string | undefined => {
  if (label === "Held position: none" || label === "Delivery: none" || label === "Settlement: none") return undefined
  if (label.startsWith("Held position:")) return "Held: active"
  if (label.startsWith("Settlement:")) return "Settlement: established"
  if (label.startsWith("Desired ticket:")) return label.replace("Desired ticket:", "Ticket:")
  if (label.startsWith("Delivery:")) {
    const standings = /standings: ([^·]+)/u.exec(label)?.[1]?.trim()
    return standings === undefined ? "Delivery: retained" : `Delivery: ${standings}`
  }
  return label
}

/**
 * The canvas is an at-a-glance map. Exact locators, evidence, and obligations
 * remain available in the adjacent task table and the non-canvas summary.
 */
const visualTaskLabel = (task: RenderedTask): string => [
  task.id,
  task.title === undefined
    ? undefined
    : task.title.length > 42 ? `${task.title.slice(0, 39)}…` : task.title,
  task.lifecycle,
  ...(task.display?.labels ?? []).map(compactVisualFact)
].filter((part): part is string => part !== undefined && part.length > 0).join("\n")

const graphElements = (
  projection: DeliveryGraphProjection,
  selectedTaskId: string | null,
  highlightedTaskIds: ReadonlyArray<string>,
  palette: DeliveryGraphPalette
): ReadonlyArray<ElementDefinition> => {
  const highlighted = new Set(highlightedTaskIds.length > 0
    ? highlightedTaskIds
    : selectedTaskId === null ? [] : [selectedTaskId])
  const nodes: ReadonlyArray<ElementDefinition> = renderedTasks(projection).map((task) => ({
    classes: [
      task.missing ? "missing-endpoint" : undefined,
      selectedTaskId === task.id ? deliveryGraphEncoding.selectedTask.className : undefined,
      highlighted.size === 0 ? undefined : highlighted.has(task.id) ? "selection-related" : "selection-muted",
      `palette-${palette}`,
      task.display?.tone === undefined ? undefined : `tone-${task.display.tone}`,
      ...(task.display?.classes ?? []).map(safeClassToken)
    ].filter((value): value is string => value !== undefined).join(" "),
    data: {
      id: task.id,
      label: visualTaskLabel(task),
      lifecycle: task.lifecycle,
      missing: task.missing ? "true" : "false"
    } satisfies CytoscapeTaskData,
    group: "nodes"
  }))
  const edges: ReadonlyArray<ElementDefinition> = projection.edges.map((edge, index) => ({
    classes: [
      edge.kind === "Prerequisite" ? "prerequisite-edge" : "grouping-edge",
      highlighted.size === 0 ? undefined : highlighted.has(edge.from) || highlighted.has(edge.to) ? "selection-related" : "selection-muted"
    ].filter((value): value is string => value !== undefined).join(" "),
    data: {
      id: `${edge.kind}:${edge.from}->${edge.to}:${index}`,
      label: edge.kind === "Prerequisite" ? "blocks" : "contains",
      source: edge.from,
      target: edge.to
    },
    group: "edges"
  }))
  return [...nodes, ...edges]
}

const edgeDescription = (edge: DeliveryGraphEdge): string => edge.kind === "Prerequisite"
  ? `${edge.from} blocks ${edge.to}`
  : `${edge.from} contains ${edge.to}`

const topologyIdentity = (projection: DeliveryGraphProjection | null): string | undefined => projection === null
  ? undefined
  : JSON.stringify({
    edges: projection.edges.map(({ from, kind, to }) => ({ from, kind, to })),
    tasks: renderedTasks(projection).map(({ id }) => id)
  })

const deliveryGraphLayout = (): cytoscape.LayoutOptions => ({
  name: "dagre",
  nodeSep: 44,
  padding: 28,
  rankDir: "LR",
  rankSep: 92
} as unknown as cytoscape.LayoutOptions)

const shadowCss = `
  :host {
    display: block;
    min-height: 430px;
    border: 1px solid #8e8578;
    background:
      linear-gradient(rgba(33, 31, 26, .045) 1px, transparent 1px),
      linear-gradient(90deg, rgba(33, 31, 26, .045) 1px, transparent 1px),
      #fbf8f1;
    background-size: 24px 24px;
  }
  :host([data-empty]) {
    background: #fbf8f1;
  }
  #canvas { position: relative; width: 100%; height: 430px; touch-action: none; cursor: grab; }
  #canvas:active { cursor: grabbing; }
  #empty {
    box-sizing: border-box;
    height: 430px;
    min-height: 430px;
    display: grid;
    place-items: center;
    color: #726b60;
    font: italic 14px system-ui, sans-serif;
  }
  :host([data-empty]) #empty { padding: 1rem; text-align: center; }
  [hidden] { display: none !important; }
  #summary, #empty-footer {
    border-top: 1px solid #bdb5a8;
    padding: .65rem .8rem;
    color: #39352e;
    background: rgba(251, 248, 241, .94);
    font: 13px/1.45 system-ui, sans-serif;
  }
  #empty-footer { font-weight: 650; }
  #summary summary { cursor: pointer; font-weight: 650; }
  #summary p { margin: .45rem 0; overflow-wrap: anywhere; }
  #summary h4 { margin: .65rem 0 .2rem; }
  #summary ul { margin: .2rem 0 .5rem; padding-left: 1.4rem; }
  #summary button {
    border: 0;
    padding: .1rem .2rem;
    color: inherit;
    background: transparent;
    font: inherit;
    text-align: left;
    text-decoration: underline;
    cursor: pointer;
    max-width: 100%;
    overflow-wrap: anywhere;
    white-space: normal;
  }
  #summary button[aria-current="true"] { color: #295b46; font-weight: 700; }
  @media (max-width: 42rem) {
    :host { min-height: 340px; }
    #canvas { height: 340px; }
    #empty { height: 340px; min-height: 340px; }
  }
`

const cytoscapeStyle: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      "background-color": "#f7f3ea",
      "border-color": "#211f1a",
      "border-width": 2,
      color: "#211f1a",
      "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
      "font-size": 10,
      height: 116,
      label: "data(label)",
      "line-height": 1.35,
      padding: "8px",
      shape: "round-rectangle",
      "text-halign": "center",
      "text-max-width": "196px",
      "text-valign": "center",
      "text-wrap": "wrap",
      width: 204
    }
  },
  {
    selector: "node[missing = 'true']",
    style: {
      "background-color": "#f5d2bd",
      "border-color": "#a44423",
      "border-style": "dashed"
    }
  },
  {
    selector: `node:selected, node.${deliveryGraphEncoding.selectedTask.className}`,
    style: {
      "outline-color": "#00a7c4",
      "outline-offset": 11,
      "outline-opacity": 1,
      "outline-width": 4
    }
  },
  {
    selector: `node.display-${deliveryGraphEncoding.frontierEligible.className}`,
    style: { "border-color": "#2e6788" }
  },
  {
    selector: `node.display-${deliveryGraphEncoding.selectedTicket.className}`,
    style: {
      "underlay-color": "#7656a0",
      "underlay-opacity": 0.5,
      "underlay-padding": 7,
      "underlay-shape": "round-rectangle"
    }
  },
  {
    selector: `node.display-${deliveryGraphEncoding.heldPosition.className}`,
    style: { "border-style": "double", "border-width": 5 }
  },
  {
    selector: `node.display-${deliveryGraphEncoding.retainedStanding.className}`,
    style: { "background-color": "#f2e5be" }
  },
  {
    selector: "node.palette-trace-fill.tone-blocked",
    style: { "background-color": "#f3f4f2", "border-color": "#8d9691", opacity: 0.48 }
  },
  {
    selector: "node.palette-trace-fill.tone-waiting",
    style: { "background-color": "#fcf4e6", "border-color": "#a37a32", "border-style": "dashed" }
  },
  {
    selector: "node.palette-trace-fill.tone-desired",
    style: { "background-color": "#e5f1f8", "border-color": "#4b91b8" }
  },
  {
    selector: "node.palette-trace-fill.tone-running",
    style: { "background-color": "#e7f4ee", "border-color": "#3a9978" }
  },
  {
    selector: "node.palette-trace-fill.tone-integrating",
    style: { "background-color": "#e8f2f8", "border-color": "#477f9f" }
  },
  {
    selector: "node.palette-trace-fill.tone-settled",
    style: { "background-color": "#dff1e9", "border-color": "#3a9978" }
  },
  {
    selector: "node.palette-trace-fill.tone-paused",
    style: { "background-color": "#f5ecfa", "border-color": "#80639b" }
  },
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
      "font-size": 9,
      label: "data(label)",
      "line-color": "#295b46",
      "target-arrow-color": "#295b46",
      "target-arrow-shape": "triangle",
      "text-background-color": "#fbf8f1",
      "text-background-opacity": 1,
      "text-background-padding": "3px",
      width: 2
    }
  },
  {
    selector: "edge.grouping-edge",
    style: {
      "line-color": "#9b5b20",
      "line-style": "dashed",
      "target-arrow-color": "#9b5b20",
      "target-arrow-shape": "diamond"
    }
  },
  {
    selector: "edge:selected",
    style: {
      "line-color": "#211f1a",
      "target-arrow-color": "#211f1a",
      width: 4
    }
  },
  {
    selector: "node.selection-related",
    style: { "outline-color": "#2b92ca", "outline-offset": 10, "outline-opacity": 1, "outline-width": 4 }
  },
  {
    selector: "node.selection-muted",
    style: { opacity: 0.16 }
  },
  {
    selector: "edge.selection-related",
    style: { "line-color": "#2b92ca", "target-arrow-color": "#2b92ca", width: 4 }
  },
  {
    selector: "edge.selection-muted",
    style: { opacity: 0.1 }
  }
]

class DalphDeliveryGraphElement extends HTMLElement {
  #canvas: HTMLDivElement
  #core: Core | null = null
  #empty: HTMLDivElement
  #emptyFooter: HTMLDivElement
  #highlightedTaskIds: ReadonlyArray<string> = []
  #projection: DeliveryGraphProjection | null = null
  #panGesture: { readonly pointerId: number; readonly startX: number; readonly startY: number; readonly pan: cytoscape.Position } | null = null
  #preserveViewport = false
  #resizeObserver: ResizeObserver | null = null
  #selectedTaskId: string | null = null
  #summary: HTMLDetailsElement

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = shadowCss
    this.#canvas = document.createElement("div")
    this.#canvas.id = "canvas"
    this.#canvas.setAttribute("aria-hidden", "true")
    this.#canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.#core === null) return
      this.#panGesture = {
        pan: this.#core.pan(),
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY
      }
      this.#canvas.setPointerCapture(event.pointerId)
    })
    this.#canvas.addEventListener("pointermove", (event) => {
      const gesture = this.#panGesture
      if (this.#core === null || gesture === null || gesture.pointerId !== event.pointerId) return
      this.#core.pan({
        x: gesture.pan.x + event.clientX - gesture.startX,
        y: gesture.pan.y + event.clientY - gesture.startY
      })
    })
    const finishPan = (event: PointerEvent): void => {
      if (this.#panGesture?.pointerId !== event.pointerId) return
      this.#panGesture = null
      if (this.#canvas.hasPointerCapture(event.pointerId)) this.#canvas.releasePointerCapture(event.pointerId)
    }
    this.#canvas.addEventListener("pointercancel", finishPan)
    this.#canvas.addEventListener("pointerup", finishPan)
    this.#empty = document.createElement("div")
    this.#empty.id = "empty"
    this.#empty.textContent = "No tasks or relationships in this projection."
    this.#emptyFooter = document.createElement("div")
    this.#emptyFooter.id = "empty-footer"
    this.#emptyFooter.textContent = "Task selection is unavailable until production establishes the graph."
    this.#summary = document.createElement("details")
    this.#summary.id = "summary"
    shadow.append(style, this.#canvas, this.#empty, this.#emptyFooter, this.#summary)
  }

  set projection(value: DeliveryGraphProjection | null) {
    const changed = this.#projection?.fingerprint !== value?.fingerprint
      || this.#projection?.key !== value?.key
      || this.#projection?.status !== value?.status
    this.#preserveViewport = topologyIdentity(this.#projection) === topologyIdentity(value)
    this.#projection = value
    if (this.isConnected && changed) this.#render()
  }

  get projection(): DeliveryGraphProjection | null {
    return this.#projection
  }

  set highlightedTaskIds(value: ReadonlyArray<string>) {
    this.#highlightedTaskIds = value
    this.#applyGraphSelection()
  }

  get highlightedTaskIds(): ReadonlyArray<string> {
    return this.#highlightedTaskIds
  }

  set selectedTaskId(value: string | null) {
    this.#selectedTaskId = value
    if (this.#core !== null) {
      this.#core.nodes().unselect().removeClass(deliveryGraphEncoding.selectedTask.className)
      if (value !== null) {
        this.#core.getElementById(value).addClass(deliveryGraphEncoding.selectedTask.className).select()
      }
    }
    this.#applyGraphSelection()
    this.#updateSummarySelection()
  }

  get selectedTaskId(): string | null {
    return this.#selectedTaskId
  }

  captureViewport(): DeliveryGraphViewport | null {
    if (this.#core === null) return null
    const pan = this.#core.pan()
    return { pan: { x: pan.x, y: pan.y }, zoom: this.#core.zoom() }
  }

  restoreViewport(viewport: DeliveryGraphViewport): void {
    if (this.#core === null) return
    this.#core.zoom(viewport.zoom)
    this.#core.pan(viewport.pan)
  }

  resetView(): void {
    if (this.#core === null) return
    this.#core.layout(deliveryGraphLayout()).run()
    this.#core.fit(this.#core.elements(), 28)
  }

  focusTask(taskId: string): void {
    this.selectedTaskId = taskId
    this.dataset.focusedTaskId = taskId
    if (this.#core === null) return
    const task = this.#core.getElementById(taskId)
    if (task.empty()) return
    this.#core.fit(task, 72)
  }

  connectedCallback(): void {
    if (typeof ResizeObserver !== "undefined") {
      this.#resizeObserver = new ResizeObserver(() => this.#core?.resize())
      this.#resizeObserver.observe(this)
    }
    this.#render()
  }

  disconnectedCallback(): void {
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#core?.destroy()
    this.#core = null
  }

  #dispatchTaskSelected(taskId: string): void {
    this.dispatchEvent(new CustomEvent("task-selected", {
      bubbles: true,
      composed: true,
      detail: { taskId }
    }))
  }

  #renderSummary(projection: DeliveryGraphProjection | null): void {
    const focusedTaskId = this.shadowRoot?.activeElement instanceof HTMLButtonElement
      ? this.shadowRoot.activeElement.dataset.taskId
      : undefined
    this.#summary.replaceChildren()
    const heading = document.createElement("summary")
    heading.textContent = projection === null
      ? "Graph summary unavailable"
      : `Graph summary · ${projection.tasks.length} ${projection.tasks.length === 1 ? "task" : "tasks"} · ${projection.edges.length} ${projection.edges.length === 1 ? "relationship" : "relationships"}`
    this.#summary.append(heading)
    if (projection === null) return

    const status = document.createElement("p")
    status.textContent = `${projection.status} · ${projection.key}`
    this.#summary.append(status)

    const tasksHeading = document.createElement("h4")
    tasksHeading.textContent = "Tasks"
    const taskList = document.createElement("ul")
    for (const task of renderedTasks(projection)) {
      const item = document.createElement("li")
      const button = document.createElement("button")
      button.type = "button"
      button.dataset.taskId = task.id
      button.textContent = taskLabel(task).replaceAll("\n", " · ")
      button.addEventListener("click", () => this.#dispatchTaskSelected(task.id))
      item.append(button)
      taskList.append(item)
    }
    this.#summary.append(tasksHeading, taskList)

    const edgesHeading = document.createElement("h4")
    edgesHeading.textContent = "Relationships"
    const edgeList = document.createElement("ul")
    for (const edge of projection.edges) {
      const item = document.createElement("li")
      item.dataset.edgeFrom = edge.from
      item.dataset.edgeTo = edge.to
      item.textContent = edgeDescription(edge)
      edgeList.append(item)
    }
    if (projection.edges.length === 0) {
      const item = document.createElement("li")
      item.textContent = "No relationships"
      edgeList.append(item)
    }
    this.#summary.append(edgesHeading, edgeList)
    this.#updateSummarySelection()
    if (focusedTaskId !== undefined) {
      this.#summary.querySelector<HTMLButtonElement>(`button[data-task-id="${CSS.escape(focusedTaskId)}"]`)
        ?.focus({ preventScroll: true })
    }
  }

  #updateSummarySelection(): void {
    for (const button of this.#summary.querySelectorAll<HTMLButtonElement>("button[data-task-id]")) {
      button.setAttribute("aria-current", String(button.dataset.taskId === this.#selectedTaskId))
    }
    const highlighted = new Set(this.#highlightedTaskIds.length > 0
      ? this.#highlightedTaskIds
      : this.#selectedTaskId === null ? [] : [this.#selectedTaskId])
    for (const edge of this.#summary.querySelectorAll<HTMLLIElement>("li[data-edge-from]")) {
      const related = highlighted.has(edge.dataset.edgeFrom ?? "") || highlighted.has(edge.dataset.edgeTo ?? "")
      edge.classList.toggle("selection-related", highlighted.size > 0 && related)
      edge.classList.toggle("selection-muted", highlighted.size > 0 && !related)
    }
  }

  #applyGraphSelection(): void {
    const highlighted = new Set(this.#highlightedTaskIds.length > 0
      ? this.#highlightedTaskIds
      : this.#selectedTaskId === null ? [] : [this.#selectedTaskId])
    this.#updateSummarySelection()
    if (this.#core === null) return
    for (const node of this.#core.nodes()) {
      node.toggleClass("selection-related", highlighted.size > 0 && highlighted.has(node.id()))
      node.toggleClass("selection-muted", highlighted.size > 0 && !highlighted.has(node.id()))
    }
    for (const edge of this.#core.edges()) {
      const related = highlighted.has(edge.source().id()) || highlighted.has(edge.target().id())
      edge.toggleClass("selection-related", highlighted.size > 0 && related)
      edge.toggleClass("selection-muted", highlighted.size > 0 && !related)
    }
  }

  #render(): void {
    const previousViewport = this.#preserveViewport && this.#core !== null
      ? { pan: this.#core.pan(), zoom: this.#core.zoom() }
      : undefined
    this.#preserveViewport = false
    this.#core?.destroy()
    this.#core = null
    const projection = this.#projection
    const empty = projection === null || (projection.tasks.length === 0 && projection.edges.length === 0)
    if (empty) this.setAttribute("data-empty", "")
    else this.removeAttribute("data-empty")
    this.#summary.hidden = empty
    this.#emptyFooter.hidden = !empty
    if (empty) {
      this.#summary.replaceChildren()
      this.#canvas.hidden = true
      this.#empty.hidden = false
      this.#empty.textContent = projection?.status ?? "Graph projection unavailable."
      return
    }
    this.#renderSummary(projection)
    if (typeof this.ownerDocument.defaultView?.getComputedStyle !== "function") {
      this.#canvas.hidden = true
      this.#empty.hidden = true
      return
    }
    this.#canvas.hidden = false
    this.#empty.hidden = true
    this.#core = cytoscape({
      autoungrabify: true,
      boxSelectionEnabled: false,
      container: this.#canvas,
      elements: [...graphElements(projection, this.#selectedTaskId, this.#highlightedTaskIds, deliveryGraphPalette(this.dataset.palette))],
      layout: deliveryGraphLayout(),
      maxZoom: 2.4,
      minZoom: 0.28,
      panningEnabled: true,
      style: cytoscapeStyle,
      userPanningEnabled: true,
      userZoomingEnabled: true,
      zoomingEnabled: true
    })
    if (previousViewport !== undefined) {
      this.#core.zoom(previousViewport.zoom)
      this.#core.pan(previousViewport.pan)
    }
    this.#core.on("tap", "node", (event: EventObjectNode) => {
      this.#dispatchTaskSelected(event.target.id())
    })
  }
}

/** Registers the delivery graph renderer once at the browser boundary. */
export const registerDeliveryGraph = (): void => {
  if (customElements.get(deliveryGraphTag) !== undefined) return
  customElements.define(deliveryGraphTag, DalphDeliveryGraphElement)
}
