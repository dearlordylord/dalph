import { NodeCrypto, NodeServices } from "@effect/platform-node"
import {
  type ApplicationExitRequestBoundaryService,
  fixtureReaderFileLayer,
  type JournalStoreError,
  type TraceOutputError,
  type TraceReaderError,
  TraceOutput
} from "@dalph/orchestrator"
import { Deferred, Effect, FileSystem, Layer, Option } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { executeDryRun } from "./cli.js"
import {
  decodeRunInvocation,
  loadProductionConfiguration,
  knownProductionCliFailure,
  presentApplicationExitResult,
  presentSelectedProductionRun,
  encodeProductionCliRecord,
  productionCliFailureRecord,
  type ProductionCliHostObservation,
  type ProductionCliLifecycleError,
  type ProductionCliStatusError
} from "./production-cli.js"
import {
  type ApplicationExitSignalBoundary,
  installApplicationExitSignalAdapter,
  nodeApplicationExitSignalBoundary
} from "./supervisor-exit.js"
import { dryRunOperationIdAllocatorLayer } from "./composition.js"
import { makeDryRunTrackerGraphReaderLayer } from "./dry-run.js"
import {
  productionRepositoryHostGraph,
  type ProductionHostObservation,
  withDecodedProductionRepositoryHost
} from "./production-host.js"
import type { ProductionRepositoryHostConfiguration } from "./production-configuration.js"
import { traceOutputStdioLayer } from "../presentation/stdio-trace-output.js"
import { workflowTraceOutputLayer } from "../presentation/workflow-trace.js"

/** Host callback consumed by the public command after all CLI/configuration validation. */
export type ProductionCliHostRunner<E, R> = (
  input: ProductionRepositoryHostConfiguration,
  use: (
    observation: ProductionCliHostObservation,
    applicationExitRequestBoundary: ApplicationExitRequestBoundaryService
  ) => Effect.Effect<
    void,
    ProductionCliLifecycleError | ProductionCliStatusError | TraceOutputError | TraceReaderError | JournalStoreError
  >
) => Effect.Effect<
  void,
  E | ProductionCliLifecycleError | ProductionCliStatusError | TraceOutputError | TraceReaderError | JournalStoreError,
  R
>

const runConfiguration = { version: "0.0.0" }

/** Builds the explicit dry/production command over one injected production host. */
export const makeProductionCli = <EHost, RHost>(
  runProductionHost: ProductionCliHostRunner<EHost, RHost>,
  signals: ApplicationExitSignalBoundary = nodeApplicationExitSignalBoundary
) => {
  const run = Command.make(
    "run",
    {
      config: Flag.optional(
        Flag.string("config").pipe(
          Flag.withDescription(
            "Normalized absolute path to non-secret repository/ref, capacity/cadence, Journal/evidence, worktree, and Codex settings."
          )
        )
      ),
      dry: Flag.boolean("dry").pipe(Flag.withDescription("Use the controlled/read-only dry-run interpreter.")),
      production: Flag.boolean("production").pipe(
        Flag.withDescription(
          "Acquire live production authorities, allow state-changing work, and recover one unfinished Run when present."
        )
      ),
      target: Argument.string("target").pipe(
        Argument.withDescription("Fixture locator for --dry or github:OWNER/REPOSITORY#ISSUE for --production.")
      )
    },
    ({ config, dry, production, target }) =>
      Effect.gen(function* () {
        const output = yield* TraceOutput
        return yield* Effect.gen(function* () {
          const invocation = yield* decodeRunInvocation({
            config: Option.getOrUndefined(config),
            dry,
            production,
            target
          })
          if (invocation._tag === "DryRun") return yield* executeDryRun(invocation.target)

          const fileSystem = yield* FileSystem.FileSystem
          const loaded = yield* loadProductionConfiguration(invocation.configuration, invocation.target, (locator) =>
            fileSystem.readFileString(locator)
          )
          yield* runProductionHost(loaded, (observation, applicationExitRequestBoundary) =>
            Effect.scoped(
              Effect.gen(function* () {
                const selected = yield* Deferred.make<void>()
                const signalAdapter = yield* installApplicationExitSignalAdapter(
                  applicationExitRequestBoundary,
                  signals,
                  ["SIGINT", "SIGTERM"]
                )
                const presentRun = presentSelectedProductionRun(
                  observation,
                  output.writeLine,
                  Deferred.succeed(selected, undefined)
                )
                const presentExit = Deferred.await(selected).pipe(
                  Effect.andThen(signalAdapter.awaitResult),
                  Effect.flatMap((result) =>
                    presentApplicationExitResult(observation.selection.runId, result, output.writeLine)
                  )
                )
                yield* Effect.raceFirst(presentRun, presentExit)
              })
            )
          )
        }).pipe(
          Effect.tapError((failure) => {
            const known = knownProductionCliFailure(failure)
            return known === undefined
              ? Effect.void
              : output.writeLine(encodeProductionCliRecord(productionCliFailureRecord(known))).pipe(Effect.ignore)
          })
        )
      })
  ).pipe(
    Command.withDescription(
      "Run Dalph explicitly in dry or production mode. Production requires GITHUB_TOKEN and DALPH_CODEX_PROVIDER_CREDENTIAL; it may change GitHub, Git, executor, and Journal state."
    )
  )
  return Command.make("dalph").pipe(Command.withSubcommands([run]))
}

export const runProductionCli = <EHost, RHost>(
  runProductionHost: ProductionCliHostRunner<EHost, RHost>,
  signals?: ApplicationExitSignalBoundary
) => Command.runWith(makeProductionCli(runProductionHost, signals), runConfiguration)

export const productionCliFromStdio = <EHost, RHost>(
  runProductionHost: ProductionCliHostRunner<EHost, RHost>,
  signals?: ApplicationExitSignalBoundary
) => Command.run(makeProductionCli(runProductionHost, signals), runConfiguration)

const productionHostRunner = (
  input: ProductionRepositoryHostConfiguration,
  use: (
    observation: ProductionCliHostObservation,
    applicationExitRequestBoundary: ApplicationExitRequestBoundaryService
  ) => Effect.Effect<
    void,
    ProductionCliLifecycleError | ProductionCliStatusError | TraceOutputError | TraceReaderError | JournalStoreError
  >
) =>
  withDecodedProductionRepositoryHost(input, productionRepositoryHostGraph(), (observation) =>
    use(productionCliHostObservationOf(observation), observation.applicationExitRequestBoundary)
  )

/** Removes host lifecycle authority before the shipped presentation callback receives its observation. */
export const productionCliHostObservationOf = (
  observation: ProductionHostObservation
): ProductionCliHostObservation => ({
  acceptedHistory: observation.acceptedHistory,
  current: observation.current,
  runTermination: observation.runTermination,
  selection: observation.selection,
  traceReader: observation.traceReader
})

/** Shipped binary composition: both modes share one command and differ only by installed interpreter boundaries. */
export const productionCliApplication = productionCliFromStdio(productionHostRunner).pipe(
  Effect.provide(
    Layer.mergeAll(
      makeDryRunTrackerGraphReaderLayer(fixtureReaderFileLayer),
      workflowTraceOutputLayer.pipe(Layer.provide(traceOutputStdioLayer)),
      traceOutputStdioLayer,
      dryRunOperationIdAllocatorLayer,
      NodeCrypto.layer
    ).pipe(Layer.provideMerge(NodeServices.layer))
  )
)
