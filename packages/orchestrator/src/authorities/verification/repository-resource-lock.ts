/* eslint-disable import/no-nodejs-modules -- The production adapter decodes wrapper bytes with Node's base64 implementation. */
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Buffer } from "node:buffer"
import {
  TargetVerificationArtifact,
  TargetVerificationArtifactName,
  TargetVerificationBoundary,
  TargetVerificationBoundaryFailure,
  TargetVerificationCorrelation,
  TargetVerificationRequestId,
  type TargetVerificationRequest,
  TargetVerificationTerminal
} from "../../workflow/protocols/target-verification/events.js"

/**
 * One already-selected executable invocation of the target repository's
 * public verification wrapper.  The adapter intentionally accepts no lock
 * operation, private command, or shell expression: the wrapper remains the
 * authority for waiting, acquiring, and releasing its repository lock.
 */
export const TargetVerificationWrapperCommand = Schema.Struct({
  args: Schema.Array(Schema.String),
  cwd: Schema.optionalKey(Schema.NonEmptyString),
  executable: Schema.NonEmptyString
})
export type TargetVerificationWrapperCommand = typeof TargetVerificationWrapperCommand.Type

/** The wrapper is waiting for its own repository/resource lock. */
export const RepositoryVerificationWaitingObservation = Schema.TaggedStruct("Waiting", {
  requestId: TargetVerificationRequestId
})

/** The wrapper reports that it acquired its own repository/resource lock. */
export const RepositoryVerificationAcquiredObservation = Schema.TaggedStruct("Acquired", {
  requestId: TargetVerificationRequestId
})

/** The wrapper reports that its own repository/resource lock was released. */
export const RepositoryVerificationReleasedObservation = Schema.TaggedStruct("Released", {
  requestId: TargetVerificationRequestId
})

/** A wrapper process was interrupted before it could provide a terminal result. */
export const RepositoryVerificationInterruptedObservation = Schema.TaggedStruct("Interrupted", {
  detail: Schema.String,
  requestId: TargetVerificationRequestId,
  signal: Schema.String
})
type InterruptedObservation = typeof RepositoryVerificationInterruptedObservation.Type

/** The wrapper could not continue its own guarded verification. */
export const RepositoryVerificationFailedObservation = Schema.TaggedStruct("Failed", {
  detail: Schema.String,
  requestId: TargetVerificationRequestId
})
type FailedObservation = typeof RepositoryVerificationFailedObservation.Type

/** The one terminal result observed after acquisition and before release. */
export const RepositoryVerificationTerminalObservation = Schema.TaggedStruct("Terminal", {
  terminal: TargetVerificationTerminal
})

/**
 * A lifecycle observation emitted by a public target wrapper.  These are
 * runtime observations, not a second durable lock record owned by Dalph.
 */
export const RepositoryVerificationObservation = Schema.Union([
  RepositoryVerificationWaitingObservation,
  RepositoryVerificationAcquiredObservation,
  RepositoryVerificationReleasedObservation,
  RepositoryVerificationInterruptedObservation,
  RepositoryVerificationFailedObservation,
  RepositoryVerificationTerminalObservation
])
export type RepositoryVerificationObservation = typeof RepositoryVerificationObservation.Type

/** A typed failure while starting, decoding, or reconciling one wrapper run. */
export class RepositoryVerificationWrapperFailure extends Schema.TaggedError<RepositoryVerificationWrapperFailure>()(
  "RepositoryVerificationWrapperFailure",
  { detail: Schema.String, requestId: TargetVerificationRequestId }
) {}

/** A wrapper process ended by an interruption signal without a terminal result. */
export class RepositoryVerificationWrapperInterrupted extends Schema.TaggedError<RepositoryVerificationWrapperInterrupted>()(
  "RepositoryVerificationWrapperInterrupted",
  { detail: Schema.String, requestId: TargetVerificationRequestId, signal: Schema.String }
) {}

