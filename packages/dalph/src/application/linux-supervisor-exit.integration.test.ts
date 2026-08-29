/* eslint-disable import/no-nodejs-modules -- Linux qualification deliberately controls real Node child processes. */
import { NodeFileSystem, NodePath, NodeServices } from "@effect/platform-node"
import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import {
  GitCommand,
  GitCommonDirectoryTarget,
  GitWorktree,
  PlannedWorktreeReady,
  nodeGitCommandLayer,
  nodeGitWorktreeLayer
} from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Deferred, Effect, Fiber, FileSystem, Layer, Path, Ref, Schema, Stream } from "effect"
import nodeProcess from "node:process"
import { expect } from "vitest"
import {
  fixtureTaskBranch,
  type HostFixtureInput,
  JournalEvidenceLocator,
  makeFixturePlannedAttempt,
  preservedArtifact,
  preservedArtifactContents
} from "../../bin/linux-application-exit-host-fixture-contract.js"

const LifecycleLine = Schema.Struct({
  lifecycle: Schema.optionalKey(
    Schema.Struct({
      _tag: Schema.optionalKey(Schema.String),
      result: Schema.optionalKey(
        Schema.Struct({ _tag: Schema.optionalKey(Schema.String), requestedStatus: Schema.optionalKey(Schema.Finite) })
      )
    })
  ),
  controlledExecutor: Schema.optionalKey(Schema.String),
  journalEvents: Schema.optionalKey(Schema.Array(Schema.String)),
  llmRequests: Schema.optionalKey(Schema.Finite),
  lockAcquired: Schema.optionalKey(Schema.Boolean),
  observedAt: Schema.optionalKey(Schema.Finite),
  ready: Schema.optionalKey(Schema.Boolean),
  repeatedSignalSent: Schema.optionalKey(Schema.Boolean),
  worktreeEvidence: Schema.optionalKey(
    Schema.Struct({ artifact: Schema.String, baseSha: GitCommitSha, worktree: WorktreeLocator })
  )
})
type LifecycleLine = typeof LifecycleLine.Type

const nodeLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)
const fixture = new URL("../../dist/bin/linux-application-exit-host-fixture.js", import.meta.url).pathname
const dalphPackageDirectory = new URL("../../", import.meta.url).pathname

const childCommand = (input: HostFixtureInput) =>
  ChildProcess.make(
    nodeProcess.execPath,
    [
      fixture,
      input.mode,
      input.gitCommonDirectory,
      ...(input.journalPath === undefined && input.mode !== "running" ? [] : [input.journalPath ?? "-"]),
      ...(input.mode === "running" ? [input.worktree, input.baseSha] : [])
    ],
    { cwd: dalphPackageDirectory }
  )

const readJsonLines = (handle: ChildProcessSpawner.ChildProcessHandle) =>
  handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.mapEffect((line) => Schema.decodeUnknownEffect(Schema.fromJsonString(LifecycleLine))(line))
  )

const spawnReadyChild = Effect.fn("LinuxSupervisorExit.Test.spawnReadyChild")(function* (input: HostFixtureInput) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const handle = yield* spawner.spawn(childCommand(input))
  const observed = yield* Ref.make<ReadonlyArray<LifecycleLine>>([])
  const exitRequested = yield* Deferred.make<void>()
  const ready = yield* Deferred.make<void>()
  const collector = yield* readJsonLines(handle).pipe(
    Stream.runForEach((line) =>
      Ref.update(observed, (current) => [...current, line]).pipe(
        Effect.andThen(line.ready === true ? Deferred.succeed(ready, undefined) : Effect.void),
        Effect.andThen(
          line.lifecycle?._tag === "ExitRequested" ? Deferred.succeed(exitRequested, undefined) : Effect.void
        )
      )
    ),
    Effect.forkScoped
  )
  yield* Deferred.await(ready)
  return { collector, exitRequested: Deferred.await(exitRequested), handle, observed }
})

interface TemporaryFixturePaths {
  readonly gitCommonDirectory: GitCommonDirectoryTarget
  readonly journal: JournalEvidenceLocator
  readonly root: string
}

const temporaryDirectory = <A, E, R>(use: (paths: TemporaryFixturePaths) => Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-linux-exit-host-" })
      const directory = path.join(root, "git-common-directory")
      const journal = path.join(root, "run-journal.txt")
      yield* fileSystem.makeDirectory(directory)
      return yield* use({
        gitCommonDirectory: GitCommonDirectoryTarget.make(directory),
        journal: JournalEvidenceLocator.make(journal),
        root
      })
    })
  ).pipe(Effect.provide(nodeLayer))

const signal = (handle: ChildProcessSpawner.ChildProcessHandle, killSignal: "SIGKILL" | "SIGTERM") =>
  Effect.sync(() => {
    nodeProcess.kill(handle.pid, killSignal)
  })

