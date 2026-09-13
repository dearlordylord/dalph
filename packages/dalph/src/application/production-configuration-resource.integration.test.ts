import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { GitCommitSha, PlannedTaskAttempt, RunId, TaskExecutorLocator, TaskId, TaskRevision } from "@dalph/contracts"
import {
  GitCommand,
  GitCommonDirectoryTarget,
  GitWorktree,
  PlannedTaskAttemptOrdinal,
  PlannedWorktreeReady,
  nodeGitCommandLayer,
  nodeGitWorktreeLayer,
  runGitWorktreeReconciliation
} from "@dalph/orchestrator"
import { Context, Effect, FileSystem, Layer } from "effect"
import { expect } from "vitest"
import {
  ProductionPlannedAttemptWorktreeRoot,
  deriveProductionPlannedAttemptLocations
} from "./production-configuration.js"

it.live("creates Alice's long-identity worktree through real Git at the exact planned path, ref and Base", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const git = yield* GitCommand
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-long-attempt-resource-" })
      const repository = `${directory}/repository`
      yield* fileSystem.makeDirectory(repository)
      const run = Effect.fn("ProductionAttemptResource.Test.git")(function* (
        worktree: string,
        args: ReadonlyArray<string>
      ) {
        const result = yield* git.runInWorktree(worktree, args)
        expect(result.exitCode, result.stderr).toBe(0)
        return result.stdout.trim()
      })
      yield* run(repository, ["init", "--initial-branch=master"])
      yield* run(repository, ["config", "user.email", "dalph@example.invalid"])
      yield* run(repository, ["config", "user.name", "Dalph Test"])
      yield* run(repository, ["commit", "--allow-empty", "-m", "initial H"])
      const baseSha = GitCommitSha.make(yield* run(repository, ["rev-parse", "HEAD"]))
      const root = ProductionPlannedAttemptWorktreeRoot.make(`${directory}/planned-attempts`)
      const runId = RunId.make(`production/github/dearlordylord/dalph/${"r".repeat(210)}/雪😀`)
      const taskId = TaskId.make("github:dearlordylord/dalph/issues/339/*:?[\\")
      const locations = deriveProductionPlannedAttemptLocations(root, runId, taskId, PlannedTaskAttemptOrdinal.make(0))
      expect(locations.attemptId.slice("attempt:".length).length).toBeGreaterThan(528)
      expect(yield* fileSystem.exists(locations.worktree)).toBe(false)
      expect(yield* run(repository, ["worktree", "list", "--porcelain"])).not.toContain(locations.worktree)
      yield* run(repository, ["check-ref-format", locations.branch])
      const plan = PlannedTaskAttempt.make({
        ...locations,
        baseSha,
        executor: TaskExecutorLocator.make("executor:resource-proof"),
        runId,
        taskId,
        taskRevision: TaskRevision.make("revision:resource-proof")
      })
      const gitContext = yield* Layer.build(nodeGitWorktreeLayer(GitCommonDirectoryTarget.make(`${repository}/.git`)))
      const worktrees = Context.get(gitContext, GitWorktree)
      const ready = yield* runGitWorktreeReconciliation(worktrees, plan)
      expect(ready).toEqual(
        PlannedWorktreeReady.make({ baseSha, branch: plan.branch, headSha: baseSha, worktree: plan.worktree })
      )
      expect(yield* fileSystem.exists(plan.worktree)).toBe(true)
      expect(yield* run(plan.worktree, ["symbolic-ref", "HEAD"])).toBe(plan.branch)
      expect(yield* run(plan.worktree, ["rev-parse", "HEAD"])).toBe(baseSha)
      const registrations = yield* run(repository, ["worktree", "list", "--porcelain"])
      expect(registrations).toContain(`worktree ${plan.worktree}\nHEAD ${baseSha}\nbranch ${plan.branch}`)
    })
  ).pipe(Effect.provide(nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer))))
)