/** One decoded wrapper run, including lifecycle observations and its terminal result. */
export interface RepositoryVerificationRun {
  readonly observations: ReadonlyArray<RepositoryVerificationObservation>
  readonly terminal: TargetVerificationTerminal
}

/** Adapter port for exactly one public target verification wrapper. */
export interface RepositoryVerificationWrapperService {
  readonly runOrResume: (
    request: TargetVerificationRequest
  ) => Effect.Effect<
    RepositoryVerificationRun,
    RepositoryVerificationWrapperFailure | RepositoryVerificationWrapperInterrupted
  >
}

export class RepositoryVerificationWrapper extends Context.Service<
  RepositoryVerificationWrapper,
  RepositoryVerificationWrapperService
>()("@dalph/RepositoryVerificationWrapper") {}

const encodedArtifact = Schema.Struct({ bytes: Schema.String, name: TargetVerificationArtifactName })

/** The JSON wire representation of a terminal artifact uses canonical base64 bytes. */
const encodedTerminal = Schema.TaggedUnion({
  Failed: { artifacts: Schema.Array(encodedArtifact), correlation: TargetVerificationCorrelation },
  Killed: { artifacts: Schema.Array(encodedArtifact), correlation: TargetVerificationCorrelation },
  Partial: { artifacts: Schema.Array(encodedArtifact), correlation: TargetVerificationCorrelation },
  Passed: { artifacts: Schema.NonEmptyArray(encodedArtifact), correlation: TargetVerificationCorrelation },
  TimedOut: { artifacts: Schema.Array(encodedArtifact), correlation: TargetVerificationCorrelation }
})

/**
 * Public line-oriented wrapper protocol.  The wrapper emits lifecycle lines
 * followed by exactly one `Terminal` line.  No lock command is sent by Dalph;
 * all lock activity represented here is observed from the wrapper.
 */
export const RepositoryVerificationWrapperMessage = Schema.TaggedUnion({
  Waiting: { requestId: TargetVerificationRequestId },
  Acquired: { requestId: TargetVerificationRequestId },
  Released: { requestId: TargetVerificationRequestId },
  Interrupted: { detail: Schema.String, requestId: TargetVerificationRequestId, signal: Schema.String },
  Failed: { detail: Schema.String, requestId: TargetVerificationRequestId },
  Terminal: { result: encodedTerminal }
})
type RepositoryVerificationWrapperMessage = typeof RepositoryVerificationWrapperMessage.Type

const bytesPerKibibyte = 1_024
const maxWrapperOutputSizeInKibibytes = 16
const maxWrapperOutputBytes = maxWrapperOutputSizeInKibibytes * bytesPerKibibyte * bytesPerKibibyte
const maxDetailCharacters = 4_096

const requestIdOf = (request: TargetVerificationRequest) => request.requestId

const detailOf = (value: unknown): string => {
  const detail = String(value)
  return detail.length > maxDetailCharacters ? `${detail.slice(0, maxDetailCharacters)}…` : detail
}

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u

const decodeBase64 = (value: string): Effect.Effect<Uint8Array, string> => {
  if (!base64Pattern.test(value)) return Effect.fail("artifact bytes are not canonical base64")
  const decoded = Buffer.from(value, "base64")
  return decoded.toString("base64") === value
    ? Effect.succeed(new Uint8Array(decoded))
    : Effect.fail("artifact bytes are not canonical base64")
}

const decodeArtifact = Effect.fn("RepositoryVerificationWrapper.decodeArtifact")(function* (
  artifact: typeof encodedArtifact.Type,
  requestId: TargetVerificationRequest["requestId"]
) {
  const bytes = yield* decodeBase64(artifact.bytes).pipe(
    Effect.mapError((detail) => new RepositoryVerificationWrapperFailure({ detail, requestId }))
  )
  return TargetVerificationArtifact.make({ bytes, name: artifact.name })
})

