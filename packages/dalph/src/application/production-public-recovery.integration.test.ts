/* eslint-disable import/no-nodejs-modules, max-lines -- This qualification controls real Node processes over the shipped composition. */
import nodeProcess from "node:process"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  AcceptedJournalReader,
  ApplicationExitResult,
  appendReplacementProvenance,
  freshWorkflowRunId,
  GitCommand,
  GithubIssueNumber,
  GithubRepositoryName,
  GithubRepositoryOwner,
  GithubIssueTarget,
  InitialControlPolicy,
  JournalDatabaseLocator,
  journalLayer,
  JournalStore,
  nodeGitCommandLayer,
  reduceWorkflowJournalHistory,
  sqliteJournalStoreLayer,
  TaskWorkCapacity
} from "@dalph/orchestrator"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RemotePublicationTarget,
  RemotePublicationBranchRef,
  RemotePublicationEndpoint,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  encodeTaskRevisionFingerprint
} from "@dalph/contracts"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Context, Effect, Fiber, FileSystem, Layer, Path, Queue, Ref, Schema, Stream } from "effect"
import { expect } from "vitest"
import { ProductionCliRecord, type ProductionCliRecord as ProductionCliRecordType } from "./production-cli.js"
import { CodexAttemptStore, nodeCodexAttemptStoreLayer } from "./codex-attempt-store.js"
import { DalphRuntimeDiagnostic } from "./runtime-diagnostic.js"

type CurrentStatusRecord = Extract<ProductionCliRecordType, { readonly _tag: "CurrentStatus" }>
type ClosedStatus = Extract<CurrentStatusRecord["status"], { readonly _tag: "DeliveryStatusClosed" }>

const isClosedStatusRecord = (
  record: ProductionCliRecordType
): record is CurrentStatusRecord & { readonly status: ClosedStatus } =>
  record._tag === "CurrentStatus" && record.status._tag === "DeliveryStatusClosed"

const dalphPackageDirectory = new URL("../../", import.meta.url).pathname
const qualificationExecutable = new URL("../../dist/bin/production-public-recovery-qualification.js", import.meta.url)
  .pathname
const codexFixture = new URL("../../dist/bin/production-public-recovery-codex-fixture.js", import.meta.url).pathname
const gitFixture = new URL("../../dist/bin/production-public-recovery-git-fixture.js", import.meta.url).pathname
const fixturePrefix = "DALPH_PUBLIC_RECOVERY_FIXTURE "
const target = "github:octo/dalph#42"

class InvalidPublicStdoutRecord extends Schema.TaggedError<InvalidPublicStdoutRecord>()("InvalidPublicStdoutRecord", {
  cause: Schema.Defect(),
  line: Schema.NonEmptyString
}) {}

const FixtureEvent = Schema.Union([
  Schema.TaggedStruct("CodexFixtureStarted", {}),
  Schema.TaggedStruct("CodexTurnStarted", {}),
  Schema.TaggedStruct("CreateClaimLabelStarted", {
    description: Schema.NonEmptyString,
    labelName: Schema.NonEmptyString,
    operationId: Schema.NonEmptyString
  }),
  Schema.TaggedStruct("FindClaimLabelStarted", { labelName: Schema.NonEmptyString }),
  Schema.TaggedStruct("DeleteClaimLabelApplied", { operationId: Schema.NonEmptyString }),
  Schema.TaggedStruct("ReadIssueStarted", {
    issueNodeId: Schema.NonEmptyString,
    mode: Schema.Literals(["first", "recovered", "reconcile-cut", "terminal", "exit-during-attachment", "cancellation"])
  }),
  Schema.TaggedStruct("ReadIssueReturned", {
    issueNodeId: Schema.NonEmptyString,
    state: Schema.Literals(["OPEN", "CLOSED"])
  })
])
type FixtureEvent = typeof FixtureEvent.Type

const CleanupGitObservation = Schema.TaggedStruct("CleanupGitObservationStarted", {
  cleanupWorktree: Schema.NonEmptyString,
  commonDirectory: Schema.NonEmptyString
})

interface PublicProcess {
  readonly exitDiagnostics: Ref.Ref<ReadonlyArray<ApplicationExitResult>>
  readonly completionTraces: Ref.Ref<ReadonlyArray<string>>
  readonly outputCount: Ref.Ref<{ readonly lines: number; readonly bytes: number }>
  readonly diagnostics: Ref.Ref<ReadonlyArray<DalphRuntimeDiagnostic>>
  readonly events: Queue.Queue<FixtureEvent>
  readonly handle: ChildProcessSpawner.ChildProcessHandle
  readonly eventLog: Ref.Ref<ReadonlyArray<FixtureEvent>>
  readonly recordLog: Ref.Ref<ReadonlyArray<ProductionCliRecordType>>
  readonly records: Queue.Queue<ProductionCliRecordType>
  readonly stderrLines: Ref.Ref<ReadonlyArray<string>>
  readonly stderrFiber: Fiber.Fiber<void, unknown>
  readonly stdoutFiber: Fiber.Fiber<void, unknown>
}

