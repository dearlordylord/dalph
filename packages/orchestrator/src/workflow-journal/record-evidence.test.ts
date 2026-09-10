import { expect, it } from "vitest"
import { RunId } from "@dalph/contracts"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { OperationId } from "../workflow/identity.js"
import { makeTrackerGraphObservationOperation } from "../workflow/registry/operation.js"
import { taskTrackerReadIntent } from "../workflow/registry/event.js"
import { JournalPosition, JournalRecordKey } from "./identity.js"
import { journalEvidenceFrom, journalEvidenceBefore, journalOperationById, journalRecordByPosition, journalRecordsOfKind } from "./record-evidence.js"

it("an earlier evidence window still finds the operation before a later repeated occurrence", () => {
  const operation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("window-operation"),
    FixtureTarget.make("window-target")
  )
  const records = [1, 2].map((position) => ({
    event: taskTrackerReadIntent(operation),
    key: JournalRecordKey.make(`window-${position}`),
    position: JournalPosition.make(position),
    runId: RunId.make("window-run")
  }))
  const complete = journalEvidenceFrom(records)
  const earlier = journalEvidenceBefore(complete, JournalPosition.make(2))
  expect(journalOperationById(earlier, operation.operationId)).toEqual(operation)
  expect(journalRecordByPosition(earlier, JournalPosition.make(2))).toBeUndefined()
  expect(Array.from(journalRecordsOfKind(earlier, "TaskTrackerReadIntentRecorded"))).toEqual([records[0]])
  expect(Array.from(journalRecordsOfKind(complete, "TaskTrackerReadIntentRecorded"))).toEqual(records)
})
