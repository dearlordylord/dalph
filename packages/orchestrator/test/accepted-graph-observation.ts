import { Option } from "effect"
import { FixtureTarget } from "../src/authorities/task-tracker/fixture/target.js"
import type { TaskDagSnapshot } from "../src/authorities/task-tracker/graph.js"
import type { OperationId } from "../src/workflow/identity.js"
import { makeTrackerGraphObservationOperation } from "../src/workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent,
  type TaskTrackerFactsObservedEvent
} from "../src/workflow/task-tracker-facts/observation.js"
import type { JournalPosition } from "../src/workflow-journal/identity.js"
import { acceptedTrackerGraphObservationFromAcceptedReceipt } from "../src/coordination/delivery/accepted-graph-observation.js"
import type { AcceptedTrackerGraphObservation } from "../src/coordination/delivery/accepted-graph-observation.js"

const TestAcceptedGraphReceiptTypeId: unique symbol = Symbol("TestAcceptedGraphReceipt")

interface TestAcceptedGraphReceipt {
  readonly [TestAcceptedGraphReceiptTypeId]: typeof TestAcceptedGraphReceiptTypeId
  readonly event: TaskTrackerFactsObservedEvent
  readonly position: JournalPosition
  readonly snapshot: TaskDagSnapshot
}

/** Builds a valid graph observation fixture without importing a Vitest suite. */
export const makeTestAcceptedTrackerGraphObservation = (input: {
  readonly snapshot: TaskDagSnapshot
  readonly operationId: OperationId
  readonly acceptedAt: JournalPosition
}): AcceptedTrackerGraphObservation => {
  const operation = makeTrackerGraphObservationOperation(input.operationId, FixtureTarget.make("test-graph-target"))
  const event = taskTrackerFactsObservedEvent(
    input.operationId,
    makeCompleteTaskTrackerFactsObserved(operation, input.snapshot)
  )
  const receipt: TestAcceptedGraphReceipt = {
    [TestAcceptedGraphReceiptTypeId]: TestAcceptedGraphReceiptTypeId,
    event,
    position: input.acceptedAt,
    snapshot: input.snapshot
  }
  return Option.getOrThrow(
    acceptedTrackerGraphObservationFromAcceptedReceipt(receipt, ({ event, position, snapshot }) => ({
      event,
      position,
      snapshot
    }))
  )
}
