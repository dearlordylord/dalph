import { Context, Effect, Layer, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

export const GitCommandResult = Schema.Struct({
  exitCode: Schema.Int,
  stderr: Schema.String,
  stdout: Schema.String
})
export type GitCommandResult = typeof GitCommandResult.Type

export class GitCommandInvocationFailure extends Schema.TaggedErrorClass<GitCommandInvocationFailure>()(
  "GitCommandInvocationFailure",
  { detail: Schema.String }
) {}

interface GitCommandService {
  readonly run: (
    gitDirectory: string,
    args: ReadonlyArray<string>
  ) => Effect.Effect<GitCommandResult, GitCommandInvocationFailure>
}

export class GitCommand extends Context.Service<GitCommand, GitCommandService>()(
  "@dalph/GitCommand"
) {}

export const nodeGitCommandLayer = Layer.effect(
  GitCommand,
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    return GitCommand.of({
      run: Effect.fn("GitCommand.Node.run")(function*(gitDirectory, args) {
        return yield* Effect.scoped(Effect.gen(function*() {
          const handle = yield* spawner.spawn(ChildProcess.make(
            "git",
            [`--git-dir=${gitDirectory}`, ...args]
          ))
          const [exitCode, stderr, stdout] = yield* Effect.all([
            handle.exitCode,
            handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
            handle.stdout.pipe(Stream.decodeText(), Stream.mkString)
          ], { concurrency: "unbounded" })
          return GitCommandResult.make({ exitCode, stderr, stdout })
        })).pipe(
          Effect.mapError((failure) =>
            new GitCommandInvocationFailure({
              detail: String(failure)
            })
          )
        )
      })
    })
  })
)
