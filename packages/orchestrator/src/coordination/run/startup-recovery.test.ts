import { NodeFileSystem, NodePath } from "@effect/platform-node"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Path, Ref } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import { expect } from "vitest"
import { RunId } from "@dalph/contracts"
import { completedRunFinalityFixture } from "../../../test/run-finality.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { inspectStartupRecovery, StartupRecoveryBlocked } from "./startup-recovery.js"
import { JournalDatabaseLocator } from "../../workflow-journal/identity.js"
import { JournalStore, JournalStorageUnavailable, type JournalStoreService } from "../../workflow-journal/store.js"
import { memoryJournalTestLayer } from "../../workflow-journal/adapters/memory-store.js"
import { sqliteJournalTestLayer } from "../../workflow-journal/adapters/sqlite-store.js"
import {
  noopJournalMaintenanceObservation,
  type JournalMaintenanceDiagnostic,
  type JournalMaintenanceObservationService
} from "../../workflow-journal/maintenance.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"

const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const nodeFileSystemAndPath = Layer.merge(NodeFileSystem.layer, NodePath.layer)

const seedTerminalAndActive = Effect.fn("StartupRecoveryTest.seedTerminalAndActive")(function* (
  journal: JournalStoreService,
  suffix: string
) {
  const activeRunId = RunId.make(`startup-active-${suffix}`)
  const terminalRunId = RunId.make(`startup-terminal-${suffix}`)
  const activeTarget = FixtureTarget.make(`startup-active-target-${suffix}`)
  const terminalTarget = FixtureTarget.make(`startup-terminal-target-${suffix}`)
  yield* journal.beginRun(activeRunId, activeTarget, initialPolicy)
  yield* journal.beginRun(terminalRunId, terminalTarget, initialPolicy)
  const fixture = completedRunFinalityFixture({ runId: terminalRunId, target: terminalTarget })
  yield* journal.append(terminalRunId, intentRecordKey(fixture.operation.operationId), fixture.intent)
  yield* journal.append(terminalRunId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
  yield* journal.terminateRun(terminalRunId, "Completed", fixture.evidence)
  return { activeRunId, terminalRunId }
})

const collectMaintenance = Effect.fn("StartupRecoveryTest.collectMaintenance")(function* () {
  const diagnostics = yield* Ref.make<ReadonlyArray<JournalMaintenanceDiagnostic>>([])
  const maintenance: JournalMaintenanceObservationService = {
    observe: (diagnostic) => Ref.update(diagnostics, (current) => [...current, diagnostic])
  }
  return { diagnostics, maintenance }
})

const withTemporaryDatabase = <A, E, R>(use: (filename: JournalDatabaseLocator) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-startup-recovery-" })
    return yield* use(JournalDatabaseLocator.make(path.join(directory, "journal.sqlite")))
  }).pipe(Effect.provide(nodeFileSystemAndPath))

const withSqliteClient = <A, E, R>(
  filename: JournalDatabaseLocator,
  use: (sql: SqliteClient.SqliteClient) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      return yield* use(yield* SqliteClient.make({ filename }))
    }).pipe(Effect.provide(Reactivity.layer))
  )

