import dagre from "@dagrejs/dagre"
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { registerDeliveryGraph } from "../src/delivery-graph-renderer.ts"
import {
  deliveryGraphEncoding,
  deliveryGraphTag,
  type DeliveryGraphDisplayClass,
  type DeliveryGraphElement,
  type DeliveryGraphProjection
} from "../src/delivery-graph-element.ts"
import type { Frame, TaskKey } from "./prototype.ts"

export type GraphVariant = "original" | "lab" | "trace"

export interface GraphVariantDefinition {
  readonly key: GraphVariant
  readonly name: string
  readonly source: string
  readonly prompt: string
}

export const graphVariants: ReadonlyArray<GraphVariantDefinition> = [
  {
    key: "original",
    name: "Original",
    source: "HTML nodes + SVG edges",
    prompt: "Look for immediate task-state reading and synchronized incident-edge selection."
  },
  {
    key: "lab",
    name: "Lab graph",
    source: "Cytoscape + Dagre",
    prompt: "Look for automatic diamond layout, dense node facts, and direct canvas navigation."
  },
  {
    key: "trace",
    name: "Older trace graph",
    source: "React Flow + Dagre",
    prompt: "Look for navigation controls, minimap orientation, and behavior as the graph grows."
  }
]

const taskState = (task: TaskKey, frame: Frame): string => {
  if (frame.control.tasks.includes(task)) return "paused by user"
  if (frame.control.resumePending.includes(task)) return "fresh read required"
  if (frame.tasks[task] === "blocked") return "prerequisites incomplete"
  if (frame.tasks[task] === "waiting") return "frontier · waiting capacity"
  if (frame.tasks[task] === "desired") return "desired · not held"
  if (frame.tasks[task] === "running") return "task-work position held"
  if (frame.tasks[task] === "integrating") return "integration live"
  return "settled"
}

const nodeClass = (
  task: TaskKey,
  frame: Frame,
  activeTasks: ReadonlyArray<TaskKey>,
  selectedTask: TaskKey | null
): string => [
  `state-${frame.tasks[task]}`,
  frame.control.tasks.includes(task) ? "task-paused" : "",
  frame.control.resumePending.includes(task) ? "resume-pending" : "",
  activeTasks.length === 0 ? "" : activeTasks.includes(task) ? "selection-related" : "selection-muted",
  selectedTask === task ? "selected" : ""
].filter(Boolean).join(" ")

const edgeClass = (
  from: TaskKey,
  to: TaskKey,
  activeTasks: ReadonlyArray<TaskKey>
): string => activeTasks.length === 0
  ? ""
  : activeTasks.includes(from) || activeTasks.includes(to)
    ? "selection-related"
    : "selection-muted"

export interface MountGraphInput {
  readonly activeTasks: ReadonlyArray<TaskKey>
  readonly edges: ReadonlyArray<readonly [TaskKey, TaskKey]>
  readonly frame: Frame
  readonly host: HTMLElement
  readonly onTask: (task: TaskKey) => void
  readonly selectedTask: TaskKey | null
  readonly tasks: ReadonlyArray<TaskKey>
  readonly variant: Exclude<GraphVariant, "original">
}

