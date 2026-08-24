// @effect-diagnostics unnecessaryEffectGen:off
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { it } from "@effect/vitest"
import { Cause, ConfigProvider, Deferred, Effect, FileSystem, Fiber, Layer, Path } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as SqlError from "effect/unstable/sql/SqlError"
import { describe, expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import {
  FixtureTarget,
  CoordinatorOwnership,
  InitialControlPolicy,
  JournalDatabaseLocator,
  JournalPosition,
  JournalRecordKey,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  JournalHistoryNotTerminal,
  JournalDataCorruption,
  JournalHistoryCorruption,
  JournalPartitionContradiction,
  JournalStore,
  JournalStoreContradiction,
  TaskClaimAcquisition,
  memoryJournalTestLayer,
  OperationId,
  sqliteJournalTestLayer,
  productionJournalStoreLayer,
  TaskWorkCapacity,
  taskTrackerReadIntent,
  WorkflowRunAlreadyBegan,
  WorkflowRunAlreadyTerminated,
  WorkflowRunIdentityAlreadyUsed,
  WorkflowRunNotBegan,
  WorkflowRunTerminationEvidenceInvalid,
  WorkflowRunTargetMismatch,
  WorkflowOperation
} from "../index.js"
import { classifyJournalStorageFailure } from "./adapters/sqlite-store.js"
import { completedRunFinalityFixture } from "../../test/run-finality.js"
import { validSnapshot } from "../../test/task-dag.js"
import {
  controlDirectionAppliedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  runCancellationAppliedRecordKey
} from "./record-key.js"
import { ActiveTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import {
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent
} from "../workflow/registry/event.js"
import { RunCancellationAppliedEvent } from "../workflow/protocols/run-cancellation/events.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../workflow/task-tracker-facts/observation.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTrackerGraphObservationOperation
} from "../workflow/registry/operation.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { makeRunFinalityEvidence } from "../coordination/frontier/run-finality.js"
import { makeWorkflowRunBeganRecord, makeWorkflowRunTerminatedRecord } from "./run-lifecycle.js"
import { memoryJournalTestLayerFromPartitionRecords } from "./adapters/memory-store.js"
import { encodeJournalEvent } from "./event-codec.js"
import type { JournalRecord } from "./store.js"
import { makeTraceReader } from "../presentation/trace-reader.js"
import {
  ControlDirectionApplicationOrdinal,
  ControlDirectionAppliedEvent
} from "../workflow/protocols/control-direction-application/events.js"

const nodePathAndFileSystemLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })

const withTemporaryDatabase = <A, E, R>(
  use: (filename: JournalDatabaseLocator, directory: string) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-journal-test-" })
    return yield* use(JournalDatabaseLocator.make(path.join(directory, "journal.sqlite")), directory)
  }).pipe(Effect.provide(nodePathAndFileSystemLayer))

const withSqliteClient = <A, E, R>(
  filename: JournalDatabaseLocator,
  use: (sql: SqliteClient.SqliteClient) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqliteClient.make({ filename })
      return yield* use(sql)
    }).pipe(Effect.provide(Reactivity.layer))
  )

