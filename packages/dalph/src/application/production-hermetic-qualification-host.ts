import { Effect, Option, Ref } from "effect"
import type { ProductionCliHostRunner } from "./live-cli.js"
import { productionCliFailureForSelectedRun, type ProductionCliHostObservation } from "./production-cli.js"
import type { HermeticFixtureManifest, HermeticRegistrationScopeId } from "./production-hermetic-contract.js"
import { HermeticQualificationSourceRejected } from "./production-hermetic-qualification-attempt-source.js"
import { validateHermeticQualificationDeliveryFailure } from "./production-hermetic-qualification-source.js"
import {
  registerHermeticExpectedRecord,
  type HermeticControllerEndpoint
} from "./production-hermetic-provider-bridge.js"

/** Checks host-delivered failures as well as callback failures before the ordinary CLI publishes them. */
export const withHermeticQualificationFailureRegistration =
  <E, R>(
    manifest: HermeticFixtureManifest,
    endpoint: HermeticControllerEndpoint,
    scope: HermeticRegistrationScopeId,
    host: ProductionCliHostRunner<E, R>
  ): ProductionCliHostRunner<E, R> =>
  (configuration, use) =>
    Effect.gen(function* () {
      // Retain only the original observation handle. Its own signal preserves Closed.final after host resources close.
      const original = yield* Ref.make(Option.none<ProductionCliHostObservation>())
      return yield* host(configuration, (observation, exitBoundary) =>
        Ref.set(original, Option.some(observation)).pipe(Effect.andThen(use(observation, exitBoundary)))
      ).pipe(
        Effect.tapError((error) =>
          Ref.get(original).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.die(new HermeticQualificationSourceRejected()),
                onSome: (observation) => {
                  const runId = observation.selection.runId
                  const failure = productionCliFailureForSelectedRun(error, runId)
                  if (failure?._tag !== "ProductionCliDeliveryError") return Effect.void
                  return observation.current.get.pipe(
                    Effect.mapError(() => new HermeticQualificationSourceRejected()),
                    Effect.orDie,
                    Effect.flatMap((state) =>
                      validateHermeticQualificationDeliveryFailure(manifest, configuration, failure, runId, state)
                    ),
                    Effect.flatMap((checked) => registerHermeticExpectedRecord(endpoint, scope, checked.registration)),
                    Effect.orDie
                  )
                }
              })
            )
          )
        )
      )
    })
