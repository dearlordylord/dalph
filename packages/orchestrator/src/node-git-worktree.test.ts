import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, PlatformError, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { describe, expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  GitCommonDirectoryTarget,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TaskWorkSessionLocator,
  WorktreeLocator
} from "./domain.js"
import { GitCommand, GitCommandInvocationFailure, GitCommandResult, nodeGitCommandLayer } from "./git-command.js"
import {
  CompetingWorktreeRegistrations,
  ConflictingWorktreeRegistration,
  ContradictoryWorktreeState,
  ForeignWorktreeRegistration,
  GitWorktree,
  GitWorktreeCreateFailure,
  GitWorktreeReadFailure,
  type GitWorktreeService,
  runGitWorktreeReconciliation,
  UntrackedWorktreePath,
  WorktreeBaseMismatch
} from "./git-worktree.js"
import { nodeGitWorktreeLayer } from "./node-git-worktree.js"

const run = Effect.fn("GitWorktree.Test.runGit")(function*(
  cwd: string,
  ...args: ReadonlyArray<string>
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* Effect.scoped(Effect.gen(function*() {
    const handle = yield* spawner.spawn(ChildProcess.make("git", args, { cwd }))
    const [exitCode, stderr, stdout] = yield* Effect.all([
      handle.exitCode,
      handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
      handle.stdout.pipe(Stream.decodeText(), Stream.mkString)
    ], { concurrency: "unbounded" })
    if (exitCode !== 0) return yield* Effect.die(`git ${args.join(" ")} failed: ${stderr}`)
    return stdout.trim()
  }))
})

const makePlan = (
  baseSha: GitCommitSha,
  branch: string,
  worktree: string
) =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make("attempt-node-45"),
    baseSha,
    branch: TaskBranchRef.make(`refs/heads/${branch}`),
    executor: TaskExecutorLocator.make("executor:test"),
    runId: RunId.make("run-45"),
    session: TaskWorkSessionLocator.make("session:45"),
    taskId: TaskId.make("task-45"),
    taskRevision: TaskRevision.make("revision-45"),
    worktree: WorktreeLocator.make(worktree)
  })

const withRepository = <A, E, R>(
  use: (fields: {
    readonly baseSha: GitCommitSha
    readonly directory: string
    readonly gitDirectory: GitCommonDirectoryTarget
  }) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "dalph-git-worktree-test-"
    })
    const repository = `${directory}/repository`
    yield* fileSystem.makeDirectory(repository)
    yield* run(repository, "init", "--initial-branch=master")
    yield* run(repository, "config", "user.email", "dalph@example.invalid")
    yield* run(repository, "config", "user.name", "Dalph Test")
    yield* run(repository, "commit", "--allow-empty", "-m", "base")
    const baseSha = GitCommitSha.make(yield* run(repository, "rev-parse", "HEAD"))
    return yield* use({
      baseSha,
      directory,
      gitDirectory: GitCommonDirectoryTarget.make(`${repository}/.git`)
    })
  }).pipe(Effect.provide(NodeServices.layer))

const adapterLayer = (gitDirectory: GitCommonDirectoryTarget) =>
  nodeGitWorktreeLayer(gitDirectory).pipe(
    Layer.provide(nodeGitCommandLayer),
    Layer.provide(NodeServices.layer)
  )

const commandResult = (
  exitCode: number,
  stdout = "",
  stderr = ""
) => GitCommandResult.make({ exitCode, stderr, stdout })

const scriptedAdapterLayer = (
  gitDirectory: GitCommonDirectoryTarget,
  execute: (args: ReadonlyArray<string>) => Effect.Effect<
    GitCommandResult,
    GitCommandInvocationFailure
  >
) =>
  nodeGitWorktreeLayer(gitDirectory).pipe(
    Layer.provide(Layer.succeed(
      GitCommand,
      GitCommand.of({
        run: (_directory, args) => execute(args),
        runInWorktree: () => Effect.die("unused worktree command"),
        runBytesInWorktree: () => Effect.die("unused byte worktree command")
      })
    )),
    Layer.provide(NodeServices.layer)
  )

