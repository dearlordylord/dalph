// @effect-diagnostics unnecessaryEffectGen:off
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { it } from "@effect/vitest"
import { Cause, ConfigProvider, Effect, FileSystem, Layer, Path } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as SqlError from "effect/unstable/sql/SqlError"
import { describe, expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import {
  FixtureTarget,
  CoordinatorOwnership,
  InitialControlPolicy,
  JournalDatabaseLocator,
  JournalRecordKey,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
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
import { intentRecordKey, outcomeRecordKey } from "./record-key.js"
import { ActiveTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import {
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent
} from "../workflow/registry/event.js"
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

const intent = (operationId: string, taskId: string) =>
  taskTrackerReadIntent(
    WorkflowOperation.cases.ReadTrackerGraph.make({
      operationId: OperationId.make(operationId),
      predecessorOperationIds: [],
      readShape: { _tag: "CompleteTargetClosure", explicitlyCoveredTaskIds: [] },
      target: FixtureTarget.make(taskId)
    })
  )

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
        expect(new Set((yield* journal.scan()).runs.map(({ runId }) => runId))).toEqual(new Set([runId, otherRunId]))
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
            expect(schemaVersion).toEqual([{ user_version: 1 }])
            expect(migrations).toEqual([{ migration_id: 1, name: "create_current_journal_records" }])
          }).pipe(Effect.provide(Reactivity.layer))
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

            expect(failure).toMatchObject({ _tag: "JournalSchemaIncompatible", found: 3, supported: 1 })
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
            expect(failure).toMatchObject({ _tag: "JournalDataCorruption", operation: "JournalStore.read" })
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
              return yield* (yield* JournalStore).scan()
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
