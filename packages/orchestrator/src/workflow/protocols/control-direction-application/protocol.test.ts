import { it } from "@effect/vitest"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Path } from "effect"
import { describe, expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { JournalDatabaseLocator } from "../../../workflow-journal/identity.js"
import { InRunJournal, JournalStore } from "../../../workflow-journal/store.js"
import { unpublishedAcceptedJournalReaderTestLayer } from "../../../workflow-journal/test-accepted-reader.js"
import { makeWorkflowRunBeganRecord } from "../../../workflow-journal/run-lifecycle.js"
import { liveJournalTestLayer } from "../../../coordination/delivery/live-journal-test-layer.js"
import { journalLayer } from "../../../coordination/delivery/journal.js"
import { controlDirectionAppliedRecordKey } from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { ControlDirectionApplicationOrdinal, ControlDirectionAppliedEvent } from "./events.js"
import { ControlDirectionApplication, controlDirectionApplicationLayer } from "./protocol.js"

const runId = RunId.make("control-direction-run")
const taskId = TaskId.make("task-2")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })

const nodePathAndFileSystemLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)

const controlJournalLayer = (target: ReturnType<typeof FixtureTarget.make>) =>
  liveJournalTestLayer({ records: [makeWorkflowRunBeganRecord(runId, target, initialPolicy)], runId, target })

const sqliteControlJournalLayer = (filename: JournalDatabaseLocator) => {
  const target = FixtureTarget.make("control-direction-fixture")
  return Layer.unwrap(
    Effect.gen(function* () {
      const store = yield* JournalStore
      yield* store.beginRun(runId, target, initialPolicy)
      const records = yield* store.read(runId)
      const initial = reduceWorkflowJournalHistory(runId, records)
      if (initial._tag === "InvalidWorkflowJournalHistory") {
        return yield* Effect.die(`invalid SQLite control journal bootstrap: ${JSON.stringify(initial.issues)}`)
      }
      return journalLayer(runId, target, initial, store)
    })
  ).pipe(Layer.provideMerge(sqliteJournalStoreLayer({ filename })))
}

const withTemporaryDatabase = <A, E, R>(use: (filename: JournalDatabaseLocator) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-control-direction-" })
    return yield* use(JournalDatabaseLocator.make(path.join(directory, "journal.sqlite")))
  }).pipe(Effect.provide(nodePathAndFileSystemLayer))

