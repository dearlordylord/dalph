/* eslint-disable max-lines -- One public command surface keeps production request and result paths together. */
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import type { RunId } from "@dalph/contracts"
import {
  type ApplicationExitRequestBoundaryService,
  fixtureReaderFileLayer,
  TraceOutputError,
  TraceOutput
} from "@dalph/orchestrator"
import { Deferred, Effect, FileSystem, Layer, Option } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { executeDryRun } from "./cli.js"
import {
  decodeRunInvocation,
  decodeCancelInvocation,
  loadProductionConfiguration,
  knownProductionCliFailure,
  presentApplicationExitResult,
  presentSelectedProductionRun,
  encodeProductionCliRecord,
  productionCliFailureRecord,
  productionCliFailureForSelectedRun,
  ProductionCliOutputError,
  ProductionCliPublicationError,
  ProductionCliUsageError,
  type ProductionCliHostObservation
} from "./production-cli.js"
import { type ApplicationExitSignalBoundary, nodeApplicationExitSignalBoundary } from "./supervisor-exit.js"
import { dryRunOperationIdAllocatorLayer } from "./composition.js"
import { makeDryRunTrackerGraphReaderLayer } from "./dry-run.js"
import {
  productionRepositoryHostGraph,
  inspectProductionPublicationSubjects,
  type ProductionPublicationSubject,
  type ProductionRepositoryHostAdapters,
  type ProductionHostObservation,
  type ProductionHostStartup,
  withDecodedProductionRepositoryHost
} from "./production-host.js"
import type { ProductionRepositoryHostConfiguration } from "./production-configuration.js"
import { traceOutputStdioLayer } from "../presentation/stdio-trace-output.js"
import { workflowTraceOutputLayer } from "../presentation/workflow-trace.js"
import { makeProductionCliStartup, ProductionHostExitUnsuccessful } from "./production-cli-startup.js"
import { writeLine as writeLifecycleLine, runningHostCliStdioLayer } from "./running-host-cli-output.js"
import { makeRunningHostCommands, type ProductionListeningHostRunner } from "./running-host-cli.js"

/** Host callback consumed by the public command after all CLI/configuration validation. */
export type ProductionCliHostRunner<E, R> = <EUse, EStartup = never>(
  input: ProductionRepositoryHostConfiguration,
  use: (
    observation: ProductionCliHostObservation,
    applicationExitRequestBoundary: ApplicationExitRequestBoundaryService,
    remotePublicationControl?: ProductionHostObservation["remotePublicationControl"]
  ) => Effect.Effect<void, EUse>,
  operation?: "Run" | "Cancel",
  startup?: ProductionHostStartup<void, EStartup, never>
) => Effect.Effect<void, E | EUse | EStartup, R>

const runConfiguration = { version: "0.0.0" }

type ProductionPublicationInspector<E, R> = (
  configuration: ProductionRepositoryHostConfiguration
) => Effect.Effect<
  { readonly runId: RunId | null; readonly subjects: ReadonlyArray<ProductionPublicationSubject> },
  E,
  R
>

/** Redacts only the typed production stdout failure while preserving every other failure identity. */
const mapProductionOutputFailure = <E>(failure: E): E | ProductionCliOutputError => {
  const known = knownProductionCliFailure(failure)
  return known instanceof ProductionCliOutputError ? known : failure
}

const beforeObservation = (signals: ApplicationExitSignalBoundary) =>
  makeProductionCliStartup(signals, (result) =>
    writeLifecycleLine(
      JSON.stringify({ applicationExit: { _tag: result._tag, requestedStatus: result.requestedStatus } }),
      "stderr"
    ).pipe(
      Effect.andThen(
        result._tag === "Succeeded" ? Effect.void : new ProductionHostExitUnsuccessful({ disposition: result._tag })
      ),
      Effect.provide(runningHostCliStdioLayer)
    )
  )

