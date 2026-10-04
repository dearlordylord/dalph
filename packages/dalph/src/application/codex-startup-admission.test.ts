/* eslint-disable import/no-nodejs-modules -- A separate local child proves native descriptor exclusion across processes. */
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import nodeProcess from "node:process"
import { promisify } from "node:util"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, FileSystem, Path, Schema } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { nodeCodexAttemptStoreNativeService } from "./codex-attempt-store-native.js"
import { CodexStartupAdmissionRecord, openCodexStartupAdmission } from "./codex-startup-admission.js"

const candidate = (identity: string, home = "/tmp/shared-home") =>
  Schema.decodeUnknownEffect(CodexStartupAdmissionRecord)({
    startup: { _tag: "Pending", startupId: identity, home, intendedAtMilliseconds: 0, deadlineMilliseconds: 30_000 },
    launch: { command: ["codex", "app-server"], incarnation: identity, phase: "Launching", pid: null },
    holder: { pid: 1, processIdentity: "linux:controlled-holder", incarnation: "controller-" + identity },
    disposition: "Pending"
  })

it.effect("contradictory startup custody is rejected by decoding without filesystem or process effects", () =>
  Effect.gen(function* () {
    const pending = yield* candidate("candidate")
    for (const invalid of [
      { ...pending, disposition: "Initialized" },
      { ...pending, startup: { ...pending.startup, _tag: "Initialized", initializedAtMilliseconds: 0 } },
      { ...pending, launch: { ...pending.launch, phase: "Live", pid: 69 } }
    ]) {
      expect((yield* Schema.decodeUnknownEffect(CodexStartupAdmissionRecord)(invalid).pipe(Effect.result))._tag).toBe(
        "Failure"
      )
    }
  })
)

it.effect("native startup descriptors exclude the same home but allow different homes and initialized owners", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-startup-admission-" })
      const firstRecord = yield* candidate("first")
      const first = yield* openCodexStartupAdmission(directory, firstRecord)
      const second = yield* openCodexStartupAdmission(directory, yield* candidate("second"))
      const different = yield* openCodexStartupAdmission(
        directory,
        yield* candidate("different", "/tmp/different-home")
      )
      const unresolved = () => Effect.succeed({ _tag: "Unresolved" as const })
      expect(yield* first.tryAcquire(unresolved)).toBe(true)
      expect(yield* second.tryAcquire(unresolved)).toBe(false)
      expect(yield* different.tryAcquire(unresolved)).toBe(true)
      const initialized = yield* Schema.decodeUnknownEffect(CodexStartupAdmissionRecord)({
        ...firstRecord,
        startup: { ...firstRecord.startup, _tag: "Initialized", initializedAtMilliseconds: 0 },
        disposition: "Initialized"
      })
      yield* first.release({ _tag: "Initialized", startup: initialized.startup })
      expect(yield* second.tryAcquire(unresolved)).toBe(true)
      yield* second.release({ _tag: "StoppedAbsent" })
      yield* different.release({ _tag: "StoppedAbsent" })
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("closing a startup descriptor preserves unresolved custody until an exact observation permits recovery", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-startup-retained-" })
      const firstRecord = yield* candidate("crashed")
      yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* openCodexStartupAdmission(directory, firstRecord)
          expect(yield* first.tryAcquire(() => Effect.succeed({ _tag: "Unresolved" }))).toBe(true)
        })
      )
      const second = yield* openCodexStartupAdmission(directory, yield* candidate("replacement"))
      expect(yield* second.tryAcquire(() => Effect.succeed({ _tag: "Unresolved" }))).toBe(false)
      expect(
        yield* second.tryAcquire((record) => {
          expect(record).toEqual(firstRecord)
          return Effect.succeed({ _tag: "StoppedAbsent" })
        })
      ).toBe(true)
      yield* second.release({ _tag: "StoppedAbsent" })
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

const lockProbe = `
const fs = require("node:fs")
const { flockSync } = require("fs-ext-extra-prebuilt")
const fd = fs.openSync(process.argv[1], fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW)
try {
  try {
    flockSync(fd, "exnb")
    process.stdout.write("Acquired")
  } catch (failure) {
    if (["EAGAIN", "EWOULDBLOCK", "EACCES"].includes(failure.code)) process.stdout.write("Busy")
    else process.exitCode = 1
  }
} finally {
  fs.closeSync(fd)
}
`

