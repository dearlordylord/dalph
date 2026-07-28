import cytoscape, {
  type Core,
  type ElementDefinition,
  type EventObjectNode
} from "cytoscape"
import dagre from "cytoscape-dagre"
import { reducerLabGraph } from "./graph-element.ts"
import { type TaskGraphProjection, type GraphTask } from "./lab-presenter.ts"

cytoscape.use(dagre)

interface CytoscapeTaskData {
  readonly id: string
  readonly label: string
  readonly lifecycle: string
  readonly missing: "false" | "true"
  readonly selected: "false" | "true"
}

const placeholderTask = (id: string): GraphTask => ({
  body: "",
  id,
  lifecycle: "Missing endpoint",
  parentTaskId: null,
  prerequisiteIds: [],
  title: "Missing endpoint"
})

const graphElements = (
  projection: TaskGraphProjection,
  selectedTaskId: string | null
): ReadonlyArray<ElementDefinition> => {
  const taskById = new Map(projection.tasks.map((task) => [task.id, task]))
  for (const edge of projection.edges) {
    if (!taskById.has(edge.from)) taskById.set(edge.from, placeholderTask(edge.from))
    if (!taskById.has(edge.to)) taskById.set(edge.to, placeholderTask(edge.to))
  }

  const nodes: ReadonlyArray<ElementDefinition> = [...taskById.values()].map((task) => ({
    classes: [
      task.lifecycle === "Missing endpoint" ? "missing-endpoint" : "",
      selectedTaskId === task.id ? "selected-task" : ""
    ].filter(Boolean).join(" "),
    data: {
      id: task.id,
      label: `${task.id}\n${task.title}`,
      lifecycle: task.lifecycle,
      missing: task.lifecycle === "Missing endpoint" ? "true" : "false",
      selected: selectedTaskId === task.id ? "true" : "false"
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
  #canvas { width: 100%; height: 430px; }
  #empty {
    min-height: 430px;
    display: grid;
    place-items: center;
    color: #726b60;
    font: italic 14px system-ui, sans-serif;
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
      "font-size": 11,
      height: 72,
      label: "data(label)",
      "line-height": 1.35,
      padding: "8px",
      shape: "round-rectangle",
      "text-halign": "center",
      "text-valign": "center",
      "text-wrap": "wrap",
      width: 158
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
      "background-color": "#dce8dc",
      "border-color": "#295b46",
      "border-width": 4
    }
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

class ReducerLabGraphElement extends HTMLElement {
  #core: Core | null = null
  #projection: TaskGraphProjection | null = null
  #selectedTaskId: string | null = null
  #canvas: HTMLDivElement
  #empty: HTMLDivElement
  #resizeObserver: ResizeObserver

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = shadowCss
    this.#canvas = document.createElement("div")
    this.#canvas.id = "canvas"
    this.#empty = document.createElement("div")
    this.#empty.id = "empty"
    this.#empty.textContent = "No tasks in this projection."
    this.#resizeObserver = new ResizeObserver(() => this.#core?.resize())
    shadow.append(style, this.#canvas, this.#empty)
  }

  set projection(value: TaskGraphProjection) {
    const changed = this.#projection?.fingerprint !== value.fingerprint
      || this.#projection?.key !== value.key
    this.#projection = value
    if (this.isConnected && changed) this.#render()
  }

  get projection(): TaskGraphProjection | null {
    return this.#projection
  }

  set selectedTaskId(value: string | null) {
    this.#selectedTaskId = value
    if (this.#core === null) return
    this.#core.nodes().unselect().removeClass("selected-task")
    if (value !== null) this.#core.getElementById(value).addClass("selected-task").select()
  }

  get selectedTaskId(): string | null {
    return this.#selectedTaskId
  }

  connectedCallback(): void {
    this.#resizeObserver.observe(this)
    this.#render()
  }

  disconnectedCallback(): void {
    this.#resizeObserver.disconnect()
    this.#core?.destroy()
    this.#core = null
  }

  #render(): void {
    this.#core?.destroy()
    this.#core = null
    const projection = this.#projection
    if (projection === null || projection.tasks.length === 0) {
      this.#canvas.hidden = true
      this.#empty.hidden = false
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
      minZoom: 0.28,
      maxZoom: 2.4,
      style: cytoscapeStyle
    })
    this.#core.on("tap", "node", (event: EventObjectNode) => {
      const taskId = event.target.id()
      this.dispatchEvent(new CustomEvent("task-selected", {
        bubbles: true,
        composed: true,
        detail: { taskId }
      }))
    })
  }
}

/** Registers the renderer once at the browser boundary. */
export const registerReducerLabGraph = (): void => {
  if (customElements.get(reducerLabGraph.tag) !== undefined) return
  customElements.define(reducerLabGraph.tag, ReducerLabGraphElement)
}
