import { strict as assert } from "node:assert"
import { Schema } from "effect"
import { coordinatorProcessDeathContinuesAuthoredCassette } from "../../../packages/dalph/src/cassettes/catalog.ts"
import { AttemptId } from "../../../packages/contracts/src/planned-attempt.ts"
import { TaskId } from "../../../packages/contracts/src/task-identity.ts"
import { JournalPosition } from "../../../packages/orchestrator/src/workflow-journal/identity.ts"
import { JournalRecord } from "../../../packages/orchestrator/src/workflow-journal/store.ts"
import { OperationId } from "../../../packages/orchestrator/src/workflow/identity.ts"
import {
  continuationAuthorizationContactDecision,
  continuationAuthorizationJournalRecordsOf,
  continuationAuthorizationProjectionOf
} from "./continuation-authorization-lab.ts"
import { runMaintainedCassette } from "./cassette-lab.ts"
import { continuationAuthorizationSummaryItems } from "./cassette-lab-view.ts"

const cassetteKey = "authored:coordinatorProcessDeathContinues" as const

const result = await runMaintainedCassette(cassetteKey)
if (result._tag !== "Completed") throw new Error(result.detail)

const projection = continuationAuthorizationProjectionOf(result)
assert.notEqual(projection, null)
if (projection === null) throw new Error("The maintained recovery cassette must expose continuation prefixes")

assert.equal(projection.catalogKey, cassetteKey)
assert.equal(projection.runId, result.runId)
assert.equal(projection.attemptId, "attempt:A:0")
assert.deepEqual(
  projection.prefixes.map(({ _tag }) => _tag),
  ["BeforeAuthorization", "AfterAuthorizationBeforeReport", "AfterTerminal"]
)
const beforeAuthorization = projection.prefixes.find(({ _tag }) => _tag === "BeforeAuthorization")
assert.notEqual(beforeAuthorization, undefined)
if (beforeAuthorization === undefined) throw new Error("The pre-authorization prefix is missing")
assert.equal(beforeAuthorization.throughPosition, 25)
assert.equal(beforeAuthorization.authorizationPosition, null)
assert.equal(beforeAuthorization.executorReport, null)
assert.equal(beforeAuthorization.witnesses?.activeTask.graph.intentPosition, 16)
assert.equal(beforeAuthorization.witnesses?.activeTask.graph.observationPosition, 17)
assert.equal(beforeAuthorization.witnesses?.activeTask.specification.intentPosition, 18)
assert.equal(beforeAuthorization.witnesses?.activeTask.specification.observationPosition, 19)
assert.equal(beforeAuthorization.witnesses?.activeTask.claim.intentPosition, 20)
assert.equal(beforeAuthorization.witnesses?.activeTask.claim.observationPosition, 21)
assert.equal(beforeAuthorization.witnesses?.worktree.intentPosition, 22)
assert.equal(beforeAuthorization.witnesses?.worktree.observationPosition, 23)

const afterAuthorization = projection.prefixes.find(({ _tag }) => _tag === "AfterAuthorizationBeforeReport")
assert.notEqual(afterAuthorization, undefined)
if (afterAuthorization === undefined) throw new Error("The post-authorization prefix is missing")
assert.equal(afterAuthorization.throughPosition, 26)
assert.equal(afterAuthorization.authorizationPosition, 26)
assert.equal(afterAuthorization.executorReport, null)
assert.equal(afterAuthorization.runId, projection.runId)
assert.equal(afterAuthorization.attemptId, projection.attemptId)

const terminal = projection.prefixes.find(({ _tag }) => _tag === "AfterTerminal")
assert.notEqual(terminal, undefined)
if (terminal === undefined) throw new Error("The terminal prefix is missing")
assert.deepEqual(terminal.executorReport, { _tag: "Terminal", position: 28 })
assert.equal(terminal.authorizationPosition, 26)
assert.equal(terminal.runId, projection.runId)
assert.equal(terminal.attemptId, projection.attemptId)
assert.deepEqual(projection.executorBoundary, { _tag: "ExecutorReportObserved", position: 28 })