describe("ControlDirectionApplication", () => {
  it.effect("reconstructs Alice's exact task Pause after Dalph applies it and restarts", () =>
    Effect.gen(function* () {
      const journal = yield* InRunJournal

      const control = yield* ControlDirectionApplication
      const applied = yield* control.apply({ direction: "Pause", subject: { _tag: "Task", runId, taskId } })

      expect(applied.event).toMatchObject({
        _tag: "ControlDirectionApplied",
        direction: "Pause",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        subject: { _tag: "Task", runId, taskId }
      })

      const records = yield* journal.read(runId)
      const reopened = reduceWorkflowJournalHistory(runId, records)
      expect(reopened._tag).toBe("ValidWorkflowJournalHistory")
      if (reopened._tag === "ValidWorkflowJournalHistory") {
        expect(reopened.runState.pause).toEqual({
          run: { _tag: "RunUnpaused" },
          tasks: { _tag: "TaskPauses", taskIds: [taskId] }
        })
      }
    }).pipe(
      Effect.provide(controlDirectionApplicationLayer),
      Effect.provide(controlJournalLayer(FixtureTarget.make("control-direction-fixture")))
    )
  )

  it.effect("leaves no durable direction when Alice's process dies before apply", () =>
    Effect.gen(function* () {
      const journal = yield* InRunJournal

      // The transport request is intentionally only an in-memory value until apply is called.
      const unconfirmedRequest = { direction: "Pause", subject: { _tag: "Run", runId } } as const
      void unconfirmedRequest

      const reopened = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
      expect(reopened._tag).toBe("ValidWorkflowJournalHistory")
      if (reopened._tag === "ValidWorkflowJournalHistory") {
        expect(reopened.runState.pause).toEqual({ run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } })
      }
    }).pipe(Effect.provide(memoryJournalTestLayer))
  )

  it.effect("applies run and task directions in order without claiming downstream effects", () =>
    Effect.gen(function* () {
      const journal = yield* InRunJournal
      const control = yield* ControlDirectionApplication

      yield* control.apply({ direction: "Pause", subject: { _tag: "Run", runId } })
      yield* control.apply({ direction: "Pause", subject: { _tag: "Task", runId, taskId } })
      yield* control.apply({ direction: "Unpause", subject: { _tag: "Run", runId } })
      yield* control.apply({ direction: "Unpause", subject: { _tag: "Task", runId, taskId } })

      const records = yield* journal.read(runId)
      expect(records.filter(({ event }) => event._tag === "ControlDirectionApplied")).toHaveLength(4)
      expect(
        records.some(({ event }) =>
          ["PlannedAttemptExecutorWorkReported", "TaskTrackerReadInitiated", "TaskClaimAcquisitionIntended"].includes(
            event._tag
          )
        )
      ).toBe(false)
      const reopened = reduceWorkflowJournalHistory(runId, records)
      expect(reopened._tag).toBe("ValidWorkflowJournalHistory")
      if (reopened._tag === "ValidWorkflowJournalHistory") {
        expect(reopened.runState.pause).toEqual({ run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } })
      }
    }).pipe(
      Effect.provide(controlDirectionApplicationLayer),
      Effect.provide(controlJournalLayer(FixtureTarget.make("control-direction-fixture")))
    )
  )

  it.effect("unpauses A without clearing an independent Pause on C", () =>
    Effect.gen(function* () {
      const journal = yield* InRunJournal
      const control = yield* ControlDirectionApplication
      const independentTaskId = TaskId.make("C")

      yield* control.apply({ direction: "Pause", subject: { _tag: "Task", runId, taskId } })
      yield* control.apply({ direction: "Pause", subject: { _tag: "Task", runId, taskId: independentTaskId } })
      yield* control.apply({ direction: "Unpause", subject: { _tag: "Task", runId, taskId } })

      const reopened = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
      expect(reopened._tag).toBe("ValidWorkflowJournalHistory")
      if (reopened._tag === "ValidWorkflowJournalHistory") {
        expect(reopened.runState.pause).toEqual({
          run: { _tag: "RunUnpaused" },
          tasks: { _tag: "TaskPauses", taskIds: [independentTaskId] }
        })
      }
    }).pipe(
      Effect.provide(controlDirectionApplicationLayer),
      Effect.provide(controlJournalLayer(FixtureTarget.make("independent-task-pause-fixture")))
    )
  )

  it.effect("serializes concurrent applications before either can allocate a run-local ordinal", () =>
    Effect.gen(function* () {
      const control = yield* ControlDirectionApplication
      const applied = yield* Effect.all(
        [
          control.apply({ direction: "Pause", subject: { _tag: "Run", runId } }),
          control.apply({ direction: "Unpause", subject: { _tag: "Task", runId, taskId } })
        ],
        { concurrency: "unbounded" }
      )
      expect(applied.map(({ event }) => event._tag === "ControlDirectionApplied" && event.ordinal)).toEqual([1, 2])
    }).pipe(
      Effect.provide(controlDirectionApplicationLayer),
      Effect.provide(controlJournalLayer(FixtureTarget.make("control-direction-fixture")))
    )
  )

  it.effect("rejects a decoded history whose first applied direction skips ordinal one", () =>
    Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(runId, FixtureTarget.make("control-direction-fixture"), initialPolicy)
      const ordinal = ControlDirectionApplicationOrdinal.make(2)
      yield* journal.append(
        runId,
        controlDirectionAppliedRecordKey(ordinal),
        ControlDirectionAppliedEvent.make({
          direction: "Pause",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal,
          subject: { _tag: "Run", runId },
          version: workflowJournalEventVersion
        })
      )
      const history = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
      expect(history._tag).toBe("InvalidWorkflowJournalHistory")
      if (history._tag === "InvalidWorkflowJournalHistory") {
        expect(history.issues).toContainEqual(
          expect.objectContaining({ detail: "control direction expected ordinal 1, found 2" })
        )
      }
    }).pipe(Effect.provide(memoryJournalTestLayer))
  )

  it.effect("rejects malformed input and a Run that has not begun without appending", () =>
    Effect.gen(function* () {
      const journal = yield* JournalStore
      const control = yield* ControlDirectionApplication
      const malformed = yield* Effect.flip(
        control.apply({ direction: "Stop", subject: { _tag: "Task", runId, taskId } })
      )
      expect(malformed._tag).toBe("SchemaError")
      const unsupportedIdentity = yield* Effect.flip(
        control.apply({ direction: "Pause", operatorId: "legacy-operator", subject: { _tag: "Run", runId } })
      )
      expect(unsupportedIdentity._tag).toBe("SchemaError")
      const missingRun = yield* Effect.flip(control.apply({ direction: "Pause", subject: { _tag: "Run", runId } }))
      expect(missingRun).toMatchObject({ _tag: "WorkflowRunNotBegan", runId })
      expect(yield* journal.read(runId)).toEqual([])
    }).pipe(
      Effect.provide(controlDirectionApplicationLayer),
      // No Run exists to activate; this is the explicit absent cold-storage diagnostic seam.
      Effect.provide(unpublishedAcceptedJournalReaderTestLayer.pipe(Layer.provideMerge(memoryJournalTestLayer)))
    )
  )

  it.effect("reopens an applied direction from persisted SQLite after the response is lost", () =>
    Effect.scoped(
      withTemporaryDatabase((filename) =>
        Effect.gen(function* () {
          yield* Effect.gen(function* () {
            const control = yield* ControlDirectionApplication
            yield* control.apply({ direction: "Pause", subject: { _tag: "Task", runId, taskId } })
            // The caller does not retain the returned record, modeling a lost response.
          }).pipe(Effect.provide(controlDirectionApplicationLayer), Effect.provide(sqliteControlJournalLayer(filename)))

          const records = yield* Effect.gen(function* () {
            const journal = yield* JournalStore
            return yield* journal.read(runId)
          }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
          const reopened = reduceWorkflowJournalHistory(runId, records)
          expect(reopened._tag).toBe("ValidWorkflowJournalHistory")
          if (reopened._tag === "ValidWorkflowJournalHistory") {
            expect(reopened.runState.pause.tasks).toEqual({ _tag: "TaskPauses", taskIds: [taskId] })
          }
        })
      )
    )
  )
})
