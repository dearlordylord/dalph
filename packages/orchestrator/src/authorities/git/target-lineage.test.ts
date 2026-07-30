import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import { GitCommitSha, GitRepositoryLocator, IntegrationTarget, IntegrationTargetRef } from "@dalph/contracts"
import { GitCommand, GitCommandInvocationFailure, GitCommandResult } from "./command.js"
import {
  gitTargetLineageTestLayer,
  GitTargetLineage,
  nodeGitTargetLineageLayer,
  TestGitTargetLineage
} from "./target-lineage.js"

const base = GitCommitSha.make("1".repeat(40))
const head = GitCommitSha.make("2".repeat(40))
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/target-lineage.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})

const readWith = (results: ReadonlyArray<GitCommandResult>) =>
  Effect.gen(function* () {
    const remaining = yield* Ref.make(results)
    const commands = GitCommand.of({
      run: () =>
        Ref.modify(remaining, ([next, ...rest]) => [
          next ?? GitCommandResult.make({ exitCode: 2, stderr: "missing test response", stdout: "" }),
          rest
        ]),
      runBytesInWorktree: () => Effect.die("unused"),
      runInWorktree: () => Effect.die("unused")
    })
    return yield* GitTargetLineage.pipe(
      Effect.flatMap((lineage) => lineage.read(base, target)),
      Effect.provide(nodeGitTargetLineageLayer),
      Effect.provide(Layer.succeed(GitCommand, commands))
    )
  })

it.effect("reads compatible and rewritten target lineage without mutating Git", () =>
  Effect.gen(function* () {
    const compatible = yield* readWith([
      GitCommandResult.make({ exitCode: 0, stderr: "", stdout: `${head}\n` }),
      GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "" })
    ])
    const rewritten = yield* readWith([
      GitCommandResult.make({ exitCode: 0, stderr: "", stdout: head }),
      GitCommandResult.make({ exitCode: 1, stderr: "", stdout: "" })
    ])

    expect(compatible).toEqual({ plannedBaseIsAncestorOfTargetHead: true, plannedBaseSha: base, targetHeadSha: head })
    expect(rewritten).toEqual({ plannedBaseIsAncestorOfTargetHead: false, plannedBaseSha: base, targetHeadSha: head })
  })
)

it.effect("rejects unreadable targets, invalid commits, and indeterminate ancestry", () =>
  Effect.gen(function* () {
    const unreadable = yield* readWith([
      GitCommandResult.make({ exitCode: 128, stderr: "missing target", stdout: "" })
    ]).pipe(Effect.flip)
    const invalid = yield* readWith([GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "not-a-commit" })]).pipe(
      Effect.flip
    )
    const indeterminate = yield* readWith([
      GitCommandResult.make({ exitCode: 0, stderr: "", stdout: head }),
      GitCommandResult.make({ exitCode: 2, stderr: "repository unreadable", stdout: "" })
    ]).pipe(Effect.flip)

    expect(unreadable._tag).toBe("GitTargetLineageReadFailure")
    expect(invalid).toMatchObject({ _tag: "GitTargetLineageReadFailure", plannedBaseSha: base, target })
    expect(indeterminate).toMatchObject({ _tag: "GitTargetLineageReadFailure", detail: "repository unreadable" })
    expect(
      yield* readWith([GitCommandResult.make({ exitCode: 128, stderr: "", stdout: "" })]).pipe(Effect.flip)
    ).toMatchObject({ detail: "git exited 128" })
  })
)

it.effect("updates controlled target-lineage facts without changing the production read contract", () =>
  Effect.gen(function* () {
    const controlled = yield* TestGitTargetLineage
    const lineage = yield* GitTargetLineage
    yield* controlled.setObservation({
      plannedBaseIsAncestorOfTargetHead: false,
      plannedBaseSha: base,
      targetHeadSha: head
    })
    expect(yield* lineage.read(base, target)).toEqual({
      plannedBaseIsAncestorOfTargetHead: false,
      plannedBaseSha: base,
      targetHeadSha: head
    })
    const otherBase = GitCommitSha.make("3".repeat(40))
    expect(yield* lineage.read(otherBase, target).pipe(Effect.flip)).toMatchObject({
      _tag: "GitTargetLineageReadFailure",
      plannedBaseSha: otherBase
    })
  }).pipe(
    Effect.provide(
      gitTargetLineageTestLayer({ plannedBaseIsAncestorOfTargetHead: true, plannedBaseSha: base, targetHeadSha: base })
    )
  )
)

it.effect("maps Git transport failures at both target-head and ancestry calls", () =>
  Effect.gen(function* () {
    const readFailingAt = (failureCall: 1 | 2) =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0)
        const commands = GitCommand.of({
          run: () =>
            Ref.updateAndGet(calls, (count) => count + 1).pipe(
              Effect.flatMap((call) =>
                call === failureCall
                  ? Effect.fail(new GitCommandInvocationFailure({ detail: `transport failed at call ${call}` }))
                  : Effect.succeed(GitCommandResult.make({ exitCode: 0, stderr: "", stdout: head }))
              )
            ),
          runBytesInWorktree: () => Effect.die("unused"),
          runInWorktree: () => Effect.die("unused")
        })
        return yield* GitTargetLineage.pipe(
          Effect.flatMap((lineage) => lineage.read(base, target)),
          Effect.provide(nodeGitTargetLineageLayer),
          Effect.provide(Layer.succeed(GitCommand, commands)),
          Effect.flip
        )
      })

    expect(yield* readFailingAt(1)).toMatchObject({ detail: "transport failed at call 1" })
    expect(yield* readFailingAt(2)).toMatchObject({ detail: "transport failed at call 2" })
  })
)
