import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Crypto, Effect, FileSystem, Layer, PlatformError } from "effect"
import { expect } from "vitest"
import {
  EvidenceDigest,
  EvidenceReference,
  EvidenceStore,
  EvidenceStoreFailure,
  EvidenceStoreLocator,
  memoryEvidenceStoreLayer,
  nodeEvidenceStoreLayer
} from "./evidence-store.js"
import { evidenceStoreContract } from "../../../test/contracts/evidence-store-contract.js"

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)

evidenceStoreContract(() => memoryEvidenceStoreLayer.pipe(Layer.provide(NodeServices.layer)), "controlled")
evidenceStoreContract(
  (root) => nodeEvidenceStoreLayer(EvidenceStoreLocator.make(root)).pipe(Layer.provide(NodeServices.layer)),
  "filesystem"
)

it.effect("stores immutable bytes idempotently and publishes concurrent same-content writes once", () =>
  Effect.gen(function* () {
    const store = yield* EvidenceStore
    const input = bytes("immutable evidence")
    const reference = yield* store.put(input)
    input[0] = 0
    expect(yield* store.put(bytes("immutable evidence"))).toEqual(reference)
    const read = yield* store.read(reference)
    expect([...read]).toEqual([...bytes("immutable evidence")])
    read[0] = 0
    expect([...(yield* store.read(reference))]).toEqual([...bytes("immutable evidence")])
    const missing = yield* store
      .read(EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("b".repeat(64)) }))
      .pipe(Effect.flip)
    expect(missing).toBeInstanceOf(EvidenceStoreFailure)

    const concurrent = yield* Effect.all(
      Array.from({ length: 20 }, () => store.put(bytes("concurrent evidence"))),
      { concurrency: "unbounded" }
    )
    expect(new Set(concurrent.map(({ digest }) => digest)).size).toBe(1)
    expect(concurrent.every((candidate) => candidate.byteLength === bytes("concurrent evidence").byteLength)).toBe(true)
  }).pipe(Effect.provide(memoryEvidenceStoreLayer), Effect.provide(NodeServices.layer))
)

