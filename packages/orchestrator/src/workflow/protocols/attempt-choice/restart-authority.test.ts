import { expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { intentRecordKey, outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import { OperationId } from "../../identity.js"
import {
  taskTrackerFactsObservedEvent,
  makeFocusedTaskWorkSpecificationFactsObserved
} from "../../task-tracker-facts/observation.js"
import { taskTrackerReadIntent } from "../../registry/event.js"
import {
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../registry/operation.js"
import { AttemptChoiceRequestId } from "./events.js"
import { nextRestartReadOperationId, restartChoiceWasInvalidatedByLaterSpecification } from "./restart-authority.js"

const runId = RunId.make("restart-authority-coverage-run")
const taskId = TaskId.make("restart-authority-coverage-task")
const target = FixtureTarget.make("restart-authority-coverage-target")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("restart-authority-coverage-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/restart-authority-coverage"),
  executor: TaskExecutorLocator.make("executor:restart-authority-coverage"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("restart-authority-F1"),
  worktree: WorktreeLocator.make("/worktrees/restart-authority-coverage")
})
const requestId = AttemptChoiceRequestId.make({ nonce: "restart-authority-request", runId })

const record = (position: number, event: JournalRecord["event"], key: string): JournalRecord => ({
  event,
  key: JournalRecordKey.make(key),
  position: JournalPosition.make(position),
  runId
})

it("reuses one unresolved Restart read identity and allocates the next identity after reconciliation", () => {
  const pendingOperationId = OperationId.make(`attempt-restart:${encodeURIComponent(requestId.nonce)}:graph:after:2`)
  const pendingOperation = makeTrackerGraphObservationOperation(pendingOperationId, target, [], [taskId])
  const pending = record(3, taskTrackerReadIntent(pendingOperation), intentRecordKey(pendingOperationId).toString())
  expect(nextRestartReadOperationId([pending], requestId, "graph", JournalPosition.make(2))).toBe(pendingOperationId)
  expect(nextRestartReadOperationId([], requestId, "graph", JournalPosition.make(2))).toBe(
    `attempt-restart:${encodeURIComponent(requestId.nonce)}:graph:after:2`
  )
  const resolved = record(
    4,
    taskTrackerFactsObservedEvent(
      pendingOperationId,
      makeFocusedTaskWorkSpecificationFactsObserved(
        makeTaskWorkSpecificationObservationOperation(pendingOperationId, target, taskId),
        makeTaskWorkSpecification({ body: "F2", taskId, title: "F2" })
      )
    ),
    outcomeRecordKey(pendingOperationId).toString()
  )
  expect(nextRestartReadOperationId([pending, resolved], requestId, "graph", JournalPosition.make(2))).toBe(
    `attempt-restart:${encodeURIComponent(requestId.nonce)}:graph:after:2`
  )
})

it("invalidates an applied Restart after a later exact task specification read", () => {
  const operationId = OperationId.make("restart-authority-later-specification")
  const operation = makeTaskWorkSpecificationObservationOperation(operationId, target, taskId)
  const changed = makeTaskWorkSpecification({ body: "F2", taskId, title: "F2" })
  const later = record(
    3,
    taskTrackerFactsObservedEvent(operationId, makeFocusedTaskWorkSpecificationFactsObserved(operation, changed)),
    outcomeRecordKey(operationId).toString()
  )
  expect(
    restartChoiceWasInvalidatedByLaterSpecification([later], JournalPosition.make(2), {
      observedTaskRevision: plannedAttempt.taskRevision,
      plannedAttempt
    })
  ).toBe(true)
  expect(
    restartChoiceWasInvalidatedByLaterSpecification([later], JournalPosition.make(3), {
      observedTaskRevision: plannedAttempt.taskRevision,
      plannedAttempt
    })
  ).toBe(false)
})
