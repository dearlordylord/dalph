import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  JournalPosition,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TaskWorkCapacity,
  WorktreeLocator
} from "./domain.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import { attemptPlanRecordKey, plannedAttemptExecutorWorkStartedRecordKey } from "./journal-record-key.js"
import { type JournalRecord, JournalStore, TaskAttemptPlannedEvent, WorkflowJournalEvent } from "./journal-store.js"
import { activateRecoveredResponsibilities } from "./managed-activation.js"
import { PlannedAttemptExecutorWorkStartedEvent } from "./planned-attempt-executor-journal.js"
import { PlannedAttemptExecutor } from "./planned-attempt-executor.js"
import { PlannedAttemptRecoveryAuthority } from "./planned-attempt-recovery-authority.js"
import { makeTaskAttemptPlanOperation } from "./workflow-operation.js"
import { WorkflowInterpreter, WorkflowTrace } from "./workflow.js"

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
      event: PlannedAttemptExecutorWorkStartedEvent.make({
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkStartedRecordKey(attempt.attemptId),
      position: JournalPosition.make(firstPosition + 1),
      runId
    }
  ]
}

const firstAttempt = plannedAttempt("attempt-A-3")
const secondAttempt = plannedAttempt("attempt-A-4")
const invalidRecords = [...planAndStart(firstAttempt, 1), ...planAndStart(secondAttempt, 3)]

const failIfCalled = (boundary: string) => Effect.die(`${boundary} must not be called for invalid managed history`)

it.effect(
  "rejects duplicate unfinished planned-attempt executor work before frontier derivation or an executor call",
  () =>
    Effect.gen(function* () {
      for (const { event } of invalidRecords) {
        expect(yield* Schema.decodeUnknownEffect(WorkflowJournalEvent)(event)).toEqual(event)
      }

      const failure = yield* activateRecoveredResponsibilities(runId, TaskWorkCapacity.make(1)).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "InvalidManagedHistory",
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
    }).pipe(
      Effect.provideService(
        JournalStore,
        JournalStore.of({
          append: () => failIfCalled("journal append"),
          read: () => Effect.succeed(invalidRecords),
          scan: () => failIfCalled("journal scan")
        })
      ),
      Effect.provideService(
        WorkflowInterpreter,
        WorkflowInterpreter.of({
          acquireTaskClaim: () => failIfCalled("task tracker claim"),
          readTrackerGraph: () => failIfCalled("task tracker read"),
          reconcileTaskWorktree: () => failIfCalled("Git worktree"),
          recordTaskAttemptPlan: () => failIfCalled("task-attempt plan recording")
        })
      ),
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => failIfCalled("executor projection"),
          requestSuspension: () => failIfCalled("executor suspension"),
          startOrContinue: () => failIfCalled("executor start or continuation")
        })
      ),
      Effect.provideService(
        PlannedAttemptRecoveryAuthority,
        PlannedAttemptRecoveryAuthority.of({ verify: () => failIfCalled("tracker or Git recovery verification") })
      ),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => failIfCalled("workflow trace") }))
    )
)