it.effect("fails with a typed read failure for an absent or corrupt object", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-evidence-failure-" })
      const locator = EvidenceStoreLocator.make(root)
      yield* Effect.gen(function* () {
        const store = yield* EvidenceStore
        const absent = yield* store
          .read(EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) }))
          .pipe(Effect.flip)
        expect(absent).toBeInstanceOf(EvidenceStoreFailure)
        if (absent instanceof EvidenceStoreFailure) expect(absent.operation).toBe("EvidenceStore.read")

        const reference = yield* store.put(bytes("corruptible evidence"))
        const path = `${root}/${reference.digest.slice(0, 2)}/${reference.digest}`
        yield* fs.writeFile(path, bytes("x".repeat(reference.byteLength)))
        const corrupt = yield* store.read(reference).pipe(Effect.flip)
        expect(corrupt).toBeInstanceOf(EvidenceStoreFailure)
        if (corrupt instanceof EvidenceStoreFailure) expect(corrupt.operation).toBe("EvidenceStore.read")
        const refusedReuse = yield* store.put(bytes("corruptible evidence")).pipe(Effect.flip)
        expect(refusedReuse).toBeInstanceOf(EvidenceStoreFailure)
        if (refusedReuse instanceof EvidenceStoreFailure) expect(refusedReuse.operation).toBe("EvidenceStore.put")
      }).pipe(Effect.provide(nodeEvidenceStoreLayer(locator)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("reports temporary-file cleanup failure as a typed put failure", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-evidence-cleanup-" })
      const cleanupFailure = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "EvidenceStoreTest",
        method: "remove"
      })
      const failingFileSystem = Layer.succeed(
        FileSystem.FileSystem,
        FileSystem.FileSystem.of({ ...fs, remove: () => Effect.fail(cleanupFailure) })
      )
      const failure = yield* Effect.gen(function* () {
        return yield* (yield* EvidenceStore).put(bytes("published despite cleanup failure"))
      }).pipe(
        Effect.provide(nodeEvidenceStoreLayer(EvidenceStoreLocator.make(root))),
        Effect.provide(failingFileSystem),
        Effect.flip
      )
      expect(failure).toBeInstanceOf(EvidenceStoreFailure)
      if (failure instanceof EvidenceStoreFailure) expect(failure.operation).toBe("EvidenceStore.put")
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("does not expose partial bytes after an interrupted filesystem publication", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const crypto = yield* Crypto.Crypto
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-evidence-partial-" })
      const interruptedBytes = bytes("interrupted evidence")
      const publicationFailure = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "EvidenceStoreTest",
        method: "link"
      })
      const interruptedFileSystem = Layer.succeed(
        FileSystem.FileSystem,
        FileSystem.FileSystem.of({ ...fs, link: () => Effect.fail(publicationFailure) })
      )
      const digest = yield* crypto.digest("SHA-256", interruptedBytes)
      const digestHex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
      const reference = EvidenceReference.make({
        byteLength: interruptedBytes.byteLength,
        digest: EvidenceDigest.make(digestHex)
      })
      const failure = yield* Effect.gen(function* () {
        return yield* (yield* EvidenceStore).put(interruptedBytes)
      }).pipe(
        Effect.provide(nodeEvidenceStoreLayer(EvidenceStoreLocator.make(root))),
        Effect.provide(interruptedFileSystem),
        Effect.flip
      )
      expect(failure).toBeInstanceOf(EvidenceStoreFailure)
      const directory = `${root}/${digestHex.slice(0, 2)}`
      yield* fs.makeDirectory(directory, { recursive: true })
      yield* fs.writeFile(`${directory}/.${digestHex}.crashed.partial`, interruptedBytes)
      expect(yield* fs.exists(`${directory}/${digestHex}`)).toBe(false)
      const reopened = yield* Effect.gen(function* () {
        return yield* (yield* EvidenceStore).read(reference)
      }).pipe(Effect.provide(nodeEvidenceStoreLayer(EvidenceStoreLocator.make(root))), Effect.flip)
      expect(reopened).toBeInstanceOf(EvidenceStoreFailure)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("reopens an interrupted publication and republishes the same complete object", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-evidence-reopen-" })
      const publicationFailure = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "EvidenceStoreTest",
        method: "link"
      })
      const interruptedFileSystem = Layer.succeed(
        FileSystem.FileSystem,
        FileSystem.FileSystem.of({ ...fs, link: () => Effect.fail(publicationFailure) })
      )
      const firstAttempt = yield* Effect.gen(function* () {
        return yield* (yield* EvidenceStore).put(bytes("reopenable evidence"))
      }).pipe(
        Effect.provide(nodeEvidenceStoreLayer(EvidenceStoreLocator.make(root))),
        Effect.provide(interruptedFileSystem),
        Effect.flip
      )
      expect(firstAttempt).toBeInstanceOf(EvidenceStoreFailure)

      const reference = yield* Effect.gen(function* () {
        return yield* (yield* EvidenceStore).put(bytes("reopenable evidence"))
      }).pipe(Effect.provide(nodeEvidenceStoreLayer(EvidenceStoreLocator.make(root))))
      const reopenedBytes = yield* Effect.gen(function* () {
        return yield* (yield* EvidenceStore).read(reference)
      }).pipe(Effect.provide(nodeEvidenceStoreLayer(EvidenceStoreLocator.make(root))))
      expect(new TextDecoder().decode(reopenedBytes)).toBe("reopenable evidence")
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("reopens a published object with the same reference and bytes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-evidence-reopen-published-" })
      const locator = EvidenceStoreLocator.make(root)
      const reference = yield* Effect.gen(function* () {
        return yield* (yield* EvidenceStore).put(bytes("published across reopen"))
      }).pipe(Effect.provide(nodeEvidenceStoreLayer(locator)))
      const reopenedReference = yield* Effect.gen(function* () {
        const store = yield* EvidenceStore
        expect(new TextDecoder().decode(yield* store.read(reference))).toBe("published across reopen")
        return yield* store.put(bytes("published across reopen"))
      }).pipe(Effect.provide(nodeEvidenceStoreLayer(locator)))
      expect(reopenedReference).toEqual(reference)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("reconciles a losing same-content publication race and rejects a corrupt winner", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-evidence-race-" })
      const locator = EvidenceStoreLocator.make(root)
      const first = yield* Effect.gen(function* () {
        return yield* (yield* EvidenceStore).put(bytes("raced evidence"))
      }).pipe(Effect.provide(nodeEvidenceStoreLayer(locator)))
      const target = `${root}/${first.digest.slice(0, 2)}/${first.digest}`
      let existenceChecks = 0
      const staleExistence = Layer.succeed(
        FileSystem.FileSystem,
        FileSystem.FileSystem.of({
          ...fs,
          exists: (path) => {
            if (path !== target) return fs.exists(path)
            existenceChecks += 1
            return Effect.succeed(existenceChecks > 1)
          }
        })
      )

      const reconciled = yield* Effect.gen(function* () {
        return yield* (yield* EvidenceStore).put(bytes("raced evidence"))
      }).pipe(Effect.provide(nodeEvidenceStoreLayer(locator)), Effect.provide(staleExistence))
      expect(reconciled).toEqual(first)

      yield* fs.writeFile(target, bytes("corrupt"))
      existenceChecks = 0
      const corrupt = yield* Effect.gen(function* () {
        return yield* (yield* EvidenceStore).put(bytes("raced evidence"))
      }).pipe(Effect.provide(nodeEvidenceStoreLayer(locator)), Effect.provide(staleExistence), Effect.flip)
      expect(corrupt).toBeInstanceOf(EvidenceStoreFailure)
      if (corrupt instanceof EvidenceStoreFailure) expect(corrupt.operation).toBe("EvidenceStore.put")
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("keeps the filesystem object mode private after atomic publication", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-evidence-mode-" })
      yield* Effect.gen(function* () {
        const reference = yield* (yield* EvidenceStore).put(bytes("private evidence"))
        expect(yield* (yield* EvidenceStore).put(bytes("private evidence"))).toEqual(reference)
        const path = `${root}/${reference.digest.slice(0, 2)}/${reference.digest}`
        expect((yield* fs.stat(path)).mode & 0o777).toBe(0o600)
      }).pipe(Effect.provide(nodeEvidenceStoreLayer(EvidenceStoreLocator.make(root))))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("reports digest boundary failure and invalid digest output as typed store failures", () =>
  Effect.gen(function* () {
    const digestFailure = PlatformError.systemError({ _tag: "Unknown", module: "EvidenceStoreTest", method: "digest" })
    const implementations = [
      Crypto.make({ digest: () => Effect.fail(digestFailure), randomBytes: (size) => new Uint8Array(size) }),
      Crypto.make({ digest: () => Effect.succeed(new Uint8Array()), randomBytes: (size) => new Uint8Array(size) })
    ]
    for (const implementation of implementations) {
      const failure = yield* Effect.gen(function* () {
        return yield* (yield* EvidenceStore).put(bytes("digest failure"))
      }).pipe(
        Effect.provide(memoryEvidenceStoreLayer),
        Effect.provideService(Crypto.Crypto, implementation),
        Effect.flip
      )
      expect(failure).toBeInstanceOf(EvidenceStoreFailure)
    }
  }).pipe(Effect.provide(NodeServices.layer))
)
