import { Effect, Schema } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  FailedProcessExitCode,
  FailedTaskExecutionReported,
  OperationId,
  ProviderObservationId,
  TaskExecutionLookup,
  taskExecutionOutcomeFromReport,
  TaskWorkSessionId,
  WorkerProcessId
} from "./index.js"

it("preserves every valid nonzero exit, WIP marker, and bounded partial output", () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
    fc.string({ maxLength: 2_000 }),
    (exitCode, partialOutput) => {
      const operationId = OperationId.make("property-operation")
      const sessionId = TaskWorkSessionId.make("property-session")
      const lookup = Schema.decodeUnknownSync(TaskExecutionLookup)({
        operationId,
        plannedAttempt: {
          attemptId: "property-attempt",
          baseSha: "0123456789abcdef0123456789abcdef01234567",
          branch: "refs/heads/dalph/property",
          executor: "executor:property",
          runId: "property-run",
          session: "session:property",
          taskId: "property-task",
          taskRevision: "property-revision",
          worktree: "/tmp/property"
        },
        sessionId
      })
      const report = FailedTaskExecutionReported.make({
        exitCode: FailedProcessExitCode.make(exitCode),
        observationId: ProviderObservationId.make("property-observation"),
        operationId,
        partialOutput,
        processId: WorkerProcessId.make(1),
        sessionId,
        wipPreserved: true
      })
      const outcome = Effect.runSync(taskExecutionOutcomeFromReport(lookup, report))
      expect(outcome).toMatchObject({ exitCode, partialOutput, wipPreserved: true })
    }
  ))
})