assert.equal(projection.identity.responsibilityCount, 1)
assert.equal(projection.identity.authorizationCount, 1)
assert.deepEqual(projection.identity.plannedAttemptIds, [projection.attemptId])
assert.deepEqual(projection.identity.plannedAttemptCorrelations, [{ runId: projection.runId, attemptId: projection.attemptId }])
assert.deepEqual(projection.identity.responsibilityCorrelations, [{ runId: projection.runId, attemptId: projection.attemptId }])
assert.deepEqual(projection.identity.authorizationCorrelations, [{ runId: projection.runId, attemptId: projection.attemptId }])
assert.deepEqual(projection.identity.reportCorrelations, [{ runId: projection.runId, attemptId: projection.attemptId }])

const records = continuationAuthorizationJournalRecordsOf(result)
assert.equal(records.length, result.journalRecordCount)
const replacementAttempt = { ...projection.plannedAttempt, attemptId: AttemptId.make("attempt:A:replacement") }
const replacementRecords: Array<unknown> = records.flatMap<unknown>((record): ReadonlyArray<unknown> => {
  if (record.event._tag === "TaskAttemptPlanned") {
    return [{ ...record, position: JournalPosition.make(record.position + 1), event: { ...record.event, operation: { ...record.event.operation, plannedAttempt: replacementAttempt } } }]
  }
  if (record.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
    return [{ ...record, position: JournalPosition.make(record.position + 1), event: { ...record.event, plannedAttempt: replacementAttempt } }]
  }
  if (record.event._tag === "PlannedAttemptContinuationAuthorized") {
    return [{ ...record, position: JournalPosition.make(record.position + 1), event: { ...record.event, plannedAttempt: replacementAttempt } }]
  }
  if (record.event._tag === "PlannedAttemptExecutorWorkReported") {
    return [{
      ...record,
      position: JournalPosition.make(record.position + 1),
      event: {
        ...record.event,
        report: {
          ...record.event.report,
          correlation: { ...record.event.report.correlation, attemptId: replacementAttempt.attemptId }
        }
      }
    }]
  }
  return []
})
const identityProjection = continuationAuthorizationProjectionOf({
  ...result,
  journalRecordCount: result.journalRecordCount + replacementRecords.length,
  journalRecords: [...result.journalRecords, ...replacementRecords]
})
assert.notEqual(identityProjection, null)
if (identityProjection === null) throw new Error("The replacement-attempt identity fixture must remain projectable")
assert.equal(identityProjection.identity.plannedAttemptCorrelations.length, 2)
assert.equal(identityProjection.identity.responsibilityCorrelations.length, 2)
assert.equal(identityProjection.identity.authorizationCorrelations.length, 2)
assert.equal(identityProjection.identity.reportCorrelations.length, 2)
assert.deepEqual(identityProjection.identity.plannedAttemptIds, [projection.attemptId, replacementAttempt.attemptId])
const identitySummary = continuationAuthorizationSummaryItems(identityProjection).find(({ term }) => term === "Identity check")
assert.notEqual(identitySummary, undefined)
if (identitySummary === undefined) throw new Error("The replacement-attempt identity summary is missing")
for (const family of [
  "TaskAttemptPlanned",
  "Responsibility",
  "Authorization",
  "Executor report"
] as const) {
  const familySummary: string | undefined = identitySummary.description
    .split(" · ")
    .find((segment) => segment.startsWith(`${family}:`))
  assert.notEqual(familySummary, undefined)
  if (familySummary === undefined) continue
  assert.equal(familySummary.includes(`Run ${projection.runId} / attempt ${projection.attemptId}`), true)
  assert.equal(familySummary.includes(`Run ${projection.runId} / attempt ${replacementAttempt.attemptId}`), true)
}
const witness = projection.authorization.witness
const plannedAttempt = projection.plannedAttempt
const preAuthorizationRecords = records.filter(({ position }) => position <= beforeAuthorization.throughPosition)
const executorBoundaryEvidenceTags = new Set([
  "PlannedAttemptExecutorWorkReported",
  "PlannedAttemptExecutorCommandIntended"
])
assert.equal(preAuthorizationRecords.some(({ event }) => executorBoundaryEvidenceTags.has(event._tag)), false)
const authorizedDecision = continuationAuthorizationContactDecision(preAuthorizationRecords, plannedAttempt, witness)
assert.equal(authorizedDecision._tag, "ExecutorContactAvailable", "fresh witnesses must permit the existing executor command gate")
if (authorizedDecision._tag === "ExecutorContactAvailable") {
  assert.deepEqual(authorizedDecision.executorBoundary, { _tag: "NoCommandIntent" })
}
const observedExecutorReportDecision = continuationAuthorizationContactDecision(records, plannedAttempt, witness)
assert.equal(observedExecutorReportDecision._tag, "ExecutorContactUnavailable")
if (observedExecutorReportDecision._tag === "ExecutorContactUnavailable") {
  assert.deepEqual(observedExecutorReportDecision.executorBoundary, { _tag: "ExecutorReportObserved", position: 28 })
}
const commandIntentOnlyDecision = continuationAuthorizationContactDecision(
  records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended"),
  plannedAttempt,
  witness
)
assert.equal(commandIntentOnlyDecision._tag, "ExecutorContactUnavailable")
if (commandIntentOnlyDecision._tag === "ExecutorContactUnavailable") {
  assert.deepEqual(commandIntentOnlyDecision.executorBoundary, { _tag: "CommandIntentRecorded", position: 27 })
}
assert.equal(
  coordinatorProcessDeathContinuesAuthoredCassette.story.some(({ _tag }) => _tag === "CoordinatorProcessDies"),
  true,
  "The exact authored lifecycle control must remain in the cassette story"
)
assert.equal(records.some(({ event }) => String(event._tag) === "CoordinatorProcessDies"), false)
const staleGraphObservationOperationId = records.flatMap(({ event }) =>
  event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "CompleteTaskTrackerFacts"
    ? [event.operationId]
    : []
)[0] ?? "missing-stale-graph-observation"

