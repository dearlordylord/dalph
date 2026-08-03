import { it } from "@effect/vitest"
import { expect } from "vitest"
import { Option } from "effect"
import { TaskId } from "@dalph/contracts"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { TrackerRevision, TrackerSnapshot } from "../../authorities/task-tracker/task.js"
import { makeTaskWorkSpecification } from "../../authorities/task-tracker/task-work-specification.js"
import { OperationId } from "../../workflow/identity.js"
import {
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { acceptedGraphObservationFieldsFromReceipt } from "./accepted-graph-observation.js"
import { makeTestAcceptedTrackerGraphObservation } from "../../../test/accepted-graph-observation.js"

it("mints fixtures through a test accepted-journal gateway", () => {
  const projected = TaskDagSnapshot.project(
    TrackerSnapshot.make({ revision: TrackerRevision.make("fixture-observation"), tasks: [] })
  )
  if (projected._tag === "Invalid") return expect.fail("fixture graph must be valid")

  const observation = makeTestAcceptedTrackerGraphObservation({
    acceptedAt: JournalPosition.make(1),
    operationId: OperationId.make("fixture-observation-operation"),
    snapshot: projected.snapshot
  })

  expect(observation.operationId).toBe(OperationId.make("fixture-observation-operation"))
  expect(observation.contentIdentity).toBe(TrackerRevision.make("fixture-observation"))
  expect(observation.acceptedAt).toBe(JournalPosition.make(3))
})

it("rejects a complete graph receipt paired with a different reduced snapshot", () => {
  const first = TaskDagSnapshot.project(
    TrackerSnapshot.make({ revision: TrackerRevision.make("receipt-first"), tasks: [] })
  )
  const second = TaskDagSnapshot.project(
    TrackerSnapshot.make({ revision: TrackerRevision.make("receipt-second"), tasks: [] })
  )
  if (first._tag === "Invalid" || second._tag === "Invalid") return expect.fail("fixture graphs must be valid")
  const operation = makeTrackerGraphObservationOperation(
    OperationId.make("receipt-mismatch-operation"),
    FixtureTarget.make("test-graph-target")
  )
  const event = taskTrackerFactsObservedEvent(
    operation.operationId,
    makeCompleteTaskTrackerFactsObserved(operation, first.snapshot)
  )

  expect(
    Option.isNone(
      acceptedGraphObservationFieldsFromReceipt(
        { event, position: JournalPosition.make(1), snapshot: second.snapshot },
        ({ event, position, snapshot }) => ({ event, position, snapshot })
      )
    )
  ).toBe(true)
})

it("rejects a focused non-graph event at the observation boundary", () => {
  const taskId = TaskId.make("focused-task")
  const operation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("focused-operation"),
    FixtureTarget.make("focused-target"),
    taskId
  )
  const event = taskTrackerFactsObservedEvent(
    operation.operationId,
    makeFocusedTaskWorkSpecificationFactsObserved(
      operation,
      makeTaskWorkSpecification({ body: "body", taskId, title: "title" })
    )
  )
  const projected = TaskDagSnapshot.project(
    TrackerSnapshot.make({ revision: TrackerRevision.make("focused"), tasks: [] })
  )
  if (projected._tag === "Invalid") return expect.fail("fixture graph must be valid")

  expect(
    Option.isNone(
      acceptedGraphObservationFieldsFromReceipt(
        { event, position: JournalPosition.make(1), snapshot: projected.snapshot },
        ({ event, position, snapshot }) => ({ event, position, snapshot })
      )
    )
  ).toBe(true)
})
