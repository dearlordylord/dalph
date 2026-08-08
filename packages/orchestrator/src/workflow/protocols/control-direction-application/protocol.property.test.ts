import { it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"
import { RunId, TaskId } from "@dalph/contracts"
import { decodeJournalEvent, encodeJournalEvent } from "../../../workflow-journal/event-codec.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  ControlDirectionApplicationOrdinal,
  ControlDirectionAppliedEvent,
  type ControlDirectionSubject
} from "./events.js"

const identityText = fc.stringMatching(/^[a-z][a-z0-9-]{0,24}$/)
const runSubject = identityText.map(
  (value): ControlDirectionSubject => ({ _tag: "Run", runId: RunId.make(`run-${value}`) })
)
const taskSubject = fc
  .tuple(identityText, identityText)
  .map(
    ([run, task]): ControlDirectionSubject => ({
      _tag: "Task",
      runId: RunId.make(`run-${run}`),
      taskId: TaskId.make(`task-${task}`)
    })
  )

it("round-trips every generated applied control direction through the journal codec", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("Pause" as const, "Unpause" as const),
      fc.oneof(runSubject, taskSubject),
      fc.integer({ min: 1, max: 10_000 }),
      async (direction, subject, ordinal) => {
        const event = ControlDirectionAppliedEvent.make({
          direction,
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: ControlDirectionApplicationOrdinal.make(ordinal),
          subject,
          version: workflowJournalEventVersion
        })
        const decoded = await Effect.runPromise(decodeJournalEvent(encodeJournalEvent(event)))
        return JSON.stringify(decoded) === JSON.stringify(event)
      }
    ),
    { numRuns: 200 }
  )
})