const seedSchemaV1 = (filename: JournalDatabaseLocator, record: JournalRecord) => {
  const encoded = encodeJournalEvent(record.event)
  return withSqliteClient(filename, (sql) =>
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE effect_sql_migrations (
          migration_id INTEGER PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (1, 'create_current_journal_records')`
      yield* sql`PRAGMA user_version = 1`
      yield* sql`
        CREATE TABLE journal_records (
          run_id TEXT NOT NULL,
          position INTEGER NOT NULL CHECK (position >= 1),
          record_key TEXT NOT NULL,
          event_kind TEXT NOT NULL,
          event_version INTEGER NOT NULL CHECK (event_version >= 1),
          payload_json TEXT NOT NULL,
          PRIMARY KEY (run_id, position),
          UNIQUE (run_id, record_key)
        ) STRICT
      `
      yield* sql`
        INSERT INTO journal_records
          (run_id, position, record_key, event_kind, event_version, payload_json)
        VALUES (${record.runId}, ${record.position}, ${record.key}, ${encoded.kind}, ${encoded.version}, ${encoded.payloadJson})
      `
    })
  )
}

const intent = (operationId: string, taskId: string) =>
  taskTrackerReadIntent(
    WorkflowOperation.cases.ReadTrackerGraph.make({
      operationId: OperationId.make(operationId),
      predecessorOperationIds: [],
      readShape: { _tag: "CompleteTargetClosure", explicitlyCoveredTaskIds: [] },
      target: FixtureTarget.make(taskId)
    })
  )

const appendTerminalDisposition = (
  journal: JournalStore["Service"],
  runId: RunId,
  target: ReturnType<typeof FixtureTarget.make>,
  disposition: "Completed" | "Blocked" | "Cancelled"
) => {
  const operation = makeTrackerGraphObservationOperation(
    OperationId.make(`retirement-disposition:${disposition}:${runId}`),
    target
  )
  const snapshot = validSnapshot({
    revision: `retirement-disposition:${disposition}:${runId}`,
    rootTaskId: "root",
    tasks: [
      {
        id: "root",
        lifecycle: {
          _tag:
            disposition === "Completed"
              ? "CompletedSuccessfully"
              : disposition === "Blocked"
                ? "TerminalWithoutSuccess"
                : "Open"
        },
        parentTaskId: null,
        prerequisiteIds: []
      }
    ]
  })
  const cancellation =
    disposition === "Cancelled"
      ? RunCancellationAppliedEvent.make({
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          version: workflowJournalEventVersion
        })
      : undefined
  const observedAt = cancellation === undefined ? 3 : 4
  const evidence = makeRunFinalityEvidence({
    observedAt: JournalPosition.make(observedAt),
    operationId: operation.operationId,
    readShape: operation.readShape,
    rootTaskId: TaskId.make("root"),
    runId,
    snapshot,
    target
  })
  return Effect.gen(function* () {
    if (cancellation !== undefined) yield* journal.append(runId, runCancellationAppliedRecordKey, cancellation)
    yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      taskTrackerFactsObservedEvent(operation.operationId, makeCompleteTaskTrackerFactsObserved(operation, snapshot))
    )
    return yield* journal.terminateRun(runId, disposition, evidence)
  })
}

const terminalRecordsFor = (runId: RunId, target: ReturnType<typeof FixtureTarget.make>) => {
  const fixture = completedRunFinalityFixture({ runId, target })
  return [
    makeWorkflowRunBeganRecord(runId, target, initialPolicy),
    {
      event: fixture.intent,
      key: intentRecordKey(fixture.operation.operationId),
      position: JournalPosition.make(2),
      runId
    },
    {
      event: fixture.observation,
      key: outcomeRecordKey(fixture.operation.operationId),
      position: JournalPosition.make(3),
      runId
    },
    makeWorkflowRunTerminatedRecord(runId, JournalPosition.make(4), "Completed", fixture.evidence)
  ]
}

it.effect("opens the configured production journal only with coordinator ownership", () =>
  Effect.scoped(
    withTemporaryDatabase((filename) =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const runId = RunId.make("production-journal-composition")
        const began = yield* journal.beginRun(runId, FixtureTarget.make("production-target"), initialPolicy)

        expect(began.runId).toBe(runId)
      }).pipe(
        Effect.provide(productionJournalStoreLayer),
        Effect.provideService(
          CoordinatorOwnership,
          CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
        ),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )
    )
  )
)

it.effect("maps a controlled malformed memory terminal prefix to journal corruption", () => {
  const runId = RunId.make("memory-controlled-malformed-retirement")
  const target = FixtureTarget.make("memory-controlled-malformed-retirement-target")
  const valid = terminalRecordsFor(runId, target)
  const malformed = valid.map((record, index) =>
    index === valid.length - 1 ? { ...record, position: JournalPosition.make(5) } : record
  )
  return Effect.gen(function* () {
    const journal = yield* JournalStore
    const failure = yield* Effect.flip(journal.retireTerminalRun(runId))
    expect(failure).toBeInstanceOf(JournalHistoryCorruption)
    expect(failure).toMatchObject({ partition: "Hot", runId })
    expect(yield* journal.read(runId)).toEqual(malformed)
    expect(yield* journal.scanHot()).toMatchObject({
      issues: [expect.objectContaining({ _tag: "JournalSemanticIssue", partition: "Hot", runId })],
      runs: []
    })
    expect((yield* journal.auditAll()).issues).toContainEqual(expect.objectContaining({ partition: "Hot", runId }))
  }).pipe(Effect.provide(memoryJournalTestLayerFromPartitionRecords({ hot: malformed })))
})

it.effect(
  "isolates controlled cold corruption from memory startup discovery and reports it to exact reads and audits",
  () => {
    const runId = RunId.make("memory-controlled-cold-corruption")
    const target = FixtureTarget.make("memory-controlled-cold-corruption-target")
    const valid = terminalRecordsFor(runId, target)
    const malformed = valid.map((record, index) =>
      index === valid.length - 1 ? { ...record, position: JournalPosition.make(5) } : record
    )
    return Effect.gen(function* () {
      const journal = yield* JournalStore
      expect(yield* journal.scanHot()).toEqual({ issues: [], runs: [] })
      const readFailure = yield* Effect.flip(journal.read(runId))
      expect(readFailure).toMatchObject({
        _tag: "JournalHistoryCorruption",
        operation: "JournalStore.read",
        partition: "Cold",
        runId
      })
      const recoveryFailure = yield* Effect.flip(journal.readRunForRecovery(runId, target))
      expect(recoveryFailure).toMatchObject({
        _tag: "JournalHistoryCorruption",
        operation: "JournalStore.readRunForRecovery",
        partition: "Cold",
        runId
      })
      const audit = yield* journal.auditAll()
      expect(audit.issues).toMatchObject([{ _tag: "JournalSemanticIssue", partition: "Cold", runId }])
      expect(yield* Effect.flip(journal.retireTerminalRun(runId))).toMatchObject({
        _tag: "JournalHistoryCorruption",
        operation: "JournalStore.retireTerminalRun",
        partition: "Cold",
        runId
      })
    }).pipe(Effect.provide(memoryJournalTestLayerFromPartitionRecords({ cold: malformed })))
  }
)

it.effect("rejects exact reads and recovery of a nonterminal memory Cold history", () => {
  const runId = RunId.make("memory-nonterminal-cold-read")
  const target = FixtureTarget.make("memory-nonterminal-cold-read-target")
  const records = [makeWorkflowRunBeganRecord(runId, target, initialPolicy)]
  return Effect.gen(function* () {
    const journal = yield* JournalStore
    const fixture = completedRunFinalityFixture({ runId, target })
    expect(
      yield* Effect.flip(journal.append(runId, JournalRecordKey.make("cold-nonterminal-append"), fixture.intent))
    ).toMatchObject({ _tag: "JournalHistoryCorruption", operation: "JournalStore.append", partition: "Cold", runId })
    const readFailure = yield* Effect.flip(journal.read(runId))
    expect(readFailure).toMatchObject({
      _tag: "JournalHistoryCorruption",
      operation: "JournalStore.read",
      partition: "Cold",
      runId
    })
    const recoveryFailure = yield* Effect.flip(journal.readRunForRecovery(runId, target))
    expect(recoveryFailure).toMatchObject({
      _tag: "JournalHistoryCorruption",
      operation: "JournalStore.readRunForRecovery",
      partition: "Cold",
      runId
    })
  }).pipe(Effect.provide(memoryJournalTestLayerFromPartitionRecords({ cold: records })))
})

it.effect("rejects termination of a semantically complete but nonterminal memory Cold history", () => {
  const runId = RunId.make("memory-nonterminal-cold-terminate")
  const target = FixtureTarget.make("memory-nonterminal-cold-terminate-target")
  const fixture = completedRunFinalityFixture({ runId, target })
  const records = terminalRecordsFor(runId, target).slice(0, 3)
  return Effect.gen(function* () {
    const journal = yield* JournalStore
    expect(yield* Effect.flip(journal.terminateRun(runId, "Completed", fixture.evidence))).toMatchObject({
      _tag: "JournalHistoryCorruption",
      operation: "JournalStore.terminateRun",
      partition: "Cold",
      runId
    })
  }).pipe(Effect.provide(memoryJournalTestLayerFromPartitionRecords({ cold: records })))
})

it.effect("rejects memory retirement when no Run history exists", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const failure = yield* Effect.flip(journal.retireTerminalRun(RunId.make("memory-missing-retirement")))
    expect(failure).toBeInstanceOf(WorkflowRunNotBegan)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("fails every memory operation closed when a Run is in both partitions", () => {
  const runId = RunId.make("memory-contradictory-partitions")
  const target = FixtureTarget.make("memory-contradictory-partitions-target")
  const records = terminalRecordsFor(runId, target)
  return Effect.gen(function* () {
    const journal = yield* JournalStore
    const fixture = completedRunFinalityFixture({ runId, target })
    expect(yield* Effect.flip(journal.read(runId))).toBeInstanceOf(JournalPartitionContradiction)
    expect(yield* Effect.flip(journal.beginRun(runId, target, initialPolicy))).toBeInstanceOf(
      JournalPartitionContradiction
    )
    expect(
      yield* Effect.flip(journal.append(runId, JournalRecordKey.make("contradictory-append"), fixture.intent))
    ).toBeInstanceOf(JournalPartitionContradiction)
    expect(yield* Effect.flip(journal.readRunForRecovery(runId, target))).toBeInstanceOf(JournalPartitionContradiction)
    expect(yield* Effect.flip(journal.auditAll())).toBeInstanceOf(JournalPartitionContradiction)
    expect(yield* Effect.flip(journal.retireTerminalRun(runId))).toBeInstanceOf(JournalPartitionContradiction)
    expect(yield* Effect.flip(journal.terminateRun(runId, "Completed", fixture.evidence))).toBeInstanceOf(
      JournalPartitionContradiction
    )
  }).pipe(Effect.provide(memoryJournalTestLayerFromPartitionRecords({ cold: records, hot: records })))
})

const journalAppendContract = (name: string, makeLayer: () => Layer.Layer<JournalStore, unknown>) => {
  const runId = RunId.make(`run-contract-${name}`)
  const firstKey = JournalRecordKey.make("operation:one:intent")
  const secondKey = JournalRecordKey.make("operation:two:intent")
  const terminateCompleted = (journal: JournalStore["Service"], target: ReturnType<typeof FixtureTarget.make>) =>
    Effect.gen(function* () {
      const fixture = completedRunFinalityFixture({ runId, target })
      yield* journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
      yield* journal.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
      return yield* journal.terminateRun(runId, "Completed", fixture.evidence)
    })

  describe(`${name} JournalStore contract`, () => {
    it.effect("atomically rejects a second beginning for one Run identity", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const target = FixtureTarget.make("single-start-target")
        const began = yield* journal.beginRun(runId, target, initialPolicy)
        const repeated = yield* Effect.flip(journal.beginRun(runId, target, initialPolicy))

        expect(began).toMatchObject({ event: { _tag: "WorkflowRunBegan", target }, position: 1, runId })
        expect(repeated).toBeInstanceOf(WorkflowRunAlreadyBegan)
        expect(repeated).toMatchObject({ beganAt: 1, runId })
        expect(yield* journal.read(runId)).toEqual([began])
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("rejects every workflow record after Run termination", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const target = FixtureTarget.make("terminated-target")
        yield* journal.beginRun(runId, target, initialPolicy)
        const terminated = yield* terminateCompleted(journal, target)
        const failure = yield* Effect.flip(journal.append(runId, firstKey, intent("one", "task-1")))

        expect(terminated).toMatchObject({
          event: { _tag: "WorkflowRunTerminated", disposition: "Completed" },
          position: 4,
          runId
        })
        expect(failure).toBeInstanceOf(WorkflowRunAlreadyTerminated)
        expect(failure).toMatchObject({ runId, terminatedAt: 4 })
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("atomically retires every valid terminal history and keeps reads transparent", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const target = FixtureTarget.make("retirement-target")
        const began = yield* journal.beginRun(runId, target, initialPolicy)
        const terminated = yield* terminateCompleted(journal, target)
        const before = yield* journal.read(runId)

        const retired = yield* journal.retireTerminalRun(runId)

        expect(retired).toMatchObject({ _tag: "Retired", from: "Hot", to: "Cold", runId })
        expect(yield* journal.read(runId)).toEqual(before)
        expect(yield* journal.scanHot()).toEqual({ issues: [], runs: [] })
        expect(yield* journal.auditAll()).toMatchObject({
          issues: [],
          runs: [{ partition: "Cold", runId, records: before }]
        })
        expect(yield* journal.retireTerminalRun(runId)).toMatchObject({
          _tag: "AlreadyRetired",
          partition: "Cold",
          runId
        })
        expect(yield* Effect.flip(journal.beginRun(runId, target, initialPolicy))).toBeInstanceOf(
          WorkflowRunAlreadyBegan
        )
        expect(yield* Effect.flip(journal.readRunForRecovery(runId, target))).toBeInstanceOf(
          WorkflowRunAlreadyTerminated
        )
        expect(
          yield* Effect.flip(journal.append(runId, firstKey, intent("after-retirement", "task-1")))
        ).toBeInstanceOf(WorkflowRunAlreadyTerminated)
        expect(terminated.event._tag).toBe("WorkflowRunTerminated")
        expect(began.event._tag).toBe("WorkflowRunBegan")
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("rejects unfinished, paused, temporarily quiescent, quarantined, and merely old histories", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const conditions = [
          { name: "unfinished", prefix: "intent-pending", selectorFact: "OrdinaryRecovery" },
          { name: "paused", prefix: "pause-applied", selectorFact: "OrdinaryRecovery" },
          { name: "temporarily-quiescent", prefix: "operation-settled", selectorFact: "OrdinaryRecovery" },
          { name: "quarantined", prefix: "intent-pending", selectorFact: "ExternalQuarantine" },
          { name: "merely-old", prefix: "began-only-with-no-clock-fact", selectorFact: "OrdinaryRecovery" }
        ] as const
        for (const condition of conditions) {
          const conditionRunId = RunId.make(`nonterminal-retirement-${name}-${condition.name}`)
          const target = FixtureTarget.make(`nonterminal-retirement-target-${condition.name}`)
          yield* journal.beginRun(conditionRunId, target, initialPolicy)
          const fixture = completedRunFinalityFixture({ runId: conditionRunId, target })
          if (condition.prefix === "intent-pending" || condition.prefix === "operation-settled") {
            yield* journal.append(conditionRunId, intentRecordKey(fixture.operation.operationId), fixture.intent)
          }
          if (condition.prefix === "operation-settled") {
            yield* journal.append(conditionRunId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
          }
          if (condition.prefix === "pause-applied") {
            const ordinal = ControlDirectionApplicationOrdinal.make(1)
            yield* journal.append(
              conditionRunId,
              controlDirectionAppliedRecordKey(ordinal),
              ControlDirectionAppliedEvent.make({
                direction: "Pause",
                initiatedBy: { _tag: "Operator" },
                occurrenceClassification: "InitiatedAction",
                ordinal,
                subject: { _tag: "Run", runId: conditionRunId },
                version: workflowJournalEventVersion
              })
            )
          }
          const before = yield* journal.read(conditionRunId)
          // Quarantine selects this Run outside JournalStore. The store has no
          // quarantine parameter and must decide only from the exact prefix.
          if (condition.selectorFact === "ExternalQuarantine") expect(condition.name).toBe("quarantined")
          // Merely old has no distinct Journal occurrence or Clock boundary:
          // retirement receives only the Run identity and the complete prefix.
          if (condition.prefix === "began-only-with-no-clock-fact") expect(before).toHaveLength(1)
          expect(yield* Effect.flip(journal.retireTerminalRun(conditionRunId))).toBeInstanceOf(
            JournalHistoryNotTerminal
          )
          expect(yield* journal.read(conditionRunId)).toEqual(before)
          expect((yield* journal.scanHot()).runs).toContainEqual(expect.objectContaining({ runId: conditionRunId }))
          expect((yield* journal.auditAll()).runs).toContainEqual(
            expect.objectContaining({ partition: "Hot", runId: conditionRunId })
          )
        }
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("retires Completed, Blocked, and Cancelled histories without rewriting disposition evidence", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        for (const disposition of ["Completed", "Blocked", "Cancelled"] as const) {
          const dispositionRunId = RunId.make(`retirement-disposition-${name}-${disposition}`)
          const target = FixtureTarget.make(`retirement-disposition-target-${name}-${disposition}`)
          yield* journal.beginRun(dispositionRunId, target, initialPolicy)
          const terminated = yield* appendTerminalDisposition(journal, dispositionRunId, target, disposition)
          const before = yield* journal.read(dispositionRunId)
          const retired = yield* journal.retireTerminalRun(dispositionRunId)
          const after = yield* journal.read(dispositionRunId)

          expect(terminated.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition })
          expect(retired).toMatchObject({ _tag: "Retired", from: "Hot", to: "Cold", runId: dispositionRunId })
          expect(after).toEqual(before)
          expect(after.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition })
        }
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("rereads the exact begun target before recovering a Run", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const target = FixtureTarget.make("recoverable-target")
        const began = yield* journal.beginRun(runId, target, initialPolicy)

        expect(yield* journal.readRunForRecovery(runId, target)).toEqual(began)
        const mismatch = yield* Effect.flip(journal.readRunForRecovery(runId, FixtureTarget.make("different-target")))
        expect(mismatch).toBeInstanceOf(WorkflowRunTargetMismatch)
        expect(mismatch).toMatchObject({ recordedTarget: target, requestedTarget: "different-target", runId })
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("rejects recovery and termination when no Run beginning exists", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const target = FixtureTarget.make("never-began-target")

        expect(yield* Effect.flip(journal.readRunForRecovery(runId, target))).toBeInstanceOf(WorkflowRunNotBegan)
        const fixture = completedRunFinalityFixture({ runId, target })
        expect(yield* Effect.flip(journal.terminateRun(runId, "Completed", fixture.evidence))).toBeInstanceOf(
          WorkflowRunNotBegan
        )
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("preserves typed invalid-evidence failures at the storage boundary", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const target = FixtureTarget.make("invalid-evidence-target")
        yield* journal.beginRun(runId, target, initialPolicy)
        const fixture = completedRunFinalityFixture({ runId, target })

        const failure = yield* Effect.flip(
          journal.terminateRun(runId, "Completed", { ...fixture.evidence, runId: RunId.make(`different-${runId}`) })
        )

        expect(failure).toBeInstanceOf(WorkflowRunTerminationEvidenceInvalid)
        expect(failure).toMatchObject({ runId })
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("rejects unsettled historical responsibility without appending", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const target = FixtureTarget.make("unsettled-responsibility-target")
        yield* journal.beginRun(runId, target, initialPolicy)
        const fixture = completedRunFinalityFixture({ runId, target })
        yield* journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
        yield* journal.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
        const acquisition = TaskClaimAcquisition.make({
          operationId: OperationId.make(`unsettled-claim:${runId}`),
          owner: ClaimOwner.make("dalph"),
          taskId: TaskId.make("root"),
          token: ClaimToken.make(`unsettled-token:${runId}`)
        })
        const claimOperation = makeTaskClaimAcquisitionOperation({
          acquisition,
          predecessorOperationIds: [fixture.operation.operationId]
        })
        yield* journal.append(
          runId,
          intentRecordKey(acquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
        )
        const beforeTermination = yield* journal.read(runId)

        const failure = yield* Effect.flip(journal.terminateRun(runId, "Completed", fixture.evidence))

        expect(failure).toMatchObject({
          _tag: "WorkflowRunTerminationEvidenceInvalid",
          detail: expect.stringContaining("responsibility")
        })
        expect(yield* journal.read(runId)).toEqual(beforeTermination)
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("accepts termination after a historical claim acquisition was rejected", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const target = FixtureTarget.make("settled-responsibility-target")
        yield* journal.beginRun(runId, target, initialPolicy)
        const fixture = completedRunFinalityFixture({ runId, target })
        yield* journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
        yield* journal.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
        const acquisition = TaskClaimAcquisition.make({
          operationId: OperationId.make(`settled-claim:${runId}`),
          owner: ClaimOwner.make("dalph"),
          taskId: TaskId.make("root"),
          token: ClaimToken.make(`settled-token:${runId}`)
        })
        const claimOperation = makeTaskClaimAcquisitionOperation({
          acquisition,
          predecessorOperationIds: [fixture.operation.operationId]
        })
        yield* journal.append(
          runId,
          intentRecordKey(acquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(acquisition.operationId),
          TaskClaimAcquisitionRejectedEvent.make({
            observed: ActiveTaskClaim.make({
              operationId: OperationId.make(`foreign-claim:${runId}`),
              owner: ClaimOwner.make("another-owner"),
              taskId: acquisition.taskId,
              token: ClaimToken.make(`foreign-token:${runId}`)
            }),
            operationId: acquisition.operationId,
            reason: "ForeignClaim",
            version: workflowJournalEventVersion
          })
        )

        const terminated = yield* journal.terminateRun(runId, "Completed", fixture.evidence)

        expect(terminated.event._tag).toBe("WorkflowRunTerminated")
        expect(terminated.position).toBe(6)
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("rejects termination while an exact acquired claim remains active", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const target = FixtureTarget.make("active-claim-target")
        yield* journal.beginRun(runId, target, initialPolicy)
        const fixture = completedRunFinalityFixture({ runId, target })
        yield* journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
        yield* journal.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
        const acquisition = TaskClaimAcquisition.make({
          operationId: OperationId.make(`active-claim:${runId}`),
          owner: ClaimOwner.make("dalph"),
          taskId: TaskId.make("root"),
          token: ClaimToken.make(`active-token:${runId}`)
        })
        const claimOperation = makeTaskClaimAcquisitionOperation({
          acquisition,
          predecessorOperationIds: [fixture.operation.operationId]
        })
        yield* journal.append(
          runId,
          intentRecordKey(acquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(acquisition.operationId),
          TaskClaimAcquiredEvent.make({
            claim: ActiveTaskClaim.make(acquisition),
            version: workflowJournalEventVersion
          })
        )
        const beforeTermination = yield* journal.read(runId)

        const failure = yield* Effect.flip(journal.terminateRun(runId, "Completed", fixture.evidence))

        expect(failure).toMatchObject({
          _tag: "WorkflowRunTerminationEvidenceInvalid",
          detail: expect.stringContaining("responsibility")
        })
        expect(yield* journal.read(runId)).toEqual(beforeTermination)
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("rejects incomparable tracker graph observations without appending", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const target = FixtureTarget.make("incomparable-graph-target")
        yield* journal.beginRun(runId, target, initialPolicy)
        const first = completedRunFinalityFixture({ runId, target })
        yield* journal.append(runId, intentRecordKey(first.operation.operationId), first.intent)
        yield* journal.append(runId, outcomeRecordKey(first.operation.operationId), first.observation)
        const secondOperation = makeTrackerGraphObservationOperation(
          OperationId.make(`incomparable-graph:${runId}`),
          target
        )
        const secondSnapshot = validSnapshot({
          revision: `incomparable-graph:${runId}`,
          rootTaskId: "root",
          tasks: [
            { id: "root", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] },
            { id: "child", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: "root", prerequisiteIds: [] }
          ]
        })
        const secondIntent = taskTrackerReadIntent(secondOperation)
        const secondObservation = taskTrackerFactsObservedEvent(
          secondOperation.operationId,
          makeCompleteTaskTrackerFactsObserved(secondOperation, secondSnapshot)
        )
        yield* journal.append(runId, intentRecordKey(secondOperation.operationId), secondIntent)
        const observed = yield* journal.append(runId, outcomeRecordKey(secondOperation.operationId), secondObservation)
        const evidence = makeRunFinalityEvidence({
          observedAt: observed.position,
          operationId: secondOperation.operationId,
          readShape: secondOperation.readShape,
          rootTaskId: TaskId.make("root"),
          runId,
          snapshot: secondSnapshot,
          target
        })
        const beforeTermination = yield* journal.read(runId)

        const failure = yield* Effect.flip(journal.terminateRun(runId, "Completed", evidence))

        expect(failure).toMatchObject({
          _tag: "WorkflowRunTerminationEvidenceInvalid",
          detail: expect.stringContaining("causally comparable")
        })
        expect(yield* journal.read(runId)).toEqual(beforeTermination)
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("accepts a graph read that causally supersedes historical facts", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const target = FixtureTarget.make("causal-graph-target")
        yield* journal.beginRun(runId, target, initialPolicy)
        const first = completedRunFinalityFixture({ runId, target })
        yield* journal.append(runId, intentRecordKey(first.operation.operationId), first.intent)
        yield* journal.append(runId, outcomeRecordKey(first.operation.operationId), first.observation)
        const secondOperation = makeTrackerGraphObservationOperation(
          OperationId.make(`causal-graph:${runId}`),
          target,
          [first.operation.operationId]
        )
        const secondSnapshot = validSnapshot({
          revision: `causal-graph:${runId}`,
          rootTaskId: "root",
          tasks: [
            { id: "root", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] },
            { id: "child", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: "root", prerequisiteIds: [] }
          ]
        })
        yield* journal.append(
          runId,
          intentRecordKey(secondOperation.operationId),
          taskTrackerReadIntent(secondOperation)
        )
        const observed = yield* journal.append(
          runId,
          outcomeRecordKey(secondOperation.operationId),
          taskTrackerFactsObservedEvent(
            secondOperation.operationId,
            makeCompleteTaskTrackerFactsObserved(secondOperation, secondSnapshot)
          )
        )
        const evidence = makeRunFinalityEvidence({
          observedAt: observed.position,
          operationId: secondOperation.operationId,
          readShape: secondOperation.readShape,
          rootTaskId: TaskId.make("root"),
          runId,
          snapshot: secondSnapshot,
          target
        })

        const terminated = yield* journal.terminateRun(runId, "Completed", evidence)

        expect(terminated.event._tag).toBe("WorkflowRunTerminated")
        expect(terminated.position).toBe(6)
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("rejects recovery and another termination after Run termination", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const target = FixtureTarget.make("already-terminated-target")
        yield* journal.beginRun(runId, target, initialPolicy)
        const terminated = yield* terminateCompleted(journal, target)

        expect(yield* Effect.flip(journal.readRunForRecovery(runId, target))).toMatchObject({
          _tag: "WorkflowRunAlreadyTerminated",
          runId,
          terminatedAt: terminated.position
        })
        const fixture = completedRunFinalityFixture({ runId, target })
        expect(yield* Effect.flip(journal.terminateRun(runId, "Completed", fixture.evidence))).toBeInstanceOf(
          WorkflowRunAlreadyTerminated
        )
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("rejects promoting an existing synthetic history to a fresh Run", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const existing = yield* journal.append(runId, firstKey, intent("one", "task-1"))
        const failure = yield* Effect.flip(
          journal.beginRun(runId, FixtureTarget.make("late-beginning-target"), initialPolicy)
        )

        expect(failure).toBeInstanceOf(WorkflowRunIdentityAlreadyUsed)
        expect(failure).toMatchObject({ firstRecordAt: existing.position, runId })
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("returns empty workflow-journal history for an unknown run", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        expect(yield* journal.read(RunId.make("unknown-run"))).toEqual([])
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("assigns canonical positions and returns ordered workflow-journal history", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const first = yield* journal.append(runId, firstKey, intent("one", "task-1"))
        const second = yield* journal.append(runId, secondKey, intent("two", "task-2"))

        expect(first.position).toBe(1)
        expect(second.position).toBe(2)
        expect(yield* journal.read(runId)).toEqual([first, second])
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("returns the original record for an identical re-append", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const event = intent("one", "task-1")
        const first = yield* journal.append(runId, firstKey, event)
        const repeated = yield* journal.append(runId, firstKey, event)

        expect(repeated).toEqual(first)
        expect(yield* journal.read(runId)).toEqual([first])
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("rejects unequal content under the same record key", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.append(runId, firstKey, intent("one", "task-1"))
        const failure = yield* Effect.flip(journal.append(runId, firstKey, intent("different", "task-1")))

        expect(failure).toBeInstanceOf(JournalStoreContradiction)
        expect(failure).toMatchObject({ existingPosition: 1, key: firstKey, runId })
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("atomically assigns distinct positions to concurrent appends", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const records = yield* Effect.all(
          [
            journal.append(runId, firstKey, intent("one", "task-1")),
            journal.append(runId, secondKey, intent("two", "task-2"))
          ],
          { concurrency: "unbounded" }
        )

        expect(new Set(records.map(({ position }) => position))).toEqual(new Set([1, 2]))
        expect((yield* journal.read(runId)).map(({ position }) => position)).toEqual([1, 2])
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("keeps each run's positions independent", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const first = yield* journal.append(runId, firstKey, intent("one", "task-1"))
        const other = yield* journal.append(RunId.make("another-run"), firstKey, intent("one", "task-1"))

        expect(first.position).toBe(1)
        expect(other.position).toBe(1)
      }).pipe(Effect.provide(makeLayer()))
    )

    it.effect("discovers all journal runs without an age cutoff", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.append(runId, firstKey, intent("one", "task-1"))
        const otherRunId = RunId.make(`${runId}-older`)
        yield* journal.append(otherRunId, firstKey, intent("one", "task-1"))
        expect(new Set((yield* journal.scanHot()).runs.map(({ runId }) => runId))).toEqual(new Set([runId, otherRunId]))
      }).pipe(Effect.provide(makeLayer()))
    )
  })
}

const durableJournalStoreContract = (
  name: string,
  makeLayer: () => Layer.Layer<JournalStore, unknown>,
  registerLifecycleAndFailureCases: () => void
) => {
  journalAppendContract(name, makeLayer)
  describe(`${name} durable JournalStore contract`, registerLifecycleAndFailureCases)
}

journalAppendContract("memory", () => memoryJournalTestLayer)
durableJournalStoreContract(
  "sqlite",
  () => sqliteJournalTestLayer({ filename: JournalDatabaseLocator.make(":memory:") }),
  () => {
    it.effect("migrates the production SQLite journal and enables WAL mode", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            yield* Effect.gen(function* () {
              yield* JournalStore
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

            const sql = yield* SqliteClient.make({ disableWAL: true, filename, readonly: true })
            const journalMode = yield* sql`PRAGMA journal_mode`
            const schemaVersion = yield* sql`PRAGMA user_version`
            expect(journalMode).toEqual([{ journal_mode: "wal" }])
            const migrations = yield* sql`
              SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
            `
            expect(schemaVersion).toEqual([{ user_version: 2 }])
            expect(migrations).toEqual([
              { migration_id: 1, name: "create_current_journal_records" },
              { migration_id: 2, name: "create_cold_journal_records" }
            ])
          }).pipe(Effect.provide(Reactivity.layer))
        )
      )
    )

    it.effect("upgrades an exact schema-v1 fixture transactionally and preserves hot rows", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const runId = RunId.make("schema-v1-preserved-run")
            const target = FixtureTarget.make("schema-v1-target")
            const record = makeWorkflowRunBeganRecord(runId, target, initialPolicy)
            yield* seedSchemaV1(filename, record)
            const history = yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              return yield* journal.read(runId)
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            expect(history).toEqual([record])
            yield* withSqliteClient(filename, (sql) =>
              Effect.gen(function* () {
                const migrations = yield* sql`SELECT migration_id FROM effect_sql_migrations ORDER BY migration_id`
                const schema = yield* sql`PRAGMA user_version`
                const hot = yield* sql`SELECT COUNT(*) AS count FROM journal_records WHERE run_id = ${runId}`
                const cold = yield* sql`SELECT COUNT(*) AS count FROM journal_records_cold WHERE run_id = ${runId}`
                expect(migrations).toEqual([{ migration_id: 1 }, { migration_id: 2 }])
                expect(schema).toEqual([{ user_version: 2 }])
                expect(hot).toEqual([{ count: 1 }])
                expect(cold).toEqual([{ count: 0 }])
              })
            )
          })
        )
      )
    )

    it.effect("copies SQLite record keys, positions, versions, kinds, and payload bytes exactly", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const runId = RunId.make("sqlite-retirement-byte-parity")
            const target = FixtureTarget.make("sqlite-retirement-byte-parity-target")
            yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              yield* journal.beginRun(runId, target, initialPolicy)
              yield* appendTerminalDisposition(journal, runId, target, "Cancelled")
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

            const hot = yield* withSqliteClient(
              filename,
              (sql) =>
                sql`
                SELECT run_id, position, record_key, event_kind, event_version, payload_json
                FROM journal_records WHERE run_id = ${runId} ORDER BY position ASC
              `
            )
            yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              yield* journal.retireTerminalRun(runId)
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            const cold = yield* withSqliteClient(
              filename,
              (sql) =>
                sql`
                SELECT run_id, position, record_key, event_kind, event_version, payload_json
                FROM journal_records_cold WHERE run_id = ${runId} ORDER BY position ASC
              `
            )
            expect(cold).toEqual(hot)
          })
        )
      )
    )

    it.effect("keeps an overlapping SQLite TraceReader read on one complete snapshot while retirement commits", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const runId = RunId.make("sqlite-read-retirement-overlap")
            const target = FixtureTarget.make("sqlite-read-retirement-overlap-target")
            yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              yield* journal.beginRun(runId, target, initialPolicy)
              yield* appendTerminalDisposition(journal, runId, target, "Completed")
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            const before = yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              return yield* makeTraceReader({ read: journal.read }).read(runId)
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

            const ready = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            const { observed, retired } = yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              const reader = makeTraceReader({ read: journal.read })
              const readFiber = yield* reader.read(runId).pipe(Effect.forkScoped)
              yield* Deferred.await(ready)
              const retireFiber = yield* journal.retireTerminalRun(runId).pipe(Effect.forkScoped)
              yield* Deferred.succeed(release, undefined)
              return { observed: yield* Fiber.join(readFiber), retired: yield* Fiber.join(retireFiber) }
            }).pipe(
              Effect.provide(
                sqliteJournalTestLayer({
                  filename,
                  beforeReadLoad: () =>
                    Deferred.succeed(ready, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.asVoid)
                })
              )
            )
            expect(observed).toEqual(before)
            expect(retired).toMatchObject({ _tag: "Retired", runId })
          })
        )
      )
    )

    it.effect("rolls back a retirement cut after verified copy and preserves Hot history after reopen", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const runId = RunId.make("sqlite-retirement-rollback-cut")
            const target = FixtureTarget.make("sqlite-retirement-rollback-cut-target")
            yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              yield* journal.beginRun(runId, target, initialPolicy)
              yield* appendTerminalDisposition(journal, runId, target, "Completed")
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

            const failure = yield* Effect.flip(
              Effect.gen(function* () {
                const journal = yield* JournalStore
                yield* journal.retireTerminalRun(runId)
              }).pipe(
                Effect.provide(
                  sqliteJournalTestLayer({
                    filename,
                    afterRetirementCopy: () => Effect.fail("controlled retirement cut")
                  })
                )
              )
            )
            expect(failure).toMatchObject({
              _tag: "JournalStorageUnavailable",
              operation: "JournalStore.retireTerminalRun"
            })

            yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              expect(yield* journal.read(runId)).toHaveLength(4)
              expect((yield* journal.scanHot()).runs).toContainEqual(expect.objectContaining({ runId }))
              expect((yield* journal.auditAll()).runs).toContainEqual(
                expect.objectContaining({ partition: "Hot", runId })
              )
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            expect(
              yield* withSqliteClient(
                filename,
                (sql) => sql`SELECT COUNT(*) AS count FROM journal_records_cold WHERE run_id = ${runId}`
              )
            ).toEqual([{ count: 0 }])
          })
        )
      )
    )

    it.effect("reopens after a committed retirement response is lost and reports the Run already Cold", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const runId = RunId.make("sqlite-retirement-committed-response-lost")
            const target = FixtureTarget.make("sqlite-retirement-committed-response-lost-target")
            const first = yield* Effect.flip(
              Effect.gen(function* () {
                const journal = yield* JournalStore
                yield* journal.beginRun(runId, target, initialPolicy)
                yield* appendTerminalDisposition(journal, runId, target, "Completed")
                const history = yield* journal.read(runId)
                yield* journal.retireTerminalRun(runId)
                return history
              }).pipe(
                Effect.provide(
                  sqliteJournalTestLayer({
                    filename,
                    afterRetirementCommit: () => Effect.fail("controlled lost retirement response")
                  })
                )
              )
            )
            expect(first).toMatchObject({
              _tag: "JournalStorageUnavailable",
              operation: "JournalStore.retireTerminalRun"
            })

            yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              expect(yield* journal.retireTerminalRun(runId)).toMatchObject({
                _tag: "AlreadyRetired",
                partition: "Cold",
                runId
              })
              const history = yield* journal.read(runId)
              expect(history).toHaveLength(4)
              expect(yield* journal.scanHot()).toEqual({ issues: [], runs: [] })
              expect((yield* journal.auditAll()).runs).toEqual([{ partition: "Cold", records: history, runId }])
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
          })
        )
      )
    )

    it.effect("rejects a verified-copy mismatch and rolls back the SQLite retirement", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const runId = RunId.make("sqlite-retirement-verification-mismatch")
            const target = FixtureTarget.make("sqlite-retirement-verification-mismatch-target")
            yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              yield* journal.beginRun(runId, target, initialPolicy)
              yield* appendTerminalDisposition(journal, runId, target, "Completed")
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            yield* withSqliteClient(
              filename,
              (sql) =>
                sql`CREATE TRIGGER mutate_cold_retirement AFTER INSERT ON journal_records_cold BEGIN
                UPDATE journal_records_cold SET payload_json = '{}' WHERE run_id = NEW.run_id AND position = NEW.position;
              END`
            )
            const failure = yield* Effect.flip(
              Effect.gen(function* () {
                const journal = yield* JournalStore
                return yield* journal.retireTerminalRun(runId)
              }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            )
            expect(failure).toMatchObject({
              _tag: "JournalDataCorruption",
              operation: "JournalStore.retireTerminalRun"
            })
            yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              expect((yield* journal.scanHot()).runs).toContainEqual(expect.objectContaining({ runId }))
              expect((yield* journal.auditAll()).runs).toContainEqual(
                expect.objectContaining({ partition: "Hot", runId })
              )
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
          })
        )
      )
    )

    it.effect("rolls back a failed v1-to-v2 migration without changing the v1 hot journal", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const runId = RunId.make("schema-v1-rollback-run")
            const target = FixtureTarget.make("schema-v1-rollback-target")
            const record = makeWorkflowRunBeganRecord(runId, target, initialPolicy)
            yield* seedSchemaV1(filename, record)
            const failure = yield* Effect.flip(
              Effect.gen(function* () {
                yield* JournalStore
              }).pipe(
                Effect.provide(
                  sqliteJournalTestLayer({
                    filename,
                    afterColdTableCreated: () => Effect.fail("controlled migration cut")
                  })
                )
              )
            )
            expect(failure).toBeInstanceOf(JournalDataCorruption)
            yield* withSqliteClient(filename, (sql) =>
              Effect.gen(function* () {
                expect(yield* sql`PRAGMA user_version`).toEqual([{ user_version: 1 }])
                expect(yield* sql`SELECT migration_id FROM effect_sql_migrations ORDER BY migration_id`).toEqual([
                  { migration_id: 1 }
                ])
                expect(yield* sql`SELECT COUNT(*) AS count FROM journal_records WHERE run_id = ${runId}`).toEqual([
                  { count: 1 }
                ])
                expect(
                  yield* sql`
                    SELECT type, name FROM sqlite_master
                    WHERE name = 'journal_records_cold'
                  `
                ).toEqual([])
              })
            )
          })
        )
      )
    )

    it.effect("reopening after a committed v1 migration does not repeat or retire the hot history", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const runId = RunId.make("schema-v1-reopen-run")
            const target = FixtureTarget.make("schema-v1-reopen-target")
            const record = makeWorkflowRunBeganRecord(runId, target, initialPolicy)
            yield* seedSchemaV1(filename, record)
            yield* Effect.gen(function* () {
              yield* JournalStore
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            const history = yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              return yield* journal.read(runId)
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            expect(history).toEqual([record])
            yield* withSqliteClient(filename, (sql) =>
              Effect.gen(function* () {
                expect(yield* sql`PRAGMA user_version`).toEqual([{ user_version: 2 }])
                expect(yield* sql`SELECT migration_id FROM effect_sql_migrations ORDER BY migration_id`).toEqual([
                  { migration_id: 1 },
                  { migration_id: 2 }
                ])
                expect(yield* sql`SELECT COUNT(*) AS count FROM journal_records_cold WHERE run_id = ${runId}`).toEqual([
                  { count: 0 }
                ])
              })
            )
          })
        )
      )
    )

    it.effect("rejects a second SQLite writer while the owner is live", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            yield* Effect.gen(function* () {
              yield* JournalStore
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))

            yield* Effect.gen(function* () {
              yield* JournalStore
              const secondWriterFailure = yield* Effect.flip(
                Effect.gen(function* () {
                  yield* JournalStore
                }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
              )

              expect(secondWriterFailure).toBeInstanceOf(JournalStorageLocked)
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
          })
        )
      )
    )

    it.effect("reports SQLite open failures as typed storage failures", () =>
      Effect.scoped(
        withTemporaryDatabase((_filename, directory) =>
          Effect.gen(function* () {
            const failure = yield* Effect.flip(
              Effect.gen(function* () {
                yield* JournalStore
              }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: JournalDatabaseLocator.make(directory) })))
            )

            expect(failure).toMatchObject({ _tag: "JournalStorageUnavailable", operation: "JournalStore.open" })
          })
        )
      )
    )

    it("classifies SQLite recovery categories without parsing error prose", () => {
      const sqliteError = (errcode: number) => Object.assign(new Error("opaque"), { errcode })

      expect(classifyJournalStorageFailure("JournalStore.append", sqliteError(5))).toBeInstanceOf(JournalStorageLocked)
      expect(classifyJournalStorageFailure("JournalStore.append", sqliteError(6))).toBeInstanceOf(JournalStorageLocked)
      expect(classifyJournalStorageFailure("JournalStore.append", sqliteError(3))).toBeInstanceOf(
        JournalStorageAccessDenied
      )
      expect(classifyJournalStorageFailure("JournalStore.append", sqliteError(8))).toBeInstanceOf(
        JournalStorageAccessDenied
      )
      expect(classifyJournalStorageFailure("JournalStore.append", sqliteError(23))).toBeInstanceOf(
        JournalStorageAccessDenied
      )
      expect(classifyJournalStorageFailure("JournalStore.append", sqliteError(13))).toBeInstanceOf(
        JournalStorageCapacityExhausted
      )
      expect(classifyJournalStorageFailure("JournalStore.read", sqliteError(11))).toMatchObject({
        _tag: "JournalDataCorruption"
      })
      expect(classifyJournalStorageFailure("JournalStore.read", sqliteError(26))).toMatchObject({
        _tag: "JournalDataCorruption"
      })
      expect(classifyJournalStorageFailure("JournalStore.open", sqliteError(14))).toBeInstanceOf(
        JournalStorageUnavailable
      )
      expect(classifyJournalStorageFailure("JournalStore.open", "unknown")).toBeInstanceOf(JournalStorageUnavailable)
      expect(classifyJournalStorageFailure("JournalStore.open", null)).toBeInstanceOf(JournalStorageUnavailable)
      expect(classifyJournalStorageFailure("JournalStore.open", {})).toBeInstanceOf(JournalStorageUnavailable)
      expect(classifyJournalStorageFailure("JournalStore.open", { errcode: "not-numeric", errno: 5 })).toBeInstanceOf(
        JournalStorageLocked
      )
      expect(
        classifyJournalStorageFailure(
          "JournalStore.open",
          new SqlError.SqlError({ reason: new SqlError.LockTimeoutError({ cause: { errno: 5 } }) })
        )
      ).toBeInstanceOf(JournalStorageLocked)
      expect(classifyJournalStorageFailure("JournalStore.open", Cause.die(sqliteError(5)))).toBeInstanceOf(
        JournalStorageLocked
      )
    })

    it.effect("rejects a journal schema from a newer Dalph version", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            yield* withSqliteClient(filename, (sql) =>
              Effect.gen(function* () {
                yield* sql`CREATE TABLE effect_sql_migrations (
                migration_id INTEGER PRIMARY KEY NOT NULL,
                created_at DATETIME NOT NULL DEFAULT current_timestamp,
                name VARCHAR(255) NOT NULL
              )`
                yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (3, 'future')`
              })
            )
            const failure = yield* Effect.flip(
              Effect.gen(function* () {
                yield* JournalStore
              }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            )

            expect(failure).toMatchObject({ _tag: "JournalSchemaIncompatible", found: 3, supported: 2 })
          })
        )
      )
    )

    it.effect("reports malformed persisted event content as a typed read failure", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const runId = RunId.make("malformed-event-run")
            yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              yield* journal.append(
                runId,
                JournalRecordKey.make("operation:malformed:intent"),
                intent("malformed", "task-malformed")
              )
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            yield* withSqliteClient(filename, (sql) =>
              Effect.asVoid(sql`UPDATE journal_records SET payload_json = '{'`)
            )

            const failure = yield* Effect.flip(
              Effect.gen(function* () {
                const journal = yield* JournalStore
                return yield* journal.read(runId)
              }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            )
            expect(failure).toMatchObject({
              _tag: "JournalHistoryCorruption",
              operation: "JournalStore.read",
              partition: "Hot",
              runId
            })
          })
        )
      )
    )

    it.effect("keeps malformed Cold history out of startup while full audit reports its partition and exact Run", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const runId = RunId.make("cold-corruption-isolated-run")
            const target = FixtureTarget.make("cold-corruption-isolated-target")
            yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              yield* journal.beginRun(runId, target, initialPolicy)
              yield* appendTerminalDisposition(journal, runId, target, "Completed")
              yield* journal.retireTerminalRun(runId)
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            yield* withSqliteClient(filename, (sql) =>
              Effect.asVoid(sql`UPDATE journal_records_cold SET position = 5 WHERE run_id = ${runId} AND position = 4`)
            )

            const startup = yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              return yield* journal.scanHot()
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            expect(startup).toEqual({ issues: [], runs: [] })
            const readFailure = yield* Effect.flip(
              Effect.gen(function* () {
                const journal = yield* JournalStore
                return yield* journal.read(runId)
              }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            )
            expect(readFailure).toMatchObject({
              _tag: "JournalHistoryCorruption",
              operation: "JournalStore.read",
              partition: "Cold",
              runId
            })
            const recoveryFailure = yield* Effect.flip(
              Effect.gen(function* () {
                const journal = yield* JournalStore
                return yield* journal.readRunForRecovery(runId, target)
              }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            )
            expect(recoveryFailure).toMatchObject({
              _tag: "JournalHistoryCorruption",
              operation: "JournalStore.readRunForRecovery",
              partition: "Cold",
              runId
            })
            const retirementFailure = yield* Effect.flip(
              Effect.gen(function* () {
                const journal = yield* JournalStore
                return yield* journal.retireTerminalRun(runId)
              }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            )
            expect(retirementFailure).toMatchObject({
              _tag: "JournalHistoryCorruption",
              operation: "JournalStore.retireTerminalRun",
              partition: "Cold",
              runId
            })
            const audit = yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              return yield* journal.auditAll()
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            expect(audit.issues).toMatchObject([{ _tag: "JournalSemanticIssue", partition: "Cold", runId }])
          })
        )
      )
    )

    it.effect(
      "fails SQLite reads, lifecycle, retirement, and full audit closed on contradictory partition membership",
      () =>
        Effect.scoped(
          withTemporaryDatabase((filename) =>
            Effect.gen(function* () {
              const runId = RunId.make("sqlite-contradictory-partitions")
              const target = FixtureTarget.make("sqlite-contradictory-partitions-target")
              yield* Effect.gen(function* () {
                const journal = yield* JournalStore
                yield* journal.beginRun(runId, target, initialPolicy)
                yield* appendTerminalDisposition(journal, runId, target, "Completed")
              }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
              yield* withSqliteClient(filename, (sql) =>
                Effect.asVoid(
                  sql`
                  INSERT INTO journal_records_cold
                    (run_id, position, record_key, event_kind, event_version, payload_json)
                  SELECT run_id, position, record_key, event_kind, event_version, payload_json
                  FROM journal_records WHERE run_id = ${runId}
                `
                )
              )

              const failures = yield* Effect.gen(function* () {
                const journal = yield* JournalStore
                const fixture = completedRunFinalityFixture({ runId, target })
                const read = yield* Effect.flip(journal.read(runId))
                const begin = yield* Effect.flip(journal.beginRun(runId, target, initialPolicy))
                const append = yield* Effect.flip(
                  journal.append(runId, JournalRecordKey.make("contradictory-append"), intent("contradictory", "task"))
                )
                const retire = yield* Effect.flip(journal.retireTerminalRun(runId))
                const terminate = yield* Effect.flip(journal.terminateRun(runId, "Completed", fixture.evidence))
                const audit = yield* Effect.flip(journal.auditAll())
                return { append, audit, begin, read, retire, terminate }
              }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
              expect(failures.append).toBeInstanceOf(JournalPartitionContradiction)
              expect(failures.read).toBeInstanceOf(JournalPartitionContradiction)
              expect(failures.begin).toBeInstanceOf(JournalPartitionContradiction)
              expect(failures.retire).toBeInstanceOf(JournalPartitionContradiction)
              expect(failures.terminate).toBeInstanceOf(JournalPartitionContradiction)
              expect(failures.audit).toBeInstanceOf(JournalPartitionContradiction)
            })
          )
        )
    )

    it.effect("rejects exact reads and recovery of a nonterminal SQLite Cold history", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const runId = RunId.make("sqlite-nonterminal-cold-read")
            const target = FixtureTarget.make("sqlite-nonterminal-cold-read-target")
            const fixture = completedRunFinalityFixture({ runId, target })
            yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              yield* journal.beginRun(runId, target, initialPolicy)
              yield* journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
              yield* journal.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            yield* withSqliteClient(filename, (sql) =>
              Effect.gen(function* () {
                yield* sql`
                  INSERT INTO journal_records_cold
                    (run_id, position, record_key, event_kind, event_version, payload_json)
                  SELECT run_id, position, record_key, event_kind, event_version, payload_json
                  FROM journal_records WHERE run_id = ${runId}
                `
                yield* sql`DELETE FROM journal_records WHERE run_id = ${runId}`
              })
            )
            const failures = yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              return {
                append: yield* Effect.flip(
                  journal.append(runId, JournalRecordKey.make("cold-nonterminal-append"), fixture.intent)
                ),
                read: yield* Effect.flip(journal.read(runId)),
                recovery: yield* Effect.flip(journal.readRunForRecovery(runId, target)),
                terminate: yield* Effect.flip(journal.terminateRun(runId, "Completed", fixture.evidence)),
                audit: yield* journal.auditAll()
              }
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            expect(failures.append).toMatchObject({
              _tag: "JournalHistoryCorruption",
              operation: "JournalStore.append",
              partition: "Cold",
              runId
            })
            expect(failures.read).toMatchObject({
              _tag: "JournalHistoryCorruption",
              operation: "JournalStore.read",
              partition: "Cold",
              runId
            })
            expect(failures.recovery).toMatchObject({
              _tag: "JournalHistoryCorruption",
              operation: "JournalStore.readRunForRecovery",
              partition: "Cold",
              runId
            })
            expect(failures.terminate).toMatchObject({
              _tag: "JournalHistoryCorruption",
              operation: "JournalStore.terminateRun",
              partition: "Cold",
              runId
            })
            expect(failures.audit).toMatchObject({
              issues: [expect.objectContaining({ _tag: "JournalSemanticIssue", partition: "Cold", runId })]
            })
          })
        )
      )
    )

    it.effect("rejects SQLite retirement for a missing Run", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const failure = yield* Effect.flip(
              Effect.gen(function* () {
                const journal = yield* JournalStore
                return yield* journal.retireTerminalRun(RunId.make("sqlite-missing-retirement"))
              }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            )
            expect(failure).toBeInstanceOf(WorkflowRunNotBegan)
          })
        )
      )
    )

    it.effect("discovers every run and accumulates independent row and payload decode issues", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const firstRun = RunId.make("old-run-without-age-cutoff")
            const secondRun = RunId.make("new-run-without-age-cutoff")
            const thirdRun = RunId.make("row-schema-failure-run")
            const fourthRun = RunId.make("run-identity-schema-failure-run")
            yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              yield* journal.append(
                firstRun,
                JournalRecordKey.make("operation:first:intent"),
                intent("first", "task-first")
              )
              yield* journal.append(
                secondRun,
                JournalRecordKey.make("operation:second:intent"),
                intent("second", "task-second")
              )
              yield* journal.append(
                thirdRun,
                JournalRecordKey.make("operation:third:intent"),
                intent("third", "task-third")
              )
              yield* journal.append(
                fourthRun,
                JournalRecordKey.make("operation:fourth:intent"),
                intent("fourth", "task-fourth")
              )
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            yield* withSqliteClient(filename, (sql) =>
              Effect.gen(function* () {
                yield* sql`UPDATE journal_records SET payload_json = '{' WHERE run_id = ${firstRun}`
                yield* sql`UPDATE journal_records SET event_kind = 'UnknownEvent' WHERE run_id = ${secondRun}`
                yield* sql`UPDATE journal_records SET record_key = '' WHERE run_id = ${thirdRun}`
                yield* sql`UPDATE journal_records SET run_id = '' WHERE run_id = ${fourthRun}`
              })
            )

            const scan = yield* Effect.gen(function* () {
              return yield* (yield* JournalStore).scanHot()
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            expect(scan.issues).toHaveLength(4)
            expect(new Set(scan.issues.map(({ runId }) => runId))).toEqual(
              new Set([firstRun, secondRun, thirdRun, null])
            )
            expect(scan.runs).toEqual([])
          })
        )
      )
    )

    it.effect("classifies malformed SQLite bytes as journal data corruption", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            const fileSystem = yield* FileSystem.FileSystem
            yield* fileSystem.writeFileString(filename, "not a SQLite database")

            const failure = yield* Effect.flip(
              Effect.gen(function* () {
                yield* JournalStore
              }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            )

            expect(failure).toMatchObject({ _tag: "JournalDataCorruption", operation: "JournalStore.open" })
          })
        )
      )
    )

    it.effect("classifies an unrecognized raw append failure as unavailable storage", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            yield* Effect.gen(function* () {
              yield* JournalStore
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            yield* withSqliteClient(filename, (sql) =>
              Effect.asVoid(
                sql`CREATE TRIGGER reject_journal_insert AFTER INSERT ON journal_records BEGIN SELECT RAISE(ABORT, 'opaque append failure'); END`
              )
            )

            const failure = yield* Effect.flip(
              Effect.gen(function* () {
                const journal = yield* JournalStore
                return yield* journal.append(
                  RunId.make("opaque-append-failure-run"),
                  JournalRecordKey.make("operation:opaque:append"),
                  intent("opaque-append-failure", "task-opaque-append-failure")
                )
              }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            )

            expect(failure).toMatchObject({ _tag: "JournalStorageUnavailable", operation: "JournalStore.append" })
          })
        )
      )
    )

    it.effect("types append and read failures from damaged journal storage", () =>
      Effect.scoped(
        withTemporaryDatabase((filename) =>
          Effect.gen(function* () {
            yield* Effect.gen(function* () {
              yield* JournalStore
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
            yield* withSqliteClient(filename, (sql) => Effect.asVoid(sql`DROP TABLE journal_records`))

            yield* Effect.gen(function* () {
              const journal = yield* JournalStore
              const appendError = yield* Effect.flip(
                journal.append(
                  RunId.make("damaged-run"),
                  JournalRecordKey.make("operation:damaged:intent"),
                  intent("damaged", "task-damaged")
                )
              )
              const readError = yield* Effect.flip(journal.read(RunId.make("damaged-run")))

              expect(appendError).toMatchObject({ _tag: "JournalStorageUnavailable", operation: "JournalStore.append" })
              expect(readError).toMatchObject({ _tag: "JournalStorageUnavailable", operation: "JournalStore.read" })
            }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
          })
        )
      )
    )
  }
)