/** Builds the explicit dry/production command over one injected production host. */
export const makeProductionCli = <EHost, RHost, EInspect = never, RInspect = never>(
  runProductionHost: ProductionCliHostRunner<EHost, RHost>,
  signals: ApplicationExitSignalBoundary = nodeApplicationExitSignalBoundary,
  inspectPublicationSubjects?: ProductionPublicationInspector<EInspect, RInspect>,
  runListeningHost?: ProductionListeningHostRunner<EHost, RHost>
) => {
  const cancel = Command.make(
    "cancel",
    {
      config: Flag.optional(Flag.string("config")),
      production: Flag.boolean("production"),
      target: Argument.string("target")
    },
    ({ config, production, target }) =>
      Effect.gen(function* () {
        const output = yield* TraceOutput
        const invocation = yield* decodeCancelInvocation({ config: Option.getOrUndefined(config), production, target })
        const fileSystem = yield* FileSystem.FileSystem
        const loaded = yield* loadProductionConfiguration(invocation.configuration, invocation.target, (locator) =>
          fileSystem.readFileString(locator)
        )
        const early = yield* beforeObservation(signals)
        yield* runProductionHost(
          loaded,
          (observation) => presentSelectedProductionRun(observation, output.writeLine),
          "Cancel",
          early.startup
        ).pipe(Effect.mapError(mapProductionOutputFailure))
      }).pipe(
        Effect.tapError((failure) => {
          if (failure instanceof ProductionCliOutputError) return Effect.void
          const known = knownProductionCliFailure(failure)
          return known === undefined
            ? Effect.void
            : TraceOutput.pipe(
                Effect.flatMap((output) =>
                  output
                    .writeLine(encodeProductionCliRecord(productionCliFailureRecord(known)))
                    .pipe(Effect.mapError(mapProductionOutputFailure))
                )
              )
        })
      )
  ).pipe(
    Command.withDescription(
      "Cancel one exact unfinished production Run, settle its executor work and task claim, and preserve its evidence."
    )
  )
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
          const early = yield* beforeObservation(signals)
          yield* runProductionHost(
            loaded,
            (observation) =>
              Deferred.succeed(selectedRunId, observation.selection.runId).pipe(
                Effect.andThen(
                  Effect.scoped(
                    Effect.gen(function* () {
                      const selected = yield* Deferred.make<void>()
                      const signalAdapter = yield* early.awaitAdapter
                      yield* presentSelectedProductionRun(
                        observation,
                        output.writeLine,
                        Deferred.succeed(selected, undefined),
                        {
                          awaitRequest: signalAdapter.awaitRequest,
                          awaitRequestTime: signalAdapter.awaitRequestTime,
                          awaitResult: signalAdapter.awaitResult,
                          presentResult: (result) =>
                            presentApplicationExitResult(observation.selection.runId, result, output.writeLine)
                        }
                      )
                    })
                  )
                )
              ),
            "Run",
            early.startup
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
      "Run Dalph explicitly in dry or production mode. Production requires GITHUB_TOKEN and uses the installed Codex CLI's existing authentication and configuration; it may change GitHub, Git, executor, and Journal state."
    )
  )
  const publicationCommand = (name: "publication-resume" | "publication-grant") =>
    Command.make(
      name,
      { config: Flag.string("config"), request: Flag.string("request"), target: Argument.string("target") },
      ({ config, request, target }) =>
        Effect.gen(function* () {
          const output = yield* TraceOutput
          const fileSystem = yield* FileSystem.FileSystem
          const invocation = yield* decodeRunInvocation({ config, dry: false, production: true, target })
          if (invocation._tag !== "Production") return yield* Effect.die("publication command selected dry Run")
          const loaded = yield* loadProductionConfiguration(invocation.configuration, invocation.target, (locator) =>
            fileSystem.readFileString(locator)
          )
          const subject = `dalph ${name}` as const
          const requestText = yield* fileSystem
            .readFileString(request)
            .pipe(
              Effect.mapError(
                () =>
                  new ProductionCliUsageError({
                    code: "usage.invalid",
                    detail: "publication request file is unreadable",
                    subject
                  })
              )
            )
          const parsed: unknown = yield* Effect.try({
            try: () => JSON.parse(requestText),
            catch: () =>
              new ProductionCliUsageError({ code: "usage.invalid", detail: "publication request is not JSON", subject })
          })
          const early = yield* beforeObservation(signals)
          yield* runProductionHost(
            loaded,
            (observation, _applicationExitRequestBoundary, remotePublicationControl) =>
              Effect.scoped(
                Effect.gen(function* () {
                  const signalAdapter = yield* early.awaitAdapter
                  yield* presentSelectedProductionRun(
                    observation,
                    output.writeLine,
                    Effect.gen(function* () {
                      const control = remotePublicationControl
                      if (control === undefined)
                        return yield* new ProductionCliPublicationError({
                          code: "publication.rejected",
                          detail: "the publication request was not accepted for the selected Run",
                          subject: observation.selection.runId
                        })
                      const rejected = () =>
                        new ProductionCliPublicationError({
                          code: "publication.rejected",
                          detail: "the publication request was not accepted for the selected Run",
                          subject: observation.selection.runId
                        })
                      if (name === "publication-resume") {
                        const result = yield* control
                          .applyRemotePublicationResume(parsed)
                          .pipe(Effect.mapError(rejected))
                        yield* output.writeLine(
                          encodeProductionCliRecord({ _tag: "PublicationResumeResult", result, version: 1 })
                        )
                      } else {
                        const result = yield* control
                          .applyRemotePublicationBatchGrant(parsed)
                          .pipe(Effect.mapError(rejected))
                        yield* output.writeLine(
                          encodeProductionCliRecord({ _tag: "PublicationGrantResult", result, version: 1 })
                        )
                      }
                    }),
                    {
                      awaitRequest: signalAdapter.awaitRequest,
                      awaitRequestTime: signalAdapter.awaitRequestTime,
                      awaitResult: signalAdapter.awaitResult,
                      presentResult: (result) =>
                        presentApplicationExitResult(observation.selection.runId, result, output.writeLine)
                    }
                  )
                })
              ),
            "Run",
            early.startup
          ).pipe(Effect.mapError(mapProductionOutputFailure))
        }).pipe(
          Effect.tapError((failure) => {
            const known = knownProductionCliFailure(failure)
            return known === undefined || known instanceof ProductionCliOutputError
              ? Effect.void
              : TraceOutput.pipe(
                  Effect.flatMap((output) =>
                    output
                      .writeLine(encodeProductionCliRecord(productionCliFailureRecord(known)))
                      .pipe(Effect.mapError(mapProductionOutputFailure))
                  )
                )
          })
        )
    )
  const publicationSubjects = Command.make(
    "publication-subjects",
    { config: Flag.string("config"), target: Argument.string("target") },
    ({ config, target }) =>
      Effect.gen(function* () {
        const output = yield* TraceOutput
        const fileSystem = yield* FileSystem.FileSystem
        const invocation = yield* decodeRunInvocation({ config, dry: false, production: true, target })
        if (invocation._tag !== "Production") return yield* Effect.die("publication inspection selected dry Run")
        const loaded = yield* loadProductionConfiguration(invocation.configuration, invocation.target, (locator) =>
          fileSystem.readFileString(locator)
        )
        if (inspectPublicationSubjects === undefined)
          return yield* new ProductionCliUsageError({
            code: "usage.invalid",
            detail: "publication inspection is unavailable",
            subject: "dalph publication-subjects"
          })
        const result = yield* inspectPublicationSubjects(loaded)
        yield* output.writeLine(
          encodeProductionCliRecord({
            _tag: "PublicationSubjects",
            runId: result.runId,
            subjects: [...result.subjects],
            version: 1
          })
        )
      }).pipe(
        Effect.tapError((failure) => {
          const known = knownProductionCliFailure(failure)
          return known === undefined || known instanceof ProductionCliOutputError
            ? Effect.void
            : TraceOutput.pipe(
                Effect.flatMap((output) =>
                  output
                    .writeLine(encodeProductionCliRecord(productionCliFailureRecord(known)))
                    .pipe(Effect.mapError(mapProductionOutputFailure))
                )
              )
        })
      )
  )
  return Command.make("dalph").pipe(
    Command.withSubcommands([
      run,
      cancel,
      publicationCommand("publication-resume"),
      publicationCommand("publication-grant"),
      publicationSubjects,
      ...(runListeningHost === undefined ? [] : makeRunningHostCommands(runListeningHost, signals))
    ])
  )
}

