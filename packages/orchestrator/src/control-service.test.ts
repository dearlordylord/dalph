import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer } from "effect"
import { describe, expect } from "vitest"
import { ControlCommandIdentityContradiction, ControlService, controlServiceLayer } from "./control-service.js"
import { AuthenticatedOperatorIdentity, ControlCommandId, JournalDatabaseLocator, RunId, TaskId } from "./domain.js"
import { JournalStorageUnavailable, JournalStore, memoryJournalStoreLayer } from "./journal-store.js"
import { reduceWorkflowJournalHistory } from "./workflow-journal-history.js"
import { sqliteJournalStoreLayer } from "./sqlite-journal-store.js"

const operatorId = AuthenticatedOperatorIdentity.make("local-user")
const runId = RunId.make("control-run")

const command = {
  _tag: "RequestTaskPause",
  commandId: ControlCommandId.make("command-1"),
  runId,
  taskId: TaskId.make("task-a")
} as const

describe("ControlService", () => {
  it.effect("records explicit pause and unpause directions without claiming work resumed", () =>
    Effect.gen(function* () {
      const control = yield* ControlService
      const journal = yield* JournalStore
      const inputs = [
        { _tag: "RequestRunPause", commandId: ControlCommandId.make("command-2"), runId },
        { _tag: "RequestRunUnpause", commandId: ControlCommandId.make("command-3"), runId },
        command,
        {
          _tag: "RequestTaskUnpause",
          commandId: ControlCommandId.make("command-4"),
          runId,
          taskId: TaskId.make("task-a")
        }
      ] as const

      for (const input of inputs) yield* control.record(operatorId, input)

      const records = yield* journal.read(runId)
      expect(records.map(({ event }) => event)).toEqual([
        { _tag: "ControlCommandRecorded", command: { ...inputs[0], operatorId }, version: 5 },
        { _tag: "ControlCommandRecorded", command: { ...inputs[1], operatorId }, version: 5 },
        { _tag: "ControlCommandRecorded", command: { ...inputs[2], operatorId }, version: 5 },
        { _tag: "ControlCommandRecorded", command: { ...inputs[3], operatorId }, version: 5 }
      ])
      const reduced = reduceWorkflowJournalHistory(runId, records)
      expect(reduced._tag).toBe("ValidWorkflowJournalHistory")
      if (reduced._tag === "ValidWorkflowJournalHistory") {
        expect(reduced.runState.pause).toEqual({ run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } })
        expect(reduced.runState.responsibility.entries).toEqual([])
        expect(reduced.runState.workflowHistory.records).toEqual(records)
      }
    }).pipe(Effect.provide(controlServiceLayer), Effect.provide(memoryJournalStoreLayer))
  )

  it.effect("returns the original record for exact redelivery", () =>
    Effect.gen(function* () {
      const control = yield* ControlService
      const journal = yield* JournalStore
      const first = yield* control.record(operatorId, command)
      const redelivered = yield* control.record(operatorId, command)

      expect(redelivered).toEqual(first)
      expect(yield* journal.read(runId)).toEqual([first])
    }).pipe(Effect.provide(controlServiceLayer), Effect.provide(memoryJournalStoreLayer))
  )

  it.effect("rejects reuse of a command identity with another direction, subject, or operator", () =>
    Effect.gen(function* () {
      const control = yield* ControlService
      yield* control.record(operatorId, command)
      const contradictions = [
        control.record(operatorId, { ...command, _tag: "RequestTaskUnpause" }),
        control.record(operatorId, { ...command, taskId: TaskId.make("task-b") }),
        control.record(AuthenticatedOperatorIdentity.make("another-user"), command)
      ]

      for (const attempt of contradictions) {
        const failure = yield* Effect.flip(attempt)
        expect(failure).toBeInstanceOf(ControlCommandIdentityContradiction)
        expect(failure).toMatchObject({ commandId: command.commandId, existingPosition: 1, runId })
      }
    }).pipe(Effect.provide(controlServiceLayer), Effect.provide(memoryJournalStoreLayer))
  )

  it.effect("rejects malformed transport payloads before appending", () =>
    Effect.gen(function* () {
      const control = yield* ControlService
      const journal = yield* JournalStore
      const failure = yield* Effect.flip(
        control.record(operatorId, { _tag: "RequestTaskPause", commandId: "command-without-task", runId })
      )

      expect(failure._tag).toBe("SchemaError")
      expect(yield* journal.read(runId)).toEqual([])
    }).pipe(Effect.provide(controlServiceLayer), Effect.provide(memoryJournalStoreLayer))
  )

  it.effect("preserves a journal storage failure as distinct from identity contradiction", () => {
    const unavailable = new JournalStorageUnavailable({
      detail: "test journal unavailable",
      operation: "JournalStore.append"
    })
    const unavailableJournalLayer = Layer.succeed(
      JournalStore,
      JournalStore.of({
        append: () => Effect.fail(unavailable),
        read: () => Effect.succeed([]),
        scan: () => Effect.succeed({ issues: [], runs: [] })
      })
    )
    return Effect.gen(function* () {
      const control = yield* ControlService
      expect(yield* Effect.flip(control.record(operatorId, command))).toBe(unavailable)
    }).pipe(Effect.provide(controlServiceLayer), Effect.provide(unavailableJournalLayer))
  })

  it.effect("fails recovery closed when a record run contradicts its command subject", () =>
    Effect.gen(function* () {
      const control = yield* ControlService
      const recorded = yield* control.record(operatorId, command)
      const recordRunId = RunId.make("contradictory-record-run")
      const reduced = reduceWorkflowJournalHistory(recordRunId, [{ ...recorded, runId: recordRunId }])

      expect(reduced._tag).toBe("InvalidWorkflowJournalHistory")
      if (reduced._tag === "InvalidWorkflowJournalHistory") {
        expect(reduced.issues).toContainEqual(
          expect.objectContaining({ detail: `control command ${command.commandId} binds run ${runId}` })
        )
      }
    }).pipe(Effect.provide(controlServiceLayer), Effect.provide(memoryJournalStoreLayer))
  )

  it.effect("reopens the exact command from SQLite without assigning a pause phase", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-control-service-" })
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)

      const recorded = yield* Effect.gen(function* () {
        const control = yield* ControlService
        return yield* control.record(operatorId, command)
      }).pipe(Effect.provide(controlServiceLayer), Effect.provide(sqliteJournalStoreLayer({ filename })))

      const reopened = yield* Effect.gen(function* () {
        const control = yield* ControlService
        const journal = yield* JournalStore
        const redelivered = yield* control.record(operatorId, command)
        const contradiction = yield* Effect.flip(control.record(operatorId, { ...command, _tag: "RequestTaskUnpause" }))
        return { contradiction, records: yield* journal.read(runId), redelivered }
      }).pipe(Effect.provide(controlServiceLayer), Effect.provide(sqliteJournalStoreLayer({ filename })))

      expect(reopened.redelivered).toEqual(recorded)
      expect(reopened.records).toEqual([recorded])
      expect(reopened.contradiction).toBeInstanceOf(ControlCommandIdentityContradiction)
    }).pipe(Effect.provide(NodeServices.layer))
  )
})
