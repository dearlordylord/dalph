/* eslint-disable import/no-nodejs-modules -- the test exercises the explicit durable file boundary. */
import { NodeFileSystem } from "@effect/platform-node"
import {
  AcceptedResult,
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Exit, FileSystem, Layer, Option, PlatformError, Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  CodexServerIncarnation,
  CodexThreadId,
  CodexThreadOwnershipToken,
  CodexTurnId,
  CodexOwnedTurnToken
} from "./codex-attempt-store.js"
import {
  CodexIntegratorPrivateRecord,
  CodexIntegratorPrivateRun,
  CodexIntegratorPrivateStore,
  CodexIntegratorStoreFailure,
  IntegratorCandidateWorktreePath,
  IntegratorCandidateWorktreeRoot,
  IntegratorPrivateStoreLocator,
  nodeCodexIntegratorPrivateStoreLayer,
  revision
} from "./codex-integrator-private-store.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  JournalPosition
} from "@dalph/orchestrator"

const session = IntegratorSessionCorrelation.make({
  acceptedResult: AcceptedResult.make({
    commit: GitCommitSha.make("b".repeat(40)),
    evidenceManifest: EvidenceReference.make({ byteLength: 0, digest: EvidenceDigest.make("0".repeat(64)) })
  }),
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:private-store"),
  expectedTargetHead: GitCommitSha.make("a".repeat(40)),
  integrationTarget: IntegrationTarget.make({
    repository: GitRepositoryLocator.make("/repositories/private-store.git"),
    ref: IntegrationTargetRef.make("refs/heads/main")
  }),
  plannedAttempt: PlannedTaskAttempt.make({
    attemptId: AttemptId.make("private-store-attempt"),
    baseSha: GitCommitSha.make("a".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/private-store"),
    executor: TaskExecutorLocator.make("private-store-executor"),
    runId: RunId.make("private-store-run"),
    taskId: TaskId.make("private-store-task"),
    taskRevision: TaskRevision.make("private-store-revision"),
    worktree: WorktreeLocator.make("/planned/private-store")
  }),
  queuedAt: JournalPosition.make(1),
  sessionId: IntegratorSessionId.make("private-store-session"),
  startedAt: JournalPosition.make(2),
  targetLineageObservedAt: JournalPosition.make(3)
})

const record = (
  path = "/tmp/private-store-candidate",
  correlation: IntegratorSessionCorrelation = session
): CodexIntegratorPrivateRecord =>
  CodexIntegratorPrivateRecord.cases.CandidateUnmaterialized.make({
    appServerIncarnation: CodexServerIncarnation.make("private-store-incarnation"),
    candidatePath: IntegratorCandidateWorktreePath.make(path),
    correlation,
    initialRun: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: correlation }),
    revision: revision(1),
    threadToken: CodexThreadOwnershipToken.make("private-store-thread")
  })

const runCorrelation = (ordinal: number, runSession: IntegratorSessionCorrelation = session) =>
  IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(ordinal), session: runSession })

const terminalResult = (correlation = runCorrelation(1)) =>
  IntegratorResult.cases.NotPrepared.make({
    correlation,
    detail: IntegratorNotPreparedDetail.make("private-store test result")
  })

const preparedResult = (correlation = runCorrelation(1)) =>
  IntegratorResult.cases.PreparedCandidate.make({
    candidateText: IntegratorCandidateText.make("private-store-candidate"),
    correlation
  })

const validRun = (ordinal = 1) =>
  CodexIntegratorPrivateRun.cases.IntentRecorded.make({
    correlation: runCorrelation(ordinal),
    token: CodexOwnedTurnToken.make(`private-store-turn-${ordinal}`)
  })

const threadRecordInput = (runs: ReadonlyArray<unknown>) => ({
  ...record(),
  _tag: "ThreadWithRuns",
  runs,
  threadId: CodexThreadId.make("private-store-thread-id")
})

