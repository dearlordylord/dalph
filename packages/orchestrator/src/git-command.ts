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
  readonly runInWorktree: (
    worktree: string,
    args: ReadonlyArray<string>
  ) => Effect.Effect<GitCommandResult, GitCommandInvocationFailure>
  readonly runBytesInWorktree: (
    worktree: string,
    args: ReadonlyArray<string>,
    environment?: Readonly<Record<string, string>>
  ) => Effect.Effect<GitCommandBytesResult, GitCommandInvocationFailure>
}

interface GitCommandBytesResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: Uint8Array
}

export class GitCommand extends Context.Service<GitCommand, GitCommandService>()(
  "@dalph/GitCommand"
) {}

export const nodeGitCommandLayer = Layer.effect(
  GitCommand,
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const collectBytes = (values: ReadonlyArray<Uint8Array>): Uint8Array => {
      const output = new Uint8Array(values.reduce((size, bytes) => size + bytes.byteLength, 0))
      let offset = 0
      for (const bytes of values) {
        output.set(bytes, offset)
        offset += bytes.byteLength
      }
      return output
    }
    const runBytesCommand = Effect.fn("GitCommand.Node.runBytesCommand")(function*(
      args: ReadonlyArray<string>,
      environment?: Readonly<Record<string, string>>
    ) {
      return yield* Effect.scoped(Effect.gen(function*() {
        const handle = yield* spawner.spawn(ChildProcess.make(
          "git",
          args,
          environment === undefined ? undefined : { env: { ...environment }, extendEnv: true }
        ))
        const [exitCode, stderr, stdout] = yield* Effect.all([
          handle.exitCode,
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.stdout.pipe(Stream.runCollect, Effect.map(collectBytes))
        ], { concurrency: "unbounded" })
        return { exitCode, stderr, stdout }
      })).pipe(
        Effect.mapError((failure) => new GitCommandInvocationFailure({ detail: String(failure) }))
      )
    })
    const runCommand = Effect.fn("GitCommand.Node.runCommand")(function*(args: ReadonlyArray<string>) {
      const result = yield* runBytesCommand(args)
      return GitCommandResult.make({
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: new TextDecoder().decode(result.stdout)
      })
    })
    return GitCommand.of({
      run: Effect.fn("GitCommand.Node.run")(function*(gitDirectory, args) {
        return yield* runCommand([`--git-dir=${gitDirectory}`, ...args])
      }),
      runInWorktree: Effect.fn("GitCommand.Node.runInWorktree")(function*(worktree, args) {
        return yield* runCommand(["-C", worktree, ...args])
      }),
      runBytesInWorktree: Effect.fn("GitCommand.Node.runBytesInWorktree")(function*(worktree, args, environment) {
        return yield* runBytesCommand(["-C", worktree, ...args], environment)
      })
    })
  })
)