class PublicQualificationChildExited extends Schema.TaggedError<PublicQualificationChildExited>()(
  "PublicQualificationChildExited",
  {
    diagnostics: Schema.Array(DalphRuntimeDiagnostic),
    exitCode: Schema.Int,
    operation: Schema.Literal("qualification.childExit")
  }
) {}

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
  cleanupObservation: string,
  cleanupRelease: string,
  cleanupWorktree: string,
  commonDirectory: string,
  gitFixtureDirectory: string,
  mode: "first" | "recovered" | "reconcile-cut" | "terminal" | "exit-during-attachment" | "cancellation",
  operation: "run" | "cancel" = "run",
  failSuspension = false,
  processEacces = false,
  dirtyStdout = false,
  loseBeginAck = false
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const command = ChildProcess.make(
    nodeProcess.execPath,
    [qualificationExecutable, operation, target, "--production", "--config", config],
    {
      cwd: dalphPackageDirectory,
      env: {
        ...nodeProcess.env,
        DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL: "controlled-codex-credential",
        DALPH_QUALIFICATION_CLAIM_STATE: claimState,
        DALPH_QUALIFICATION_CLEANUP_OBSERVATION: cleanupObservation,
        DALPH_QUALIFICATION_CLEANUP_RELEASE: cleanupRelease,
        DALPH_QUALIFICATION_CLEANUP_WORKTREE: cleanupWorktree,
        DALPH_QUALIFICATION_COMMON_DIRECTORY: commonDirectory,
        DALPH_QUALIFICATION_MODE: mode,
        DALPH_QUALIFICATION_FAIL_SUSPENSION: String(failSuspension),
        DALPH_QUALIFICATION_PROCESS_EACCES: String(processEacces),
        DALPH_QUALIFICATION_DIRTY_STDOUT: String(dirtyStdout),
        DALPH_QUALIFICATION_LOSE_BEGIN_ACK: String(loseBeginAck),
        GITHUB_TOKEN: "controlled-github-token",
        PATH: `${gitFixtureDirectory}:${nodeProcess.env["PATH"] ?? ""}`
      }
    }
  )
  const handle = yield* spawner.spawn(command)
  const records = yield* Queue.unbounded<ProductionCliRecordType>()
  const events = yield* Queue.unbounded<FixtureEvent>()
  const recordLog = yield* Ref.make<ReadonlyArray<ProductionCliRecordType>>([])
  const eventLog = yield* Ref.make<ReadonlyArray<FixtureEvent>>([])
  const diagnostics = yield* Ref.make<ReadonlyArray<DalphRuntimeDiagnostic>>([])
  const outputCount = yield* Ref.make({ lines: 0, bytes: 0 })
  const stdoutFiber = yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line.length > 0),
    Stream.tap((line) =>
      Ref.update(outputCount, (count) => ({
        lines: count.lines + 1,
        bytes: count.bytes + new TextEncoder().encode(line).byteLength + 1
      }))
    ),
    Stream.mapEffect((line) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(ProductionCliRecord))(line).pipe(
        Effect.mapError((cause) => new InvalidPublicStdoutRecord({ cause, line }))
      )
    ),
    Stream.runForEach((record) =>
      Effect.all([Queue.offer(records, record), Ref.update(recordLog, (current) => [...current, record])], {
        discard: true
      })
    ),
    Effect.forkScoped
  )
  const exitDiagnostics = yield* Ref.make<ReadonlyArray<ApplicationExitResult>>([])
  const completionTraces = yield* Ref.make<ReadonlyArray<string>>([])
  const stderrLines = yield* Ref.make<ReadonlyArray<string>>([])
  const stderrFiber = yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.tap((line) => Ref.update(stderrLines, (current) => [...current, line])),
    Stream.filter((line) => line.length > 0),
    Stream.runForEach((line) =>
      line.startsWith(fixturePrefix)
        ? Schema.decodeUnknownEffect(Schema.fromJsonString(FixtureEvent))(line.slice(fixturePrefix.length)).pipe(
            Effect.flatMap((event) =>
              Effect.all([Queue.offer(events, event), Ref.update(eventLog, (current) => [...current, event])], {
                discard: true
              })
            )
          )
        : Schema.decodeUnknownEffect(
            Schema.fromJsonString(
              Schema.Union([
                DalphRuntimeDiagnostic,
                Schema.TaggedStruct("DalphApplicationExitDiagnostic", { result: ApplicationExitResult }),
                Schema.TaggedStruct("CodexExecutorCompletionTrace", { phase: Schema.NonEmptyString })
              ])
            )
          )(line).pipe(
            Effect.flatMap((diagnostic) =>
              diagnostic._tag === "DalphRuntimeDiagnostic"
                ? Ref.update(diagnostics, (current) => [...current, diagnostic])
                : diagnostic._tag === "DalphApplicationExitDiagnostic"
                  ? Ref.update(exitDiagnostics, (current) => [...current, diagnostic.result])
                  : Ref.update(completionTraces, (current) => [...current, line])
            )
          )
    ),
    Effect.forkScoped
  )
  return {
    stderrLines,
    exitDiagnostics,
    completionTraces,
    outputCount,
    diagnostics,
    eventLog,
    events,
    handle,
    recordLog,
    records,
    stderrFiber,
    stdoutFiber
  } satisfies PublicProcess
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
    if (exitCode !== 0)
      return yield* new PublicQualificationChildExited({
        diagnostics: yield* Ref.get(process.diagnostics),
        exitCode,
        operation: "qualification.childExit"
      })
    return exitCode
  })

const publicFixture = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const git = yield* GitCommand
  const root = yield* fileSystem
    .makeTempDirectoryScoped({ prefix: "dalph-public-recovery-" })
    .pipe(Effect.flatMap((directory) => fileSystem.realPath(directory)))
  const repository = path.join(root, "repository")
  yield* fileSystem.makeDirectory(repository, { recursive: true })
  yield* git.runInWorktree(repository, ["init"])
  yield* git.runInWorktree(repository, ["config", "user.email", "dalph@example.invalid"])
  yield* git.runInWorktree(repository, ["config", "user.name", "Dalph Test"])
  yield* git.runInWorktree(repository, ["commit", "--allow-empty", "-m", "initial"])
  yield* git.runInWorktree(repository, ["branch", "-M", "master"])
  const baseSha = GitCommitSha.make((yield* git.runInWorktree(repository, ["rev-parse", "HEAD"])).stdout.trim())
  const remote = path.join(root, "remote.git")
  yield* git.runInWorktree(root, ["init", "--bare", remote])
  yield* git.runInWorktree(repository, ["remote", "add", "origin", remote])
  yield* git.runInWorktree(repository, ["push", "origin", "master"])
  const directories = ["codex-executor-private", "evidence", "planned-attempts", "integrator-candidates"]
  yield* Effect.forEach(directories, (directory) => fileSystem.makeDirectory(path.join(root, directory)))
  yield* fileSystem.chmod(path.join(root, "codex-executor-private"), 0o700)
  const journalDatabase = path.join(root, "journal.sqlite")
  const config = path.join(root, "production.json")
  const claimState = path.join(root, "claim.json")
  const cleanupObservation = path.join(root, "cleanup-observation.json")
  const cleanupRelease = path.join(root, "cleanup-release")
  const cleanupWorktree = path.join(root, "cleanup-worktree")
  const evidenceMarker = path.join(root, "evidence", "cancellation-evidence.txt")
  yield* fileSystem.writeFileString(evidenceMarker, "preserved\n")
  const commonDirectory = path.join(repository, ".git")
  const codexExecutable = path.join(root, "codex-fixture")
  yield* fileSystem.writeFileString(codexExecutable, yield* fileSystem.readFileString(codexFixture))
  yield* fileSystem.chmod(codexExecutable, 0o700)
  const gitFixtureDirectory = path.join(root, "git-fixture-bin")
  yield* fileSystem.makeDirectory(gitFixtureDirectory)
  const gitExecutable = path.join(gitFixtureDirectory, "git")
  yield* fileSystem.writeFileString(gitExecutable, yield* fileSystem.readFileString(gitFixture))
  yield* fileSystem.chmod(gitExecutable, 0o700)
  yield* fileSystem.writeFileString(
    config,
    JSON.stringify({
      activationInterval: "1 minute",
      claimOwner: "dalph:public-recovery",
      codexClientName: "dalph",
      codexClientVersion: "0.0.0",
      codexExecutable,
      codexExecutorPrivateStateDirectory: path.join(root, "codex-executor-private"),
      commonDirectory,
      evidenceStoreRoot: path.join(root, "evidence"),
      failureCooldown: "5 seconds",
      integrationRef: "refs/heads/master",
      integratorCandidateWorktreeRoot: path.join(root, "integrator-candidates"),
      integratorPrivateStore: path.join(root, "integrator-private.json"),
      journalDatabase,
      plannedAttemptBaseSha: baseSha,
      plannedAttemptExecutor: "codex:production",
      plannedAttemptWorktreeRoot: path.join(root, "planned-attempts"),
      remotePublicationTarget: { branch: "refs/heads/master", endpoint: remote },
      repository,
      taskWorkCapacity: 1
    })
  )
  return {
    remotePublicationTarget: RemotePublicationTarget.make({
      branch: RemotePublicationBranchRef.make("refs/heads/master"),
      endpoint: RemotePublicationEndpoint.make(remote)
    }),
    baseSha,
    claimState,
    codexTranscript: `${claimState}.codex`,
    cleanupObservation,
    cleanupRelease,
    cleanupWorktree,
    commonDirectory,
    config,
    evidenceMarker,
    executorState: path.join(root, "codex-executor-private", "executor-private-state.json"),
    gitFixtureDirectory,
    journalDatabase
  }
}).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))

