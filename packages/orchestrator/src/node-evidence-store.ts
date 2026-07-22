import { Crypto, Effect, FileSystem, Layer } from "effect"
import type { EvidenceStoreLocator } from "./domain.js"
import { EvidenceDigest, EvidenceReference, EvidenceStore, EvidenceStoreFailure } from "./implementation-evidence.js"

const failure = (operation: "EvidenceStore.put" | "EvidenceStore.read", cause: unknown) =>
  new EvidenceStoreFailure({ detail: String(cause), operation })
const putFailure = (cause: unknown) => failure("EvidenceStore.put", cause)
const readFailure = (cause: unknown) => failure("EvidenceStore.read", cause)

const digestDirectoryLength = 2
const objectPath = (root: EvidenceStoreLocator, digest: EvidenceDigest): string =>
  `${root}/${digest.slice(0, digestDirectoryLength)}/${digest}`

const digestBytes = Effect.fn("EvidenceStore.Node.digestBytes")(function*(
  crypto: Crypto.Crypto,
  bytes: Uint8Array,
  operation: "EvidenceStore.put" | "EvidenceStore.read"
) {
  const digest = yield* crypto.digest("SHA-256", bytes).pipe(
    Effect.mapError((cause) => failure(operation, cause))
  )
  return EvidenceDigest.make(Buffer.from(digest).toString("hex"))
})

/** Atomic filesystem EvidenceStore: publish uses a same-filesystem hard-link. */
export const nodeEvidenceStoreLayer = (root: EvidenceStoreLocator) =>
  Layer.effect(
    EvidenceStore,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const crypto = yield* Crypto.Crypto
      const read = Effect.fn("EvidenceStore.Node.read")(function*(reference: EvidenceReference) {
        const bytes = yield* fs.readFile(objectPath(root, reference.digest)).pipe(
          Effect.mapError(readFailure)
        )
        const digest = yield* digestBytes(crypto, bytes, "EvidenceStore.read")
        if (digest !== reference.digest || bytes.byteLength !== reference.byteLength) {
          return yield* failure("EvidenceStore.read", "stored evidence does not match its content address")
        }
        return bytes
      })
      const put = Effect.fn("EvidenceStore.Node.put")(function*(bytes: Uint8Array) {
        const digest = yield* digestBytes(crypto, bytes, "EvidenceStore.put")
        const reference = EvidenceReference.make({ byteLength: bytes.byteLength, digest })
        const target = objectPath(root, digest)
        const directory = `${root}/${digest.slice(0, digestDirectoryLength)}`
        yield* fs.makeDirectory(directory, { recursive: true }).pipe(
          Effect.mapError(putFailure)
        )
        if (
          yield* fs.exists(target).pipe(
            Effect.mapError(putFailure)
          )
        ) {
          yield* read(reference)
          return reference
        }
        const uuid = yield* crypto.randomUUIDv4.pipe(Effect.mapError(putFailure))
        const temporary = `${directory}/.${digest}.${uuid}.partial`
        yield* fs.writeFile(temporary, bytes, { mode: 0o600 }).pipe(
          Effect.mapError(putFailure)
        )
        const publish = fs.link(temporary, target).pipe(
          Effect.mapError(putFailure),
          Effect.catch(() =>
            read(reference).pipe(
              Effect.mapError((failure) => putFailure(failure.detail)),
              Effect.asVoid
            )
          )
        )
        const publishExit = yield* Effect.exit(publish)
        yield* fs.remove(temporary, { force: true }).pipe(Effect.mapError(putFailure))
        yield* publishExit
        return reference
      })
      return EvidenceStore.of({ put, read })
    })
  )
