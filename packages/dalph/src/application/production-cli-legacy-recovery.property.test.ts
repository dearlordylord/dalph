import { expect, it } from "vitest"
import { Schema } from "effect"
import fc from "fast-check"
import { PlannedTaskAttempt } from "@dalph/contracts"
import {
  DeliveryDiagnostics,
  JournalPosition,
  PlannedAttemptExecutorReportOrdinal,
  ResultRecoverySubject,
  type CurrentDeliveryStatus,
  type DeliveryStatusEntry
} from "@dalph/orchestrator"
import {
  ProductionCliCurrentDeliveryStatus,
  PublicDeliveryStatusEntry,
  publicDeliveryStatusOf
} from "./production-cli-status-schema.js"

const attempt = Schema.decodeUnknownSync(PlannedTaskAttempt)({
  attemptId: "attempt-A",
  baseSha: "1".repeat(40),
  branch: "refs/heads/dalph/attempt-A",
  executor: "executor:contract",
  runId: "run-A",
  taskId: "task-A",
  taskRevision: "revision-A",
  worktree: "/worktrees/attempt-A"
})
const failure: Extract<DeliveryStatusEntry, { readonly _tag: "ExecutorFailure" }> = {
  _tag: "ExecutorFailure",
  classification: "Blocked",
  subject: { _tag: "Task", runId: attempt.runId, taskId: attempt.taskId },
  responsibility: {
    _tag: "PlannedAttemptExecutorWorkResponsibility",
    beganAt: JournalPosition.make(2),
    plannedAttempt: attempt
  },
  failureCode: null
}
const diagnosticsFor = (plannedAttempt: PlannedTaskAttempt): DeliveryDiagnostics => ({
  runId: plannedAttempt.runId,
  trackerWait: { _tag: "None" },
  tasks: [
    {
      taskId: plannedAttempt.taskId,
      identity: { _tag: "Unavailable" },
      phase: "Failed",
      lastSubstantiveAt: JournalPosition.make(5),
      retainedAttempt: {
        attemptId: plannedAttempt.attemptId,
        runId: plannedAttempt.runId,
        taskId: plannedAttempt.taskId,
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        worktree: plannedAttempt.worktree
      },
      candidateHead: { _tag: "Unavailable" },
      failure: { _tag: "Unavailable" },
      recovery: {
        _tag: "RestartOnly",
        subject: ResultRecoverySubject.cases.HistoricalUnknownFailure.make({
          plannedAttempt,
          reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(3)
        })
      }
    }
  ]
})
const statusFor = (
  entries: ReadonlyArray<DeliveryStatusEntry>,
  diagnostics?: DeliveryDiagnostics
): CurrentDeliveryStatus => ({
  _tag: "DeliveryStatusAvailable",
  subject: { _tag: "Run", runId: attempt.runId },
  acceptedAt: JournalPosition.make(5),
  entries,
  ...(diagnostics === undefined ? {} : { diagnostics })
})
const entryOf = (status: CurrentDeliveryStatus) => {
  const projected = publicDeliveryStatusOf(status)
  if (projected._tag !== "DeliveryStatusAvailable") throw new Error("expected available status")
  const entry = projected.entries[0]
  if (entry?._tag !== "ExecutorFailure") throw new Error("expected executor failure")
  return entry
}

it("exposes an exact historical report for Restart only, and never grants recovery without it", () => {
  const diagnostics = diagnosticsFor(attempt)
  const projected = publicDeliveryStatusOf(statusFor([failure], diagnostics))
  expect(Schema.decodeUnknownSync(ProductionCliCurrentDeliveryStatus)(projected)).toEqual(projected)
  expect(entryOf(statusFor([failure], diagnostics)).recovery).toEqual(diagnostics.tasks[0]?.recovery)
  expect(entryOf(statusFor([failure])).recovery._tag).toBe("Unavailable")
  const known = { ...failure, failureCode: "ProviderFailed" } as const
  expect(entryOf(statusFor([known], diagnostics)).recovery._tag).toBe("Unavailable")
  expect(() =>
    Schema.decodeUnknownSync(PublicDeliveryStatusEntry)({
      ...entryOf(statusFor([known], diagnostics)),
      recovery: diagnostics.tasks[0]?.recovery
    })
  ).toThrow()
})

it("refuses a recovery subject changed in any planned identity field", () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[a-z][a-z0-9]{1,12}$/), (suffix) => {
      const foreignValues = {
        attemptId: `foreign-${suffix}`,
        baseSha: "2".repeat(40),
        branch: `refs/heads/foreign-${suffix}`,
        executor: `foreign-executor-${suffix}`,
        runId: `foreign-run-${suffix}`,
        taskId: `foreign-task-${suffix}`,
        taskRevision: `foreign-revision-${suffix}`,
        worktree: `/foreign/${suffix}`
      }
      const exact = entryOf(statusFor([failure], diagnosticsFor(attempt)))
      for (const [field, value] of Object.entries(foreignValues)) {
        const foreign = Schema.decodeUnknownSync(PlannedTaskAttempt)({ ...attempt, [field]: value })
        expect(entryOf(statusFor([failure], diagnosticsFor(foreign))).recovery._tag).toBe("Unavailable")
        expect(() =>
          Schema.decodeUnknownSync(PublicDeliveryStatusEntry)({
            ...exact,
            recovery: {
              _tag: "RestartOnly",
              subject: { _tag: "HistoricalUnknownFailure", plannedAttempt: foreign, reportOrdinal: 3 }
            }
          })
        ).toThrow()
      }
    }),
    { numRuns: 30, seed: 428 }
  )
})

it("rejects diagnostics that mix a historical subject with a foreign retained attempt or failure kind", () => {
  const diagnostics = diagnosticsFor(attempt)
  const task = diagnostics.tasks[0]
  if (task === undefined) throw new Error("expected retained attempt")
  const decode = Schema.decodeUnknownSync(DeliveryDiagnostics)
  expect(decode(diagnostics)).toEqual(diagnostics)
  for (const changed of [
    { ...task, taskId: "foreign-task" },
    { ...task, retainedAttempt: { ...task.retainedAttempt, worktree: "/foreign" } },
    { ...task, phase: "Rejected" },
    { ...task, failure: { _tag: "Known", code: "ProviderFailed" } }
  ])
    expect(() => decode({ ...diagnostics, tasks: [changed] })).toThrow()
})
