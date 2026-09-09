/* eslint-disable import/no-nodejs-modules, max-lines -- This qualification controls real shipped Node processes. */
import nodeProcess from "node:process"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  GitCommand,
  JournalDatabaseLocator,
  JournalStore,
  nodeGitCommandLayer,
  sqliteJournalStoreLayer
} from "@dalph/orchestrator"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Context, Effect, Fiber, FileSystem, Layer, Path, Queue, Ref, Schema, Stream } from "effect"
import { expect } from "vitest"
import { ProductionCliRecord, type ProductionCliRecord as ProductionCliRecordType } from "./production-cli.js"

const dalphPackageDirectory = new URL("../../", import.meta.url).pathname
const dalphExecutable = new URL("../../dist/bin/dalph.js", import.meta.url).pathname
const loaderRegister = new URL("../../dist/bin/production-public-recovery-loader-register.js", import.meta.url).pathname
const fixturePrefix = "DALPH_PUBLIC_RECOVERY_FIXTURE "
const target = "github:octo/dalph#42"

const FixtureEvent = Schema.Struct({
  _tag: Schema.String,
  event: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.String),
  sourceId: Schema.optional(Schema.String)
})
type FixtureEvent = typeof FixtureEvent.Type

interface PublicProcess {
  readonly events: Queue.Queue<FixtureEvent>
  readonly handle: ChildProcessSpawner.ChildProcessHandle
  readonly eventLog: Ref.Ref<ReadonlyArray<FixtureEvent>>
  readonly recordLog: Ref.Ref<ReadonlyArray<ProductionCliRecordType>>
  readonly records: Queue.Queue<ProductionCliRecordType>
  readonly stderrFiber: Fiber.Fiber<void, unknown>
  readonly stdoutFiber: Fiber.Fiber<void, unknown>
}

const takeMatching = <A>(queue: Queue.Queue<A>, predicate: (value: A) => boolean): Effect.Effect<A> =>
  Effect.gen(function* () {
    for (;;) {
      const value = yield* Queue.take(queue)
      if (predicate(value)) return value
    }
  })

const spawnPublicProcess = Effect.fn("ProductionPublicRecovery.spawn")(function* (
  config: string,
  claimState: string,
  mode: "first" | "recovered" | "terminal" | "closed-null",
  sourceId: string
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const command = ChildProcess.make(
    nodeProcess.execPath,
    [dalphExecutable, "run", target, "--production", "--config", config],
    {
      cwd: dalphPackageDirectory,
      env: {
        ...nodeProcess.env,
        DALPH_CODEX_PROVIDER_CREDENTIAL: "controlled-codex-credential",
        DALPH_QUALIFICATION_CLAIM_STATE: claimState,
        DALPH_QUALIFICATION_MODE: mode,
        DALPH_QUALIFICATION_STATUS_SOURCE: sourceId,
        GITHUB_TOKEN: "controlled-github-token",
        NODE_OPTIONS: `--import=${loaderRegister}`
      }
    }
  )
  const handle = yield* spawner.spawn(command)
  const records = yield* Queue.unbounded<ProductionCliRecordType>()
  const events = yield* Queue.unbounded<FixtureEvent>()
  const recordLog = yield* Ref.make<ReadonlyArray<ProductionCliRecordType>>([])
  const eventLog = yield* Ref.make<ReadonlyArray<FixtureEvent>>([])
  const stdoutFiber = yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line.length > 0),
    Stream.mapEffect((line) => Schema.decodeUnknownEffect(Schema.fromJsonString(ProductionCliRecord))(line)),
    Stream.runForEach((record) =>
      Effect.all([Queue.offer(records, record), Ref.update(recordLog, (current) => [...current, record])], {
        discard: true
      })
    ),
    Effect.forkScoped
  )
  const stderrFiber = yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line.startsWith(fixturePrefix)),
    Stream.map((line) => line.slice(fixturePrefix.length)),
    Stream.mapEffect((line) => Schema.decodeUnknownEffect(Schema.fromJsonString(FixtureEvent))(line)),
    Stream.runForEach((event) =>
      Effect.all([Queue.offer(events, event), Ref.update(eventLog, (current) => [...current, event])], {
        discard: true
      })
    ),
    Effect.forkScoped
  )
  return { eventLog, events, handle, recordLog, records, stderrFiber, stdoutFiber } satisfies PublicProcess
})

