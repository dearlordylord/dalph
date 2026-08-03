import { it } from "@effect/vitest"
import { expect } from "vitest"
import { Option } from "effect"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { TrackerRevision, TrackerSnapshot } from "../../authorities/task-tracker/task.js"
import { OperationId } from "../../workflow/identity.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  acceptedGraphReceiptFromEvent,
  acceptedTrackerGraphObservationFromAcceptedReceipt,
  type AcceptedTrackerGraphObservation
} from "./accepted-graph-observation.js"

/** Test-only seam for pure projection fixtures; production minting uses accepted journal records. */
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
  return Option.getOrThrow(
    Option.flatMap(
      acceptedGraphReceiptFromEvent({ event, position: input.acceptedAt, snapshot: input.snapshot }),
      acceptedTrackerGraphObservationFromAcceptedReceipt
    )
  )
}

it("mints fixtures through the accepted journal-record boundary", () => {
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
  expect(observation.acceptedAt).toBe(JournalPosition.make(1))
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
      acceptedGraphReceiptFromEvent({ event, position: JournalPosition.make(1), snapshot: second.snapshot }).pipe(
        Option.flatMap(acceptedTrackerGraphObservationFromAcceptedReceipt)
      )
    )
  ).toBe(true)
})
