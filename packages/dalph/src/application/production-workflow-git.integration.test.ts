import { GitCommitSha, GitRepositoryLocator, IntegrationTarget, IntegrationTargetRef } from "@dalph/contracts"
import {
  GitCommand,
  GitCommonDirectoryTarget,
  GitTargetLineage,
  nodeGitCommandLayer,
  nodeGitTargetLineageLayer
} from "@dalph/orchestrator"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Context, Effect, FileSystem, Layer, Ref } from "effect"
import { expect } from "vitest"
import { productionWorkflowGitCommandLayer, type ProductionWorkflowGitCommand } from "./production.js"

const makeRepository = Effect.fn("ProductionGitTest.makeRepository")(function* (repository: string) {
  const fs = yield* FileSystem.FileSystem
  const git = yield* GitCommand
  yield* fs.makeDirectory(repository)
  yield* git.runInWorktree(repository, ["init", "--initial-branch=master"])
  yield* git.runInWorktree(repository, ["config", "user.email", "dalph@example.invalid"])
  yield* git.runInWorktree(repository, ["config", "user.name", "Dalph Test"])
  yield* fs.writeFileString(`${repository}/base.txt`, repository)
  yield* git.runInWorktree(repository, ["add", "base.txt"])
  yield* git.runInWorktree(repository, ["commit", "-m", "base"])
  return GitCommitSha.make((yield* git.runInWorktree(repository, ["rev-parse", "HEAD"])).stdout.trim())
})

const proveCommands = (mode: "Default" | "Observed") =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-production-target-git-" })
      const repository = `${directory}/target`
      const unrelated = `${directory}/unrelated`
      const base = yield* makeRepository(repository)
      const unrelatedHead = yield* makeRepository(unrelated)
      const target = IntegrationTarget.make({
        repository: GitRepositoryLocator.make(repository),
        ref: IntegrationTargetRef.make("refs/heads/master")
      })
      const calls = yield* Ref.make<ReadonlyArray<ProductionWorkflowGitCommand>>([])
      const layer = productionWorkflowGitCommandLayer(
        GitCommonDirectoryTarget.make(`${repository}/.git`),
        target,
        mode === "Default" ? undefined : (call) => Ref.update(calls, (previous) => [...previous, call])
      )
      const context = yield* Layer.build(layer)
      const git = Context.get(context, GitCommand)
      const lineage = yield* GitTargetLineage.pipe(Effect.provide(nodeGitTargetLineageLayer), Effect.provide(layer))
      expect(yield* lineage.read(base, target)).toEqual({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: base,
        targetHeadSha: base
      })
      expect(target.repository).toBe(repository)
      const other = yield* git.run(`${unrelated}/.git`, ["rev-parse", "HEAD"])
      expect(other.exitCode).toBe(0)
      expect(other.stdout.trim()).toBe(unrelatedHead)
      const worktree = yield* git.runInWorktree(repository, ["rev-parse", "--show-toplevel"])
      expect(worktree.exitCode).toBe(0)
      expect(worktree.stdout.trim()).toBe(repository)
      const bytes = yield* git.runBytesInWorktree(repository, ["show", "HEAD:base.txt"])
      expect(new TextDecoder().decode(bytes.stdout)).toBe(repository)
      expect(yield* Ref.get(calls)).toEqual(
        mode === "Default" ? [] : ["run", "run", "run", "runInWorktree", "runBytesInWorktree"]
      )
    })
  ).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))

it.effect("ordinary target Git reads use the common directory without an observer", () => proveCommands("Default"))
it.effect("observed target Git reads preserve real results and unrelated command locators", () =>
  proveCommands("Observed")
)