const stopAbruptly = (process: PublicProcess) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => nodeProcess.kill(process.handle.pid, "SIGKILL"))
    const processExit = yield* Effect.exit(process.handle.exitCode)
    yield* Effect.all([Fiber.join(process.stdoutFiber), Fiber.join(process.stderrFiber)])
    return processExit
  })

const awaitGraceful = (process: PublicProcess) =>
  Effect.gen(function* () {
    const exitCode = yield* process.handle.exitCode
    yield* Effect.all([Fiber.join(process.stdoutFiber), Fiber.join(process.stderrFiber)])
    return exitCode
  })

const publicFixture = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const git = yield* GitCommand
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-public-recovery-" })
  const repository = path.join(root, "repository")
  yield* fileSystem.makeDirectory(repository, { recursive: true })
  yield* git.runInWorktree(repository, ["init"])
  yield* git.runInWorktree(repository, ["config", "user.email", "dalph@example.invalid"])
  yield* git.runInWorktree(repository, ["config", "user.name", "Dalph Test"])
  yield* git.runInWorktree(repository, ["commit", "--allow-empty", "-m", "initial"])
  yield* git.runInWorktree(repository, ["branch", "-M", "master"])
  const baseSha = (yield* git.runInWorktree(repository, ["rev-parse", "HEAD"])).stdout.trim()
  const directories = ["codex", "evidence", "planned-attempts", "integrator-candidates"]
  yield* Effect.forEach(directories, (directory) => fileSystem.makeDirectory(path.join(root, directory)))
  yield* fileSystem.chmod(path.join(root, "codex"), 0o700)
  const journalDatabase = path.join(root, "journal.sqlite")
  const config = path.join(root, "production.json")
  const claimState = path.join(root, "claim.json")
  yield* fileSystem.writeFileString(
    config,
    JSON.stringify({
      activationInterval: "1 minute",
      claimOwner: "dalph:public-recovery",
      codexClientName: "dalph",
      codexClientVersion: "0.0.0",
      codexExecutable: "/usr/local/bin/codex",
      codexProvider: "openai",
      codexStateDirectory: path.join(root, "codex"),
      commonDirectory: path.join(repository, ".git"),
      evidenceStoreRoot: path.join(root, "evidence"),
      failureCooldown: "5 seconds",
      integrationRef: "refs/heads/master",
      integratorCandidateWorktreeRoot: path.join(root, "integrator-candidates"),
      integratorPrivateStore: path.join(root, "integrator-private.json"),
      journalDatabase,
      plannedAttemptBaseSha: baseSha,
      plannedAttemptExecutor: "codex:production",
      plannedAttemptWorktreeRoot: path.join(root, "planned-attempts"),
      repository,
      taskWorkCapacity: 1
    })
  )
  return { claimState, config, journalDatabase }
}).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))

