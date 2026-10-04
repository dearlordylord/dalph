/* eslint-disable import/no-nodejs-modules -- Cooperative startup admission owns native descriptor exclusion and durable custody. */
import { createHash } from "node:crypto"
import nodePath from "node:path"
import { Clock, Duration, Effect, Exit, Option, Ref, Schedule, Schema, Semaphore } from "effect"
import {
  appendPrivateSnapshot,
  CodexServerLaunchRecord,
  CodexServerLeaseRecord,
  ensurePrivateDirectory,
  leaseLockIsContended,
  nativeErrorCode,
  openPrivateAppendDescriptor,
  readPrivateDescriptor,
  validatePrivateDescriptor
} from "./codex-attempt-store.js"
import {
  type CodexAttemptStoreNativeService,
  nodeCodexAttemptStoreNativeService
} from "./codex-attempt-store-native.js"
import { CodexServerStartupRecord } from "./codex-server-startup-record.js"
import { CodexServerStartupFailure } from "./codex-server-startup.js"

/** Owner-only custody directory, distinct from every admitted provider home. */
const CodexStartupAdmissionDirectory = Schema.NonEmptyString.check(
  Schema.makeFilter<string>((value) =>
    nodePath.isAbsolute(value) &&
    nodePath.normalize(value) === value &&
    value.trim() === value &&
    !value.includes("\u0000")
      ? undefined
      : "startup custody directory must be an absolute normalized locator"
  )
).pipe(Schema.brand("CodexStartupAdmissionDirectory"))

/** The exact pre-spawn token accompanies startup custody even before a PID is acknowledged. */
export const CodexStartupAdmissionRecord = Schema.Struct({
  startup: CodexServerStartupRecord,
  launch: CodexServerLaunchRecord,
  holder: CodexServerLeaseRecord,
  disposition: Schema.Literals(["Pending", "Initialized", "StoppedAbsent"])
}).check(
  Schema.makeFilter((record) => {
    if (record.disposition === "Initialized" && record.startup._tag !== "Initialized")
      return "initialized custody requires observed initialization"
    if (record.disposition === "Pending" && (record.startup._tag !== "Pending" || record.launch.phase !== "Launching"))
      return "pending custody requires a pending startup and exact pre-spawn launch intent"
    return undefined
  })
)
export type CodexStartupAdmissionRecord = typeof CodexStartupAdmissionRecord.Type

/** Observers may inspect another unit; this boundary never grants permission to signal it. */
export type CodexStartupAdmissionObservation =
  | { readonly _tag: "Unresolved" }
  | { readonly _tag: "Initialized"; readonly startup: CodexServerStartupRecord }
  | { readonly _tag: "StoppedAbsent" }

const custodyFailure = (): CodexServerStartupFailure =>
  new CodexServerStartupFailure({ kind: "Custody", detail: "startup admission custody is unreadable or contradictory" })

class CodexStartupLockFailure extends Schema.TaggedError<CodexStartupLockFailure>()("CodexStartupLockFailure", {
  code: Schema.String
}) {}

const snapshotFrame = Schema.Struct({ formatVersion: Schema.Literal(1), payload: Schema.String, digest: Schema.String })

const decodeCustody = (
  text: string
): Effect.Effect<Option.Option<CodexStartupAdmissionRecord>, CodexServerStartupFailure> =>
  Effect.gen(function* () {
    let latest = Option.none<CodexStartupAdmissionRecord>()
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue
      const frame = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(snapshotFrame))(line).pipe(
        Effect.mapError(custodyFailure)
      )
      if (createHash("sha256").update(frame.payload, "utf8").digest("hex") !== frame.digest) {
        return yield* custodyFailure()
      }
      const record = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CodexStartupAdmissionRecord))(
        frame.payload
      ).pipe(Effect.mapError(custodyFailure))
      latest = Option.some(record)
    }
    return latest
  })

const sameStartup = (left: CodexStartupAdmissionRecord, right: CodexStartupAdmissionRecord): boolean =>
  left.startup.startupId === right.startup.startupId &&
  left.startup.home === right.startup.home &&
  left.startup.intendedAtMilliseconds === right.startup.intendedAtMilliseconds &&
  left.startup.deadlineMilliseconds === right.startup.deadlineMilliseconds &&
  left.launch.incarnation === right.launch.incarnation &&
  left.holder.pid === right.holder.pid &&
  left.holder.processIdentity === right.holder.processIdentity &&
  left.holder.incarnation === right.holder.incarnation

