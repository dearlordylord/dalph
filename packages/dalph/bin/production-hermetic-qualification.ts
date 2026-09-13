#!/usr/bin/env node
import { NodeServices } from "@effect/platform-node"
import { nodeGitCommandLayer } from "@dalph/orchestrator"
import { Config, Effect, Layer, Schema } from "effect"
import { makeProductionCliApplicationFromHost, makeProductionCliHostRunner } from "../src/application/live-cli.js"
import { runDalphNodeMain } from "../src/application/node-main.js"
import { CodexServerIncarnation } from "../src/application/codex-attempt-store.js"
import { authorizeHermeticFixture, HermeticFixtureManifest } from "../src/application/production-hermetic-contract.js"
import {
  HermeticControllerEndpoint,
  hermeticCodexAppServerLayer,
  hermeticGithubClientLayer,
  hermeticPromotionCompareAndSetObserver
} from "../src/application/production-hermetic-provider-bridge.js"

// The ordinary public parser, host, protocols, storage and encoder remain intact.
// Only controlled outer provider Layers and a real-CAS observation tap are installed.
const application = Effect.gen(function* () {
  const manifest = yield* Config.schema(
    Schema.fromJsonString(HermeticFixtureManifest),
    "DALPH_HERMETIC_EXPECTED_MANIFEST"
  )
  const endpoint = yield* Config.schema(HermeticControllerEndpoint, "DALPH_HERMETIC_CONTROLLER")
  const host = makeProductionCliHostRunner({
    githubClient: (configuration) => hermeticGithubClientLayer(endpoint, configuration),
    codexAppServer: () =>
      hermeticCodexAppServerLayer(endpoint, CodexServerIncarnation.make("hermetic-provider-incarnation")),
    targetPromotionCompareAndSetObserver: hermeticPromotionCompareAndSetObserver(endpoint)
  })
  return yield* makeProductionCliApplicationFromHost((configuration, use) =>
    authorizeHermeticFixture(manifest, configuration).pipe(Effect.andThen(host(configuration, use)))
  )
}).pipe(Effect.provide(nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer))))

runDalphNodeMain(application)