const assertPublicLaunchCustody = (stateFile: string, unreadable: boolean) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(
        nodeCodexAttemptStoreLayer({ stateDirectory: stateFile.slice(0, stateFile.lastIndexOf("/")) })
      )
      const store = Context.get(context, CodexAttemptStore)
      const launch = yield* store.readServerLaunch()
      expect(launch._tag).toBe(unreadable ? "Some" : "None")
      if (launch._tag === "Some") expect(launch.value).toMatchObject({ phase: "Live", pid: expect.any(Number) })
      if (store.hasRetainedAttempts === undefined) return yield* Effect.die("private store inventory is unavailable")
      expect(yield* store.hasRetainedAttempts()).toBe(false)
    })
  )

it.effect("the shipped binary and recovery qualification select the same CLI and host composition", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const binary = yield* fileSystem.readFileString(new URL("../../bin/dalph.ts", import.meta.url).pathname)
    const qualification = yield* fileSystem.readFileString(
      new URL("../../bin/production-public-recovery-qualification.ts", import.meta.url).pathname
    )
    const composition = yield* fileSystem.readFileString(new URL("./live-cli.ts", import.meta.url).pathname)
    expect(binary).toContain('import { productionCliApplication } from "../src/application/live-cli.js"')
    expect(binary).toContain("runDalphNodeMain(productionCliApplication)")
    expect(composition).toContain("productionCliApplication = makeProductionCliApplication()")
    expect(composition).toContain("withDecodedProductionRepositoryHost(")
    expect(composition).toContain("productionRepositoryHostGraph(adapters)")
    expect(qualification).toContain('import { makeProductionCliApplication } from "../src/application/live-cli.js"')
    expect(qualification).toContain("codexProcessNative: processNative")
    expect(qualification).toContain("githubClient: () => publicRecoveryGithubLayer")
  }).pipe(Effect.provide(NodeServices.layer))
)

const startExecutingPublicRun = Effect.fn("ProductionPublicRecovery.startExecuting")(function* (
  failSuspension = false
) {
  const fixture = yield* publicFixture
  const child = yield* spawnPublicProcess(
    fixture.config,
    fixture.claimState,
    fixture.cleanupObservation,
    fixture.cleanupRelease,
    fixture.cleanupWorktree,
    fixture.commonDirectory,
    fixture.gitFixtureDirectory,
    "cancellation",
    "run",
    failSuspension
  )
  const selected = yield* takeMatching(child.records, ({ _tag }) => _tag === "RunSelected")
  if (selected._tag !== "RunSelected") return yield* Effect.die("missing selected Run")
  const fileSystem = yield* FileSystem.FileSystem
  const started = yield* Effect.gen(function* () {
    while (
      !(yield* fileSystem.exists(fixture.codexTranscript)) ||
      !(yield* fileSystem.readFileString(fixture.codexTranscript)).includes('"status":"inProgress"')
    ) {
      yield* Effect.sleep("20 millis")
    }
  }).pipe(Effect.timeoutOption("8 seconds"))
  if (started._tag === "None")
    return expect.fail(
      `executor did not start: ${JSON.stringify(yield* Ref.get(child.diagnostics))} records=${JSON.stringify(yield* Ref.get(child.recordLog))}`
    )
  yield* takeMatching(
    child.records,
    (record) =>
      record._tag === "HistoricalSnapshot" &&
      record.snapshot.items.some(
        ({ occurrence }) =>
          occurrence._tag === "PlannedAttemptExecutorWorkReported" && occurrence.report._tag === "ExecutorWorkExecuting"
      )
  )
  return { child, fixture, selected }
})

it.live(
  "one-minute production activation keeps stdout bounded while executor work remains active",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { child, fixture } = yield* startExecutingPublicRun()
        const fileSystem = yield* FileSystem.FileSystem
        const before = yield* Ref.get(child.outputCount)
        // This is an observation of a real child, not a simulated workflow timer.
        yield* Effect.sleep("2200 millis")
        const after = yield* Ref.get(child.outputCount)
        expect(after.lines - before.lines).toBeLessThanOrEqual(8)
        expect(after.bytes - before.bytes).toBeLessThan(1024 * 1024)
        expect(yield* fileSystem.readFileString(fixture.codexTranscript)).toContain('"status":"inProgress"')
        expect((yield* Ref.get(child.recordLog)).filter(({ _tag }) => _tag === "RunDisposition")).toEqual([])
        yield* stopAbruptly(child)
      }).pipe(Effect.provide(NodeServices.layer))
    ),
  20_000
)

