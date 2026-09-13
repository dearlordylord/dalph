import { expect } from "vitest"
import { Option, Result } from "effect"
import type { PlannedTaskAttempt } from "@dalph/contracts"
import { reduceWorkflowJournalHistory, TraceCursor, type JournalRecord, type TraceAtCursor } from "@dalph/orchestrator"
import { projectFreshTaskAdmission } from "../../../orchestrator/src/coordination/admission/fresh-task-admission.js"
import { journalRetainedExecutorResponsibilitySubjects } from "../../../orchestrator/src/workflow-journal/record-evidence.js"
import {
  deriveIntegrationAdmission,
  deriveUnqueuedAcceptedResults
} from "../../../orchestrator/src/workflow/protocols/integration-admission/protocol.js"
import {
  latestAcceptedPlannedAttemptExecutorEvidence,
  latestUnsettledPlannedAttemptExecutorCommand
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/evidence.js"
import {
  type AuthoredDeliveryFrame,
  type AuthoredObservationCapture,
  type AuthoredScenarioCassetteRun
} from "../../src/cassettes/authored-runner.js"
import { normalizeDeclaredIntegratorSession } from "./delivery-capstone-authored-correlations.test-support.js"

const transient = {
  suspendB: 4,
  lowered: 7,
  suspendC: 10,
  resumedB: 13,
  fixedA: 14,
  reopenedC: 18,
  startedSuccessors: 21
} as const
type JournalBeat = (typeof transient)[keyof typeof transient]
type Occurrence = Extract<AuthoredObservationCapture, { readonly _tag: "AuthoredStoryOccurrenceCaptured" }>
const attempts = {
  A: "attempt:A:0",
  B: "attempt:B:2",
  C: "attempt:C:1",
  D: "attempt:D:0",
  E: "attempt:E:0",
  F: "attempt:F:1",
  G: "attempt:G:0"
} as const
type Task = keyof typeof attempts

export const isDeliveryCapstoneJournalBeat = (beat: number): beat is JournalBeat =>
  Object.values(transient).some((value) => value === beat)

export interface DeliveryCapstoneJournalRow {
  readonly beat: JournalBeat
  readonly graph: string
  readonly capacity: number
  readonly held: ReadonlyArray<Task>
  readonly retained: ReadonlyArray<Task>
  readonly alice: ReadonlyArray<Task>
  readonly closedC?: boolean
  readonly after: { readonly kind: "Journal"; readonly record: JournalRecord }
  readonly before:
    | { readonly kind: "Journal"; readonly record: JournalRecord }
    | { readonly kind: "Occurrence"; readonly capture: Occurrence }
}

/**
 * An exact committed intent/report/capacity/session prefix can expose a beat
 * that never became a stable Delivery publication. This witness is journal
 * history, not a fabricated publication or a process-local owner snapshot.
 */
export interface DeliveryCapstoneJournalCheckpoint {
  readonly _tag: "JournalCheckpoint"
  readonly beat: JournalBeat
  readonly cursor: TraceCursor
  readonly trace: TraceAtCursor
  readonly capacity: AuthoredDeliveryFrame["capacity"]
  readonly heldAttempts: ReadonlyArray<PlannedTaskAttempt>
  readonly retainedAttempts: ReadonlyArray<PlannedTaskAttempt>
}

const required = <A>(value: A | undefined, detail: string): A => {
  if (value === undefined) return expect.fail(`capstone journal checkpoint evidence gap: ${detail}`)
  return value
}
const pair = (attempt: PlannedTaskAttempt) => ({
  attemptId: attempt.attemptId,
  runId: attempt.runId,
  taskId: attempt.taskId
})
const ordered = <A extends { readonly taskId: string }>(values: ReadonlyArray<A>) =>
  values.toSorted((a, b) => a.taskId.localeCompare(b.taskId))
const expected = (run: AuthoredScenarioCassetteRun, tasks: ReadonlyArray<Task>) =>
  tasks.map((taskId) => ({ attemptId: attempts[taskId], runId: run.runId, taskId }))

const assertSuspension = (prefix: ReadonlyArray<JournalRecord>, lower: JournalRecord, task: Task) => {
  if (lower.event._tag !== "PlannedAttemptExecutorCommandIntended")
    return expect.fail("transient suspension has no exact intent")
  const intended = lower.event
  expect(intended.command).toBe("Suspend")
  expect(intended.plannedAttempt.attemptId).toBe(attempts[task])
  const pending = required(
    latestUnsettledPlannedAttemptExecutorCommand(prefix, intended.plannedAttempt),
    "suspension is not unresolved at its intent cursor"
  )
  expect(pending).toEqual(intended)
  const accepted = required(
    latestAcceptedPlannedAttemptExecutorEvidence(prefix, intended.plannedAttempt),
    "suspension has no accepted prior lifecycle"
  )
  expect(accepted.report._tag).toBe("ExecutorWorkExecuting")
}

const assertResumedB = (
  prefix: ReadonlyArray<JournalRecord>,
  lower: JournalRecord,
  run: AuthoredScenarioCassetteRun
) => {
  if (lower.event._tag !== "PlannedAttemptExecutorWorkReported")
    return expect.fail("DS13 lower fence is not accepted lifecycle")
  const report = lower.event.report
  expect(report).toMatchObject({
    _tag: "ExecutorWorkExecuting",
    correlation: { attemptId: attempts.B, runId: run.runId }
  })
  const response = required(
    prefix.findLast(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandResponseObserved" && event.plannedAttempt.attemptId === attempts.B
    ),
    "DS13 exact Resume response missing"
  )
  if (response.event._tag !== "PlannedAttemptExecutorCommandResponseObserved")
    return expect.fail("DS13 response anchor changed")
  expect(response.event.report).toEqual(report)
  expect(response.position).toBeLessThan(lower.position)
  const ordinal = response.event.commandOrdinal
  const intended = required(
    prefix.find(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.plannedAttempt.attemptId === attempts.B &&
        event.ordinal === ordinal
    ),
    "DS13 exact Resume intent missing"
  )
  expect(intended.event).toMatchObject({ _tag: "PlannedAttemptExecutorCommandIntended", command: "Resume" })
  expect(
    prefix.some(
      ({ event }) => event._tag === "IntegrationResponsibilityBegan" && event.plannedAttempt.attemptId === attempts.A
    )
  ).toBe(false)
  expect(
    deriveUnqueuedAcceptedResults(prefix).filter(({ plannedAttempt }) => plannedAttempt.attemptId === attempts.A)
  ).toHaveLength(1)
}

const assertFixedA = (prefix: ReadonlyArray<JournalRecord>, lower: JournalRecord, row: DeliveryCapstoneJournalRow) => {
  if (lower.event._tag !== "IntegratorSessionFixed") return expect.fail("DS14 lower fence is not fixed session")
  const session = lower.event.correlation
  expect(session.plannedAttempt.attemptId).toBe(attempts.A)
  const started = required(
    deriveIntegrationAdmission(prefix).responsibilities.find(
      (responsibility) => responsibility.plannedAttempt.attemptId === attempts.A
    ),
    "DS14 started integration missing"
  )
  expect(started._tag).toBe("StartedIntegrationResponsibility")
  if (started._tag !== "StartedIntegrationResponsibility")
    return expect.fail("DS14 integration target was not acquired")
  expect(session.plannedAttempt).toEqual(started.plannedAttempt)
  expect(session.queuedAt).toBe(started.queuedAt)
  expect(session.startedAt).toBe(started.startedAt)
  expect(session.acceptedResult).toEqual(started.acceptedResult)
  expect(session.integrationTarget).toEqual(started.integrationTarget)
  const lineage = required(
    prefix.find(({ position }) => position === session.targetLineageObservedAt),
    "DS14 exact target lineage missing"
  )
  expect(lineage.event).toMatchObject({
    _tag: "TargetLineageObserved",
    plannedAttempt: session.plannedAttempt,
    observation: { targetHeadSha: session.expectedTargetHead }
  })
  if (row.before.kind !== "Occurrence" || row.before.capture.occurrence._tag !== "IntegratorRequestReceived")
    return expect.fail("DS14 upper fence is not Integrator request")
  expect(
    normalizeDeclaredIntegratorSession(row.before.capture.occurrence.correlation.session, session.plannedAttempt.runId)
  ).toEqual(session)
}

/** Selects only the supplied durable anchor; no scan for a prefix matching expected state. */
export const assertDeliveryCapstoneJournalCheckpoint = (
  run: AuthoredScenarioCassetteRun,
  row: DeliveryCapstoneJournalRow
): DeliveryCapstoneJournalCheckpoint => {
  const lower = row.after.record
  const prefix = run.records.filter(({ position }) => position <= lower.position)
  const history = reduceWorkflowJournalHistory(run.runId, prefix)
  if (history._tag !== "ValidWorkflowJournalHistory")
    return expect.fail(`DS${row.beat}: exact committed prefix invalid`)
  expect(history.runState.appliedThrough).toBe(lower.position)
  const projection = projectFreshTaskAdmission(run.runId, prefix)
  if (projection._tag !== "FreshTaskAdmissionProjection")
    return expect.fail(`DS${row.beat}: canonical admission projection failed`)
  expect(projection.acceptedAt).toBe(lower.position)
  const capacity = Option.getOrUndefined(history.runState.controlPolicy)?.taskExecutionCapacity
  if (capacity === undefined) return expect.fail(`DS${row.beat}: reconstructed capacity unavailable`)
  expect(capacity).toBe(row.capacity)
  expect(ordered(projection.heldAttempts.map(pair))).toEqual(ordered(expected(run, row.held)))
  const allAttempts = [
    ...journalRetainedExecutorResponsibilitySubjects(history.prefix, run.runId).map(
      ({ plannedAttempt }) => plannedAttempt
    ),
    ...deriveUnqueuedAcceptedResults(history.prefix).map(({ plannedAttempt }) => plannedAttempt),
    ...deriveIntegrationAdmission(history.prefix).responsibilities.map(({ plannedAttempt }) => plannedAttempt)
  ]
  const retainedAttempts = [
    ...new Map(
      allAttempts
        .filter(
          (attempt) =>
            !projection.heldAttempts.some(
              (held) => held.attemptId === attempt.attemptId && held.runId === attempt.runId
            )
        )
        .map((attempt) => [attempt.attemptId, attempt])
    ).values()
  ]
  expect(ordered(retainedAttempts.map(pair))).toEqual(ordered(expected(run, row.retained)))
  for (const task of [...row.held, ...row.retained]) {
    const attempt = required(
      allAttempts.find((attempt) => attempt.attemptId === attempts[task]),
      "exact checkpoint attempt absent"
    )
    const accepted = required(
      latestAcceptedPlannedAttemptExecutorEvidence(prefix, attempt),
      "exact checkpoint lifecycle absent"
    )
    expect(accepted.report._tag).toBe(
      row.held.includes(task)
        ? "ExecutorWorkExecuting"
        : task === "A"
          ? "ExecutorWorkTerminal"
          : "ExecutorWorkSafelySuspended"
    )
  }
  const cursor = TraceCursor.make({ position: lower.position, runId: run.runId })
  const selected = run.preparedTrace.select(cursor)
  if (Result.isFailure(selected)) return expect.fail(`DS${row.beat}: exact prepared cursor unavailable`)
  const trace = selected.success
  const graph = required(trace.graph ?? undefined, `DS${row.beat}: historical graph absent`)
  expect(graph.snapshot.revision).toBe(row.graph)
  const graphRecord = required(
    prefix.find(({ position }) => position === graph.observation.recordedAt),
    "historical graph read outside exact prefix"
  )
  expect(graphRecord.event).toMatchObject({
    _tag: "TaskTrackerFactsObserved",
    operationId: graph.observation.operationId
  })
  if (row.closedC !== undefined)
    expect(graph.snapshot.tasks.find(({ id }) => id === "C")?.lifecycle._tag).toBe(
      row.closedC ? "TerminalWithoutSuccess" : "Open"
    )
  for (const task of row.alice) {
    const attempt = required(
      allAttempts.find((attempt) => attempt.attemptId === attempts[task]),
      "exact choice attempt absent"
    )
    expect(
      required(latestAcceptedPlannedAttemptExecutorEvidence(prefix, attempt), "choice lacks accepted executor state")
        .report._tag
    ).toBe("ExecutorWorkSafelySuspended")
    const specification = required(
      prefix.findLast(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
          event.observation.factFamily.taskId === task
      ),
      "choice lacks exact accepted specification read"
    )
    if (
      specification.event._tag !== "TaskTrackerFactsObserved" ||
      specification.event.observation._tag !== "FocusedTaskWorkSpecificationFacts"
    )
      return expect.fail("choice specification anchor changed")
    expect(specification.event.observation.factFamily.fingerprint).not.toBe(attempt.taskRevision)
    expect(
      prefix.some(
        ({ event }) =>
          event._tag === "AttemptChoiceApplied" && event.subject.plannedAttempt.attemptId === attempt.attemptId
      )
    ).toBe(false)
  }
  if (row.before.kind === "Journal") expect(lower.position).toBeLessThan(row.before.record.position)
  if (row.beat === transient.suspendB || row.beat === transient.suspendC) {
    assertSuspension(prefix, lower, row.beat === transient.suspendB ? "B" : "C")
    if (row.before.kind !== "Occurrence" || row.before.capture.occurrence._tag !== "PlannedAttemptExecutorWorkReported")
      return expect.fail("suspension upper fence is not actual executor response occurrence")
    const occurrence = row.before.capture.occurrence
    expect(occurrence.request).toBe("Suspend")
    if (lower.event._tag !== "PlannedAttemptExecutorCommandIntended") return expect.fail("suspension intent changed")
    const intended = lower.event
    expect(occurrence.report.attemptId).toBe(intended.plannedAttempt.attemptId)
    const response = required(
      run.records.find(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
          event.plannedAttempt.attemptId === intended.plannedAttempt.attemptId &&
          event.commandOrdinal === intended.ordinal
      ),
      "actual suspension response durable identity absent"
    )
    expect(response.position).toBeGreaterThan(lower.position)
    expect(response.event).toMatchObject({
      report: {
        _tag: occurrence.report._tag,
        correlation: { attemptId: occurrence.report.attemptId, runId: run.runId }
      }
    })
  }
  if (row.beat === transient.resumedB) assertResumedB(prefix, lower, run)
  if (row.beat === transient.fixedA) assertFixedA(prefix, lower, row)
  if (row.beat === transient.startedSuccessors) {
    const settled = prefix.flatMap(({ event }) =>
      event._tag === "IntegrationFinalitySettled" ? [pair(event.claim.plannedAttempt)] : []
    )
    expect(ordered(settled)).toEqual(ordered(expected(run, ["A", "B", "C", "D"])))
    if (
      row.before.kind !== "Occurrence" ||
      row.before.capture.occurrence._tag !== "PlannedAttemptExecutorPassiveLifecycleChanged"
    )
      return expect.fail("DS21 upper fence is not E terminal occurrence")
    expect(row.before.capture.occurrence.report).toMatchObject({ _tag: "ExecutorWorkTerminal", attemptId: attempts.E })
    for (const task of row.held) {
      const response = required(
        prefix.find(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
            event.plannedAttempt.attemptId === attempts[task]
        ),
        "DS21 exact Begin response absent"
      )
      if (response.event._tag !== "PlannedAttemptExecutorCommandResponseObserved")
        return expect.fail("DS21 response witness changed")
      const ordinal = response.event.commandOrdinal
      expect(
        required(
          prefix.find(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandIntended" &&
              event.plannedAttempt.attemptId === attempts[task] &&
              event.ordinal === ordinal
          ),
          "DS21 exact Begin intent absent"
        ).event
      ).toMatchObject({ command: "Begin" })
      const accepted = required(
        prefix.find(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === attempts[task]
        ),
        "DS21 accepted Begin lifecycle absent"
      )
      if (accepted.event._tag !== "PlannedAttemptExecutorWorkReported")
        return expect.fail("DS21 accepted lifecycle changed")
      expect(accepted.event.report).toEqual(response.event.report)
      expect(accepted.position).toBeGreaterThan(response.position)
    }
  }
  if (row.beat === transient.lowered) {
    expect(lower.event).toMatchObject({ _tag: "TaskWorkCapacityChanged", capacity })
    if (row.before.kind !== "Occurrence" || row.before.capture.occurrence._tag !== "CoordinatorProcessDies")
      return expect.fail("DS07 upper fence is not exact process death")
    expect(projection.heldAttempts.length).toBeGreaterThan(capacity)
    const changed = required(
      run.observationCaptures.find(
        (capture) =>
          capture._tag === "AuthoredStoryOccurrenceCaptured" &&
          capture.occurrence._tag === "SetTaskExecutionCapacity" &&
          capture.occurrence.capacity === capacity
      ),
      "DS07 actual capacity instruction not captured"
    )
    expect(changed.captureOrder).toBeLessThan(row.before.capture.captureOrder)
  }
  return {
    _tag: "JournalCheckpoint",
    beat: row.beat,
    capacity,
    cursor,
    heldAttempts: projection.heldAttempts,
    retainedAttempts,
    trace
  }
}
