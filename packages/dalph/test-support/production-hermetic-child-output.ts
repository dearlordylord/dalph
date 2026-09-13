import { Effect, Ref, Schema, Stream } from "effect"
import type { ChildProcessSpawner } from "effect/unstable/process"
import { ProductionCliRecord } from "../src/application/production-cli.js"

const newlineNotFound = -1

/** An EOF fragment without the exact observed controller kill is not a public NDJSON record. */
export class HermeticChildOutputFramingFailure extends Schema.TaggedError<HermeticChildOutputFramingFailure>()(
  "HermeticChildOutputFramingFailure",
  { reason: Schema.Literal("UnterminatedStdoutFrame") }
) {}

/** Owns one exact child's LF frames and its controller-requested SIGKILL, not workflow or provider authority. */
export const makeHermeticChildOutput = Effect.fn("HermeticChildOutput.make")(function* (
  child: Pick<ChildProcessSpawner.ChildProcessHandle, "stdout" | "exitCode" | "kill">,
  publish: (record: ProductionCliRecord) => Effect.Effect<void>
) {
  const killRequested = yield* Ref.make(false)
  const observedControllerKill = child.exitCode.pipe(
    Effect.as(false),
    Effect.catchTag("PlatformError", (failure) => {
      const reason = failure.reason
      // The pinned Node spawner represents a signal-only exit as this exact
      // exitCode SystemError cause; other failures or mere requests are not proof.
      return Ref.get(killRequested).pipe(
        Effect.map(
          (requested) =>
            requested &&
            reason._tag === "Unknown" &&
            reason.module === "ChildProcess" &&
            reason.method === "exitCode" &&
            reason.cause instanceof Error &&
            reason.cause.message === "Process interrupted due to receipt of signal: 'SIGKILL'"
        )
      )
    })
  )
  const read = Effect.fn("HermeticChildOutput.read")(function* () {
    const decoder = new TextDecoder()
    let pending = ""
    yield* child.stdout.pipe(
      Stream.runForEach(
        Effect.fn("HermeticChildOutput.readChunk")(function* (chunk) {
          pending += decoder.decode(chunk, { stream: true })
          let newline = pending.indexOf("\n")
          while (newline !== newlineNotFound) {
            const frame = pending.slice(0, newline)
            pending = pending.slice(newline + 1)
            if (frame.length > 0) {
              const record = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProductionCliRecord))(frame, {
                reportInput: false
              })
              yield* publish(record)
            }
            newline = pending.indexOf("\n")
          }
        })
      )
    )
    pending += decoder.decode()
    if (pending.length > 0 && !(yield* observedControllerKill)) {
      return yield* new HermeticChildOutputFramingFailure({ reason: "UnterminatedStdoutFrame" })
    }
  })
  const kill = Effect.fn("HermeticChildOutput.kill")(function* () {
    yield* Ref.set(killRequested, true)
    yield* child.kill({ killSignal: "SIGKILL" })
    return yield* Effect.exit(child.exitCode)
  })
  return { read, kill }
})