it.live(
  "SIGINT suspends active production executor work and preserves the exact unfinished Run evidence",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { child, fixture, selected } = yield* startExecutingPublicRun()
        const fileSystem = yield* FileSystem.FileSystem
        const claimBefore = yield* fileSystem.readFileString(fixture.claimState)
        yield* Effect.sync(() => nodeProcess.kill(child.handle.pid, "SIGINT"))
        const exited = yield* Effect.exit(awaitGraceful(child).pipe(Effect.timeout("7 seconds")))
        if (exited._tag === "Failure")
          return expect.fail(
            `Exit failed: diagnostics=${JSON.stringify(yield* Ref.get(child.exitDiagnostics))} records=${JSON.stringify((yield* Ref.get(child.recordLog)).filter(({ _tag }) => _tag === "Failure" || _tag === "ApplicationExitDisposition"))} traces=${JSON.stringify((yield* Ref.get(child.completionTraces)).slice(-3))}`
          )
        const exitCode = exited.value
        expect(exitCode).toBe(0)
        expect(yield* Ref.get(child.exitDiagnostics)).toEqual([])
        const records = yield* Ref.get(child.recordLog)
        expect(records.filter(({ _tag }) => _tag === "ApplicationExitDisposition")).toEqual([
          {
            _tag: "ApplicationExitDisposition",
            disposition: { _tag: "Succeeded", requestedStatus: 0 },
            runId: selected.runId,
            version: 1
          }
        ])
        expect(records.filter(({ _tag }) => _tag === "RunDisposition")).toEqual([])
        expect(records.filter(isClosedStatusRecord)).toHaveLength(1)
        expect(yield* fileSystem.readFileString(fixture.claimState)).toBe(claimBefore)
        expect((yield* Ref.get(child.eventLog)).filter(({ _tag }) => _tag === "DeleteClaimLabelApplied")).toEqual([])
        const journalContext = yield* Layer.build(
          sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
        )
        const journal = yield* Context.get(journalContext, JournalStore).read(selected.runId)
        expect(journal.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(journal.filter(({ event }) => event._tag === "WorkflowRunTerminated")).toEqual([])
        const plans = journal.filter(({ event }) => event._tag === "TaskAttemptPlanned")
        expect(plans).toHaveLength(1)
        const plan = plans[0]
        if (plan?.event._tag !== "TaskAttemptPlanned") return expect.fail("missing exact attempt")
        expect(
          yield* fileSystem.readFileString(
            `${plan.event.operation.plannedAttempt.worktree}/cancellation-work-in-progress.txt`
          )
        ).toBe("preserved\n")
        expect(yield* fileSystem.exists(fixture.executorState)).toBe(true)
        expect(yield* fileSystem.exists(fixture.codexTranscript)).toBe(true)
        expect(yield* fileSystem.readFileString(fixture.evidenceMarker)).toBe("preserved\n")
        const suspension = journal.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended").at(-1)
        expect(suspension?.event).toMatchObject({
          command: "Suspend",
          plannedAttempt: plan.event.operation.plannedAttempt
        })
        const reports = journal.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")
        expect(reports.at(-1)?.event).toMatchObject({
          report: {
            _tag: "ExecutorWorkSafelySuspended",
            correlation: { runId: selected.runId, attemptId: plan.event.operation.plannedAttempt.attemptId }
          }
        })
        const commands = journal.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
        expect(
          commands.map(({ event }) =>
            event._tag === "PlannedAttemptExecutorCommandIntended" ? event.command : undefined
          )
        ).toEqual(["Begin", "Suspend"])
        expect(journal.findIndex(({ event }) => event === suspension?.event)).toBeLessThan(
          journal.findLastIndex(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")
        )
        expect(yield* fileSystem.readFileString(fixture.codexTranscript)).toContain('"status":"interrupted"')
      }).pipe(Effect.provide(NodeServices.layer))
    ),
  20_000
)

it.live(
  "SIGINT reports the exact failed suspension boundary and retains unmatched intent without completion",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { child, fixture, selected } = yield* startExecutingPublicRun(true)
        const fileSystem = yield* FileSystem.FileSystem
        const claimBefore = yield* fileSystem.readFileString(fixture.claimState)
        yield* Effect.sync(() => nodeProcess.kill(child.handle.pid, "SIGINT"))
        expect(yield* child.handle.exitCode.pipe(Effect.timeout("7 seconds"))).toBe(1)
        yield* Effect.all([Fiber.join(child.stdoutFiber), Fiber.join(child.stderrFiber)])
        const diagnostics = yield* Ref.get(child.exitDiagnostics)
        expect(diagnostics).toHaveLength(1)
        const diagnostic = diagnostics[0]
        if (diagnostic?._tag !== "Failed") return expect.fail("missing typed failed Exit diagnostic")
        expect(diagnostic.diagnostics[0]).toContain("Suspend (")
        expect(diagnostic.diagnostics[0]).toContain(selected.runId)
        expect(diagnostic.diagnostics[0]).toContain("thread turns page is invalid")
        const records = yield* Ref.get(child.recordLog)
        expect(records.filter(({ _tag }) => _tag === "ApplicationExitDisposition")).toEqual([
          {
            _tag: "ApplicationExitDisposition",
            disposition: { _tag: "Failed", requestedStatus: 1 },
            runId: selected.runId,
            version: 1
          }
        ])
        expect(records.filter(({ _tag }) => _tag === "Failure")).toMatchObject([{ code: "lifecycle.exit_failed" }])
        expect(records.filter(({ _tag }) => _tag === "RunDisposition")).toEqual([])
        expect(JSON.stringify(records)).not.toContain("thread turns page is invalid")
        const journalContext = yield* Layer.build(
          sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
        )
        const journal = yield* Context.get(journalContext, JournalStore).read(selected.runId)
        const commands = journal.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
        expect(commands).toHaveLength(2)
        const command = commands.at(-1)
        if (command?.event._tag !== "PlannedAttemptExecutorCommandIntended")
          return expect.fail("missing suspension intent")
        expect(command.event.command).toBe("Suspend")
        expect(diagnostic.diagnostics[0]).toContain(command.event.plannedAttempt.attemptId)
        expect(
          journal.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandResponseObserved")
        ).toHaveLength(1)
        expect(journal.filter(({ event }) => event._tag === "WorkflowRunTerminated")).toEqual([])
        expect(
          journal.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported").at(-1)?.event
        ).toMatchObject({ report: { _tag: "ExecutorWorkExecuting" } })
        expect(yield* fileSystem.readFileString(fixture.claimState)).toBe(claimBefore)
        expect(
          yield* fileSystem.readFileString(`${command.event.plannedAttempt.worktree}/cancellation-work-in-progress.txt`)
        ).toBe("preserved\n")
        expect(yield* fileSystem.exists(fixture.executorState)).toBe(true)
        expect(yield* fileSystem.exists(fixture.codexTranscript)).toBe(true)
        expect(yield* fileSystem.readFileString(fixture.evidenceMarker)).toBe("preserved\n")
      }).pipe(Effect.provide(NodeServices.layer))
    ),
  20_000
)