describe("node GitWorktree adapter", () => {
  it.effect("creates and rediscovers the exact isolated worktree", () =>
    Effect.scoped(withRepository(({ baseSha, directory, gitDirectory }) =>
      Effect.gen(function*() {
        const plan = makePlan(baseSha, "dalph/task-45", `${directory}/task-45`)
        const git = yield* GitWorktree

        const created = yield* runGitWorktreeReconciliation(git, plan)
        const rediscovered = yield* runGitWorktreeReconciliation(git, plan)

        expect(created).toMatchObject({
          _tag: "PlannedWorktreeReady",
          baseSha,
          branch: plan.branch,
          headSha: baseSha,
          worktree: plan.worktree
        })
        expect(rediscovered).toEqual(created)
      }).pipe(Effect.provide(adapterLayer(gitDirectory)))
    )))

  it.effect("preserves a mismatched branch without repair", () =>
    Effect.scoped(withRepository(({ baseSha, directory, gitDirectory }) =>
      Effect.gen(function*() {
        const repository = `${directory}/repository`
        yield* run(repository, "checkout", "--orphan", "unrelated")
        yield* run(repository, "commit", "--allow-empty", "-m", "unrelated")
        const unrelatedHead = yield* run(repository, "rev-parse", "HEAD")
        yield* run(repository, "checkout", "master")
        const plan = makePlan(baseSha, "unrelated", `${directory}/mismatch`)
        const git = yield* GitWorktree

        const failure = yield* Effect.flip(runGitWorktreeReconciliation(git, plan))

        expect(failure).toBeInstanceOf(WorktreeBaseMismatch)
        expect(yield* run(repository, "rev-parse", plan.branch)).toBe(unrelatedHead)
        expect(
          yield* FileSystem.FileSystem.pipe(
            Effect.flatMap((fileSystem) => fileSystem.exists(plan.worktree))
          )
        ).toBe(false)
      }).pipe(Effect.provide(adapterLayer(gitDirectory)))
    )))

  it.effect("classifies untracked, foreign, and conflicting resources without deleting them", () =>
    Effect.scoped(withRepository(({ baseSha, directory, gitDirectory }) =>
      Effect.gen(function*() {
        const repository = `${directory}/repository`
        const fileSystem = yield* FileSystem.FileSystem
        const git = yield* GitWorktree

        const untracked = makePlan(baseSha, "untracked", `${directory}/untracked`)
        yield* fileSystem.makeDirectory(untracked.worktree)
        expect(yield* Effect.flip(runGitWorktreeReconciliation(git, untracked)))
          .toBeInstanceOf(UntrackedWorktreePath)
        expect(yield* fileSystem.exists(untracked.worktree)).toBe(true)

        const foreignPath = `${directory}/foreign`
        yield* run(repository, "worktree", "add", "-b", "foreign", foreignPath, baseSha)
        const foreign = makePlan(baseSha, "foreign", `${directory}/expected-foreign`)
        expect(yield* Effect.flip(runGitWorktreeReconciliation(git, foreign)))
          .toBeInstanceOf(ForeignWorktreeRegistration)
        expect(yield* fileSystem.exists(foreignPath)).toBe(true)

        const conflictingPath = `${directory}/conflicting`
        yield* run(repository, "worktree", "add", "-b", "other", conflictingPath, baseSha)
        const conflicting = makePlan(baseSha, "expected", conflictingPath)
        expect(yield* Effect.flip(runGitWorktreeReconciliation(git, conflicting)))
          .toBeInstanceOf(ConflictingWorktreeRegistration)
        expect(yield* run(conflictingPath, "rev-parse", "--abbrev-ref", "HEAD"))
          .toBe("other")
      }).pipe(Effect.provide(adapterLayer(gitDirectory)))
    )))

  it.effect("decodes branch-only, detached, duplicate, and malformed Git observations", () =>
    Effect.scoped(withRepository(({ baseSha, directory, gitDirectory }) => {
      const plan = makePlan(baseSha, "scripted", `${directory}/scripted`)
      const readWith = (
        execute: (args: ReadonlyArray<string>) => Effect.Effect<GitCommandResult>
      ) =>
        Effect.gen(function*() {
          const git = yield* GitWorktree
          return yield* git.readPlannedWorktree(plan)
        }).pipe(Effect.provide(scriptedAdapterLayer(gitDirectory, execute)))
      const atPath = (branchLine: string) => `worktree ${plan.worktree}\0HEAD ${baseSha}\0${branchLine}\0\0`

      return Effect.gen(function*() {
        const branchOnly = yield* readWith((args) =>
          Effect.succeed(
            args[0] === "worktree"
              ? commandResult(0)
              : args[0] === "rev-parse"
              ? commandResult(0, `${baseSha}\n`)
              : commandResult(0)
          )
        )
        expect(branchOnly).toMatchObject({ _tag: "PlannedBranchReady", headSha: baseSha })

        const competingWorktree = WorktreeLocator.make(`${directory}/competing`)
        const competing = yield* readWith(() =>
          Effect.succeed(commandResult(
            0,
            `worktree ${plan.worktree}\0HEAD ${baseSha}\0branch refs/heads/other\0\0`
              + `worktree ${competingWorktree}\0HEAD ${baseSha}\0branch ${plan.branch}\0\0`
          ))
        ).pipe(Effect.flip)
        expect(competing).toBeInstanceOf(CompetingWorktreeRegistrations)
        expect(competing).toMatchObject({
          observedBranchAtPlannedWorktree: "refs/heads/other",
          plannedBranch: plan.branch,
          plannedBranchRegisteredWorktree: competingWorktree,
          plannedWorktree: plan.worktree
        })

        for (
          const output of [
            atPath("detached"),
            `${atPath(`branch ${plan.branch}`)}${atPath(`branch ${plan.branch}`)}`,
            `worktree ${plan.worktree}\0worktree /duplicate\0HEAD ${baseSha}\0branch ${plan.branch}\0\0`,
            `worktree ${plan.worktree}\0HEAD not-a-sha\0branch ${plan.branch}\0\0`
          ]
        ) {
          const failure = yield* readWith(() => Effect.succeed(commandResult(0, output))).pipe(
            Effect.flip
          )
          expect(failure).toBeInstanceOf(ContradictoryWorktreeState)
        }
      })
    })))

  it.effect("maps Git read and create command failures to typed boundary failures", () =>
    Effect.scoped(withRepository(({ baseSha, directory, gitDirectory }) => {
      const plan = makePlan(baseSha, "failures", `${directory}/failures`)
      const withScript = <A, E>(
        execute: (args: ReadonlyArray<string>) => Effect.Effect<GitCommandResult, GitCommandInvocationFailure>,
        use: (git: GitWorktreeService) => Effect.Effect<A, E>
      ) =>
        Effect.gen(function*() {
          return yield* use(yield* GitWorktree)
        }).pipe(Effect.provide(scriptedAdapterLayer(gitDirectory, execute)))

      return Effect.gen(function*() {
        expect(
          yield* withScript(
            () => Effect.fail(new GitCommandInvocationFailure({ detail: "read spawn failed" })),
            (git) => Effect.flip(git.readPlannedWorktree(plan))
          )
        ).toBeInstanceOf(GitWorktreeReadFailure)

        expect(
          yield* withScript(
            () => Effect.succeed(commandResult(2, "", "list failed")),
            (git) => Effect.flip(git.readPlannedWorktree(plan))
          )
        ).toBeInstanceOf(GitWorktreeReadFailure)

        expect(
          yield* withScript(
            (args) =>
              Effect.succeed(
                args[0] === "worktree" ? commandResult(0) : commandResult(0, "not-a-sha")
              ),
            (git) => Effect.flip(git.readPlannedWorktree(plan))
          )
        ).toBeInstanceOf(ContradictoryWorktreeState)

        expect(
          yield* withScript(
            (args) =>
              Effect.succeed(
                args[0] === "worktree" ? commandResult(0) : commandResult(2)
              ),
            (git) => Effect.flip(git.readPlannedWorktree(plan))
          )
        ).toBeInstanceOf(GitWorktreeReadFailure)

        expect(
          yield* withScript(
            (args) =>
              Effect.succeed(
                args[0] === "worktree"
                  ? commandResult(0, `worktree ${plan.worktree}\0HEAD ${baseSha}\0branch ${plan.branch}\0\0`)
                  : commandResult(2)
              ),
            (git) => Effect.flip(git.readPlannedWorktree(plan))
          )
        ).toBeInstanceOf(GitWorktreeReadFailure)

        expect(
          yield* withScript(
            () => Effect.fail(new GitCommandInvocationFailure({ detail: "spawn failed" })),
            (git) => Effect.flip(git.createPlannedWorktree(plan))
          )
        ).toBeInstanceOf(GitWorktreeCreateFailure)

        expect(
          yield* withScript(
            () => Effect.succeed(commandResult(2, "", "branch read failed")),
            (git) => Effect.flip(git.createPlannedWorktree(plan))
          )
        ).toBeInstanceOf(GitWorktreeCreateFailure)

        let calls = 0
        expect(
          yield* withScript(
            () =>
              Effect.sync(() => {
                calls += 1
                return calls === 1 ? commandResult(1) : commandResult(2, "", "add failed")
              }),
            (git) => Effect.flip(git.createPlannedWorktree(plan))
          )
        ).toBeInstanceOf(GitWorktreeCreateFailure)

        calls = 0
        expect(
          yield* withScript(
            () => {
              calls += 1
              return calls === 1
                ? Effect.succeed(commandResult(1))
                : Effect.fail(new GitCommandInvocationFailure({ detail: "add spawn failed" }))
            },
            (git) => Effect.flip(git.createPlannedWorktree(plan))
          )
        ).toBeInstanceOf(GitWorktreeCreateFailure)
      })
    })))

  it.effect("maps filesystem and child-process invocation failures", () =>
    Effect.scoped(withRepository(({ baseSha, directory, gitDirectory }) => {
      const plan = makePlan(baseSha, "platform-failures", `${directory}/platform-failures`)
      const worktreeLayer = nodeGitWorktreeLayer(gitDirectory).pipe(
        Layer.provide(Layer.succeed(
          GitCommand,
          GitCommand.of({
            run: (_directory, args) =>
              Effect.succeed(
                args[0] === "worktree" ? commandResult(0) : commandResult(1)
              ),
            runInWorktree: () => Effect.die("unused worktree command"),
            runBytesInWorktree: () => Effect.die("unused byte worktree command")
          })
        )),
        Layer.provide(Layer.succeed(
          FileSystem.FileSystem,
          FileSystem.makeNoop({
            exists: () =>
              Effect.fail(PlatformError.systemError({
                _tag: "PermissionDenied",
                module: "GitWorktreeTest",
                method: "exists"
              }))
          })
        ))
      )
      const deniedSpawnerLayer = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() =>
          Effect.fail(PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "GitWorktreeTest",
            method: "spawn"
          }))
        )
      )

      return Effect.gen(function*() {
        const fileFailure = yield* Effect.gen(function*() {
          return yield* Effect.flip((yield* GitWorktree).readPlannedWorktree(plan))
        }).pipe(Effect.provide(worktreeLayer))
        expect(fileFailure).toBeInstanceOf(GitWorktreeReadFailure)

        const commandFailure = yield* Effect.gen(function*() {
          return yield* Effect.flip((yield* GitCommand).run(gitDirectory, ["status"]))
        }).pipe(
          Effect.provide(nodeGitCommandLayer),
          Effect.provide(deniedSpawnerLayer)
        )
        expect(commandFailure).toBeInstanceOf(GitCommandInvocationFailure)
      })
    })))

  it.effect("adds an existing exact branch without trying to recreate it", () =>
    Effect.scoped(withRepository(({ baseSha, directory, gitDirectory }) => {
      const plan = makePlan(baseSha, "existing", `${directory}/existing`)
      let addArguments: ReadonlyArray<string> = []
      const layer = scriptedAdapterLayer(gitDirectory, (args) => {
        if (args[0] === "rev-parse") {
          return Effect.succeed(commandResult(0, `${baseSha}\n`))
        }
        addArguments = args
        return Effect.succeed(commandResult(0))
      })
      return Effect.gen(function*() {
        yield* (yield* GitWorktree).createPlannedWorktree(plan)
        expect(addArguments).toEqual(["worktree", "add", plan.worktree, plan.branch])
      }).pipe(Effect.provide(layer))
    })))
})
