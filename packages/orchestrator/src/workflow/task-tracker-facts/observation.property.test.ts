import { Option, Schema } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { TaskId } from "@dalph/contracts"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskLifecycle, TrackerRevision } from "../../authorities/task-tracker/task.js"
import { OperationId } from "../identity.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservedEvent,
  taskTrackerFactsObservedEvent
} from "./observation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../protocols/task-tracker-read/protocol.js"
import { reconstructedTaskGraphFromEvents } from "../../coordination/reconstruction/graph-knowledge.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { makeTrackerGraphObservationOperation } from "../registry/operation.js"

const taskIdsArbitrary = fc.uniqueArray(
  fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/).map((taskId) => TaskId.make(taskId)),
  { maxLength: 12 }
)

const validFlatSnapshot = (taskIds: ReadonlyArray<TaskId>, revision: string) => {
  const projection = projectTrackerSnapshot({
    revision: TrackerRevision.make(revision),
    tasks: taskIds.map((id, index) => ({
      id,
      lifecycle:
        index % 3 === 0 ? TaskLifecycle.cases.CompletedSuccessfully.make({}) : TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: []
    }))
  })
  if (projection._tag === "Invalid") throw new Error("generated unique flat graph must project")
  return projection.snapshot
}

it("round-trips every generated complete fact family and reconstructs the same canonical graph", () => {
  fc.assert(
    fc.property(taskIdsArbitrary, fc.string({ minLength: 1, maxLength: 24 }), (taskIds, suffix) => {
      const target = FixtureTarget.make("property-target")
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make(`property-read-${suffix}`),
        target
      )
      const snapshot = validFlatSnapshot(taskIds, `property-revision-${suffix}`)
      const event = taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(operation, snapshot)
      )

      const encoded = Schema.encodeUnknownSync(TaskTrackerFactsObservedEvent)(event)
      const decoded = Schema.decodeUnknownSync(TaskTrackerFactsObservedEvent)(encoded)
      const reconstructed = Option.getOrThrow(reconstructedTaskGraphFromEvents([decoded], target))

      expect(reconstructed.canonicalJson()).toBe(snapshot.canonicalJson())
    })
  )
})

it("reconfirms unchanged generated graphs compactly while preserving reconstructable facts", () => {
  fc.assert(
    fc.property(taskIdsArbitrary, fc.string({ minLength: 1, maxLength: 24 }), (taskIds, suffix) => {
      const target = FixtureTarget.make("reconfirm-property-target")
      const first = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make(`first-${suffix}`),
        target
      )
      const later = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make(`later-${suffix}`),
        target,
        [first.operationId]
      )
      const snapshot = validFlatSnapshot(taskIds, `unchanged-${suffix}`)
      const firstEvent = taskTrackerFactsObservedEvent(
        first.operationId,
        makeCompleteTaskTrackerFactsObserved(first, snapshot)
      )
      const laterEvent = makeTaskTrackerFactsObservedFromRead([{ event: firstEvent }], later, snapshot)

      expect(laterEvent.observation._tag).toBe("UnchangedTaskTrackerFactsReconfirmed")
      expect(
        Option.getOrThrow(reconstructedTaskGraphFromEvents([firstEvent, laterEvent], target)).canonicalJson()
      ).toBe(snapshot.canonicalJson())
    })
  )
})