describe("Codex Integrator private store", () => {
  it("reads absence, writes a record, and finds it by exact candidate path", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-private-store-" })
          const locator = `${root}/records.json`
          const layer = nodeCodexIntegratorPrivateStoreLayer({
            privateStoreLocator: IntegratorPrivateStoreLocator.make(locator)
          })
          return yield* Effect.gen(function* () {
            const store = yield* CodexIntegratorPrivateStore
            const before = yield* store.read(session.sessionId)
            const saved = record(`${root}/candidate`)
            yield* store.write(saved)
            const after = yield* store.read(session.sessionId)
            const found = yield* store.findByCandidatePath(saved.candidatePath)
            const missing = yield* store.findByCandidatePath(IntegratorCandidateWorktreePath.make(`${root}/missing`))
            return { after, before, found, missing }
          }).pipe(Effect.provide(layer))
        }).pipe(Effect.provide(NodeFileSystem.layer))
      )
    )
    expect(Option.isNone(result.before)).toBe(true)
    expect(Option.isSome(result.after)).toBe(true)
    expect(Option.isSome(result.found)).toBe(true)
    expect(Option.isNone(result.missing)).toBe(true)
  })

  it("replaces one session atomically and rejects malformed JSON", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-private-store-" })
          const locator = `${root}/records.json`
          const layer = nodeCodexIntegratorPrivateStoreLayer({
            privateStoreLocator: IntegratorPrivateStoreLocator.make(locator)
          })
          return yield* Effect.gen(function* () {
            const store = yield* CodexIntegratorPrivateStore
            yield* store.write(record(`${root}/first`))
            yield* store.write(
              Schema.decodeUnknownSync(CodexIntegratorPrivateRecord)({
                ...record(`${root}/second`),
                revision: revision(2)
              })
            )
            const replaced = yield* store.read(session.sessionId)
            yield* fileSystem.writeFileString(locator, "not-json")
            const malformed = yield* Effect.exit(store.read(session.sessionId))
            return { malformed, replaced }
          }).pipe(Effect.provide(layer))
        }).pipe(Effect.provide(NodeFileSystem.layer))
      )
    )
    expect(Option.isSome(result.replaced)).toBe(true)
    if (Option.isSome(result.replaced)) expect(result.replaced.value.revision).toBe(2)
    expect(Exit.isFailure(result.malformed)).toBe(true)
    if (Exit.isFailure(result.malformed)) {
      expect(result.malformed.cause).toBeDefined()
    }
  })

  it("rejects malformed private state before a caller can use it", async () => {
    const malformed = {
      ...record(),
      runs: [
        {
          correlation: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session }),
          _tag: "CompletedTurnSealed",
          token: CodexOwnedTurnToken.make("malformed-turn"),
          turnId: CodexTurnId.make("malformed-turn-id")
        }
      ]
    }
    const exit = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-private-store-" })
          const locator = `${root}/records.json`
          yield* fileSystem.writeFileString(locator, JSON.stringify([malformed]))
          return yield* Effect.exit(
            Effect.gen(function* () {
              const store = yield* CodexIntegratorPrivateStore
              return yield* store.read(session.sessionId)
            }).pipe(
              Effect.provide(
                nodeCodexIntegratorPrivateStoreLayer({
                  privateStoreLocator: IntegratorPrivateStoreLocator.make(locator)
                })
              )
            )
          )
        }).pipe(Effect.provide(NodeFileSystem.layer))
      )
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = exit.cause
      expect(String(failure)).toContain(CodexIntegratorStoreFailure.name)
    }
  })

  it("rejects noncanonical locators and contradictory private run or record states", () => {
    const invalidLocators = [
      [IntegratorCandidateWorktreeRoot, "relative-root"],
      [IntegratorCandidateWorktreeRoot, "/tmp/../candidate-root"],
      [IntegratorPrivateStoreLocator, "relative-store.json"],
      [IntegratorPrivateStoreLocator, "/tmp/../store.json"],
      [IntegratorCandidateWorktreePath, "relative-candidate"]
    ] as const
    for (const [schema, value] of invalidLocators) {
      expect(Option.isNone(Schema.decodeUnknownOption(schema)(value))).toBe(true)
    }

    const invalidRuns: ReadonlyArray<unknown> = [
      { ...validRun(), _tag: "Unknown" },
      { ...validRun(), _tag: "TurnObserved" },
      { ...validRun(), _tag: "CompletedTurnSealed", turnId: CodexTurnId.make("sealed") },
      { ...validRun(), _tag: "CompletedTurnSealed", result: terminalResult() },
      {
        ...validRun(),
        _tag: "FailedTurnSealed" as const,
        result: preparedResult(),
        turnId: CodexTurnId.make("failed-prepared")
      }
    ]
    for (const run of invalidRuns) {
      expect(Option.isNone(Schema.decodeUnknownOption(CodexIntegratorPrivateRecord)(threadRecordInput([run])))).toBe(
        true
      )
    }

    const observedRun = CodexIntegratorPrivateRun.cases.TurnObserved.make({
      correlation: runCorrelation(1),
      token: CodexOwnedTurnToken.make("private-store-turn-1"),
      turnId: CodexTurnId.make("observed-valid")
    })
    const sealedRun = CodexIntegratorPrivateRun.cases.CompletedTurnSealed.make({
      correlation: runCorrelation(1),
      token: CodexOwnedTurnToken.make("private-store-turn-1"),
      result: terminalResult(),
      turnId: CodexTurnId.make("sealed-valid")
    })
    expect(
      Option.isSome(Schema.decodeUnknownOption(CodexIntegratorPrivateRecord)(threadRecordInput([observedRun])))
    ).toBe(true)
    expect(
      Option.isSome(Schema.decodeUnknownOption(CodexIntegratorPrivateRecord)(threadRecordInput([sealedRun])))
    ).toBe(true)
    expect(
      Option.isSome(
        Schema.decodeUnknownOption(CodexIntegratorPrivateRecord)(threadRecordInput([sealedRun, validRun(2)]))
      )
    ).toBe(true)

    const foreignSession = IntegratorSessionCorrelation.make({
      ...session,
      sessionId: IntegratorSessionId.make("private-store-foreign-session")
    })
    const invalidRecords: ReadonlyArray<unknown> = [
      { ...record(), initialRun: runCorrelation(2) },
      { ...record(), initialRun: runCorrelation(1, foreignSession) },
      threadRecordInput([validRun(1), validRun(1)]),
      threadRecordInput([validRun(1), validRun(2), validRun(3)]),
      threadRecordInput([validRun(2)]),
      threadRecordInput([validRun(1), validRun(2)]),
      threadRecordInput([validRun(2), validRun(1)]),
      threadRecordInput([sealedRun, { ...validRun(2), token: sealedRun.token }]),
      threadRecordInput([{ ...validRun(), correlation: { ...runCorrelation(1), ordinal: 0 } }]),
      { ...record(), _tag: "ThreadReady", runs: [validRun()] },
      { ...record(), _tag: "RemovalIntentRecorded", runs: [validRun()], threadId: CodexThreadId.make("removal") },
      { ...record(), _tag: "UnknownLifecycle" },
      threadRecordInput([{ ...validRun(), correlation: runCorrelation(1, foreignSession) }]),
      threadRecordInput([
        {
          ...validRun(),
          _tag: "CompletedTurnSealed" as const,
          result: terminalResult(runCorrelation(2)),
          turnId: CodexTurnId.make("sealed-mismatch")
        }
      ])
    ]
    for (const value of invalidRecords) {
      expect(
        Option.isNone(Schema.decodeUnknownOption(CodexIntegratorPrivateRecord, { onExcessProperty: "error" })(value))
      ).toBe(true)
    }
  })

  it("rejects duplicate durable session and candidate-path records", async () => {
    const foreignSession = IntegratorSessionCorrelation.make({
      ...session,
      sessionId: IntegratorSessionId.make("private-store-duplicate-foreign")
    })
    const exit = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-private-store-duplicates-" })
          const locator = `${root}/records.json`
          const layer = nodeCodexIntegratorPrivateStoreLayer({
            privateStoreLocator: IntegratorPrivateStoreLocator.make(locator)
          })
          const read = (value: ReadonlyArray<CodexIntegratorPrivateRecord>) =>
            Effect.gen(function* () {
              yield* fileSystem.writeFileString(locator, JSON.stringify(value))
              const store = yield* CodexIntegratorPrivateStore
              return yield* Effect.exit(store.read(session.sessionId))
            }).pipe(Effect.provide(layer))
          const duplicateSession = yield* read([record(`${root}/first`), record(`${root}/second`)] as const)
          const duplicatePath = yield* read([record(`${root}/same`), record(`${root}/same`, foreignSession)] as const)
          return { duplicatePath, duplicateSession }
        }).pipe(Effect.provide(NodeFileSystem.layer))
      )
    )
    expect(Exit.isFailure(exit.duplicateSession)).toBe(true)
    expect(Exit.isFailure(exit.duplicatePath)).toBe(true)
  })

  it("fails closed when the node store file or write boundary is unavailable", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-private-store-failures-" })
          const readLocator = `${root}/read-directory`
          yield* fileSystem.makeDirectory(readLocator)
          const readLayer = nodeCodexIntegratorPrivateStoreLayer({
            privateStoreLocator: IntegratorPrivateStoreLocator.make(readLocator)
          })
          const readFailure = yield* Effect.exit(
            Effect.gen(function* () {
              const store = yield* CodexIntegratorPrivateStore
              return yield* store.read(session.sessionId)
            }).pipe(Effect.provide(readLayer))
          )
          const blockedParent = `${root}/blocked-parent`
          yield* fileSystem.writeFileString(blockedParent, "not a directory")
          const writeLayer = nodeCodexIntegratorPrivateStoreLayer({
            privateStoreLocator: IntegratorPrivateStoreLocator.make(`${blockedParent}/records.json`)
          })
          const writeFailure = yield* Effect.exit(
            Effect.gen(function* () {
              const store = yield* CodexIntegratorPrivateStore
              return yield* store.write(record(`${root}/candidate`))
            }).pipe(Effect.provide(writeLayer))
          )
          const destination = `${root}/destination`
          yield* fileSystem.makeDirectory(destination)
          const renameLayer = nodeCodexIntegratorPrivateStoreLayer({
            privateStoreLocator: IntegratorPrivateStoreLocator.make(destination)
          })
          const renameFailure = yield* Effect.exit(
            Effect.gen(function* () {
              const store = yield* CodexIntegratorPrivateStore
              return yield* store.write(record(`${root}/rename-candidate`))
            }).pipe(Effect.provide(renameLayer))
          )
          return { readFailure, renameFailure, writeFailure }
        }).pipe(Effect.provide(NodeFileSystem.layer))
      )
    )
    expect(Exit.isFailure(result.readFailure)).toBe(true)
    expect(Exit.isFailure(result.writeFailure)).toBe(true)
    expect(Exit.isFailure(result.renameFailure)).toBe(true)
  })

  it("maps each node write operation failure through the typed private-store boundary", async () => {
    const nativeFailure = (method: string) =>
      PlatformError.systemError({ _tag: "PermissionDenied", module: "CodexIntegratorPrivateStoreTest", method })
    const attempt = (fileSystem: FileSystem.FileSystem, locator: string) =>
      Effect.gen(function* () {
        const store = yield* CodexIntegratorPrivateStore
        return yield* Effect.exit(store.write(record()))
      }).pipe(
        Effect.provide(
          nodeCodexIntegratorPrivateStoreLayer({
            privateStoreLocator: IntegratorPrivateStoreLocator.make(locator)
          }).pipe(Layer.provide(Layer.succeed(FileSystem.FileSystem, fileSystem)))
        )
      )
    const directoryFailure = FileSystem.makeNoop({ makeDirectory: () => Effect.fail(nativeFailure("makeDirectory")) })
    const writeFailure = FileSystem.makeNoop({
      makeDirectory: () => Effect.void,
      writeFileString: () => Effect.fail(nativeFailure("writeFileString"))
    })
    const renameFailure = FileSystem.makeNoop({
      makeDirectory: () => Effect.void,
      writeFileString: () => Effect.void,
      rename: () => Effect.fail(nativeFailure("rename"))
    })
    const result = await Effect.runPromise(
      Effect.all([
        attempt(directoryFailure, "/tmp/private-store-directory-failure.json"),
        attempt(writeFailure, "/tmp/private-store-write-failure.json"),
        attempt(renameFailure, "/tmp/private-store-rename-failure.json")
      ])
    )
    for (const exit of result) {
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain(CodexIntegratorStoreFailure.name)
    }
  })
})