it.effect("a separate Node process cannot take the native startup lock until observed initialization releases it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-startup-process-" })
      const record = yield* candidate("parent")
      const admission = yield* openCodexStartupAdmission(directory, record)
      expect(yield* admission.tryAcquire(() => Effect.succeed({ _tag: "Unresolved" }))).toBe(true)
      const namespaceKey = createHash("sha256").update(record.startup.home, "utf8").digest("hex")
      const filename = path.join(directory, `${namespaceKey}.startup.jsonl`)
      const probe = Effect.tryPromise(() =>
        promisify(execFile)(nodeProcess.execPath, ["-e", lockProbe, filename], { timeout: 2_000 })
      )
      expect((yield* probe).stdout).toBe("Busy")
      const initialized = yield* Schema.decodeUnknownEffect(CodexStartupAdmissionRecord)({
        ...record,
        startup: { ...record.startup, _tag: "Initialized", initializedAtMilliseconds: 0 },
        disposition: "Initialized"
      })
      yield* admission.release({ _tag: "Initialized", startup: initialized.startup })
      expect((yield* probe).stdout).toBe("Acquired")
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("queue expiry does not take another owner's startup lock or replenish the deadline", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-startup-expiry-" })
      const first = yield* openCodexStartupAdmission(directory, yield* candidate("first"))
      const second = yield* openCodexStartupAdmission(directory, yield* candidate("second"))
      const unresolved = () => Effect.succeed({ _tag: "Unresolved" as const })
      expect(yield* first.tryAcquire(unresolved)).toBe(true)
      expect(yield* second.tryAcquire(unresolved)).toBe(false)
      yield* TestClock.adjust("30 seconds")
      const outcome = yield* second.tryAcquire(unresolved).pipe(Effect.result)
      expect(outcome._tag).toBe("Failure")
      if (outcome._tag === "Failure") expect(outcome.failure.kind).toBe("Deadline")
      yield* first.release({ _tag: "StoppedAbsent" })
      expect((yield* second.tryAcquire(unresolved).pipe(Effect.result))._tag).toBe("Failure")
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("a torn startup custody frame refuses admission instead of fabricating absence", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-startup-torn-" })
      const record = yield* candidate("torn")
      yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* openCodexStartupAdmission(directory, record)
          expect(yield* first.tryAcquire(() => Effect.succeed({ _tag: "Unresolved" }))).toBe(true)
        })
      )
      const key = createHash("sha256").update(record.startup.home, "utf8").digest("hex")
      const filename = path.join(directory, `${key}.startup.jsonl`)
      const original = yield* fs.readFileString(filename)
      yield* fs.writeFileString(filename, original + "\n{torn")
      const second = yield* openCodexStartupAdmission(directory, yield* candidate("replacement"))
      let observations = 0
      const outcome = yield* second
        .tryAcquire(() =>
          Effect.sync(() => {
            observations += 1
            return { _tag: "StoppedAbsent" as const }
          })
        )
        .pipe(Effect.result)
      expect(outcome._tag).toBe("Failure")
      expect(observations).toBe(0)
      expect(yield* fs.readFileString(filename)).toBe(original + "\n{torn")
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("startup custody rejects invalid or provider-home directories before filesystem mutation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const record = yield* candidate("directory-guard")
      let mutations = 0
      const native = {
        ...nodeCodexAttemptStoreNativeService,
        mkdir: () => {
          mutations += 1
          return Promise.resolve()
        },
        open: (...args: Parameters<typeof nodeCodexAttemptStoreNativeService.open>) => {
          mutations += 1
          return nodeCodexAttemptStoreNativeService.open(...args)
        }
      }
      for (const directory of ["relative/startup", "/tmp/../startup", "/tmp/shared-home", "/tmp/shared-home/custody"]) {
        expect((yield* openCodexStartupAdmission(directory, record, native).pipe(Effect.result))._tag).toBe("Failure")
      }
      expect(mutations).toBe(0)
    })
  )
)