it.live(
  "current-format SQLite restart reconciles a lost Begin acknowledgement without another turn",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* publicFixture
        const launch = (loseBeginAck: boolean) =>
          spawnPublicProcess(
            fixture.config,
            fixture.claimState,
            fixture.cleanupObservation,
            fixture.cleanupRelease,
            fixture.cleanupWorktree,
            fixture.commonDirectory,
            fixture.gitFixtureDirectory,
            "cancellation",
            "run",
            false,
            false,
            false,
            loseBeginAck
          )
        const first = yield* launch(true)
        const selected = yield* takeMatching(first.records, ({ _tag }) => _tag === "RunSelected")
        if (selected._tag !== "RunSelected") return expect.fail("missing Run")
        yield* takeMatching(first.events, ({ _tag }) => _tag === "CodexTurnStarted")
        yield* stopAbruptly(first)
        const context = yield* Layer.build(
          sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
        )
        const store = Context.get(context, JournalStore)
        const before = yield* store.read(selected.runId)
        const begin = before.find(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
        if (begin?.event._tag !== "PlannedAttemptExecutorCommandIntended") return expect.fail("missing Begin")
        expect(begin.event.command).toBe("Begin")
        expect(begin.event.plannedAttempt.baseSha).toBe(fixture.baseSha)
        expect(before.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toEqual([])
        const fileSystem = yield* FileSystem.FileSystem
        const transcript = yield* fileSystem.readFileString(fixture.codexTranscript)
        expect(transcript).toContain('"status":"inProgress"')
        const second = yield* launch(false)
        expect(yield* takeMatching(second.records, ({ _tag }) => _tag === "RunSelected")).toEqual({
          ...selected,
          selection: "Recovered"
        })
        yield* takeMatching(
          second.records,
          (record) =>
            record._tag === "HistoricalSnapshot" &&
            record.snapshot.items.some(
              ({ occurrence }) =>
                occurrence._tag === "PlannedAttemptExecutorWorkReported" &&
                occurrence.report._tag === "ExecutorWorkExecuting"
            )
        )
        yield* stopAbruptly(second)
        const after = yield* store.read(selected.runId)
        expect(after.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toEqual(
          before.filter(({ event }) => event._tag === "TaskAttemptPlanned")
        )
        expect(after.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toEqual([begin])
        expect(after.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(1)
        expect(after.find(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")?.event).toMatchObject({
          report: {
            _tag: "ExecutorWorkExecuting",
            correlation: { runId: selected.runId, attemptId: begin.event.plannedAttempt.attemptId }
          }
        })
        expect((yield* Ref.get(second.eventLog)).filter(({ _tag }) => _tag === "CodexTurnStarted")).toEqual([])
        expect(yield* fileSystem.readFileString(fixture.codexTranscript)).toBe(transcript)
        expect(after.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
      }).pipe(Effect.provide(NodeServices.layer))
    ),
  20_000
)

it.live(
  "unfinished SQLite public restart repeats a cut claim read in the same Run without another acquisition",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* publicFixture
        const first = yield* spawnPublicProcess(
          fixture.config,
          fixture.claimState,
          fixture.cleanupObservation,
          fixture.cleanupRelease,
          fixture.cleanupWorktree,
          fixture.commonDirectory,
          fixture.gitFixtureDirectory,
          "first"
        )
        const allocated = yield* takeMatching(first.records, (record) => record._tag === "RunSelected")
        expect(allocated).toMatchObject({ _tag: "RunSelected", selection: "Allocated" })
        if (allocated._tag !== "RunSelected") return
        const createdClaimOrExit = yield* Effect.raceFirst(
          takeMatching(first.events, (event) => event._tag === "CreateClaimLabelStarted").pipe(
            Effect.map((event) => ({ _tag: "Claim" as const, event }))
          ),
          first.handle.exitCode.pipe(Effect.map((exitCode) => ({ _tag: "Exited" as const, exitCode })))
        )
        if (createdClaimOrExit._tag === "Exited") {
          yield* awaitGraceful(first)
          expect.fail(
            `the allocated command exited with status ${createdClaimOrExit.exitCode} before claim creation: ${JSON.stringify(yield* Ref.get(first.recordLog))}`
          )
        }
        const createdClaim = createdClaimOrExit.event
        if (createdClaim._tag !== "CreateClaimLabelStarted") return
        const firstExit = yield* stopAbruptly(first)
        expect(firstExit._tag).toBe("Failure")
        expect(yield* Ref.get(first.recordLog)).not.toContainEqual(expect.objectContaining({ _tag: "RunDisposition" }))

        const cut = yield* spawnPublicProcess(
          fixture.config,
          fixture.claimState,
          fixture.cleanupObservation,
          fixture.cleanupRelease,
          fixture.cleanupWorktree,
          fixture.commonDirectory,
          fixture.gitFixtureDirectory,
          "reconcile-cut"
        )
        expect(yield* takeMatching(cut.records, (record) => record._tag === "RunSelected")).toEqual({
          _tag: "RunSelected",
          runId: allocated.runId,
          selection: "Recovered",
          version: 1
        })
        expect(yield* takeMatching(cut.events, (event) => event._tag === "FindClaimLabelStarted")).toEqual({
          _tag: "FindClaimLabelStarted",
          labelName: createdClaim.labelName
        })
        expect((yield* stopAbruptly(cut))._tag).toBe("Failure")
        expect((yield* Ref.get(cut.eventLog)).filter(({ _tag }) => _tag === "CreateClaimLabelStarted")).toHaveLength(0)

        const second = yield* spawnPublicProcess(
          fixture.config,
          fixture.claimState,
          fixture.cleanupObservation,
          fixture.cleanupRelease,
          fixture.cleanupWorktree,
          fixture.commonDirectory,
          fixture.gitFixtureDirectory,
          "recovered"
        )
        const recovered = yield* takeMatching(second.records, (record) => record._tag === "RunSelected")
        expect(recovered).toEqual({ _tag: "RunSelected", runId: allocated.runId, selection: "Recovered", version: 1 })
        const recoveredClaimRead = yield* takeMatching(second.events, (event) => event._tag === "FindClaimLabelStarted")
        expect(recoveredClaimRead).toEqual({ _tag: "FindClaimLabelStarted", labelName: createdClaim.labelName })
        const history = yield* takeMatching(
          second.records,
          (record) =>
            record._tag === "HistoricalSnapshot" &&
            record.snapshot.facets.recovery.retainedResponsibilities.some(
              (responsibility) =>
                responsibility._tag === "TaskClaim" && responsibility.claim.operationId === createdClaim.operationId
            )
        )
        expect(history).toMatchObject({
          _tag: "HistoricalSnapshot",
          snapshot: {
            cursor: { runId: allocated.runId },
            facets: {
              recovery: {
                retainedResponsibilities: [
                  {
                    _tag: "TaskClaim",
                    claim: { operationId: createdClaim.operationId },
                    source: { runId: allocated.runId }
                  }
                ]
              }
            }
          }
        })
        const secondExit = yield* stopAbruptly(second)
        expect(secondExit._tag).toBe("Failure")

        const secondEvents = yield* Ref.get(second.eventLog)
        expect(secondEvents.filter(({ _tag }) => _tag === "CreateClaimLabelStarted")).toHaveLength(0)
        const recoveredRecords = yield* Ref.get(second.recordLog)
        expect(recoveredRecords.filter(({ _tag }) => _tag === "RunSelected")).toEqual([recovered])

        const journalContext = yield* Layer.build(
          sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
        )
        const records = yield* Context.get(journalContext, JournalStore).read(allocated.runId)
        expect(records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        const claimIntents = records.filter(({ event }) => event._tag === "TaskClaimAcquisitionIntended")
        expect(claimIntents).toHaveLength(1)
        expect(claimIntents[0]?.event).toMatchObject({
          operation: { acquisition: { operationId: createdClaim.operationId } }
        })
        expect(records.filter(({ event }) => event._tag === "TaskClaimAcquired")).toHaveLength(1)
        expect(records.find(({ event }) => event._tag === "TaskClaimAcquired")?.event).toMatchObject({
          claim:
            claimIntents[0]?.event._tag === "TaskClaimAcquisitionIntended"
              ? claimIntents[0].event.operation.acquisition
              : undefined
        })
        expect(records.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toHaveLength(0)
        expect(createdClaim.description).toContain(createdClaim.operationId)
      }).pipe(Effect.provide(NodeServices.layer))
    ),
  60_000
)

it.live(
  "the public cancel command stops retained executor work, abandons it, releases its exact claim, and redelivers",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { child: first, fixture, selected } = yield* startExecutingPublicRun()
        const fileSystem = yield* FileSystem.FileSystem
        expect(yield* fileSystem.exists(fixture.claimState)).toBe(true)
        yield* stopAbruptly(first)

        const cancellation = yield* spawnPublicProcess(
          fixture.config,
          fixture.claimState,
          fixture.cleanupObservation,
          fixture.cleanupRelease,
          fixture.cleanupWorktree,
          fixture.commonDirectory,
          fixture.gitFixtureDirectory,
          "cancellation",
          "cancel"
        )
        const recovered = yield* takeMatching(cancellation.records, ({ _tag }) => _tag === "RunSelected")
        expect(recovered).toEqual({ _tag: "RunSelected", runId: selected.runId, selection: "Recovered", version: 1 })
        const cancellationExitOption = yield* Effect.exit(awaitGraceful(cancellation)).pipe(
          Effect.timeoutOption("20 seconds")
        )
        if (cancellationExitOption._tag === "None") {
          yield* stopAbruptly(cancellation)
          const stalledJournal = yield* Layer.build(
            sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
          )
          const stalledRecords = yield* Context.get(stalledJournal, JournalStore).read(selected.runId)
          return expect.fail(`cancellation stalled after ${stalledRecords.map(({ event }) => event._tag).join(",")}`)
        }
        const cancellationExit = cancellationExitOption.value
        if (cancellationExit._tag === "Failure") {
          return expect.fail(
            `cancellation failed: records=${JSON.stringify(yield* Ref.get(cancellation.recordLog))} diagnostics=${JSON.stringify(yield* Ref.get(cancellation.diagnostics))}`
          )
        }
        expect(cancellationExit.value).toBe(0)
        expect(yield* fileSystem.exists(fixture.claimState)).toBe(false)

        const records = yield* Effect.scoped(
          Effect.gen(function* () {
            const journalContext = yield* Layer.build(
              sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
            )
            return yield* Context.get(journalContext, JournalStore).read(selected.runId)
          })
        )
        const tags = records.map(({ event }) => event._tag)
        const cancellationIndex = tags.indexOf("RunCancellationApplied")
        const stopIntentIndex = tags.lastIndexOf("PlannedAttemptExecutorCommandIntended")
        const stopProofIndex = tags.lastIndexOf("PlannedAttemptExecutorCommandResponseObserved")
        const abandonmentIndex = tags.indexOf("CancelledAttemptImplementationAbandoned")
        const claimReleaseIndex = tags.indexOf("TaskClaimReleaseIntended")
        const claimReadIndex = tags.findLastIndex(
          (tag, index) => tag === "TaskTrackerReadIntentRecorded" && index < claimReleaseIndex
        )
        const terminalIndex = tags.indexOf("WorkflowRunTerminated")
        expect(cancellationIndex).toBeGreaterThan(-1)
        expect(cancellationIndex).toBeLessThan(stopIntentIndex)
        expect(stopIntentIndex).toBeLessThan(stopProofIndex)
        expect(stopProofIndex).toBeLessThan(abandonmentIndex)
        expect(abandonmentIndex).toBeLessThan(claimReadIndex)
        expect(claimReadIndex).toBeLessThan(claimReleaseIndex)
        expect(claimReleaseIndex).toBeLessThan(terminalIndex)
        expect(records.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Cancelled" })

        const plan = records.find(({ event }) => event._tag === "TaskAttemptPlanned")
        if (plan?.event._tag !== "TaskAttemptPlanned") return expect.fail("cancellation fixture lost its attempt")
        expect(yield* fileSystem.exists(plan.event.operation.plannedAttempt.worktree)).toBe(true)
        expect(
          yield* fileSystem.readFileString(
            `${plan.event.operation.plannedAttempt.worktree}/cancellation-work-in-progress.txt`
          )
        ).toBe("preserved\n")
        expect(yield* fileSystem.exists(fixture.executorState)).toBe(true)
        expect(yield* fileSystem.exists(fixture.codexTranscript)).toBe(true)
        expect(yield* fileSystem.readFileString(fixture.evidenceMarker)).toBe("preserved\n")

        const redelivery = yield* spawnPublicProcess(
          fixture.config,
          fixture.claimState,
          fixture.cleanupObservation,
          fixture.cleanupRelease,
          fixture.cleanupWorktree,
          fixture.commonDirectory,
          fixture.gitFixtureDirectory,
          "cancellation",
          "cancel"
        )
        const redeliveredOption = yield* takeMatching(redelivery.records, ({ _tag }) => _tag === "RunSelected").pipe(
          Effect.timeoutOption("10 seconds")
        )
        if (redeliveredOption._tag === "None") {
          const exited = yield* Effect.timeoutOption(redelivery.handle.exitCode, "100 millis")
          if (exited._tag === "None") yield* stopAbruptly(redelivery)
          return expect.fail(
            `redelivery did not select: exit=${exited._tag === "Some" ? exited.value : "running"} records=${JSON.stringify(yield* Ref.get(redelivery.recordLog))} diagnostics=${JSON.stringify(yield* Ref.get(redelivery.diagnostics))}`
          )
        }
        const redelivered = redeliveredOption.value
        expect(redelivered).toEqual(recovered)
        const redeliveryExit = yield* Effect.timeoutOption(awaitGraceful(redelivery), "10 seconds")
        if (redeliveryExit._tag === "None") {
          yield* stopAbruptly(redelivery)
          return expect.fail(
            `redelivery did not exit: records=${JSON.stringify(yield* Ref.get(redelivery.recordLog))} diagnostics=${JSON.stringify(yield* Ref.get(redelivery.diagnostics))}`
          )
        }
        expect(redeliveryExit.value).toBe(0)
        expect((yield* Ref.get(redelivery.eventLog)).filter(({ _tag }) => _tag === "DeleteClaimLabelApplied")).toEqual(
          []
        )
        const redeliveredRecords = yield* Effect.scoped(
          Effect.gen(function* () {
            const journalContext = yield* Layer.build(
              sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
            )
            return yield* Context.get(journalContext, JournalStore).read(selected.runId)
          })
        )
        expect(redeliveredRecords).toEqual(records)
      }).pipe(Effect.provide(NodeServices.layer))
    ),
  60_000
)

