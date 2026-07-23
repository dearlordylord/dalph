import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  JournalEventVersion,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskLifecycle,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorktreeLocator
} from "./domain.js"
import { decodeAndUpcastJournalEvent, encodeJournalEvent } from "./journal-event-codec.js"
import {
  TaskAttemptPlannedEvent,
  TaskExecutionIntentRecorded,
  TaskWorkSessionEstablishmentIntentRecorded,
  TaskWorktreeReconciliationIntendedEvent,
  type WorkflowJournalEvent
} from "./journal-store.js"
import { taskRevisionFor } from "./task-dag.js"
import { TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
import { TaskWorkStartRequest } from "./task-work-start.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskExecutionOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation
} from "./workflow-operation.js"

const legacyJournalEventVersion = JournalEventVersion.make(3)
const runId = RunId.make("legacy-task-revision-run")
const task = {
  id: TaskId.make("legacy-task-revision-task"),
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
}
const legacyTaskRevision = JSON.stringify({
  id: task.id,
  lifecycle: task.lifecycle._tag,
  parentTaskId: task.parentTaskId,
  prerequisiteIds: task.prerequisiteIds
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("legacy-task-revision-attempt"),
  baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
  branch: TaskBranchRef.make("refs/heads/dalph/legacy-task-revision"),
  executor: TaskExecutorLocator.make("executor:legacy-task-revision"),
  runId,
  session: TaskWorkSessionLocator.make("session:legacy-task-revision"),
  taskId: task.id,
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/dalph-legacy-task-revision")
})
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("legacy-task-revision-plan"),
  plannedAttempt,
  predecessorOperationIds: []
})
const worktreeOperation = makeTaskWorktreeReconciliationOperation({
  operationId: OperationId.make("legacy-task-revision-worktree"),
  plannedAttempt,
  predecessorOperationIds: [planOperation.operationId]
})
const sessionOperation = makeTaskWorkSessionEstablishmentOperation({
  predecessorOperationIds: [worktreeOperation.operationId],
  request: TaskWorkStartRequest.make({
    operationId: OperationId.make("legacy-task-revision-session"),
    plannedAttempt,
    task
  })
})
const executionOperation = makeTaskExecutionOperation({
  predecessorOperationIds: [sessionOperation.request.operationId],
  request: TaskExecutionRequest.make({
    operationId: OperationId.make("legacy-task-revision-execution"),
    plannedAttempt,
    session: TaskExecutionSessionBinding.cases.EstablishedSession.make({
      sessionId: TaskWorkSessionId.make("legacy-task-revision-provider-session")
    }),
    task
  })
})

const events: ReadonlyArray<WorkflowJournalEvent> = [
  TaskAttemptPlannedEvent.make({ operation: planOperation, version: 4 }),
  TaskWorktreeReconciliationIntendedEvent.make({ operation: worktreeOperation, version: 4 }),
  TaskWorkSessionEstablishmentIntentRecorded.make({ operation: sessionOperation, version: 4 }),
  TaskExecutionIntentRecorded.make({ operation: executionOperation, version: 4 })
]

const replaceTaskRevision = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(replaceTaskRevision)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      key === "taskRevision" ? legacyTaskRevision : replaceTaskRevision(nested)
    ])
  )
}

describe("journal event task revision fingerprint upcast", () => {
  it.effect("recovers planning, worktree, session, and execution events written by version 3", () =>
    Effect.forEach(events, (event) => {
      const encoded = encodeJournalEvent(event)
      const legacyPayload = replaceTaskRevision(JSON.parse(encoded.payloadJson))
      return decodeAndUpcastJournalEvent({
        ...encoded,
        payloadJson: JSON.stringify(legacyPayload),
        version: legacyJournalEventVersion
      }).pipe(Effect.map((decoded) => expect(decoded).toEqual(event)))
    }))
})