it.effect("cancelling retained custody observation cannot admit a retry without a durable candidate intent", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-startup-cancel-" })
      const prior = yield* candidate("prior")
      yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* openCodexStartupAdmission(directory, prior)
          yield* first.tryAcquire(() => Effect.succeed({ _tag: "Unresolved" }))
        })
      )
      const second = yield* openCodexStartupAdmission(directory, yield* candidate("second"))
      const entered = yield* Deferred.make<void>()
      const acquiring = yield* second
        .tryAcquire(() => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)))
        .pipe(Effect.forkScoped)
      yield* Deferred.await(entered)
      yield* Fiber.interrupt(acquiring)
      let observed = false
      expect(
        yield* second.tryAcquire((retained) =>
          Effect.sync(() => {
            expect(retained).toEqual(prior)
            observed = true
            return { _tag: "Unresolved" as const }
          })
        )
      ).toBe(false)
      expect(observed).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("an unanswered retained custody observer fails at the original deadline and preserves its fence", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-startup-observer-deadline-" })
      const prior = yield* candidate("prior")
      yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* openCodexStartupAdmission(directory, prior)
          yield* first.tryAcquire(() => Effect.succeed({ _tag: "Unresolved" }))
        })
      )
      const second = yield* openCodexStartupAdmission(directory, yield* candidate("second"))
      const entered = yield* Deferred.make<void>()
      const acquiring = yield* second
        .tryAcquire(() => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)))
        .pipe(Effect.result, Effect.forkScoped)
      yield* Deferred.await(entered)
      yield* TestClock.adjust("30 seconds")
      const outcome = yield* Fiber.join(acquiring)
      expect(outcome._tag).toBe("Failure")
      if (outcome._tag === "Failure") expect(outcome.failure.kind).toBe("Deadline")
      const thirdRecord = yield* Schema.decodeUnknownEffect(CodexStartupAdmissionRecord)({
        ...(yield* candidate("third")),
        startup: {
          ...(yield* candidate("third")).startup,
          intendedAtMilliseconds: 30_000,
          deadlineMilliseconds: 60_000
        }
      })
      const third = yield* openCodexStartupAdmission(directory, thirdRecord)
      let observed = false
      expect(
        yield* third.tryAcquire((retained) =>
          Effect.sync(() => {
            expect(retained).toEqual(prior)
            observed = true
            return { _tag: "Unresolved" as const }
          })
        )
      ).toBe(false)
      expect(observed).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("waiting for native admission expires at the original deadline without changing a sibling's custody", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-startup-wait-" })
      const first = yield* openCodexStartupAdmission(directory, yield* candidate("first"))
      const second = yield* openCodexStartupAdmission(directory, yield* candidate("second"))
      const unresolved = () => Effect.succeed({ _tag: "Unresolved" as const })
      expect(yield* first.tryAcquire(unresolved)).toBe(true)
      yield* TestClock.adjust("10 seconds")
      const waiting = yield* second.awaitAdmission(unresolved).pipe(Effect.result, Effect.forkScoped)
      yield* TestClock.adjust("20 seconds")
      const outcome = yield* Fiber.join(waiting)
      expect(outcome._tag).toBe("Failure")
      if (outcome._tag === "Failure") expect(outcome.failure.kind).toBe("Deadline")
      yield* first.release({ _tag: "StoppedAbsent" })
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("Exit ends queued startup without granting spawn permission or changing sibling custody", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-startup-exit-" })
      const first = yield* openCodexStartupAdmission(directory, yield* candidate("first"))
      const second = yield* openCodexStartupAdmission(directory, yield* candidate("second"))
      const unresolved = () => Effect.succeed({ _tag: "Unresolved" as const })
      expect(yield* first.tryAcquire(unresolved)).toBe(true)
      const exitRequested = yield* Deferred.make<void>()
      const waiting = yield* second
        .awaitAdmission(unresolved, Deferred.await(exitRequested))
        .pipe(Effect.result, Effect.forkScoped)
      yield* Deferred.succeed(exitRequested, undefined)
      const outcome = yield* Fiber.join(waiting)
      expect(outcome._tag).toBe("Failure")
      if (outcome._tag === "Failure") expect(outcome.failure.detail).toBe("application Exit closed startup admission")
      const third = yield* openCodexStartupAdmission(directory, yield* candidate("third"))
      expect(yield* third.tryAcquire(unresolved)).toBe(false)
      yield* first.release({ _tag: "StoppedAbsent" })
      expect(yield* third.tryAcquire(unresolved)).toBe(true)
      yield* third.release({ _tag: "StoppedAbsent" })
    }).pipe(Effect.provide(NodeServices.layer))
  )
)
