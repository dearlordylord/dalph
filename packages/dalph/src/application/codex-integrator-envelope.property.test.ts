import * as fc from "fast-check"
import { expect, it } from "vitest"
import { parseTerminalEnvelope } from "./codex-integrator-envelope.js"

it("preserves any terminal envelope after arbitrary progress and quoted braces", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 200 }), fc.string({ minLength: 1, maxLength: 200 }), (progress, detail) => {
      const envelope = { outcome: "NotPrepared", version: 1, detail }
      expect(parseTerminalEnvelope(`${progress}\n${JSON.stringify(envelope)}`)).toEqual(envelope)
    }),
    { numRuns: 100 }
  )
})
