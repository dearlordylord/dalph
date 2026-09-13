#!/usr/bin/env node
import { NodeServices } from "@effect/platform-node"
import { type DeliveryRuntimeObservationState, nodeGitCommandLayer } from "@dalph/orchestrator"
import { Config, Effect, Layer, Option, Schema, Stream } from "effect"
import { makeProductionCliApplicationFromHost, makeProductionCliHostRunner } from "../src/application/live-cli.js"
import { runDalphNodeMain } from "../src/application/node-main.js"
import { CodexServerIncarnation } from "../src/application/codex-attempt-store.js"
import {
  authorizeHermeticFixture,
  HermeticFixtureManifest,
  HermeticRegistrationScopeId
} from "../src/application/production-hermetic-contract.js"
import { withHermeticQualificationFailureRegistration } from "../src/application/production-hermetic-qualification-host.js"
import {
  validateHermeticQualificationApplicationExit,
  validateHermeticQualificationHistory,
  validateHermeticQualificationRunDisposition,
  validateHermeticQualificationSelection,
  validateHermeticQualificationStatus
} from "../src/application/production-hermetic-qualification-source.js"
import {
  HermeticControllerEndpoint,
  hermeticCodexAppServerLayer,
  hermeticGithubClientLayer,
  hermeticPromotionCompareAndSetObserver,
  registerHermeticExpectedRecord
} from "../src/application/production-hermetic-provider-bridge.js"

// The ordinary public parser, host, protocols, storage and encoder remain intact.
// Only controlled outer provider Layers and a real-CAS observation tap are installed.
const application = Effect.gen(function* () {
  const manifest = yield* Config.schema(
    Schema.fromJsonString(HermeticFixtureManifest),
    "DALPH_HERMETIC_EXPECTED_MANIFEST"
  )
  const endpoint = yield* Config.schema(HermeticControllerEndpoint, "DALPH_HERMETIC_CONTROLLER")
  const scope = yield* Config.schema(HermeticRegistrationScopeId, "DALPH_HERMETIC_REGISTRATION_SCOPE")
  const host = withHermeticQualificationFailureRegistration(
    manifest,
    endpoint,
    scope,
    makeProductionCliHostRunner({
      githubClient: (configuration) => hermeticGithubClientLayer(endpoint, configuration),
      codexAppServer: () =>
        hermeticCodexAppServerLayer(endpoint, CodexServerIncarnation.make("hermetic-provider-incarnation")),
      targetPromotionCompareAndSetObserver: hermeticPromotionCompareAndSetObserver(endpoint)
    })
  )
  return yield* makeProductionCliApplicationFromHost((configuration, use) =>
    authorizeHermeticFixture(manifest, configuration).pipe(
      Effect.andThen(
        host(configuration, (observation, exitBoundary) =>
          Effect.gen(function* () {
            const selected = yield* validateHermeticQualificationSelection(
              manifest,
              configuration,
              observation.selection
            ).pipe(Effect.orDie)
            yield* registerHermeticExpectedRecord(endpoint, scope, selected.registration).pipe(Effect.orDie)
            const runId = observation.selection.runId
            const checkedState = (state: DeliveryRuntimeObservationState) =>
              validateHermeticQualificationStatus(manifest, configuration, state, runId).pipe(
                Effect.flatMap((checked) => registerHermeticExpectedRecord(endpoint, scope, checked.registration)),
                Effect.as(state),
                Effect.orDie
              )
            const current = {
              get: observation.current.get.pipe(Effect.flatMap(checkedState)),
              changes: observation.current.changes.pipe(Stream.mapEffect(checkedState)),
              attach: observation.current.attach.pipe(
                Effect.flatMap((attached) =>
                  checkedState(attached.current).pipe(
                    Effect.as({
                      current: attached.current,
                      changes: attached.changes.pipe(Stream.mapEffect(checkedState))
                    })
                  )
                )
              )
            }
            return yield* use(
              {
                ...observation,
                current,
                traceReader: {
                  readAt: (cursor) =>
                    observation.traceReader.readAt(cursor).pipe(
                      Effect.tap((snapshot) =>
                        validateHermeticQualificationHistory(manifest, configuration, snapshot, runId).pipe(
                          Effect.flatMap((checked) =>
                            registerHermeticExpectedRecord(endpoint, scope, checked.registration)
                          ),
                          Effect.orDie
                        )
                      )
                    )
                },
                runTermination: {
                  ...observation.runTermination,
                  poll: observation.runTermination.poll.pipe(
                    Effect.tap((observed) =>
                      Option.match(observed, {
                        onNone: () => Effect.void,
                        onSome: (termination) =>
                          validateHermeticQualificationRunDisposition(manifest, configuration, runId, termination).pipe(
                            Effect.flatMap((checked) =>
                              registerHermeticExpectedRecord(endpoint, scope, checked.registration)
                            ),
                            Effect.orDie
                          )
                      })
                    )
                  ),
                  await: observation.runTermination.await.pipe(
                    Effect.tap((termination) =>
                      validateHermeticQualificationRunDisposition(manifest, configuration, runId, termination).pipe(
                        Effect.flatMap((checked) =>
                          registerHermeticExpectedRecord(endpoint, scope, checked.registration)
                        ),
                        Effect.orDie
                      )
                    )
                  )
                }
              },
              {
                requestExit: exitBoundary.requestExit.pipe(
                  Effect.tap((disposition) =>
                    validateHermeticQualificationApplicationExit(manifest, configuration, runId, disposition).pipe(
                      Effect.flatMap((checked) =>
                        registerHermeticExpectedRecord(endpoint, scope, checked.registration)
                      ),
                      Effect.orDie
                    )
                  )
                )
              }
            )
          })
        )
      )
    )
  )
}).pipe(Effect.provide(nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer))))

runDalphNodeMain(application)
