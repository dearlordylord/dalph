#!/usr/bin/env node
import { githubGraphqlClientLayer, nodeGitCommandLayer } from "@dalph/orchestrator"
import { NodeCrypto, NodeHttpClient, NodeServices } from "@effect/platform-node"
import { Config, Effect, FileSystem, Layer, Schema } from "effect"
import { runDalphNodeMain } from "../src/application/node-main.js"
import {
  decodeProductionLiveQualificationManifest,
  ProductionLiveQualificationManifestLocator,
  runProductionLiveQualificationRuntime
} from "../test-support/production-live-qualification-runtime.js"

const runtimeLayer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))

const application = Effect.scoped(
  Effect.gen(function* () {
    const locator = yield* Config.schema(
      ProductionLiveQualificationManifestLocator,
      "DALPH_LIVE_QUALIFICATION_MANIFEST"
    )
    const githubToken = yield* Config.redacted("DALPH_LIVE_GITHUB_TOKEN")
    const codexProviderCredential = yield* Config.redacted("DALPH_CODEX_PROVIDER_CREDENTIAL")
    const fs = yield* FileSystem.FileSystem
    const input = yield* fs
      .readFileString(locator)
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))))
    const manifest = yield* decodeProductionLiveQualificationManifest(input)
    const outcome = yield* runProductionLiveQualificationRuntime(manifest, {
      githubToken,
      codexProviderCredential
    }).pipe(
      Effect.provide(githubGraphqlClientLayer({ token: githubToken }).pipe(Layer.provide(NodeHttpClient.layerUndici)))
    )
    return outcome._tag === "Qualified" ? outcome : yield* Effect.fail(outcome)
  })
).pipe(Effect.provide(runtimeLayer))

runDalphNodeMain(application)