/**
 * Open one scoped admission descriptor outside provider homes. Its OS lock is transient;
 * an unresolved durable row survives descriptor close and blocks a replacement.
 */
export const openCodexStartupAdmission = Effect.fn("CodexStartupAdmission.open")(function* (
  directory: string,
  candidate: CodexStartupAdmissionRecord,
  native: CodexAttemptStoreNativeService = nodeCodexAttemptStoreNativeService
) {
  yield* Schema.decodeUnknownEffect(CodexStartupAdmissionRecord)(candidate).pipe(Effect.mapError(custodyFailure))
  if (candidate.disposition !== "Pending" || candidate.startup._tag !== "Pending") return yield* custodyFailure()
  const custodyDirectory = yield* Schema.decodeUnknownEffect(CodexStartupAdmissionDirectory)(directory).pipe(
    Effect.mapError(custodyFailure)
  )
  const homePrefix = candidate.startup.home.endsWith(nodePath.sep)
    ? candidate.startup.home
    : candidate.startup.home + nodePath.sep
  if (directory === candidate.startup.home || custodyDirectory.startsWith(homePrefix)) return yield* custodyFailure()
  const directoryObservation = yield* Effect.tryPromise({
    try: () => ensurePrivateDirectory(custodyDirectory, native),
    catch: custodyFailure
  })
  if (directoryObservation._tag !== "Present") return yield* custodyFailure()
  const namespaceKey = createHash("sha256").update(candidate.startup.home, "utf8").digest("hex")
  const filename = native.path.join(custodyDirectory, `${namespaceKey}.startup.jsonl`)
  const file = yield* Effect.acquireRelease(
    Effect.tryPromise({ try: () => openPrivateAppendDescriptor(filename, native), catch: custodyFailure }),
    (descriptor) => Effect.tryPromise({ try: () => descriptor.close(), catch: custodyFailure }).pipe(Effect.orDie)
  )
  yield* validatePrivateDescriptor(file, filename, native).pipe(Effect.mapError(custodyFailure))
  // Holding a descriptor is distinct from having fsynced this candidate intent.
  const phase = yield* Ref.make<"Unlocked" | "Locked" | "Admitted">("Unlocked")
  const gate = yield* Semaphore.make(1)
  const append = (record: CodexStartupAdmissionRecord) =>
    appendPrivateSnapshot(file, JSON.stringify(record)).pipe(Effect.mapError(custodyFailure))
  const unlock = Effect.tryPromise({ try: () => native.lock(file, "un"), catch: custodyFailure }).pipe(
    Effect.andThen(Ref.set(phase, "Unlocked"))
  )
  const observationRecord = (
    retained: CodexStartupAdmissionRecord,
    observation: Exclude<CodexStartupAdmissionObservation, { readonly _tag: "Unresolved" }>
  ) =>
    Schema.decodeUnknownEffect(CodexStartupAdmissionRecord)({
      ...retained,
      startup: observation._tag === "Initialized" ? observation.startup : retained.startup,
      disposition: observation._tag
    }).pipe(
      Effect.mapError(custodyFailure),
      Effect.flatMap((record) =>
        sameStartup(retained, record) ? Effect.succeed(record) : Effect.fail(custodyFailure())
      )
    )
  const tryAcquire = Effect.fn("CodexStartupAdmission.tryAcquire")(
    (
      observeRetained: (
        record: CodexStartupAdmissionRecord
      ) => Effect.Effect<CodexStartupAdmissionObservation, CodexServerStartupFailure>
    ) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if ((yield* Clock.currentTimeMillis) >= candidate.startup.deadlineMilliseconds) {
            return yield* new CodexServerStartupFailure({
              kind: "Deadline",
              detail: "original startup deadline expired in queue"
            })
          }
          const currentPhase = yield* Ref.get(phase)
          if (currentPhase === "Admitted") return true
          if (currentPhase === "Locked") return yield* custodyFailure()
          const locked = yield* Effect.tryPromise({
            try: () => native.lock(file, "exnb"),
            catch: (failure) => new CodexStartupLockFailure({ code: nativeErrorCode(failure) })
          }).pipe(
            Effect.matchEffect({
              onFailure: (failure) =>
                leaseLockIsContended(failure.code) ? Effect.succeed(false) : Effect.fail(custodyFailure()),
              onSuccess: () => Effect.succeed(true)
            })
          )
          if (!locked) return false
          yield* Ref.set(phase, "Locked")
          return yield* Effect.gen(function* () {
            const retained = yield* Effect.tryPromise({
              try: () => readPrivateDescriptor(file),
              catch: custodyFailure
            }).pipe(Effect.flatMap(decodeCustody))
            if (Option.isSome(retained) && retained.value.startup.home !== candidate.startup.home)
              return yield* custodyFailure()
            if (Option.isSome(retained) && retained.value.disposition === "Pending") {
              const remaining = candidate.startup.deadlineMilliseconds - (yield* Clock.currentTimeMillis)
              if (remaining <= 0)
                return yield* new CodexServerStartupFailure({
                  kind: "Deadline",
                  detail: "original startup deadline expired before custody observation"
                })
              const observation = yield* restore(
                observeRetained(retained.value).pipe(
                  Effect.timeoutOrElse({
                    duration: Duration.millis(remaining),
                    orElse: () =>
                      Effect.fail(
                        new CodexServerStartupFailure({
                          kind: "Deadline",
                          detail: "original startup deadline expired during custody observation"
                        })
                      )
                  })
                )
              )
              if (observation._tag === "Unresolved") {
                yield* unlock
                return false
              }
              yield* append(yield* observationRecord(retained.value, observation))
            }
            if ((yield* Clock.currentTimeMillis) >= candidate.startup.deadlineMilliseconds) {
              return yield* new CodexServerStartupFailure({
                kind: "Deadline",
                detail: "original startup deadline expired during custody reconciliation"
              })
            }
            yield* append(candidate)
            if ((yield* Clock.currentTimeMillis) >= candidate.startup.deadlineMilliseconds) {
              return yield* new CodexServerStartupFailure({
                kind: "Deadline",
                detail: "original startup deadline expired while persisting admission"
              })
            }
            yield* Ref.set(phase, "Admitted")
            return true
          }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? unlock : Effect.void)))
        })
      )
  )
  const release = Effect.fn("CodexStartupAdmission.release")(function* (
    observation: Exclude<CodexStartupAdmissionObservation, { readonly _tag: "Unresolved" }>
  ) {
    if ((yield* Ref.get(phase)) !== "Admitted") return yield* custodyFailure()
    yield* append(yield* observationRecord(candidate, observation))
    yield* unlock
  })
  const awaitAdmission = Effect.fn("CodexStartupAdmission.awaitAdmission")(function* (
    observeRetained: Parameters<typeof tryAcquire>[0],
    exitRequested?: Effect.Effect<void>
  ) {
    const remaining = candidate.startup.deadlineMilliseconds - (yield* Clock.currentTimeMillis)
    const expired = () =>
      new CodexServerStartupFailure({ kind: "Deadline", detail: "original startup deadline expired in queue" })
    if (remaining <= 0) return yield* expired()
    const waiting = gate.withPermit(tryAcquire(observeRetained)).pipe(
      Effect.repeat({
        until: (admitted) => admitted,
        // eslint-disable-next-line no-magic-numbers -- Cooperative nonblocking descriptor admission has a short polling interval.
        schedule: Schedule.spaced(Duration.millis(25))
      }),
      Effect.timeoutOrElse({ duration: Duration.millis(remaining), orElse: () => Effect.fail(expired()) }),
      Effect.asVoid
    )
    const exiting = new CodexServerStartupFailure({
      kind: "Custody",
      detail: "application Exit closed startup admission"
    })
    const admitted =
      exitRequested === undefined
        ? waiting
        : Effect.raceFirst(waiting, exitRequested.pipe(Effect.andThen(Effect.fail(exiting))))
    return yield* admitted.pipe(
      Effect.onExit((result) =>
        Exit.isFailure(result)
          ? gate
              .withPermit(
                Effect.gen(function* () {
                  // This method has not returned permission to spawn; an admitted row therefore has no child effects.
                  if ((yield* Ref.get(phase)) === "Admitted") yield* release({ _tag: "StoppedAbsent" })
                })
              )
              .pipe(Effect.uninterruptible)
          : Effect.void
      )
    )
  })
  return {
    awaitAdmission,
    tryAcquire: (observeRetained: Parameters<typeof tryAcquire>[0]) => gate.withPermit(tryAcquire(observeRetained)),
    release: (observation: Parameters<typeof release>[0]) =>
      gate.withPermit(release(observation).pipe(Effect.uninterruptible))
  }
})