const mountCytoscape = (input: MountGraphInput): (() => void) => {
  registerDeliveryGraph()
  const projection: DeliveryGraphProjection = {
    edges: input.edges
      .filter(([from, to]) => input.tasks.includes(from) && input.tasks.includes(to))
      .map(([from, to]) => ({ from, kind: "Prerequisite", to })),
    fingerprint: `${input.frame.graph.revision}:${input.tasks.join("")}`,
    key: input.frame.graph.revision,
    status: `${input.frame.graph.age} · observed ${input.frame.graph.observedAt}`,
    tasks: input.tasks.map((task) => {
      const classes: DeliveryGraphDisplayClass[] = []
      if (input.frame.frontier.includes(task)) classes.push(deliveryGraphEncoding.frontierEligible.className)
      if (input.frame.bounded.includes(task)) classes.push(deliveryGraphEncoding.selectedTicket.className)
      if (input.frame.held.includes(task)) classes.push(deliveryGraphEncoding.heldPosition.className)
      if (input.frame.settled.includes(task)) classes.push(deliveryGraphEncoding.retainedStanding.className)
      return {
        id: task,
        lifecycle: taskState(task, input.frame),
        title: `Task ${task}`,
        display: {
          classes,
          labels: [
            input.frame.frontier.includes(task) ? `Frontier: ${input.frame.frontier.indexOf(task) + 1}/${input.frame.frontier.length}` : "",
            input.frame.bounded.includes(task) ? `Desired ticket: ${input.frame.bounded.indexOf(task) + 1}/2` : "",
            input.frame.held.includes(task) ? `Held position: ${input.frame.held.indexOf(task) + 1}/2` : "",
            input.frame.settled.includes(task) ? "Settlement: established" : ""
          ].filter(Boolean)
        }
      }
    })
  }
  const element = document.createElement(deliveryGraphTag) as DeliveryGraphElement
  element.projection = projection
  element.selectedTaskId = input.selectedTask
  const taskSelected = (event: CustomEvent<{ readonly taskId: string }>): void => {
    queueMicrotask(() => input.onTask(event.detail.taskId as TaskKey))
  }
  element.addEventListener("task-selected", taskSelected)
  input.host.append(element)
  return () => {
    element.removeEventListener("task-selected", taskSelected)
    element.remove()
  }
}

interface Point { readonly x: number; readonly y: number }

const readPoint = (value: unknown): Point | null => {
  if (typeof value !== "object" || value === null || !("x" in value) || !("y" in value)) return null
  if (typeof value.x !== "number" || typeof value.y !== "number") return null
  return { x: value.x, y: value.y }
}

const reactFlowData = (input: MountGraphInput): { readonly nodes: ReadonlyArray<Node>; readonly edges: ReadonlyArray<Edge> } => {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: "LR", nodesep: 34, ranksep: 66, marginx: 24, marginy: 24 })
  for (const task of input.tasks) graph.setNode(task, { width: 132, height: 66 })
  const visibleEdges = input.edges.filter(([from, to]) => input.tasks.includes(from) && input.tasks.includes(to))
  for (const [from, to] of visibleEdges) graph.setEdge(from, to)
  dagre.layout(graph)

  return {
    nodes: input.tasks.map((task, index): Node => {
      const point = readPoint(graph.node(task)) ?? { x: 90 + index * 160, y: 70 }
      return {
        id: task,
        position: { x: point.x - 66, y: point.y - 33 },
        data: { label: createElement("span", null, createElement("b", null, `Task ${task}`), createElement("small", null, taskState(task, input.frame))) },
        className: nodeClass(task, input.frame, input.activeTasks, input.selectedTask)
      }
    }),
    edges: visibleEdges.map(([from, to]): Edge => ({
      id: `${from}->${to}`,
      source: from,
      target: to,
      label: "blocks",
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed },
      className: edgeClass(from, to, input.activeTasks)
    }))
  }
}

const mountReactFlow = (input: MountGraphInput): (() => void) => {
  const root = createRoot(input.host)
  const graph = reactFlowData(input)
  root.render(createElement(
    ReactFlow,
    {
      nodes: [...graph.nodes],
      edges: [...graph.edges],
      fitView: true,
      fitViewOptions: { padding: 0.12 },
      minZoom: 0.15,
      maxZoom: 2.4,
      nodesDraggable: false,
      nodesConnectable: false,
      onNodeClick: (_event, node) => queueMicrotask(() => input.onTask(node.id as TaskKey))
    },
    createElement(Background, { gap: 20, size: 1 }),
    createElement(Controls, { showInteractive: false }),
    createElement(MiniMap, { pannable: true, zoomable: true })
  ))
  return () => root.unmount()
}

export const mountComparisonGraph = (input: MountGraphInput): (() => void) =>
  input.variant === "lab" ? mountCytoscape(input) : mountReactFlow(input)