for (const processEacces of [false, true])
  it.live(
    `already-terminal tracker state exits the public command once without active-refresh reactivation${processEacces ? " with injected process EACCES" : ""}`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* publicFixture
          const child = yield* spawnPublicProcess(
            fixture.config,
            fixture.claimState,
            fixture.cleanupObservation,
            fixture.cleanupRelease,
            fixture.cleanupWorktree,
            fixture.commonDirectory,
            fixture.gitFixtureDirectory,
            "terminal",
            "run",
            false,
            processEacces
          )
          const selectedOrExit = yield* Effect.raceFirst(
            takeMatching(child.records, ({ _tag }) => _tag === "RunSelected").pipe(
              Effect.map((record) => ({ _tag: "Selected" as const, record }))
            ),
            child.handle.exitCode.pipe(Effect.map((exitCode) => ({ _tag: "Exited" as const, exitCode })))
          )
          expect(selectedOrExit._tag).toBe("Selected")
          if (selectedOrExit._tag !== "Selected") return
          const selected = selectedOrExit.record
          const exitCode = yield* child.handle.exitCode
          yield* Effect.all([Fiber.join(child.stdoutFiber), Fiber.join(child.stderrFiber)])
          const diagnostics = yield* Ref.get(child.diagnostics)
          if (processEacces) {
            expect(diagnostics).toHaveLength(1)
            expect(diagnostics[0]).toMatchObject({ boundary: "NodeMainExit", outcome: "Failed", version: 1 })
            expect(
              diagnostics[0]?.reasons.every(
                (reason) =>
                  reason.error.errorTag === "CodexAppServerFailure" &&
                  reason.error.category === "Ownership" &&
                  reason.error.operation === "initialize"
              )
            ).toBe(true)
            expect(JSON.stringify(diagnostics)).toContain("CodexAppServerFailure")
            expect((yield* Ref.get(child.stderrLines)).join("\n")).not.toContain("controlled-github-token")
            expect((yield* Ref.get(child.stderrLines)).join("\n")).not.toContain("controlled-codex-credential")
          } else expect(diagnostics).toEqual([])
          const records = yield* Ref.get(child.recordLog)
          expect(exitCode).toBe(processEacces ? 1 : 0)
          yield* assertPublicLaunchCustody(fixture.executorState, processEacces)
          if (selected._tag !== "RunSelected") return
          expect(records.filter(({ _tag }) => _tag === "RunDisposition")).toHaveLength(1)
          expect(records.filter(({ _tag }) => _tag === "ApplicationExitDisposition")).toHaveLength(0)
          const closed = records.filter(isClosedStatusRecord)
          expect(closed).toHaveLength(1)
          expect(closed[0]).toMatchObject({
            _tag: "CurrentStatus",
            status: { _tag: "DeliveryStatusClosed", final: { subject: { _tag: "Run", runId: selected.runId } } }
          })
          const selectedIndex = records.findIndex(({ _tag }) => _tag === "RunSelected")
          const firstStatusIndex = records.findIndex(({ _tag }) => _tag === "CurrentStatus")
          const closedIndex = records.findIndex(
            (record) => record._tag === "CurrentStatus" && record.status._tag === "DeliveryStatusClosed"
          )
          const dispositionIndex = records.findIndex(({ _tag }) => _tag === "RunDisposition")
          expect(selectedIndex).toBeLessThan(firstStatusIndex)
          expect(firstStatusIndex).toBeLessThan(closedIndex)
          expect(closedIndex).toBeLessThan(dispositionIndex)
          const events = yield* Ref.get(child.eventLog)
          expect(events.filter(({ _tag }) => _tag === "CreateClaimLabelStarted")).toHaveLength(0)
          expect(events).toContainEqual({
            _tag: "ReadIssueReturned",
            issueNodeId: "production-public-recovery-issue",
            state: "CLOSED"
          })
          const journalContext = yield* Layer.build(
            sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
          )
          const journal = yield* Context.get(journalContext, JournalStore).read(selected.runId)
          expect(journal.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        }).pipe(Effect.provide(NodeServices.layer))
      ),
    60_000
  )

