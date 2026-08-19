import { it } from "@effect/vitest"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Deferred, Effect, Fiber, FileSystem, Layer, Path, Ref } from "effect"
import { describe, expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { sqliteJournalTestLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { JournalDatabaseLocator } from "../../../workflow-journal/identity.js"
import { InRunJournal, JournalStore } from "../../../workflow-journal/store.js"
import { controlDirectionAppliedRecordKey } from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { ControlDirectionApplicationOrdinal, ControlDirectionAppliedEvent } from "./events.js"
import { ControlDirectionApplication, controlDirectionApplicationLayer } from "./protocol.js"

const runId = RunId.make("control-direction-run")
const taskId = TaskId.make("task-2")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })

const nodePathAndFileSystemLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)

const makeJournalReadBarrier = Effect.gen(function* () {
  const armed = yield* Ref.make(false)
  const activeReads = yield* Ref.make(0)
  const peakReads = yield* Ref.make(0)
  const firstReadEntered = yield* Deferred.make<void>()
  const releaseReads = yield* Deferred.make<void>()
  const layer = Layer.effect(
    InRunJournal,
    Effect.gen(function* () {
      const delegate = yield* JournalStore
      return InRunJournal.of({
        append: delegate.append,
        read: (readRunId) =>
          Effect.gen(function* () {
            if (!(yield* Ref.get(armed))) return yield* delegate.read(readRunId)
            const active = yield* Ref.updateAndGet(activeReads, (count) => count + 1)
            yield* Ref.update(peakReads, (peak) => Math.max(peak, active))
            yield* Deferred.succeed(firstReadEntered, undefined)
            yield* Deferred.await(releaseReads)
            const records = yield* delegate.read(readRunId)
            yield* Ref.update(activeReads, (count) => count - 1)
            return records
          })
      })
    })
  ).pipe(Layer.provide(memoryJournalTestLayer))
  return { activeReads, armed, firstReadEntered, layer, peakReads, releaseReads }
})

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
      const journal = yield* JournalStore
      yield* journal.beginRun(runId, FixtureTarget.make("control-direction-fixture"), initialPolicy)

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
    }).pipe(Effect.provide(controlDirectionApplicationLayer), Effect.provide(memoryJournalTestLayer))
  )

  it.effect("leaves no durable direction when Alice's process dies before apply", () =>
    Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(runId, FixtureTarget.make("control-direction-fixture"), initialPolicy)

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
      const journal = yield* JournalStore
      yield* journal.beginRun(runId, FixtureTarget.make("control-direction-fixture"), initialPolicy)
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
    }).pipe(Effect.provide(controlDirectionApplicationLayer), Effect.provide(memoryJournalTestLayer))
  )

  it.effect("unpauses A without clearing an independent Pause on C", () =>
    Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(runId, FixtureTarget.make("independent-task-pause-fixture"), initialPolicy)
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
    }).pipe(Effect.provide(controlDirectionApplicationLayer), Effect.provide(memoryJournalTestLayer))
  )

  it.effect("serializes concurrent applications before either can allocate a run-local ordinal", () =>
    Effect.gen(function* () {
      const barrier = yield* makeJournalReadBarrier
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.beginRun(runId, FixtureTarget.make("control-direction-fixture"), initialPolicy)
        const control = yield* ControlDirectionApplication
        yield* Ref.set(barrier.armed, true)

        const first = yield* control
          .apply({ direction: "Pause", subject: { _tag: "Run", runId } })
          .pipe(Effect.forkScoped)
        yield* Deferred.await(barrier.firstReadEntered)
        const second = yield* control
          .apply({ direction: "Unpause", subject: { _tag: "Task", runId, taskId } })
          .pipe(Effect.forkScoped)
        yield* Effect.yieldNow
        expect(yield* Ref.get(barrier.activeReads)).toBe(1)
        expect(yield* Ref.get(barrier.peakReads)).toBe(1)
        yield* Deferred.succeed(barrier.releaseReads, undefined)

        const applied = yield* Effect.all([Fiber.join(first), Fiber.join(second)])
        expect(applied.map(({ event }) => event._tag === "ControlDirectionApplied" && event.ordinal)).toEqual([1, 2])
      }).pipe(
        Effect.provide(controlDirectionApplicationLayer.pipe(Layer.provideMerge(barrier.layer))),
        Effect.provide(memoryJournalTestLayer)
      )
    })
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
    }).pipe(Effect.provide(controlDirectionApplicationLayer), Effect.provide(memoryJournalTestLayer))
  )

  it.effect("reopens an applied direction from persisted SQLite after the response is lost", () =>
    Effect.scoped(
      withTemporaryDatabase((filename) =>
        Effect.gen(function* () {
          yield* Effect.gen(function* () {
            const journal = yield* JournalStore
            yield* journal.beginRun(runId, FixtureTarget.make("control-direction-fixture"), initialPolicy)
            const control = yield* ControlDirectionApplication
            yield* control.apply({ direction: "Pause", subject: { _tag: "Task", runId, taskId } })
            // The caller does not retain the returned record, modeling a lost response.
          }).pipe(
            Effect.provide(controlDirectionApplicationLayer),
            Effect.provide(sqliteJournalTestLayer({ filename }))
          )

          const records = yield* Effect.gen(function* () {
            const journal = yield* JournalStore
            return yield* journal.read(runId)
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
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
