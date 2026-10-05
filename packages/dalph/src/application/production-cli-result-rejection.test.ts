import { it, expect } from "vitest"
import { Schema } from "effect"
import {
  PlannedTaskAttempt,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  PlannedAttemptResultResponseCount
} from "@dalph/contracts"
import {
  JournalPosition,
  ResultRecoverySubject,
  PlannedAttemptExecutorReportOrdinal,
  type DeliveryStatusEntry
} from "@dalph/orchestrator"
import { publicDeliveryStatusEntryOf } from "./production-cli-status-projection.js"
import { PublicDeliveryStatusEntry } from "./production-cli-status-schema.js"

const plannedAttempt = Schema.decodeUnknownSync(PlannedTaskAttempt)({
  attemptId: "attempt-A",
  baseSha: "1".repeat(40),
  branch: "refs/heads/dalph/attempt-A",
  executor: "executor:contract",
  runId: "run-A",
  taskId: "task-A",
  taskRevision: "revision-A",
  worktree: "/worktrees/attempt-A"
})

it("exposes retained rejection facts without projecting a successful settlement or foreign ownership", () => {
  for (const custody of [{ _tag: "Stopped" }, { _tag: "Unresolved" }] as const) {
    const rejection = PlannedAttemptExecutorReport.cases.ExecutorWorkResultRejected.make({
      correlation: plannedAttemptExecutorCorrelation(plannedAttempt),
      reason: "CandidateHeadMismatch",
      recoveryCause: "Deadline",
      responseCount: PlannedAttemptResultResponseCount.make(2),
      custody
    })
    const entry: Extract<DeliveryStatusEntry, { readonly _tag: "ExecutorResultRejected" }> = {
      _tag: "ExecutorResultRejected",
      classification: "Blocked",
      subject: { _tag: "Task", runId: plannedAttempt.runId, taskId: plannedAttempt.taskId },
      responsibility: {
        _tag: "PlannedAttemptExecutorWorkResponsibility",
        beganAt: JournalPosition.make(2),
        plannedAttempt
      },
      rejection,
      recoverySubject: ResultRecoverySubject.cases.RejectedResult.make({
        plannedAttempt,
        reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2)
      })
    }
    const projected = publicDeliveryStatusEntryOf(entry)
    const decode = Schema.decodeUnknownSync(PublicDeliveryStatusEntry, { onExcessProperty: "error" })
    expect(decode(projected)).toMatchObject({
      _tag: "ExecutorResultRejected",
      classification: "Blocked",
      plannedAttempt,
      rejection,
      recoverySubject: entry.recoverySubject
    })
    expect(() =>
      decode({
        ...projected,
        rejection: { ...rejection, correlation: { ...rejection.correlation, attemptId: "foreign-attempt" } }
      })
    ).toThrow()
    expect(() => decode({ ...projected, rejection: { ...rejection, responseCount: 1 } })).toThrow()
    expect(() =>
      decode({
        ...projected,
        recoverySubject: {
          ...entry.recoverySubject,
          plannedAttempt: { ...plannedAttempt, worktree: "/foreign/worktree" }
        }
      })
    ).toThrow()
  }
})
