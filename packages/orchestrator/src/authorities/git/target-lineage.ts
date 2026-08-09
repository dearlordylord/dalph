import { Context, Effect, Layer, Ref, Schema } from "effect"
import { GitCommitSha, IntegrationTarget } from "@dalph/contracts"
import { GitCommand, type GitCommandResult } from "./command.js"

/** Git's exact target head plus its ancestry relationship to one immutable planned Base SHA. */
export const TargetLineageObservation = Schema.Struct({
  plannedBaseIsAncestorOfTargetHead: Schema.Boolean,
  plannedBaseSha: GitCommitSha,
  targetHeadSha: GitCommitSha
})
export type TargetLineageObservation = typeof TargetLineageObservation.Type

export class GitTargetLineageReadFailure extends Schema.TaggedError<GitTargetLineageReadFailure>()(
  "GitTargetLineageReadFailure",
  { detail: Schema.String, plannedBaseSha: GitCommitSha, target: IntegrationTarget }
) {}

export interface GitTargetLineageService {
  readonly read: (
    plannedBaseSha: GitCommitSha,
    target: IntegrationTarget
  ) => Effect.Effect<TargetLineageObservation, GitTargetLineageReadFailure>
}

export class GitTargetLineage extends Context.Service<GitTargetLineage, GitTargetLineageService>()(
  "@dalph/GitTargetLineage"
) {}

export class TestGitTargetLineage extends Context.Service<
  TestGitTargetLineage,
  { readonly setObservation: (observation: TargetLineageObservation) => Effect.Effect<void> }
>()("@dalph/GitTargetLineage/Test") {}

/** Controlled provider-neutral target-lineage facts for composed workflow and cassette tests. */
export const gitTargetLineageTestLayer = (initialObservation: TargetLineageObservation) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const observation = yield* Ref.make(initialObservation)
      return Context.empty().pipe(
        Context.add(
          GitTargetLineage,
          GitTargetLineage.of({
            read: (plannedBaseSha, target) =>
              Ref.get(observation).pipe(
                Effect.flatMap((current) =>
                  current.plannedBaseSha === plannedBaseSha
                    ? Effect.succeed(current)
                    : Effect.fail(
                        new GitTargetLineageReadFailure({
                          detail: "the controlled observation names a different planned Base SHA",
                          plannedBaseSha,
                          target
                        })
                      )
                )
              )
          })
        ),
        Context.add(TestGitTargetLineage, { setObservation: (current) => Ref.set(observation, current) })
      )
    })
  )

const commandFailed = (
  plannedBaseSha: GitCommitSha,
  target: IntegrationTarget,
  result: GitCommandResult
): GitTargetLineageReadFailure =>
  new GitTargetLineageReadFailure({
    detail: result.stderr.trim() || `git exited ${result.exitCode}`,
    plannedBaseSha,
    target
  })

/** Read-only Node Git adapter; candidate construction and ref mutation remain separate later protocols. */
export const nodeGitTargetLineageLayer = Layer.effect(
  GitTargetLineage,
  Effect.gen(function* () {
    const commands = yield* GitCommand
    return GitTargetLineage.of({
      read: Effect.fn("GitTargetLineage.Node.read")(function* (plannedBaseSha, target) {
        const head = yield* commands
          .run(target.repository, ["rev-parse", "--verify", "--quiet", `${target.ref}^{commit}`])
          .pipe(
            Effect.mapError(
              (failure) => new GitTargetLineageReadFailure({ detail: failure.detail, plannedBaseSha, target })
            )
          )
        if (head.exitCode !== 0) return yield* commandFailed(plannedBaseSha, target, head)
        const targetHeadSha = yield* Schema.decodeUnknownEffect(GitCommitSha)(head.stdout.trim()).pipe(
          Effect.mapError(
            (failure) =>
              new GitTargetLineageReadFailure({
                detail: `Git returned an invalid target commit: ${String(failure)}`,
                plannedBaseSha,
                target
              })
          )
        )
        const ancestry = yield* commands
          .run(target.repository, ["merge-base", "--is-ancestor", plannedBaseSha, targetHeadSha])
          .pipe(
            Effect.mapError(
              (failure) => new GitTargetLineageReadFailure({ detail: failure.detail, plannedBaseSha, target })
            )
          )
        if (ancestry.exitCode !== 0 && ancestry.exitCode !== 1) {
          return yield* commandFailed(plannedBaseSha, target, ancestry)
        }
        return TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: ancestry.exitCode === 0,
          plannedBaseSha,
          targetHeadSha
        })
      })
    })
  })
)