it.effect("retires terminal Hot memory history while allowing an unrelated active Run to proceed", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const { activeRunId, terminalRunId } = yield* seedTerminalAndActive(journal, "memory-success")
    const { diagnostics, maintenance } = yield* collectMaintenance()

    const current = yield* inspectStartupRecovery(activeRunId, journal, maintenance)

    expect(current).toMatchObject({ _tag: "ValidWorkflowJournalHistory", runId: activeRunId })
    expect((yield* journal.scanHot()).runs.map(({ runId }) => runId)).toEqual([activeRunId])
    expect((yield* journal.auditAll()).runs).toContainEqual(
      expect.objectContaining({ runId: terminalRunId, partition: "Cold" })
    )
    expect(yield* Ref.get(diagnostics)).toEqual([])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect(
  "reports one immediate terminal-Hot retirement failure and still returns the unrelated active memory Run",
  () =>
    Effect.gen(function* () {
      const journal = yield* JournalStore
      const { activeRunId, terminalRunId } = yield* seedTerminalAndActive(journal, "memory-failure")
      const { diagnostics, maintenance } = yield* collectMaintenance()
      const retireAttempts = yield* Ref.make(0)
      const failingJournal = JournalStore.of({
        ...journal,
        retireTerminalRun: () =>
          Ref.updateAndGet(retireAttempts, (current) => current + 1).pipe(
            Effect.andThen(
              Effect.fail(
                new JournalStorageUnavailable({
                  detail: "controlled immediate retirement failure",
                  operation: "JournalStore.retireTerminalRun"
                })
              )
            )
          )
      })

      const current = yield* inspectStartupRecovery(activeRunId, failingJournal, maintenance)
      const observed = yield* Ref.get(diagnostics)

      expect(current).toMatchObject({ _tag: "ValidWorkflowJournalHistory", runId: activeRunId })
      expect(yield* Ref.get(retireAttempts)).toBe(1)
      expect(observed).toHaveLength(1)
      expect(observed[0]).toMatchObject({
        _tag: "JournalMaintenanceDiagnostic",
        operation: "JournalStore.retireTerminalRun",
        runId: terminalRunId,
        failure: {
          _tag: "JournalStorageUnavailable",
          detail: "controlled immediate retirement failure",
          operation: "JournalStore.retireTerminalRun"
        }
      })
      expect((yield* journal.scanHot()).runs.map(({ runId }) => runId)).toEqual([activeRunId, terminalRunId])
      expect((yield* journal.auditAll()).runs).toContainEqual(
        expect.objectContaining({ runId: terminalRunId, partition: "Hot" })
      )
    }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("reopens SQLite, reconciles terminal Hot history, and leaves an unrelated active Run discoverable", () =>
  Effect.scoped(
    withTemporaryDatabase((filename) =>
      Effect.gen(function* () {
        const seeded = yield* Effect.scoped(
          Effect.gen(function* () {
            return yield* seedTerminalAndActive(yield* JournalStore, "sqlite-success")
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        )
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            const { diagnostics, maintenance } = yield* collectMaintenance()
            const current = yield* inspectStartupRecovery(seeded.activeRunId, journal, maintenance)
            return {
              audit: yield* journal.auditAll(),
              current,
              diagnostics: yield* Ref.get(diagnostics),
              hot: yield* journal.scanHot()
            }
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        )

        expect(result.current).toMatchObject({ _tag: "ValidWorkflowJournalHistory", runId: seeded.activeRunId })
        expect(result.diagnostics).toEqual([])
        expect(result.hot.runs.map(({ runId }) => runId)).toEqual([seeded.activeRunId])
        expect(result.audit.runs).toContainEqual(
          expect.objectContaining({ runId: seeded.terminalRunId, partition: "Cold" })
        )
      })
    )
  )
)

it.effect("reopens SQLite, reports one failed terminal-Hot reconciliation, and still returns the active Run", () =>
  Effect.scoped(
    withTemporaryDatabase((filename) =>
      Effect.gen(function* () {
        const seeded = yield* Effect.scoped(
          Effect.gen(function* () {
            return yield* seedTerminalAndActive(yield* JournalStore, "sqlite-failure")
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        )
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            const { diagnostics, maintenance } = yield* collectMaintenance()
            const retireAttempts = yield* Ref.make(0)
            const failingJournal = JournalStore.of({
              ...journal,
              retireTerminalRun: () =>
                Ref.updateAndGet(retireAttempts, (current) => current + 1).pipe(
                  Effect.andThen(
                    Effect.fail(
                      new JournalStorageUnavailable({
                        detail: "controlled reopened retirement failure",
                        operation: "JournalStore.retireTerminalRun"
                      })
                    )
                  )
                )
            })
            const current = yield* inspectStartupRecovery(seeded.activeRunId, failingJournal, maintenance)
            return {
              current,
              diagnostics: yield* Ref.get(diagnostics),
              hot: yield* journal.scanHot(),
              retireAttempts: yield* Ref.get(retireAttempts)
            }
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        )

        expect(result.current).toMatchObject({ _tag: "ValidWorkflowJournalHistory", runId: seeded.activeRunId })
        expect(result.retireAttempts).toBe(1)
        expect(result.diagnostics).toHaveLength(1)
        expect(result.diagnostics[0]).toMatchObject({
          operation: "JournalStore.retireTerminalRun",
          runId: seeded.terminalRunId,
          failure: { operation: "JournalStore.retireTerminalRun", detail: "controlled reopened retirement failure" }
        })
        expect(result.hot.runs.map(({ runId }) => runId)).toEqual([seeded.activeRunId, seeded.terminalRunId])
      })
    )
  )
)

it.effect("blocks memory startup before any retirement when a Hot prefix is malformed", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const { activeRunId, terminalRunId } = yield* seedTerminalAndActive(journal, "memory-malformed")
    const scan = yield* journal.scanHot()
    const malformedRuns = scan.runs.map((history) =>
      history.runId === terminalRunId ? { ...history, records: history.records.slice(-1) } : history
    )
    const malformedJournal = JournalStore.of({
      ...journal,
      scanHot: () => Effect.succeed({ ...scan, runs: malformedRuns })
    })
    const failure = yield* Effect.flip(
      inspectStartupRecovery(activeRunId, malformedJournal, noopJournalMaintenanceObservation)
    )

    expect(failure).toBeInstanceOf(StartupRecoveryBlocked)
    expect(failure).toMatchObject({ _tag: "StartupRecoveryBlocked" })
    expect(yield* journal.scanHot()).toMatchObject({
      runs: expect.arrayContaining([expect.objectContaining({ runId: terminalRunId })])
    })
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("blocks reopened SQLite startup before activating around a malformed Hot prefix", () =>
  Effect.scoped(
    withTemporaryDatabase((filename) =>
      Effect.gen(function* () {
        const seeded = yield* Effect.scoped(
          Effect.gen(function* () {
            return yield* seedTerminalAndActive(yield* JournalStore, "sqlite-malformed")
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        )
        yield* withSqliteClient(filename, (sql) =>
          Effect.asVoid(
            sql`UPDATE journal_records SET position = 99 WHERE run_id = ${seeded.terminalRunId} AND position = 4`
          )
        )

        const retirementFailure = yield* Effect.gen(function* () {
          const journal = yield* JournalStore
          return yield* Effect.flip(journal.retireTerminalRun(seeded.terminalRunId))
        }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        expect(retirementFailure).toMatchObject({
          _tag: "JournalHistoryCorruption",
          operation: "JournalStore.retireTerminalRun",
          partition: "Hot",
          runId: seeded.terminalRunId
        })

        const failure = yield* Effect.scoped(
          Effect.gen(function* () {
            return yield* Effect.flip(
              inspectStartupRecovery(seeded.activeRunId, yield* JournalStore, noopJournalMaintenanceObservation)
            )
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        )
        expect(failure).toBeInstanceOf(StartupRecoveryBlocked)
      })
    )
  )
)