const runGit = Effect.fn("LinuxSupervisorExit.Test.runGit")(function* (directory: string, args: ReadonlyArray<string>) {
  const git = yield* GitCommand
  const result = yield* git.runInWorktree(directory, args)
  if (result.exitCode !== 0) return yield* Effect.die(`git ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout
})

const makePhysicalRunningWorktree = Effect.fn("LinuxSupervisorExit.Test.makePhysicalRunningWorktree")(function* (
  root: string
) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const repository = path.join(root, "repository")
  const worktree = path.join(root, "planned-worktree")
  const artifact = path.join(worktree, preservedArtifact)
  yield* fileSystem.makeDirectory(repository)
  yield* runGit(repository, ["init"])
  yield* runGit(repository, ["config", "user.email", "dalph@example.invalid"])
  yield* runGit(repository, ["config", "user.name", "Dalph Exit Fixture"])
  yield* fileSystem.writeFileString(path.join(repository, "README.md"), "application Exit fixture\n")
  yield* runGit(repository, ["add", "README.md"])
  yield* runGit(repository, ["commit", "-m", "fixture base"])
  const baseSha = yield* Schema.decodeUnknownEffect(GitCommitSha)(
    (yield* runGit(repository, ["rev-parse", "HEAD"])).trim()
  )
  yield* runGit(repository, ["worktree", "add", "-b", fixtureTaskBranch.slice("refs/heads/".length), worktree, baseSha])
  yield* fileSystem.writeFileString(artifact, preservedArtifactContents)
  const gitCommonDirectory = GitCommonDirectoryTarget.make(path.join(repository, ".git"))
  const running = {
    baseSha,
    gitCommonDirectory,
    journalPath: undefined,
    mode: "running",
    worktree: WorktreeLocator.make(worktree)
  } as const
  return { artifact, gitCommonDirectory, plannedAttempt: makeFixturePlannedAttempt(running), repository, running }
})

it.live(
  "an idle Linux child reports successful Exit and status zero after SIGTERM",
  () =>
    temporaryDirectory(({ gitCommonDirectory }) =>
      Effect.gen(function* () {
        const { collector, handle, observed } = yield* spawnReadyChild({
          gitCommonDirectory,
          journalPath: undefined,
          mode: "idle"
        })
        yield* signal(handle, "SIGTERM")
        expect(yield* handle.exitCode).toBe(0)
        yield* Fiber.join(collector)
        const lifecycle = yield* Ref.get(observed)

        expect(lifecycle.find(({ lifecycle }) => lifecycle?._tag === "ExitResultReported")).toMatchObject({
          lifecycle: { _tag: "ExitResultReported", result: { _tag: "Succeeded", requestedStatus: 0 } }
        })
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  120_000
)

it.live(
  "a running controlled executor suspends before its Linux child exits zero",
  () =>
    temporaryDirectory(({ journal, root }) =>
      Effect.gen(function* () {
        const physical = yield* makePhysicalRunningWorktree(root)
        const { collector, handle, observed } = yield* spawnReadyChild({ ...physical.running, journalPath: journal })
        yield* signal(handle, "SIGTERM")
        expect(yield* handle.exitCode).toBe(0)
        yield* Fiber.join(collector)
        const lifecycle = yield* Ref.get(observed)
        const fastRequest = lifecycle.find(({ controlledExecutor }) => controlledExecutor === "FastSuspensionRequested")
        const journalEvidence = lifecycle.find(({ journalEvents }) => journalEvents !== undefined)
        const result = lifecycle.findIndex(({ lifecycle }) => lifecycle?._tag === "ExitResultReported")
        expect(fastRequest).toEqual({ controlledExecutor: "FastSuspensionRequested", llmRequests: 0 })
        expect(lifecycle.find(({ worktreeEvidence }) => worktreeEvidence !== undefined)?.worktreeEvidence).toEqual({
          artifact: preservedArtifactContents,
          baseSha: physical.running.baseSha,
          worktree: physical.running.worktree
        })
        expect(journalEvidence?.journalEvents).toEqual([
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorWorkReported",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorCommandResponseObserved",
          "PlannedAttemptExecutorWorkReported"
        ])
        expect(journalEvidence === undefined ? -1 : lifecycle.indexOf(journalEvidence)).toBeLessThan(result)
        const fileSystem = yield* FileSystem.FileSystem
        expect(yield* fileSystem.readFileString(physical.artifact)).toBe(preservedArtifactContents)
        const observedWorktree = yield* Effect.gen(function* () {
          return yield* (yield* GitWorktree).readPlannedWorktree(physical.plannedAttempt)
        }).pipe(
          Effect.provide(
            nodeGitWorktreeLayer(GitCommonDirectoryTarget.make(physical.gitCommonDirectory)).pipe(
              Layer.provide(nodeGitCommandLayer),
              Layer.provide(NodeServices.layer)
            )
          )
        )
        expect(observedWorktree).toEqual(
          PlannedWorktreeReady.make({
            baseSha: physical.running.baseSha,
            branch: TaskBranchRef.make(fixtureTaskBranch),
            headSha: physical.running.baseSha,
            worktree: physical.running.worktree
          })
        )
        yield* Schema.decodeUnknownEffect(Schema.Literal(`?? ${preservedArtifact}\n`))(
          yield* runGit(physical.running.worktree, ["status", "--porcelain", "--", preservedArtifact])
        )
      })
    ).pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, nodeGitCommandLayer.pipe(Layer.provide(NodeServices.layer))))
    ),
  120_000
)

it.live(
  "repeated SIGTERM joins the original stuck Linux child drain and exits nonzero at five seconds",
  () =>
    temporaryDirectory(({ gitCommonDirectory }) =>
      Effect.gen(function* () {
        const { collector, handle, observed } = yield* spawnReadyChild({
          gitCommonDirectory,
          journalPath: undefined,
          mode: "stuck-repeat"
        })
        yield* signal(handle, "SIGTERM")
        expect(yield* handle.exitCode).toBe(1)
        yield* Fiber.join(collector)
        const lifecycle = yield* Ref.get(observed)
        const requests = lifecycle.filter(({ lifecycle }) => lifecycle?._tag === "ExitRequested")
        const cutoff = lifecycle.findIndex(({ lifecycle }) => lifecycle?._tag === "AdmissionCutoffClosed")
        const repeatedRequest = lifecycle.findLastIndex(({ lifecycle }) => lifecycle?._tag === "ExitRequested")
        const result = lifecycle.find(({ lifecycle }) => lifecycle?.result?._tag === "TimedOut")
        const firstRequestedAt = requests[0]?.observedAt
        const repeatedAt = requests[1]?.observedAt
        const resultAt = result?.observedAt

        expect(requests).toHaveLength(2)
        expect(cutoff).toBeGreaterThanOrEqual(0)
        expect(cutoff).toBeLessThan(repeatedRequest)
        expect(lifecycle.find(({ repeatedSignalSent }) => repeatedSignalSent === true)).toBeDefined()
        expect(result).toBeDefined()
        expect(firstRequestedAt).toBeTypeOf("number")
        expect(repeatedAt).toBeTypeOf("number")
        expect(resultAt).toBeTypeOf("number")
        if (firstRequestedAt === undefined || repeatedAt === undefined || resultAt === undefined) {
          return yield* Effect.die("the child did not report complete lifecycle timing evidence")
        }
        expect(resultAt - firstRequestedAt).toBeGreaterThanOrEqual(4_500)
        expect(resultAt - firstRequestedAt).toBeLessThan(5_750)
        expect(repeatedAt).toBeGreaterThanOrEqual(firstRequestedAt)
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  120_000
)

it.live(
  "signal receipt, scope closure, and unexpected death leave only the ordinary journal prefix",
  () =>
    Effect.forEach(["SIGTERM", "SIGKILL"] as const, (killSignal) =>
      temporaryDirectory(({ gitCommonDirectory, journal }) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const { collector, handle, observed } = yield* spawnReadyChild({
            gitCommonDirectory,
            journalPath: journal,
            mode: "idle"
          })
          yield* signal(handle, killSignal)
          const status = yield* Effect.exit(handle.exitCode)
          yield* Fiber.join(collector)

          expect(status).toMatchObject(killSignal === "SIGTERM" ? { _tag: "Success", value: 0 } : { _tag: "Failure" })
          expect(yield* fileSystem.readFileString(journal)).toBe("WorkflowRunBegan\n")
          const lifecycle = (yield* Ref.get(observed)).filter(({ lifecycle }) => lifecycle !== undefined)
          expect(lifecycle.length > 0).toBe(killSignal === "SIGTERM")
        })
      )
    ).pipe(Effect.provide(NodeServices.layer)),
  120_000
)

it.live(
  "a successor Linux child acquires the coordinator lock after zero success and nonzero failed or timed-out Exit",
  () =>
    Effect.forEach(["idle", "failed", "stuck"] as const, (mode) =>
      temporaryDirectory(({ gitCommonDirectory }) =>
        Effect.gen(function* () {
          const { collector, handle, observed } = yield* spawnReadyChild({
            gitCommonDirectory,
            journalPath: undefined,
            mode
          })
          yield* signal(handle, "SIGTERM")
          const exitCode = yield* handle.exitCode
          yield* Fiber.join(collector)
          const expectedResult = mode === "idle" ? "Succeeded" : mode === "failed" ? "Failed" : "TimedOut"
          expect(exitCode).toBe(mode === "idle" ? 0 : 1)
          expect(
            (yield* Ref.get(observed)).find(({ lifecycle }) => lifecycle?.result?._tag === expectedResult)
          ).toBeDefined()

          const successor = yield* spawnReadyChild({ gitCommonDirectory, journalPath: undefined, mode: "acquire-once" })
          expect(yield* successor.handle.exitCode).toBe(0)
          yield* Fiber.join(successor.collector)
          expect((yield* Ref.get(successor.observed)).find(({ lockAcquired }) => lockAcquired === true)).toBeDefined()
        }).pipe(Effect.provide(NodeServices.layer))
      )
    ),
  180_000
)
