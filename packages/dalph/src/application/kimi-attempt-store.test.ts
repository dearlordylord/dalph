import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorResult,
  RunId,
  TaskExecutorLocator,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Exit, FileSystem, Layer, Option, Path, Schema } from "effect"
import { expect } from "vitest"
import type { KimiAttemptPrivatePhase } from "./kimi-attempt-store.js"
import {
  KimiAttemptPrivateRecord,
  KimiAttemptPrivateStore,
  KimiAttemptStoreFailure,
  kimiAttemptPrivateStoreLayer,
  memoryKimiAttemptPrivateStoreLayer,
  nodeKimiAttemptPrivateStoreLayer
} from "./kimi-attempt-store.js"
import { KimiAcpSessionId } from "./kimi-acp.js"
import { KimiResultCycle } from "./kimi-result-cycle.js"
import { KimiPromptRequestHistory } from "./kimi-prompt-history.js"
import { ProviderResultCycle } from "./provider-result-correction.js"
import {
  controlledCodexAttemptStoreNativeLayer,
  type CodexAttemptStoreNativeService
} from "./codex-attempt-store-native.js"

const runId = RunId.make("run:kimi-private-store")
const attemptId = AttemptId.make("attempt:kimi-private-store")
const record = KimiAttemptPrivateRecord.make({
  attemptId,
  baseSha: GitCommitSha.make("1".repeat(40)),
  executor: TaskExecutorLocator.make("executor:kimi/for-coding"),
  phase: "Executing" satisfies KimiAttemptPrivatePhase,
  runId,
  sessionId: KimiAcpSessionId.make("kimi-session-private-store"),
  worktree: WorktreeLocator.make("/worktrees/kimi-private-store"),
  sessionClosed: false
})

const layerAt = (stateDirectory: string) =>
  nodeKimiAttemptPrivateStoreLayer({ stateDirectory }).pipe(Layer.provide(NodeServices.layer))

