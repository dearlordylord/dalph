import { Effect, HashSet, MutableList, Ref, Schema, Stream } from "effect"
import type { EvidenceDigest } from "@dalph/contracts"
import type { ChildProcessSpawner } from "effect/unstable/process"
import { encodeProductionCliRecord, ProductionCliRecord } from "../src/application/production-cli.js"
import { hermeticCanonicalRecordDigest } from "../src/application/production-hermetic-provider-bridge.js"

const newlineNotFound = -1
const lineFeedByte = 10

/** An EOF fragment without the exact observed controller kill is not a public NDJSON record. */
export class HermeticChildOutputFramingFailure extends Schema.TaggedError<HermeticChildOutputFramingFailure>()(
  "HermeticChildOutputFramingFailure",
  { reason: Schema.Literal("UnterminatedStdoutFrame") }
) {}

/** The original frame lacks the exact safe-source binding for this owned child. */
export class QualificationInputRejected extends Schema.TaggedError<QualificationInputRejected>()(
  "QualificationInputRejected",
  {}
) {}

/** The controller calls this before recordLog or Queue publication, never after releasing rejected bytes. */
export const validateQualificationRecordBinding = Effect.fn("Qualification.validateRecordBinding")(function* (
  record: ProductionCliRecord,
  expectedDigests: HashSet.HashSet<EvidenceDigest>
) {
  if (record._tag === "Failure" && record.code !== "delivery.provider_throttled")
    return yield* new QualificationInputRejected({})
  if (!HashSet.has(expectedDigests, hermeticCanonicalRecordDigest(record)))
    return yield* new QualificationInputRejected({})
  return record
})

/** Rejected original bytes never become public records or error diagnostics. */
export class HermeticChildOutputCanonicalFailure extends Schema.TaggedError<HermeticChildOutputCanonicalFailure>()(
  "HermeticChildOutputCanonicalFailure",
  {}
) {}

/** Owns one exact child's LF frames and its controller-requested SIGKILL, not workflow or provider authority. */
export const makeHermeticChildOutput = Effect.fn("HermeticChildOutput.make")(function* <E, R>(
  child: Pick<ChildProcessSpawner.ChildProcessHandle, "stdout" | "exitCode" | "kill">,
  publish: (record: ProductionCliRecord) => Effect.Effect<void, E, R>
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
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
    let pending = MutableList.make<Uint8Array>()
    let pendingSize = 0
    yield* child.stdout.pipe(
      Stream.runForEach(
        Effect.fn("HermeticChildOutput.readChunk")(function* (chunk) {
          let start = 0
          let newline = chunk.indexOf(lineFeedByte)
          while (newline !== newlineNotFound) {
            const part = chunk.subarray(start, newline)
            MutableList.append(pending, part)
            pendingSize += part.length
            const original = new Uint8Array(pendingSize)
            let offset = 0
            for (const bytes of MutableList.toArray(pending)) {
              original.set(bytes, offset)
              offset += bytes.length
            }
            pending = MutableList.make<Uint8Array>()
            pendingSize = 0
            const frame = yield* Effect.try({
              try: () => decoder.decode(original),
              catch: () => new HermeticChildOutputCanonicalFailure({})
            })
            const record = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProductionCliRecord))(frame, {
              reportInput: false,
              onExcessProperty: "error"
            }).pipe(Effect.mapError(() => new HermeticChildOutputCanonicalFailure({})))
            if (frame !== encodeProductionCliRecord(record)) return yield* new HermeticChildOutputCanonicalFailure({})
            yield* publish(record)
            start = newline + 1
            newline = chunk.indexOf(lineFeedByte, start)
          }
          const remaining = chunk.subarray(start)
          if (remaining.length > 0) MutableList.append(pending, remaining)
          pendingSize += remaining.length
        })
      )
    )
    if (pendingSize > 0 && !(yield* observedControllerKill)) {
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
