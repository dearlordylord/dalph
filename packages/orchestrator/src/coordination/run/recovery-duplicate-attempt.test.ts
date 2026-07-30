import { it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { expect } from "vitest"
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
  PlannedAttemptExecutor
} from "@dalph/contracts"
import { JournalDatabaseLocator, JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  attemptPlanRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { JournalRecord, JournalStore } from "../../workflow-journal/store.js"
import { TaskAttemptPlannedEvent } from "../../workflow/registry/event.js"
import { activateRecoveredResponsibilities } from "./recovery-activation.js"
import { PlannedAttemptExecutorWorkResponsibilityBeganEvent } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { PlannedAttemptRecoveryAuthority } from "./recovery-authority.js"
import { makeTaskAttemptPlanOperation } from "../../workflow/registry/operation.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { sqliteJournalStoreLayer } from "../../workflow-journal/adapters/sqlite-store.js"

const runId = RunId.make("duplicate-attempt-production-recovery")
const taskId = TaskId.make("A")

const plannedAttempt = (attemptId: string) =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(attemptId),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/${attemptId}`),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId,
    taskId,
    taskRevision: TaskRevision.make("task-A-revision"),
    worktree: WorktreeLocator.make(`/worktrees/${attemptId}`)
  })

const planAndStart = (attempt: PlannedTaskAttempt, firstPosition: number): ReadonlyArray<JournalRecord> => {
  const operation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make(`plan-${attempt.attemptId}`),
    plannedAttempt: attempt,
    predecessorOperationIds: []
  })
  return [
    {
      event: TaskAttemptPlannedEvent.make({ operation, version: workflowJournalEventVersion }),
      key: attemptPlanRecordKey(attempt.attemptId),
      position: JournalPosition.make(firstPosition),
      runId
    },
    {
      event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(attempt.attemptId),
      position: JournalPosition.make(firstPosition + 1),
      runId
    }
  ]
}

const firstAttempt = plannedAttempt("attempt-A-3")
const secondAttempt = plannedAttempt("attempt-A-4")
const invalidRecords = [...planAndStart(firstAttempt, 1), ...planAndStart(secondAttempt, 3)]

const failIfCalled = (boundary: string) =>
  Effect.die(`${boundary} must not be called for invalid workflow-journal history`)

const boundaryLayer = (records: ReadonlyArray<JournalRecord>) =>
  Layer.mergeAll(
    Layer.succeed(
      JournalStore,
      JournalStore.of({
        append: () => failIfCalled("journal append"),
        beginRun: () => failIfCalled("journal begin Run"),
        read: () => Effect.succeed(records),
        readRunForRecovery: () => failIfCalled("journal recover Run"),
        scan: () => failIfCalled("journal scan"),
        terminateRun: () => failIfCalled("journal terminate Run")
      })
    ),
    Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: () => failIfCalled("task tracker claim"),
        readTrackerGraph: () => failIfCalled("task tracker read"),
        readTaskWorkSpecification: () => failIfCalled("task-work specification read"),
        reconcileTaskWorktree: () => failIfCalled("Git worktree"),
        recordTaskAttemptPlan: () => failIfCalled("task-attempt plan recording")
      })
    ),
    Layer.succeed(
      PlannedAttemptExecutor,
      PlannedAttemptExecutor.of({
        project: () => failIfCalled("executor projection"),
        requestSuspension: () => failIfCalled("executor suspension"),
        startOrContinue: () => failIfCalled("executor start or continuation")
      })
    ),
    Layer.succeed(
      PlannedAttemptRecoveryAuthority,
      PlannedAttemptRecoveryAuthority.of({ verify: () => failIfCalled("tracker or Git recovery verification") })
    ),
    Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => failIfCalled("workflow trace") }))
  )

it.effect(
  "rejects duplicate unfinished planned-attempt executor work before frontier derivation or an executor call",
  () =>
    Effect.gen(function* () {
      for (const record of invalidRecords) {
        expect(yield* Schema.decodeUnknownEffect(JournalRecord)(record)).toEqual(record)
      }

      const roundTrippedRecords = yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        for (const record of invalidRecords) {
          if (record.event._tag === "WorkflowRunBegan") {
            yield* journal.beginRun(record.runId, record.event.target)
          } else if (record.event._tag === "WorkflowRunTerminated") {
            yield* journal.terminateRun(record.runId)
          } else {
            yield* journal.append(record.runId, record.key, record.event)
          }
        }
        return yield* journal.read(runId)
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(":memory:") })))
      expect(roundTrippedRecords).toEqual(invalidRecords)

      const failure = yield* activateRecoveredResponsibilities(runId, TaskWorkCapacity.make(1)).pipe(
        Effect.provide(boundaryLayer(roundTrippedRecords)),
        Effect.flip
      )

      expect(failure).toMatchObject({
        _tag: "InvalidWorkflowJournalHistory",
        issues: [
          expect.objectContaining({
            _tag: "DuplicateUnfinishedTaskAttemptIssue",
            first: { attemptId: firstAttempt.attemptId, position: 2, runId },
            runId,
            second: { attemptId: secondAttempt.attemptId, position: 4, runId },
            taskId
          })
        ],
        records: invalidRecords,
        runId
      })
    })
)