it.effect("preserves Kimi ownership and terminal seals across native reopen", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-kimi-immutable-" })
      const sealed = KimiAttemptPrivateRecord.make({
        ...record,
        phase: "Terminal",
        terminal: PlannedAttemptExecutorResult.cases.Completed.make({})
      })
      yield* Effect.gen(function* () {
        const store = yield* KimiAttemptPrivateStore
        yield* store.write(sealed)
      }).pipe(Effect.provide(layerAt(root)))
      const filename = path.join(root, "kimi-executor-private-state.json")
      const before = yield* fs.readFileString(filename)
      yield* Effect.gen(function* () {
        const store = yield* KimiAttemptPrivateStore
        const changedRecords = [
          { ...sealed, baseSha: GitCommitSha.make("b".repeat(40)) },
          { ...sealed, worktree: WorktreeLocator.make("/worktrees/foreign") },
          { ...sealed, executor: TaskExecutorLocator.make("executor:foreign") },
          { ...sealed, sessionId: KimiAcpSessionId.make("foreign-session") },
          { ...sealed, terminal: PlannedAttemptExecutorResult.cases.Failed.make({ failureCode: "ProviderFailed" }) },
          { ...sealed, phase: "Executing" as const }
        ]
        for (const changed of changedRecords) {
          expect((yield* store.write(KimiAttemptPrivateRecord.make(changed)).pipe(Effect.result))._tag).toBe("Failure")
          expect(yield* store.read(runId, attemptId)).toEqual(Option.some(sealed))
          expect(yield* fs.readFileString(filename)).toBe(before)
        }
        yield* store.write(KimiAttemptPrivateRecord.make({ ...sealed, sessionClosed: true }))
      }).pipe(Effect.provide(layerAt(root)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("preserves Kimi result-cycle intent across restart and refuses to remove its consumed budget", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-kimi-result-cycle-" })
      const filename = path.join(root, "kimi-executor-private-state.json")
      const resultCycle = yield* Schema.decodeUnknownEffect(ProviderResultCycle)({
        cycleId: "cycle:kimi",
        responses: [
          { _tag: "RequestIntended", intent: { _tag: "Initial", ordinal: 1, token: "result:kimi", intendedAt: 1_000 } }
        ]
      })
      const retained = KimiAttemptPrivateRecord.make({ ...record, resultCycle })
      yield* Effect.gen(function* () {
        const store = yield* KimiAttemptPrivateStore
        yield* store.write(retained)
      }).pipe(Effect.provide(layerAt(root)))
      const before = yield* fs.readFileString(filename)
      yield* Effect.gen(function* () {
        const store = yield* KimiAttemptPrivateStore
        expect(yield* store.read(runId, attemptId)).toEqual(Option.some(retained))
        expect((yield* store.write(record).pipe(Effect.result))._tag).toBe("Failure")
        expect(yield* store.read(runId, attemptId)).toEqual(Option.some(retained))
      }).pipe(Effect.provide(layerAt(root)))
      expect(yield* fs.readFileString(filename)).toBe(before)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("reopens the exact Kimi session association without persisting credentials or ACP messages", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-kimi-private-store-" })
      const filename = path.join(root, "kimi-executor-private-state.json")

      yield* Effect.gen(function* () {
        const store = yield* KimiAttemptPrivateStore
        yield* store.write(record)
      }).pipe(Effect.provide(layerAt(root)))

      const encoded = yield* fileSystem.readFileString(filename)
      expect(encoded).toContain("kimi-session-private-store")
      expect(encoded).not.toContain("credential")
      expect(encoded).not.toContain("jsonrpc")

      yield* Effect.gen(function* () {
        const store = yield* KimiAttemptPrivateStore
        const recovered = yield* store.read(runId, attemptId)
        expect(Option.isSome(recovered) && recovered.value).toEqual(record)
      }).pipe(Effect.provide(layerAt(root)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails closed when Kimi private state is malformed", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-kimi-private-store-malformed-" })
      const filename = path.join(root, "kimi-executor-private-state.json")
      yield* fileSystem.writeFileString(filename, "not-json", { mode: 0o600 })
      yield* fileSystem.chmod(filename, 0o600)
      const result = yield* Effect.gen(function* () {
        const store = yield* KimiAttemptPrivateStore
        return yield* store.read(runId, attemptId)
      }).pipe(Effect.provide(layerAt(root)), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(result.cause).toBeDefined()
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails closed on duplicate attempt associations and aliased Kimi sessions", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const attemptDuplicateRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "dalph-kimi-private-store-duplicate-attempt-"
      })
      const sessionAliasRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "dalph-kimi-private-store-session-alias-"
      })
      const second = KimiAttemptPrivateRecord.make({
        ...record,
        attemptId: AttemptId.make("attempt:kimi-private-store:second")
      })
      const readResult = (root: string, records: ReadonlyArray<KimiAttemptPrivateRecord>) =>
        Effect.gen(function* () {
          const filename = path.join(root, "kimi-executor-private-state.json")
          yield* fileSystem.writeFileString(filename, JSON.stringify({ records }), { mode: 0o600 })
          yield* fileSystem.chmod(filename, 0o600)
          return yield* Effect.gen(function* () {
            const store = yield* KimiAttemptPrivateStore
            return yield* store.read(runId, attemptId)
          }).pipe(Effect.provide(layerAt(root)), Effect.exit)
        })
      const duplicateAttempt = yield* readResult(attemptDuplicateRoot, [record, record])
      const aliasedSession = yield* readResult(sessionAliasRoot, [record, second])
      expect(Exit.isFailure(duplicateAttempt)).toBe(true)
      expect(Exit.isFailure(aliasedSession)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("rejects unsafe Kimi state directories before filesystem access", () =>
  Effect.gen(function* () {
    let nativeCalls = 0
    const touched = (): never => {
      nativeCalls += 1
      return undefined as never
    }
    const native: CodexAttemptStoreNativeService = {
      lock: touched,
      lstat: touched,
      mkdir: touched,
      open: touched,
      path: { join: touched, parse: touched, sep: "/" },
      processUid: touched
    }
    const controlledLayer = (stateDirectory: string) =>
      kimiAttemptPrivateStoreLayer({ stateDirectory }).pipe(
        Layer.provide(controlledCodexAttemptStoreNativeLayer(native)),
        Layer.provide(NodeServices.layer)
      )
    for (const stateDirectory of ["relative/private", "/tmp/../private"]) {
      const failure = yield* Effect.gen(function* () {
        yield* KimiAttemptPrivateStore
      }).pipe(Effect.provide(controlledLayer(stateDirectory)), Effect.flip)
      expect(failure).toEqual(
        new KimiAttemptStoreFailure({
          detail: "Kimi private state directory must be an absolute, normalized path without traversal",
          operation: "configure"
        })
      )
    }
    expect(nativeCalls).toBe(0)
  })
)

it.effect("fails closed when the configured Kimi state path is a regular file", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-kimi-private-store-file-path-" })
      const regularPath = path.join(root, "not-a-directory")
      yield* fileSystem.writeFileString(regularPath, "not a directory", { mode: 0o600 })
      const result = yield* Effect.gen(function* () {
        yield* KimiAttemptPrivateStore
        return true
      }).pipe(Effect.provide(layerAt(regularPath)), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("reports absent memory associations and writes without an observation callback", () =>
  Effect.gen(function* () {
    const store = yield* KimiAttemptPrivateStore
    expect(yield* store.read(runId, AttemptId.make("attempt:kimi-private-store:missing"))).toEqual(Option.none())
    yield* store.write(record)
    expect(yield* store.read(runId, attemptId)).toEqual(Option.some(record))
  }).pipe(Effect.provide(memoryKimiAttemptPrivateStoreLayer()))
)

it.effect("fails closed when another process owns the Kimi private-store lease", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-kimi-private-store-lease-" })
      yield* Layer.build(layerAt(root))
      const result = yield* Layer.build(layerAt(root)).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(result.cause).toBeDefined()
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("retains exact Kimi prompt intent and acknowledgement across native store restart", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-kimi-prompt-history-" })
      const pending = yield* Schema.decodeUnknownEffect(KimiPromptRequestHistory)([
        { token: "prompt:one", intendedAt: 1_000, response: "Pending" }
      ])
      const observed = yield* Schema.decodeUnknownEffect(KimiPromptRequestHistory)([
        { token: "prompt:one", intendedAt: 1_000, response: "Observed" }
      ])
      const original = KimiAttemptPrivateRecord.make({
        ...record,
        phase: "PromptIntentRecorded",
        promptRequests: pending
      })
      yield* Effect.gen(function* () {
        const store = yield* KimiAttemptPrivateStore
        yield* store.write(original)
      }).pipe(Effect.provide(layerAt(root)))
      yield* Effect.gen(function* () {
        const store = yield* KimiAttemptPrivateStore
        expect(yield* store.read(runId, attemptId)).toEqual(Option.some(original))
        for (const mutation of [
          record,
          KimiAttemptPrivateRecord.make({
            ...original,
            promptRequests: yield* Schema.decodeUnknownEffect(KimiPromptRequestHistory)([
              { token: "prompt:foreign", intendedAt: 1_000, response: "Pending" }
            ])
          }),
          KimiAttemptPrivateRecord.make({
            ...original,
            promptRequests: yield* Schema.decodeUnknownEffect(KimiPromptRequestHistory)([
              { token: "prompt:one", intendedAt: 2_000, response: "Pending" }
            ])
          }),
          KimiAttemptPrivateRecord.make({
            ...original,
            promptRequests: yield* Schema.decodeUnknownEffect(KimiPromptRequestHistory)([
              ...observed,
              { token: "prompt:two", intendedAt: 2_000, response: "Pending" }
            ])
          })
        ]) {
          expect((yield* store.write(mutation).pipe(Effect.result))._tag).toBe("Failure")
          expect(yield* store.read(runId, attemptId)).toEqual(Option.some(original))
        }
        const acknowledged = KimiAttemptPrivateRecord.make({
          ...original,
          phase: "Executing",
          promptRequests: observed
        })
        yield* store.write(acknowledged)
        expect((yield* store.write(original).pipe(Effect.result))._tag).toBe("Failure")
        expect(yield* store.read(runId, attemptId)).toEqual(Option.some(acknowledged))
      }).pipe(Effect.provide(layerAt(root)))
      yield* Effect.gen(function* () {
        const store = yield* KimiAttemptPrivateStore
        expect((yield* store.read(runId, attemptId)).pipe(Option.map((value) => value.promptRequests))).toEqual(
          Option.some(observed)
        )
        const next = yield* Schema.decodeUnknownEffect(KimiPromptRequestHistory)([
          ...observed,
          { token: "prompt:two", intendedAt: 2_000, response: "Pending" }
        ])
        yield* store.write(KimiAttemptPrivateRecord.make({ ...record, promptRequests: next }))
        expect((yield* store.read(runId, attemptId)).pipe(Option.map((value) => value.promptRequests))).toEqual(
          Option.some(next)
        )
      }).pipe(Effect.provide(layerAt(root)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("refuses to drop or rewrite a retained ACP result-cycle budget", () =>
  Effect.gen(function* () {
    const store = yield* KimiAttemptPrivateStore
    const kimiResultCycle = yield* Schema.decodeUnknownEffect(KimiResultCycle)({
      cycleId: "kimi:retained-budget",
      plannedBaseSha: record.baseSha,
      responses: [
        {
          _tag: "RequestIntended",
          intent: { _tag: "Initial", ordinal: 1, token: "prompt:retained", intendedAt: 1_000 }
        }
      ]
    })
    const promptRequests = yield* Schema.decodeUnknownEffect(KimiPromptRequestHistory)([
      { token: "prompt:retained", intendedAt: 1_000, response: "Pending" }
    ])
    const retained = KimiAttemptPrivateRecord.make({ ...record, kimiResultCycle, promptRequests })
    yield* store.write(retained)
    expect((yield* store.write(record).pipe(Effect.result))._tag).toBe("Failure")
    const rewritten = yield* Schema.decodeUnknownEffect(KimiResultCycle)({
      ...kimiResultCycle,
      cycleId: "kimi:replacement-budget"
    })
    expect(
      (yield* store
        .write(KimiAttemptPrivateRecord.make({ ...retained, kimiResultCycle: rewritten }))
        .pipe(Effect.result))._tag
    ).toBe("Failure")
    expect(yield* store.read(runId, attemptId)).toEqual(Option.some(retained))
  }).pipe(Effect.provide(memoryKimiAttemptPrivateStoreLayer()))
)
