/* eslint-disable import/no-nodejs-modules -- The production adapter decodes wrapper bytes with Node's base64 implementation. */
import { Context, Effect, Schema } from "effect"
import { Buffer } from "node:buffer"
import {
  TargetVerificationArtifact,
  TargetVerificationArtifactName,
  TargetVerificationCorrelation,
  TargetVerificationRequestId,
  type TargetVerificationRequest,
  TargetVerificationTerminal
} from "../../workflow/protocols/target-verification/events.js"

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
export type InterruptedObservation = typeof RepositoryVerificationInterruptedObservation.Type

/** The wrapper could not continue its own guarded verification. */
export const RepositoryVerificationFailedObservation = Schema.TaggedStruct("Failed", {
  detail: Schema.String,
  requestId: TargetVerificationRequestId
})
export type FailedObservation = typeof RepositoryVerificationFailedObservation.Type

/** The one terminal result observed after acquisition and before release. */
export const RepositoryVerificationTerminalObservation = Schema.TaggedStruct("Terminal", {
  terminal: TargetVerificationTerminal
})

/** Runtime observations emitted by a public target wrapper. */
export const RepositoryVerificationObservation = Schema.Union([
  RepositoryVerificationWaitingObservation,
  RepositoryVerificationAcquiredObservation,
  RepositoryVerificationReleasedObservation,
  RepositoryVerificationInterruptedObservation,
  RepositoryVerificationFailedObservation,
  RepositoryVerificationTerminalObservation
])
export type RepositoryVerificationObservation = typeof RepositoryVerificationObservation.Type

/** A typed failure while starting or decoding one wrapper run. */
export class RepositoryVerificationWrapperFailure extends Schema.TaggedError<RepositoryVerificationWrapperFailure>()(
  "RepositoryVerificationWrapperFailure",
  {
    detail: Schema.String,
    observations: Schema.Array(RepositoryVerificationObservation),
    requestId: TargetVerificationRequestId
  }
) {}

/** A wrapper process ended by an interruption signal without a terminal result. */
export class RepositoryVerificationWrapperInterrupted extends Schema.TaggedError<RepositoryVerificationWrapperInterrupted>()(
  "RepositoryVerificationWrapperInterrupted",
  {
    detail: Schema.String,
    observations: Schema.Array(RepositoryVerificationObservation),
    requestId: TargetVerificationRequestId,
    signal: Schema.String
  }
) {}

/** A completed run constructed only after the lifecycle state machine settles. */
export const RepositoryVerificationRun = Schema.TaggedStruct("Completed", {
  observations: Schema.Array(RepositoryVerificationObservation),
  terminal: TargetVerificationTerminal
})
export type RepositoryVerificationRun = typeof RepositoryVerificationRun.Type

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

/** Public line-oriented messages emitted by one target verification wrapper. */
export const RepositoryVerificationWrapperMessage = Schema.TaggedUnion({
  Waiting: { requestId: TargetVerificationRequestId },
  Acquired: { requestId: TargetVerificationRequestId },
  Released: { requestId: TargetVerificationRequestId },
  Interrupted: { detail: Schema.String, requestId: TargetVerificationRequestId, signal: Schema.String },
  Failed: { detail: Schema.String, requestId: TargetVerificationRequestId },
  Terminal: { result: encodedTerminal }
})
export type RepositoryVerificationWrapperMessage = typeof RepositoryVerificationWrapperMessage.Type

const maxDetailCharacters = 4_096
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u

/** Bounds diagnostics crossing the wrapper boundary. */
export const detailOf = (value: unknown): string => {
  const detail = String(value)
  return detail.length > maxDetailCharacters ? `${detail.slice(0, maxDetailCharacters)}…` : detail
}

const decodeBase64 = (value: string): Effect.Effect<Uint8Array, string> => {
  if (!base64Pattern.test(value)) return Effect.fail("artifact bytes are not canonical base64")
  const decoded = Buffer.from(value, "base64")
  return decoded.toString("base64") === value
    ? Effect.succeed(new Uint8Array(decoded))
    : Effect.fail("artifact bytes are not canonical base64")
}

const decodeArtifact = Effect.fn("RepositoryVerificationWrapper.decodeArtifact")(function* (
  artifact: typeof encodedArtifact.Type,
  requestId: TargetVerificationRequest["requestId"],
  observations: ReadonlyArray<RepositoryVerificationObservation>
) {
  const bytes = yield* decodeBase64(artifact.bytes).pipe(
    Effect.mapError((detail) => new RepositoryVerificationWrapperFailure({ detail, observations, requestId }))
  )
  return TargetVerificationArtifact.make({ bytes, name: artifact.name })
})

/** Decodes one complete terminal and its content-addressed artifact bytes. */
export const decodeTerminal = Effect.fn("RepositoryVerificationWrapper.decodeTerminal")(function* (
  terminal: typeof encodedTerminal.Type,
  requestId: TargetVerificationRequestId,
  observations: ReadonlyArray<RepositoryVerificationObservation>
) {
  switch (terminal._tag) {
    case "Passed": {
      const [firstEncoded, ...restEncoded] = terminal.artifacts
      const first = yield* decodeArtifact(firstEncoded, requestId, observations)
      const rest = yield* Effect.forEach(restEncoded, (artifact) => decodeArtifact(artifact, requestId, observations))
      return TargetVerificationTerminal.cases.Passed.make({
        artifacts: [first, ...rest],
        correlation: terminal.correlation
      })
    }
    case "Failed": {
      const artifacts = yield* Effect.forEach(terminal.artifacts, (artifact) =>
        decodeArtifact(artifact, requestId, observations)
      )
      return TargetVerificationTerminal.cases.Failed.make({ artifacts, correlation: terminal.correlation })
    }
    case "Killed": {
      const artifacts = yield* Effect.forEach(terminal.artifacts, (artifact) =>
        decodeArtifact(artifact, requestId, observations)
      )
      return TargetVerificationTerminal.cases.Killed.make({ artifacts, correlation: terminal.correlation })
    }
    case "Partial": {
      const artifacts = yield* Effect.forEach(terminal.artifacts, (artifact) =>
        decodeArtifact(artifact, requestId, observations)
      )
      return TargetVerificationTerminal.cases.Partial.make({ artifacts, correlation: terminal.correlation })
    }
    case "TimedOut": {
      const artifacts = yield* Effect.forEach(terminal.artifacts, (artifact) =>
        decodeArtifact(artifact, requestId, observations)
      )
      return TargetVerificationTerminal.cases.TimedOut.make({ artifacts, correlation: terminal.correlation })
    }
  }
})

/** Parses one wrapper line while retaining all observations seen before it. */
export const parseWrapperMessage = Effect.fn("RepositoryVerificationWrapper.decodeMessage")(function* (
  line: string,
  requestId: TargetVerificationRequestId,
  observations: ReadonlyArray<RepositoryVerificationObservation>
) {
  const parsed = yield* Effect.try({ try: () => JSON.parse(line), catch: detailOf }).pipe(
    Effect.mapError(
      (detail) => new RepositoryVerificationWrapperFailure({ detail, observations: [...observations], requestId })
    )
  )
  return yield* Schema.decodeUnknownEffect(RepositoryVerificationWrapperMessage)(parsed).pipe(
    Effect.mapError(
      (failure) =>
        new RepositoryVerificationWrapperFailure({
          detail: detailOf(failure),
          observations: [...observations],
          requestId
        })
    )
  )
})
