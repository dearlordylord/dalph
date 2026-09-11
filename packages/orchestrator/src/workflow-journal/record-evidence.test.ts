import { expect, it } from "vitest"
import { RunId, TaskId, makeTaskWorkSpecification } from "@dalph/contracts"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { OperationId } from "../workflow/identity.js"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { ActiveTaskClaim, TaskClaimRelease } from "../authorities/task-tracker/claim-mutation.js"
import {
  makeTaskClaimReleaseOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation,
  TaskClaimReleaseAuthority
} from "../workflow/registry/operation.js"
import { TaskClaimReleaseIntendedEvent, taskTrackerReadIntent } from "../workflow/registry/event.js"
import {
  TaskTrackerFactsObservedEvent,
  makeFocusedTaskWorkSpecificationFactsObserved
} from "../workflow/task-tracker-facts/observation.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { JournalPosition, JournalRecordKey } from "./identity.js"
import {
  journalEvidenceBefore,
  journalEvidenceFrom,
  journalOperationById,
  journalRecordByPosition,
  journalRestartReadIntents,
  journalRecordsForOperationId,
  journalRecordsForTask,
  journalRecordsOfKind
} from "./record-evidence.js"

it("indexes a release intent by its nested claim operation at every safe cutoff", () => {
  const runId = RunId.make("nested-release-correlation-run")
  const claimOperationId = OperationId.make("nested-release-claim-operation")
  const release = TaskClaimRelease.make({
    claim: ActiveTaskClaim.make({
      operationId: claimOperationId,
      owner: ClaimOwner.make("nested-release-owner"),
      taskId: TaskId.make("nested-release-task"),
      token: ClaimToken.make("nested-release-token")
    }),
    operationId: OperationId.make("nested-release-operation")
  })
  const operation = makeTaskClaimReleaseOperation({
    authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
    predecessorOperationIds: [claimOperationId],
    release
  })
  const intent = {
    event: TaskClaimReleaseIntendedEvent.make({ operation, version: workflowJournalEventVersion }),
    key: JournalRecordKey.make("nested-release-intent"),
    position: JournalPosition.make(1),
    runId
  }
  const later = { ...intent, key: JournalRecordKey.make("nested-release-later"), position: JournalPosition.make(2) }
  const complete = journalEvidenceFrom([intent, later])
  const earlier = journalEvidenceBefore(complete, JournalPosition.make(2))

  expect(Array.from(journalRecordsForOperationId(earlier, claimOperationId))).toEqual([intent])
  expect(Array.from(journalRecordsForOperationId(complete, claimOperationId))).toEqual([intent, later])
})

it("indexes restart read intents by request and phase", () => {
  const operation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("attempt-restart:request%3Aone:graph:after:7"),
    FixtureTarget.make("restart-read-target")
  )
  const record = {
    event: taskTrackerReadIntent(operation),
    key: JournalRecordKey.make("restart-read-intent"),
    position: JournalPosition.make(1),
    runId: RunId.make("restart-read-run")
  }
  const indexed = journalEvidenceFrom([record])

  expect(Array.from(journalRestartReadIntents(indexed, "request:one", "graph"))).toEqual([record])
  expect(Array.from(journalRestartReadIntents(indexed, "request:one", "claim"))).toEqual([])
})

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

it("indexes a focused observation by its covered task identity", () => {
  const runId = RunId.make("focused-task-index-run")
  const taskId = TaskId.make("focused-task-index")
  const operation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("focused-task-index-operation"),
    FixtureTarget.make("focused-task-index-target"),
    taskId
  )
  const specification = makeTaskWorkSpecification({ body: "Indexed instructions.", taskId, title: "Indexed" })
  const record = {
    event: TaskTrackerFactsObservedEvent.make({
      observation: makeFocusedTaskWorkSpecificationFactsObserved(operation, specification),
      operationId: operation.operationId,
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("focused-task-index-record"),
    position: JournalPosition.make(1),
    runId
  }

  expect(Array.from(journalRecordsForTask(journalEvidenceFrom([record]), taskId))).toEqual([record])
  expect(Array.from(journalRecordsForTask([record], taskId))).toEqual([record])
})