const decodeTerminal = Effect.fn("RepositoryVerificationWrapper.decodeTerminal")(function* (
  terminal: typeof encodedTerminal.Type,
  requestId: TargetVerificationRequestId
) {
  switch (terminal._tag) {
    case "Passed": {
      const [firstEncoded, ...restEncoded] = terminal.artifacts
      const first = yield* decodeArtifact(firstEncoded, requestId)
      const rest = yield* Effect.forEach(restEncoded, (artifact) => decodeArtifact(artifact, requestId))
      return TargetVerificationTerminal.cases.Passed.make({
        artifacts: [first, ...rest],
        correlation: terminal.correlation
      })
    }
    case "Failed": {
      const artifacts = yield* Effect.forEach(terminal.artifacts, (artifact) => decodeArtifact(artifact, requestId))
      return TargetVerificationTerminal.cases.Failed.make({ artifacts, correlation: terminal.correlation })
    }
    case "Killed": {
      const artifacts = yield* Effect.forEach(terminal.artifacts, (artifact) => decodeArtifact(artifact, requestId))
      return TargetVerificationTerminal.cases.Killed.make({ artifacts, correlation: terminal.correlation })
    }
    case "Partial": {
      const artifacts = yield* Effect.forEach(terminal.artifacts, (artifact) => decodeArtifact(artifact, requestId))
      return TargetVerificationTerminal.cases.Partial.make({ artifacts, correlation: terminal.correlation })
    }
    case "TimedOut": {
      const artifacts = yield* Effect.forEach(terminal.artifacts, (artifact) => decodeArtifact(artifact, requestId))
      return TargetVerificationTerminal.cases.TimedOut.make({ artifacts, correlation: terminal.correlation })
    }
  }
})

const messageFromLine = Effect.fn("RepositoryVerificationWrapper.decodeMessage")(function* (
  line: string,
  requestId: TargetVerificationRequest["requestId"]
) {
  const parsed = yield* Effect.try({ try: () => JSON.parse(line), catch: detailOf }).pipe(
    Effect.mapError((detail) => new RepositoryVerificationWrapperFailure({ detail, requestId }))
  )
  return yield* Schema.decodeUnknownEffect(RepositoryVerificationWrapperMessage)(parsed).pipe(
    Effect.mapError((failure) => new RepositoryVerificationWrapperFailure({ detail: detailOf(failure), requestId }))
  )
})

const sigintExitCode = 130
const sigkillExitCode = 137
const sigtermExitCode = 143
const signalForExitCode = (exitCode: number): string | undefined =>
  exitCode === sigintExitCode
    ? "SIGINT"
    : exitCode === sigkillExitCode
      ? "SIGKILL"
      : exitCode === sigtermExitCode
        ? "SIGTERM"
        : undefined

