import { TaskId } from "@dalph/contracts"
import { expect, it } from "vitest"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { OperationId } from "../../workflow/identity.js"
import type { CurrentDeliveryFrame } from "./current-delivery-frame.js"
import { FreshWorkflowActionFact } from "./fresh-workflow-fact.js"
import { deriveFreshWorkflowDecisions } from "./fresh-workflow.js"

const snapshot = (revision: string, lifecycle: "Open" | "TerminalWithoutSuccess") => {
  const projected = projectTrackerSnapshot({
    revision,
    tasks: [{ id: TaskId.make("A"), lifecycle: { _tag: lifecycle }, parentTaskId: null, prerequisiteIds: [] }]
  })
  if (projected._tag === "Invalid") throw new Error("fresh workflow fixture must be valid")
  return projected.snapshot
}

it("does not continue a synthetic task after its focused current read says it is ineligible", () => {
  const currentGraphOperationId = OperationId.make("synthetic-current-graph")
  const frame: CurrentDeliveryFrame = {
    _tag: "SyntheticCurrentDeliveryFrame",
    currentGraph: snapshot("currently-open", "Open"),
    currentGraphOperationId,
    pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
    responsibility: { entries: [] },
    runControlPolicy: RunControlPolicy.make({
      revision: initialRunPolicyRevision,
      taskExecutionCapacity: TaskWorkCapacity.make(1)
    }),
    workflowFacts: [
      FreshWorkflowActionFact.CurrentTaskGraphObserved({
        operationId: OperationId.make("synthetic-focused-graph"),
        snapshot: snapshot("now-ineligible", "TerminalWithoutSuccess"),
        taskId: TaskId.make("A")
      })
    ]
  }

  expect(deriveFreshWorkflowDecisions(frame)).toEqual([])
})
