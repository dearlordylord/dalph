import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { RunId } from "@dalph/contracts"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { type JournalRecord } from "../../workflow-journal/store.js"
import { taskTrackerReadIntent } from "./event.js"
import { describeJournalEvent } from "./event-descriptor.js"
import { OperationId } from "../identity.js"
import { makeTrackerGraphObservationOperation } from "./operation.js"
import { projectWorkflowOccurrences } from "./occurrence-projection.js"
import { taskTrackerGraphFactsObserved } from "../../../test/task-tracker-facts.js"

const runId = RunId.make("occurrence-projection-performance")

const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: describeJournalEvent(event).expectedKey,
  position: JournalPosition.make(position),
  runId
})

it.effect("preserves the 10,000-pair non-coverage projection signal", () =>
  Effect.gen(function* () {
    const pairCount = 10_000
    const records = Array.from({ length: pairCount }, (_unused, index) => {
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make(`performance-read-${index}`),
        FixtureTarget.make("performance-target")
      )
      const intentPosition = index * 2 + 1
      return [
        record(intentPosition, taskTrackerReadIntent(operation)),
        record(
          intentPosition + 1,
          taskTrackerGraphFactsObserved(operation, {
            revision: TrackerRevision.make(`performance-revision-${index}`),
            taskIds: []
          })
        )
      ]
    }).flat()

    const projection = yield* projectWorkflowOccurrences(records)

    expect(projection.occurrences).toHaveLength(pairCount * 2)
  })
)
