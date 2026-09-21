import { GitRepositoryLocator } from "@dalph/contracts"
import { GitCommand, GitCommonDirectoryTarget, nodeGitCommandLayer } from "@dalph/orchestrator"
import { expect, it } from "@effect/vitest"
import { Context, Effect, FileSystem, Layer } from "effect"
import { NodeServices } from "@effect/platform-node"
import { productionTargetGitCommands, productionWorkflowGitCommandLayer } from "./production.js"

it.effect("maps bounded Git commands to the exact working repository's common directory", () =>
  Effect.gen(function* () {
    const repository = GitRepositoryLocator.make("/fixture/worktree")
    const target = GitCommonDirectoryTarget.make("/fixture/worktree/.git")
    const calls: Array<Readonly<{ locator: string; args: ReadonlyArray<string> }>> = []
    const commands = GitCommand.of({
      run: () => Effect.die("ordinary command is outside this bounded scenario"),
      runInWorktree: () => Effect.die("worktree command is outside this bounded scenario"),
      runBytesInWorktree: () => Effect.die("byte command is outside this bounded scenario"),
      runBoundedInRepository: (locator, args) =>
        Effect.sync(() => {
          calls.push({ locator, args })
          return { exitCode: 0, stderr: "", stdout: "" }
        })
    })
    const mapped = productionTargetGitCommands(commands, target, repository)
    if (mapped.runBoundedInRepository === undefined) return yield* Effect.die("bounded command was lost")
    const args = ["fetch", "--no-write-fetch-head", "--no-tags", "/fixture/remote.git", "HEAD"]
    yield* mapped.runBoundedInRepository(repository, args, "30 seconds")
    yield* mapped.runBoundedInRepository("/fixture/other.git", args, "30 seconds")
    expect(calls).toEqual([
      { locator: target, args },
      { locator: "/fixture/other.git", args }
    ])
  })
)

it.effect("builds publication custody even when a general Git service was already memoized", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-git-layer-custody-" })
      const scope = yield* Effect.scope
      const memo = yield* Layer.makeMemoMap
      yield* Layer.buildWithMemoMap(nodeGitCommandLayer.pipe(Layer.provide(NodeServices.layer)), memo, scope)
      const context = yield* Layer.buildWithMemoMap(
        productionWorkflowGitCommandLayer(
          GitCommonDirectoryTarget.make(directory),
          GitRepositoryLocator.make(directory),
          undefined
        ),
        memo,
        scope
      )
      const git = Context.get(context, GitCommand)
      if (git.prepareSenderCustody === undefined) return yield* Effect.die("publication custody is missing")
      yield* git.prepareSenderCustody({ requestId: "memoized-publication", attemptOrdinal: 1 })
      const records = yield* fs.readDirectory(`${directory}/dalph/git-senders`)
      expect(records).toHaveLength(1)
    })
  ).pipe(Effect.provide(NodeServices.layer))
)
