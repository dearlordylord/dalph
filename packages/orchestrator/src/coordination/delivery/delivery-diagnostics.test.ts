import { makeTaskWorkSpecificationObservationOperation } from "../../workflow/registry/operation.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  RunId,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport
} from "@dalph/contracts"
import { describe, expect, it } from "vitest"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { type JournalRecord } from "../../workflow-journal/store.js"
import { PlannedAttemptExecutorReportOrdinal } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { OperationId } from "../../workflow/identity.js"
import {
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { projectDeliveryDiagnostics } from "./delivery-diagnostics.js"

const attempt = integrationFinalityFixture.plannedAttempt
const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  runId: attempt.runId,
  position: JournalPosition.make(position),
  key: JournalRecordKey.make(`diagnostic-${position}`),
  event
})
const began = record(1, {
  _tag: "PlannedAttemptExecutorWorkResponsibilityBegan",
  version: workflowJournalEventVersion,
  plannedAttempt: attempt
})
const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
  correlation: plannedAttemptExecutorCorrelation(attempt)
})
const reported = (position: number, report: PlannedAttemptExecutorReport): JournalRecord =>
  record(position, {
    _tag: "PlannedAttemptExecutorWorkReported",
    version: workflowJournalEventVersion,
    ordinal: PlannedAttemptExecutorReportOrdinal.make(position),
    report
  })

describe("transient delivery diagnostics", () => {
  it("projects throttle and circuit observations without inventing retry times", () => {
    const observation = (reason: "Throttled" | "CircuitOpen") =>
      record(
        3,
        taskTrackerFactsObservedEvent(OperationId.make("read-3"), {
          _tag: "TaskTrackerFactsReadFailed",
          completeness: "Unreadable",
          operationId: OperationId.make("read-3"),
          target: FixtureTarget.make("/fixtures/graph.json"),
          failure: { _tag: "TrackerAdapterReadError", detail: "private provider payload", reason: { _tag: reason } }
        })
      )
    for (const reason of ["Throttled", "CircuitOpen"] as const) {
      const diagnostic = projectDeliveryDiagnostics(attempt.runId, [began, observation(reason)])
      expect(diagnostic.trackerWait).toMatchObject({ _tag: reason, observedAt: 3, retry: { _tag: "Unavailable" } })
      expect(JSON.stringify(diagnostic)).not.toContain("private provider payload")
    }
  })
  it("duplicate lifecycle observations do not advance substantive progress", () => {
    const first = projectDeliveryDiagnostics(attempt.runId, [began, reported(2, executing)])
    const repeated = projectDeliveryDiagnostics(attempt.runId, [began, reported(2, executing), reported(3, executing)])
    expect(repeated.tasks).toEqual(first.tasks)
    expect(repeated.tasks[0]?.lastSubstantiveAt).toBe(2)
  })
  it("reconstructs retained failure diagnostics after restart", () => {
    const records = [
      began,
      reported(
        2,
        PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation: plannedAttemptExecutorCorrelation(attempt),
          result: { _tag: "Failed", failureCode: "ResultEnvelopeInvalid" }
        })
      )
    ]
    const diagnostic = projectDeliveryDiagnostics(attempt.runId, records)
    expect(projectDeliveryDiagnostics(attempt.runId, JSON.parse(JSON.stringify(records)))).toEqual(diagnostic)
    expect(diagnostic.tasks[0]).toMatchObject({
      taskId: attempt.taskId,
      phase: "Failed",
      lastSubstantiveAt: 2,
      retainedAttempt: { attemptId: attempt.attemptId, runId: attempt.runId, worktree: attempt.worktree },
      failure: { _tag: "Known", code: "ResultEnvelopeInvalid" }
    })
  })
  it("clears a recovered tracker wait without replaying mutations", () => {
    const operationId = OperationId.make("read-throttle")
    const failed = record(
      2,
      taskTrackerFactsObservedEvent(operationId, {
        _tag: "TaskTrackerFactsReadFailed",
        completeness: "Unreadable",
        operationId,
        target: integrationFinalityFixture.target,
        failure: { _tag: "TrackerAdapterReadError", detail: "omitted", reason: { _tag: "Throttled" } }
      })
    )
    const history = [began, failed, record(3, integrationFinalityFixture.graphRecordEvent)]
    const before = JSON.stringify(history)
    expect(projectDeliveryDiagnostics(attempt.runId, history).trackerWait).toEqual({ _tag: "None" })
    expect(JSON.stringify(history)).toBe(before)
  })
  it("advertises failure recovery only for a failed attempt", () => {
    expect(projectDeliveryDiagnostics(attempt.runId, [began, reported(2, executing)]).tasks[0]?.recovery).toEqual({
      _tag: "NotApplicable"
    })
    const failed = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation: plannedAttemptExecutorCorrelation(attempt),
      result: { _tag: "Failed" }
    })
    expect(projectDeliveryDiagnostics(attempt.runId, [began, reported(2, failed)]).tasks[0]?.recovery).toEqual({
      _tag: "Unavailable",
      reason: "ExecutorFailureRecoveryNotImplemented"
    })
  })
  it("compact diagnostics omit authored bodies and private provider payloads", () => {
    const diagnostic = projectDeliveryDiagnostics(attempt.runId, [began])
    expect(diagnostic.tasks[0]?.retainedAttempt).not.toHaveProperty("taskRevision")
    expect(diagnostic.tasks[0]?.retainedAttempt).not.toHaveProperty("executor")
  })
  it("does not associate foreign executor reports with a retained attempt", () => {
    const foreign = { ...executing, correlation: { ...executing.correlation, runId: RunId.make("foreign") } }
    expect(projectDeliveryDiagnostics(attempt.runId, [began, reported(2, foreign)]).tasks[0]?.lastSubstantiveAt).toBe(1)
  })
})

it("does not borrow a focused title from another tracker target", () => {
  const operationId = OperationId.make("foreign-title")
  const foreign = record(
    2,
    taskTrackerFactsObservedEvent(
      operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(
        makeTaskWorkSpecificationObservationOperation(
          operationId,
          FixtureTarget.make("/foreign-target"),
          attempt.taskId
        ),
        makeTaskWorkSpecification({ taskId: attempt.taskId, title: "Foreign title", body: "private authored body" })
      )
    )
  )
  expect(
    projectDeliveryDiagnostics(attempt.runId, [began, foreign], undefined, integrationFinalityFixture.target).tasks[0]
      ?.identity
  ).toEqual({ _tag: "Unavailable" })
})
