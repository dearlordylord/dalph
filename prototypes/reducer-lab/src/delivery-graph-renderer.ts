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
  selectedTaskId: string | null
): ReadonlyArray<ElementDefinition> => {
  const nodes: ReadonlyArray<ElementDefinition> = renderedTasks(projection).map((task) => ({
    classes: [
      task.missing ? "missing-endpoint" : undefined,
      selectedTaskId === task.id ? "selected-task" : undefined,
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
    classes: edge.kind === "Prerequisite" ? "prerequisite-edge" : "grouping-edge",
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
    min-height: 0;
    background: #fbf8f1;
  }
  #canvas { position: relative; width: 100%; height: 430px; }
  #empty {
    min-height: 430px;
    display: grid;
    place-items: center;
    color: #726b60;
    font: italic 14px system-ui, sans-serif;
  }
  :host([data-empty]) #empty {
    min-height: 0;
    padding: 1rem;
    text-align: center;
  }
  [hidden] { display: none !important; }
  #summary {
    border-top: 1px solid #bdb5a8;
    padding: .65rem .8rem;
    color: #39352e;
    background: rgba(251, 248, 241, .94);
    font: 13px/1.45 system-ui, sans-serif;
  }
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
    #empty { min-height: 340px; }
    :host([data-empty]) #empty { min-height: 0; }
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
    selector: "node:selected, node.selected-task",
    style: {
      "outline-color": "#00a7c4",
      "outline-offset": 11,
      "outline-opacity": 1,
      "outline-width": 4
    }
  },
  {
    selector: "node.display-frontier",
    style: { "border-color": "#2e6788" }
  },
  {
    selector: "node.display-placement",
    style: {
      "underlay-color": "#7656a0",
      "underlay-opacity": 0.5,
      "underlay-padding": 7,
      "underlay-shape": "round-rectangle"
    }
  },
  {
    selector: "node.display-held",
    style: { "border-style": "double", "border-width": 5 }
  },
  {
    selector: "node.display-standing",
    style: { "background-color": "#f2e5be" }
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
  }
]

class DalphDeliveryGraphElement extends HTMLElement {
  #canvas: HTMLDivElement
  #core: Core | null = null
  #empty: HTMLDivElement
  #projection: DeliveryGraphProjection | null = null
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
    this.#empty = document.createElement("div")
    this.#empty.id = "empty"
    this.#empty.textContent = "No tasks or relationships in this projection."
    this.#summary = document.createElement("details")
    this.#summary.id = "summary"
    shadow.append(style, this.#canvas, this.#empty, this.#summary)
  }

  set projection(value: DeliveryGraphProjection | null) {
    const changed = this.#projection?.fingerprint !== value?.fingerprint
      || this.#projection?.key !== value?.key
      || this.#projection?.status !== value?.status
    this.#projection = value
    if (this.isConnected && changed) this.#render()
  }

  get projection(): DeliveryGraphProjection | null {
    return this.#projection
  }

  set selectedTaskId(value: string | null) {
    this.#selectedTaskId = value
    if (this.#core !== null) {
      this.#core.nodes().unselect().removeClass("selected-task")
      if (value !== null) this.#core.getElementById(value).addClass("selected-task").select()
    }
    this.#updateSummarySelection()
  }

  get selectedTaskId(): string | null {
    return this.#selectedTaskId
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
  }

  #updateSummarySelection(): void {
    for (const button of this.#summary.querySelectorAll<HTMLButtonElement>("button[data-task-id]")) {
      button.setAttribute("aria-current", String(button.dataset.taskId === this.#selectedTaskId))
    }
  }

  #render(): void {
    this.#core?.destroy()
    this.#core = null
    const projection = this.#projection
    const empty = projection === null || (projection.tasks.length === 0 && projection.edges.length === 0)
    if (empty) this.setAttribute("data-empty", "")
    else this.removeAttribute("data-empty")
    this.#summary.hidden = empty
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
      container: this.#canvas,
      elements: [...graphElements(projection, this.#selectedTaskId)],
      layout: ({
        name: "dagre",
        nodeSep: 44,
        padding: 28,
        rankDir: "LR",
        rankSep: 92
      } as unknown as cytoscape.LayoutOptions),
      maxZoom: 2.4,
      minZoom: 0.28,
      style: cytoscapeStyle
    })
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
