import { registerDeliveryGraph } from "../src/delivery-graph-renderer.ts"
import {
  deliveryGraphEncoding,
  deliveryGraphTag,
  type DeliveryGraphDisplayClass,
  type DeliveryGraphElement,
  type DeliveryGraphProjection,
  type DeliveryGraphTaskTone
} from "../src/delivery-graph-element.ts"
import type { Frame, TaskKey } from "./prototype.ts"

export type GraphVariant = "original" | "trace-fill" | "trace-soft" | "trace-outline"

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
    source: "Promoted lab palette",
    prompt: "Reference: the accepted Cytoscape graph with its existing neutral, gold, blue, and purple encodings."
  },
  {
    key: "trace-fill",
    name: "Trace fills",
    source: "Older trace node colors",
    prompt: "Compare direct state-colored fills while position, frontier, and ticket encodings remain present."
  },
  {
    key: "trace-soft",
    name: "Stronger fills",
    source: "Trace colors · higher separation",
    prompt: "Compare stronger state separation when several task states share the same graph view."
  },
  {
    key: "trace-outline",
    name: "Trace outlines",
    source: "Neutral fills · state borders",
    prompt: "Compare a quieter canvas where state moves to borders and most node surfaces stay neutral."
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

const taskTone = (task: TaskKey, frame: Frame): DeliveryGraphTaskTone =>
  frame.control.tasks.includes(task) || frame.control.resumePending.includes(task)
    ? "paused"
    : frame.tasks[task]

export interface MountGraphInput {
  readonly activeTasks: ReadonlyArray<TaskKey>
  readonly edges: ReadonlyArray<readonly [TaskKey, TaskKey]>
  readonly frame: Frame
  readonly host: HTMLElement
  readonly onTask: (task: TaskKey) => void
  readonly selectedTask: TaskKey | null
  readonly tasks: ReadonlyArray<TaskKey>
  readonly variant: GraphVariant
}

export const mountComparisonGraph = (input: MountGraphInput): (() => void) => {
  registerDeliveryGraph()
  const projection: DeliveryGraphProjection = {
    edges: input.edges
      .filter(([from, to]) => input.tasks.includes(from) && input.tasks.includes(to))
      .map(([from, to]) => ({ from, kind: "Prerequisite", to })),
    fingerprint: `${input.frame.graph.revision}:${input.tasks.join("")}:${input.variant}`,
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
          ].filter(Boolean),
          tone: taskTone(task, input.frame)
        }
      }
    })
  }
  const element = document.createElement(deliveryGraphTag) as DeliveryGraphElement
  element.dataset.palette = input.variant
  element.projection = projection
  element.selectedTaskId = input.selectedTask
  element.highlightedTaskIds = input.activeTasks
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