for (const processEacces of [false, true])
  it.live(
    `application Exit during recovered Git cleanup closes the attached public status without claiming Run completion${processEacces ? " with injected process EACCES" : ""}`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* publicFixture
          const fileSystem = yield* FileSystem.FileSystem
          const trackerTarget = GithubIssueTarget.make({
            issueNumber: GithubIssueNumber.make(42),
            owner: GithubRepositoryOwner.make("octo"),
            repository: GithubRepositoryName.make("dalph")
          })
          const runId = yield* freshWorkflowRunId(trackerTarget)
          const cleanupTaskRevision = encodeTaskRevisionFingerprint(
            JSON.stringify({ body: "cleanup provenance predecessor", title: "cleanup provenance predecessor" })
          )
          const plannedAttempt = PlannedTaskAttempt.make({
            attemptId: AttemptId.make("issue-300-closed-null"),
            baseSha: fixture.baseSha,
            branch: TaskBranchRef.make("refs/heads/task/issue-300-closed-null"),
            executor: TaskExecutorLocator.make("codex:issue-300-closed-null"),
            runId,
            taskId: TaskId.make("issue-300-closed-null"),
            taskRevision: cleanupTaskRevision,
            worktree: WorktreeLocator.make(fixture.cleanupWorktree)
          })
          const successorAttempt = PlannedTaskAttempt.make({
            ...plannedAttempt,
            attemptId: AttemptId.make("issue-300-closed-null-successor"),
            branch: TaskBranchRef.make("refs/heads/task/issue-300-closed-null-successor"),
            taskRevision: encodeTaskRevisionFingerprint(
              JSON.stringify({ body: "cleanup provenance witness", title: "cleanup provenance witness" })
            ),
            worktree: WorktreeLocator.make(`${fixture.cleanupWorktree}-successor`)
          })
          yield* Effect.scoped(
            Effect.gen(function* () {
              const storageContext = yield* Layer.build(
                sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.journalDatabase) })
              )
              const storage = Context.get(storageContext, JournalStore)
              yield* storage.beginRun(
                runId,
                trackerTarget,
                InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
                fixture.remotePublicationTarget
              )
              const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
              if (initial._tag === "InvalidWorkflowJournalHistory") {
                return yield* Effect.die(
                  `replacement fixture initial history is invalid: ${JSON.stringify(initial.issues)}`
                )
              }
              const journalContext = yield* Layer.build(journalLayer(runId, trackerTarget, initial, storage))
              yield* appendReplacementProvenance(plannedAttempt, successorAttempt, "StartupValid").pipe(
                Effect.provide(journalContext)
              )
              const accepted = yield* Context.get(journalContext, AcceptedJournalReader).readAccepted(runId)
              expect(accepted.runId).toBe(runId)
              const reduced = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
              expect(reduced._tag).toBe("ValidWorkflowJournalHistory")
            })
          )

          const child = yield* spawnPublicProcess(
            fixture.config,
            fixture.claimState,
            fixture.cleanupObservation,
            fixture.cleanupRelease,
            fixture.cleanupWorktree,
            fixture.commonDirectory,
            fixture.gitFixtureDirectory,
            "exit-during-attachment",
            "run",
            false,
            processEacces
          )
          const selectedOrExit = yield* Effect.raceFirst(
            takeMatching(child.records, ({ _tag }) => _tag === "RunSelected").pipe(
              Effect.map((record) => ({ _tag: "Selected" as const, record }))
            ),
            child.handle.exitCode.pipe(Effect.map((exitCode) => ({ _tag: "Exited" as const, exitCode })))
          )
          if (selectedOrExit._tag !== "Selected") {
            yield* awaitGraceful(child)
            expect.fail(
              `the recovered command exited with status ${selectedOrExit.exitCode} before RunSelected: ${JSON.stringify(yield* Ref.get(child.recordLog))}`
            )
          }
          const selected = selectedOrExit.record
          expect(selected).toMatchObject({ runId, selection: "Recovered" })
          while (!(yield* fileSystem.exists(fixture.cleanupObservation))) {
            yield* Effect.sleep("10 millis")
          }
          const cleanupStarted = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CleanupGitObservation))(
            yield* fileSystem.readFileString(fixture.cleanupObservation)
          )
          expect(cleanupStarted).toEqual({
            _tag: "CleanupGitObservationStarted",
            cleanupWorktree: fixture.cleanupWorktree,
            commonDirectory: fixture.commonDirectory
          })
          yield* takeMatching(
            child.records,
            (record) => record._tag === "CurrentStatus" && record.status._tag === "DeliveryStatusNotReady"
          )
          yield* Effect.sync(() => nodeProcess.kill(child.handle.pid, "SIGTERM"))
          yield* fileSystem.writeFileString(fixture.cleanupRelease, "release after application Exit request")
          const exitCode = yield* child.handle.exitCode
          yield* Effect.all([Fiber.join(child.stdoutFiber), Fiber.join(child.stderrFiber)])
          const diagnostics = yield* Ref.get(child.diagnostics)
          if (processEacces) {
            expect(diagnostics).toHaveLength(1)
            expect(diagnostics[0]).toMatchObject({ boundary: "NodeMainExit", outcome: "Failed", version: 1 })
            expect(
              diagnostics[0]?.reasons.every(
                (reason) =>
                  reason.error.errorTag === "ProductionCliLifecycleError" &&
                  reason.error.code === "lifecycle.exit_failed"
              )
            ).toBe(true)
            expect(yield* Ref.get(child.exitDiagnostics)).toMatchObject([{ _tag: "Failed" }])
            expect((yield* Ref.get(child.stderrLines)).join("\n")).not.toContain("controlled-github-token")
            expect((yield* Ref.get(child.stderrLines)).join("\n")).not.toContain("controlled-codex-credential")
          } else expect(diagnostics).toEqual([])
          expect(exitCode).toBe(processEacces ? 1 : 0)
          yield* assertPublicLaunchCustody(fixture.executorState, processEacces)
          if (selected._tag !== "RunSelected") return
          const events = yield* Ref.get(child.eventLog)
          expect(
            events.filter(
              ({ _tag }) =>
                _tag === "CreateClaimLabelStarted" || _tag === "DeleteClaimLabelApplied" || _tag === "CodexTurnStarted"
            )
          ).toEqual([])
          const records = yield* Ref.get(child.recordLog)
          expect(records.filter(({ _tag }) => _tag === "RunDisposition")).toHaveLength(0)
          expect(records.filter(({ _tag }) => _tag === "ApplicationExitDisposition")).toEqual([
            {
              _tag: "ApplicationExitDisposition",
              disposition: processEacces
                ? { _tag: "Failed", requestedStatus: 1 }
                : { _tag: "Succeeded", requestedStatus: 0 },
              runId: selected.runId,
              version: 1
            }
          ])
          const closed = records.filter(isClosedStatusRecord)
          expect(closed).toHaveLength(processEacces ? 0 : 1)
          if (processEacces) {
            expect(records.findIndex(({ _tag }) => _tag === "RunSelected")).toBeLessThan(
              records.findIndex(({ _tag }) => _tag === "ApplicationExitDisposition")
            )
            return
          }
          expect(closed[0]).toMatchObject({
            _tag: "CurrentStatus",
            status: {
              _tag: "DeliveryStatusClosed",
              final: { _tag: "DeliveryStatusAvailable", subject: { _tag: "Run", runId: selected.runId } },
              subject: { _tag: "Run", runId: selected.runId }
            },
            version: 1
          })
          if (closed[0]?.status.final?._tag !== "DeliveryStatusAvailable") return
          expect(closed[0].status.final.entries.length).toBeGreaterThan(0)
          expect(closed[0].status.final.entries.filter(({ _tag }) => _tag === "LiveDeliveryAction")).toEqual([])
          const notReadyIndex = records.findIndex(
            (record) => record._tag === "CurrentStatus" && record.status._tag === "DeliveryStatusNotReady"
          )
          const closedIndex = records.findIndex(
            (record) => record._tag === "CurrentStatus" && record.status._tag === "DeliveryStatusClosed"
          )
          const exitIndex = records.findIndex(({ _tag }) => _tag === "ApplicationExitDisposition")
          expect(notReadyIndex).toBeLessThan(closedIndex)
          expect(closedIndex).toBeLessThan(exitIndex)
        }).pipe(Effect.provide(NodeCrypto.layer), Effect.provide(NodeServices.layer))
      ),
    60_000
  )

it.effect("public stdout decoder rejects a runtime cause dump instead of filtering it", () =>
  Effect.gen(function* () {
    const result = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProductionCliRecord))(
      "[01:47:52.275] ERROR (#3): CodexAppServerFailure: controlled EACCES"
    ).pipe(Effect.result)
    expect(result._tag).toBe("Failure")
  })
)

it.live(
  "built public recovery rejects a dirty stdout negative control",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* publicFixture
        const child = yield* spawnPublicProcess(
          fixture.config,
          fixture.claimState,
          fixture.cleanupObservation,
          fixture.cleanupRelease,
          fixture.cleanupWorktree,
          fixture.commonDirectory,
          fixture.gitFixtureDirectory,
          "terminal",
          "run",
          false,
          true,
          true
        )
        expect(yield* child.handle.exitCode).toBe(1)
        const stdout = yield* Fiber.join(child.stdoutFiber).pipe(Effect.result)
        expect(stdout._tag).toBe("Failure")
        if (stdout._tag === "Failure") expect(stdout.failure).toMatchObject({ _tag: "InvalidPublicStdoutRecord" })
        yield* Fiber.join(child.stderrFiber)
      }).pipe(Effect.provide(NodeServices.layer))
    ),
  15_000
)
