import { ContradictoryWorktreeState } from "../../authorities/git/worktree.js"
import {
  makeTaskWorktreeObservationOperation,
  makeTargetLineageObservationOperation,
  makeTaskWorkSpecificationObservationOperation
} from "../../workflow/registry/operation.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  RunId,
  GitCommitSha,
  TaskId,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport,
  PlannedAttemptResultResponseCount
} from "@dalph/contracts"
import { describe, expect, it } from "vitest"
import { intentRecordKey } from "../../workflow-journal/record-key.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { type JournalRecord } from "../../workflow-journal/store.js"
import {
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorReportOrdinal
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
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
  it("projects rejection with its exact explicit recovery subject rather than Suspended or Failed", () => {
    const rejection = PlannedAttemptExecutorReport.cases.ExecutorWorkResultRejected.make({
      correlation: plannedAttemptExecutorCorrelation(attempt),
      reason: "ResultEnvelopeInvalid",
      recoveryCause: "CorrectionExhausted",
      responseCount: PlannedAttemptResultResponseCount.make(3),
      custody: { _tag: "Stopped" }
    })
    const diagnostics = projectDeliveryDiagnostics(attempt.runId, [began, reported(2, rejection)], {
      _tag: "GraphNotEstablished"
    })
    expect(diagnostics.tasks[0]).toMatchObject({
      phase: "Rejected",
      failure: { _tag: "None" },
      recovery: {
        _tag: "ExplicitDirectionRequired",
        rejection,
        subject: { _tag: "RejectedResult", plannedAttempt: attempt, reportOrdinal: 2 }
      }
    })
  })

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
      _tag: "RestartOnly",
      subject: { _tag: "HistoricalUnknownFailure", plannedAttempt: attempt, reportOrdinal: 2 }
    })
    const known = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation: plannedAttemptExecutorCorrelation(attempt),
      result: { _tag: "Failed", failureCode: "ProviderFailed" }
    })
    expect(projectDeliveryDiagnostics(attempt.runId, [began, reported(2, known)]).tasks[0]?.recovery).toEqual({
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

it("retains exact unavailable and contradictory evidence without changing executor lifecycle or borrowing foreign facts", () => {
  const observed = (
    position: number,
    kind: "ExecutorStateTemporarilyUnavailable" | "ExecutorReportContradiction",
    plannedAttempt = attempt
  ): JournalRecord =>
    record(position, {
      _tag: "PlannedAttemptExecutorStateObserved",
      version: workflowJournalEventVersion,
      occurrenceClassification: "NonActionOccurrence",
      ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(position),
      plannedAttempt,
      observation:
        kind === "ExecutorReportContradiction"
          ? {
              _tag: kind,
              observed: { ...executing, correlation: { ...executing.correlation, runId: RunId.make("foreign") } }
            }
          : { _tag: kind }
    })
  const history = [began, reported(2, executing), observed(3, "ExecutorStateTemporarilyUnavailable")]
  const unavailable = projectDeliveryDiagnostics(attempt.runId, history)
  expect(unavailable.tasks[0]).toMatchObject({
    phase: "Executing",
    lastSubstantiveAt: 2,
    executorEvidence: { kind: "ExecutorStateTemporarilyUnavailable", observedAt: 3 }
  })
  expect(
    projectDeliveryDiagnostics(attempt.runId, [...history, observed(4, "ExecutorStateTemporarilyUnavailable")])
  ).toEqual(unavailable)
  expect(
    projectDeliveryDiagnostics(attempt.runId, [
      ...history,
      observed(4, "ExecutorReportContradiction", { ...attempt, taskId: TaskId.make("unrelated-task") })
    ])
  ).toEqual(unavailable)
  const contradiction = projectDeliveryDiagnostics(attempt.runId, [
    ...history,
    observed(5, "ExecutorReportContradiction")
  ])
  expect(contradiction.tasks[0]).toMatchObject({
    phase: "Executing",
    lastSubstantiveAt: 2,
    executorEvidence: { kind: "ExecutorReportContradiction", observedAt: 5 }
  })
  expect(JSON.stringify(contradiction)).not.toContain("foreign")
  expect(projectDeliveryDiagnostics(attempt.runId, [...history, reported(4, executing)]).tasks[0]).toMatchObject({
    phase: "Executing",
    lastSubstantiveAt: 2,
    executorEvidence: { kind: "ExecutorWorkExecuting", observedAt: 4 }
  })
  const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
    correlation: plannedAttemptExecutorCorrelation(attempt)
  })
  expect(
    projectDeliveryDiagnostics(attempt.runId, [
      ...history,
      observed(5, "ExecutorReportContradiction"),
      reported(6, safe)
    ]).tasks[0]
  ).toMatchObject({ phase: "Suspended", executorEvidence: { kind: "ExecutorWorkSafelySuspended", observedAt: 6 } })
  expect(projectDeliveryDiagnostics(attempt.runId, JSON.parse(JSON.stringify(history)))).toEqual(unavailable)
})

