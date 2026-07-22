import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Crypto, Effect, FileSystem, Layer, PlatformError } from "effect"
import { expect } from "vitest"
import { EvidenceStoreLocator } from "./domain.js"
import { EvidenceDigest, EvidenceStore, EvidenceStoreFailure } from "./implementation-evidence.js"
import { nodeEvidenceStoreLayer } from "./node-evidence-store.js"

it.effect("atomically publishes and rereads immutable content-addressed bytes", () =>
  Effect.scoped(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-evidence-" })
      const layer = nodeEvidenceStoreLayer(EvidenceStoreLocator.make(root)).pipe(
        Layer.provide(NodeServices.layer)
      )
      yield* Effect.gen(function*() {
        const store = yield* EvidenceStore
        const bytes = new TextEncoder().encode("atomic evidence")
        const first = yield* store.put(bytes)
        const second = yield* store.put(bytes)
        expect(second).toEqual(first)
        const concurrent = yield* Effect.all(
          Array.from({ length: 20 }, () => store.put(new TextEncoder().encode("concurrent evidence"))),
          { concurrency: "unbounded" }
        )
        expect(new Set(concurrent.map(({ digest }) => digest)).size).toBe(1)
        expect([...(yield* store.read(first))]).toEqual([...bytes])
        const path = `${root}/${first.digest.slice(0, 2)}/${first.digest}`
        expect((yield* fs.stat(path)).mode & 0o777).toBe(0o600)
        yield* fs.writeFile(path, new TextEncoder().encode("corrupt"))
        expect(yield* store.read(first).pipe(Effect.flip)).toBeInstanceOf(EvidenceStoreFailure)
      }).pipe(Effect.provide(layer))
    }).pipe(Effect.provide(NodeServices.layer))
  ))

it.effect("fails typed when a content address is absent", () =>
  Effect.scoped(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-evidence-absent-" })
      yield* Effect.gen(function*() {
        const store = yield* EvidenceStore
        const failure = yield* store.read({
          byteLength: 1,
          digest: EvidenceDigest.make("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        }).pipe(Effect.flip)
        expect(failure).toBeInstanceOf(EvidenceStoreFailure)
      }).pipe(Effect.provide(nodeEvidenceStoreLayer(EvidenceStoreLocator.make(root))))
    }).pipe(
      Effect.provide(NodeServices.layer)
    )
  ))

it.effect("reports cleanup failure as a typed put failure after atomic publication", () =>
  Effect.scoped(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-evidence-cleanup-" })
      const cleanupFailure = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "EvidenceStoreTest",
        method: "remove"
      })
      const failingFileSystem = Layer.succeed(
        FileSystem.FileSystem,
        FileSystem.FileSystem.of({
          ...fs,
          remove: () => Effect.fail(cleanupFailure)
        })
      )
      const failure = yield* Effect.gen(function*() {
        return yield* (yield* EvidenceStore).put(new TextEncoder().encode("published despite cleanup failure"))
      }).pipe(
        Effect.provide(nodeEvidenceStoreLayer(EvidenceStoreLocator.make(root))),
        Effect.provide(failingFileSystem),
        Effect.flip
      )
      expect(failure).toBeInstanceOf(EvidenceStoreFailure)
      if (failure instanceof EvidenceStoreFailure) expect(failure.operation).toBe("EvidenceStore.put")
    }).pipe(Effect.provide(NodeServices.layer))
  ))

it.effect("reconciles a losing publish race and labels read digest failures precisely", () =>
  Effect.scoped(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-evidence-race-" })
      const locator = EvidenceStoreLocator.make(root)
      const bytes = new TextEncoder().encode("raced evidence")
      const reference = yield* Effect.gen(function*() {
        return yield* (yield* EvidenceStore).put(bytes)
      }).pipe(Effect.provide(nodeEvidenceStoreLayer(locator)))
      const target = `${root}/${reference.digest.slice(0, 2)}/${reference.digest}`
      let targetChecks = 0
      const staleExistence = Layer.succeed(
        FileSystem.FileSystem,
        FileSystem.FileSystem.of({
          ...fs,
          exists: (path) => {
            if (path !== target) return fs.exists(path)
            targetChecks += 1
            return Effect.succeed(targetChecks > 1)
          }
        })
      )
      expect(
        yield* Effect.gen(function*() {
          return yield* (yield* EvidenceStore).put(bytes)
        }).pipe(
          Effect.provide(nodeEvidenceStoreLayer(locator)),
          Effect.provide(staleExistence)
        )
      ).toEqual(reference)

      yield* fs.writeFile(target, new TextEncoder().encode("corrupt"))
      targetChecks = 0
      const corruptRace = yield* Effect.gen(function*() {
        return yield* (yield* EvidenceStore).put(bytes)
      }).pipe(
        Effect.provide(nodeEvidenceStoreLayer(locator)),
        Effect.provide(staleExistence),
        Effect.flip
      )
      expect(corruptRace).toBeInstanceOf(EvidenceStoreFailure)
      if (corruptRace instanceof EvidenceStoreFailure) expect(corruptRace.operation).toBe("EvidenceStore.put")

      const digestFailure = PlatformError.systemError({
        _tag: "Unknown",
        module: "EvidenceStoreTest",
        method: "digest"
      })
      const failingCrypto = Layer.succeed(
        Crypto.Crypto,
        Crypto.make({
          digest: () => Effect.fail(digestFailure),
          randomBytes: (size) => new Uint8Array(size)
        })
      )
      const readFailure = yield* Effect.gen(function*() {
        return yield* (yield* EvidenceStore).read(reference)
      }).pipe(
        Effect.provide(nodeEvidenceStoreLayer(locator)),
        Effect.provide(failingCrypto),
        Effect.flip
      )
      expect(readFailure).toBeInstanceOf(EvidenceStoreFailure)
      if (readFailure instanceof EvidenceStoreFailure) expect(readFailure.operation).toBe("EvidenceStore.read")
    }).pipe(Effect.provide(NodeServices.layer))
  ))
