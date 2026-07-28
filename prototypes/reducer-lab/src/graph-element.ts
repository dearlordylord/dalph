import { Schema as S } from "effect"
import { CustomElement } from "foldkit"
import { TaskGraphProjection } from "./lab-presenter.ts"

/**
 * FoldKit-facing binding for the replaceable graph renderer. Renderer-specific
 * node, edge, layout, and browser event types stay behind this contract.
 */
export const reducerLabGraph = CustomElement.define({
  events: {
    "task-selected": S.Struct({ taskId: S.String })
  },
  properties: {
    projection: TaskGraphProjection,
    selectedTaskId: S.NullOr(S.String)
  },
  tag: "reducer-lab-graph"
})
