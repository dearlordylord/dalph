import { strict as assert } from "node:assert"
import { Schema } from "effect"
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

assert.equal(projection.identity.responsibilityCount, 1)
assert.equal(projection.identity.authorizationCount, 1)
assert.deepEqual(projection.identity.plannedAttemptIds, [projection.attemptId])
assert.deepEqual(projection.identity.executorInvocationIds, [])
assert.deepEqual(projection.identity.recoveryEventTags, [])
assert.deepEqual(projection.identity.coarseResponsibilityCorrelations, [`${projection.runId}/${projection.attemptId}`])

const records = continuationAuthorizationJournalRecordsOf(result)
assert.equal(records.length, result.journalRecordCount)
const witness = projection.authorization.witness
const plannedAttempt = projection.plannedAttempt
const authorizationPrefixRecords = records.filter(({ position }) => position <= projection.authorization.position)
const authorizedDecision = continuationAuthorizationContactDecision(authorizationPrefixRecords, plannedAttempt, witness)
assert.equal(authorizedDecision._tag, "ExecutorContactAvailable", "fresh witnesses must permit the existing executor contact")
const staleGraphObservationOperationId = records.flatMap(({ event }) =>
  event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "CompleteTaskTrackerFacts"
    ? [event.operationId]
    : []
)[0] ?? "missing-stale-graph-observation"

const decisions = [
  {
    name: "missing",
    records,
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
    records: authorizationPrefixRecords,
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
    records: records.filter(({ position }) => position <= JournalPosition.make(26)).map((record) => {
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
      records.filter(({ position }) => position <= JournalPosition.make(26)).map((record) => {
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
  const decision = continuationAuthorizationContactDecision(variantRecords, plannedAttempt, variantWitness)
  assert.equal(decision._tag, "ExecutorContactUnavailable", `${name} witness must fail closed`)
  if (decision._tag === "ExecutorContactUnavailable") {
    assert.equal(decision.executorContact, "Unavailable")
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
