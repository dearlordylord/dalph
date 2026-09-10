import { NodeCrypto, NodeServices } from "@effect/platform-node"
import type { RunId } from "@dalph/contracts"
import {
  type ApplicationExitRequestBoundaryService,
  fixtureReaderFileLayer,
  type JournalStoreError,
  TraceOutputError,
  type TraceReaderError,
  TraceOutput
} from "@dalph/orchestrator"
import { Deferred, Effect, Fiber, FileSystem, Layer, Option } from "effect"
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
  productionCliFailureForSelectedRun,
  ProductionCliOutputError,
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
  type ProductionRepositoryHostAdapters,
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

/** Redacts only the typed production stdout failure while preserving every other failure identity. */
const mapProductionOutputFailure = <E>(failure: E): E | ProductionCliOutputError => {
  const known = knownProductionCliFailure(failure)
  return known instanceof ProductionCliOutputError ? known : failure
}

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
        const selectedRunId = yield* Deferred.make<RunId>()
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
            Deferred.succeed(selectedRunId, observation.selection.runId).pipe(
              Effect.andThen(
                Effect.scoped(
                  Effect.gen(function* () {
                    const selected = yield* Deferred.make<void>()
                    const signalAdapter = yield* installApplicationExitSignalAdapter(
                      applicationExitRequestBoundary,
                      signals,
                      ["SIGINT", "SIGTERM"]
                    )
                    const presentRun = yield* presentSelectedProductionRun(
                      observation,
                      output.writeLine,
                      Deferred.succeed(selected, undefined)
                    ).pipe(Effect.forkScoped)
                    const firstCompletion = yield* Effect.raceFirst(
                      Fiber.await(presentRun).pipe(
                        Effect.map((exit) => ({ _tag: "RunPresentationCompleted" as const, exit }))
                      ),
                      signalAdapter.awaitRequest.pipe(Effect.as({ _tag: "ExitRequested" as const }))
                    )
                    if (firstCompletion._tag === "RunPresentationCompleted") {
                      return yield* firstCompletion.exit
                    }
                    if (!(yield* Deferred.isDone(selected))) {
                      const selection = yield* Effect.raceFirst(
                        Deferred.await(selected).pipe(Effect.as({ _tag: "Selected" as const })),
                        Fiber.await(presentRun).pipe(
                          Effect.map((exit) => ({ _tag: "RunPresentationCompleted" as const, exit }))
                        )
                      )
                      if (selection._tag === "RunPresentationCompleted" && selection.exit._tag === "Failure") {
                        return yield* Effect.failCause(selection.exit.cause)
                      }
                    }
                    const presenterFailureDuringExit = Fiber.await(presentRun).pipe(
                      Effect.flatMap((exit) => (exit._tag === "Failure" ? Effect.failCause(exit.cause) : Effect.never))
                    )
                    const result = yield* Effect.raceFirst(signalAdapter.awaitResult, presenterFailureDuringExit)
                    yield* Fiber.interrupt(presentRun)
                    yield* presentApplicationExitResult(observation.selection.runId, result, output.writeLine)
                  })
                )
              )
            )
          ).pipe(Effect.mapError(mapProductionOutputFailure))
        }).pipe(
          Effect.tapError((failure) => {
            if (!production && failure instanceof TraceOutputError) return Effect.void
            if (failure instanceof ProductionCliOutputError) return Effect.void
            return Deferred.isDone(selectedRunId).pipe(
              Effect.flatMap((hasSelection) =>
                hasSelection
                  ? Deferred.await(selectedRunId).pipe(
                      Effect.map((runId) => productionCliFailureForSelectedRun(failure, runId))
                    )
                  : Effect.succeed(knownProductionCliFailure(failure))
              ),
              Effect.flatMap((known) => {
                if (known === undefined) return Effect.void
                const writeFailure = output
                  .writeLine(encodeProductionCliRecord(productionCliFailureRecord(known)))
                  .pipe(Effect.mapError(mapProductionOutputFailure))
                return known._tag === "ProductionCliDeliveryError" ? writeFailure.pipe(Effect.ignore) : writeFailure
              })
            )
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

const productionHostRunner =
  <ECodex, EGithub, ETrace>(adapters: ProductionRepositoryHostAdapters<ECodex, EGithub, ETrace>) =>
  (
    input: ProductionRepositoryHostConfiguration,
    use: (
      observation: ProductionCliHostObservation,
      applicationExitRequestBoundary: ApplicationExitRequestBoundaryService
    ) => Effect.Effect<
      void,
      ProductionCliLifecycleError | ProductionCliStatusError | TraceOutputError | TraceReaderError | JournalStoreError
    >
  ) =>
    withDecodedProductionRepositoryHost(input, productionRepositoryHostGraph(adapters), (observation) =>
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

/** One shipped command composition; qualification supplies only the host's named boundary Layers. */
export const makeProductionCliApplication = <ECodex = never, EGithub = never, ETrace = never>(
  adapters: ProductionRepositoryHostAdapters<ECodex, EGithub, ETrace> = {}
) =>
  productionCliFromStdio(productionHostRunner(adapters)).pipe(
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

/** The shipped binary selects live defaults at every external boundary. */
export const productionCliApplication = makeProductionCliApplication()