export const runProductionCli = <EHost, RHost, EInspect = never, RInspect = never>(
  runProductionHost: ProductionCliHostRunner<EHost, RHost>,
  signals?: ApplicationExitSignalBoundary,
  inspectPublicationSubjects?: ProductionPublicationInspector<EInspect, RInspect>
) => Command.runWith(makeProductionCli(runProductionHost, signals, inspectPublicationSubjects), runConfiguration)

export const productionCliFromStdio = <EHost, RHost, EInspect = never, RInspect = never>(
  runProductionHost: ProductionCliHostRunner<EHost, RHost>,
  signals?: ApplicationExitSignalBoundary,
  inspectPublicationSubjects?: ProductionPublicationInspector<EInspect, RInspect>,
  runListeningHost?: ProductionListeningHostRunner<EHost, RHost>
) =>
  Command.run(
    makeProductionCli(runProductionHost, signals, inspectPublicationSubjects, runListeningHost),
    runConfiguration
  )

export const makeProductionCliHostRunner =
  <ECodex, EGithub, ETrace>(adapters: ProductionRepositoryHostAdapters<ECodex, EGithub, ETrace>) =>
  <EUse, EStartup = never>(
    input: ProductionRepositoryHostConfiguration,
    use: (
      observation: ProductionCliHostObservation,
      applicationExitRequestBoundary: ApplicationExitRequestBoundaryService,
      remotePublicationControl?: ProductionHostObservation["remotePublicationControl"]
    ) => Effect.Effect<void, EUse>,
    operation: "Run" | "Cancel" = "Run",
    startup?: ProductionHostStartup<void, EStartup, never>
  ) =>
    withDecodedProductionRepositoryHost(
      input,
      productionRepositoryHostGraph(adapters),
      (observation) =>
        use(
          productionCliHostObservationOf(observation),
          observation.applicationExitRequestBoundary,
          observation.remotePublicationControl
        ),
      operation,
      "Invocation",
      startup
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
export const makeProductionCliApplicationFromHost = <EHost, RHost, EInspect = never, RInspect = never>(
  runProductionHost: ProductionCliHostRunner<EHost, RHost>,
  inspectPublicationSubjects?: ProductionPublicationInspector<EInspect, RInspect>,
  runListeningHost?: ProductionListeningHostRunner<EHost, RHost>
) =>
  productionCliFromStdio(runProductionHost, undefined, inspectPublicationSubjects, runListeningHost).pipe(
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

/** Ordinary defaults and qualification share the same parser and application Layers. */
export const makeProductionCliApplication = <ECodex = never, EGithub = never, ETrace = never>(
  adapters: ProductionRepositoryHostAdapters<ECodex, EGithub, ETrace> = {}
) =>
  makeProductionCliApplicationFromHost(
    makeProductionCliHostRunner(adapters),
    (configuration) => inspectProductionPublicationSubjects(configuration, adapters),
    (configuration, use, startup) =>
      withDecodedProductionRepositoryHost(
        configuration,
        productionRepositoryHostGraph(adapters),
        use,
        "Run",
        "Listening",
        startup
      )
  )

/** The shipped binary selects live defaults at every external boundary. */
export const productionCliApplication = makeProductionCliApplication()