const decisions = [
  {
    name: "missing",
    records: preAuthorizationRecords,
    witness: {
      ...witness,
      activeTaskContinuationRead: {
        ...witness.activeTaskContinuationRead,
        graphObservationOperationId: OperationId.make("missing-graph-observation")
      }
    }
  },
  {
    name: "stale",
    records: preAuthorizationRecords,
    witness: {
      ...witness,
      activeTaskContinuationRead: {
        ...witness.activeTaskContinuationRead,
        graphObservationOperationId: OperationId.make(staleGraphObservationOperationId)
      }
    }
  },
  {
    name: "later",
    records: preAuthorizationRecords.map((record) => {
      if (
        record.event._tag === "TaskTrackerReadIntentRecorded"
        && record.event.operation._tag === "ReadTrackerGraph"
        && record.event.operation.operationId === witness.activeTaskContinuationRead.graphObservationOperationId
      ) {
        return { ...record, position: JournalPosition.make(18) }
      }
      return record
    }),
    witness
  },
  {
    name: "wrong-attempt",
    records: Schema.decodeUnknownSync(Schema.Array(JournalRecord))(
      preAuthorizationRecords.map((record) => {
        if (
          record.event._tag === "GitReadIntentRecorded"
          && record.event.operation._tag === "ReadTaskWorktree"
          && record.event.operation.operationId === witness.worktreeObservationOperationId
        ) {
          return {
            ...record,
            event: {
              ...record.event,
              operation: {
                ...record.event.operation,
                plannedAttempt: {
                  ...record.event.operation.plannedAttempt,
                  taskId: TaskId.make("foreign-task")
                }
              }
            }
          }
        }
        return record
      })
    ),
    witness
  }
] as const

for (const { name, records: variantRecords, witness: variantWitness } of decisions) {
  assert.equal(variantRecords.some(({ event }) => executorBoundaryEvidenceTags.has(event._tag)), false, `${name} fixture must stop before executor contact evidence`)
  const decision = continuationAuthorizationContactDecision(variantRecords, plannedAttempt, variantWitness)
  assert.equal(decision._tag, "ExecutorContactUnavailable", `${name} witness must fail closed`)
  if (decision._tag === "ExecutorContactUnavailable") {
    assert.equal(decision.executorContact, "Unavailable")
    assert.deepEqual(decision.executorBoundary, { _tag: "NoCommandIntent" })
    assert.equal(
      decision.evaluation.reason,
      {
        missing: "MissingWitness",
        stale: "StaleWitness",
        later: "LaterWitness",
        "wrong-attempt": "WrongAttemptWitness"
      }[name]
    )
  }
}

console.log("✓ projects maintained continuation prefixes and fails invalid witnesses closed")
