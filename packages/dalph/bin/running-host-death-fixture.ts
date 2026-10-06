#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- Acceptance owns this actual host process and its IPC control channel. */
import process from "node:process"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import {
  GitCommonDirectoryTarget,
  JournaledRunBootstrap,
  JournalStore,
  journalStoreCapabilities,
  productionCoordinatorOwnershipLayer,
  sqliteJournalStoreLayer
} from "@dalph/orchestrator"
import { Context, Effect, FileSystem, Layer, Queue, Ref, Schema } from "effect"
import { decodeProductionRepositoryHostConfiguration } from "../src/application/production-configuration.js"
import {
  productionRepositoryHostGraph,
  withDecodedProductionRepositoryHost
} from "../src/application/production-host.js"
import { serveRunningHost } from "../src/application/running-host-http.js"
import {
  hermeticCodexAppServerLayer,
  hermeticGithubClientLayer
} from "../src/application/production-hermetic-provider-bridge.js"
import { CodexServerIncarnation } from "../src/application/codex-attempt-store.js"
import {
  HostDeathFixtureCommand,
  type HostDeathFixtureEvent,
  HostDeathFixtureInput
} from "./running-host-death-fixture-contract.js"

const emit = (event: HostDeathFixtureEvent) =>
  Effect.sync(() => {
    process.stdout.write(`${JSON.stringify(event)}\n`)
  })

const application = Effect.scoped(
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(HostDeathFixtureInput))(process.argv[2])
    const fs = yield* FileSystem.FileSystem
    const raw = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Struct({ target: Schema.Unknown, configuration: Schema.Unknown }))
    )(yield* fs.readFileString(input.configurationPath))
    const configuration = yield* decodeProductionRepositoryHostConfiguration(raw.configuration)
    const armed = yield* Ref.make(false)
    const commands = yield* Queue.unbounded<unknown>()
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const receive = (message: unknown) => {
          Queue.offerUnsafe(commands, message)
        }
        process.on("message", receive)
        return receive
      }),
      (receive) =>
        Effect.sync(() => {
          process.off("message", receive)
        })
    )
    const production = productionRepositoryHostGraph({
      codexAppServer: () =>
        hermeticCodexAppServerLayer(input.provider, CodexServerIncarnation.make(`death-fixture:${process.pid}`)),
      githubClient: (config) => hermeticGithubClientLayer(input.provider, config),
      onTimerStateChange: (state) => emit({ _tag: "Timer", state }),
      onAcceptedRunControl: (direction) => emit({ _tag: "Callback", direction }),
      onActivationHandoffIdle: () => emit({ _tag: "Idle" }),
      onActivationFailure: (failure) => emit({ _tag: "ActivationFailed", detail: JSON.stringify(failure) }),
      onReconstructed: ({ recovery }) =>
        recovery.readDeliveryProjection.pipe(
          Effect.flatMap(({ evidence }) =>
            evidence._tag === "AvailableDeliveryProjectionEvidence"
              ? emit({
                  _tag: "Reconstructed",
                  acceptedAt: evidence.acceptedAt,
                  responsibilities: evidence.facts.map(({ responsibility }) => responsibility)
                })
              : Effect.die("reconstructed delivery evidence is unavailable")
          ),
          Effect.orDie
        )
    })
    const graph = {
      ...production,
      foundation: (config: typeof configuration) =>
        journalStoreCapabilities(
          Layer.effect(
            JournalStore,
            Effect.gen(function* () {
              const store = yield* JournalStore
              return JournalStore.of({
                ...store,
                append: (runId, key, event) =>
                  store
                    .append(runId, key, event)
                    .pipe(
                      Effect.tap((record) =>
                        event._tag === "ControlDirectionApplied" && event.direction === "Unpause"
                          ? Ref.getAndSet(armed, false).pipe(
                              Effect.flatMap((cut) =>
                                cut
                                  ? emit({ _tag: "CommittedBeforeCallback", record }).pipe(Effect.andThen(Effect.never))
                                  : Effect.void
                              )
                            )
                          : Effect.void
                      )
                    )
              })
            })
          ).pipe(Layer.provide(sqliteJournalStoreLayer({ filename: config.journalDatabase })))
        ).pipe(
          Layer.provideMerge(
            productionCoordinatorOwnershipLayer(GitCommonDirectoryTarget.make(config.commonDirectory)).pipe(
              Layer.provide(NodeServices.layer)
            )
          )
        ),
      run: (...args: Parameters<typeof production.run>) =>
        production.run(...args).pipe(
          Layer.tap((context) =>
            Effect.gen(function* () {
              const bootstrap = Context.get(context, JournaledRunBootstrap)
              const store = yield* JournalStore
              yield* Effect.gen(function* () {
                for (;;) {
                  const command = yield* Schema.decodeUnknownEffect(HostDeathFixtureCommand)(
                    yield* Queue.take(commands)
                  )
                  if (command === "Arm") {
                    yield* Ref.set(armed, true)
                    yield* emit({ _tag: "Armed" })
                  } else if (command === "Pause") {
                    yield* bootstrap.operatorControl.applyControlDirection({
                      direction: "Pause",
                      subject: { _tag: "Run", runId: args[1].runId }
                    })
                    yield* emit({ _tag: "Paused" })
                  } else yield* emit({ _tag: "History", records: yield* store.read(args[1].runId) })
                }
              }).pipe(Effect.forkScoped)
            })
          )
        )
    }
    return yield* withDecodedProductionRepositoryHost(
      configuration,
      graph,
      (observation) =>
        Effect.gen(function* () {
          yield* serveRunningHost(input.address, observation)
          yield* emit({ _tag: "Ready", selection: observation.selection })
          return yield* Effect.never
        }),
      "Run",
      "Listening"
    )
  })
).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)))

Effect.runPromise(application).catch((cause: unknown) => {
  process.stderr.write(`${String(cause)}\n`)
  process.exitCode = 1
})
