import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import fc from "fast-check"
import { expect } from "vitest"
import { EvidenceStore, memoryEvidenceStoreLayer } from "./evidence-store.js"

it.effect("keeps arbitrary content-addressed bytes immutable across caller and reader mutation", () =>
  Effect.promise(async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 256 }), async (generated) => {
        const expected = generated.slice()
        await Effect.runPromise(
          Effect.gen(function* () {
            const store = yield* EvidenceStore
            const reference = yield* store.put(generated)
            generated.fill(0)
            const returned = yield* store.read(reference)
            returned.fill(0)
            expect([...(yield* store.read(reference))]).toEqual([...expected])
          }).pipe(Effect.provide(memoryEvidenceStoreLayer), Effect.provide(NodeServices.layer))
        )
      }),
      { numRuns: 40 }
    )
  })
)