it.live(
  "unfinished SQLite public restart reports the same recovered Run and no second beginning",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* publicFixture
        const first = yield* spawnPublicProcess(fixture.config, fixture.claimState, "first", "first-status-source")
        const allocated = yield* takeMatching(first.records, (record) => record._tag === "RunSelected")
        expect(allocated).toMatchObject({ _tag: "RunSelected", selection: "Allocated" })
        if (allocated._tag !== "RunSelected") return
        yield* takeMatching(first.events, (event) => event._tag === "CreateClaimLabelStarted")
        const firstExit = yield* stopAbruptly(first)
        expect(firstExit._tag).toBe("Failure")
        expect(yield* Ref.get(first.recordLog)).not.toContainEqual(expect.objectContaining({ _tag: "RunDisposition" }))

        const second = yield* spawnPublicProcess(
          fixture.config,
          fixture.claimState,
          "recovered",
          "second-status-source"
        )
        const recovered = yield* takeMatching(second.records, (record) => record._tag === "RunSelected")
        expect(recovered).toEqual({ _tag: "RunSelected", runId: allocated.runId, selection: "Recovered", version: 1 })
        const attached = yield* takeMatching(second.events, (event) => event._tag === "StatusSourceAttached")
        expect(attached).toMatchObject({ sourceId: "second-status-source" })
        yield* takeMatching(second.events, (event) => event._tag === "FindClaimLabelStarted")
        const coherent = yield* takeMatching(
          second.records,
          (record) =>
            record._tag === "CurrentStatus" &&
            record.status._tag === "DeliveryStatusAvailable" &&
            record.status.entries.every(({ _tag }) => _tag !== "LiveDeliveryAction")
        )
        expect(coherent).toMatchObject({
          _tag: "CurrentStatus",
          status: { _tag: "DeliveryStatusAvailable", subject: { _tag: "Run", runId: allocated.runId } }
        })
        const history = yield* takeMatching(second.records, (record) => record._tag === "HistoricalSnapshot")
        expect(history).toMatchObject({ _tag: "HistoricalSnapshot", snapshot: { cursor: { runId: allocated.runId } } })
        const secondExit = yield* stopAbruptly(second)
        expect(secondExit._tag).toBe("Failure")

        const secondEvents = yield* Ref.get(second.eventLog)
        expect(secondEvents.filter(({ _tag }) => _tag === "CreateClaimLabelStarted")).toHaveLength(0)

        const journalContext = yield* Layer.build(
          sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
        )
        const records = yield* Context.get(journalContext, JournalStore).read(allocated.runId)
        expect(records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(records.filter(({ event }) => event._tag === "TaskClaimAcquisitionIntended")).toHaveLength(1)
      }).pipe(Effect.provide(NodeServices.layer))
    ),
  30_000
)

it.live(
  "already-terminal tracker state exits the public command once without active-refresh reactivation",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* publicFixture
        const child = yield* spawnPublicProcess(
          fixture.config,
          fixture.claimState,
          "terminal",
          "terminal-status-source"
        )
        const selected = yield* takeMatching(child.records, ({ _tag }) => _tag === "RunSelected")
        const exitCode = yield* awaitGraceful(child)
        expect(exitCode).toBe(0)
        const records = yield* Ref.get(child.recordLog)
        expect(records.filter(({ _tag }) => _tag === "RunDisposition")).toHaveLength(1)
        expect(records.filter(({ _tag }) => _tag === "ApplicationExitDisposition")).toHaveLength(0)
        const events = yield* Ref.get(child.eventLog)
        expect(events).toContainEqual(expect.objectContaining({ _tag: "StatusSourceAttached" }))
        expect(
          events.filter(
            ({ _tag, kind }) => _tag === "ActivationFinalizationStarted" && kind === "ActiveWorkAuthorityRefresh"
          )
        ).toHaveLength(0)
        if (selected._tag !== "RunSelected") return
        const journalContext = yield* Layer.build(
          sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
        )
        const journal = yield* Context.get(journalContext, JournalStore).read(selected.runId)
        expect(journal.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
      }).pipe(Effect.provide(NodeServices.layer))
    ),
  30_000
)

it.live(
  "closed process-local status without a value cannot claim public command completion",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* publicFixture
        const child = yield* spawnPublicProcess(fixture.config, fixture.claimState, "closed-null", "closed-null-source")
        yield* takeMatching(
          child.records,
          (record) => record._tag === "CurrentStatus" && record.status._tag === "DeliveryStatusClosed"
        )
        const processExit = yield* stopAbruptly(child)
        expect(processExit._tag).toBe("Failure")
        const records = yield* Ref.get(child.recordLog)
        expect(records.filter(({ _tag }) => _tag === "RunDisposition")).toHaveLength(0)
        expect(records.filter(({ _tag }) => _tag === "ApplicationExitDisposition")).toHaveLength(0)
      }).pipe(Effect.provide(NodeServices.layer))
    ),
  30_000
)
