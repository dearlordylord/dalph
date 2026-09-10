import { expect, it } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { OperationId } from "../workflow/identity.js"
import {
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../workflow/registry/operation.js"
import { taskTrackerReadIntent } from "../workflow/registry/event.js"
import { JournalPosition, JournalRecordKey } from "./identity.js"
import {
  journalEvidenceBefore,
  journalEvidenceFrom,
  journalOperationById,
  journalRecordByPosition,
  journalRecordsForTask,
  journalRecordsOfKind
} from "./record-evidence.js"

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

it("indexes an operation's exact task without visiting another task's records", () => {
  const runId = RunId.make("task-index-run")
  const target = FixtureTarget.make("task-index-target")
  const taskA = TaskId.make("task-index-a")
  const taskB = TaskId.make("task-index-b")
  const operations = [taskA, taskB].map((taskId, index) =>
    makeTaskWorkSpecificationObservationOperation(OperationId.make(`task-index-${index}`), target, taskId)
  )
  const records = operations.map((operation, index) => ({
    event: taskTrackerReadIntent(operation),
    key: JournalRecordKey.make(`task-index-${index}`),
    position: JournalPosition.make(index + 1),
    runId
  }))
  const evidence = journalEvidenceFrom(records)

  expect(Array.from(journalRecordsForTask(evidence, taskA))).toEqual([records[0]])
  expect(Array.from(journalRecordsForTask(evidence, taskB))).toEqual([records[1]])
})