const validateRun = Effect.fn("RepositoryVerificationWrapper.validateRun")(function* (
  request: TargetVerificationRequest,
  messages: ReadonlyArray<RepositoryVerificationWrapperMessage>,
  exitCode: number,
  stderr: string
) {
  const requestId = requestIdOf(request)
  let observations: ReadonlyArray<RepositoryVerificationObservation> = []
  let acquired = false
  let terminal: TargetVerificationTerminal | undefined
  let released = false
  let interrupted: InterruptedObservation | undefined
  let failed: FailedObservation | undefined

  for (const message of messages) {
    switch (message._tag) {
      case "Waiting":
        if (
          message.requestId !== requestId ||
          acquired ||
          terminal !== undefined ||
          released ||
          interrupted !== undefined ||
          failed !== undefined
        ) {
          return yield* new RepositoryVerificationWrapperFailure({
            detail: "wrapper emitted waiting outside the request lifecycle",
            requestId
          })
        }
        observations = [...observations, message]
        break
      case "Acquired":
        if (
          message.requestId !== requestId ||
          acquired ||
          terminal !== undefined ||
          released ||
          interrupted !== undefined ||
          failed !== undefined
        ) {
          return yield* new RepositoryVerificationWrapperFailure({
            detail: "wrapper emitted duplicate or late acquisition",
            requestId
          })
        }
        acquired = true
        observations = [...observations, message]
        break
      case "Terminal":
        if (!acquired || terminal !== undefined || released) {
          return yield* new RepositoryVerificationWrapperFailure({
            detail: "wrapper emitted a terminal result before acquisition or more than once",
            requestId
          })
        }
        terminal = yield* decodeTerminal(message.result, requestId)
        observations = [...observations, RepositoryVerificationTerminalObservation.make({ terminal })]
        break
      case "Released":
        if (
          message.requestId !== requestId ||
          released ||
          (terminal === undefined && interrupted === undefined && failed === undefined)
        ) {
          return yield* new RepositoryVerificationWrapperFailure({
            detail: "wrapper emitted release before its terminal result or more than once",
            requestId
          })
        }
        released = true
        observations = [...observations, message]
        break
      case "Interrupted":
        if (message.requestId !== requestId || terminal !== undefined || released) {
          return yield* new RepositoryVerificationWrapperFailure({
            detail: "wrapper emitted interruption after settling",
            requestId
          })
        }
        observations = [...observations, message]
        interrupted = message
        break
      case "Failed":
        if (message.requestId !== requestId || terminal !== undefined || released) {
          return yield* new RepositoryVerificationWrapperFailure({
            detail: "wrapper emitted failure after settling",
            requestId
          })
        }
        observations = [...observations, message]
        failed = message
        break
    }
  }

  if (interrupted !== undefined) {
    return yield* new RepositoryVerificationWrapperInterrupted({
      detail: interrupted.detail,
      requestId,
      signal: interrupted.signal
    })
  }
  if (failed !== undefined) {
    return yield* new RepositoryVerificationWrapperFailure({ detail: failed.detail, requestId })
  }

  if (!acquired || terminal === undefined || !released) {
    const signal = signalForExitCode(exitCode)
    if (signal !== undefined) {
      return yield* new RepositoryVerificationWrapperInterrupted({
        detail: stderr.trim() || `wrapper exited with ${signal}`,
        requestId,
        signal
      })
    }
    return yield* new RepositoryVerificationWrapperFailure({
      detail: stderr.trim() || "wrapper did not provide a complete lifecycle and terminal result",
      requestId
    })
  }

  if (terminal._tag === "Passed" && exitCode !== 0) {
    return yield* new RepositoryVerificationWrapperFailure({
      detail: stderr.trim() || `wrapper exited ${exitCode} after reporting Passed`,
      requestId
    })
  }

  return { observations, terminal } satisfies RepositoryVerificationRun
})

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
      const requestId = requestIdOf(request)
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
      const { exitCode, stderr, stdout } = yield* Effect.all(
        {
          exitCode: handle.exitCode,
          stderr: handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          stdout: handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          write: Stream.run(Stream.make(requestBytes), handle.stdin)
        },
        { concurrency: "unbounded" }
      )
      if (new TextEncoder().encode(stdout).byteLength > maxWrapperOutputBytes) {
        return yield* new RepositoryVerificationWrapperFailure({
          detail: "wrapper output exceeded the bounded limit",
          requestId
        })
      }
      const messages = yield* Effect.forEach(readOutput(stdout), (line) => messageFromLine(line, requestId))
      return yield* validateRun(request, messages, exitCode, stderr)
    })
  ).pipe(
    Effect.mapError((failure) =>
      failure instanceof RepositoryVerificationWrapperFailure ||
      failure instanceof RepositoryVerificationWrapperInterrupted
        ? failure
        : new RepositoryVerificationWrapperFailure({ detail: detailOf(failure), requestId: requestIdOf(request) })
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
