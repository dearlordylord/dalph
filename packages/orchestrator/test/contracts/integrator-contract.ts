import { it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { expect } from "vitest"
import {
  Integrator,
  type IntegratorRequest,
  type IntegratorResult
} from "../../src/workflow/protocols/integrator/protocol.js"

interface IntegratorContractInput<E> {
  readonly expected: IntegratorResult
  readonly layer: Layer.Layer<Integrator, E, never>
  readonly name: string
  readonly request: IntegratorRequest
}

/** Shared public outer-Integrator contract; provider-private retry state stays behind this call. */
export const integratorContract = <E>({ expected, layer, name, request }: IntegratorContractInput<E>): void => {
  it.effect(`${name} Integrator prepares the exact correlated request`, () =>
    Effect.gen(function* () {
      const integrator = yield* Integrator
      const result = yield* integrator.prepare(request)
      expect(result).toEqual(expected)
      expect(result.correlation).toEqual(request.correlation)
    }).pipe(Effect.provide(layer))
  )
}
