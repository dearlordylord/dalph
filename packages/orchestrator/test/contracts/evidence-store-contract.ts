import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, type Layer } from "effect"
import { expect } from "vitest"
import { EvidenceStore } from "../../src/workflow/protocols/evidence-store.js"

/** Shared immutable-byte contract used by memory and filesystem evidence stores. */
export const evidenceStoreContract = <E>(
  makeLayer: (root: string) => Layer.Layer<EvidenceStore, E, never>,
  name: string
): void => {
  it.effect(`${name} EvidenceStore stores and rereads one immutable object`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-capability-contract-evidence-" })
        return yield* Effect.gen(function* () {
          const store = yield* EvidenceStore
          const input = new TextEncoder().encode(`${name} immutable contract bytes`)
          const reference = yield* store.put(input)
          expect([...(yield* store.read(reference))]).toEqual([...input])
        }).pipe(Effect.provide(makeLayer(root)))
      }).pipe(Effect.provide(NodeServices.layer))
    )
  )
}
