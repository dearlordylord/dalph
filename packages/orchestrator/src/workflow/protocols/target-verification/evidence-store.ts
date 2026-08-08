import { Context, Crypto, Effect, FileSystem, Layer, Ref, Schema } from "effect"

/** Locates one evidence-store root, not a worktree or workflow journal. */
export const EvidenceStoreLocator = Schema.NonEmptyString.pipe(Schema.brand("EvidenceStoreLocator"))
export type EvidenceStoreLocator = typeof EvidenceStoreLocator.Type

/** Identifies immutable bytes by their lowercase SHA-256 content digest. */
export const EvidenceDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(
  Schema.brand("EvidenceDigest")
)
export type EvidenceDigest = typeof EvidenceDigest.Type

/** Describes one complete object accepted by the shared EvidenceStore boundary. */
export const EvidenceReference = Schema.Struct({
  byteLength: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  digest: EvidenceDigest
})
export type EvidenceReference = typeof EvidenceReference.Type

/** Names the storage boundary operation that failed. */
export const EvidenceStoreOperation = Schema.Literals(["EvidenceStore.put", "EvidenceStore.read"])
export type EvidenceStoreOperation = typeof EvidenceStoreOperation.Type

/** Evidence storage could not atomically accept or read one complete object. */
export class EvidenceStoreFailure extends Schema.TaggedErrorClass<EvidenceStoreFailure>()("EvidenceStoreFailure", {
  detail: Schema.String,
  operation: EvidenceStoreOperation
}) {}

export interface EvidenceStoreService {
  readonly put: (bytes: Uint8Array) => Effect.Effect<EvidenceReference, EvidenceStoreFailure>
  readonly read: (reference: EvidenceReference) => Effect.Effect<Uint8Array, EvidenceStoreFailure>
}

/** Stores complete evidence bytes under immutable content-derived identities. */
export class EvidenceStore extends Context.Service<EvidenceStore, EvidenceStoreService>()("@dalph/EvidenceStore") {}

const failure = (operation: EvidenceStoreOperation, cause: unknown): EvidenceStoreFailure =>
  new EvidenceStoreFailure({ detail: String(cause), operation })

const putFailure = (cause: unknown): EvidenceStoreFailure => failure("EvidenceStore.put", cause)
const readFailure = (cause: unknown): EvidenceStoreFailure => failure("EvidenceStore.read", cause)

const hexRadix = 16
const hexByteWidth = 2

const digestHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(hexRadix).padStart(hexByteWidth, "0")).join("")

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])

const digestBytes = Effect.fn("EvidenceStore.digestBytes")(function* (
  crypto: Crypto.Crypto,
  bytes: Uint8Array,
  operation: EvidenceStoreOperation
) {
  const digestBytes = yield* crypto.digest("SHA-256", bytes).pipe(Effect.mapError((cause) => failure(operation, cause)))
  return yield* Schema.decodeUnknownEffect(EvidenceDigest)(digestHex(digestBytes)).pipe(
    Effect.mapError((cause) => failure(operation, cause))
  )
})

type MemoryPublication = { readonly _tag: "Stored" } | { readonly _tag: "Existing" } | { readonly _tag: "Collision" }

/** Deterministic in-memory implementation used by tests and deterministic compositions. */
export const memoryEvidenceStoreLayer = Layer.effectContext(
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const objects = yield* Ref.make<ReadonlyMap<EvidenceDigest, Uint8Array>>(new Map())

    const put = Effect.fn("EvidenceStore.Memory.put")(function* (bytes: Uint8Array) {
      const copy = bytes.slice()
      const digest = yield* digestBytes(crypto, copy, "EvidenceStore.put")
      const reference = EvidenceReference.make({ byteLength: copy.byteLength, digest })
      const publication = yield* Ref.modify(
        objects,
        (current): readonly [MemoryPublication, ReadonlyMap<EvidenceDigest, Uint8Array>] => {
          const existing = current.get(digest)
          if (existing === undefined) {
            const next = new Map(current)
            next.set(digest, copy)
            return [{ _tag: "Stored" }, next]
          }
          if (equalBytes(existing, copy)) return [{ _tag: "Existing" }, current]
          /* v8 ignore next -- @preserve Reaching this fail-closed guard requires a SHA-256 collision inside the private map. */
          return [{ _tag: "Collision" }, current]
        }
      )
      /* v8 ignore next -- @preserve The memory store can report Collision only after the SHA-256 collision guarded above. */
      if (publication._tag === "Collision") {
        return yield* putFailure(`different bytes already use content address ${digest}`)
      }
      return reference
    })

    const read = Effect.fn("EvidenceStore.Memory.read")(function* (reference: EvidenceReference) {
      const bytes = (yield* Ref.get(objects)).get(reference.digest)
      if (bytes === undefined || bytes.byteLength !== reference.byteLength) {
        return yield* readFailure(`complete evidence object ${reference.digest} is unavailable`)
      }
      const digest = yield* digestBytes(crypto, bytes, "EvidenceStore.read")
      /* v8 ignore next -- @preserve Stored memory bytes are private copies keyed by this digest; the Node store covers external corruption. */
      if (digest !== reference.digest) {
        return yield* readFailure(`stored evidence does not match its content address`)
      }
      return bytes.slice()
    })

    return Context.empty().pipe(Context.add(EvidenceStore, EvidenceStore.of({ put, read })))
  })
)

const digestDirectoryLength = 2

const objectPath = (root: EvidenceStoreLocator, digest: EvidenceDigest): string =>
  `${root}/${digest.slice(0, digestDirectoryLength)}/${digest}`

/** Atomic filesystem EvidenceStore: publication uses a same-filesystem hard link. */
export const nodeEvidenceStoreLayer = (root: EvidenceStoreLocator) =>
  Layer.effect(
    EvidenceStore,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const crypto = yield* Crypto.Crypto

      const read = Effect.fn("EvidenceStore.Node.read")(function* (reference: EvidenceReference) {
        const bytes = yield* fs.readFile(objectPath(root, reference.digest)).pipe(Effect.mapError(readFailure))
        if (bytes.byteLength !== reference.byteLength) {
          return yield* readFailure(`stored evidence ${reference.digest} has an unexpected byte length`)
        }
        const digest = yield* digestBytes(crypto, bytes, "EvidenceStore.read")
        if (digest !== reference.digest) {
          return yield* readFailure("stored evidence does not match its content address")
        }
        return bytes.slice()
      })

      const put = Effect.fn("EvidenceStore.Node.put")(function* (bytes: Uint8Array) {
        const copy = bytes.slice()
        const digest = yield* digestBytes(crypto, copy, "EvidenceStore.put")
        const reference = EvidenceReference.make({ byteLength: copy.byteLength, digest })
        const directory = `${root}/${digest.slice(0, digestDirectoryLength)}`
        const target = objectPath(root, digest)

        yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(putFailure))
        if (yield* fs.exists(target).pipe(Effect.mapError(putFailure))) {
          yield* read(reference).pipe(Effect.mapError((cause) => putFailure(cause.detail)))
          return reference
        }

        const uuid = yield* crypto.randomUUIDv4.pipe(Effect.mapError(putFailure))
        const temporary = `${directory}/.${digest}.${uuid}.partial`
        yield* fs.writeFile(temporary, copy, { mode: 0o600 }).pipe(Effect.mapError(putFailure))

        const publish = fs.link(temporary, target).pipe(
          Effect.mapError(putFailure),
          Effect.catch(() =>
            read(reference).pipe(
              Effect.mapError((cause) => putFailure(cause.detail)),
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
