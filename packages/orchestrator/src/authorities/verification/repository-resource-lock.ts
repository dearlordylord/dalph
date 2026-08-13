import { Effect, Exit, Layer, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import {
  TargetVerificationBoundary,
  TargetVerificationBoundaryFailure,
  type TargetVerificationRequest
} from "../../workflow/protocols/target-verification/events.js"
import {
  detailOf,
  RepositoryVerificationWrapper,
  RepositoryVerificationWrapperFailure,
  RepositoryVerificationWrapperInterrupted
} from "./repository-resource-lock-protocol.js"
import { validateRun, wrapperInterruptedExitCode } from "./repository-resource-lock-lifecycle.js"

/** Identifies the executable that owns the target repository's public wrapper. */
export const TargetVerificationWrapperExecutable = Schema.NonEmptyString.pipe(
  Schema.brand("TargetVerificationWrapperExecutable")
)
export type TargetVerificationWrapperExecutable = typeof TargetVerificationWrapperExecutable.Type

/** Locates the optional working directory supplied to the public wrapper. */
export const TargetVerificationWrapperWorkingDirectory = Schema.NonEmptyString.pipe(
  Schema.brand("TargetVerificationWrapperWorkingDirectory")
)
export type TargetVerificationWrapperWorkingDirectory = typeof TargetVerificationWrapperWorkingDirectory.Type

/**
 * One already-selected executable invocation of the target repository's
 * public verification wrapper. The adapter intentionally accepts no lock
 * operation, private command, or shell expression: the wrapper remains the
 * authority for waiting, acquiring, and releasing its repository lock.
 */
export const TargetVerificationWrapperCommand = Schema.Struct({
  args: Schema.Array(Schema.String),
  cwd: Schema.optionalKey(TargetVerificationWrapperWorkingDirectory),
  executable: TargetVerificationWrapperExecutable
})
export type TargetVerificationWrapperCommand = typeof TargetVerificationWrapperCommand.Type

const bytesPerKibibyte = 1_024
const maxWrapperOutputSizeInKibibytes = 16
const maxWrapperOutputBytes = maxWrapperOutputSizeInKibibytes * bytesPerKibibyte * bytesPerKibibyte

const readOutput = (output: string): ReadonlyArray<string> => {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

const runNodeWrapper = (
  spawner: typeof ChildProcessSpawner.ChildProcessSpawner.Service,
  command: TargetVerificationWrapperCommand,
  request: TargetVerificationRequest
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const requestId = request.requestId
      const handle = yield* spawner.spawn(
        ChildProcess.make(command.executable, command.args, {
          cwd: command.cwd,
          detached: false,
          shell: false,
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe"
        })
      )
      const requestBytes = new TextEncoder().encode(`${JSON.stringify(request)}\n`)
      const { exit, stderr, stdout } = yield* Effect.all(
        {
          exit: Effect.exit(handle.exitCode),
          stderr: handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          stdout: handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          write: Stream.run(Stream.make(requestBytes), handle.stdin)
        },
        { concurrency: "unbounded" }
      )
      if (new TextEncoder().encode(stdout).byteLength > maxWrapperOutputBytes) {
        return yield* new RepositoryVerificationWrapperFailure({
          detail: "wrapper output exceeded the bounded limit",
          observations: [],
          requestId
        })
      }
      return yield* validateRun(
        request,
        readOutput(stdout),
        Exit.isSuccess(exit) ? exit.value : wrapperInterruptedExitCode,
        stderr
      )
    })
  ).pipe(
    Effect.mapError((failure) =>
      failure instanceof RepositoryVerificationWrapperFailure ||
      failure instanceof RepositoryVerificationWrapperInterrupted
        ? failure
        : new RepositoryVerificationWrapperFailure({
            detail: detailOf(failure),
            observations: [],
            requestId: request.requestId
          })
    )
  )

/** Creates the node child-process adapter for one configured public wrapper. */
export const nodeRepositoryVerificationWrapperLayer = (command: TargetVerificationWrapperCommand) =>
  Layer.effect(
    RepositoryVerificationWrapper,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      return RepositoryVerificationWrapper.of({
        runOrResume: Effect.fn("RepositoryVerificationWrapper.Node.runOrResume")(function* (request) {
          return yield* runNodeWrapper(spawner, command, request)
        })
      })
    })
  )

const boundaryFailureFrom = (
  request: TargetVerificationRequest,
  failure: RepositoryVerificationWrapperFailure | RepositoryVerificationWrapperInterrupted
) =>
  new TargetVerificationBoundaryFailure({
    detail:
      failure._tag === "RepositoryVerificationWrapperInterrupted"
        ? `${failure.signal}: ${failure.detail}`
        : failure.detail,
    requestId: request.requestId
  })

/** Adapts a wrapper service to the provider-neutral target verification port. */
export const repositoryVerificationBoundaryLayer = Layer.effect(
  TargetVerificationBoundary,
  Effect.gen(function* () {
    const wrapper = yield* RepositoryVerificationWrapper
    return TargetVerificationBoundary.of({
      runOrResume: Effect.fn("TargetVerificationBoundary.RepositoryWrapper.runOrResume")(function* (request) {
        const run = yield* wrapper
          .runOrResume(request)
          .pipe(Effect.mapError((failure) => boundaryFailureFrom(request, failure)))
        return run.terminal
      })
    })
  })
)

/** Production target-verification boundary backed by one public node wrapper. */
export const nodeTargetVerificationBoundaryLayer = (command: TargetVerificationWrapperCommand) =>
  repositoryVerificationBoundaryLayer.pipe(Layer.provide(nodeRepositoryVerificationWrapperLayer(command)))

export * from "./repository-resource-lock-protocol.js"