it("keeps exact Git and claim evidence families separate and redacts authority-private content", () => {
  const operationId = OperationId.make("diagnostic-worktree-read")
  const operation = makeTaskWorktreeObservationOperation({
    operationId,
    plannedAttempt: attempt,
    predecessorOperationIds: []
  })
  const intent: JournalRecord = {
    ...record(2, {
      _tag: "GitReadIntentRecorded",
      version: workflowJournalEventVersion,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation
    }),
    key: intentRecordKey(operationId)
  }
  const worktree = record(3, {
    _tag: "PlannedAttemptWorktreeObserved",
    version: workflowJournalEventVersion,
    occurrenceClassification: "NonActionOccurrence",
    operationId,
    observation: new ContradictoryWorktreeState({ detail: "private git token=secret", worktree: attempt.worktree })
  })
  const lineageId = OperationId.make("diagnostic-lineage-read")
  const lineageIntent: JournalRecord = {
    ...record(4, {
      _tag: "GitReadIntentRecorded",
      version: workflowJournalEventVersion,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: makeTargetLineageObservationOperation({
        operationId: lineageId,
        plannedAttempt: attempt,
        predecessorOperationIds: [],
        integrationTarget: integrationFinalityFixture.integrationTarget
      })
    }),
    key: intentRecordKey(lineageId)
  }
  const lineage = record(5, {
    _tag: "TargetLineageObserved",
    version: workflowJournalEventVersion,
    occurrenceClassification: "NonActionOccurrence",
    operationId: lineageId,
    plannedAttempt: attempt,
    observation: {
      plannedBaseSha: attempt.baseSha,
      targetHeadSha: attempt.baseSha,
      plannedBaseIsAncestorOfTargetHead: true
    }
  })
  const claimId = OperationId.make("diagnostic-claim-read")
  const claim = record(
    6,
    taskTrackerFactsObservedEvent(claimId, {
      _tag: "FocusedTaskClaimFacts",
      completeness: "Complete",
      consistency: "Atomic",
      coverage: { _tag: "ExactTaskClaim", taskId: attempt.taskId },
      freshness: { _tag: "ObservedDuringLogicalRead", operationId: claimId },
      observation: integrationFinalityFixture.activeClaim,
      operationId: claimId,
      target: integrationFinalityFixture.target
    })
  )
  const history = [began, intent, worktree, lineageIntent, lineage, claim]
  const diagnostic = projectDeliveryDiagnostics(attempt.runId, history, undefined, integrationFinalityFixture.target)
  expect(diagnostic.tasks[0]?.authorityEvidence).toEqual({
    gitWorktree: { observedAt: 3, operationId, kind: "ContradictoryWorktreeState" },
    gitLineage: { observedAt: 5, operationId: lineageId, kind: "TargetDescendsFromPlannedBase" },
    claim: [{ observedAt: 6, operationId: claimId, kind: "ActiveTaskClaim" }]
  })
  if (lineage.event._tag !== "TargetLineageObserved") return expect.fail("lineage fixture invalid")
  const foreignLineage = {
    ...lineage,
    position: JournalPosition.make(7),
    event: {
      ...lineage.event,
      observation: { ...lineage.event.observation, plannedBaseSha: GitCommitSha.make("9".repeat(40)) }
    }
  }
  expect(
    projectDeliveryDiagnostics(
      attempt.runId,
      [...history, foreignLineage],
      undefined,
      integrationFinalityFixture.target
    )
  ).toEqual(diagnostic)
  expect(JSON.stringify(diagnostic)).not.toContain("private git token=secret")
  expect(JSON.stringify(diagnostic)).not.toContain(integrationFinalityFixture.activeClaim.token)
  const foreign = {
    ...claim,
    position: JournalPosition.make(7),
    event: taskTrackerFactsObservedEvent(claimId, {
      ...(claim.event._tag === "TaskTrackerFactsObserved"
        ? claim.event.observation
        : expect.fail("claim fixture invalid")),
      target: FixtureTarget.make("foreign-tracker")
    })
  }
  expect(
    projectDeliveryDiagnostics(attempt.runId, [...history, foreign], undefined, integrationFinalityFixture.target)
  ).toEqual(diagnostic)
  expect(
    projectDeliveryDiagnostics(
      attempt.runId,
      [...history, { ...worktree, position: JournalPosition.make(8) }],
      undefined,
      integrationFinalityFixture.target
    )
  ).toEqual(diagnostic)
})
