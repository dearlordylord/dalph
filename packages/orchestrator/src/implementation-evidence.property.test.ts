import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { EvidenceStore, memoryEvidenceStoreLayer } from "./implementation-evidence.js"

it("roundtrips arbitrary evidence bytes under a stable content address", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uint8Array({ maxLength: 4096 }),
      async (generated) => {
        const result = await Effect.runPromise(
          Effect.gen(function*() {
            const store = yield* EvidenceStore
            const first = yield* store.put(generated)
            const second = yield* store.put(generated.slice())
            const roundtrip = yield* store.read(first)
            return { first, roundtrip, second }
          }).pipe(Effect.provide(memoryEvidenceStoreLayer.pipe(Layer.provide(NodeServices.layer))))
        )
        expect(result.second).toEqual(result.first)
        expect(result.roundtrip).toEqual(generated)
      }
    ),
    { numRuns: 100 }
  )
})
